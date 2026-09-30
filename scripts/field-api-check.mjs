// Field API contract check (Phase 21, Front Line 2, 2026-09-25). Exercises the field-session access
// model, the field commands, idempotent replay, chunked upload + Range, and the walk share link
// against a RUNNING server. It is server-only and fast (no browser), so scripts/smoke.mjs runs it
// right after the referential-integrity check.
//
//   node scripts/field-api-check.mjs [--url http://localhost:4199] [--password <break-glass>]
//
// Every check is independent and prints its own PASS/FAIL/SKIP line; a check whose precondition isn't
// met in this data set (no scheduled job, no suspended device, ...) prints SKIP rather than failing the
// whole run, so this script stays meaningful against both a fresh data folder and a live-shaped copy.

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const baseUrl = option("--url", process.env.CRM_URL || "http://localhost:4199");
const password = option("--password", process.env.CRM_PASSWORD || "");
if (!password) {
  console.error("Pass --password <break-glass password> or set CRM_PASSWORD.");
  process.exit(1);
}

const results = [];
function report(status, label, detail = "") {
  results.push({ status, label });
  console.log(`  ${status.padEnd(4)} ${label}${detail ? ` -- ${detail}` : ""}`);
}
async function step(label, fn) {
  try {
    const outcome = await fn();
    if (outcome === "skip") report("SKIP", label);
    else report("PASS", label);
  } catch (error) {
    report("FAIL", label, error.message || String(error));
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieOf(response) {
  return (response.headers.get("set-cookie") || "").split(";")[0];
}
async function j(response) {
  return response.json().catch(() => ({}));
}

// ---- sign in as break-glass admin --------------------------------------------------------------
const loginResponse = await fetch(`${baseUrl}/api/auth/break-glass`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
if (!loginResponse.ok) {
  console.error(`✗ break-glass sign-in failed: ${loginResponse.status}`);
  process.exit(1);
}
const adminCookie = cookieOf(loginResponse);
const adminHeaders = { "Content-Type": "application/json", Cookie: adminCookie, "X-CRM-User": "field-api-check" };

async function adminGet(collection) {
  const response = await fetch(`${baseUrl}/api/backend/${collection}`, { headers: adminHeaders });
  assert(response.ok, `GET /api/backend/${collection} -> ${response.status}`);
  return response.json();
}
async function adminPost(collection, body) {
  const response = await fetch(`${baseUrl}/api/backend/${collection}`, { method: "POST", headers: adminHeaders, body: JSON.stringify(body) });
  const payload = await j(response);
  return { response, payload };
}
async function apiPost(path, body) {
  const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: adminHeaders, body: JSON.stringify(body) });
  const payload = await j(response);
  return { response, payload };
}

const [employees, jobAssignments, dispatchJobs, frontlineDevices] = await Promise.all([
  adminGet("employees"), adminGet("jobAssignments"), adminGet("dispatchJobs"), adminGet("frontlineDevices"),
]);

// A Field Lead with at least one live assignment, and a second crew-mate on the same job (for the
// "crew-mate fields only" and "lead clocks crew" checks).
const liveAssignments = (jobAssignments || []).filter((item) => !item.deletedAt && item.status !== "Cancelled");
const jobsWithMultipleCrew = new Map();
for (const assignment of liveAssignments) {
  const list = jobsWithMultipleCrew.get(assignment.jobId) || [];
  list.push(assignment);
  jobsWithMultipleCrew.set(assignment.jobId, list);
}
let leadAssignment = null;
let crewMateId = null;
for (const [jobId, list] of jobsWithMultipleCrew) {
  if (list.length >= 1) {
    leadAssignment = list[0];
    crewMateId = list[1]?.employeeId || null;
    if (crewMateId) break;
  }
}
if (!leadAssignment) leadAssignment = liveAssignments[0] || null;

let linkCookie = "";
let linkToken = "";
let leadEmployeeId = leadAssignment?.employeeId || "";
let leadJobId = leadAssignment?.jobId || "";

// ---- 1. A /go/ link session sees only its job, no invoices, no pay fields -----------------------
await step("dispatch-link session: package scoped to its one job, no pay/finance data", async () => {
  if (!leadAssignment) return "skip";
  const { response, payload } = await apiPost("/api/auth/dispatch-links", { employeeId: leadEmployeeId, dispatchJobId: leadJobId });
  assert(response.ok, `mint link -> ${response.status} ${payload.error || ""}`);
  linkToken = payload.url.split("/go/")[1];
  const openResponse = await fetch(`${baseUrl}/go/${linkToken}`, { redirect: "manual" });
  assert([301, 302, 303, 307].includes(openResponse.status), `open link -> ${openResponse.status} (want a redirect)`);
  linkCookie = cookieOf(openResponse);
  assert(linkCookie.startsWith("crm_session="), "no session cookie from the sign-on link");
  const backendResponse = await fetch(`${baseUrl}/api/backend`, { headers: { Cookie: linkCookie } });
  assert(backendResponse.ok, `GET /api/backend as link session -> ${backendResponse.status}`);
  const backend = await backendResponse.json();
  assert(Array.isArray(backend.dispatchJobs) && backend.dispatchJobs.every((job) => job.id === leadJobId), "dispatchJobs leaked a job outside the link's own");
  assert(backend.dispatchJobs.some((job) => job.id === leadJobId), "the link's own job is missing from its package");
  assert(Array.isArray(backend.invoices) && backend.invoices.length === 0, "invoices leaked to a field session");
  assert(Array.isArray(backend.opportunities), "opportunities key missing (should be [] or scoped)");
});

// ---- 2. GET /api/field/package returns the same scoped shape plus serverTime --------------------
await step("GET /api/field/package (dispatch-link)", async () => {
  if (!linkCookie) return "skip";
  const response = await fetch(`${baseUrl}/api/field/package`, { headers: { Cookie: linkCookie } });
  const payload = await j(response);
  assert(response.ok, `-> ${response.status} ${payload.error || ""}`);
  assert(typeof payload.serverTime === "string" && payload.serverTime, "no serverTime in the package");
  assert(Array.isArray(payload.dispatchJobs) && payload.dispatchJobs.some((job) => job.id === leadJobId), "package missing the link's job");
});

// ---- 3. Crew role cannot POST siteWalkReports ----------------------------------------------------
await step("Crew role cannot write siteWalkReports", async () => {
  const crewUserId = "field-api-check-crew-user";
  const { response: userResponse, payload: userPayload } = await adminPost("systemUsers", {
    id: crewUserId, fullName: "Field API Check Crew", username: "field-api-check-crew",
    internalEmailAddress: "field-api-check-crew@example.invalid", role: "Crew", roles: ["Crew"], employeeId: "", isDisabled: false,
  });
  assert(userResponse.ok, `create Crew test user -> ${userResponse.status} ${userPayload.error || ""}`);
  const passwordResponse = await fetch(`${baseUrl}/api/auth/password`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ userId: crewUserId, password: "field-api-check-crew-pw-1" }) });
  assert(passwordResponse.ok, `set Crew test user password -> ${passwordResponse.status}`);
  const crewLogin = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "field-api-check-crew", password: "field-api-check-crew-pw-1" }) });
  assert(crewLogin.ok, `Crew sign-in -> ${crewLogin.status}`);
  const crewCookie = cookieOf(crewLogin);
  const writeResponse = await fetch(`${baseUrl}/api/backend/siteWalkReports`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: crewCookie }, body: JSON.stringify({ walkEventId: "does-not-matter" }) });
  assert(writeResponse.status === 403, `Crew POST siteWalkReports -> ${writeResponse.status} (want 403)`);
});

