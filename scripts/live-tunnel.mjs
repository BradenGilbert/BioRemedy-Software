// Keeps the CRM reachable at its permanent workers.dev address (2026-10-01).
//
// Runs a Cloudflare quick tunnel to the local server, and every time the tunnel gets a new
// trycloudflare.com address, registers it with the Cloudflare Worker that fronts the CRM
// (deploy/cloudflare-worker). Restarts the tunnel if it dies or stops answering. Meant to run for
// as long as the PC is on (Windows startup task "BioRemedy CRM tunnel"; see docs/live-hosting.md).
//
//   node scripts/live-tunnel.mjs                        live: port 4173, worker from .env
//   node scripts/live-tunnel.mjs --port 4174 --worker-url https://… --log data-training/live-tunnel.log
//
// .env (gitignored): CRM_TUNNEL_WORKER_URL=https://bioremedy-crm.<sub>.workers.dev
//                    CRM_TUNNEL_SECRET=<the Worker's TUNNEL_SECRET>
//                    CRM_CLOUDFLARED=<path>   (optional; default C:\Program Files (x86)\cloudflared\cloudflared.exe)
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadDotEnv(join(projectRoot, ".env"));

const args = process.argv.slice(2);
const option = (name, fallback = "") => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = Number(option("--port", "4173"));
const workerUrl = option("--worker-url", process.env.CRM_TUNNEL_WORKER_URL || "").replace(/\/+$/, "");
const secret = process.env.CRM_TUNNEL_SECRET || "";
const cloudflared = process.env.CRM_CLOUDFLARED || "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe";
const logFile = resolve(projectRoot, option("--log", join("data", port === 4173 ? "live-tunnel.log" : `tunnel-${port}.log`)));

if (!workerUrl || !secret) fail("Set CRM_TUNNEL_WORKER_URL and CRM_TUNNEL_SECRET in .env (or pass --worker-url).");
if (!existsSync(cloudflared)) fail(`cloudflared not found at ${cloudflared} (set CRM_CLOUDFLARED).`);
mkdirSync(dirname(logFile), { recursive: true });

let child = null;
let currentOrigin = "";
let failedChecks = 0;
let restartDelayMs = 5000;

log(`Supervisor started: port ${port} -> ${workerUrl}`);
startTunnel();

// Health: the tunnel must keep answering; re-register now and then in case the Worker's store lost it.
setInterval(async () => {
  if (!currentOrigin) return;
  const ok = await probe(`${currentOrigin}/api/auth/providers`);
  if (ok) {
    failedChecks = 0;
    return;
  }
  failedChecks += 1;
  log(`Tunnel check failed (${failedChecks}/3) for ${currentOrigin}`);
  if (failedChecks >= 3 && child) {
    log("Restarting the tunnel.");
    failedChecks = 0;
    child.kill();
  }
}, 120000);
setInterval(() => {
  if (currentOrigin) register(currentOrigin);
}, 30 * 60000);

function startTunnel() {
  currentOrigin = "";
  child = spawn(cloudflared, ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  log(`cloudflared started (pid ${child.pid})`);
  const onData = (chunk) => {
    const text = chunk.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && match[0] !== currentOrigin) {
      currentOrigin = match[0];
      restartDelayMs = 5000;
      log(`Tunnel address: ${currentOrigin}`);
      register(currentOrigin);
    }
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("exit", (code) => {
    log(`cloudflared exited (code ${code}); restarting in ${Math.round(restartDelayMs / 1000)} s`);
    child = null;
    setTimeout(startTunnel, restartDelayMs);
    restartDelayMs = Math.min(restartDelayMs * 2, 120000);
  });
}

async function register(origin, attempt = 1) {
  try {
    const response = await fetch(`${workerUrl}/__tunnel`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify({ origin }),
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    log(`Registered ${origin} with ${workerUrl}`);
  } catch (error) {
    log(`Registering failed (attempt ${attempt}): ${error.message}`);
    if (attempt < 20 && origin === currentOrigin) setTimeout(() => register(origin, attempt + 1), Math.min(5000 * attempt, 60000));
  }
}

async function probe(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return response.ok;
  } catch {
    return false;
  }
}

function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
  }
}

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  try {
    appendFileSync(logFile, line);
  } catch {
    // the console copy is enough
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
