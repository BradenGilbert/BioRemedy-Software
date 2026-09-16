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
| Browser IndexedDB | As of 2026-09-16: **every core CRM collection has moved to the shared backend** (Phase 01, now complete) — accounts, contacts, projects (formerly `jobs`), tasks, activities, project assignments, project alerts, material usage, equipment logs, scheduled work, spatial data. Only `syncQueue` and `settings` remain per-browser, correctly (device-scoped by definition). |
| Node JSON backend | 83 collections (recounted from source, not running arithmetic — see `docs/database-handoff-map.md`), shared across users — opportunities, facilities, dispatch jobs, work plans, employees, inventory, quotes, invoices, plus everything Phase 01 moved in from IndexedDB. Phase 02 (2026-09-16) renamed `locations`→`facilities` and `mapLocations`→`locations` to match the glossary, and added `facilityContacts`. |
| PostgreSQL schema | 28 migration files, 141 tables, 27 views — **designed, never deployed** |
| `laravel-ready/` | First 12 tables only. Deprecated as of 2026-09-15. |
| Version control | **None.** No git repository. |
| Authentication | None. A role *picker* plus an `X-CRM-Role` request header that the client sets itself. |

### The core problem this roadmap opens by fixing

The CRM's own entities live in the browser while everything they point at lives on the server:

```
  dispatchJobs (server)  ──projectId──►  jobs (browser, private)     ✗ broken across users — FIXED 2026-09-16, jobs migrated + renamed to projects (server)
  opportunities (server) ──accountId──►  accounts (browser, private) ✗ broken across users — FIXED 2026-09-15
```

This was the state when Phase 1 began. As of 2026-09-16, Phase 1 is complete — every core CRM collection this diagram worried about is now server-side and shared.

---

## Stages and phases

### Stage A — One System
Make the application have a single, shared source of truth before building anything else on top of it.

| Phase | Name | Status |
|---|---|---|
| 00 | [Ground Rules & Safety Net](phase-00-ground-rules.md) | ✅ **Complete 2026-09-15** — git + GitHub, backups with tested restore, `CLAUDE.md` |
| 01 | [One Shared Data Layer](phase-01-shared-data-layer.md) | ✅ **Complete 2026-09-16** — every collection migrated, gated by role, and verified live. IndexedDB now holds only device-scoped state (`syncQueue`, `settings`). |

### Stage B — Make the CRM Correct
The felt pain. Almost every item on the 2026-09-15 and 2026-09-16 feedback lists lives here. These are data-model problems wearing UI clothes, which is why they read as "doesn't make sense" rather than as bugs. Phases 06–09 were added 2026-09-16 from a second feedback pass (`bioremedy crm notes 9.16.2026.docx`) that went deep on Opportunities, Dispatch/Operations, and two brand-new modules the owner called out explicitly as needed builds (Quotes/Estimates, Billing/Invoicing).

| Phase | Name | Status |
|---|---|---|
| 02 | [The Places Model — Facility / Address / Location](phase-02-places-model.md) | ✅ **Complete 2026-09-16** — collections renamed, dialogs split, every address type visible, Edit-is-Add fixed, `facility_contacts` junction built, retention fields shipped, account tab consolidated |
| 03 | [Account Domain Correctness](phase-03-account-domain.md) | 🟡 **Partially started 2026-09-16** — header title + Sales "+ Create" dropdown shipped ad hoc; Owner field no longer free text (still not sales-role-filtered, still no `ownerEmployeeId` FK) |
| 04 | [Vendor & Subcontractor](phase-04-vendor-subcontractor.md) | Not started |
| 05 | [Contacts & Activity Timeline](phase-05-contacts-and-timeline.md) | Not started |
| 06 | [Opportunity Domain Correctness](phase-06-opportunity-domain.md) | Not started |
| 07 | [Dispatch & Operations Correctness](phase-07-dispatch-operations.md) | Not started |
| 08 | [Quotes & Estimates](phase-08-quotes-estimates.md) | Not started — new module |
| 09 | [Billing & Invoicing](phase-09-billing-invoicing.md) | Not started — new module |