// ---- 4. Idempotent replay: same X-Client-Command-Id -> same body, one row -----------------------
await step("Idempotent replay (X-Client-Command-Id)", async () => {
  const commandId = `field-api-check-${Date.now()}`;
  const before = await adminGet("locations");
  const write = () => fetch(`${baseUrl}/api/backend/locations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: adminCookie, "X-Client-Command-Id": commandId, "X-CRM-User": "field-api-check" },
    body: JSON.stringify({ latitude: 30.6333, longitude: -97.6779, label: "field-api-check idempotency test", locationType: "Spill origin" }),
  });
  const first = await write();
  const firstBody = await j(first);
  assert(first.ok, `first write -> ${first.status} ${firstBody.error || ""}`);
  const second = await write();
  const secondBody = await j(second);
  assert(second.status === first.status && secondBody.id === firstBody.id, "replay returned a different response than the original");
  const after = await adminGet("locations");
  assert(after.length === before.length + 1, `expected exactly one new row, before=${before.length} after=${after.length}`);
});

// ---- 5. advance: skipping a step is refused; the next step succeeds -----------------------------
await step("advance: one step at a time (scheduled -> dispatched ok, scheduled -> on_site refused)", async () => {
  const scheduledJob = (dispatchJobs || []).find((job) => job.status === "scheduled" && !job.deletedAt && liveAssignments.some((item) => item.jobId === job.id));
  if (!scheduledJob) return "skip";
  const skipResponse = await fetch(`${baseUrl}/api/field/jobs/${scheduledJob.id}/advance`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ toStatus: "on_site" }) });
  const skipBody = await j(skipResponse);
  assert(skipResponse.status === 409 && skipBody.blocked, `skip-ahead advance -> ${skipResponse.status} blocked=${skipBody.blocked} (want 409, blocked:true)`);
  const okResponse = await fetch(`${baseUrl}/api/field/jobs/${scheduledJob.id}/advance`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ toStatus: "dispatched" }) });
  const okBody = await j(okResponse);
  assert(okResponse.ok && okBody.status === "dispatched", `single-step advance -> ${okResponse.status} status=${okBody.status} (want 200, dispatched)`);
});

// ---- 6. chunked upload: 3 chunks, then Range: bytes=0-99 -> 206 ---------------------------------
await step("chunked upload (3 chunks) + Range 206", async () => {
  const account = (await adminGet("accounts")).find((item) => !item.deletedAt);
  if (!account) return "skip";
  const project = (await adminGet("projects")).find((item) => item.accountId === account.id && !item.deletedAt);
  if (!project) return "skip";
  const totalBytes = 300;
  const full = Buffer.alloc(totalBytes, 65); // 'A' repeated
  const createResponse = await fetch(`${baseUrl}/api/documents/upload-session`, {
    method: "POST", headers: adminHeaders,
    body: JSON.stringify({ fileName: "field-api-check.txt", mimeType: "text/plain; charset=utf-8", sizeBytes: totalBytes, entityType: "project", entityId: project.id, documentType: "field-api-check", caption: "field-api-check" }),
  });
  const createBody = await j(createResponse);
  assert(createResponse.ok, `create upload session -> ${createResponse.status} ${createBody.error || ""}`);
  const chunkSize = 100;
  for (let index = 0; index < 3; index += 1) {
    const chunk = full.subarray(index * chunkSize, (index + 1) * chunkSize);
    const chunkResponse = await fetch(`${baseUrl}/api/documents/upload-session/${createBody.sessionId}/chunks/${index}`, { method: "PUT", headers: { Cookie: adminCookie, "Content-Type": "application/octet-stream" }, body: chunk });
    assert(chunkResponse.ok, `chunk ${index} -> ${chunkResponse.status}`);
  }
  const completeResponse = await fetch(`${baseUrl}/api/documents/upload-session/${createBody.sessionId}/complete`, { method: "POST", headers: adminHeaders, body: "{}" });
  const completeBody = await j(completeResponse);
  assert(completeResponse.ok, `complete -> ${completeResponse.status} ${completeBody.error || ""}`);
  assert(completeBody.sizeBytes === totalBytes, `assembled file is ${completeBody.sizeBytes} bytes, expected ${totalBytes}`);
  const rangeResponse = await fetch(`${baseUrl}/api/documents/${completeBody.id}/view`, { headers: { Cookie: adminCookie, Range: "bytes=0-99" } });
  assert(rangeResponse.status === 206, `ranged GET -> ${rangeResponse.status} (want 206)`);
  assert(rangeResponse.headers.get("content-range") === `bytes 0-99/${totalBytes}`, `Content-Range: ${rangeResponse.headers.get("content-range")}`);
});

// ---- 7. walk share link: data route works with no session, 410s after revoke --------------------
await step("walk share link: works with no session, 410s after revoke", async () => {
  const walkEvent = (await adminGet("scheduleEvents")).find((item) => item.kind === "site_walk" && !item.deletedAt);
  if (!walkEvent) return "skip";
  const completeResponse = await fetch(`${baseUrl}/api/field/site-walk/${walkEvent.id}/complete`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ summary: "field-api-check" }) });
  const completeBody = await j(completeResponse);
  assert(completeResponse.ok, `complete walk -> ${completeResponse.status} ${completeBody.error || ""}`);
  const shareResponse = await fetch(`${baseUrl}/api/field/walks/${completeBody.id}/share`, { method: "POST", headers: adminHeaders, body: "{}" });
  const shareBody = await j(shareResponse);
  assert(shareResponse.ok, `create share -> ${shareResponse.status} ${shareBody.error || ""}`);
  const token = shareBody.url.split("/walk/")[1];
  const dataResponse = await fetch(`${baseUrl}/api/walk/${token}/data`);
  assert(dataResponse.ok, `GET /api/walk/<token>/data with no session -> ${dataResponse.status}`);
  // 2026-09-25 (owner: "the images don't load"): a staff link must carry every photo the walk's
  // observations reference, internal ones included; a customer link only customer-visible ones.
  const dataBody = await j(dataResponse);
  assert(dataBody.audience === "staff", `default share audience -> ${dataBody.audience} (want staff)`);
  const referenced = new Set((dataBody.observations || []).flatMap((row) => row.photoDocumentIds || []));
  const allDocuments = await adminGet("documents");
  const expected = allDocuments.filter((doc) => referenced.has(doc.id) && !doc.deletedAt).map((doc) => doc.id);
  const served = new Set((dataBody.documents || []).map((doc) => doc.id));
  assert(expected.every((id) => served.has(id)), `staff link serves all ${expected.length} referenced photos (got ${served.size})`);
  if (expected.length) {
    const photoResponse = await fetch(`${baseUrl}/api/walk/${token}/documents/${expected[0]}/view`);
    assert(photoResponse.ok, `photo view through the staff link -> ${photoResponse.status}`);
  }
  const customerShare = await j(await fetch(`${baseUrl}/api/field/walks/${completeBody.id}/share`, { method: "POST", headers: { ...adminHeaders, "X-Client-Command-Id": `share-cust-${Date.now()}` }, body: JSON.stringify({ audience: "customer" }) }));
  const customerData = await j(await fetch(`${baseUrl}/api/walk/${customerShare.url.split("/walk/")[1]}/data`));
  assert((customerData.documents || []).every((doc) => allDocuments.find((item) => item.id === doc.id)?.visibility === "customer"), "customer link serves only customer-visible photos");
  const revokeResponse = await fetch(`${baseUrl}/api/field/walks/${completeBody.id}/share/${shareBody.id}`, { method: "DELETE", headers: adminHeaders });
  assert(revokeResponse.ok, `revoke -> ${revokeResponse.status}`);
  const afterRevoke = await fetch(`${baseUrl}/api/walk/${token}/data`);
  assert(afterRevoke.status === 410, `after revoke -> ${afterRevoke.status} (want 410)`);
});

// ---- 7b. completing a walk leaves exactly one activity (Phase 25 Wave B, 2026-09-29) --------------
// Before Wave B the completion never found the scheduled Meeting and pushed a second record. Two
// cases: a walk scheduled the old way (the Meeting is linked only by event.activityId), completed
// twice; and a walk with no activity at all, which gets one Meeting.
await step("walk completion updates the scheduled Meeting: exactly one activity, Completed", async () => {
  const opportunity = (await adminGet("opportunities")).find((item) => !item.deletedAt);
  if (!opportunity) return "skip";
  const stamp = Date.now().toString(36);
  const post = async (collection, record) => {
    const response = await fetch(`${baseUrl}/api/backend/${collection}`, { method: "POST", headers: adminHeaders, body: JSON.stringify(record) });
    assert(response.ok, `POST ${collection} -> ${response.status}`);
  };
  const complete = async (eventId, n) => {
    const response = await fetch(`${baseUrl}/api/field/site-walk/${eventId}/complete`, { method: "POST", headers: { ...adminHeaders, "X-Client-Command-Id": `walk-one-${eventId}-${n}` }, body: JSON.stringify({ summary: `field-api-check ${n}` }) });
    const body = await j(response);
    assert(response.ok, `complete walk -> ${response.status} ${body.error || ""}`);
    return body;
  };
  const base = { kind: "site_walk", opportunityId: opportunity.id, accountId: opportunity.accountId || "", facilityId: opportunity.facilityId || "", date: "2026-09-29", startTime: "09:00", endTime: "10:00", participantEmployeeIds: [], status: "Scheduled", crew: "Sales" };
  const legacyActivity = { id: `act-walk-check-${stamp}`, activityType: "Meeting", subject: "Site walk — field-api-check", status: "Scheduled", opportunityId: opportunity.id, accountId: opportunity.accountId || "", owner: "field-api-check", tags: ["Site Visit"], relatedRecords: [{ type: "opportunity", id: opportunity.id }] };
  await post("activities", legacyActivity);
  const legacyEvent = { ...base, id: `site-walk-check-${stamp}`, title: "field-api-check legacy walk", activityId: legacyActivity.id };
  await post("scheduleEvents", legacyEvent);
  const bareEvent = { ...base, id: `site-walk-check-bare-${stamp}`, title: "field-api-check walk with no activity", activityId: "" };
  await post("scheduleEvents", bareEvent);
  const legacyReport = await complete(legacyEvent.id, 1);
  await complete(legacyEvent.id, 2);
  const bareReport = await complete(bareEvent.id, 1);
  const activities = (await adminGet("activities")).filter((item) => !item.deletedAt);
  const events = await adminGet("scheduleEvents");
  for (const [event, report] of [[legacyEvent, legacyReport], [bareEvent, bareReport]]) {
    const stored = events.find((item) => item.id === event.id);
    const linked = activities.filter((item) => item.regardingScheduleEventId === event.id || item.id === event.activityId || item.id === stored?.activityId);
    assert(linked.length === 1, `${event.title}: ${linked.length} activities (want 1)`);
    const [activity] = linked;
    assert(activity.status === "Completed" && activity.activityType === "Meeting" && !activity.type, `${event.title}: activity is ${activity.activityType}/${activity.status}${activity.type ? ` type:${activity.type}` : ""} (want Meeting/Completed)`);
    assert(activity.siteWalkReportId === report.id, `${event.title}: siteWalkReportId ${activity.siteWalkReportId} (want ${report.id})`);
    assert((activity.relatedRecords || []).some((item) => item.type === "siteWalk" && item.id === event.id), `${event.title}: the walk is not in relatedRecords`);
    assert((activity.tags || []).includes("Site Visit") && activity.owner, `${event.title}: missing Site Visit tag or owner`);
    assert(stored?.status === "Completed" && stored.activityId === activity.id, `${event.title}: event ${stored?.status} activityId ${stored?.activityId}`);
    assert(report.status === "Completed", `${event.title}: report status ${report.status}`);
  }
  assert(activities.find((item) => item.id === legacyActivity.id)?.owner === "field-api-check", "an existing owner was overwritten");
  for (const event of [legacyEvent, bareEvent]) await fetch(`${baseUrl}/api/backend/scheduleEvents/${event.id}`, { method: "DELETE", headers: adminHeaders });
  for (const activity of activities.filter((item) => [legacyEvent.id, bareEvent.id].includes(item.regardingScheduleEventId))) await fetch(`${baseUrl}/api/backend/activities/${activity.id}`, { method: "DELETE", headers: adminHeaders });
});

// ---- 8. a suspended-device employee cannot mint a usable session ---------------------------------
await step("suspended-device employee is refused a sign-on link session", async () => {
  const suspendedDevice = (frontlineDevices || []).find((device) => device.registrationStatus === "Suspended" && !device.deletedAt);
  const employeeId = suspendedDevice?.employeeId;
  const job = employeeId ? (dispatchJobs || []).find((item) => liveAssignments.some((a) => a.employeeId === employeeId && a.jobId === item.id)) : null;
  if (!suspendedDevice || !job) return "skip";
  const { response, payload } = await apiPost("/api/auth/dispatch-links", { employeeId, dispatchJobId: job.id });
  assert(response.ok, `mint link for suspended-device employee -> ${response.status} ${payload.error || ""}`);
  const token = payload.url.split("/go/")[1];
  const openResponse = await fetch(`${baseUrl}/go/${token}`, { redirect: "manual" });
  assert(openResponse.status === 409, `open link -> ${openResponse.status} (want 409 device blocked)`);
});

// ---- 9. a walk participant records the walk whatever their office domains say -------------------
// (2026-09-25, found live: an Operations Manager on a site walk could see the map but every pin save
// was refused because siteWalkObservations is a "sales" collection.)
await step("walk participant without the sales domain can write the walk's pins, not another walk's", async () => {
  const [scheduleEvents, systemUsers] = await Promise.all([adminGet("scheduleEvents"), adminGet("systemUsers")]);
  const walks = (scheduleEvents || []).filter((event) => event.kind === "site_walk" && !event.deletedAt);
  const salesRoles = new Set(["Admin", "Office Manager", "Sales Manager", "Account Manager"]);
  const candidate = (systemUsers || []).find((user) => {
    const roles = user.roles?.length ? user.roles : [user.role];
    return user.employeeId && !user.isDisabled && user.username && roles.every((role) => !salesRoles.has(role)) && walks.some((walk) => (walk.participantEmployeeIds || []).includes(user.employeeId));
  });
  if (!candidate) return "skip";
  const walk = walks.find((item) => (item.participantEmployeeIds || []).includes(candidate.employeeId));
  const otherWalk = walks.find((item) => !(item.participantEmployeeIds || []).includes(candidate.employeeId));
  const scratchPassword = `walk-check-${Date.now()}`;
  const setPassword = await apiPost("/api/auth/password", { userId: candidate.id, password: scratchPassword });
  assert(setPassword.response.ok, `set scratch password -> ${setPassword.response.status}`);
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: candidate.username, password: scratchPassword }) });
  assert(login.ok, `login as ${candidate.username} -> ${login.status}`);
  const headers = { "Content-Type": "application/json", Cookie: cookieOf(login), "X-Client-Command-Id": `walk-check-${Date.now()}` };
  const pin = { id: `obs-check-${Date.now()}`, walkEventId: walk.id, opportunityId: walk.opportunityId || "", facilityId: walk.facilityId || "", seq: 999, kind: "sample", label: "check", lat: 30.6, lng: -97.6 };
  const write = await fetch(`${baseUrl}/api/backend/siteWalkObservations`, { method: "POST", headers, body: JSON.stringify(pin) });
  assert(write.ok, `participant writes a pin on their walk -> ${write.status} (want 200)`);
  const read = await fetch(`${baseUrl}/api/backend/siteWalkObservations`, { headers });
  const rows = await j(read);
  assert(Array.isArray(rows) && rows.some((row) => row.id === pin.id), "participant reads the pin back through the collection route");
  const del = await fetch(`${baseUrl}/api/backend/siteWalkObservations/${pin.id}`, { method: "DELETE", headers });
  assert(del.ok, `participant deletes their own pin -> ${del.status} (want 200)`);
  if (otherWalk) {
    const foreign = await fetch(`${baseUrl}/api/backend/siteWalkObservations`, { method: "POST", headers: { ...headers, "X-Client-Command-Id": `walk-check-foreign-${Date.now()}` }, body: JSON.stringify({ ...pin, id: `${pin.id}-x`, walkEventId: otherWalk.id }) });
    assert(foreign.status === 403, `pin on a walk they are not on -> ${foreign.status} (want 403)`);
  }
});

// ---- 10. briefing: airMonitoring alias round-trips, hazards persist (item 1, 2026-09-28 IT report) --
// field/safety.js sends readings as `airMonitoring`; the server used to store them only under
// `airReadings` and drop the name the client actually sent, so a save "disappeared" until reload.
await step("briefing: airMonitoring rows and a hazard row round-trip through POST/GET", async () => {
  const job = (dispatchJobs || []).find((item) => !item.deletedAt);
  if (!job) return "skip";
  const operationalDate = new Date().toISOString().slice(0, 10);
  const body = {
    jobId: job.id,
    operationalDate,
    ppeLevel: "C",
    hazards: [{ step: "field-api-check step", hazard: "field-api-check hazard", control: "field-api-check control" }],
    airMonitoring: [
      { time: "08:00", reading: "0.2 ppm", notes: "field-api-check reading 1" },
      { time: "10:00", reading: "0.3 ppm", notes: "field-api-check reading 2" },
    ],
  };
  const response = await fetch(`${baseUrl}/api/field/jobs/${job.id}/briefing`, { method: "POST", headers: { ...adminHeaders, "X-Client-Command-Id": `field-api-check-briefing-${Date.now()}` }, body: JSON.stringify(body) });
  const payload = await j(response);
  assert(response.ok, `POST briefing -> ${response.status} ${payload.error || ""}`);
  assert(Array.isArray(payload.airMonitoring) && payload.airMonitoring.length === 2, `response airMonitoring has ${payload.airMonitoring?.length ?? 0} rows, want 2`);
  const briefings = await adminGet("jobSafetyBriefings");
  const stored = briefings.find((item) => item.id === payload.id);
  assert(stored, "briefing row not found in jobSafetyBriefings after save");
  assert(Array.isArray(stored.airReadings) && stored.airReadings.length === 2, `stored airReadings has ${stored.airReadings?.length ?? 0} rows, want 2`);
  assert(Array.isArray(stored.airMonitoring) && stored.airMonitoring.length === 2, `stored airMonitoring has ${stored.airMonitoring?.length ?? 0} rows, want 2`);
  assert(Array.isArray(stored.hazards) && stored.hazards.some((row) => row.hazard === "field-api-check hazard"), "hazard row missing from stored briefing");
});

// ---- 11/12. Phase 25 A.2/A.3 (2026-09-29): roll-call merge + the start-of-work briefing guard ------
// A throwaway on-site job with a lead and one crew member (no work plan, so the briefing is Start
// work's only gate). Before Phase 25 the server kept its stored roll call and dropped every "Mark
// arrived", and nothing stopped work starting with nobody on site.
const activeEmployees = (employees || []).filter((item) => !item.deletedAt && (item.employmentStatus || "Active") === "Active");
const guardLeadId = activeEmployees[0]?.id || "";
const guardCrewId = activeEmployees[1]?.id || "";
const guardJobId = `field-api-check-guard-${Date.now()}`;
let guardReady = false;
if (guardLeadId && guardCrewId) {
  const start = new Date();
  const end = new Date(start.getTime() + 8 * 3600 * 1000);
  const created = await adminPost("dispatchJobs", {
    id: guardJobId, jobNumber: "CHECK-GUARD", jobName: "field-api-check briefing guard", status: "on_site", dispatchStatus: "On site",
    scheduledStart: start.toISOString(), scheduledEnd: end.toISOString(), fieldLeadEmployeeId: guardLeadId, completionPercent: 20,
  });
  const leadRow = await adminPost("jobAssignments", { id: `${guardJobId}-lead`, jobId: guardJobId, employeeId: guardLeadId, isFieldLead: true, status: "Assigned" });
  const crewRow = await adminPost("jobAssignments", { id: `${guardJobId}-crew`, jobId: guardJobId, employeeId: guardCrewId, isFieldLead: false, status: "Assigned" });
  guardReady = created.response.ok && leadRow.response.ok && crewRow.response.ok;
}
async function linkSession(employeeId, jobId) {
  const { response, payload } = await apiPost("/api/auth/dispatch-links", { employeeId, dispatchJobId: jobId });
  assert(response.ok, `mint link -> ${response.status} ${payload.error || ""}`);
  const open = await fetch(`${baseUrl}/go/${payload.url.split("/go/")[1]}`, { redirect: "manual" });
  const cookie = cookieOf(open);
  assert(cookie.startsWith("crm_session="), `no session from the link (${open.status})`);
  return cookie;
}
const fieldPost = (cookie, path, body) =>
  fetch(`${baseUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, "X-Client-Command-Id": `fac-${Date.now()}-${Math.random().toString(36).slice(2)}` }, body: JSON.stringify(body) }).then(async (response) => ({ response, payload: await j(response) }));

await step("roll call: arrivals merge per person; crew only for themselves; acknowledgedAt never taken from the payload", async () => {
  if (!guardReady) return "skip";
  const leadCookie = await linkSession(guardLeadId, guardJobId);
  const crewCookie = await linkSession(guardCrewId, guardJobId);
  const at = new Date().toISOString();
  const path = `/api/field/jobs/${guardJobId}/briefing`;
  const lead = await fieldPost(leadCookie, path, { rollCall: [{ employeeId: guardLeadId, arrivedAt: at, acknowledgedAt: at }] });
  assert(lead.response.ok, `lead marks self arrived -> ${lead.response.status} ${lead.payload.error || ""}`);
  const leadRow = (lead.payload.rollCall || []).find((row) => row.employeeId === guardLeadId);
  assert(leadRow?.arrivedAt === at, "the lead's arrivedAt was dropped");
  assert(!leadRow.acknowledgedAt, "acknowledgedAt was accepted from the briefing payload");
  const foreign = await fieldPost(crewCookie, path, { rollCall: [{ employeeId: guardLeadId, leftAt: at }] });
  assert(foreign.response.status === 403, `crew changing the lead's row -> ${foreign.response.status} (want 403)`);
  const self = await fieldPost(crewCookie, path, { rollCall: [{ employeeId: guardCrewId, arrivedAt: at }], ppeLevel: "A" });
  assert(self.response.ok, `crew marks self arrived -> ${self.response.status} ${self.payload.error || ""}`);
  assert((self.payload.rollCall || []).some((row) => row.employeeId === guardLeadId && row.arrivedAt === at), "crew's save lost the lead's arrival");
  assert((self.payload.rollCall || []).some((row) => row.employeeId === guardCrewId && row.arrivedAt === at), "crew's own arrival was dropped");
  assert(self.payload.ppeLevel !== "A", "crew was allowed to change the briefing body");
  const visitor = await fieldPost(leadCookie, path, { rollCall: [{ id: "fac-visitor", employeeId: "", personType: "visitor", displayName: "Check Visitor", arrivedAt: at }] });
  assert(visitor.response.ok && (visitor.payload.rollCall || []).some((row) => row.id === "fac-visitor" && row.personType === "visitor" && row.displayName === "Check Visitor"), `lead adds a visitor -> ${visitor.response.status} ${visitor.payload.error || ""}`);
  const crewVisitor = await fieldPost(crewCookie, path, { rollCall: [{ id: "fac-visitor-2", employeeId: "", displayName: "Nope", arrivedAt: at }] });
  assert(crewVisitor.response.status === 403, `crew adds a visitor -> ${crewVisitor.response.status} (want 403)`);
});

await step("start of work: refused until someone is on site and everyone on site signed the briefing", async () => {
  if (!guardReady) return "skip";
  const advancePath = `/api/field/jobs/${guardJobId}/advance`;
  const blocked = await fieldPost(adminCookie, advancePath, { toStatus: "in_progress" });
  assert(blocked.response.status === 409 && blocked.payload.blocked, `Start work with unsigned people on site -> ${blocked.response.status} (want 409 blocked)`);
  const complete = await fieldPost(adminCookie, `/api/field/jobs/${guardJobId}/briefing`, { complete: true });
  assert(complete.response.status === 409, `Complete briefing before everyone signed -> ${complete.response.status} (want 409)`);
  // Everyone on site signs: lead, crew, and the visitor (by roll-call row, as the lead's phone does).
  for (const body of [{ employeeId: guardLeadId }, { employeeId: guardCrewId }, { rollCallId: "fac-visitor" }]) {
    const ack = await fieldPost(adminCookie, `/api/field/jobs/${guardJobId}/briefing/acknowledge`, body);
    assert(ack.response.ok, `acknowledge ${JSON.stringify(body)} -> ${ack.response.status} ${ack.payload.error || ""}`);
  }
  const done = await fieldPost(adminCookie, `/api/field/jobs/${guardJobId}/briefing`, { complete: true });
  assert(done.response.ok && done.payload.completedAt, `Complete briefing once all signed -> ${done.response.status} ${done.payload.error || ""}`);
  const started = await fieldPost(adminCookie, advancePath, { toStatus: "in_progress" });
  assert(started.response.ok && started.payload.status === "in_progress", `Start work once all signed -> ${started.response.status} ${started.payload.error || ""}`);
});

if (guardReady) {
  await fetch(`${baseUrl}/api/backend/dispatchJobs/${guardJobId}`, { method: "DELETE", headers: adminHeaders }).catch(() => {});
}

// ---- 13. Phase 25 A.3b (2026-09-29): driver's-licence check-in (POST .../roll-call/scan) ----------
// Two throwaway employees (so no earlier run's linked licence gets in the way) on a throwaway job.
// Licence numbers are unique per run; none of them may ever come back in any response, and neither
// may the keyed hash (employees.licenceHash) the server matches on.
await step("roll-call scan: match, suggestions, lead links, crew can't link, expired warns, licenceHash never sent", async () => {
  const stamp = Date.now();
  const scanLeadId = `field-api-check-scan-lead-${stamp}`;
  const scanCrewId = `field-api-check-scan-crew-${stamp}`;
  const scanJobId = `field-api-check-scan-job-${stamp}`;
  for (const [id, first, last] of [[scanLeadId, "Scanlead", `Check${stamp}`], [scanCrewId, "Scancrew", `Crewcheck${stamp}`]]) {
    const created = await adminPost("employees", { id, firstName: first, lastName: last, displayName: `${first} ${last}`, jobTitle: "Technician", employmentStatus: "Active" });
    assert(created.response.ok, `create test employee -> ${created.response.status} ${created.payload.error || ""}`);
  }
  const start = new Date();
  const job = await adminPost("dispatchJobs", {
    id: scanJobId, jobNumber: "CHECK-SCAN", jobName: "field-api-check licence scan", status: "on_site", dispatchStatus: "On site",
    scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 8 * 3600 * 1000).toISOString(), fieldLeadEmployeeId: scanLeadId,
  });
  assert(job.response.ok, `create test job -> ${job.response.status} ${job.payload.error || ""}`);
  await adminPost("jobAssignments", { id: `${scanJobId}-lead`, jobId: scanJobId, employeeId: scanLeadId, isFieldLead: true, status: "Assigned" });
  await adminPost("jobAssignments", { id: `${scanJobId}-crew`, jobId: scanJobId, employeeId: scanCrewId, isFieldLead: false, status: "Assigned" });
  try {
    const leadCookie = await linkSession(scanLeadId, scanJobId);
    const crewCookie = await linkSession(scanCrewId, scanJobId);
    const path = `/api/field/jobs/${scanJobId}/roll-call/scan`;
    const digits = String(stamp).slice(-8);
    const crewLicence = `C${digits}`;
    const leadLicence = `L${digits}`;
    const otherLicence = `X${digits}`;
    const visitorLicence = `V${digits}`;
    const allNumbers = [crewLicence, leadLicence, otherLicence, visitorLicence];
    const seen = [];
    const scan = async (cookie, body) => {
      const result = await fieldPost(cookie, path, { idState: "TX", idExpiry: "2031-01-31", ...body });
      seen.push(JSON.stringify(result.payload));
      return result;
    };
    const crewCard = { licenceNumber: crewLicence, givenName: "Scancrew", familyName: `Crewcheck${stamp}`, displayName: `Scancrew Crewcheck${stamp}` };

    const unknown = await scan(leadCookie, crewCard);
    assert(unknown.response.ok && unknown.payload.match === null, `unknown licence -> ${unknown.response.status} match=${JSON.stringify(unknown.payload.match)} (want 200, null)`);
    assert((unknown.payload.suggestions || [])[0]?.employeeId === scanCrewId, "the crew member whose name is on the licence is not the first suggestion");
    assert(unknown.payload.licence?.idLast4 === crewLicence.slice(-4), "licence summary missing its last 4");

    const crewSelfLink = await scan(crewCookie, { ...crewCard, employeeId: scanCrewId });
    assert(crewSelfLink.response.status === 403, `crew links a licence -> ${crewSelfLink.response.status} (want 403)`);
    const crewLinksLead = await scan(crewCookie, { ...crewCard, employeeId: scanLeadId });
    assert(crewLinksLead.response.status === 403, `crew links someone else -> ${crewLinksLead.response.status} (want 403)`);

    const linked = await scan(leadCookie, { ...crewCard, employeeId: scanCrewId, lat: 30.63, lng: -97.67, accuracyM: 12 });
    assert(linked.response.ok && linked.payload.match?.employeeId === scanCrewId && linked.payload.linked === true, `lead confirms -> ${linked.response.status} ${linked.payload.error || ""}`);
    const row = (linked.payload.briefing?.rollCall || []).find((item) => item.employeeId === scanCrewId);
    assert(row?.arrivedAt && row.checkInMethod === "scan" && row.idLast4 === crewLicence.slice(-4) && row.idState === "TX" && row.idExpiry === "2031-01-31" && row.lat === 30.63, `scanned row -> ${JSON.stringify(row)}`);

    const again = await scan(leadCookie, crewCard);
    assert(again.payload.match?.employeeId === scanCrewId && !again.payload.linked, "a linked licence does not match on the next scan");
    const own = await scan(crewCookie, crewCard);
    assert(own.response.ok && own.payload.match?.employeeId === scanCrewId, `crew scans their own linked licence -> ${own.response.status} ${own.payload.error || ""}`);

    const leadCard = { licenceNumber: leadLicence, displayName: `Scanlead Check${stamp}` };
    const leadLinked = await scan(leadCookie, { ...leadCard, employeeId: scanLeadId });
    assert(leadLinked.response.ok && leadLinked.payload.linked, `lead links own licence -> ${leadLinked.response.status}`);
    const crewScansLead = await scan(crewCookie, leadCard);
    assert(crewScansLead.response.status === 403, `crew scans the lead's licence -> ${crewScansLead.response.status} (want 403)`);

    const second = await scan(leadCookie, { licenceNumber: otherLicence, displayName: "Other Card", employeeId: scanCrewId });
    assert(second.response.status === 409, `lead links a second licence to someone already linked -> ${second.response.status} (want 409)`);
    const officeReplace = await scan(adminCookie, { licenceNumber: otherLicence, displayName: "Other Card", employeeId: scanCrewId, replace: true });
    assert(officeReplace.response.ok && officeReplace.payload.linked, `office replace -> ${officeReplace.response.status} ${officeReplace.payload.error || ""}`);
    const oldCard = await scan(leadCookie, crewCard);
    assert(oldCard.payload.match === null, "the replaced licence still matches");

    const expired = await scan(leadCookie, { licenceNumber: visitorLicence, displayName: "Vera Visitor", idExpiry: "2020-01-01", asVisitor: true, personType: "subcontractor" });
    assert(expired.response.ok && expired.payload.visitor && expired.payload.warning, `expired visitor licence -> ${expired.response.status} warning=${expired.payload.warning}`);
    const visitorRow = (expired.payload.briefing?.rollCall || []).find((item) => item.id === expired.payload.visitor.rollCallId);
    assert(visitorRow?.personType === "subcontractor" && visitorRow.displayName === "Vera Visitor" && visitorRow.arrivedAt && visitorRow.checkInMethod === "scan", `visitor row -> ${JSON.stringify(visitorRow)}`);

    // A manual arrival keeps its reason.
    await fieldPost(leadCookie, `/api/field/jobs/${scanJobId}/briefing`, { rollCall: [{ employeeId: scanLeadId, leftAt: new Date().toISOString() }] });
    const manual = await fieldPost(leadCookie, `/api/field/jobs/${scanJobId}/briefing`, { rollCall: [{ employeeId: scanLeadId, arrivedAt: new Date().toISOString(), leftAt: "", checkInNote: "No licence on hand" }] });
    const manualRow = (manual.payload.rollCall || []).find((item) => item.employeeId === scanLeadId);
    assert(manualRow?.checkInMethod === "manual" && manualRow.checkInNote === "No licence on hand" && !manualRow.idLast4 && !manualRow.leftAt, `manual arrival -> ${JSON.stringify(manualRow)}`);

    // The roll call can't be forged through the raw collection route.
    const forged = await adminPost("jobSafetyBriefings", { ...manual.payload, rollCall: [{ id: "forged", employeeId: "", displayName: "Forged", checkInMethod: "scan", idLast4: "0000", arrivedAt: new Date().toISOString() }] });
    assert(forged.response.ok && !(forged.payload.rollCall || []).some((item) => item.id === "forged"), "a raw jobSafetyBriefings save replaced the roll call");

    // An office save of the employee (which never has licenceHash) keeps the link.
    const employeesNow = await adminGet("employees");
    const crewRecord = employeesNow.find((item) => item.id === scanCrewId);
    const saved = await adminPost("employees", { ...crewRecord, jobTitle: "Senior Technician", licenceHash: "forged" });
    seen.push(JSON.stringify(saved.payload));
    assert(saved.response.ok, `office saves the employee -> ${saved.response.status}`);
    const stillLinked = await scan(leadCookie, { licenceNumber: otherLicence, displayName: "Other Card" });
    assert(stillLinked.payload.match?.employeeId === scanCrewId, "an office save of the employee dropped (or let the payload set) the licence link");

    // Nothing that leaves the server carries a licence number or a licenceHash.
    for (const [cookie, url] of [[adminCookie, "/api/backend"], [adminCookie, "/api/backend/employees"], [leadCookie, "/api/backend"], [leadCookie, "/api/field/package"], [crewCookie, "/api/field/package"]]) {
      const response = await fetch(`${baseUrl}${url}`, { headers: { Cookie: cookie } });
      seen.push(await response.text());
    }
    const leaked = seen.find((text) => text.includes("licenceHash") || allNumbers.some((number) => text.includes(number)));
    assert(!leaked, `a response carried a licence number or licenceHash: ${String(leaked).slice(0, 160)}`);
  } finally {
    await fetch(`${baseUrl}/api/backend/dispatchJobs/${scanJobId}`, { method: "DELETE", headers: adminHeaders }).catch(() => {});
    for (const id of [scanLeadId, scanCrewId]) await fetch(`${baseUrl}/api/backend/employees/${id}`, { method: "DELETE", headers: adminHeaders }).catch(() => {});
  }
});

