# Live hosting — the permanent address

**Set up 2026-10-01.** The CRM runs on the office PC (`node server.mjs`, port 4173). It reaches the internet through a Cloudflare **quick tunnel**, and the address people use is a free Cloudflare **Worker** in front of that tunnel:

**https://bioremedy-crm.bioremedy.workers.dev**

```
phone / laptop ──► Worker (bioremedy-crm.bioremedy.workers.dev, never changes)
                     │ looks up the current tunnel address in Workers KV
                     ▼
                   quick tunnel (https://<random>.trycloudflare.com, changes on every restart)
                     ▼
                   office PC: node server.mjs on localhost:4173
```

## Why a Worker, not a named tunnel

A named tunnel (`crm.bioremedy.com`) is free too, but it needs the domain's DNS to be managed by Cloudflare. As of 2026-10-01, bioremedy.com's and micro-bac.com's nameservers are Wix's (`ns10/ns11.wixdns.net`). Moving them affects the website and the Microsoft 365 email records. Once the website rebuild moves bioremedy.com's DNS to Cloudflare, switch to a named tunnel on `crm.bioremedy.com`: run it as a Windows service with `cloudflared service install <token>`, register the new address in Entra, and retire the Worker.

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Worker | `deploy/cloudflare-worker/worker.js` + `wrangler.toml` | Forwards every request to the current tunnel. Sets `X-Forwarded-Host`/`X-Forwarded-Proto` so the server builds `/go/` and `/walk/` links and Secure cookies for the Worker's address. Rewrites redirects. Shows an "offline" page when the PC is off. `POST /__tunnel` (Bearer `TUNNEL_SECRET`) stores a new tunnel address; only `https://*.trycloudflare.com` is accepted. |
| KV namespace | `bioremedy-crm-tunnel` (id in `wrangler.toml`) | Holds the current address under the key `origin`. Reads are cached for 30 s, so a new address takes up to ~1 minute to reach every Cloudflare location. |
| Supervisor | `scripts/live-tunnel.mjs` | Starts `cloudflared tunnel --url http://localhost:4173`, registers each new address with the Worker, re-registers every 30 min, and restarts the tunnel after three failed health checks or when it exits. Log: `data/live-tunnel.log`. |
| Startup tasks | `scripts/install-autostart.ps1` (run once as administrator) | "BioRemedy CRM live server" (log `data/live-server.log`) and "BioRemedy CRM tunnel" (45 s later) at startup, as the owner whether or not anyone is signed in, restarted if they crash. The existing "BioRemedy training reset" task also gets a startup trigger. `-Remove` takes them out. |
| Settings | `.env` (gitignored) | `CRM_TUNNEL_WORKER_URL`, `CRM_TUNNEL_SECRET` (the same value as the Worker's `TUNNEL_SECRET` secret), optional `CRM_CLOUDFLARED`. |
| Wrangler | `%LOCALAPPDATA%\bioremedy-crm-tools` | `wrangler` 4.x installed with pnpm (no npm on this PC). Signed in to the owner's Cloudflare account (account `ae87d9d3…`, workers.dev subdomain `bioremedy`). |

## Deploying or changing the Worker

From `deploy/cloudflare-worker`:

```powershell
$env:Path = "C:\Users\Braden\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;" + $env:Path   # Node isn't on PATH here
$wrangler = "$env:LOCALAPPDATA\bioremedy-crm-tools\node_modules\.bin\wrangler.CMD"
& $wrangler deploy
# first time, and whenever the secret changes: copy CRM_TUNNEL_SECRET from .env into the Worker
(Select-String -Path ..\..\.env -Pattern '^CRM_TUNNEL_SECRET=(.*)$').Matches[0].Groups[1].Value | & $wrangler secret put TUNNEL_SECRET
```

## Microsoft sign-in

Register `https://bioremedy-crm.bioremedy.workers.dev/` once as a **Single-page application** redirect URI on the Entra app (see `docs/roadmap/cutover-runbook.md`). Keep `http://localhost:4173/` too.

## Limits to know

- It works only while the office PC is on and online. When it's off, the address shows the offline page; the field app keeps offline captures on the phone.
- The free Workers plan allows 100,000 requests a day and the free KV plan 1,000 writes a day. The supervisor writes about 50 a day.
- Cloudflare gives quick tunnels no uptime guarantee. The supervisor restarts a dead one, and the Worker follows the new address within about a minute.
- The training copy (port 4174) still uses its own changing quick-tunnel address (`scripts/reset-training.mjs --tunnel`). The same Worker code can front it: deploy it a second time under another name with `ORIGIN_KEY = "training-origin"`, and run the supervisor with `--port 4174`.
