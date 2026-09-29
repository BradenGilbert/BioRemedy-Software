// Puts the training copy back to a fresh sample set dated today, and (re)starts it (Phase 24, 2026-09-28).
//
//   node scripts/reset-training.mjs [--port 4174] [--data data-training] [--source data]
//                                   [--today YYYY-MM-DD] [--tunnel] [--no-start]
//
// The training copy is this same server.mjs run with CRM_TRAINING=1 on its own port and data folder:
// hands-on tutorials happen there, never on live. Each run:
//   1. stops the training server -- only a process listening on --port whose command line is
//      server.mjs, and never on the live port 4173;
//   2. rebuilds <data>/backend.json from data/demo-seed.json (the generated sample set, see
//      docs/sample-data.md) plus the reference catalog read from the live folder (--source; read
//      only): rate sheet, price levels, units, job and form templates, document types, permits, the
//      library shelves. Live's activity -- IT messages, walks, GPS consents, tour progress -- is not
//      copied. Every date in the sample set is shifted so the seed's "today" is --today (default: the
//      real today), so My Day and Next 7 Days always have work on them;
//   3. copies the sample photos and files the seed references into <data>/uploads (once);
//   4. keeps <data>/auth.json, so passwords an Admin set for trainees survive the reset;
//   5. starts the server in the background with CRM_TRAINING=1 (password sign-in, no backups, the
//      TRAINING ribbon), unless --no-start;
//   6. with --tunnel, makes sure a Cloudflare quick tunnel points at the port and prints its address
//      to paste into live's Identity & Sync › Training copy.
//
// Nightly: a Windows scheduled task runs `node scripts/reset-training.mjs --tunnel` at 2 am (README).

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync, rmSync, openSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const LIVE_PORT = 4173;
const port = Number(option("--port", process.env.CRM_TRAINING_PORT || "4174"));
const dataDir = resolve(projectRoot, option("--data", "data-training"));
const sourceDir = resolve(projectRoot, option("--source", "data"));
const today = option("--today", localDate(new Date()));
const withTunnel = args.includes("--tunnel");
const noStart = args.includes("--no-start");

if (!Number.isInteger(port) || port <= 0 || port === LIVE_PORT) fail(`Refusing port ${port}: the training copy never runs on the live port ${LIVE_PORT}.`);
if (dataDir === resolve(projectRoot, "data") || dataDir === sourceDir) fail(`Refusing ${dataDir}: the training copy needs its own data folder, never the live one.`);
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) fail(`--today must be YYYY-MM-DD, got ${today}`);

// Collections copied from live as reference data. Everything else starts empty, then the sample set.
const REFERENCE_COLLECTIONS = [
  "accountTypes", "industries", "subcontractorTypes", "certificationTypes", "connectionRoles", "unitGroups",
  "unitsOfMeasure", "transactionCurrencies", "priceLevels", "pricingSettings", "documentTypes", "businessUnits",
  "teams", "permits", "standbyRotationSettings", "products", "productPriceLevels", "jobTypeTemplates",
  "formTemplates", "jurisdictions", "libraryItems", "ergMaterials", "ergGuides", "ergDistances",
];
const FILE_COLLECTIONS = ["documents", "jobTaskAttachments", "sampleLabReports", "jobRequestDocuments"];

// ---- 1. stop the training server --------------------------------------------------------------
stopServerOnPort(port);

// ---- 2. rebuild backend.json ------------------------------------------------------------------
const liveFile = join(sourceDir, "backend.json");
const seedFile = join(projectRoot, "data", "demo-seed.json");
if (!existsSync(liveFile)) fail(`No ${liveFile} to read the reference catalog from.`);
if (!existsSync(seedFile)) fail(`No ${seedFile}; run scripts/rebuild-sample-data.mjs first.`);
const live = JSON.parse(readFileSync(liveFile, "utf8"));
const seed = JSON.parse(readFileSync(seedFile, "utf8"));
const seedToday = (readFileSync(join(projectRoot, "scripts", "rebuild", "core.mjs"), "utf8").match(/const TODAY = "(\d{4}-\d{2}-\d{2})"/) || [])[1];
if (!seedToday) fail("Could not read the sample set's TODAY from scripts/rebuild/core.mjs.");
const shiftDays = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${seedToday}T12:00:00Z`)) / 86400000);

const out = {};
for (const [key, value] of Object.entries(live)) out[key] = Array.isArray(value) ? [] : structuredClone(value);
for (const key of REFERENCE_COLLECTIONS) if (Array.isArray(live[key])) out[key] = structuredClone(live[key]);
out.qboSettings = { connectionStatus: "Not connected", realmId: "", lastExportAt: "" };
out.trainingSettings = { trainingUrl: "", updatedAt: "", updatedBy: "" };
for (const [key, rows] of Object.entries(seed)) {
  if (!Array.isArray(rows)) continue;
  out[key] = shiftDates(structuredClone(rows), shiftDays, key);
}
// Library items that point at an uploaded file: bring that document row (and, below, its file).
const seededDocumentIds = new Set((out.documents || []).map((row) => row.id));
const libraryDocumentIds = new Set((out.libraryItems || []).map((item) => item.documentId).filter(Boolean));
for (const row of live.documents || []) {
  if (libraryDocumentIds.has(row.id) && !seededDocumentIds.has(row.id) && !row.deletedAt) (out.documents ||= []).push(structuredClone(row));
}

mkdirSync(dataDir, { recursive: true });
const dataFile = join(dataDir, "backend.json");
writeFileSync(`${dataFile}.tmp`, `${JSON.stringify(out, null, 2)}\n`, "utf8");
renameSync(`${dataFile}.tmp`, dataFile);
// Command receipts point at records that no longer exist; start clean.
rmSync(join(dataDir, "command-receipts.json"), { force: true });

// ---- 3. sample files ----------------------------------------------------------------------------
const uploadsDir = join(dataDir, "uploads");
mkdirSync(uploadsDir, { recursive: true });
let copied = 0;
let missingFiles = 0;
for (const key of FILE_COLLECTIONS) {
  for (const row of out[key] || []) {
    if (!row.storageName) continue;
    const target = join(uploadsDir, row.storageName);
    if (existsSync(target)) continue;
    const from = join(sourceDir, "uploads", row.storageName);
    if (!existsSync(from)) {
      missingFiles += 1;
      continue;
    }
    copyFileSync(from, target);
    copied += 1;
  }
}

const counts = Object.entries(out).filter(([, rows]) => Array.isArray(rows) && rows.length).length;
console.log(`Training data rebuilt in ${dataDir}: ${counts} collections, sample dates shifted ${shiftDays >= 0 ? "+" : ""}${shiftDays} days (seed ${seedToday} → ${today}), ${copied} files copied${missingFiles ? `, ${missingFiles} missing` : ""}.`);

// ---- 4 + 5. start ------------------------------------------------------------------------------
if (!noStart) {
  const logOut = openSync(join(dataDir, "server.log"), "a");
  const logErr = openSync(join(dataDir, "server.err.log"), "a");
  const env = { ...process.env, PORT: String(port), CRM_DATA_DIR: dataDir, CRM_TRAINING: "1", CRM_BACKUP_INTERVAL_MINUTES: "0" };
  delete env.CRM_SEED_DEMO;
  const child = spawn(process.execPath, ["server.mjs"], { cwd: projectRoot, env, detached: true, stdio: ["ignore", logOut, logErr], windowsHide: true });
  child.unref();
  const providers = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/providers`).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) : null;
    return body?.training ? body : null;
  }, 15000);
  if (!providers) fail(`The training server did not come up on port ${port}; see ${join(dataDir, "server.err.log")}.`);
  console.log(`Training copy running on http://localhost:${port}/ (pid ${child.pid}). Sign in with the break-glass password in ${join(dataDir, "break-glass-password.txt")} (or CRM_BREAK_GLASS_PASSWORD), then set trainees' passwords in Identity & Sync › Users & access.`);
}