await step("Travel clock-in sent in lower case is stored as Travel", async () => {
  const employeeId = guardCrewId || leadEmployeeId;
  if (!employeeId) return "skip";
  const clockIn = await fieldPost(adminCookie, "/api/field/clock", { employeeId, entryType: "travel", action: "in" });
  if (clockIn.response.status === 409) return "skip"; // already clocked in with no job in this data set
  assert(clockIn.response.ok, `clock in -> ${clockIn.response.status} ${clockIn.payload.error || ""}`);
  assert(clockIn.payload.entryType === "Travel", `entryType stored as ${clockIn.payload.entryType} (want Travel)`);
  await fieldPost(adminCookie, "/api/field/clock", { employeeId, action: "out" });
});

// ---- 14. Phase 25 Wave F (2026-09-30): the job timer + work-plan task options ------------------
// A throwaway on-site job (lead + crew, both arrived and signed today's briefing), with a two-step plan:
// step 1 "Start work" (timer start), step 2 "Finish" (timer complete), plus tasks carrying delete on
// device / delete on server on their own throwaway jobs.
const timerJobId = `field-api-check-timer-${Date.now()}`;
let timerReady = false;
let timerLeadCookie = "";
async function makeTimerJob(id, { briefing = true, status = "on_site" } = {}) {
  const start = new Date();
  const created = await adminPost("dispatchJobs", {
    id, jobNumber: `CHECK-${id.slice(-6)}`, jobName: "field-api-check job timer", status, dispatchStatus: "On site",
    scheduledStart: start.toISOString(), scheduledEnd: new Date(start.getTime() + 8 * 3600 * 1000).toISOString(), fieldLeadEmployeeId: guardLeadId, completionPercent: 20,
  });
  const leadRow = await adminPost("jobAssignments", { id: `${id}-lead`, jobId: id, employeeId: guardLeadId, isFieldLead: true, status: "Assigned" });
  const crewRow = await adminPost("jobAssignments", { id: `${id}-crew`, jobId: id, employeeId: guardCrewId, isFieldLead: false, status: "Assigned" });
  if (!(created.response.ok && leadRow.response.ok && crewRow.response.ok)) return false;
  if (!briefing) return true;
  const at = new Date().toISOString();
  const arrived = await fieldPost(adminCookie, `/api/field/jobs/${id}/briefing`, { rollCall: [{ employeeId: guardLeadId, arrivedAt: at }, { employeeId: guardCrewId, arrivedAt: at }] });
  if (!arrived.response.ok) return false;
  for (const employeeId of [guardLeadId, guardCrewId]) {
    const ack = await fieldPost(adminCookie, `/api/field/jobs/${id}/briefing/acknowledge`, { employeeId });
    if (!ack.response.ok) return false;
  }
  return true;
}
const openEntriesOn = async (jobId) => (await adminGet("timeEntries")).filter((entry) => entry.dispatchJobId === jobId && !entry.endedAt && !entry.deletedAt);
if (guardLeadId && guardCrewId) {
  timerReady = await makeTimerJob(timerJobId);
  if (timerReady) {
    const step1 = await adminPost("jobSteps", { id: `${timerJobId}-s1`, jobId: timerJobId, key: "mobilize", name: "Mobilize", sequence: 1, status: "Available", required: true });
    const step2 = await adminPost("jobSteps", { id: `${timerJobId}-s2`, jobId: timerJobId, key: "work", name: "Work", sequence: 2, status: "Not started", required: true });
    const startAction = await adminPost("jobActions", { id: `${timerJobId}-a1`, jobId: timerJobId, stepId: `${timerJobId}-s1`, key: "start", name: "Start work", sequence: 1, type: "Checklist", status: "Available", required: true, assigneeScope: "Field Lead", timerAction: "start" });
    const finishAction = await adminPost("jobActions", { id: `${timerJobId}-a2`, jobId: timerJobId, stepId: `${timerJobId}-s2`, key: "finish", name: "Finish", sequence: 1, type: "Checklist", status: "Not started", required: true, assigneeScope: "Field Lead", timerAction: "complete" });
    timerReady = step1.response.ok && step2.response.ok && startAction.response.ok && finishAction.response.ok;
    if (timerReady) timerLeadCookie = await linkSession(guardLeadId, timerJobId);
  }
}

