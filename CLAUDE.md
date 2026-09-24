# BioRemedy Operations Platform

A browser-based CRM + ERP prototype for an environmental cleanup company — sales pipeline, projects, dispatch, workforce, inventory, finance, and a field-app simulator. Zero-install: vanilla JS front end, a small Node server, no build step.

---

## Required reading before you change anything

1. **`docs/roadmap/README.md`** — the master roadmap. What's done, what's next, which phase we're in.
2. **`docs/roadmap/GLOSSARY.md`** — the naming contract. **Read this before touching any entity.** The same concept has different names in different layers and guessing wrong causes real bugs.
3. **`docs/roadmap/OUTSTANDING.md`** — a compiled snapshot of everything still to do, and which decisions are settled. The phase docs win if they disagree with it.

Then read the specific `docs/roadmap/phase-NN-*.md` for the phase you're working on — including its **"Decisions locked 2026-09-22 (owner)"** section, which records answers to 51 open questions and in several cases *reverses* what the body of the doc recommends. Read the decisions before the plan.

The owner's raw feedback lives in `docs/roadmap/notes-2026-09-22.md` (verbatim, with a note→phase index) and the real business documents behind it — the 2026 rate sheet, the new customer packet, competitor invoice and report — are in `docs/uploaded files/`.

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
| `app.js` | ~31,200 lines, ~1,260 functions, one ES module. The entire front end. |
| `index.html` | ~5,800 lines. App shell + 96 `<dialog>` forms. |
| `styles.css` | ~6,950 lines. |
| `server.mjs` | Node server. `/api/backend/{collection}` routes over `data/backend.json`; API requests run one at a time and writes are atomic (2026-09-23). |
| `crm-schema/` | 28 SQL files, 141 tables. **Designed, not deployed.** The intended target model. |
| `laravel-ready/` | **Deprecated.** Stack decision is Node + Postgres. Reference only — do not add to it. |

**Where data lives (updated 2026-09-22):**

- **JSON backend** (`data/backend.json`, server, shared) — **everything.** ~103 collections. Phase 01 (2026-09-16) migrated every core CRM collection here from browser storage.
- **IndexedDB** — device-scoped state only: `syncQueue` and `settings`. Nothing else. If you find yourself writing a record to IndexedDB, you are doing something wrong.
- **PostgreSQL** — designed (`crm-schema/`), never deployed. Phase 14, after the pilot.

---

## Naming hazards

These have already caused planning errors. Confirm before acting:

- **`projects` means engagements/projects.** It was called `jobs` until Phase 01 renamed it — old plan docs and comments may still say `jobs`. Dispatch jobs are `dispatchJobs`, a different thing entirely.
- **`facilities` means customer sites. `locations` means GPS points.** Phase 02 (2026-09-16) renamed these, and they are now the *opposite* of what pre-Phase-02 documents say — those docs claim `locations` means facilities and GPS points are `mapLocations`. `mapLocations` no longer exists. Trust the code, not an old doc.
- **Facility ≠ Address ≠ Location.** Three different things. See the glossary.
- `activities` / `sales_tasks` / `tasks` are three different tables for three different concepts.
- **Dataverse compatibility is no longer a design constraint** (owner decision, 2026-09-22). `docs/dataverse-relationship-architecture.md` still explains *why* entities are shaped as they are, but its rules are history, not requirements.

---

## Working rules

**Verify before you trust a plan.** Plan documents here have been wrong at implementation time before — `projectStage` was assumed to be read by the stage ladder (it never was), and `crewMemberships` was assumed to be a live join table (it was frozen at 4 seed rows). Trace the actual code. When the plan turns out to be wrong, **fix the plan document**, in the `## Corrections found during implementation` section — don't leave the correction in chat.

**Click-test UI work.** Playwright and Chromium **are** available in this environment despite not being on `PATH`. Don't reason about whether the UI works — drive it. Test against a **scratch copy**, not the live data: run a second server with `PORT` and `CRM_DATA_DIR` pointing at a copied `backend.json` (command in `README.md`). The owner uses the live server while sessions run.

**Keep docs in sync in the same session.** If you add or change a field or collection, update `docs/database-handoff-map.md` before the session ends. Not in chat, not in memory — in the doc.

**Dropdown reads must be null-safe.** A `<select>` whose stored value matches no option submits nothing, so `data.get("x")` is `null`. Write `(data.get("x") || "").toString()`, and when a picker is filtered, keep the record's current value selectable (`setEmployeeSelectValue` is the pattern). This crashed two dialogs before the 2026-09-23 audit.

**Audit before deleting legacy UI.** Cross-check every old panel's data against the new one before removing it.

**Update phase status when a phase ships** — both the phase doc's `**Status:**` line and the table in `docs/roadmap/README.md`.

---

## Reference docs

- `docs/database-handoff-map.md` — full inventory of SQL tables, prototype collections, and what still needs tables
- `docs/erp-operational-architecture.md` — workforce, dispatch, execution, Front Line contracts
- `docs/dataverse-relationship-architecture.md` — Dynamics/Dataverse alignment rules
- `docs/crm-foundation.md` — original product direction and open business questions
- `New folder/do this next.txt` — aspirational 19-phase ERP wish list. **Not the roadmap.**
