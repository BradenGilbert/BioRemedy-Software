# BioRemedy Operations Platform

A browser-based CRM + ERP prototype for an environmental cleanup company — sales pipeline, projects, dispatch, workforce, inventory, finance, and a field-app simulator. Zero-install: vanilla JS front end, a small Node server, no build step.

---

## Required reading before you change anything

1. **`docs/roadmap/README.md`** — the master roadmap. What's done, what's next, which phase we're in.
2. **`docs/roadmap/GLOSSARY.md`** — the naming contract. **Read this before touching any entity.** The same concept has different names in different layers and guessing wrong causes real bugs.

Then read the specific `docs/roadmap/phase-NN-*.md` for the phase you're working on.

---

## Running it

```bash
npm run start
```

If Node isn't on `PATH`, `README.md` has the bundled-runtime fallback path.

---

## Architecture in 30 seconds

| File | What |
|---|---|
| `app.js` | ~18,800 lines, 653 functions, one ES module. The entire front end. |
| `index.html` | ~3,800 lines. App shell + 68 `<dialog>` forms. |
| `styles.css` | ~5,200 lines. |
| `server.mjs` | Node server. `/api/backend/{collection}` routes over `data/backend.json`. |
| `crm-schema/` | 28 SQL files, 141 tables. **Designed, not deployed.** The intended target model. |
| `laravel-ready/` | **Deprecated.** Stack decision is Node + Postgres. Reference only — do not add to it. |

**Three data layers exist right now:**

- **IndexedDB** (browser-local, per-user, NOT shared) — accounts, contacts, projects, tasks, activities, alerts, and more
- **JSON backend** (server, shared) — 73 collections: opportunities, facilities, dispatch jobs, employees, inventory, quotes
- **PostgreSQL** — designed, never deployed

Phase 01 collapses the first into the second. Until it ships, **assume any core CRM record you touch is invisible to other users.**

---

## Naming hazards

These have already caused planning errors. Confirm before acting:

- **`jobs` (IndexedDB) means PROJECTS**, not dispatch jobs. Dispatch jobs are `dispatchJobs`.
- **`locations` means FACILITIES.** GPS points are `mapLocations`. Both get renamed in Phase 02.
- **Facility ≠ Address ≠ Location.** Three different things. See the glossary.
- `activities` / `sales_tasks` / `tasks` are three different tables for three different concepts.

---

## Working rules

**Verify before you trust a plan.** Plan documents here have been wrong at implementation time before — `projectStage` was assumed to be read by the stage ladder (it never was), and `crewMemberships` was assumed to be a live join table (it was frozen at 4 seed rows). Trace the actual code. When the plan turns out to be wrong, **fix the plan document**, in the `## Corrections found during implementation` section — don't leave the correction in chat.

**Click-test UI work.** Playwright and Chromium **are** available in this environment despite not being on `PATH`. Don't reason about whether the UI works — drive it.

**Keep docs in sync in the same session.** If you add or change a field or collection, update `docs/database-handoff-map.md` before the session ends. Not in chat, not in memory — in the doc.

**Audit before deleting legacy UI.** Cross-check every old panel's data against the new one before removing it.

**Update phase status when a phase ships** — both the phase doc's `**Status:**` line and the table in `docs/roadmap/README.md`.

---

## Reference docs

- `docs/database-handoff-map.md` — full inventory of SQL tables, prototype collections, and what still needs tables
- `docs/erp-operational-architecture.md` — workforce, dispatch, execution, Front Line contracts
- `docs/dataverse-relationship-architecture.md` — Dynamics/Dataverse alignment rules
- `docs/crm-foundation.md` — original product direction and open business questions
- `New folder/do this next.txt` — aspirational 19-phase ERP wish list. **Not the roadmap.**