await step("job timer: stop refused before work starts; start refused without the briefing", async () => {
  if (!timerReady) return "skip";
  const stop = await fieldPost(timerLeadCookie, `/api/field/jobs/${timerJobId}/timer`, { action: "stop" });
  assert(stop.response.status === 409 && stop.payload.blocked, `stop from on_site -> ${stop.response.status} (want 409 blocked)`);
  const bad = await fieldPost(timerLeadCookie, `/api/field/jobs/${timerJobId}/timer`, { action: "pause" });
  assert(bad.response.status === 400, `unknown timer action -> ${bad.response.status} (want 400)`);
  const bareJobId = `${timerJobId}-bare`;
  if (!(await makeTimerJob(bareJobId, { briefing: false }))) return "skip";
  const gated = await fieldPost(adminCookie, `/api/field/jobs/${bareJobId}/timer`, { action: "start" });
  assert(gated.response.status === 409 && gated.payload.blocked && /briefing/i.test(gated.payload.error || ""), `start with no briefing -> ${gated.response.status} ${gated.payload.error || ""} (want 409, briefing)`);
  assert((await openEntriesOn(bareJobId)).length === 0, "a refused start still clocked someone in");
  await fetch(`${baseUrl}/api/backend/dispatchJobs/${bareJobId}`, { method: "DELETE", headers: adminHeaders }).catch(() => {});
});

