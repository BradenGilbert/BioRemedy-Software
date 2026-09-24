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

### Scratch instance for testing

```powershell
$env:PORT = 4180; $env:CRM_DATA_DIR = "C:\path\to\scratch\data"; & "<node.exe>" .\server.mjs
```

## Scripts

| Command | What |
|---|---|
| `node scripts/smoke.mjs` | The kept smoke test: scratch server on a copy of the data, static-file and role-header checks, referential integrity, then a Playwright sweep of every view, tab and dialog. Run before every commit. `--no-browser` for the server checks only. |
| `npm run backup` | One verified snapshot by hand (the server already takes them on a schedule). |
| `node scripts/clean-orphans.mjs` | Referential-integrity report; `--apply` fixes it through the running server. |
| `node scripts/reset-demo-data.mjs` | Puts the demo data set back through the API. |
| `node scripts/import-rate-sheet.mjs` | Imports the 2026 rate sheet into the product catalog. |

## Data

Everything lives in `data/backend.json` (~104 collections), served by `server.mjs` through `/api/backend/{collection}`. Every record carries a server-owned `version`; a stale save is refused with 409. Deletes are soft (`deletedAt`) and cascade through the table in `server.mjs`; deleted records can be restored from Identity & Sync › Recently deleted. PostgreSQL is designed in `crm-schema/` and lands in roadmap Phase 14.

## Identity

Every request to the API needs a session (an HttpOnly cookie); the role on the session decides what it may do. **First sign-in on a new install:** open the app, choose *Emergency access*, and use the password from `data/break-glass-password.txt`. Then, in *Identity & Sync › Users & access*, set a password for your own user (`bgilbert`, Admin) and add the rest of the team with their roles. Every use of emergency access is written to the audit log. Identity data lives in `data/auth.json`, the audit trail in `data/audit.log`; both are outside git and outside `backend.json`.

Sign-in with Microsoft Entra ID (bioremedy.com) is roadmap Phase 12b: the browser flow is wired on the Identity & Sync screen, and it needs an app registration in the tenant plus server-side token validation.

Scripts that write through the API (`clean-orphans --apply`, `reset-demo-data`) take the break-glass password with `--password` or `CRM_PASSWORD`.
