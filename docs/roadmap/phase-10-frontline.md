# Phase 10 — Front Line: Real Tiles

**Status:** Scoped 2026-09-17, web-hosted full-feature build (mobile app decision deferred)
**Depends on:** Phases 06, 07, 08
**Owner decision, 2026-09-17:** the pilot-gated "outline only" posture below is superseded. The owner
wants the in-browser Front Line simulator built out to a fully-working, web-hosted field-service
experience — every tile a real feature, not a stub — **before** any decision is made on production
device auth, a real offline-sync protocol, or PWA vs. native mobile delivery. Those three questions
remain explicitly open and out of scope for this build. In the owner's words: *"we want the virtual
system to operate fully with all of it's features. we do not need it to be a mobile app. lets get
the virtual webhosted version to function before we think about PWA vs native mobile app."*

This phase is being delivered in two passes against the same tile list:

- **Part 1 (this pass, 2026-09-17):** Time Sheet, Trips, Settings.
- **Part 2 (separate pass, not yet started):** Forms, Messaging, Location, Invoices.

---

## Why the old "outline only" framing existed, and why it no longer governs this build

The original reasoning — that detailing tiles before pilot evidence means guessing — was sound as
far as it went. The owner has now made the call anyway: build full tile depth first, on the web
simulator only, and let real usage (not a hypothetical pilot) validate it once it's real. The
schema/architecture background below is unaffected by this and still holds.

---

## Where Front Line stands

**Schema:** complete. `crm-schema/024_frontline_devices_and_sync.sql` defines 11 tables — devices, assignments, sessions, job packages, commands, resumable uploads, sync cursors, conflicts, push subscriptions. `docs/erp-operational-architecture.md` specifies the endpoint shapes and eight conflict/offline rules.

**Built:** an in-browser phone-frame simulator inside the CRM (`app.js`, `renderFrontline*`, `FRONTLINE_TILES` at `app.js:11375`). It has a fake login (field-lead picker, no real auth), a 3×3 tile launcher, and a **genuinely working Job Book / Work Plan flow** that reads and writes the real `dispatchJobs` / `jobSteps` / `jobActions` / `jobFormSubmissions` collections through the same API the desktop uses.

It validates the data model and UX end-to-end. It is not the real mobile app.

**Tile status:**

| Tile | State |
|---|---|
| Job Book | ✅ Real — work-plan gating, typed task capture (photo / signature / timer / material / checklist / sample) |
| Time Sheet | ✅ Real (Part 1, 2026-09-17) — clock-in/out against a `timeEntries` collection, optionally linked to a dispatch job. See "Time Sheet vs. Timer-task hours" below — this is a distinct concept from Phase 09's per-project labor cost hours, not a replacement for it. |
| Trips | ✅ Real (Part 1, 2026-09-17) — mileage logging against a new `jobMileageEntries` collection (JSON equivalent of the designed `job_mileage_entries` table), general-purpose (not sampling-specific). |
| Settings | ✅ Real (Part 1, 2026-09-17) — field-lead/device profile (from the existing session + `employees`/`frontlineDevices`), a real online/offline connection indicator, and persisted notification preferences. |
| Forms | Stub — Part 2, not started. Would reuse `jobFormSubmissions`. |
| Messaging | Stub — Part 2, not started. Needs a new `messages` collection. |
| Location | Stub — Part 2, not started. |
| Invoices | Stub — Part 2, not started. |

---

## In scope for this build

- Full feature depth on Time Sheet, Trips, and Settings (this pass) and, in a later pass, Forms,
  Messaging, Location, and Invoices — all reading/writing real JSON-backend collections through the
  same `/api/backend/{collection}` API the desktop already uses, exactly like the existing Job Book.
- New backend collections where the schema is designed but the JSON prototype doesn't have an
  equivalent yet (e.g. `jobMileageEntries`), added to `server.mjs` (`defaultBackend`,
  `collectionAccess`, `filterBackendForRole`) and `data/backend.json`, following the existing
  pattern for every other collection in this file.
- The existing role/session picker (fake field-lead login) stays exactly as-is.
- The existing REST API to the JSON backend stays exactly as-is (no new endpoint shapes, no new
  auth model).

## Explicitly out of scope for this build

These four items from the old "Likely scope" list below are **not** part of this pass or the Part 2
pass that follows it. They remain real future work, gated on a real production decision this
prototype isn't trying to make yet:

