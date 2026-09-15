# BioRemedy Platform — Master Roadmap

**Created:** 2026-09-15
**Owner:** Braden Gilbert
**Status of this document:** Active. This is the top-level plan. Each phase has its own detailed map in this folder.

---

## How to use these documents

This folder exists so that **any session — human or AI — can pick up work without re-deriving context.**

- **This file** is the map of the whole journey: stages, phases, sequencing, and current status.
- **`GLOSSARY.md`** is the naming contract. Read it before touching any entity. The single biggest source of confusion in this codebase is that the same concept has different names in different layers.
- **`phase-NN-*.md`** files are the detailed maps. Each one is scoped tightly to a single phase so a session can load just that file and have everything it needs.

**Rules for keeping this useful:**

1. When a phase ships, update its `**Status:**` line *and* the status table below, in the same session.
2. When implementation contradicts the plan, **correct the plan document** — do not leave the correction only in chat. This project has a history of plan documents being written from research and then being wrong at implementation time (see the `projectStage` and `crewMemberships` corrections in `docs/dataverse-relationship-architecture.md`). Every phase doc has a "Corrections found during implementation" section for this.
3. When a phase adds fields or collections, update `docs/database-handoff-map.md` in the same session.
4. Do not start a phase whose dependencies have not shipped.

---

## The goal

**Within ~3 months: a pilot with real users doing real work on real data.**

That target drives every sequencing decision below. Notably, it means **the PostgreSQL migration is not on the critical path.** The JSON backend can carry a small pilot if it is shared, backed up, and behind a real login. Postgres is the blocker for *production and scale*, not for *pilot*.

### Stack decision (locked 2026-09-15)

**Node + PostgreSQL.** The existing `server.mjs` grows into the real API. Same language as the front end, and the existing role-gated collection routes are already the right shape for the API skeleton.

This means `laravel-ready/` is **deprecated**. It converted only the first 12 of 141 tables and has not been touched since. It stays on disk for reference but is not a build target. Do not add to it.

---

## Where we actually are today

| Layer | State |
|---|---|
| Browser IndexedDB | 14 stores holding **accounts, contacts, projects, jobs, tasks, activities**, alerts, material usage, equipment logs, spatial data, scheduled work, project assignments — all **per-browser, not shared** |
| Node JSON backend | 72 collections, shared across users — opportunities, facilities, dispatch jobs, work plans, employees, inventory, quotes, invoices |
| PostgreSQL schema | 28 migration files, 141 tables, 27 views — **designed, never deployed** |
| `laravel-ready/` | First 12 tables only. Deprecated as of 2026-09-15. |
| Version control | **None.** No git repository. |
| Authentication | None. A role *picker* plus an `X-CRM-Role` request header that the client sets itself. |

### The core problem this roadmap opens by fixing

The CRM's own entities live in the browser while everything they point at lives on the server:

```
  dispatchJobs (server)  ──projectId──►  jobs (browser, private)     ✗ broken across users
  opportunities (server) ──accountId──►  accounts (browser, private) ✗ broken across users
```

When the team tests through the Cloudflare tunnel, **everyone gets their own private accounts and contacts but a shared dispatch board.** Phase 1 exists to end this.

---

## Stages and phases

### Stage A — One System
Make the application have a single, shared source of truth before building anything else on top of it.

| Phase | Name | Status |
|---|---|---|
| 00 | [Ground Rules & Safety Net](phase-00-ground-rules.md) | ✅ Done 2026-09-15 — git, `.gitignore`, backups + tested restore, `CLAUDE.md`. Only the first `git push` is outstanding. |
| 01 | [One Shared Data Layer](phase-01-shared-data-layer.md) | Not started |

### Stage B — Make the CRM Correct
The felt pain. Almost every item on the 2026-09-15 feedback list lives here. These are data-model problems wearing UI clothes, which is why they read as "doesn't make sense" rather than as bugs.

| Phase | Name | Status |
|---|---|---|
| 02 | [The Places Model — Facility / Address / Location](phase-02-places-model.md) | Not started |
| 03 | [Account Domain Correctness](phase-03-account-domain.md) | Not started |
| 04 | [Vendor & Subcontractor](phase-04-vendor-subcontractor.md) | Not started |
| 05 | [Contacts & Activity Timeline](phase-05-contacts-and-timeline.md) | Not started |

### Stage C — Pilot-Ready
The gate before real customer data enters the system.