await step("job timer: start clocks in everyone on site; replay is idempotent; a second start opens nothing", async () => {
  if (!timerReady) return "skip";
  const commandId = `fac-timer-${Date.now()}`;
  const send = () =>
    fetch(`${baseUrl}/api/field/jobs/${timerJobId}/timer`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: timerLeadCookie, "X-Client-Command-Id": commandId }, body: JSON.stringify({ action: "start", actionId: `${timerJobId}-a1` }) }).then(async (response) => ({ response, payload: await j(response) }));
  const first = await send();
  assert(first.response.ok && first.payload.job?.status === "in_progress", `start -> ${first.response.status} ${first.payload.error || first.payload.job?.status}`);
  assert(first.payload.opened.length === 2 && first.payload.opened.every((entry) => entry.entryType === "Work" && entry.source === "job-timer"), `start opened ${first.payload.opened?.length} entries (want 2 Work entries)`);
  const replay = await send();
  assert(replay.response.ok && replay.payload.statusEvent?.id === first.payload.statusEvent?.id, "replaying the same command id did not return the original response");
  assert((await openEntriesOn(timerJobId)).length === 2, "the replay opened more entries");
  const again = await fieldPost(timerLeadCookie, `/api/field/jobs/${timerJobId}/timer`, { action: "start" });
  assert(again.response.ok && again.payload.statusChanged === false && again.payload.opened.length === 0, `second start -> ${again.response.status} statusChanged=${again.payload.statusChanged} opened=${again.payload.opened?.length}`);
  const events = (await adminGet("jobStatusEvents")).filter((event) => event.jobId === timerJobId && event.toStatus === "in_progress");
  assert(events.length === 1 && events[0].timerAction === "start", `want one in_progress status event from the timer, got ${events.length}`);
});

