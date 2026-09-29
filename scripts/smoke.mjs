// The kept smoke test (Phase 20 item 6, 2026-09-23). Run it before every commit:
//
//   node scripts/smoke.mjs                 full run: server checks + browser sweep
//   node scripts/smoke.mjs --no-browser    server checks only (seconds)
//
// It starts its own scratch server on a copy of data/backend.json (never the live file), with its own
// break-glass password, then:
//   1. static-file allowlist -- the Phase 20 item 0 paths must 404, the app shell must 200
//   2. identity (Phase 12a) -- no session is 401 whatever X-CRM-Role says; a break-glass session works
//   3. referential integrity -- scripts/clean-orphans.mjs must report zero orphans
//   4. the browser sweep (scripts/smoke-browser.py, Playwright): every view, every detail tab for the
//      first record of each kind, every dialog opener, every edit dialog re-saved unchanged; fails on
//      any console error, uncaught rejection, or NaN / undefined / null / [object Object] in rendered text
//
// Playwright lives in the bundled Python runtime (see CLAUDE.md); CRM_PYTHON overrides the path.
// One script, no framework: Phase 00's deferral of CI, linting and unit tests stands.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, copyFileSync, mkdirSync, rmSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const noBrowser = args.includes("--no-browser");
const port = Number(process.env.CRM_SMOKE_PORT || 4199);
const smokePassword = randomBytes(12).toString("base64url");
const python = process.env.CRM_PYTHON || "C:\\Users\\Braden\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const base = `http://localhost:${port}`;
const failures = [];
const passes = [];
function check(ok, label) {
  (ok ? passes : failures).push(label);
  console.log(`${ok ? "  ok " : "  FAIL"} ${label}`);
}

// ---- scratch server ---------------------------------------------------------------------------
const scratch = mkdtempSync(join(tmpdir(), "crm-smoke-"));
copyFileSync(join(projectRoot, "data", "backend.json"), join(scratch, "backend.json"));
mkdirSync(join(scratch, "uploads"), { recursive: true });
// Attachments and receipts render from uploads/; without the files every job page logs a 404.
if (existsSync(join(projectRoot, "data", "uploads"))) cpSync(join(projectRoot, "data", "uploads"), join(scratch, "uploads"), { recursive: true });
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: projectRoot,
  env: { ...process.env, PORT: String(port), CRM_DATA_DIR: scratch, CRM_BACKUP_INTERVAL_MINUTES: "0", CRM_BREAK_GLASS_PASSWORD: smokePassword },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk));
server.stderr.on("data", (chunk) => (serverLog += chunk));
const started = await new Promise((resolve) => {
  const deadline = Date.now() + 10000;
  const poll = async () => {
    try {
      await fetch(`${base}/manifest.webmanifest`);
      resolve(true);
    } catch {
      if (Date.now() > deadline) resolve(false);
      else setTimeout(poll, 200);
    }
  };
  poll();
});
if (!started) {
  console.error("Scratch server did not start:\n" + serverLog);
  process.exit(2);
}
console.log(`Scratch server on ${base} (data copy in ${scratch})`);

