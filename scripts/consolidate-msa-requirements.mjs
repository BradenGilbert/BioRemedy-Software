// One-time clean-up for Phase 25 Wave E (2026-09-29, owner: "MSA once per account, with an expiry").
//
//   node scripts/consolidate-msa-requirements.mjs                       report only, against data/backend.json
//   node scripts/consolidate-msa-requirements.mjs --data <dir>          report against another data folder
//   node scripts/consolidate-msa-requirements.mjs --apply --url URL --password PW   apply through the running server
//
// Until Wave E the emergency intake filed the service-agreement-msa requirement on the project it was
// creating, so an account could collect one MSA request per spill call. The MSA now lives on the
// account. For each account with MSA requirements:
//   1. KEEP the best one: Approved/Waived and unexpired > In review > expired approval > Sent/Returned
//      > Not started > Rejected; newest first within a rank. If it sits on a project or opportunity it
//      is moved to the account (entityType "account", entityId = the account id).
//   2. SOFT-DELETE every other MSA requirement on that account that has no documents attached
//      (restorable from the server's soft-delete like any other record).
//   3. NEVER delete one that has a document attached -- those are listed for a person to review.
//
// Writes go through the API (the server's requirement guard, version stamping and audit log apply);
// the JSON is only read.

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

const data = JSON.parse(readFileSync(join(dataDir, "backend.json"), "utf8"));
const msaType = (data.documentTypes || []).find((type) => type.code === "service-agreement-msa" && !type.deletedAt);
if (!msaType) {
  console.log(`No service-agreement-msa document type in ${dataDir}; nothing to do.`);
  process.exit(0);
}

const accountName = (id) => (data.accounts || []).find((account) => account.id === id)?.name || id;
const recordName = (requirement) => {
  if (requirement.entityType === "project") return `project "${(data.projects || []).find((item) => item.id === requirement.entityId)?.name || requirement.entityId}"`;
  if (requirement.entityType === "opportunity") return `opportunity "${(data.opportunities || []).find((item) => item.id === requirement.entityId)?.opportunityName || requirement.entityId}"`;
  return "the account";
};
const hasDocuments = (requirement) => Boolean(requirement.currentDocumentId) || (requirement.documentIds || []).length > 0;
const isExpired = (requirement) => {
  if (requirement.status !== "Approved" || !requirement.expiresAt) return false;
  const value = String(requirement.expiresAt);
  const end = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59`) : new Date(value);
  return end < new Date();
};
const rank = (requirement) => {
  if ((requirement.status === "Approved" && !isExpired(requirement)) || requirement.status === "Waived") return 0;
  if (requirement.status === "In review") return 1;
  if (requirement.status === "Approved") return 2;
  if (requirement.status === "Sent" || requirement.status === "Returned") return 3;
  if (requirement.status === "Not started") return 4;
  return 5;
};
const newest = (requirement) => String(requirement.reviewedAt || requirement.returnedAt || requirement.updatedAt || requirement.createdAt || "");

const byAccount = new Map();
for (const requirement of data.documentRequirements || []) {
  if (requirement.deletedAt || requirement.documentTypeId !== msaType.id) continue;
  const key = requirement.accountId || "(no account)";
  if (!byAccount.has(key)) byAccount.set(key, []);
  byAccount.get(key).push(requirement);
}

const plan = { move: [], remove: [], manual: [], ok: 0 };
console.log(`MSA requirements in ${dataDir}: ${[...byAccount.values()].reduce((sum, rows) => sum + rows.length, 0)} on ${byAccount.size} account${byAccount.size === 1 ? "" : "s"}`);
for (const [accountId, rows] of byAccount) {
  if (accountId === "(no account)") {
    rows.forEach((requirement) => plan.manual.push({ requirement, reason: "no account on the requirement" }));
    console.log(`  (no account): ${rows.length} requirement(s) -- left for manual review`);
    continue;
  }
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || newest(b).localeCompare(newest(a)));
  const [keep, ...rest] = sorted;
  const needsMove = keep.entityType !== "account" || keep.entityId !== accountId;
  console.log(`  ${accountName(accountId)}: keep ${keep.id} (${keep.status}${keep.expiresAt ? `, expires ${String(keep.expiresAt).slice(0, 10)}` : ""}) on ${recordName(keep)}${needsMove ? " -> move to the account" : ""}`);
  if (needsMove) plan.move.push(keep);
  else plan.ok += 1;
  for (const requirement of rest) {
    if (hasDocuments(requirement)) {
      plan.manual.push({ requirement, reason: `has ${Math.max((requirement.documentIds || []).length, 1)} document(s) attached` });
      console.log(`      ! ${requirement.id} (${requirement.status}) on ${recordName(requirement)} has documents -- NOT deleted, review by hand`);
    } else {
      plan.remove.push(requirement);
      console.log(`      - ${requirement.id} (${requirement.status}) on ${recordName(requirement)} -- redundant, no documents: soft-delete`);
    }
  }
}
console.log(`\nPlan: ${plan.move.length} moved to the account, ${plan.remove.length} soft-deleted, ${plan.manual.length} left for manual review, ${plan.ok} already correct.`);
if (plan.manual.length) {
  console.log("Manual review (never deleted by this script):");
  plan.manual.forEach(({ requirement, reason }) => console.log(`  ${requirement.id} -- ${accountName(requirement.accountId)}, ${recordName(requirement)}, ${requirement.status}: ${reason}`));
}
if (!apply) {
  if (plan.move.length || plan.remove.length) console.log("\nDry run. Run again with --apply --url <server> --password <break-glass password> to make these changes through the API.");
  process.exit(0);
}

// ---- Apply through the API --------------------------------------------------------------------
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
const headers = { "Content-Type": "application/json", "X-CRM-User": "consolidate-msa", Cookie: (loginResponse.headers.get("set-cookie") || "").split(";")[0] };
async function call(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${payload.error || ""}`);
  return payload;
}

// Re-read each row from the server so a record changed since the JSON was read is not overwritten.
const live = await call("GET", "/api/backend/documentRequirements");
const liveRows = Array.isArray(live) ? live : live.records || live.documentRequirements || [];
const current = (id) => liveRows.find((row) => row.id === id);
let moved = 0;
let removed = 0;
for (const requirement of plan.move) {
  const row = current(requirement.id) || requirement;
  if (row.deletedAt) continue;
  await call("POST", "/api/backend/documentRequirements", { ...row, entityType: "account", entityId: row.accountId, notes: [row.notes, `Moved to the account ${new Date().toISOString().slice(0, 10)} (MSA once per account).`].filter(Boolean).join(" ") });
  moved += 1;
}
for (const requirement of plan.remove) {
  const row = current(requirement.id);
  if (!row || row.deletedAt || hasDocuments(row)) continue;
  try {
    await call("DELETE", `/api/backend/documentRequirements/${encodeURIComponent(row.id)}`);
    removed += 1;
  } catch (error) {
    if (!/already deleted/.test(error.message)) throw error;
  }
}
console.log(`\nApplied: ${moved} moved to the account, ${removed} soft-deleted. ${plan.manual.length} left for manual review.`);