1. **Production Front Line API** — the endpoints in `docs/erp-operational-architecture.md`: `/frontline/bootstrap`, `/assignments`, `/jobs/{id}/package`, `/commands`, `/uploads`, `/sync`. The simulator keeps using the existing `/api/backend/{collection}` REST API.
2. **Real device auth**, replacing the employee picker. The fake field-lead picker stays.
3. **Real offline sync** — the eight conflict rules, idempotency keys, `row_version`, resumable uploads, an offline queue. Every write in this build goes straight to the shared backend; there is no queue and nothing to reconcile.
5. **Decide the delivery target:** PWA vs. native iOS/Android. Not addressed by this build at all — the point of this build is to make the *feature set* real first, independent of that decision.

(Item 4, "tiles, prioritized by pilot evidence," is superseded by the owner's decision to build full
tile depth now rather than wait for pilot evidence — see the Part 1 / Part 2 split above.)

---

## Known constraints to carry forward

- Job packages must contain **only** the assigned worker's jobs and permitted customer data — never unrelated customers
- Front Line does not own a second business data model; it holds temporary projections, commands, and upload queues
- Lifecycle transitions are revalidated server-side; Front Line submits commands, it does not update job rows
- The prototype implements only simple sequential action ordering — the full `job_action_definition_dependencies` graph is not built

---

## Part 1 implementation notes (2026-09-17): Time Sheet, Trips, Settings

### StreetSmart research

Fetched `https://support.streetsmartmobile.com/section/4400-articles` directly (the fetch worked).
It confirmed the shape used below rather than changing it:

- **Time tracking** is modeled as starting/ending a shift, reviewed later from a web portal —
  exactly the clock-in/out shape built here, not a per-task stopwatch.
- **Trip tracking** is manual start/end odometer entry for expense reimbursement — exactly the
  odometer-pair-to-distance shape built here.
- **Settings** covers device/session administration (auto-start, security code, shift
  notifications, device activation) — informed the Settings tile's device/session/notification
  split below.
- Forms and invoicing (Part 2 scope) also appeared as their own sections; noted for whoever picks
  up Part 2.

### Time Sheet vs. Timer-task hours — investigated, kept as two distinct concepts

Before building, the relationship between a Time Sheet entry and the Phase 09 cost-report hours
was checked directly in code, per this repo's "verify before you trust a plan" rule (the old tile
table's one-line description — "would write the existing `timeEntries` collection" — didn't say
enough to build from, and `timeEntries` itself had been retired 2026-09-16 with zero readers or
writers, per `docs/database-handoff-map.md`).

What's actually there: `laborHoursForProject()` (`app.js`, Phase 09 section) sums
`jobFormSubmissions` rows where the job action's `type === "Timer"`, reading `payload.hours` off of
one specific Job Book task inside a specific job's work plan. That is real, task-scoped, per-job
labor-cost data, and it already feeds the Phase 09 cost report and P&L.

That is a different concept from a **Time Sheet**: a clock-in/out attendance record — Work, Travel,
Break, Standby, or Other — that a worker starts and stops independent of any one Job Book task, and
which may or may not be tied to a dispatch job at all (admin time, travel between jobs, etc.). This
matches both the SQL design (`job_time_entries` in `crm-schema/023_job_execution_events.sql`,
explicitly separate from `job_action_instances`) and how StreetSmart models it (a shift-level
concept, not a task-level one).

**Decision: kept as two distinct, non-overlapping data paths.**

- Timer job-action hours → Phase 09 per-project labor cost (unchanged by this work).
- Time Sheet (`timeEntries`, new) → attendance/payroll record; optionally linked to a dispatch job
  for reporting, but **not currently read by the Phase 09 cost report.**

This is a real gap worth flagging, not a bug: a shop that wants "true loaded labor cost per job"
eventually needs one of these two sources reconciled into the other (or a third, explicit
allocation step), and that reconciliation was not built as part of this pass — it wasn't asked for,
and doing it well needs a decision on which source is authoritative for which purpose (task-level
job costing granularity vs. shift-level payroll accuracy) rather than a quick merge.

### What was built

- **`timeEntries`** (new collection, reintroduced in `server.mjs`'s `defaultBackend` +
  `collectionAccess` + `filterBackendForRole`, gated `operations`): `id`, `employeeId`,
  `dispatchJobId` (nullable), `entryType` (`work` / `travel` / `break` / `standby` / `other`),
  `startedAt`, `endedAt` (null while clocked in), `durationMinutes` (computed on clock-out),
  `notes`, `source: "frontline-timesheet"`. One open (no `endedAt`) entry per employee at a time is
  enforced client-side (`frontlineClockIn` blocks a second clock-in with a toast).
