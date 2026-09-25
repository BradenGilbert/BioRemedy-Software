// Runner: builds the set (modules run on import, in dependency order), converts photos, writes files.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync, copyFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { out, backend, referenceCollections, dataDir, photosDir, uploadsDir, dryRun, pythonExe, USER } from "./core.mjs";
import "./equipment.mjs";
import "./accounts.mjs";
import { photoManifest, fileManifest } from "./jobs.mjs";
import "./projects.mjs";
import "./extras.mjs";

const projectRoot = join(dataDir, "..");
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);

// ---- referential check before anything is written -------------------------------------------
const parents = { accountId: "accounts", vendorAccountId: "accounts", subcontractorAccountId: "accounts", projectId: "projects", opportunityId: "opportunities", facilityId: "facilities", contactId: "contacts", dispatchJobId: "dispatchJobs", jobId: "dispatchJobs", jobRequestId: "jobRequests", employeeId: "employees", quoteId: "quotes", estimateId: "estimates", invoiceId: "invoices", inventoryItemId: "inventoryItems", actionId: "jobActions", stepId: "jobSteps", assignmentId: "jobAssignments", vendorProfileId: "vendorProfiles", productId: "products" };
const ids = Object.fromEntries(Object.entries(out).filter(([, rows]) => Array.isArray(rows)).map(([k, rows]) => [k, new Set(rows.map((r) => r.id))]));
const orphans = [];
for (const [collection, rows] of Object.entries(out)) {
  if (!Array.isArray(rows)) continue;
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) orphans.push(`${collection}: duplicate id ${row.id}`);
    seen.add(row.id);
    for (const [key, parent] of Object.entries(parents)) {
      const value = row[key];
      if (value && typeof value === "string" && ids[parent] && !ids[parent].has(value)) orphans.push(`${collection}/${row.id}.${key} → ${parent}/${value}`);
    }
  }
}
if (orphans.length) {
  console.error("Referential problems in the generated set:\n  " + orphans.join("\n  "));
  process.exit(1);
}

// ---- photos: convert into a staging folder, then fill sizes and hashes -----------------------
const staging = join(dataDir, "uploads.rebuild");
mkdirSync(staging, { recursive: true });
const manifestFile = join(staging, "manifest.json");
const missing = photoManifest.filter((p) => !existsSync(join(photosDir, p.src)));
if (missing.length) {
  console.error("Photos not found:\n  " + missing.map((p) => p.src).join("\n  "));
  process.exit(1);
}
writeFileSync(manifestFile, JSON.stringify(photoManifest.map((p) => ({ src: join(photosDir, p.src), dest: join(staging, p.dest) }))));
const converter = `
import json, sys
from PIL import Image, ImageOps
import pillow_heif
pillow_heif.register_heif_opener()
items = json.load(open(sys.argv[1]))
for item in items:
    im = Image.open(item["src"])
    im = ImageOps.exif_transpose(im).convert("RGB")
    im.thumbnail((1600, 1600))
    im.save(item["dest"], "JPEG", quality=82, optimize=True)
print(len(items))
`;
const converterFile = join(staging, "convert.py");
writeFileSync(converterFile, converter);
const result = spawnSync(pythonExe, [converterFile, manifestFile], { encoding: "utf8" });
if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(1);
}
console.log(`Converted ${result.stdout.trim()} photos.`);
for (const item of fileManifest) {
  if (!existsSync(item.src)) { console.error(`File not found: ${item.src}`); process.exit(1); }
  copyFileSync(item.src, join(staging, item.dest));
}
const fileRows = [...out.documents, ...out.jobTaskAttachments, ...out.sampleLabReports, ...out.jobRequestDocuments];
for (const row of fileRows) {
  const file = join(staging, row.storageName);
  if (!existsSync(file)) continue;
  const bytes = readFileSync(file);
  row.sizeBytes = bytes.length;
  if ("sha256" in row) row.sha256 = createHash("sha256").update(bytes).digest("hex");
}

// ---- summary --------------------------------------------------------------------------------
const counts = Object.entries(out).filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => `${k} ${v.length}`);
console.log(counts.join(", "));
if (dryRun) {
  rmSync(staging, { recursive: true, force: true });
  console.log("Dry run: nothing written.");
  process.exit(0);
}

// ---- backup the current data folder, then swap ----------------------------------------------
const backupDir = join(dataDir, "backups", `pre-rebuild-${stamp}`);
mkdirSync(join(backupDir, "uploads"), { recursive: true });
copyFileSync(join(dataDir, "backend.json"), join(backupDir, "backend.json"));
if (existsSync(join(dataDir, "auth.json"))) copyFileSync(join(dataDir, "auth.json"), join(backupDir, "auth.json"));
if (existsSync(uploadsDir)) {
  for (const name of readdirSync(uploadsDir)) renameSync(join(uploadsDir, name), join(backupDir, "uploads", name));
} else {
  mkdirSync(uploadsDir, { recursive: true });
}
for (const name of readdirSync(staging)) {
  if (name !== "manifest.json" && name !== "convert.py") renameSync(join(staging, name), join(uploadsDir, name));
}
console.log(`Previous data backed up to ${backupDir}`);

// backend.json — keep the key order of the old file, then any new keys.
const ordered = {};
for (const key of Object.keys(backend)) ordered[key] = out[key];
for (const key of Object.keys(out)) if (!(key in ordered)) ordered[key] = out[key];
writeFileSync(join(dataDir, "backend.json"), `${JSON.stringify(ordered, null, 2)}\n`, "utf8");

// demo-seed.json — the generated sample set (everything except the reference catalog).
const seed = {};
for (const [key, rows] of Object.entries(ordered)) {
  if (!Array.isArray(rows) || !rows.length || referenceCollections.includes(key) || ["products", "productPriceLevels", "jobTypeTemplates"].includes(key)) continue;
  seed[key] = rows;
}
writeFileSync(join(projectRoot, "data", "demo-seed.json"), `${JSON.stringify(seed, null, 2)}\n`, "utf8");

// auth.json — sessions and credentials only for users that still exist.
const authFile = join(dataDir, "auth.json");
if (existsSync(authFile)) {
  const auth = JSON.parse(readFileSync(authFile, "utf8"));
  const userIds = new Set(out.systemUsers.map((u) => u.id));
  auth.sessions = (auth.sessions || []).filter((s) => !s.systemUserId || userIds.has(s.systemUserId));
  auth.credentials = (auth.credentials || []).filter((c) => userIds.has(c.systemUserId));
  writeFileSync(authFile, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
}
rmSync(staging, { recursive: true, force: true });
console.log(`Wrote ${join(dataDir, "backend.json")}, data/demo-seed.json and ${uploadsDir} (${readdirSync(uploadsDir).length} files).`);
