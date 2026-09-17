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
| Node JSON backend | 85 collections (recounted from source, not running arithmetic — see `docs/database-handoff-map.md`), shared across users — opportunities, facilities, dispatch jobs, work plans, employees, inventory, quotes, invoices, plus everything Phase 01 moved in from IndexedDB. Phase 02 (2026-09-16) renamed `locations`→`facilities` and `mapLocations`→`locations` to match the glossary, and added `facilityContacts`. Phase 03 (2026-09-16) added `facilityComments`. Phase 04 (2026-09-17) added `accountApprovedSubcontractors`. |
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
| 03 | [Account Domain Correctness](phase-03-account-domain.md) | 🟢 **Nearly complete 2026-09-16** — Create Account form rebuilt, industry editing wired up, owner FK written, Account/Contact-detail "+ Create" menus shipped, facility-contact edit/remove shipped, new Facility detail page (satellite map, prior work history, site notes) shipped, new Account "Contacts" tab shipped, full 72-panel edit-button audit done (2 real bugs found and fixed: a Contact `accountRole` data-corruption bug and an Opportunity quote "Current" reassignment bug). Only 2 items left, both blocked on the owner: list-filter-cleanup ambiguity (item 6) and an unresolved "remove the Account Table" note (item 7) |
| 04 | [Vendor & Subcontractor](phase-04-vendor-subcontractor.md) | 🟢 **Most items done 2026-09-17** — new "Vendor & Subcontractor" account tab (Compliance & Paperwork, Approved Subcontractors, Service Agreements, Subcontractor Assignments), subcontractor language stripped from Company Profile, new `accountApprovedSubcontractors` Layer 2, vendor compliance approvals now attribute to real employees, A–F performance rating, auto-suggested Vendor ID, expiry badge on account header. Not done: the dispatch-time approval check and real vendor FK on dispatch resources (item 5 — bigger than planned, touches Phase 07 too), upload+review workflows (blocked on Phase 11), rate-card items (blocked on Phase 08) |
| 05 | [Contacts & Activity Timeline](phase-05-contacts-and-timeline.md) | 🟢 **Most items done 2026-09-17** — fixed a live data-loss bug (colliding contact notes fields), fixed contact owner defaulting/silent-reset bugs, account-less contacts now supported, facility↔contact links now clickable, Account and Contact "upcoming" panels now include activities not just tasks, and fixed an app-wide bug where every search-as-you-type box lost keyboard focus after one keystroke. Not done: activity tagging system, shared opportunity-lookup component (also needed by Phases 03/04), timeline filter-by-person/related/type |
| 06 | [Opportunity Domain Correctness](phase-06-opportunity-domain.md) | 🟢 **Substantial progress 2026-09-17** — fixed the create-opportunity navigation bug, consolidated two parallel/non-synced "associated contact" systems onto the one that actually worked (fixing the wrong-edit-dialog bug, the "editing a contact drops other opportunities" data-loss bug, and adding a proper add/remove/"Formerly Associated" UI in one pass), added Open Project button, fixed a floating-checkbox CSS bug, removed boxy button styling from two badge lists, replaced the exact-date close date with a coarser `closeQuarter` field (owner decision, migrated existing data). Remaining items need owner decisions (Opportunity Type vocabulary, "Regarding" field) or are standalone builds (multi-contact activities, site-walk scheduling, advance-button validation highlighting) |
| 07 | [Dispatch & Operations Correctness](phase-07-dispatch-operations.md) | 🟢 **Verification pass + fixes shipped 2026-09-17** — 9 of 13 items confirmed against code and fixed (worker-assignment CSS layout, duplicate dispatch-job double-submit, back-to-project button, calendar "Ready"-instead-of-"Completed" readiness bug, sample lab assignment/results UI, material over-reservation warning, credential renew-in-place, project stage now advances with dispatch status, project intake site now defaults from the opportunity's facility). Deferred: resource-planning UX decision (4), Front Line photo-capture coordination (7), template rebuild scope (8) |
| 08 | [Quotes & Estimates](phase-08-quotes-estimates.md) | ✅ **Shipped 2026-09-17** — real line-item builder for both Quote and Estimate (two separate documents, owner decision), new Rate Card admin screen (products/units/price levels) now the single source of truth Phase 04's vendor-compliance and service-agreement panels already read, project value now defaults from the linked quote/estimate total when creating a project from a Won opportunity |
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

- **Account detail page** — originally an 8-tab redesign with header cleanup and activity-dialog overhaul; a 9th tab (Contacts) was added in Phase 03 (2026-09-16).
- **Contact detail page** — 7-tab redesign; added `contacts.birthday`, `contactEmploymentHistory`, `opportunities.status` with a real `Lost` value.
- **Opportunity detail page** — 5-tab redesign + stage-gate pipeline (2026-08-10), verification gap closed and an off-by-one stage-gate bug fixed (2026-08-17), Summary layout rebuilt into focused panels + metric strip (2026-08-28).
- **Cleanup roadmap, Rounds 1–4** (~50 items across Account, Contact, Opportunity, Operations, Workforce) — all shipped and verified 2026-08-17. Full detail in `docs/dataverse-relationship-architecture.md`.
- **Front Line simulator** — in-browser field-app preview with a working Job Book, template-driven work-plan gating, and typed per-task capture (photo / signature / timer / material / checklist / sample).
- **Dispatch Job Detail** — rebuilt into a tabbed page with real employee/equipment/material pickers.
- **Phase 01 — One Shared Data Layer** — every core CRM collection (accounts, contacts, projects, tasks, activities, project assignments/alerts, material usage, equipment logs, scheduled work, spatial data) migrated from per-browser IndexedDB to the shared JSON backend, role-gated, and verified live 2026-09-16. IndexedDB now holds only device-scoped state.
- **Phase 02 — The Places Model** — `locations`/`mapLocations` renamed to `facilities`/`locations` to match the glossary (with every FK renamed alongside), the combined Facility/GPS dialog split in two, every address type now visible (not just Bill To), the Edit-is-Add billing-address bug fixed, facility `status`→`badge`, a new `facilityContacts` junction (contact works-at/manages facility) surfaced on both the facility and contact pages, retention fields on temporary GPS locations with a 24-month default, and the account page consolidated into one "Locations & Addresses" tab. Verified live 2026-09-16.
- **Phase 03 — Account Domain Correctness (nearly complete)** — Create Account form rebuilt (no forced facility, real industry picker, sales-role-filtered `ownerEmployeeId` FK, inline optional address capture), industry editing reachable from Company Profile, context-aware "+ Create" menus on Account/Contact detail pages, facility-contact add/edit/remove, a new Facility detail page (location, contacts, site notes, satellite map via Esri imagery, prior work history), a new Account "Contacts" tab (full org contact directory), and a full 72-panel edit-button audit across Account/Contact/Opportunity detail pages that found and fixed two real bugs (a Contact `accountRole` data-corruption bug and an Opportunity quote "Current"-reassignment bug) plus flagged a structural Opportunity-dialog gap into Phase 06. Verified live 2026-09-16. Only 2 items left, both blocked on owner clarification, not engineering — see the phase doc.
- **Phase 04 — Vendor & Subcontractor (most items done)** — new "Vendor & Subcontractor" account tab (Compliance & Paperwork, Approved Subcontractors, Service Agreements, Subcontractor Assignments) split out of the old catch-all Details tab; subcontractor fields stripped out of Company Profile; new Layer 2 `accountApprovedSubcontractors` collection (per-customer vendor approval, distinct from a vendor's own blanket compliance standing); vendor-compliance approvals now attribute to real employees instead of a near-empty `systemUsers` table; performance rating is a real A–F dropdown; Vendor ID auto-suggests as `VEND-####`; an expiry badge surfaces on the account header when insurance or a customer approval is expired/expiring; the three-way "who's whose customer/vendor" document-tracking confusion (item 13) was resolved and documented rather than guessed at. Verified live 2026-09-17. Remaining items are blocked on Phase 07 (dispatch resource linkage), Phase 08 (rate cards), or Phase 11 (document uploads) — see the phase doc's status line.
- **Phase 05 — Contacts & Activity Timeline (most items done)** — fixed a confirmed live data-loss bug (a contact's personal note was silently truncated whenever the general contact dialog was saved afterward — both wrote to the same field); fixed two contact-owner bugs (new contacts inherited the logged-in demo session's name instead of the account's real owner; saving the Role & Account dialog could silently wipe a real owner to "Unassigned"); account-less contacts are now supported (regulators, referrals, third-party inspectors); facility↔contact links (built in Phase 02) are now clickable; the Account and Contact "upcoming" panels now include activities with due dates, not just `tasks`-collection rows; and a systemic bug was found and fixed where every search-as-you-type input in the app (not just the one this phase's notes complained about) lost keyboard focus after exactly one keystroke, because every render function replaces the DOM wholesale with no focus/selection restoration — one shared fix now covers all of them. Verified live 2026-09-17. Not done: the activity-tagging system and the shared opportunity-lookup component (item 4, also needed by Phases 03/04) are both real standalone builds, deliberately not started rather than half-built.
- **Phase 08 — Quotes & Estimates** — built the real line-item builder that the existing Quote stub was missing (product-or-free-text, quantity, unit, rate, computed line and document totals), and reconnected `renderOpportunityProposalDocumentsTab()`/`openOpportunityQuoteDialog()`/`saveOpportunityQuote()` to it instead of a hand-typed lump sum; per an explicit owner decision, Quote and Estimate are two separate documents (new `estimates`/`estimateLines` collections mirroring `quotes`/`quoteLines`), sharing one line-item builder component; built a new Rate Card admin screen (products, units of measure, price levels) that is now the single source of truth Phase 04's vendor-compliance and service-agreement panels already read from; project creation from a Won opportunity now defaults its value from the linked quote (preferred) or estimate total, falling back to the pre-existing manual entry when neither exists; found and fixed a real bug in the process (existing quotes never got marked "current" on their opportunity unless freshly created, which also silently blocked the Negotiation stage gate's Quote requirement). Verified live 2026-09-17.
- **Phase 07 — Dispatch & Operations Correctness (verification pass + fixes)** — this phase started with a code-verification pass (unlike Phases 03–06, its items were only transcribed from notes, not pre-verified) and fixed 9 of 13 items: a CSS selector/markup mismatch that crunched the dispatch board's worker-assignment row to the left (same shape of bug as Phase 06 item 14); a double-submit race in `convertJobRequest()` that could create two `dispatchJobs` records from one job request (confirmed live in existing seed data — six near-duplicate jobs on one project); a missing "Back to project" button on Dispatch Job Detail; a missing terminal-status branch in `getJobReadiness()` that showed closed/completed jobs as "Ready" everywhere a readiness badge renders (the notes' "Yeady" was almost certainly a mishearing of "Ready," not a literal string in the app); a new office-side "assign lab / report results" dialog for sample records (fields already existed, no UI to set them); a warn-but-allow check on material reservations against `inventoryItems.onHand` (owner decision: warn, not block); an in-place "renew/update" path for expired credentials (the only prior path always created a duplicate row instead of clearing the old one); the long-standing known-open `projects.projectStage` "written but never read" bug, now read by the stage ladder and advanced automatically as a linked dispatch job's status changes; and a project-creation bug where the intake "Site" defaulted to an arbitrary account facility instead of the one actually selected on the opportunity. Verified live via Playwright for all but two sub-parts (Front Line Timer-task hours propagation and a full opportunity-to-Won UI walkthrough for the facility-default fix), which were verified by code trace instead and flagged as such. Deferred: resource-planning UX (item 4, needs an owner decision), Front Line photo-capture task type (item 7, coordinate with Phase 13), and job-template rebuild scope (item 8, revisit after Phase 13/14 are further along).
- **Phase 06 — Opportunity Domain Correctness (substantial progress)** — fixed the always-fails opportunity-creation navigation bug; found and fixed the real architectural problem behind three separate roadmap items at once — "Associated Contacts" (Summary tab) and "Stakeholders" (Develop & Planning tab) were two independent, non-synced systems for the same relationship, one of them buggy (editing a contact could silently drop its other opportunity associations) and pointed at the wrong edit dialog. Consolidated onto the working system, which also happened to already have the "Decision Maker" tag vocabulary a separate item wanted built from scratch. Added an "Open Project" button next to the existing "Open Account" one, fixed a CSS class typo that made a checkbox float away from its label, and replaced boxy blue button-styled tags with plain clickable text links in two places. Verified live 2026-09-17. Close date was later replaced with a coarser `closeQuarter` field the same day, per an owner decision (see the phase doc's item 1). Remaining items need an owner decision (Opportunity Type vocabulary) or are standalone builds not started this session (multi-contact activities, site-walk scheduling, advance-button validation highlighting).

## Known-open items carried in from previous work

These are real, already-diagnosed, and slotted into phases below rather than being lost:

| Item | Slotted into |
|---|---|
| ~~`projects.projectStage` (formerly `jobs.projectStage`) is written at creation but never read~~ | ✅ Fixed 2026-09-17 in Phase 07 (item 11): `getJobProgress()` now reads `projectStage` when present, and dispatch-status transitions write it forward via `advanceProjectStageFromDispatchStatus`. The related Phase 13 note ("job status progression does not move along with work plan completion") may still need its own check once Phase 13 work starts — this fix covers the dispatch-job-status → project-stage path, not work-plan-completion → project-stage |
| `equipmentAssets.assignedJobId` (a different, still-server-side collection from the migrated `equipmentLogs`) still holds an unrenamed project reference under the old `jobId`-era naming; currently dead/unread | Unslotted — flag when next touching `equipmentAssets` |
| `laborResources` was retired in code but 5 stale rows remain in `data/backend.json` | Phase 01 |
| ~~Dead `opportunities` IndexedDB store declaration still in `openDatabase()`~~ | ✅ Removed 2026-09-16, alongside the dead local `projects` store, as part of the `jobs`→`projects` migration |
| `activities` vs `sales_tasks` architectural divergence | Phase 05 (tags now, split deferred — see phase doc) |
| `job_resource_allocations.vendor_account_id` points straight at `accounts` instead of a subcontractor assignment — corrected 2026-09-17: the running JSON prototype's `jobResources` has no such FK at all (free-text vendor name today), so this is a from-scratch build in the prototype, not just the SQL schema | Phase 04 (not yet started — see that phase doc's item 5) |
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
