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

| Variable | Default | What |
|---|---|---|
| `PORT` | `4173` | Listening port (falls forward to the next free one). |
| `CRM_DATA_DIR` | `./data` | Folder holding `backend.json`, `uploads/` and `backups/`. Point a second instance at a copy to test without touching live data. |
| `CRM_BACKUP_INTERVAL_MINUTES` | `240` | Server-scheduled verified snapshots into `<data>/backups` (rolling 10). `0` turns them off. |
| `CRM_BACKUP_DIR` | unset | Off-machine copy of the newest snapshot and `uploads/` (rolling 30). Point it at a OneDrive-synced folder. |
| `CRM_SEED_DEMO` | unset | `1` seeds the demo data set (`data/demo-seed.json`) into empty collections. Off by default: an emptied collection stays empty. |
| `CRM_WEATHER_PROVIDER` | `open-meteo` | Weather snapshot source; `off` makes every capture fail (for testing). |

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

Sign-in with Microsoft Entra ID (Authorization Code + PKCE) is wired on the Identity & Sync screen and needs an app registration in the bioremedy.com tenant. Server-side sessions and role enforcement are roadmap Phase 12.