### Stage C — Pilot-Ready
The gate before real customer data enters the system.

| Phase | Name | Status |
|---|---|---|
| 10 | [Identity, Authorization & Audit](phase-10-identity-and-audit.md) | Not started |
| 11 | [Document Storage](phase-11-documents.md) | Not started |

> ### ◆ PILOT MILESTONE
> After Phase 11, real users can be put on real data safely.

### Stage D — Production Database

| Phase | Name | Status |
|---|---|---|
| 12 | [PostgreSQL Migration](phase-12-postgres-migration.md) | Not started |

### Stage E — Operational Depth
Post-pilot. These are outlines, deliberately not detailed yet — they will be shaped by what the pilot teaches us. The 2026-09-16 feedback pass added enough concrete detail on Front Line and Field Ops that both docs below are now much more than outlines — see each doc's own status line.

| Phase | Name | Status |
|---|---|---|
| 13 | [Front Line — Real Tiles](phase-13-frontline.md) | 🟡 Outline, fleshed out 2026-09-16 with concrete field-app gaps — not yet a session-ready plan |
| 14 | [Field Ops Depth & Reporting](phase-14-field-ops-depth.md) | 🟡 Outline, fleshed out 2026-09-16 with concrete field-app gaps — not yet a session-ready plan |

---

## New tables this roadmap introduces

Most of what's needed already exists in `crm-schema/` — the prototype simply drifted away from it. These are the genuinely **new** structures the 2026-09-15 requirements demand:

| Table / field | Phase | Why |
|---|---|---|
| `facility_contacts` | 02 | ✅ Shipped 2026-09-16 as `facilityContacts`. A contact can work at a facility, and one contact can manage several. |
| GPS `locations.retain_until` + retention policy | 02 | ✅ Shipped 2026-09-16 as `retainUntil`/`retentionReason`/`isTemporary`. Temporary locations (a one-off sample point, a spill origin) must age out after their reporting life. |
| `account_approved_subcontractors` | 04 | Which subs are permitted to work for customer Account X. Customer-specific approval exists nowhere today. |
| `activity_tags` (or `activities.tags[]`) | 05 | Filterable timelines — Personal, Business, Compliance, Safety, Billing. |
| `activities.contactIds` (array, replacing scalar `contactId`) | 05 / 06 | An activity can currently only ever be logged against one contact — confirmed scalar field, needs to become an array. |
| Opportunity-scoped contact relationship tags (Decision Maker, etc.) | 06 | Associated Contacts panel needs real relationship metadata beyond the generic contact record. |
| Quote/Estimate line items (`quoteLines` gets its first real UI) | 08 | The `quotes`/`quoteLines`/`products`/`priceLevels` collections already exist but only a bare lump-sum quote header has any UI. |
| Permit registry + per-job waste tracking | 14 | TCEQ/EPA-driven — BioRemedy's 10-day storage permit, oily waste handler permit, and others need to be tracked and tied to job cost. |
| Identity/RBAC/audit tables | 10 | Listed as Priority 0 in `docs/database-handoff-map.md`; still absent. |
| Generic entity-attachment store | 11 | Every Files tab is an empty stub. |

---

## Already shipped (context for new sessions)

Do not re-plan these. They are done and verified.