await step("job timer: stop -> on hold and clocked out; resume -> clocked back in; complete -> field complete, nothing open", async () => {
  if (!timerReady) return "skip";
  const stop = await fieldPost(timerLeadCookie, `/api/field/jobs/${timerJobId}/timer`, { action: "stop" });
  assert(stop.response.ok && stop.payload.job?.status === "on_hold" && stop.payload.job?.dispatchStatus === "On hold", `stop -> ${stop.response.status} ${stop.payload.error || stop.payload.job?.status}`);
  assert(stop.payload.closed.length === 2 && (await openEntriesOn(timerJobId)).length === 0, "stop did not close both work entries");
  const advanceFromHold = await fieldPost(adminCookie, `/api/field/jobs/${timerJobId}/advance`, { toStatus: "field_complete" });
  assert(advanceFromHold.response.status === 409, `advance on_hold -> field_complete skipped the ladder (${advanceFromHold.response.status})`);
  const resume = await fieldPost(timerLeadCookie, `/api/field/jobs/${timerJobId}/timer`, { action: "start" });
  assert(resume.response.ok && resume.payload.job?.status === "in_progress" && resume.payload.opened.length === 2, `resume -> ${resume.response.status} ${resume.payload.error || ""} opened=${resume.payload.opened?.length}`);
  // Complete is refused while the plan is open, unless the task performing it is the plan's "complete" task.
  const early = await fieldPost(timerLeadCookie, `/api/field/jobs/${timerJobId}/timer`, { action: "complete" });
  assert(early.response.status === 409 && /step/.test(early.payload.error || ""), `complete with open steps and no task -> ${early.response.status} ${early.payload.error || ""}`);
  const done = await fieldPost(timerLeadCookie, `/api/field/jobs/${timerJobId}/timer`, { action: "complete", actionId: `${timerJobId}-a2` });
  assert(done.response.ok && done.payload.job?.status === "field_complete", `complete -> ${done.response.status} ${done.payload.error || done.payload.job?.status}`);
  assert((await openEntriesOn(timerJobId)).length === 0, "complete left an open time entry on the job");
  const holdEvent = (await adminGet("jobStatusEvents")).find((event) => event.jobId === timerJobId && event.toStatus === "on_hold");
  assert(holdEvent?.timerAction === "stop", "no on_hold status event recorded for the stop");
});

