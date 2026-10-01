// Referential-integrity report and clean-up for the JSON backend (Phase 20 item 5, 2026-09-23).
//
//   node scripts/clean-orphans.mjs                      report only, against data/backend.json
//   node scripts/clean-orphans.mjs --data <dir>         report against another data folder
//   node scripts/clean-orphans.mjs --apply [--url URL]  apply the policy below through the running server
//   node scripts/clean-orphans.mjs --apply --july-drafts   also soft-delete the July 2026 demo draft jobs
//
// An ORPHAN is a live row whose foreign key names a parent that does not exist at all. A live row that
// points at a soft-deleted parent is not an orphan: contacts, activities, tasks and samples are kept on
// purpose when their account is deleted (they are history), and find* on the client still resolves the
// deleted id. Those are listed separately, for information.
//
// Policy when applying (the phase doc's recommendation, 2026-09-23):
//   1. A missing ACCOUNT is recreated from the name its children carry (`customerName` on dispatch jobs
//      and job requests, else the first facility's name) -- those are probably real prospects, and their
//      facilities, opportunities and addresses re-attach to it automatically.
//   2. Everything hanging off a missing PROJECT (dispatch jobs, job requests, invoices, alerts...) is
//      soft-deleted through the server's cascade, so it can be restored if anyone recognises it.
//   3. A dangling LINK row (a stakeholder, a facility contact, an industry link, an assignment whose
//      person is gone) is soft-deleted.
//   4. A dangling OPTIONAL reference (an opportunity's facility, a project's quote) is blanked.
//   5. Anything else is reported, not touched.

import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const dataDir = resolve(option("--data", process.env.CRM_DATA_DIR || join(projectRoot, "data")));
const baseUrl = option("--url", process.env.CRM_URL || "http://localhost:4173");
const apply = flag("--apply");
const julyDrafts = flag("--july-drafts");

// Foreign-key field -> parent collection. Only unambiguous, id-valued keys.
const parents = {
  accountId: "accounts",
  vendorAccountId: "accounts",
  subcontractorAccountId: "accounts",
  projectId: "projects",
  opportunityId: "opportunities",
  facilityId: "facilities",
  contactId: "contacts",
  dispatchJobId: "dispatchJobs",
  jobId: "dispatchJobs",
  jobRequestId: "jobRequests",
  employeeId: "employees",
  quoteId: "quotes",
  estimateId: "estimates",
  invoiceId: "invoices",
  inventoryItemId: "inventoryItems",
  actionId: "jobActions",
  stepId: "jobSteps",
  assignmentId: "jobAssignments",
  vendorProfileId: "vendorProfiles",
  productId: "products",
  // Phase 21 (Front Line 2, 2026-09-25): siteWalkReports/siteWalkObservations key off the schedule
  // event (walkEventId), not an opportunity/facility id directly; libraryAcknowledgements off the
  // library item it acknowledges.
  walkEventId: "scheduleEvents",
  libraryItemId: "libraryItems",
  // Phase 25 D (2026-09-29): who hired us for a project/dispatch job, and the GPS-point links the
  // location merge tool repoints.
  hiredByAccountId: "accounts",
  locationId: "locations",
  siteLocationId: "locations",
  anchorLocationId: "locations",
  // 2026-10-01: usage rows a job action form wrote (jobResources, jobEquipmentUsage, wasteRecords,
  // jobVendorUsage, inventoryAlerts) name the submission they came from.
  formSubmissionId: "jobFormSubmissions",
};
// Link rows: a dangling one carries no history worth keeping.
const linkCollections = new Set([
  "opportunityContacts",
  "opportunityLocations",
  "opportunityAssignments",
  "facilityContacts",
  "facilityParties",
  "accountIndustries",
  "accountApprovedSubcontractors",
  "jobAssignments",
  "employeeCertifications",
  "workforceTeamMemberships",
]);
// Optional references: blank the field, keep the row.
const optionalReferences = {
  opportunities: new Set(["facilityId", "quoteId", "estimateId"]),
  projects: new Set(["facilityId", "opportunityId", "quoteId", "estimateId"]),
  sampleRecords: new Set(["facilityId", "actionId", "dispatchJobId"]),
  addresses: new Set(["contactId"]),
  jobRequests: new Set(["requestedEmployeeId"]),
  dispatchJobs: new Set(["jobRequestId"]),
  scheduleEvents: new Set(["facilityId", "opportunityId"]),
};

