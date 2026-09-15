# Phase 01 — One Shared Data Layer

**Status:** Not started
**Depends on:** Phase 00 (git + backups must exist before this phase mutates persistence)
**Estimated sessions:** 2–3
**Unblocks:** Every phase after this one. Nothing in Stage B is trustworthy while core records are per-browser.

---

## Why this phase exists

The CRM's own entities live in the browser. Everything they point at lives on the server.

```
  dispatchJobs (server)  ──projectId──►  jobs (browser, private)     ✗
  opportunities (server) ──accountId──►  accounts (browser, private) ✗
  sampleRecords (server) ──jobId─────►  jobs (browser, private)      ✗
```

When the team tests through the Cloudflare tunnel, each person gets **their own private accounts, contacts, projects, tasks, and activities** while sharing the dispatch board, employees, and inventory. Two people cannot discuss the same account. A dispatch job's `projectId` resolves for the person who created the project and for nobody else.

`docs/crm-foundation.md` has said from the beginning that *"production data should live in a server database; IndexedDB is only the local offline cache."* This phase finally makes that true.

**There is a proven pattern for this in the codebase already** — `sampleRecords` (2026-08-16) and `locations` (2026-08-17) were both migrated IndexedDB → JSON backend successfully. Follow those.

---

## In scope

### 1. Migrate these stores to the JSON backend

| IndexedDB store | Target collection | Notes |
|---|---|---|
| `accounts` | `accounts` | The big one. ~40 call sites use `putRecord("accounts", …)`. |
| `contacts` | `contacts` | |
| `jobs` | **`projects`** | ⚠️ Renamed. See "The projects/jobs collision" below. |
| `projectAssignments` | `projectAssignments` | The Project Assignment junction the original design asked for. |
| `tasks` | `tasks` | |
| `activities` | `activities` | |
| `projectAlerts` | `projectAlerts` | Field alerts must be visible to the office — they are useless device-local. |
| `materialUsage` | `materialUsage` | Needed for job-cost-vs-quote comparison. |
| `equipmentLogs` | `equipmentLogs` | |
| `scheduledWork` | `scheduledWork` | |
| `spatialData` | `spatialData` | Metadata only; large files were never meant to live here. |

### 2. Delete dead stores

| Store | Why |
|---|---|
| `opportunities` (IndexedDB) | Dead declaration. Opportunities moved to the server 2026-08-10; the store is created on upgrade and never written to. Remove from the list in `openDatabase()` (`app.js:1624`). |
| `projects` (IndexedDB) | **A hardcoded 3-row seed list with zero writes anywhere in the app.** See below. |

### 3. Clean up retired data

| Item | Action |
|---|---|
| `laborResources` (5 rows in `data/backend.json`) | Retired in code 2026-08-17 but the rows remain. Delete them and the collection. |
| `crewMemberships` (4 frozen seed rows) | Dead join table, never written to. Crew membership derives live from `employees.crewId`. Retire the collection. |

### 4. Keep these local — correctly

| Store | Why it stays in IndexedDB |
|---|---|
| `settings` | Device/user preference. Correct as local. |
| `syncQueue` | Device-scoped outbox. Correct as local by definition. |

### 5. Re-establish IndexedDB as a cache, not a source of truth

After migration, IndexedDB should hold a *read cache* of server data plus the offline outbox — the architecture `docs/crm-foundation.md` always described. **Do not** leave a second writable copy of business data in the browser; that is how the split-brain happened.

---

## The projects / jobs collision

This needs a decision applied consistently, because it is the messiest part of the phase.

**Today:**

| Store | What it actually holds | Writes? |
|---|---|---|
| `jobs` | **Active** customer engagements — `jobClass`, `status`, `activePhase`, PM, sales lead, dates, budget, `notToExceed`, margin | Yes, 5 write sites |
| `projects` | **Completed** past work — `name`, `serviceType`, `completedDate`, `value`, `outcome` | **None. Ever.** |