await step("task options: a field save can't set them; delete on device drops the job from field packages only", async () => {
  if (!timerReady) return "skip";
  // A field session can't switch on "Delete on server" (or any option) through a plain jobActions save.
  const actions = await adminGet("jobActions");
  const finish = actions.find((item) => item.id === `${timerJobId}-a2`);
  const sneaky = await fetch(`${baseUrl}/api/backend/jobActions`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: timerLeadCookie }, body: JSON.stringify({ ...finish, deleteOnServer: true, timerAction: "none" }) });
  const sneakyBody = await j(sneaky);
  assert(sneaky.ok && !sneakyBody.deleteOnServer && sneakyBody.timerAction === "complete", `field jobActions save changed task options (deleteOnServer=${sneakyBody.deleteOnServer}, timerAction=${sneakyBody.timerAction})`);
  // Delete on device: once the task is Complete, the job leaves the field package; the office keeps it.
  const deviceJobId = `${timerJobId}-device`;
  if (!(await makeTimerJob(deviceJobId, { briefing: false }))) return "skip";
  const deviceAction = await adminPost("jobActions", { id: `${deviceJobId}-a1`, jobId: deviceJobId, stepId: "", key: "cancel", name: "Cancel job", sequence: 1, type: "Checklist", status: "Available", required: true, assigneeScope: "Field Lead", deleteOnDevice: true });
  assert(deviceAction.response.ok, `create delete-on-device task -> ${deviceAction.response.status}`);
  const leadCookie = await linkSession(guardLeadId, deviceJobId);
  const before = await (await fetch(`${baseUrl}/api/field/package`, { headers: { Cookie: leadCookie } })).json();
  assert(before.dispatchJobs.some((job) => job.id === deviceJobId), "the job is missing from the package before the task");
  const performed = await fetch(`${baseUrl}/api/backend/jobActions`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: leadCookie }, body: JSON.stringify({ ...deviceAction.payload, status: "Complete" }) });
  assert(performed.ok, `field marks the task done -> ${performed.status}`);
  const after = await (await fetch(`${baseUrl}/api/field/package`, { headers: { Cookie: leadCookie } })).json();
  assert(!after.dispatchJobs.some((job) => job.id === deviceJobId) && !after.jobActions.some((item) => item.jobId === deviceJobId), "the job (or its tasks) is still in the field package after Delete on device");
  const officeJobs = await adminGet("dispatchJobs");
  assert(officeJobs.some((job) => job.id === deviceJobId && !job.deletedAt), "Delete on device removed the job from the office");
  // Commands for the removed job still work (a queued write replaying after the removal).
  const clock = await fieldPost(leadCookie, "/api/field/clock", { employeeId: guardLeadId, dispatchJobId: deviceJobId, action: "in" });
  assert(clock.response.ok, `a command for the removed job was refused -> ${clock.response.status} ${clock.payload.error || ""}`);
  await fieldPost(leadCookie, "/api/field/clock", { employeeId: guardLeadId, dispatchJobId: deviceJobId, action: "out" });
  await fetch(`${baseUrl}/api/backend/dispatchJobs/${deviceJobId}`, { method: "DELETE", headers: adminHeaders }).catch(() => {});
});

