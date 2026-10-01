# Glossary — The Naming Contract

**Read this before touching any entity.** The same concept currently has up to four different names depending on which layer you are in. That is the single biggest source of "this doesn't make sense" in this codebase.

The **Target name** column is what everything should converge on. Where the prototype disagrees with `crm-schema/`, **the SQL schema wins** — it was designed deliberately, and the prototype drifted away from it.

---

## The Places Model — three genuinely different things

This is the most important section in this document. These three were collapsed into one confused pile in the prototype. They are not the same concept and must never be merged.

### FACILITY — *a physical place where work can happen*

Implies a structure or a yard. Has exactly **one** address. Contacts can work at it, and one contact can manage several of them.

- **Target table:** `facilities` (`crm-schema/003_facilities.sql` — already exists)
- **Prototype today:** ✅ the JSON collection `facilities` — renamed from `locations` in Phase 02 (2026-09-16), 11 records. `status` was also renamed `badge` in the same pass.
- A new `facilityContacts` junction (works-at/manages, Phase 02) links `contacts` to `facilities`.
- Examples: a customer's maintenance depot, a warehouse, a corporate office, a treatment yard

### ADDRESS — *a postal record*

Street, city, postal code. Has a contact person or contact info. Exists for a **reason** — Bill-To, Ship-To, Remit-To, Tax, Vendor Dispatch. A facility has one. A billing office that nobody ever visits also has one.

- **Target table:** `addresses` (`crm-schema/026_account_relationship_extensions.sql` — already exists)
- **Prototype today:** the JSON `addresses` collection, now with real UI and real rows (Phase 02, 2026-09-16 — every address type renders on the account page, not just Bill To). A facility's own address is still captured as inline fields on the facility record, not a link to an `addresses` row — the two are parallel, not connected. See "Corrections found during implementation" in `phase-02-places-model.md`.
- The `address_type` enum already exists and is correct: `Bill To`, `Ship To`, `Primary`, `Tax`, `Remit-To`, `Vendor Dispatch`, `Vendor Billing`, `Other`

### LOCATION — *an identified spot: a GPS point, an address, or both*

**Not tied to a postal box.** Given to crews to identify an exact spot. Where a sample was taken, where a spill is, where waste was picked up or dropped, where a truck is parked, a destination.

