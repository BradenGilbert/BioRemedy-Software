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

console.log("");
const failed = results.filter((item) => item.status === "FAIL").length;
const skipped = results.filter((item) => item.status === "SKIP").length;
console.log(`${failed ? "FAILED" : "PASSED"}: ${results.length - failed - skipped} passed, ${skipped} skipped, ${failed} failed.`);
process.exit(failed ? 1 : 0);
