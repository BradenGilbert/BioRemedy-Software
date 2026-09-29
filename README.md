# BioRemedy Operations Platform

A browser-based CRM + ERP prototype for an environmental cleanup company: sales pipeline, projects, dispatch, workforce, inventory, finance, and a Front Line field-app simulator. Vanilla JS front end, a small Node server, a JSON backend, no build step.

**Start here:**

- [`CLAUDE.md`](CLAUDE.md) — architecture in 30 seconds, naming hazards, working rules
- [`docs/roadmap/README.md`](docs/roadmap/README.md) — the master roadmap: what's done, what's next
- [`docs/roadmap/GLOSSARY.md`](docs/roadmap/GLOSSARY.md) — the naming contract (read before touching any entity)
- [`docs/roadmap/OUTSTANDING.md`](docs/roadmap/OUTSTANDING.md) — everything still to do

## Run it

```powershell
npm run start
```

If Node is not on `PATH`, use the bundled runtime:

```powershell
& "C:\Users\Braden\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" .\server.mjs
```

Then open the URL the server prints (port 4173 by default).

### Environment

Put machine settings in a `.env` file in the project root (gitignored; one `KEY=VALUE` per line) — the server reads it at startup, and real environment variables override it.

| Variable | Default | What |
|---|---|---|
| `PORT` | `4173` | Listening port (falls forward to the next free one). |
| `CRM_DATA_DIR` | `./data` | Folder holding `backend.json`, `uploads/` and `backups/`. Point a second instance at a copy to test without touching live data. |
| `CRM_BACKUP_INTERVAL_MINUTES` | `240` | Server-scheduled verified snapshots into `<data>/backups` (rolling 10). `0` turns them off. |
| `CRM_BACKUP_DIR` | unset | Off-machine copy of the newest snapshot and `uploads/` (rolling 30). Point it at a OneDrive-synced folder. |
| `CRM_SEED_DEMO` | unset | `1` seeds the demo data set (`data/demo-seed.json`) into empty collections. Off by default: an emptied collection stays empty. |
| `CRM_WEATHER_PROVIDER` | `open-meteo` | Weather snapshot source; `off` makes every capture fail (for testing). |
| `CRM_BREAK_GLASS_PASSWORD` | unset | Sets the emergency-admin password at startup. When unset, a fresh data folder gets a generated one written to `<data>/break-glass-password.txt`. |
| `CRM_ENTRA_TENANT_ID` | unset | The bioremedy.com Directory (tenant) ID. With `CRM_ENTRA_CLIENT_ID` it turns on "Sign in with Microsoft"; the server verifies each ID token against the tenant's published keys. |
| `CRM_ENTRA_CLIENT_ID` | unset | The app registration's Application (client) ID. Register `https://<host>/` (and `http://localhost:4173/`) as single-page-application redirect URIs. |
| `CRM_LOCAL_LOGIN` | `on` | `off` retires password sign-in once everyone uses Microsoft: the password form and Set password buttons disappear and password sign-ins are refused. Break-glass always works. |
| `CRM_TRAINING` | unset | `1` runs this server as the **training copy** (Phase 24): a TRAINING frame on every screen, password sign-in only (Microsoft off whatever `.env` says), no backups (the `.env`'s `CRM_BACKUP_DIR` is ignored), its own session cookie. Refuses to start on the live `data/` folder. Use `scripts/reset-training.mjs` rather than setting it by hand. |

### Scratch instance for testing

```powershell
$env:PORT = 4180; $env:CRM_DATA_DIR = "C:\path\to\scratch\data"; & "<node.exe>" .\server.mjs
```

### Training copy (hands-on tutorials)

Hands-on tutorials never run on live. They run on a second copy of this server with sample data dated today, reset every night:

```powershell
& "<node.exe>" .\scripts\reset-training.mjs --tunnel     # port 4174, data-training/, prints the tunnel address
```

1. **First time:** sign in to the training copy with the break-glass password in `data-training/break-glass-password.txt`, and set a password for each trainee in *Identity & Sync › Users & access*. The nightly reset keeps them.
2. **Paste the address** it prints into **live's** *Identity & Sync › Training copy*. The quick-tunnel address changes whenever cloudflared restarts; re-run with `--tunnel` and paste the new one. Live's Home "Learn the app" card and the Tutorials shelf then open tutorials there.
3. **Nightly reset** (Windows Task Scheduler, 2 am):
   `schtasks /Create /TN "BioRemedy training reset" /SC DAILY /ST 02:00 /TR "\"<node.exe>\" \"<project>\scripts\reset-training.mjs\" --tunnel"`
4. **After updating live, restart the training copy too** (re-run the script) so the two never drift.

Later, when live has a permanent address: add the training address as one more SPA redirect URI on the same Entra app registration (see `docs/roadmap/phase-24-tutorials.md`).

## Scripts

| Command | What |
|---|---|
| `node scripts/smoke.mjs` | The kept smoke test: scratch server on a copy of the data, static-file and role-header checks, referential integrity, then a Playwright sweep of every view, tab and dialog. Run before every commit. `--no-browser` for the server checks only. |
| `npm run backup` | One verified snapshot by hand (the server already takes them on a schedule). |
| `node scripts/clean-orphans.mjs` | Referential-integrity report; `--apply` fixes it through the running server. |
| `node scripts/reset-demo-data.mjs` | Puts the demo data set back through the API. |
| `node scripts/import-rate-sheet.mjs` | Imports the 2026 rate sheet into the product catalog. |
| `node scripts/reset-training.mjs` | Rebuilds and (re)starts the training copy: sample set from `data/demo-seed.json` dated today plus live's reference catalog, trainees' passwords kept. `--tunnel` also starts or finds its Cloudflare quick tunnel and prints the address. Never touches port 4173 or `data/`. |
| `node scripts/build-user-guide.mjs` | Walks every guided tour and hands-on tutorial on a scratch training copy and writes the printed guide (`docs/user-guide/*.html` + `.pdf`, gitignored). `--check` only verifies (the smoke test runs it); `--only <ids>` for some. |
| `node scripts/rebuild-sample-data.mjs` | Rebuilds the sample data set (2026-09-25): keeps the reference catalog, replaces every transactional collection with the sample set in `scripts/rebuild/`, converts the chosen field photos from OneDrive into `data/uploads`, regenerates `data/demo-seed.json`, and backs the previous data folder up first. `--dry-run` to check without writing. See `docs/sample-data.md`. |

## Data

Everything lives in `data/backend.json` (~104 collections), served by `server.mjs` through `/api/backend/{collection}`. Every record carries a server-owned `version`; a stale save is refused with 409. Deletes are soft (`deletedAt`) and cascade through the table in `server.mjs`; deleted records can be restored from Identity & Sync › Recently deleted. PostgreSQL is designed in `crm-schema/` and lands in roadmap Phase 14.

## Identity

Every request to the API needs a session (an HttpOnly cookie); the role on the session decides what it may do. **First sign-in on a new install:** open the app, choose *Emergency access*, and use the password from `data/break-glass-password.txt`. Then, in *Identity & Sync › Users & access*, set a password for your own user (`bgilbert`, Admin) and add the rest of the team with their roles. Every use of emergency access is written to the audit log. Identity data lives in `data/auth.json`, the audit trail in `data/audit.log`; both are outside git and outside `backend.json`.

Sign-in with Microsoft Entra ID (bioremedy.com) is roadmap Phase 12b: the browser flow is wired on the Identity & Sync screen, and it needs an app registration in the tenant plus server-side token validation.

Scripts that write through the API (`clean-orphans --apply`, `reset-demo-data`) take the break-glass password with `--password` or `CRM_PASSWORD`.