- **Time Sheet tile** (`renderFrontlineTimesheet`, `app.js`): shows the current open entry (if any)
  with a clock-out form, otherwise a clock-in form (time type + optional dispatch job picker scoped
  to the field lead's own jobs via `frontlineMyDispatchJobs`), a running "this week" total
  (Monday-anchored), and a recent-entries list.
- **`jobMileageEntries`** (new collection, same wiring as above, gated `operations`): the JSON
  equivalent of the designed `job_mileage_entries` table (`crm-schema/023_job_execution_events.sql`)
  — `id`, `employeeId`, `dispatchJobId` (nullable), `mileageType` (`travel_to` / `job` /
  `travel_from` / `other`), `beginningOdometer`, `endingOdometer`, `calculatedDistance` (computed
  client-side from the odometer pair), `capturedAt`, `notes`. General-purpose, not sampling-specific
  — see the odometer/travel-time gap item below for how this relates to the sampling-specific ask.
- **Trips tile** (`renderFrontlineTrips`): log-a-trip form plus a "this week" mileage total and
  recent-trips list. Rejects (via toast, no partial save) an ending odometer below the starting one.
- **Settings tile** (`renderFrontlineSettings`): the field lead's real profile (name, title,
  employee number, mobile, email) from `employees`, a real online/offline indicator
  (`state.online`, backed by `navigator.onLine`, already wired app-wide — not faked for this tile),
  a real pending-sync-queue count (`state.syncQueue`, which is always 0 for Front Line writes since
  they go straight to the backend with no queue), the field lead's registered `frontlineDevices`
  (reusing the existing `renderFrontlineDeviceCard` from the Workforce module), and a notification
  preferences form (job-assigned / message / end-of-day-reminder toggles) persisted through the same
  IndexedDB `settings` store as desktop `platformSettings` (`getSetting`/`putSetting`, key
  `frontlineNotificationPrefs`). No fabricated settings — everything shown maps to a real field
  already in the data model or a real, saved preference.

### How this relates to the sampling odometer-capture gap (below)

The "Odometer/travel time capture" gap item further down asks for start/arrival odometer capture
*per site relocation within a single sampling job* — that's a Job Book task-type concept (repeatable
within one job's work plan), not this tile. The Trips tile built here is the general-purpose,
account-level mileage log a StreetSmart-style app would call "trip tracking." Both can use the same
`jobMileageEntries` collection later (a sampling-job odometer task could write rows here with
`mileageType: "job"` per relocation), but that task-type work itself was not built in this pass —
it stays open, and whoever picks it up should point it at `jobMileageEntries` rather than inventing
a second mileage collection.

### Click-testing (Playwright, live against `server.mjs` + `data/backend.json`)

Verified end-to-end with a scripted Chromium session against the running app:
logged in as a Field Lead → clocked in against a real dispatch job → confirmed the clock-out form
and "in progress" list row appeared → clocked out with notes → confirmed the entry moved to
"Recent entries" with a computed duration and the notes attached → logged a trip with a real
odometer pair → confirmed it appeared in "Recent trips" with the correct calculated distance and a
"this week" mileage total → opened Settings and confirmed the field lead's real profile, a live
online/offline indicator, 0 pending sync items, the registered device card, and saved a
notification-preference change → confirmed it persisted through a re-render. Zero console or page
errors across the full run. Test data written during this pass was reverted out of
`data/backend.json` afterward (`git checkout`) so only the two illustrative seed rows described
above ship in the commit.

---

## Concrete gaps raised 2026-09-16 (`bioremedy crm notes 9.16.2026.docx`)

This is still an outline — these items add specific, real detail to "likely scope" above, but this section is not yet a session-ready implementation plan. Treat it as the backlog to draw from once the pilot (or further scoping) says which of these matter most.