- **GPS or an address, at least one (owner, 2026-09-25).** A spill call often arrives as "I-35 NB mile marker 261" with no coordinates; the crew pins it on arrival. `addressText` holds the address (or cross streets / a mile marker); `latitude`/`longitude` may be blank, never 0. The server refuses a location with neither, or with half a coordinate pair. Client code tests coordinates with `hasGpsCoordinates()`, because `Number("")` is `0`.
- **A location can sit inside a facility** (`facilityId`, optional) and belongs to an account (`accountId`). A spill in a customer's yard is a location *at* their facility, not the facility itself.
- **A location is never turned into a facility automatically.** "Promote to facility" (on the location card and on a location-only project's Intake tab) opens the facility dialog prefilled; saving it links the location and the projects at it to the new facility. A person decides — owner, 2026-09-25.

- **Target table:** `job_sites` (`crm-schema/005_job_sites.sql` — already exists, already has `latitude`/`longitude`, `linear_reference` for highway mile markers, and `is_temporary`)
- **Prototype today:** ✅ the JSON collection `locations` — renamed from `mapLocations` in Phase 02 (2026-09-16), 4 records. Gained `locationType`, `linearReference`, `isTemporary`, `retainUntil`, `retentionReason` in the same pass.
- **Permanence matters:** some locations belong to the account forever; some (a one-off sample point) should age out after their reporting life. `isTemporary` + `retainUntil` (default: 24 months out, overridable) + `retentionReason` shipped in Phase 02. No purge job yet — intentionally out of scope.

> **The rule:** Everything can have a *location*. Only things that get mailed, billed, shipped, or taxed need an *address*. Only places where work physically happens are *facilities*.

**Naming hazard — resolved 2026-09-16 (Phase 02).** The prototype's old `locations` collection (really *facilities*) is now `facilities`, and the old `mapLocations` (really *locations*) is now `locations`. If you're reading old chat history, commits, or design docs that predate 2026-09-16, they'll use the old names — translate mentally.

---

## Work hierarchy — the other big naming collision

| Concept | SQL (target) | JSON backend | IndexedDB | Plain English |
|---|---|---|---|---|
| Customer engagement | `projects` | `projects` | — | The whole piece of work sold to a customer (was IndexedDB `jobs` until Phase 01, 2026-09-16) |
| Sales request into dispatch | `job_requests` | `jobRequests` | — | "Ops, please schedule this" |
| One dispatchable work packet | `work_orders` | `dispatchJobs` | — | One crew, one visit, one packet of work |
| A phase inside a work packet | `job_step_definitions` → `job_step_instances` | `jobSteps` | — | Mobilize, Excavate, Demobilize |
| One executable instruction | `job_action_definitions` → `job_action_instances` | `jobActions` | — | "Take 4 photos", "Collect a sample" |

⚠️ **`jobs` in IndexedDB means PROJECTS.** It does not mean dispatch jobs. This single collision has already caused at least one planning error (the Site Calendar was assumed to link to `dispatchJobs` when its data actually came from `jobs`/projects). Phase 01 renames it to `projects`.

---

## Field record and reporting terms (Phase 11, 2026-09-23)

| Term | JSON backend | Meaning |
|---|---|---|
| Operational day | `dispatchJobs.operationalDate` | **The day a dispatch job's work belongs to**, stamped once at Start work (Phase 09 Q5). Usage logged at 1am counts on the operational day, not the calendar date. Not `scheduledStart`, not `createdAt`. |
| Work day | derived | A day that owes a case narrative: the operational day, plus any extra day the field lead added for a multi-day job. |
| Case narrative | `dispatchJobs.dailyNarratives[]` | Per work day: *Scene description* (what was found) and *Scene activities* (what was done). Written by the field lead. **Not** a project note or an activity. |
| Post-job review | `dispatchJobs.postJobReview` | Accidents / near misses / injuries, Yes or No. Required to close the job. |
| Weather snapshot | `weatherSnapshots` | A frozen, provider-fetched observation. `kind: incident` (at `projects.incidentReportedAt`) or `response` (at the job's Start work). Never typed and never re-fetched. |
| Permit | `permits` | A permit **BioRemedy holds** (e.g. the 10-day storage permit). **Not** a customer's permit or a site permit. |
| Waste record | `wasteRecords` | Waste from one project, tracked from accumulation to disposal, optionally stored under a permit (whose storage limit sets a ship-by date). |
| Stock movement | `inventoryMovements` | One change to an inventory item's `onHand`, with the reason. Written by the server only. |
| Sample result | `sampleResults` | One analyte result for one sample. **Not** `sampleLabReports`, which are the uploaded report *files*. |
| Notification | `notifications` | An in-app message addressed to roles (until Phase 12). **Not** `projectAlerts` (the field alert itself) or `inventoryAlerts`. |
| Mileage entry (GPS) | `jobMileageEntries` with `method: "gps"` | Miles for one Travel clock-in/out leg, measured from the two GPS fixes (straight line x 1.25), editable by a person (`estimatedDistance` keeps the measured value). Manual odometer rows have no `method`. Linked to its Travel `timeEntries` row by `timeEntryId`. |
| Field flag | `projectAlerts` with `source: "field"` and a `dispatchJobId` | An alert the crew raised from Front Line's Flag button. Same record as an office field alert (`alertType`, `severity`, `description`, `reportedBy`); resolved the same way. Not a `notifications` row (one is also written for the office roles). |
| Site walk (sales activity) | `scheduleEvents` with `kind: "site_walk"` | A scheduled visit that belongs to an **opportunity**, not a job: it has a facility and BioRemedy participants but no dispatch job. Also written as a Site Visit meeting on the timeline. |
| Site walk report (Phase 21, 2026-09-25) | `siteWalkReports` | What the salesperson recorded on one walk: check-in, the guided sections, measurements, contacts met, plan backgrounds, the reference-layer snapshot, summary and completion. One per walk event. **Not** the Site Visit activity (the timeline entry) and not the opportunity's `siteWalkStatus` (a one-word status). |
| Observation (site walk) | `siteWalkObservations` | One numbered pin or drawn shape on the walk map, with its note and photos. Pins on the aerial carry lat/lng (+ GPS accuracy when a fix placed them); pins on an uploaded plan carry image-pixel x/y. Shapes carry GeoJSON with sq ft / ft. Never flattened into an image. |
| Background (site walk map) | `siteWalkReports.backgrounds[]` | What the pins sit on: the aerial (Esri imagery) or an uploaded plan (`site-plan` document shown on `L.CRS.Simple`). Numbering runs across all backgrounds. A plan is customer-provided and not to scale. |
| Reference layer | `siteReferenceLayers` (+ `jurisdictions[].layers[]`) | Context drawn **under** a facility's maps in dashed grey with a source/date tag: a parcel outline from the appraisal district via TxGIO, a city storm/sewer main, a customer drawing. `snapshot` rows hold GeoJSON and always draw; `live` rows name an ArcGIS service and draw when online. Tax-map accuracy, never a survey; no public data shows underground lines. |
| Walk share link | `siteWalkReports.shares[]` + `/walk/<token>` | A read-only, expiring link to one walk's map, pins and photos (`field/walk-share.html`, no app shell). Minted and revoked by W1's routes; polls every 30 s while the walk is live. **Not** a `/go/` sign-on link (which creates a session on a job). |
| Crew membership | `workforceTeamMemberships` (`crewId` or `teamId`) | An extra crew or team a person belongs to, beyond the home crew/team on `employees`. A crew is a quick-pick for dispatch, never the unit that gets scheduled. |
| Document | `documents` (Phase 13) | A file kept with a record: versioned (`groupId`), de-duplicated (`sha256`), internal or customer-visible. Not the three older stores (`jobRequestDocuments`, `sampleLabReports`, `jobTaskAttachments`), which stay until Phase 14. |
| Document type | `documentTypes` | The paperwork catalog: what a document *is*, who it comes from, whether the office reviews it, which stage it gates, and its blank form. |
| Requirement | `documentRequirements` | "This account (or deal, or project) needs document type X": Not started → Sent → Returned → In review → Approved / Rejected. The gates read Approved; an upload only ever reaches In review. |
| Client Portal user | `systemUsers` with role `Client Portal` + `clientAccountId` | A customer login. The server scopes everything to that account before it leaves (`portalView`). |
| Session | `auth.json › sessions` (Phase 12a) | Who is signed in, from the `crm_session` cookie. Its `roles` (every role the person holds) and `activeRole` are the only roles the server trusts; `role` is just the primary one for display. Kinds: `user` (password), `entra` (Microsoft), `breakglass` (emergency admin), `dispatch-link` (a personal phone on one job). |
| Active role | `session.activeRole` (2026-09-24) | A session narrowed to one of the person's roles from Settings › Roles and Permissions; empty means all roles combine. Ends with the session. **Not** `systemUsers.role`, which is the primary held role. |
| Sign-on link | `auth.json › dispatchLinks` | A one-use `/go/<token>` URL for one worker on one dispatch job; opening it creates a `dispatch-link` session. Not a Front Line **device** (`frontlineDevices`, company-issued). |
| Consent record | `gpsConsents` | Append-only proof that a worker accepted the location terms (versioned) on a personal phone for one job. Never edited; the generic API cannot write it. |
| Audit entry | `audit.log` line | Who did what, when, from where — written by the server from the session, never from a header. Not `activities` (the CRM timeline) and not `notifications`. |
| Deleted record | `deletedAt` on any row (Phase 20) | Never removed. Lists and getters hide it; `find*` still resolves it for history; `deletedVia` names the root delete it went with; Restore clears all of it. Not the same as an opportunity/project *status* of Cancelled or Lost. |
| Message thread | `messages` grouped by `threadKey` | Either one dispatch job's conversation between its crew and the office (`threadKey` = the job id) or the shared **general channel** (`"general"`) every crew sees. Not `notifications` (one-way, role-addressed) and not `activities` (the CRM timeline). |
| IT message | `itMessages` grouped by `threadKey` (2026-09-24) | A report to IT from the chat button beside the notification bell: one conversation per signed-in person (`threadKey` = their user id), answered by an Admin (`fromIT`). The server scopes it: a person sees only their own; IT sees all. A screenshot is a `documents` row with `entityType: "itMessage"`. **Not** `messages` (crews ↔ dispatch) and not `notifications`. |
| Next step | derived (`projectNextStep`) | What a project is waiting on when no crew is in the field: "Awaiting lab results (n)" or "No further work scheduled". Not a stored status. |
| Labor role ("bills as") | `employees.laborProductId` | The Labor rate line a person bills at (e.g. "Technician - HazMat trained…"). **Not** `jobTitle`, which is free text for the org chart. Set under Rate Card → Catalog alignment. |
| Invoice line day | `invoiceLines.operationalDate` | The operational day a billed line belongs to; drives the invoice's "Day N" headings. Same rule as the report (Q5). |
| Safety briefing | `jobSafetyBriefings` (Phase 21 W2, 2026-09-25) | One per `jobId` + operational day: PPE level, JSA hazard rows, five yes/no reminders, roll call, per-crew-member acknowledgement + signature. Filled by the field lead on the job's Safety tab. **Not** `postJobReview` (answered at close) and not a `jobActions` submission. |
| Equipment usage | `jobEquipmentUsage` (Phase 21 W2, 2026-09-25) | Hours/days an asset was used on a job, logged from the field as a quick action (not a `jobActions` task type). Feeds the job's billables preview alongside `jobResources`. |
| Field outbox | IndexedDB `environmental-crm-field › fieldOutbox` (Phase 21 W2, 2026-09-25) | Device-scoped queue of field-app writes made while offline (or on a network failure), replayed in order once back online. **Not** the legacy `syncQueue` store, and not a JSON backend collection — nothing here is shared between devices. |
| Field package | IndexedDB `environmental-crm-field › fieldPackages` (Phase 21 W2, 2026-09-25) | The cached snapshot of `GET /api/field/package` (or, until that route exists, a snapshot of `state.backend`) a field device reads from when it opens offline. |
| Spill location type | `projects.spillLocationType` (2026-09-28) | "Where is it?" — Outdoors / Inside a building / Confined space / Crawl space / Storm or sewer system / Septic system. **Not** `spillSurface` ("What is it on?" — Road / Hard surface / Soil / Gravel / Water / Mixed), a separate field it's always shown alongside. |
| Estimated duration | `dispatchJobs.estimatedDurationHours` (2026-09-28) | The Dispatch step's planned length of the visit (default 4h), used only to compute `scheduledEnd` from `scheduledStart` at intake/creation time. **Not** `completionPercent` and not a billable hours total — those come from `timeEntries`. |

## Front Line 2 terms (Phase 21, planned 2026-09-24 — none of these exist yet)

| Term | JSON backend | Meaning |
|---|---|---|
| Field surface | session kind `dispatch-link`, or a field role with `?surface=phone` / the `field-*` views | A session the server treats as a phone: reads go through the field projection, writes go through field commands. **Not** a role; an office user can open the simulator without becoming a field surface. |
| Field projection | `fieldProjections` (server table) | Per collection: which fields a field surface may read and which rows (mine, my jobs', my walks'). The limited-read model that replaces domain blocking for Field Lead. |
| Field command | `POST /api/field/*` | A small server route that does one write with the right authority (timer, clock crew, complete site walk, quick lead). The phone never PUTs an `employees` or `opportunities` row. Idempotent by `X-Client-Command-Id`. |
| Job package | `GET /api/field/package` → IndexedDB `fieldPackages` | Everything one worker's My Day and job/walk pages need, already projected. The offline cache. Device-scoped, so IndexedDB is correct here. |
| Outbox | IndexedDB `fieldOutbox` | Queued field writes (commands, uploads) with a client command id, replayed in order when online; a rejected one stays visible with its reason. **Not** the old `syncQueue`, which only logs office saves. |
| Safety briefing | `jobSafetyBriefings` | Per job per operational day: PPE level and rationale, muster point, JSA rows, the five reminders, optional air-monitoring readings, crew roll call with acknowledgements. Read directly by the report's JSA section (replaces the form-name regex). |
| Equipment usage | `jobEquipmentUsage` | Hours or days on one asset on one job day, logged from the field. **Not** `equipmentLogs` (office-entered) and not `jobResources` (what was assigned). |
| Site walk report | `siteWalkReports` | The guided capture from one walk (`scheduleEvents` row): sections, measurements, contacts met, summary. Its photos are `documents{type:"site-photo"}` on the opportunity. |
| Markup | `documents.markup` on a new version in the group | Annotation strokes over a photo or sketch, kept as JSON so they can be re-edited; the original is the previous version. |
| Site sketch | `documents{type:"site-sketch"}` | Markup over a satellite snapshot or blank grid: spill extent, drains, sample points, staging. The scaled map TCEQ's follow-up asks for. |
| Scan | `documents{type:"site-scan"}` + `spatialData` row | A LiDAR / photogrammetry file shared from a scanning app (GLB/USDZ/PLY/OBJ/E57) with structured `measurements[]`. The app cannot drive the LiDAR sensor itself. |
| ERG | `ergMaterials`, `ergGuides`, `ergDistances` | The DOT/PHMSA Emergency Response Guidebook in data form: UN number → guide, guide text, and the Table 1/3 isolation and protective-action distances. What was applied is stamped on the job (`ergGuideNumber` …). |
| SDS | `documents{type:"sds"}` | A Safety Data Sheet on an inventory item, job, project or account. |
| Library item | `libraryItems` (+ `documents{entityType:"libraryItem"}` or a link) | One entry on the Manuals & Training shelves (manuals & procedures, safety references, tutorials & training, helpful resources): a versioned document or an external link, with audience, required-for roles and renewal. |
| Acknowledgement | `libraryAcknowledgements` | Append-only proof an employee read or completed a library item at a given version. Shown beside certifications on Workforce. **Not** `gpsConsents` and not `employeeCertifications`. |
| Form template | `formTemplates` | A standalone form defined in data (replaces the hard-coded `FRONTLINE_STANDALONE_FORMS`). Submissions stay in `jobFormSubmissions`. |

---

## Sales entities

| Concept | SQL | JSON backend | IndexedDB | Notes |
|---|---|---|---|---|
| Account | `accounts` | `accounts` | *(dead)* | ✅ Moved to server, Phase 01 (2026-09-16). IndexedDB store no longer declared. |
| Contact | `contacts` | `contacts` | *(dead)* | ✅ Moved to server, Phase 01 (2026-09-16). IndexedDB store no longer declared. |
| Opportunity | `opportunities` | `opportunities` | *(dead)* | Already on the server as of 2026-08-10; the IndexedDB store declaration was removed in Phase 01. |
| Quote | `quotes` + `quote_lines` | `quotes` + `quoteLines` | — | Customer-facing priced document. **Resolved 2026-09-17: Quote and Estimate are two separate documents**, not one type with a status flag. Lines carry `lineKind`: `item`, or the generated `fuel_surcharge` / `energy_security_fee` lines (Phase 08 round two). |
| Estimate (UI: "Estimation Tool") | *(no table yet)* | `estimates` + `estimateLines` | — | Internal working draft, same line shape as quotes. Converts into a quote (`quotes.sourceEstimateId`); converting twice is allowed. The collection is still named `estimates`; only the label changed. |
| Rate sheet | `price_levels` | `priceLevels` | — | **Naming hazard:** a "rate sheet" in the UI and in the owner's words is a `priceLevels` row (the Dataverse name). There is one per workbook tab ("2026 Rate Sheet", "2026 Rate Sheet (Sheet5)"), and exactly one has `isDefault`. A product's three tier prices on a sheet live on its `productPriceLevels` row: `amount` = Standard, `amountOtEmergency`, `amountDoubleTime`. "Rate card" is the admin *screen*, not a record. |
| Lead | `leads` | `leads` | — | |
| "Regarding" on an activity | `activity_parties` | `activities.relatedRecords` | — | **Not a tag.** Links one activity to other records (contact, facility, account, opportunity, "Job" = `dispatchJobs`, project) so it appears on each of their timelines. Tags (`activities.tags`) categorise; Regarding cross-posts. Phase 06 item 20. |

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

## Job Title vs. Account Role — locked 2026-09-16, not yet built

Another two-things-currently-collapsed-into-one problem, this time on `contacts`. In the owner's own words:

> *"I think Account role should be something our internal system understands while job title is something that is written on their business card."*

- **Job Title** — external, whatever the person calls themselves (`jobTitle`/`title` on `contacts`). Free text, unconstrained.
- **Account Role** — internal-only vocabulary this CRM understands (Decision Maker, Technical Evaluator, etc.). Not necessarily the same value as job title, and not free text.

**Not yet built as two separate fields** — confirm current field usage before assuming either already exists in the intended shape. Slotted into Phase 05 item 8. Watch for the same vocabulary question resurfacing at the **opportunity** level (Phase 06 item 19's "Decision Maker" tag for Associated Contacts) — decide whether account-level role and opportunity-level role share one vocabulary or are genuinely separate scopes before building either.

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
- `laborResources` — retired 2026-08-17. Duplicated real people from `employees` under unlinked IDs. The 5 stale rows were removed from `data/backend.json` in Phase 01 (2026-09-16).
- `crewMemberships` — a dead join table never written to (frozen at 4 seed rows). Crew membership derives live from `employees.crewId`. Retired in Phase 01.

---

## Front Line 2 terms (Phase 21, 2026-09-25)

- **Field session** — a `dispatch-link` session (from a `/go/` sign-on link) OR a signed-in session whose every held role is `Field Lead`/`Crew` (`isFieldSession()` in `server.mjs`). A field session reads and writes through `fieldProjections`/`fieldWritable`, never the office's full per-domain view.
- **Crew** — a new, lighter role than **Field Lead**: taps through a job (clock in/out, acknowledge the safety briefing, take photos) but cannot write the safety briefing, complete a site walk, or change a dispatch job's status (`crewForbiddenWrites`). Field Lead runs the job; Crew mostly taps.
- **`fieldProjections`** — the server-side access table (`server.mjs`) that replaces domain-level blocking for field sessions: per collection, which fields a field session may read (`"*"` or an allowlist) and which rows (`where`). This is *not* the same thing as `filterBackendForRole`'s office-role OR-list, which field sessions bypass entirely.
- **Field command** — one of the `/api/field/*` routes (`clock`, `jobs/:id/advance`, `jobs/:id/briefing[/acknowledge]`, `site-walk/:id/complete`, `measurements`, `walks/:id/share`) that does one thing with the right authority, instead of a raw `POST /api/backend/{collection}` row save. All are idempotent via `X-Client-Command-Id`.
- **Site walk** vs **walk event** vs **site walk report** — a *site walk* is the activity (a sales person visiting a facility before a job exists); the *walk event* is its `scheduleEvents{kind:"site_walk"}` row (the calendar entry); the **site walk report** (`siteWalkReports`) is the one-per-walk-event record of what was captured (sections, needs, measurements, shares). `siteWalkObservations` are the individual map pins/lines/areas on that walk — plural, one row each, never flattened into the report.
- **Command receipt** — the idempotency record (`<data>/command-receipts.json`, keyed by `X-Client-Command-Id`) a replayed write reads back instead of re-executing. Not a `backend.json` collection; a small sibling file to `auth.json`.
- **Walk share link** — a token minted into `siteWalkReports.shares[]` (`POST /api/field/walks/:id/share`); `GET /walk/<token>` and `GET /api/walk/<token>/data` need no session at all — the token is the credential, same pattern as `/go/<token>` sign-on links but for a read-only customer-facing page, not a login.

---

## Status fields that must never be collapsed

From `docs/erp-operational-architecture.md`:

- `work_orders.status` — the **job** lifecycle
- `job_assignments.assignment_status` — the **worker's** lifecycle
- `dispatch_status` — **delivery/coordination** state

These are three independent axes. Collapsing them into one field will break the dispatch board.

---

## Phase 21 (Front Line 2, W4) additions — 2026-09-25

- **`jurisdictions`** — a city/county's GIS layer catalog (parcels, utilities, drainage), *not* a customer site. Do not confuse with `facilities` (a customer's physical place) — a `siteReferenceLayers` row optionally links a jurisdiction's layer snapshot to a `facilityId` when someone clips it to one site.
- **ERG** — the DOT Emergency Response Guidebook. `ergMaterials`/`ergGuides`/`ergDistances` are reference data (UN number → guide → hazard sections/isolation distances), not something the app authors; `dispatchJobs.ergGuideNumber` etc. is the applied result on a specific job.
- **`libraryItems`** — the Manuals & Training shelves (manuals/safety/sds/tutorials/resources), a different thing from `documentTypes` (which classifies *uploaded files* generically) even though a `libraryItem` usually points at a `documents` row via `documentId`.
- **`markup`** (on a `documents` row) — the JSON stroke data from the shared image-markup tool (`field/media.js`), separate from `caption`/`tags`. As of 2026-09-25 the generic document metadata PATCH route does not persist it yet (see `phase-21-frontline-2.md` corrections).

## Phase 24 (Tutorials) additions — 2026-09-28

- **Guided tour** — an overlay (`tutorials/engine.js`) that walks someone through the real screens, step by step, highlighting a control. A **section tour** only points and explains (the "?" on a page header); a **process tutorial** is hands-on and runs on the training copy. Tour content is code (`tutorials/registry.js`), not a collection.
- **`tutorialProgress`** — per person, which tours they started, finished or waved off. A convenience only: it is **not** a training record. Training completion is a `libraryAcknowledgements` row on the matching Tutorials-shelf `libraryItems` entry.
- **`data-tour`** — the markup attribute a tour step targets. Renaming or removing one breaks a tour; `scripts/smoke.mjs` walks every tour and fails on a missing target.
- **Training copy** — a second instance of the same server (`CRM_TRAINING=1`, port 4174, `data-training/`, its own quick tunnel and session cookie) holding the sample data dated today, rebuilt nightly by `scripts/reset-training.mjs`, password-only, with a TRAINING frame on every screen. Hands-on tutorials run there, never on live. Built 2026-09-29.
- **`trainingSettings`** — live's pointer to the training copy (`{ trainingUrl }`, Admin-set in Identity & Sync › Training copy, read through `/api/training/settings`). An object like `qboSettings`, not a collection.
- **`libraryItems.tourId`** — on a Tutorials-shelf item, the hands-on tutorial it opens (`tutorials/registry.js` id). The item shows *Open in training* (live) or *Start* (training copy) instead of *Open*.
- **Section tour / hands-on tutorial** — `kind: "section"` tours only point and explain (the "?" on a workspace header or in the top bar on a record page); `kind: "process"` tutorials are hands-on and belong on the training copy.

## Deprecated

| Thing | Why | Replacement |
|---|---|---|
| `laravel-ready/` | Only 12 of 141 tables converted; untouched since. Stack decision is Node + Postgres. | `server.mjs` grows into the real API |
| `accounts.address_one_*`, `accounts.address_two_*`, `accounts.billing_address_*` | Legacy flat address columns | `addresses` (026) |
| `accounts.industry` (free text) | Free text, unusable for reporting | `account_industries` + `industries` (8 curated values already seeded) |
| `locations.category = "Billing Address"` | Retired 2026-08-17 — `addresses.address_type` owns the billing-role concept | `addresses.address_type` |
