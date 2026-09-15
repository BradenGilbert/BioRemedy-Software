# Glossary — The Naming Contract

**Read this before touching any entity.** The same concept currently has up to four different names depending on which layer you are in. That is the single biggest source of "this doesn't make sense" in this codebase.

The **Target name** column is what everything should converge on. Where the prototype disagrees with `crm-schema/`, **the SQL schema wins** — it was designed deliberately, and the prototype drifted away from it.

---

## The Places Model — three genuinely different things

This is the most important section in this document. These three were collapsed into one confused pile in the prototype. They are not the same concept and must never be merged.

### FACILITY — *a physical place where work can happen*

Implies a structure or a yard. Has exactly **one** address. Contacts can work at it, and one contact can manage several of them.

- **Target table:** `facilities` (`crm-schema/003_facilities.sql` — already exists)
- **Prototype today:** the JSON collection confusingly named `locations` (6 records)
- Examples: a customer's maintenance depot, a warehouse, a corporate office, a treatment yard

### ADDRESS — *a postal record*

Street, city, postal code. Has a contact person or contact info. Exists for a **reason** — Bill-To, Ship-To, Remit-To, Tax, Vendor Dispatch. A facility has one. A billing office that nobody ever visits also has one.

- **Target table:** `addresses` (`crm-schema/026_account_relationship_extensions.sql` — already exists, **0 rows, no UI**)
- **Prototype today:** partly the legacy `accounts.billing_address_*` columns, partly `customer_addresses`, partly flattened onto the `locations` collection
- The `address_type` enum already exists and is correct: `Bill To`, `Ship To`, `Primary`, `Tax`, `Remit-To`, `Vendor Dispatch`, `Vendor Billing`, `Other`

### LOCATION — *a GPS point*

**Not tied to a postal box.** Given to crews to identify an exact spot. Where a sample was taken, where a spill is, where waste was picked up or dropped, where a truck is parked, a destination.

- **Target table:** `job_sites` (`crm-schema/005_job_sites.sql` — already exists, already has `latitude`/`longitude`, `linear_reference` for highway mile markers, and `is_temporary`)
- **Prototype today:** the JSON collection `mapLocations` (4 records)
- **Permanence matters:** some locations belong to the account forever; some (a one-off sample point) should age out after their reporting life. `is_temporary` exists; the retention rule does not yet — added in Phase 02.

> **The rule:** Everything can have a *location*. Only things that get mailed, billed, shipped, or taxed need an *address*. Only places where work physically happens are *facilities*.

**Naming hazard:** the prototype's `locations` collection is really *facilities*, and the prototype's `mapLocations` is really *locations*. Phase 02 renames both. Until it ships, always confirm which one a piece of code means.

---

## Work hierarchy — the other big naming collision

| Concept | SQL (target) | JSON backend | IndexedDB | Plain English |
|---|---|---|---|---|
| Customer engagement | `projects` | — | `jobs` ⚠️ | The whole piece of work sold to a customer |
| Sales request into dispatch | `job_requests` | `jobRequests` | — | "Ops, please schedule this" |
| One dispatchable work packet | `work_orders` | `dispatchJobs` | — | One crew, one visit, one packet of work |
| A phase inside a work packet | `job_step_definitions` → `job_step_instances` | `jobSteps` | — | Mobilize, Excavate, Demobilize |
| One executable instruction | `job_action_definitions` → `job_action_instances` | `jobActions` | — | "Take 4 photos", "Collect a sample" |

⚠️ **`jobs` in IndexedDB means PROJECTS.** It does not mean dispatch jobs. This single collision has already caused at least one planning error (the Site Calendar was assumed to link to `dispatchJobs` when its data actually came from `jobs`/projects). Phase 01 renames it to `projects`.

---

## Sales entities

| Concept | SQL | JSON backend | IndexedDB | Notes |
|---|---|---|---|---|
| Account | `accounts` | — | `accounts` ⚠️ | Browser-local today. Moves to server in Phase 01. |
| Contact | `contacts` | — | `contacts` ⚠️ | Browser-local today. Moves in Phase 01. |
| Opportunity | `opportunities` | `opportunities` | *(dead store)* | Already on the server. The IndexedDB store declaration is a leftover; removed in Phase 01. |
| Quote | `quotes` | `quotes` | — | |
| Lead | `leads` | `leads` | — | |

---

## Activity vs Task — an unresolved split

Three different things share overlapping names. Do not guess which one you want.

| Table | What it actually is | Status |
|---|---|---|
| `activities` (`014`) | The older generic Meeting/Call/Email/Task/Note timeline | **In use.** Docs call it legacy, but all current UI is built on it. |
| `sales_tasks` (`028`) | A dedicated Dataverse-shaped `Activity`-type Task table | **Defined, 0 rows, no UI.** The intended go-forward home for tasks. |
| `tasks` (`008`) | Operational work-order checklist items | Different concept entirely. Not a sales task. |

**Current decision (Phase 05):** keep building on `activities` and add tagging. Do **not** start the split into dedicated per-type Activity tables yet — revisit once the pilot shows whether the generic table is actually a problem in practice. This is a deliberate deferral, recorded so it isn't re-litigated every session.

---

## Workforce

| Concept | Meaning |
|---|---|
| `system_users` | *Who can sign in.* Identity. |
| `employees` | *Who can be scheduled and perform work.* An employee can exist with no application access. |
| `teams` | **Organizational.** A reporting group. |
| `crews` | **Operational.** A dispatchable field group. |
| `job_assignments` | The final record of who was actually scheduled — even when it originated from a crew. |

**Retired / dead:**
- `laborResources` — retired 2026-08-17. Duplicated real people from `employees` under unlinked IDs. 5 stale rows still sit in `data/backend.json`; cleaned in Phase 01.
- `crewMemberships` — a dead join table never written to (frozen at 4 seed rows). Crew membership derives live from `employees.crewId`. Retired in Phase 01.

---

## Status fields that must never be collapsed

From `docs/erp-operational-architecture.md`:

- `work_orders.status` — the **job** lifecycle
- `job_assignments.assignment_status` — the **worker's** lifecycle
- `dispatch_status` — **delivery/coordination** state

These are three independent axes. Collapsing them into one field will break the dispatch board.

---

## Deprecated

| Thing | Why | Replacement |
|---|---|---|
| `laravel-ready/` | Only 12 of 141 tables converted; untouched since. Stack decision is Node + Postgres. | `server.mjs` grows into the real API |
| `accounts.address_one_*`, `accounts.address_two_*`, `accounts.billing_address_*` | Legacy flat address columns | `addresses` (026) |
| `accounts.industry` (free text) | Free text, unusable for reporting | `account_industries` + `industries` (8 curated values already seeded) |
| `locations.category = "Billing Address"` | Retired 2026-08-17 — `addresses.address_type` owns the billing-role concept | `addresses.address_type` |
