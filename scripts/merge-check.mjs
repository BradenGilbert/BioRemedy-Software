// Merge tools contract check (Phase 25 D.4, 2026-09-29). Exercises POST /api/admin/merge-facility,
// /api/admin/merge-location and /api/admin/attach-locations against a RUNNING scratch server: the
// role gate (403 for a non-office role), the dry-run counts matching what the merge then moved,
// duplicate link rows, the soft-deleted loser with mergedIntoId, idempotence, the refusals, and that
// Restore still brings the loser back. It builds its own records and deletes them at the end, so it
// runs the same on a fresh data folder and a live-shaped copy. scripts/smoke.mjs runs it.
//
//   node scripts/merge-check.mjs [--url http://localhost:4199] [--password <break-glass>]

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
    report(outcome === "skip" ? "SKIP" : "PASS", label);
  } catch (error) {
    report("FAIL", label, error.message || String(error));
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const cookieOf = (response) => (response.headers.get("set-cookie") || "").split(";")[0];
const j = (response) => response.json().catch(() => ({}));

const login = await fetch(`${baseUrl}/api/auth/break-glass`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
if (!login.ok) {
  console.error(`break-glass sign-in failed: ${login.status}`);
  process.exit(1);
}
const adminHeaders = { "Content-Type": "application/json", Cookie: cookieOf(login), "X-CRM-User": "merge-check" };

async function call(method, path, body, headers = adminHeaders) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, payload: await j(response) };
}
async function save(collection, record) {
  const { status, payload } = await call("POST", `/api/backend/${collection}`, record);
  assert(status === 200, `save ${collection} -> ${status} ${payload.error || ""}`);
  return payload;
}
async function rows(collection) {
  const { status, payload } = await call("GET", `/api/backend/${collection}`);
  assert(status === 200, `GET ${collection} -> ${status}`);
  return payload;
}
const byId = async (collection, id) => (await rows(collection)).find((row) => row.id === id);

const tag = `mc-${Date.now().toString(36)}`;
const ids = {
  account: `${tag}-acct`,
  ownerAccount: `${tag}-owner`,
  contact: `${tag}-contact`,
  loser: `${tag}-fac-dup`,
  survivor: `${tag}-fac-keep`,
  project: `${tag}-proj`,
  location: `${tag}-loc-a`,
  location2: `${tag}-loc-b`,
  location3: `${tag}-loc-c`,
  activity: `${tag}-act`,
};

// ---- setup ----------------------------------------------------------------------------------
await save("accounts", { id: ids.account, name: `Merge check ${tag}`, classification: "Prospect" });
await save("accounts", { id: ids.ownerAccount, name: `Merge check owner ${tag}`, classification: "Prospect" });
await save("contacts", { id: ids.contact, accountId: ids.account, name: "Merge Check Contact", fullName: "Merge Check Contact" });
await save("facilities", { id: ids.loser, accountId: ids.account, name: "Merge check site (duplicate)", street1: "2300 Greenlawn Blvd", city: "Round Rock" });
await save("facilities", { id: ids.survivor, accountId: ids.account, name: "Merge check site", street1: "2300 Greenlawn Blvd", city: "Round Rock" });
await save("facilityContacts", { id: `${tag}-fc-1`, facilityId: ids.loser, contactId: ids.contact, relationshipRole: "Works At" });
await save("facilityContacts", { id: `${tag}-fc-2`, facilityId: ids.survivor, contactId: ids.contact, relationshipRole: "Works At" });
await save("facilityComments", { id: `${tag}-note`, facilityId: ids.loser, body: "Gate code 1234", authorName: "merge-check" });
await save("facilityParties", { id: `${tag}-party-1`, facilityId: ids.loser, accountId: ids.ownerAccount, role: "Owner" });
await save("facilityParties", { id: `${tag}-party-2`, facilityId: ids.survivor, accountId: ids.ownerAccount, role: "Owner" });
await save("projects", { id: ids.project, accountId: ids.account, facilityId: ids.loser, siteLocationId: ids.location, name: `Merge check project ${tag}`, hiredByAccountId: ids.account });
await save("locations", { id: ids.location, accountId: ids.account, facilityId: ids.loser, label: "Merge check point A", latitude: 30.5449, longitude: -97.6939 });
await save("locations", { id: ids.location2, accountId: ids.account, label: "Merge check point B", latitude: 30.54491, longitude: -97.69391 });
await save("locations", { id: ids.location3, accountId: ids.account, label: "Merge check point C (unlinked check-in)", latitude: 30.5450, longitude: -97.6940, locationType: "Check-in" });
await save("activities", { id: ids.activity, accountId: ids.account, subject: "Merge check note", activityType: "Note", relatedRecords: [{ type: "facility", id: ids.loser }, { type: "facility", id: ids.survivor }] });

