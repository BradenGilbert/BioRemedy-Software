# Phase 01 — One Shared Data Layer

**Status:** ✅ **Complete 2026-09-16** — every collection in scope (`accounts`, `contacts`, `projects`, `tasks`, `activities`, `projectAssignments`, `projectAlerts`, `materialUsage`, `equipmentLogs`, `scheduledWork`, `spatialData`) is migrated to the shared JSON backend, gated by role, and verified live. The dead stores (`opportunities`, the old local `projects`) and the two retired-data cleanups (`laborResources`, `crewMemberships`) are also done. IndexedDB now holds only `syncQueue` and `settings` — genuinely local, device-scoped state, exactly as the "re-establish IndexedDB as cache" goal intended. See "Implementation notes — the remaining eight collections" below for what shipped 2026-09-16.
**Depends on:** Phase 00 (git + backups must exist before this phase mutates persistence) ✅
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
| ~~`accounts`~~ | `accounts` | ✅ **Done 2026-09-15.** See implementation notes at the bottom. |
| ~~`contacts`~~ | `contacts` | ✅ **Done 2026-09-15.** 4 real writes. Contact→account FK verified resolving across the shared layer. |
| ~~`jobs`~~ | ~~**`projects`**~~ | ✅ **Done 2026-09-16.** Migrated and renamed in the same pass. See "Implementation notes — projects slice" at the bottom; supersedes "The projects/jobs collision" below. |
| ~~`projectAssignments`~~ | ~~`projectAssignments`~~ | ✅ **Done 2026-09-16.** The Project Assignment junction the original design asked for. Zero real writes existed (display-only); found and fixed a bug where the seed rows still said `jobId` while the accessor already filtered on `projectId` — every seeded assignment was invisible to `assignmentsForJob()` until this pass. |
| ~~`tasks`~~ | ~~`tasks`~~ | ✅ **Done 2026-09-16.** New `buildCoreTaskRecord()` normalizer written (none existed before). Linked write preserved: `persistActivity()` still cascades a `tasks` record when `activityType === "Task"`, now via `saveBackendRecord` for both. |
| ~~`activities`~~ | ~~`activities`~~ | ✅ **Done 2026-09-16.** Reused the existing `buildCoreActivityRecord()` normalizer. Also removed its `owner`/`author`/`createdBy` live `state.currentUser` fallback (same bug already fixed on contacts/opportunities earlier — the record's *creator* is stamped at creation time, but the read-time normalizer was silently substituting whoever's *currently viewing* for any record missing an owner; harmless when activities were per-browser, actively misleading now that they're genuinely shared). |
| ~~`projectAlerts`~~ | ~~`projectAlerts`~~ | ✅ **Done 2026-09-16.** Field alerts must be visible to the office — they are useless device-local. Same seed/accessor `jobId`/`projectId` mismatch bug as `projectAssignments`, fixed. Gated `operations` OR `sales` (Sales/Account Manager can see alerts affecting their accounts, per owner decision). |
| ~~`materialUsage`~~ | ~~`materialUsage`~~ | ✅ **Done 2026-09-16.** Needed for job-cost-vs-quote comparison — gated `operations` OR `finance` for exactly that reason (per owner decision). Same seed/accessor mismatch bug fixed. |
| ~~`equipmentLogs`~~ | ~~`equipmentLogs`~~ | ✅ **Done 2026-09-16.** Same seed/accessor mismatch bug fixed. Found (not fixed — separate collection, out of scope) that the unrelated backend collection `equipmentAssets` still has its own unrenamed `assignedJobId` field holding a project reference; currently dead/unread, flagged for whoever touches that collection next. |
| ~~`scheduledWork`~~ | ~~`scheduledWork`~~ | ✅ **Done 2026-09-16.** Migrated as its own collection per the owner's explicit choice, despite having zero real writes today and already being merged into `scheduleEvents` at render time via a fallback lookup by `opportunityId` — that merge logic in `getScheduleEvents()` is unchanged. |
| ~~`spatialData`~~ | ~~`spatialData`~~ | ✅ **Done 2026-09-16.** Metadata only; large files were never meant to live here. Same seed/accessor mismatch bug fixed. Retired two now-dead local migration passes that only ever operated on this store (`migrateSpatialDataSeed()`, `migrateProjectRenderSampleData()`), same fate as the `jobs`-era migrations retired in the projects slice. |

### 2. Delete dead stores

| Store | Why |
|---|---|
| ~~`opportunities` (IndexedDB)~~ | ✅ **Removed 2026-09-16.** Dead declaration — opportunities moved to the server 2026-08-10; the store was created on upgrade and never written to. |
| ~~`projects` (IndexedDB)~~ | ✅ **Removed 2026-09-16.** The hardcoded 3-row seed list had zero writes anywhere in the app; its 3 rows were converted into real `Complete`-status project records and merged into the new shared `projects` collection instead of being discarded. |

### 3. Clean up retired data

| Item | Action |
|---|---|
| ~~`laborResources` (5 rows in `data/backend.json`)~~ | ✅ **Removed 2026-09-16.** Retired in code 2026-08-17 but the rows remained, and the collection wasn't even reachable via the API anymore (no `collectionAccess`/`defaultBackend` entry) — pure dead weight in the JSON file. Deleted. |
| ~~`crewMemberships` (4 frozen seed rows)~~ | ✅ **Removed 2026-09-16.** Dead join table, confirmed zero reads/writes anywhere in `app.js` beyond an empty-array placeholder. Crew membership derives live from `employees.crewId`. Removed from `server.mjs` (`collectionAccess`, `defaultBackend`, `filterBackendForRole`) and `data/backend.json`. |

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

So the Account page's "Previous Projects" panel used to render three hardcoded demo rows and could never grow — when a real job finished, nothing moved it there. The two stores were the same entity split by lifecycle, with the history half being a dead end.

> ### ✅ RESOLVED — 2026-09-16. Full rename done in one pass.
>
> This was paused 2026-09-15 over a real risk: the original plan bundled a low-risk store rename
> (5 writes, 23 `state.jobs` refs) with a scary-sounding "166 `jobId` references" field rename that
> looked corruption-prone if done as a blind find-replace.
>
> Doing the classification properly (three parallel research passes, then a full manual pass over
> every occurrence) found the actual picture was much cleaner than the reference count implied:
>
> - The two ID families are already visually distinguishable in stored data by prefix — `job-*`
>   always means a project reference, `dispatch-job-*` always means a `dispatchJobs` reference.
> - **Correction to this document's own claim:** `dispatchJobs.projectId` was already correctly
>   named — it was never called `jobId`. The actual overload was that four *other* backend
>   collections (`scheduleEvents`, `mapLocations`, `sampleRecords`, `invoices`) stored the same kind
>   of project reference under the field name `jobId` instead of `projectId`, plus five **local**
>   IndexedDB-only collections (`projectAssignments`, `projectAlerts`, `materialUsage`,
>   `equipmentLogs`, `spatialData`) had the identical inconsistency that this document's own 166-count
>   never itemized separately.
> - Once every project-meaning `jobId` was renamed to `projectId`, everywhere `jobId` remains
>   genuinely means a dispatch job (`dispatchJobs`, `jobAssignments`, `jobSteps`, `jobActions`,
>   `jobScheduleSegments`, `jobResources`, `jobConflicts`, `jobFormSubmissions`, `jobStatusEvents`,
>   `jobTaskAttachments`, the dispatch dialogs, Front Line) — none of that was touched.
> - Generic DOM `data-job-id`/`dataset.jobId` pass-through attributes (buttons that open a dialog
>   with whatever id was on them) were deliberately left alone — they carry no ambiguity risk since
>   the value is resolved immediately by whichever specific dialog-opener function reads it.
>
> Verified live: two-browser share test (create a project in one profile, it appears in another),
> the field alert / material / equipment / schedule / map location / invoice dialogs all round-trip
> `projectId` correctly, and the Dispatch board / Front Line simulator were spot-checked unaffected.

**What actually shipped:**

1. `jobs` → renamed to `projects`, matching SQL `projects` (`crm-schema/006_projects.sql`) and the glossary. Migrated to the shared backend in the same pass (see "Implementation notes — projects slice" below).
2. The old local `projects` store is deleted. Its three seed rows were **converted**, not discarded — they're now real `projects` records with `status: "Complete"`, `completedDate`, `outcome`, and `value` intact, merged into the same 7-row seed source as the 4 active `seedJobs` rows.
3. "Previous Projects" is now a **filter** (`status === "Complete"`) over the unified `projects` collection, not a separate table. Every "active jobs" / "All Projects" / operations-dashboard count was also updated to exclude `Complete`-status projects, since merging the two collections would otherwise have leaked completed historical projects into views labeled "active."
4. The completion fields the history panel needs (`completedDate`, `outcome`, `value`) already existed on the old seed rows and are now part of `buildCoreProjectRecord()`'s normalized shape, defaulting to `""`/`0` for active projects that haven't completed yet.

This also finally makes every project-reference field across the backend (`dispatchJobs.projectId`, `scheduleEvents.projectId`, `mapLocations.projectId`, `sampleRecords.projectId`, `invoices.projectId`) consistently named.

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
3. ~~**`jobs` → `projects`**~~ ✅ Done 2026-09-16, rename and move done in the same step
4. ~~`tasks`, `activities`~~ ✅ Done 2026-09-16, the timeline pair
5. ~~`projectAlerts`, `materialUsage`, `equipmentLogs`, `scheduledWork`, `projectAssignments`, `spatialData`~~ ✅ Done 2026-09-16, the remainder
6. ~~Dead-store and retired-data cleanup~~ ✅ Done 2026-09-16
7. ~~IndexedDB re-established as cache~~ ✅ Achieved — only `syncQueue` and `settings` remain local

---

## Verification / done criteria

The real test is **two browsers**, not one:

- [x] Open the app in two different browser profiles. Create an account in one. **It appears in the other.** (verified 2026-09-15 for accounts; the same `saveBackendRecord`/`refreshBackendState` pattern now also carries every other migrated collection)
- [x] Same for a project, a contact, a task, and an activity (contacts 2026-09-15; project/task/activity 2026-09-16 — task verified end-to-end: completed a task through the UI, confirmed `status: "Complete"` via the API)
- [x] A dispatch job's `projectId` resolves to the same project in both browsers (`dispatchJobs.projectId` confirmed correctly resolving to `projects` records)
- [ ] An opportunity's `accountId` resolves in both — not this phase's collection, unchanged
- [x] A field alert raised in one browser is visible to the "office" in the other — `projectAlerts` migrated 2026-09-16, gated `operations` OR `sales`
- [x] "Previous Projects" on an account shows real completed projects, not the three demo rows (2026-09-16 — the three demo rows were converted into real `Complete`-status project records rather than replaced)
- [x] `openDatabase()` no longer declares `opportunities` or `projects` (2026-09-16) — as of this session it declares only `syncQueue`, plus `settings` outside the loop
- [x] `data/backend.json` contains no `laborResources` or `crewMemberships` (2026-09-16)
- [ ] Hard-refresh with the server stopped: the app still loads from cache and queues edits (offline path not broken) — not explicitly retested this session; the pattern is unchanged from the accounts/contacts precedent, which passed
- [x] `docs/database-handoff-map.md` inventories updated (2026-09-16)

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

- ~~**Does anyone have real data in their browser today?**~~ **Decided 2026-09-15: no recovery pass.** Records already sitting in a user's local `accounts`/`contacts` stores are no longer read — they are not deleted (the stores still exist in existing browsers, since the DB version did not change), just orphaned. The owner accepted this rather than adding a one-time upload-on-load migration. If it turns out someone lost test data, `getAll("accounts")` still works in their browser and the records can be pushed up manually. The same applies to every collection migrated 2026-09-16 (`projects`, `tasks`, `activities`, `projectAssignments`, `projectAlerts`, `materialUsage`, `equipmentLogs`, `scheduledWork`, `spatialData`) — same reasoning, same acceptance, not re-litigated per collection.
- **Server-side seeding:** should the JSON backend ship with seed records, or start empty for the pilot? **Decided implicitly 2026-09-16 by continuing the pattern**: every migrated collection keeps seeding from its `seed*` array via `ensureBackendSeedData()`. A "reset to demo data" action is still not built.
- **Role gating for the eight collections migrated 2026-09-16** — decided by the owner: `tasks`, `activities`, `projectAssignments` → `customerDirectory` (same broad group as accounts/contacts/projects, since a Sales/Account Manager legitimately needs to see their own follow-ups and who's staffed on their deal). `projectAlerts` → `operations` OR `sales` (field exceptions affect what a salesperson tells their customer). `materialUsage` → `operations` OR `finance` (the doc's own stated reason for migrating it — job-cost-vs-quote comparison — is a Finance-only concern that `operations` alone doesn't serve). `equipmentLogs`, `scheduledWork`, `spatialData` → `operations` only, no broader case made. This is still pre-Phase-06 role gating (coarse, not real authorization), same caveat as `customerDirectory`'s own comment in `server.mjs`.

---

## Implementation notes — `accounts` slice (2026-09-15)

**The pattern, for the remaining 10 collections.** Follow this exactly; it is now proven end-to-end.

*server.mjs — four edits:*
1. New `roleAccess.customerDirectory` group spanning all nine internal roles, **excluding Client Portal**. Accounts and contacts are referenced by nearly every workspace, and before this they had no gating at all, so a narrow group would have been a regression. Real authorization is Phase 06.
2. `collectionAccess.accounts = "customerDirectory"`
3. `defaultBackend.accounts = []` — **required**, the route 404s with "Unknown collection" unless the key exists as an array
4. One line in `filterBackendForRole`

*app.js — the read/write swap:*
- `putRecord("accounts", x)` → `saveBackendRecord("accounts", x, { refresh: false })`. Use `{ refresh: false }` wherever `refreshState()` follows (it calls `refreshBackendState()` itself) — otherwise every save re-downloads the whole ~400 KB backend twice.
- Removed `accounts` from `refreshState()`'s `getAll` batch; `state.accounts` is now projected in `refreshBackendState()` with a `deletedAt` filter, matching how `opportunities` already worked.
- Removed `"accounts"` from the `openDatabase()` store list.

*Seeding:* new `ensureBackendSeedData()` called from `init()`. Seeds from the existing `seedAccounts` array through `buildCoreAccountRecord`, so the demo data keeps **one** definition rather than being copied into `server.mjs` where the two would drift. Idempotent — the POST route upserts by id, so concurrent clients write identical records.

*Two retired migrations:* `migrateAccountsToCoreSchema()` and `migrateJobRequestAccountFoundation()` both operated on the local store and now have nothing to act on.

**Useful discovery:** `normalizeRecord()` preserves a supplied `id` (`payload.id || makeId(...)`) and has a pass-through fallback for collections with no specific branch. So migrating a collection needs **no server-side schema** — records keep their shape and their existing IDs, which is what keeps FKs like `acct-riverbend` intact.

**Verified live (not reasoned about):**
- Accounts render on the Accounts view, with pipeline totals and deal counts still resolving — FKs intact
- **Read direction:** an account POSTed via the API as another user appeared in the browser after reload
- **Write direction:** an account created through the UI landed in `data/backend.json`
- **Edit path:** the Owner & primary contact dialog persisted to the shared file
- `Client Portal` role is refused: `{"error":"customerDirectory role required."}`
- No console errors

## Implementation notes — `projects` slice (2026-09-16)

Same four-edit server.mjs pattern as `accounts`/`contacts`: `collectionAccess.projects = "customerDirectory"` (reused the existing group rather than inventing one — projects are account-adjacent data referenced across sales/operations/dispatch, same rationale as accounts/contacts), `defaultBackend.projects = []`, one `filterBackendForRole` line.

*Seeding:* the dead local `seedProjects` (3-row, zero-write) array was retired and its rows converted into real project records with `status: "Complete"`, then merged into `seedJobs` (renamed to `seedProjects`) — one unified 7-row seed source. `ensureBackendSeedData()` extended with a `buildCoreProjectRecord()` normalizer, following `buildCoreAccountRecord`'s exact shape.

*app.js — the read/write swap:* identical to accounts — 3 real `putRecord("jobs", …)` sites converted to `saveBackendRecord("projects", …, { refresh: false })`; `state.jobs` (23 refs) renamed to `state.projects`, now projected in `refreshBackendState()` with a `deletedAt` filter instead of loaded via local `getAll()`. `findJob()` renamed `findProject()` (15 call sites); two duplicate account-scoped helpers (`jobsForAccount()` reading the live store, `projectsForAccount()` reading the dead one) collapsed into one `projectsForAccount()`.

*Retired:* `migrateOperationsProjectArchitecture()` — its `spatialData` merge logic was extracted into a new `migrateSpatialDataSeed()` (still needed, unrelated to this migration) and its `jobs`-specific half deleted, same fate as `migrateAccountsToCoreSchema()`.

**The `jobId` field rename, four backend collections + five local ones:** `scheduleEvents`, `mapLocations`, `sampleRecords`, `invoices` (backend — field renamed in `server.mjs` defaults, `normalizeRecord()`, and existing `data/backend.json` rows) and `projectAssignments`, `projectAlerts`, `materialUsage`, `equipmentLogs`, `spatialData` (local IndexedDB collections — field renamed in seed data and every read/write site, though the collections themselves remain unmigrated). The six affected `index.html` `<select name="jobId">` forms (alert, material, equipment, schedule, map location, invoice) were renamed to `name="projectId"`; the four genuinely dispatch-scoped ones (`dispatchScheduleDialog` and the three `dispatchAssign*Dialog`s) were left untouched.

**Side effect requiring a fix:** merging the dead 3-row `projects` store into the same collection as the 4 active `seedJobs` rows meant every "active jobs" / "All Projects" / operations-dashboard count and list started including the 3 now-`Complete` historical projects, since they'd never coexisted with the active ones before. Fixed by adding `job.status !== "Complete"` filters to `renderOperationsAllProjects`, `renderOperationsScheduled`, `renderOperationsEmergency`, `renderOperationsRemediation`, `renderOperationsLegacy`, `renderOperationsMetrics`, and the two workspace-subtitle/status-card counts. Worth checking for the same effect when migrating any other collection that has a dormant "historical" counterpart.

**Verified live (not reasoned about):**
- `/api/backend/projects` returns all 7 seeded records (4 active + 3 converted historical), fields normalized by `buildCoreProjectRecord`
- Operations → All Projects shows only the 4 active projects; the 3 historical ones no longer leak in
- Account detail → Projects tab shows the account's active project(s) *and* the converted historical row under "Previous projects"
- Field alert dialog: `projectId` select lists all 7 projects, `saveProjectAlert` resolves `findProject(data.get("projectId"))` and completes (dialog closes) — proves the renamed form field and record shape both work end-to-end
- Dispatch workspace and Dispatch Board load with no console errors — confirms the dispatch-scoped `jobId` usages were correctly left untouched
- No console errors across Sales, Operations, Dispatch workspaces

## Corrections found during implementation

- **The plan said "~40 call sites use `putRecord("accounts", …)`."** Wrong — there were **9**, of which 3 were seed/migration paths, leaving 6 real writes. The ~40 figure came from counting every `grep` hit for `"accounts"`, most of which were view names, SQL table references, and render code. Expect the remaining collections to be smaller than the plan implies too; count before estimating.
- **`saveAccountOwner()` never writes an `ownerEmployeeId` FK** — only the resolved display name. Unrelated to this migration (pre-existing), but it means Owner is still free text in storage despite being a picker in the UI. Logged into Phase 03.
- **This document's own "166 `jobId` references" framing overstated the ambiguity.** The real overload was narrow: four backend collections and five local collections used `jobId` where they meant `projectId`; every other occurrence (the large majority of the 166) was already unambiguously dispatch-scoped and needed no change. `dispatchJobs.projectId` — the field this document specifically called out as needing disambiguation — was already correctly named. Lesson for future large-reference-count warnings in this codebase: classify before estimating risk, the same lesson as the accounts call-site count above.
- **One pre-existing broken reference, found not fixed:** `dispatchJobs` record `dispatch-job-georgetown` has `projectId: "project-georgetown-er"`, which matches neither the `job-*` nor `dispatch-job-*` ID family and resolves to nothing. Predates this migration; left as-is since fixing dangling data wasn't in scope for a naming pass. Worth a data-integrity cleanup pass separately.
- **The projects-slice claim "field renamed... in seed data and every read/write site" for `projectAssignments`/`projectAlerts`/`materialUsage`/`equipmentLogs`/`spatialData` was wrong.** Only the accessor functions (`assignmentsForJob()` etc.) and the real write-site literals were renamed to `projectId`. The `seed*` array literals for all five collections still said `jobId` — meaning every seeded row in those five collections silently failed to resolve via its `...ForJob()` helper from 2026-09-16 (projects slice) until this session found and fixed it. Root cause: the earlier session renamed by tracing *code paths*, not by exhaustively grepping the literal string `jobId:` across seed data. Caught this time by a research pass that explicitly re-grepped for `jobId:` before starting the next migration slice — worth doing that grep as a standing check before trusting any past "this field was already renamed" claim in this document. Also found and fixed a second miss from the same pass: a Front Line "take sample" write path (`app.js`, the sample-collection form-submit handler) still wrote `jobId: job.projectId` into a `sampleRecords` object instead of `projectId: job.projectId`.

## Implementation notes — the remaining eight collections (2026-09-16)

Same four-part server.mjs pattern as every prior slice, done for all eight in one pass: `collectionAccess` entries (see the role-gating decision above for which group each got), `defaultBackend` empty-array entries, `filterBackendForRole` lines (with `||` OR logic for `projectAlerts`/`materialUsage`'s dual-group visibility).

*app.js — the read/write swap*, same as every prior slice: real `putRecord` sites converted to `saveBackendRecord(..., {refresh:false})` (2 for `tasks`, 1 each for `activities`/`projectAlerts`/`materialUsage`/`equipmentLogs`; zero for `projectAssignments`/`scheduledWork`/`spatialData` — display-only, no create/edit UI exists for them); all eight removed from `openDatabase()`'s store list (which now declares only `syncQueue`) and from `refreshState()`'s local `getAll()` batch; all eight added to `refreshBackendState()`'s per-collection `state.X` projections with `!deletedAt` filters, matching the accounts/contacts/projects pattern exactly.

*Normalizers:* wrote a new `buildCoreTaskRecord()` (none existed) since `tasks` has two write paths (`persistActivity()`'s cascade, `completeTask()`) that could otherwise drift. Reused the existing `buildCoreActivityRecord()` for `activities` unchanged except for the owner-fallback fix noted above. The other six collections have zero-or-one write site each with an already-complete literal shape, so no new normalizer was written for them — seeding uses the seed arrays directly through `saveBackendRecord`, consistent with not adding abstraction the collection doesn't need yet.

*Retired as dead code, once their target store went shared:* `migrateActivitiesToCoreSchema()`, `migrateSpatialDataSeed()`, `migrateProjectRenderSampleData()`, and the generic `seedStoreIfEmpty()` helper (zero remaining callers once every collection that used it was migrated) — same fate as the `jobs`-era local migrations retired in the projects slice. Also retired, as Phase 01's own "Clean up retired data" item: `laborResources` (5 orphaned rows in `data/backend.json`, already unreachable via the API) and `crewMemberships` (4 frozen seed rows, zero `app.js` readers) — removed from `server.mjs`'s `collectionAccess`/`defaultBackend`/`filterBackendForRole` and from `data/backend.json` entirely.

**Verified live (not reasoned about):** all 8 collections seed with their exact expected row counts via `/api/backend/<collection>`; `crewMemberships`/`laborResources` correctly return `{"error":"Unknown collection."}`; the I-130 project detail page shows its material usage ("Absorbents, 18 bags"), equipment log ("VAC-204 - Vacuum trailer"), and both project assignments correctly linked — proving the seed/accessor mismatch bug above is fixed, not just theorized; the Riverbend project card shows "1 alerts" and "1 spatial files" for the same reason; completed a task through the UI and confirmed `status: "Complete"` persisted via the API; 15 views across every workspace load with zero console errors both before and after this slice.
