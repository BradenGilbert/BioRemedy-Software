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

await step("Travel clock-in sent in lower case is stored as Travel", async () => {
  const employeeId = guardCrewId || leadEmployeeId;
  if (!employeeId) return "skip";
  const clockIn = await fieldPost(adminCookie, "/api/field/clock", { employeeId, entryType: "travel", action: "in" });
  if (clockIn.response.status === 409) return "skip"; // already clocked in with no job in this data set
  assert(clockIn.response.ok, `clock in -> ${clockIn.response.status} ${clockIn.payload.error || ""}`);
  assert(clockIn.payload.entryType === "Travel", `entryType stored as ${clockIn.payload.entryType} (want Travel)`);
  await fieldPost(adminCookie, "/api/field/clock", { employeeId, action: "out" });
});

console.log("");
const failed = results.filter((item) => item.status === "FAIL").length;
const skipped = results.filter((item) => item.status === "SKIP").length;
console.log(`${failed ? "FAILED" : "PASSED"}: ${results.length - failed - skipped} passed, ${skipped} skipped, ${failed} failed.`);
process.exit(failed ? 1 : 0);