// A non-office role for the 403 checks.
const schedulerId = `${tag}-scheduler`;
let schedulerHeaders = null;
{
  const user = await call("POST", "/api/backend/systemUsers", { id: schedulerId, fullName: "Merge Check Scheduler", username: `${tag}-scheduler`, internalEmailAddress: `${tag}-scheduler@example.invalid`, role: "Scheduler", roles: ["Scheduler"], employeeId: "", isDisabled: false });
  if (user.status === 200) {
    await call("POST", "/api/auth/password", { userId: schedulerId, password: `${tag}-pw-1` });
    const signIn = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: `${tag}-scheduler`, password: `${tag}-pw-1` }) });
    if (signIn.ok) schedulerHeaders = { "Content-Type": "application/json", Cookie: cookieOf(signIn) };
  }
}

// ---- checks ---------------------------------------------------------------------------------
await step("non-office role gets 403 from every merge command", async () => {
  assert(schedulerHeaders, "could not sign in the Scheduler test user");
  for (const path of ["/api/admin/merge-facility?dryRun=1", "/api/admin/merge-facility", "/api/admin/merge-location", "/api/admin/attach-locations"]) {
    const { status } = await call("POST", path, { fromId: ids.loser, intoId: ids.survivor, facilityId: ids.survivor, locationIds: [ids.location3] }, schedulerHeaders);
    assert(status === 403, `${path} as Scheduler -> ${status} (want 403)`);
  }
});

await step("merge refuses the same record and a missing one", async () => {
  const same = await call("POST", "/api/admin/merge-facility?dryRun=1", { fromId: ids.survivor, intoId: ids.survivor });
  assert(same.status === 400, `same id -> ${same.status} (want 400)`);
  const missing = await call("POST", "/api/admin/merge-facility?dryRun=1", { fromId: `${tag}-nope`, intoId: ids.survivor });
  assert(missing.status === 404, `missing id -> ${missing.status} (want 404)`);
});

let preview = null;
await step("dry run counts every reference and changes nothing", async () => {
  const { status, payload } = await call("POST", "/api/admin/merge-facility?dryRun=1", { fromId: ids.loser, intoId: ids.survivor });
  assert(status === 200, `dry run -> ${status} ${payload.error || ""}`);
  preview = payload;
  const want = { facilityContacts: 1, facilityComments: 1, facilityParties: 1, projects: 1, locations: 1, activities: 1 };
  for (const [collection, count] of Object.entries(want)) assert(payload.counts?.[collection] === count, `${collection}: ${payload.counts?.[collection]} (want ${count})`);
  assert(payload.duplicates?.facilityContacts === 1 && payload.duplicates?.facilityParties === 1, `duplicates ${JSON.stringify(payload.duplicates)}`);
  const loser = await byId("facilities", ids.loser);
  assert(loser && !loser.deletedAt, "dry run deleted the facility");
  assert((await byId("projects", ids.project)).facilityId === ids.loser, "dry run moved the project");
});

await step("merge moves exactly what the preview counted; loser soft-deleted with mergedIntoId", async () => {
  const beforeProject = await byId("projects", ids.project);
  const { status, payload } = await call("POST", "/api/admin/merge-facility", { fromId: ids.loser, intoId: ids.survivor });
  assert(status === 200 && payload.merged, `merge -> ${status} ${payload.error || ""}`);
  assert(JSON.stringify(payload.counts) === JSON.stringify(preview.counts), `counts ${JSON.stringify(payload.counts)} != preview ${JSON.stringify(preview.counts)}`);
  const loser = await byId("facilities", ids.loser);
  assert(loser.deletedAt && loser.mergedIntoId === ids.survivor, "loser not soft-deleted with mergedIntoId");
  const project = await byId("projects", ids.project);
  assert(project.facilityId === ids.survivor, "project not repointed");
  assert(Number(project.version) > Number(beforeProject.version), "project version not bumped");
  assert((await byId("locations", ids.location)).facilityId === ids.survivor, "location not repointed");
  assert((await byId("facilityComments", `${tag}-note`)).facilityId === ids.survivor, "site note not repointed");
  const activity = await byId("activities", ids.activity);
  assert(activity.relatedRecords.filter((item) => item.type === "facility").length === 1 && activity.relatedRecords.some((item) => item.id === ids.survivor), `activity regarding ${JSON.stringify(activity.relatedRecords)}`);
  const movedContact = await byId("facilityContacts", `${tag}-fc-1`);
  assert(movedContact.facilityId === ids.survivor && movedContact.deletedAt, "duplicate facility contact should be repointed and soft-deleted");
  const movedParty = await byId("facilityParties", `${tag}-party-1`);
  assert(movedParty.facilityId === ids.survivor && movedParty.deletedAt, "duplicate party should be repointed and soft-deleted");
  const everything = (await call("GET", "/api/backend")).payload;
  const stillPointing = Object.entries(everything).flatMap(([collection, list]) => (Array.isArray(list) ? list.filter((row) => row && row.facilityId === ids.loser).map(() => collection) : []));
  assert(!stillPointing.length, `rows still point at the loser: ${stillPointing.join(", ")}`);
});

