// Builds the printed user guide from the tours themselves, and checks that every tour still works
// (Phase 24, 2026-09-28).
//
//   node scripts/build-user-guide.mjs                 # all tutorials -> docs/user-guide/*.html + .pdf
//   node scripts/build-user-guide.mjs --only process-win-job,section-sales
//   node scripts/build-user-guide.mjs --check         # no files; exit 1 if a step's target is missing
//                                                     # or a hands-on step cannot be completed
//   node scripts/build-user-guide.mjs --url http://localhost:4312/ --password <break-glass>
//
// Without --url it builds its own scratch training copy (scripts/reset-training.mjs --no-start into a
// temp folder, then server.mjs with CRM_TRAINING=1 on a free port), so the pictures show the sample
// data and never live records. Each tutorial from tutorials/registry.js is started through the real
// engine; every step is photographed with its spotlight; a hands-on step is completed with the step's
// `auto` actions (the same ones a person would do by hand). The guide is generated, never hand-written:
// re-run it whenever a screen changes.
//
// Playwright: the `playwright` package if it resolves, else the copy bundled with the Codex Node
// runtime (CRM_PLAYWRIGHT_DIR overrides that folder).

import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const checkOnly = args.includes("--check");
const noPdf = args.includes("--no-pdf") || checkOnly;
const only = option("--only", "").split(",").map((id) => id.trim()).filter(Boolean);
const outDir = resolve(projectRoot, option("--out", join("docs", "user-guide")));
let baseUrl = option("--url", "");
let password = option("--password", process.env.CRM_GUIDE_PASSWORD || "");

const { chromium } = await loadPlaywright();
const { TUTORIALS } = await import(pathToFileURL(join(projectRoot, "tutorials", "registry.js")).href);
const tutorials = TUTORIALS.filter((tutorial) => !only.length || only.includes(tutorial.id));
if (!tutorials.length) fail(`No tutorials match --only ${only.join(",")}`);

let server = null;
let scratch = "";
if (!baseUrl) ({ server, scratch, baseUrl, password } = await startScratchTraining());
baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

const problems = [];
const results = [];
const browser = await chromium.launch();
try {
  for (const tutorial of tutorials) {
    const result = await runTutorial(tutorial);
    results.push(result);
    const bad = result.steps.filter((step) => step.problem);
    for (const step of bad) problems.push(`${tutorial.id} step ${step.number} (${step.title}): ${step.problem}`);
    console.log(`  ${tutorial.id}: ${result.steps.length} steps${bad.length ? `, ${bad.length} problem(s)` : ""}${result.errors.length ? `, ${result.errors.length} console error(s)` : ""}`);
    for (const error of result.errors) problems.push(`${tutorial.id}: ${error}`);
  }
  if (!checkOnly) await writeGuide(results);
} finally {
  await browser.close();
  if (server) server.kill();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const line of problems) console.log(`    ${line}`);
  process.exit(1);
}
console.log(checkOnly ? `\nAll ${results.length} tutorials walk cleanly.` : `\nWrote ${results.length} guides to ${outDir}`);

// ---- one tutorial ------------------------------------------------------------------------------

