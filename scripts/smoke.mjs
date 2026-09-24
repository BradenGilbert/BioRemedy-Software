// The kept smoke test (Phase 20 item 6, 2026-09-23). Run it before every commit:
//
//   node scripts/smoke.mjs                 full run: server checks + browser sweep
//   node scripts/smoke.mjs --no-browser    server checks only (seconds)
//   CRM_SMOKE_EXPECT_AUTH=1 node scripts/smoke.mjs   after Phase 12: a forged role header must be refused
//
// It starts its own scratch server on a copy of data/backend.json (never the live file), then:
//   1. static-file allowlist -- the Phase 20 item 0 paths must 404, the app shell must 200
//   2. forged X-CRM-Role -- honoured today (expected), refused once Phase 12 ships (flip with the env var)
//   3. referential integrity -- scripts/clean-orphans.mjs must report zero orphans
//   4. the browser sweep (scripts/smoke-browser.py, Playwright): every view, every detail tab for the
//      first record of each kind, every dialog opener, every edit dialog re-saved unchanged; fails on
//      any console error, uncaught rejection, or NaN / undefined / null / [object Object] in rendered text
//
// Playwright lives in the bundled Python runtime (see CLAUDE.md); CRM_PYTHON overrides the path.
// One script, no framework: Phase 00's deferral of CI, linting and unit tests stands.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, copyFileSync, mkdirSync, rmSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const noBrowser = args.includes("--no-browser");
const port = Number(process.env.CRM_SMOKE_PORT || 4199);
const expectAuth = process.env.CRM_SMOKE_EXPECT_AUTH === "1";
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
  env: { ...process.env, PORT: String(port), CRM_DATA_DIR: scratch, CRM_BACKUP_INTERVAL_MINUTES: "0" },
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
  for (const path of ["/", "/app.js", "/styles.css", "/service-worker.js", "/public/vendor/leaflet/leaflet.js"]) {
    const response = await fetch(`${base}${path}`);
    check(response.status === 200, `${path} -> ${response.status} (want 200)`);
  }

  // ---- 2. forged role header ------------------------------------------------------------------
  console.log(`\nForged X-CRM-Role (expecting it to be ${expectAuth ? "refused" : "honoured -- Phase 12 not shipped"})`);
  const forged = await fetch(`${base}/api/backend/employees`, { headers: { "X-CRM-Role": "Admin" } });
  check(expectAuth ? forged.status === 401 || forged.status === 403 : forged.status === 200, `GET /api/backend/employees with X-CRM-Role: Admin and no session -> ${forged.status}`);
  const noRole = await fetch(`${base}/api/backend/employees`);
  check(noRole.status === 403 || noRole.status === 401, `GET /api/backend/employees with no role at all -> ${noRole.status} (want refused)`);

  // ---- 3. referential integrity ---------------------------------------------------------------
  console.log("\nReferential integrity");
  const integrity = spawnSync(process.execPath, ["scripts/clean-orphans.mjs", "--data", scratch], { cwd: projectRoot, encoding: "utf8" });
  const firstLine = (integrity.stdout || "").split("\n")[0] || "";
  const orphanCount = Number((firstLine.match(/(\d+) orphan/) || [0, NaN])[1]);
  check(orphanCount === 0, firstLine.trim() || integrity.stderr);

  // ---- 4. browser sweep -----------------------------------------------------------------------
  if (!noBrowser) {
    console.log("\nBrowser sweep");
    if (!existsSync(python)) {
      check(false, `Python with Playwright not found at ${python} (set CRM_PYTHON)`);
    } else {
      const sweep = spawnSync(python, ["scripts/smoke-browser.py", base], { cwd: projectRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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
      check(sweep.status === 0 && summary.views > 0, `sweep finished (${summary.views || 0} views, ${summary.tabs || 0} tabs, ${summary.dialogs || 0} dialogs, ${summary.resaved || 0} re-saved)`);
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