- **Odometer/travel time capture.** *"On frontline app for sampling job we need capture travel and truck time we need to capture start odometer and then arrival odometer on site then again for each time the truck relocates to a new site."* Needs a new task type or extension to the existing task model — capture start/arrival odometer readings, repeatable per site relocation within a single job.
- **Only one sample can be added per job.** *"front line app doesn't let you add additional samples. Its only one."* The Job Book's Sample task type needs to support repeatable entries, not a single fixed slot.
- **Job status doesn't progress with work-plan completion.** *"Job status progression does not move along with work plan completion."* Related to the already-known-open `projects.projectStage`-written-but-never-read gap (see Phase 07 item 11) — check whether this is the same root cause before treating it as a separate Front Line bug.
- **Completed jobs shouldn't be reschedulable.** *"completed jobs should not be able to be rescheduled, it should be either an edit to the data or a new dispatch request."* A workflow/state-machine gap — once a job reaches Completed, rescheduling it in place should be blocked; the two allowed paths are editing the existing completed record's data, or creating a fresh dispatch request.
- **PPE quantity handling.** *"In frontline app for Log PPE you can get a negative amount of materials, this shouldn't block equipment usage, but should ask or confirm if this is correct and if they force it... it should flag the ops manager that inventory is wrong and going negative. Regardless of inventory count we should track what was used and potentially even let us do write in items."* Specific, non-obvious behavior wanted: don't block on negative inventory, confirm-and-flag instead, and support free-text "write-in" material entries alongside the catalog. Related to Phase 07 item 9's materials-over-reservation gap — same underlying "inventory truth vs. field reality" tension, worth solving with one consistent philosophy across both.
- **Waste tracking for regulatory compliance.** *"We also need to track waste post site work completion if waste requires to be tracked per TCEQ and EPA guidelines, we will be using BioRemedy's 10 day storage permit and oily waste handler permit as well as many other permits the company holds. These permits should also be tracked and managed by the crm. We need to make sure we get disposal requests, receipts, and any other expenses needed to track total cost on jobs."* Two halves: (1) **field capture** of waste-tracking data belongs here in Front Line (what a worker records on-site); (2) **permit management and cost roll-up** is a bigger, ongoing-compliance concern — tracked in Phase 11, and the cost side connects to Phase 09 (Billing & Invoicing)'s P&L report. Do not build the capture UI without first deciding the permit data model in Phase 11 — the fields captured need to match what the permits actually require.
- **Sample-adjacent fields that should be photo captures.** *"on samples it mentions north view, sample interval, and container label. These are photos that should be uploaded during sampling."* Same item as Phase 07's item 7 — a new photo-capture task type for these three specific shots.
- **Flexible "+ activity" capture alongside the structured template.** *"We want the front line workers to fill in information in a structured way but also be able to note things as we progress... There should almost be a '+ activity' button and the front line worker can add different things into the report like notes, or additional samples, or a waste signature, or photos. This way the frontline worker follows their required template, but can add in additional info as needed since the front line environment may deviate from the template."* A real design principle, not just a feature request: the Job Book's template-driven work plan should stay the primary structure, but allow ad hoc additions (notes, extra samples, signatures, photos) that don't fit the predefined template steps. This has real design implications for the work-plan/task-gating model — it's not a small addition, it changes the assumption that the template fully describes what can happen on a job.
- **Research StreetSmart for reference.** *"look into streetsmart and see how granular the data can get for their connection. If looking at a few sample post work reports could help you get an understanding of what type of info we need to be gather that could be good."* Done, 2026-09-17 — see "Part 1 implementation notes" above. StreetSmart's time tracking is shift-level (matches Time Sheet as built) and its trip tracking is manual start/end odometer (matches Trips as built).

---

## Corrections found during implementation

- **The tile table's "Time Sheet — would write the existing `timeEntries` collection" was stale.**
  `timeEntries` had actually been *retired* 2026-09-16 (zero `app.js` readers/writers, per
  `docs/database-handoff-map.md`) — it no longer existed in `server.mjs`/`data/backend.json` by the
  time this pass started. It was reintroduced 2026-09-17 with a real tile behind it this time. Lesson
  for future passes: a doc line naming a collection doesn't mean the collection currently exists —
  checked directly in `server.mjs` before assuming so, per this repo's "verify before you trust a
  plan" rule.
- **Time Sheet and the Phase 09 Timer-task labor hours are not the same thing and were not merged.**
  See "Time Sheet vs. Timer-task hours" above for the full reasoning. Flagging here so a future pass
  doesn't assume they were reconciled — they weren't, and reconciling them needs an explicit decision
  (which source is authoritative for job-costing vs. payroll), not a mechanical merge.
- **`filterBackendForRole()` in `server.mjs` is an explicit per-collection allowlist, not a
  passthrough.** Adding `timeEntries`/`jobMileageEntries` to `defaultBackend` and `collectionAccess`
  alone was not sufficient — a new collection also has to be added to `filterBackendForRole()` or
  every role's `/api/backend` GET silently receives an empty array for it. Worth calling out because
  it's easy to add a collection in two of the three required places and still see empty data with no
  error.