try {
  // ---- 1. static-file allowlist ---------------------------------------------------------------
  console.log("\nStatic files");
  for (const path of ["/data/backend.json", "/server.mjs", "/.git/config", "/docs/uploaded%20files/2026%20RATES.xlsx", "/data/uploads/x.pdf", "/package.json"]) {
    const response = await fetch(`${base}${path}`);
    check(response.status === 404, `${path} -> ${response.status} (want 404)`);
  }
  for (const path of ["/", "/app.js", "/styles.css", "/service-worker.js", "/public/vendor/leaflet/leaflet.js", "/field/index.js", "/field/styles.css"]) {
    const response = await fetch(`${base}${path}`);
    check(response.status === 200, `${path} -> ${response.status} (want 200)`);
  }

  // ---- 2. identity: no session is refused, a forged header changes nothing --------------------
  console.log("\nIdentity");
  const forged = await fetch(`${base}/api/backend/employees`, { headers: { "X-CRM-Role": "Admin" } });
  check(forged.status === 401, `GET /api/backend/employees with X-CRM-Role: Admin and no session -> ${forged.status} (want 401)`);
  const noSession = await fetch(`${base}/api/backend`);
  check(noSession.status === 401, `GET /api/backend with no session -> ${noSession.status} (want 401)`);
  const badBreakGlass = await fetch(`${base}/api/auth/break-glass`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "wrong" }) });
  check(badBreakGlass.status === 401, `break-glass with the wrong password -> ${badBreakGlass.status} (want 401)`);
  const login = await fetch(`${base}/api/auth/break-glass`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: smokePassword }) });
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  check(login.status === 200 && cookie.startsWith("crm_session="), `break-glass sign-in -> ${login.status}, session cookie ${cookie ? "set" : "missing"}`);
  const withSession = await fetch(`${base}/api/backend/employees`, { headers: { Cookie: cookie } });
  check(withSession.status === 200, `GET /api/backend/employees with the session -> ${withSession.status} (want 200)`);
  const attachmentAnon = await fetch(`${base}/api/job-task-attachments/anything/view`);
  check(attachmentAnon.status === 401, `attachment view with no session -> ${attachmentAnon.status} (want 401)`);

  // ---- 3. referential integrity ---------------------------------------------------------------
  console.log("\nReferential integrity");
  const integrity = spawnSync(process.execPath, ["scripts/clean-orphans.mjs", "--data", scratch], { cwd: projectRoot, encoding: "utf8" });
  const firstLine = (integrity.stdout || "").split("\n")[0] || "";
  const orphanCount = Number((firstLine.match(/(\d+) orphan/) || [0, NaN])[1]);
  check(orphanCount === 0, firstLine.trim() || integrity.stderr);

  // ---- 3b. field API contract (Phase 21, Front Line 2) -----------------------------------------
  console.log("\nField API");
  const fieldCheck = spawnSync(process.execPath, ["scripts/field-api-check.mjs", "--url", base, "--password", smokePassword], { cwd: projectRoot, encoding: "utf8" });
  console.log(fieldCheck.stdout || "");
  if (fieldCheck.stderr?.trim()) console.log(fieldCheck.stderr.trim());
  check(fieldCheck.status === 0, "scripts/field-api-check.mjs");

  // ---- 3c. driver's-licence barcode parser (Phase 25 A.3b) --------------------------------------
  console.log("\nAAMVA parser");
  const aamvaCheck = spawnSync(process.execPath, ["scripts/aamva-parse-check.mjs"], { cwd: projectRoot, encoding: "utf8" });
  if (aamvaCheck.status !== 0) console.log(aamvaCheck.stdout || aamvaCheck.stderr || "");
  check(aamvaCheck.status === 0, "scripts/aamva-parse-check.mjs");

  // ---- 4. browser sweep -----------------------------------------------------------------------
  if (!noBrowser) {
    console.log("\nBrowser sweep");
    if (!existsSync(python)) {
      check(false, `Python with Playwright not found at ${python} (set CRM_PYTHON)`);
    } else {
      const sweep = spawnSync(python, ["scripts/smoke-browser.py", base], { cwd: projectRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CRM_SMOKE_PASSWORD: smokePassword } });
      const lines = (sweep.stdout || "").trim().split("\n");
      const summaryLine = lines.find((line) => line.startsWith("SUMMARY ")) || "";
      let summary = {};
      try {
        summary = JSON.parse(summaryLine.slice(8) || "{}");
      } catch {
        summary = {};
      }
      console.log(lines.filter((line) => !line.startsWith("SUMMARY ")).join("\n"));
      if (sweep.stderr?.trim()) console.log(sweep.stderr.trim().split("\n").slice(-5).join("\n"));
      check(sweep.status === 0 && summary.views > 0, `sweep finished (${summary.views || 0} views, ${summary.tabs || 0} tabs, ${summary.dialogs || 0} dialogs, ${summary.resaved || 0} re-saved, ${summary.tours || 0} tours)`);
      check((summary.consoleErrors || []).length === 0, `${(summary.consoleErrors || []).length} console errors / uncaught rejections`);
      check((summary.badText || []).length === 0, `${(summary.badText || []).length} NaN / undefined / null / [object Object] in rendered text`);
      (summary.consoleErrors || []).slice(0, 10).forEach((line) => console.log(`    ${line}`));
      (summary.badText || []).slice(0, 10).forEach((line) => console.log(`    ${line}`));
    }
  }
} finally {
  server.kill();
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${failures.length ? "FAILED" : "PASSED"}: ${passes.length} checks passed, ${failures.length} failed.`);
process.exit(failures.length ? 1 : 0);