await step("delete on server: archived (soft-deleted via the task), refused until performed, restorable", async () => {
  if (!timerReady) return "skip";
  const serverJobId = `${timerJobId}-server`;
  if (!(await makeTimerJob(serverJobId, { briefing: false }))) return "skip";
  const created = await adminPost("jobActions", { id: `${serverJobId}-a1`, jobId: serverJobId, stepId: "", key: "archive", name: "Close out and archive", sequence: 1, type: "Checklist", status: "Available", required: true, assigneeScope: "Field Lead", deleteOnServer: true });
  assert(created.response.ok && created.payload.deleteOnServer === true, `office sets Delete on server on a task -> ${created.response.status} ${created.payload.error || ""}`);
  const leadCookie = await linkSession(guardLeadId, serverJobId);
  const archivePath = `/api/field/jobs/${serverJobId}/actions/${serverJobId}-a1/archive`;
  const early = await fieldPost(leadCookie, archivePath, {});
  assert(early.response.status === 409, `archive before the task is performed -> ${early.response.status} (want 409)`);
  await fetch(`${baseUrl}/api/backend/jobActions`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: leadCookie }, body: JSON.stringify({ ...created.payload, status: "Complete" }) });
  const archived = await fieldPost(leadCookie, archivePath, {});
  assert(archived.response.ok && archived.payload.archived, `archive -> ${archived.response.status} ${archived.payload.error || ""}`);
  const again = await fieldPost(leadCookie, archivePath, {});
  assert(again.response.ok && again.payload.already, `archive twice -> ${again.response.status} (want 200, already)`);
  const job = (await adminGet("dispatchJobs")).find((item) => item.id === serverJobId);
  assert(job?.deletedAt && job.deletedVia === `job-action:${serverJobId}-a1`, `job deletedVia = ${job?.deletedVia} (want job-action:<id>)`);
  const assignment = (await adminGet("jobAssignments")).find((item) => item.id === `${serverJobId}-lead`);
  assert(assignment?.deletedAt && assignment.deletedVia === `dispatchJobs:${serverJobId}`, "the job's cascade was not soft-deleted with it");
  const restore = await fetch(`${baseUrl}/api/backend/dispatchJobs/${serverJobId}/restore`, { method: "POST", headers: adminHeaders, body: "{}" });
  const restored = await j(restore);
  assert(restore.ok && restored.total >= 3, `restore -> ${restore.status} total=${restored.total}`);
  const back = (await adminGet("dispatchJobs")).find((item) => item.id === serverJobId);
  assert(back && !back.deletedAt, "the archived job did not come back on Restore");
  await fetch(`${baseUrl}/api/backend/dispatchJobs/${serverJobId}`, { method: "DELETE", headers: adminHeaders }).catch(() => {});
});

if (timerReady) await fetch(`${baseUrl}/api/backend/dispatchJobs/${timerJobId}`, { method: "DELETE", headers: adminHeaders }).catch(() => {});

console.log("");
const failed = results.filter((item) => item.status === "FAIL").length;
const skipped = results.filter((item) => item.status === "SKIP").length;
console.log(`${failed ? "FAILED" : "PASSED"}: ${results.length - failed - skipped} passed, ${skipped} skipped, ${failed} failed.`);
process.exit(failed ? 1 : 0);