| Phase | Name | Status |
|---|---|---|
| 06 | [Identity, Authorization & Audit](phase-06-identity-and-audit.md) | Not started |
| 07 | [Document Storage](phase-07-documents.md) | Not started |

> ### ◆ PILOT MILESTONE
> After Phase 07, real users can be put on real data safely.

### Stage D — Production Database

| Phase | Name | Status |
|---|---|---|
| 08 | [PostgreSQL Migration](phase-08-postgres-migration.md) | Not started |

### Stage E — Operational Depth
Post-pilot. These are outlines, deliberately not detailed yet — they will be shaped by what the pilot teaches us.

| Phase | Name | Status |
|---|---|---|
| 09 | [Front Line — Real Tiles](phase-09-frontline.md) | Outline only |
| 10 | [Field Ops Depth & Reporting](phase-10-field-ops-depth.md) | Outline only |

---

## New tables this roadmap introduces

Most of what's needed already exists in `crm-schema/` — the prototype simply drifted away from it. These are the genuinely **new** structures the 2026-09-15 requirements demand:

| Table / field | Phase | Why |
|---|---|---|
| `facility_contacts` | 02 | A contact can work at a facility, and one contact can manage several. No junction exists anywhere today. |
| `job_sites.retain_until` + retention policy | 02 | Temporary locations (a one-off sample point, a spill origin) must age out after their reporting life. `is_temporary` exists; a retention rule does not. |
| `account_approved_subcontractors` | 04 | Which subs are permitted to work for customer Account X. Customer-specific approval exists nowhere today. |
| `activity_tags` (or `activities.tags[]`) | 05 | Filterable timelines — Personal, Business, Compliance, Safety, Billing. |
| Identity/RBAC/audit tables | 06 | Listed as Priority 0 in `docs/database-handoff-map.md`; still absent. |
| Generic entity-attachment store | 07 | Every Files tab is an empty stub. |

---

## Already shipped (context for new sessions)

Do not re-plan these. They are done and verified.

- **Account detail page** — 8-tab redesign, header cleanup, activity-dialog overhaul.
- **Contact detail page** — 7-tab redesign; added `contacts.birthday`, `contactEmploymentHistory`, `opportunities.status` with a real `Lost` value.
- **Opportunity detail page** — 5-tab redesign + stage-gate pipeline (2026-08-10), verification gap closed and an off-by-one stage-gate bug fixed (2026-08-17), Summary layout rebuilt into focused panels + metric strip (2026-08-28).
- **Cleanup roadmap, Rounds 1–4** (~50 items across Account, Contact, Opportunity, Operations, Workforce) — all shipped and verified 2026-08-17. Full detail in `docs/dataverse-relationship-architecture.md`.
- **Front Line simulator** — in-browser field-app preview with a working Job Book, template-driven work-plan gating, and typed per-task capture (photo / signature / timer / material / checklist / sample).
- **Dispatch Job Detail** — rebuilt into a tabbed page with real employee/equipment/material pickers.

## Known-open items carried in from previous work

These are real, already-diagnosed, and slotted into phases below rather than being lost:

| Item | Slotted into |
|---|---|
| `jobs.projectStage` is written at creation but **never read** — the stage ladder and gate both key off free-text `status`/`activePhase` heuristics | Phase 10 |
| `crewMemberships` is a dead join table (4 frozen seed rows); one bad consumer was fixed, the collection was not retired | Phase 01 |
| `laborResources` was retired in code but 5 stale rows remain in `data/backend.json` | Phase 01 |
| Dead `opportunities` IndexedDB store declaration still in `openDatabase()` | Phase 01 |
| `activities` vs `sales_tasks` architectural divergence | Phase 05 (tags now, split deferred — see phase doc) |
| `job_resource_allocations.vendor_account_id` points straight at `accounts` instead of a subcontractor assignment | Phase 04 |
| Attachment inline-view route is not role-gated (relies on opaque IDs) | Phase 06 |
| QuickBooks integration is a mock export queue | Phase 10 |

---

## Source documents

- `docs/database-handoff-map.md` — full inventory: SQL tables, prototype collections, what still needs tables
- `docs/erp-operational-architecture.md` — workforce, dispatch, execution, Front Line contracts; migrations 018–025
- `docs/dataverse-relationship-architecture.md` — Dynamics/Dataverse alignment rules; migrations 015, 026–028
- `docs/crm-foundation.md` — original product direction and open business questions
- `New folder/do this next.txt` — the aspirational 19-phase full-ERP vision. **Not this roadmap.** Useful as a long-range wish list only.