async function runTutorial(tutorial) {
  const phone = tutorial.surface === "phone";
  const context = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/40[139]|Failed to load resource/.test(message.text())) errors.push(message.text().slice(0, 200));
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error).slice(0, 200)}`));
  page.on("dialog", (dialog) => dialog.accept());
  const login = await context.request.post(`${baseUrl}api/auth/break-glass`, { data: { password } });
  if (!login.ok()) fail(`Break-glass sign-in failed (${login.status()}) at ${baseUrl}`);
  // A record's page tour starts on that kind of record: the first one in the sample data.
  let route = `#view=${tutorial.startView || "home"}`;
  if (tutorial.startFrom) {
    const rows = await (await context.request.get(`${baseUrl}api/backend/${tutorial.startFrom.collection}`)).json();
    const first = (Array.isArray(rows) ? rows : []).find((row) => !row.deletedAt);
    if (first) route = `#view=${tutorial.startFrom.view}&${tutorial.startFrom.key}=${encodeURIComponent(first.id)}`;
  }
  await page.goto(`${baseUrl}?guide=${Date.now()}${phone ? "&surface=phone" : ""}${route}`);
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('[data-action="dismiss-update-banner"]')?.click());
  await page.evaluate(async (id) => {
    const engine = await import("/tutorials/engine.js");
    const registry = await import("/tutorials/registry.js");
    engine.startTour(registry.findTutorial(id));
  }, tutorial.id);

  const steps = [];
  const slug = tutorial.id;
  let lastProgress = "";
  for (let guard = 0; guard < 80; guard += 1) {
    await page.waitForTimeout(900);
    const layer = page.locator(".tour-layer");
    if (!(await layer.count()) || (await layer.getAttribute("hidden")) !== null) break;
    const card = await page.evaluate(() => ({
      progress: document.querySelector(".tour-progress")?.textContent || "",
      title: document.querySelector("#tourCardTitle")?.textContent || "",
      doText: document.querySelector(".tour-do")?.textContent || "",
      why: document.querySelector(".tour-why")?.textContent || "",
      status: document.querySelector(".tour-layer")?.dataset.tourStatus || "",
      waiting: Boolean(document.querySelector('[data-tour-act="next"]')?.disabled),
    }));
    if (card.progress === lastProgress && !card.waiting) {
      // The same step twice without a wait: Next did not move it; stop rather than loop.
      steps.push({ number: steps.length + 1, ...card, problem: "Next did not advance" });
      break;
    }
    lastProgress = card.progress;
    const number = steps.length + 1;
    const shot = `${slug}-${String(number).padStart(2, "0")}.png`;
    if (!checkOnly) {
      mkdirSync(join(outDir, "img"), { recursive: true });
      await page.screenshot({ path: join(outDir, "img", shot) });
    }
    const step = { number, ...card, shot, problem: card.status === "missing" ? "highlight target missing" : "" };
    steps.push(step);
    if (card.waiting) {
      const ran = await page.evaluate(async () => (await import("/tutorials/engine.js")).runAuto());
      const moved = await waitUntil(page, (before) => document.querySelector(".tour-progress")?.textContent !== before || document.querySelector(".tour-layer")?.hidden, card.progress, 10000);
      if (!moved) {
        step.problem ||= ran ? "hands-on step did not complete with its auto actions" : "an auto action's target is missing";
        await page.locator('[data-tour-act="skip"]').click();
      }
      lastProgress = "";
      continue;
    }
    await page.locator('[data-tour-act="next"]').click();
  }
  await context.close();
  return { tutorial, steps, errors };
}

async function waitUntil(page, predicate, arg, timeoutMs) {
  try {
    await page.waitForFunction(predicate, arg, { timeout: timeoutMs, polling: 200 });
    return true;
  } catch {
    return false;
  }
}

// ---- output ------------------------------------------------------------------------------------