const data = JSON.parse(readFileSync(join(dataDir, "backend.json"), "utf8"));
const liveIds = {};
const deletedIds = {};
for (const [collection, rows] of Object.entries(data)) {
  if (!Array.isArray(rows)) continue;
  liveIds[collection] = new Set(rows.filter((row) => !row.deletedAt).map((row) => row.id));
  deletedIds[collection] = new Set(rows.filter((row) => row.deletedAt).map((row) => row.id));
}

const orphans = [];
const historyRefs = [];
for (const [collection, rows] of Object.entries(data)) {
  if (!Array.isArray(rows)) continue;
  for (const row of rows) {
    if (row.deletedAt) continue;
    for (const [key, parentCollection] of Object.entries(parents)) {
      const value = row[key];
      if (!value || typeof value !== "string" || !liveIds[parentCollection]) continue;
      if (liveIds[parentCollection].has(value)) continue;
      const entry = { collection, id: row.id, key, parentCollection, parentId: value, row };
      if (deletedIds[parentCollection]?.has(value)) historyRefs.push(entry);
      else orphans.push(entry);
    }
  }
}

// ---- Report -----------------------------------------------------------------------------------
function groupByParent(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const groupKey = `${entry.parentCollection}:${entry.parentId}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(entry);
  }
  return groups;
}
function describeGroup(group) {
  const counts = {};
  group.forEach((entry) => {
    counts[entry.collection] = (counts[entry.collection] || 0) + 1;
  });
  const names = [...new Set(group.map((entry) => entry.row.customerName || entry.row.projectName || "").filter(Boolean))];
  return `${Object.entries(counts).map(([c, n]) => `${n} ${c}`).join(", ")}${names.length ? `  [${names.join(" / ")}]` : ""}`;
}
console.log(`Referential integrity: ${orphans.length} orphan reference${orphans.length === 1 ? "" : "s"} in ${dataDir}`);
for (const [groupKey, group] of groupByParent(orphans)) console.log(`  ${groupKey} (missing): ${describeGroup(group)}`);
if (historyRefs.length) {
  console.log(`References to soft-deleted parents (kept on purpose, not orphans): ${historyRefs.length}`);
  for (const [groupKey, group] of groupByParent(historyRefs)) console.log(`  ${groupKey}: ${describeGroup(group)}`);
}
const julyDraftJobs = (data.dispatchJobs || []).filter((job) => !job.deletedAt && job.status === "draft" && String(job.scheduledStart || "").startsWith("2026-07"));
console.log(`July 2026 draft dispatch jobs (demo noise, B9): ${julyDraftJobs.length}${julyDrafts ? " -- will be soft-deleted" : " -- untouched unless --july-drafts"}`);
if (!apply) {
  if (orphans.length) console.log("\nRun again with --apply to fix them through the server (policy at the top of this file).");
  process.exit(0);
}

// ---- Apply through the API --------------------------------------------------------------------
// Phase 12a: the API needs a session. Sign in with the break-glass password (--password or CRM_PASSWORD).
const password = option("--password", process.env.CRM_PASSWORD || "");
if (!password) {
  console.error("--apply needs the break-glass password: pass --password <pw> or set CRM_PASSWORD (see data/break-glass-password.txt).");
  process.exit(1);
}
const loginResponse = await fetch(`${baseUrl}/api/auth/break-glass`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
if (!loginResponse.ok) {
  console.error(`✗ sign-in failed: ${loginResponse.status}`);
  process.exit(1);
}
const headers = { "Content-Type": "application/json", "X-CRM-User": "clean-orphans", Cookie: (loginResponse.headers.get("set-cookie") || "").split(";")[0] };
async function call(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${payload.error || ""}`);
  return payload;
}