await step("running the same merge again is a no-op (alreadyMerged)", async () => {
  const { status, payload } = await call("POST", "/api/admin/merge-facility", { fromId: ids.loser, intoId: ids.survivor });
  assert(status === 200 && payload.alreadyMerged && payload.total === 0, `repeat -> ${status} ${JSON.stringify(payload)}`);
});

await step("merging into a deleted facility is refused", async () => {
  const { status } = await call("POST", "/api/admin/merge-facility?dryRun=1", { fromId: ids.survivor, intoId: ids.loser });
  assert(status === 409, `into deleted -> ${status} (want 409)`);
});

await step("Restore brings the merged facility back; references stay on the survivor", async () => {
  const { status, payload } = await call("POST", `/api/backend/facilities/${ids.loser}/restore`, {});
  assert(status === 200 && payload.total === 1, `restore -> ${status} ${JSON.stringify(payload)}`);
  assert(!(await byId("facilities", ids.loser)).deletedAt, "loser still deleted after restore");
  assert((await byId("projects", ids.project)).facilityId === ids.survivor, "restore moved the project back");
});

await step("merge location: siteLocationId repointed, loser soft-deleted", async () => {
  const dry = await call("POST", "/api/admin/merge-location?dryRun=1", { fromId: ids.location, intoId: ids.location2 });
  assert(dry.status === 200 && dry.payload.counts?.projects === 1, `dry run ${dry.status} ${JSON.stringify(dry.payload)}`);
  const { status, payload } = await call("POST", "/api/admin/merge-location", { fromId: ids.location, intoId: ids.location2 });
  assert(status === 200 && payload.merged, `merge -> ${status} ${payload.error || ""}`);
  assert((await byId("projects", ids.project)).siteLocationId === ids.location2, "project.siteLocationId not repointed");
  const loser = await byId("locations", ids.location);
  assert(loser.deletedAt && loser.mergedIntoId === ids.location2, "location loser not soft-deleted with mergedIntoId");
});

await step("attach GPS points to a facility", async () => {
  const { status, payload } = await call("POST", "/api/admin/attach-locations", { facilityId: ids.survivor, locationIds: [ids.location3, ids.location2] });
  assert(status === 200 && payload.attached === 2, `attach -> ${status} ${JSON.stringify(payload)}`);
  assert((await byId("locations", ids.location3)).facilityId === ids.survivor, "check-in point not attached");
  const again = await call("POST", "/api/admin/attach-locations", { facilityId: ids.survivor, locationIds: [ids.location3] });
  assert(again.status === 200 && again.payload.attached === 0 && again.payload.unchanged === 1, `repeat attach ${JSON.stringify(again.payload)}`);
});

// ---- cleanup (soft delete; the account cascade takes facilities, parties, projects) -------------
for (const [collection, id] of [["accounts", ids.account], ["accounts", ids.ownerAccount], ["contacts", ids.contact], ["activities", ids.activity], ["locations", ids.location2], ["locations", ids.location3], ["systemUsers", schedulerId]]) {
  await call("DELETE", `/api/backend/${collection}/${id}`).catch(() => {});
}

console.log("");
const failed = results.filter((item) => item.status === "FAIL").length;
const skipped = results.filter((item) => item.status === "SKIP").length;
console.log(`${failed ? "FAILED" : "PASSED"}: ${results.length - failed - skipped} passed, ${skipped} skipped, ${failed} failed.`);
process.exit(failed ? 1 : 0);