async function writeGuide(results) {
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  for (const { tutorial, steps } of results) {
    const html = page(`${tutorial.title}`, `
      <header>
        <p class="eyebrow">BioRemedy Operations Platform · ${tutorial.kind === "process" ? "Hands-on tutorial (training copy)" : "Screen tour"}</p>
        <h1>${esc(tutorial.title)}</h1>
        <p class="summary">${esc(tutorial.summary || "")}</p>
        <p class="meta">Generated ${stamp} from the live tour by <code>scripts/build-user-guide.mjs</code>. The screens show sample data.</p>
      </header>
      ${steps
        .map(
          (step) => `
        <section class="step">
          <h2><span>${step.number}</span>${esc(step.title)}</h2>
          <p>${esc(step.doText)}</p>
          ${step.why ? `<p class="why">${esc(step.why)}</p>` : ""}
          <img src="img/${esc(step.shot)}" alt="${esc(step.title)}" />
        </section>`,
        )
        .join("")}
    `);
    writeFileSync(join(outDir, `${tutorial.id}.html`), html, "utf8");
  }
  const index = page("User guide", `
    <header><p class="eyebrow">BioRemedy Operations Platform</p><h1>User guide</h1><p class="meta">Generated ${stamp}. Every page is built from the in-app tours; re-run <code>node scripts/build-user-guide.mjs</code> after a screen changes.</p></header>
    <h2>Hands-on tutorials</h2><ul>${results.filter((r) => r.tutorial.kind === "process").map((r) => `<li><a href="${r.tutorial.id}.html">${esc(r.tutorial.title)}</a> — ${esc(r.tutorial.summary || "")}</li>`).join("")}</ul>
    <h2>Screen tours</h2><ul>${results.filter((r) => r.tutorial.kind !== "process").map((r) => `<li><a href="${r.tutorial.id}.html">${esc(r.tutorial.title)}</a> — ${esc(r.tutorial.summary || "")}</li>`).join("")}</ul>
  `);
  writeFileSync(join(outDir, "index.html"), index, "utf8");
  if (noPdf) return;
  const pdfPage = await browser.newPage();
  for (const { tutorial } of results) {
    await pdfPage.goto(pathToFileURL(join(outDir, `${tutorial.id}.html`)).href);
    await pdfPage.pdf({ path: join(outDir, `${tutorial.id}.pdf`), format: "Letter", margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" }, printBackground: true });
  }
  await pdfPage.close();
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body { font: 15px/1.5 system-ui, "Segoe UI", sans-serif; color: #13241b; max-width: 900px; margin: 24px auto; padding: 0 16px; }
  .eyebrow { text-transform: uppercase; letter-spacing: .06em; font-size: 12px; font-weight: 700; color: #5f6d63; margin: 0; }
  h1 { margin: 4px 0 8px; } .summary { font-size: 17px; } .meta { color: #5f6d63; font-size: 13px; }
  .step { break-inside: avoid; page-break-inside: avoid; margin: 26px 0; }
  .step h2 { display: flex; gap: 10px; align-items: center; font-size: 18px; margin: 0 0 6px; }
  .step h2 span { display: inline-grid; place-items: center; min-width: 28px; height: 28px; border-radius: 50%; background: #159947; color: #fff; font-size: 14px; }
  .why { color: #5f6d63; } .why::before { content: "Why: "; font-weight: 700; }
  img { width: 100%; border: 1px solid #d7e4d8; border-radius: 8px; }
  code { font-size: 13px; }
</style></head><body>${body}</body></html>`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

// ---- scratch training copy -----------------------------------------------------------------------

async function startScratchTraining() {
  const dir = mkdtempSync(join(tmpdir(), "crm-guide-"));
  // A free port unless one is given: two smoke runs (parallel sessions) must not share a server.
  const port = Number(option("--port", "0")) || (await freePort());
  const pw = `guide-${Math.random().toString(36).slice(2)}`;
  const reset = spawnSync(process.execPath, ["scripts/reset-training.mjs", "--data", dir, "--port", String(port), "--no-start"], { cwd: projectRoot, encoding: "utf8" });
  if (reset.status !== 0) fail(`reset-training failed:\n${reset.stderr || reset.stdout}`);
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port), CRM_DATA_DIR: dir, CRM_TRAINING: "1", CRM_BACKUP_INTERVAL_MINUTES: "0", CRM_BREAK_GLASS_PASSWORD: pw },
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}/`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const ok = await fetch(`${url}api/auth/providers`).then((response) => response.ok).catch(() => false);
    if (ok) return { server: child, scratch: dir, baseUrl: url, password: pw };
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  child.kill();
  fail(`The scratch training server did not start on port ${port}.`);
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const dir = process.env.CRM_PLAYWRIGHT_DIR || "C:\\Users\\Braden\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\node\\node_modules";
    if (!existsSync(join(dir, "playwright"))) fail(`Playwright not found (npm i playwright, or set CRM_PLAYWRIGHT_DIR to a node_modules folder that has it).`);
    return createRequire(join(dir, "noop.js"))("playwright");
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