So the Account page's "Previous Projects" panel renders three hardcoded demo rows and **can never grow** — when a real job finishes, nothing moves it there. The two stores are the same entity split by lifecycle, with the history half being a dead end.

**Resolution:**

1. `jobs` → renamed to `projects`, matching SQL `projects` (`crm-schema/006_projects.sql`) and the glossary.
2. The old `projects` store is deleted. Its three seed rows are either discarded or converted into completed `projects` records with a real status.
3. "Previous Projects" becomes a **filter** (`status = Complete`), not a separate table.
4. Confirm the completion fields the history panel needs (`completedDate`, `outcome`, final `value`) exist on the project record — add them if not.

This also finally makes `dispatchJobs.projectId` mean something unambiguous.

---

## Out of scope

- **PostgreSQL.** This phase moves data to the *existing* JSON backend, not to a real database. That is Phase 08.
- **Authentication.** Records become shared, but there is still no login. That is Phase 06, and it is the gate before real customer data.
- **Offline sync semantics** — conflict rules, version numbers, ID reconciliation. The sync queue keeps working as-is. Real offline sync is a Stage E concern.
- Any UI redesign. This phase should be invisible except that other people's records now appear.

---

## Data model changes

- 11 collections added to `data/backend.json` and to the role-gated route table in `server.mjs`
- `jobs` renamed `projects`; old `projects` retired
- `opportunities` IndexedDB store declaration removed
- `laborResources` and `crewMemberships` collections retired
- Possible new fields on `projects` for completion history (`completedDate`, `outcome`)

**Update `docs/database-handoff-map.md`** in the same session — its IndexedDB (15 stores) and JSON backend (72 collections) inventories both change substantially.

---

## Suggested sequence

Do not do all eleven at once. Migrate in dependency order, verifying each:

1. **`accounts`** first — everything references it, and it is the highest-value proof
2. **`contacts`** — second-most referenced
3. **`jobs` → `projects`** — do the rename in the same step as the move, not separately
4. `tasks`, `activities` — the timeline pair
5. `projectAlerts`, `materialUsage`, `equipmentLogs`, `scheduledWork`, `projectAssignments`, `spatialData` — the remainder
6. Dead-store and retired-data cleanup
7. IndexedDB re-established as cache

---

## Verification / done criteria

The real test is **two browsers**, not one:

- [ ] Open the app in two different browser profiles. Create an account in one. **It appears in the other.**
- [ ] Same for a contact, a project, a task, and an activity
- [ ] A dispatch job's `projectId` resolves to the same project in both browsers
- [ ] An opportunity's `accountId` resolves in both
- [ ] A field alert raised in one browser is visible to the "office" in the other
- [ ] "Previous Projects" on an account shows real completed projects, not the three demo rows
- [ ] `openDatabase()` no longer declares `opportunities` or `projects`
- [ ] `data/backend.json` contains no `laborResources` or `crewMemberships`
- [ ] Hard-refresh with the server stopped: the app still loads from cache and queues edits (offline path not broken)
- [ ] `docs/database-handoff-map.md` inventories updated

> Per `feedback_browser_testing_setup`: Playwright/Chromium **are** available in this environment despite not being on `PATH`. Click-test this — do not reason about it.

---

## Risks

| Risk | Mitigation |
|---|---|
| Existing testers lose data sitting in their private IndexedDB | Accept it — the data is demo data. But **ask first** if anyone has been entering real records. |
| ~40 `putRecord("accounts", …)` call sites; missing one leaves a silent write-to-nowhere | Grep for every `putRecord(` call after migrating; there should be none left for migrated stores. |
| Seed data double-writes once records are server-side | `seedStoreIfEmpty()` (`app.js:1771`) logic must move server-side or become a one-time server seed. |
| The rename touches many render sites | Do the rename mechanically and completely in one step; a half-rename is worse than either state. |

---

## Open decisions

- **Does anyone have real data in their browser today?** If yes, export before migrating.
- **Server-side seeding:** should the JSON backend ship with seed records, or start empty for the pilot? Leaning toward keeping seeds for now and adding a "reset to demo data" action.

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*