- **Account detail page** — 8-tab redesign, header cleanup, activity-dialog overhaul.
- **Contact detail page** — 7-tab redesign; added `contacts.birthday`, `contactEmploymentHistory`, `opportunities.status` with a real `Lost` value.
- **Opportunity detail page** — 5-tab redesign + stage-gate pipeline (2026-08-10), verification gap closed and an off-by-one stage-gate bug fixed (2026-08-17), Summary layout rebuilt into focused panels + metric strip (2026-08-28).
- **Cleanup roadmap, Rounds 1–4** (~50 items across Account, Contact, Opportunity, Operations, Workforce) — all shipped and verified 2026-08-17. Full detail in `docs/dataverse-relationship-architecture.md`.
- **Front Line simulator** — in-browser field-app preview with a working Job Book, template-driven work-plan gating, and typed per-task capture (photo / signature / timer / material / checklist / sample).
- **Dispatch Job Detail** — rebuilt into a tabbed page with real employee/equipment/material pickers.
- **Phase 01 — One Shared Data Layer** — every core CRM collection (accounts, contacts, projects, tasks, activities, project assignments/alerts, material usage, equipment logs, scheduled work, spatial data) migrated from per-browser IndexedDB to the shared JSON backend, role-gated, and verified live 2026-09-16. IndexedDB now holds only device-scoped state.
- **Phase 02 — The Places Model** — `locations`/`mapLocations` renamed to `facilities`/`locations` to match the glossary (with every FK renamed alongside), the combined Facility/GPS dialog split in two, every address type now visible (not just Bill To), the Edit-is-Add billing-address bug fixed, facility `status`→`badge`, a new `facilityContacts` junction (contact works-at/manages facility) surfaced on both the facility and contact pages, retention fields on temporary GPS locations with a 24-month default, and the account page consolidated into one "Locations & Addresses" tab. Verified live 2026-09-16.

## Known-open items carried in from previous work

These are real, already-diagnosed, and slotted into phases below rather than being lost:

| Item | Slotted into |
|---|---|
| `projects.projectStage` (formerly `jobs.projectStage`) is written at creation but **never read** — the stage ladder and gate both key off free-text `status`/`activePhase` heuristics | Phase 14 — likely the same root cause as the 2026-09-16 note "project status never moves to mobilize or field work" (Phase 07 item 11) and "job status progression does not move along with work plan completion" (Phase 13); consolidate into one fix, don't debug three times |
| `equipmentAssets.assignedJobId` (a different, still-server-side collection from the migrated `equipmentLogs`) still holds an unrenamed project reference under the old `jobId`-era naming; currently dead/unread | Unslotted — flag when next touching `equipmentAssets` |
| `laborResources` was retired in code but 5 stale rows remain in `data/backend.json` | Phase 01 |
| ~~Dead `opportunities` IndexedDB store declaration still in `openDatabase()`~~ | ✅ Removed 2026-09-16, alongside the dead local `projects` store, as part of the `jobs`→`projects` migration |
| `activities` vs `sales_tasks` architectural divergence | Phase 05 (tags now, split deferred — see phase doc) |
| `job_resource_allocations.vendor_account_id` points straight at `accounts` instead of a subcontractor assignment | Phase 04 |
| Attachment inline-view route is not role-gated (relies on opaque IDs) | Phase 10 |
| QuickBooks integration is a mock export queue | Phase 14 |

---

## Source documents

- `docs/database-handoff-map.md` — full inventory: SQL tables, prototype collections, what still needs tables
- `docs/erp-operational-architecture.md` — workforce, dispatch, execution, Front Line contracts; migrations 018–025
- `docs/dataverse-relationship-architecture.md` — Dynamics/Dataverse alignment rules; migrations 015, 026–028
- `docs/crm-foundation.md` — original product direction and open business questions
- `bioremedy crm notes 9.16.2026.docx` (project root) — second feedback pass, 2026-09-16. ~70 items, mostly Opportunity/Contact/Dispatch bugs plus two explicitly-flagged new modules (Quotes/Estimates, Billing/Invoicing). Fed Phases 03–09, 11, 13, 14 in this revision. Items were verified against running code before being written into phase docs where feasible — see each phase's own citations; Phase 07 and most of Phase 13/14's additions are **not yet verified**, only transcribed, and say so explicitly in their own docs.
- `New folder/do this next.txt` — the aspirational 19-phase full-ERP vision. **Not this roadmap.** Useful as a long-range wish list only.