// ---- 6. tunnel ---------------------------------------------------------------------------------
if (withTunnel) {
  const url = await ensureTunnel(port);
  if (url) console.log(`Training copy address: ${url}\n  Paste it into live's Identity & Sync › Training copy (it changes whenever cloudflared restarts).`);
  else console.log(`No tunnel address found yet; check ${join(dataDir, "cloudflared.log")}.`);
}

// ---- helpers ---------------------------------------------------------------------------------

// Shift every YYYY-MM-DD in the sample rows by `days`, leaving ids, file names and links alone, so
// the set keeps its shape relative to "today" (jobs today, a refresher expiring soon, last week's
// invoice) whatever day the reset runs.
function shiftDates(value, days, key = "") {
  if (!days) return value;
  if (Array.isArray(value)) return value.map((item) => shiftDates(item, days, key));
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) value[childKey] = shiftDates(child, days, childKey);
    return value;
  }
  if (typeof value !== "string" || /^(id|.*Id|.*Ids|storageName|sha256|url|.*Url|fileName|originalName)$/.test(key)) return value;
  return value.replace(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, (match, year, month, day) => {
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return match;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)) + days * 86400000).toISOString().slice(0, 10);
  });
}

function stopServerOnPort(targetPort) {
  const owner = listeningProcess(targetPort);
  if (!owner) return;
  if (!/server\.mjs/.test(owner.commandLine || "")) fail(`Port ${targetPort} is held by something that is not server.mjs (pid ${owner.pid}: ${owner.commandLine}); not touching it.`);
  process.kill(owner.pid);
  const deadline = Date.now() + 10000;
  while (listeningProcess(targetPort) && Date.now() < deadline) spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 250)"]);
  if (listeningProcess(targetPort)) fail(`The training server on port ${targetPort} did not stop.`);
  console.log(`Stopped the training server (pid ${owner.pid}).`);
}

function listeningProcess(targetPort) {
  if (process.platform !== "win32") return null;
  const script = `$c = Get-NetTCPConnection -LocalPort ${targetPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"; @{ pid = $p.ProcessId; commandLine = $p.CommandLine } | ConvertTo-Json -Compress }`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  const text = (result.stdout || "").trim();
  return text ? JSON.parse(text) : null;
}

async function ensureTunnel(targetPort) {
  const logFile = join(dataDir, "cloudflared.log");
  const running = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Get-CimInstance Win32_Process -Filter "Name like 'cloudflared%'" | Where-Object { $_.CommandLine -like '*localhost:${targetPort}*' } | Select-Object -First 1 -ExpandProperty ProcessId`], { encoding: "utf8" });
  if (!(running.stdout || "").trim()) {
    const exe = process.env.CRM_CLOUDFLARED || "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe";
    if (!existsSync(exe)) fail(`cloudflared not found at ${exe} (set CRM_CLOUDFLARED).`);
    rmSync(logFile, { force: true });
    const log = openSync(logFile, "a");
    const child = spawn(exe, ["tunnel", "--url", `http://localhost:${targetPort}`], { detached: true, stdio: ["ignore", log, log], windowsHide: true });
    child.unref();
    console.log(`Started a quick tunnel to port ${targetPort} (pid ${child.pid}).`);
  }
  return waitFor(() => {
    if (!existsSync(logFile)) return null;
    const matches = readFileSync(logFile, "utf8").match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
    return matches ? matches[matches.length - 1] : null;
  }, 30000);
}

async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
  }
  return null;
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