const actions = { recreatedAccounts: 0, deleted: 0, blanked: 0, skipped: [] };
const deletedRoots = new Set();
async function softDelete(collection, id) {
  const key = `${collection}:${id}`;
  if (deletedRoots.has(key)) return;
  deletedRoots.add(key);
  try {
    const result = await call("DELETE", `/api/backend/${collection}/${encodeURIComponent(id)}`);
    actions.deleted += result.total || 1;
  } catch (error) {
    if (!/already deleted/.test(error.message)) throw error;
  }
}

// 1. missing accounts -> recreate from the children's customer name
const missingAccounts = new Map();
for (const orphan of orphans) {
  if (orphan.parentCollection !== "accounts" || orphan.key !== "accountId") continue;
  const info = missingAccounts.get(orphan.parentId) || { names: new Set(), facilityNames: new Set(), children: 0 };
  if (orphan.row.customerName) info.names.add(orphan.row.customerName.trim());
  if (orphan.collection === "facilities" && orphan.row.name) info.facilityNames.add(orphan.row.name.trim());
  info.children += 1;
  missingAccounts.set(orphan.parentId, info);
}
for (const [accountId, info] of missingAccounts) {
  const name = [...info.names][0] || (info.facilityNames.size ? `Recovered account for ${[...info.facilityNames][0]}` : `Recovered account ${accountId}`);
  const now = new Date().toISOString();
  await call("POST", "/api/backend/accounts", {
    id: accountId,
    name,
    accountName: name,
    accountType: "Customer",
    owner: "Unassigned",
    contact: "",
    email: "",
    phone: "",
    city: "",
    concern: "",
    createdBy: "clean-orphans",
    createdOn: now,
    lastContact: now.slice(0, 10),
    nextAction: "Review this recovered account",
    notes: `Recreated ${now.slice(0, 10)} by scripts/clean-orphans.mjs: ${info.children} record${info.children === 1 ? "" : "s"} referenced this account id but the account was gone.`,
  });
  actions.recreatedAccounts += 1;
  console.log(`  recreated account ${accountId} as "${name}" (${info.children} child records re-attached)`);
}

// 2. children of missing projects -> soft-delete (the cascade does the rest)
// 3. dangling link rows -> soft-delete
// 4. dangling optional references -> blank the field
const blanked = new Map();
for (const orphan of orphans) {
  if (orphan.parentCollection === "accounts" && missingAccounts.has(orphan.parentId)) continue;
  if (orphan.parentCollection === "projects" || linkCollections.has(orphan.collection)) {
    await softDelete(orphan.collection, orphan.id);
    continue;
  }
  if (optionalReferences[orphan.collection]?.has(orphan.key)) {
    const rowKey = `${orphan.collection}:${orphan.id}`;
    const patch = blanked.get(rowKey) || { collection: orphan.collection, row: { ...orphan.row } };
    patch.row[orphan.key] = "";
    blanked.set(rowKey, patch);
    continue;
  }
  actions.skipped.push(`${orphan.collection}/${orphan.id}.${orphan.key} -> ${orphan.parentCollection}/${orphan.parentId}`);
}
for (const { collection, row } of blanked.values()) {
  const { version, ...payload } = row;
  await call("POST", `/api/backend/${collection}`, payload);
  actions.blanked += 1;
}
if (julyDrafts) {
  for (const job of julyDraftJobs) await softDelete("dispatchJobs", job.id);
}

console.log(`\nApplied: ${actions.recreatedAccounts} account${actions.recreatedAccounts === 1 ? "" : "s"} recreated, ${actions.deleted} record${actions.deleted === 1 ? "" : "s"} soft-deleted (cascades included), ${actions.blanked} dangling reference${actions.blanked === 1 ? "" : "s"} blanked.`);
if (actions.skipped.length) {
  console.log(`Left for a person to decide (${actions.skipped.length}):`);
  actions.skipped.forEach((line) => console.log(`  ${line}`));
}
