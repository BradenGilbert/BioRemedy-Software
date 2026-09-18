# Phase 10 — Front Line: Real Tiles

**Status:** Both parts shipped 2026-09-17. All eight tiles are real; the concrete-gaps backlog is
resolved or explicitly deferred (see "Part 2 implementation notes" below). Mobile app / production
auth / offline sync decisions remain explicitly out of scope, as planned.
**Depends on:** Phases 06, 07, 08
**Owner decision, 2026-09-17:** the pilot-gated "outline only" posture below is superseded. The owner
wants the in-browser Front Line simulator built out to a fully-working, web-hosted field-service
experience — every tile a real feature, not a stub — **before** any decision is made on production
device auth, a real offline-sync protocol, or PWA vs. native mobile delivery. Those three questions
remain explicitly open and out of scope for this build. In the owner's words: *"we want the virtual
system to operate fully with all of it's features. we do not need it to be a mobile app. lets get
the virtual webhosted version to function before we think about PWA vs native mobile app."*

This phase was delivered in two passes against the same tile list, both shipped 2026-09-17:

- **Part 1:** Time Sheet, Trips, Settings.
- **Part 2:** Forms, Messaging, Location, Invoices, plus the "Concrete gaps raised 2026-09-16"
  backlog below.

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
| Forms | ✅ Real (Part 2, 2026-09-17) — a small standalone form catalog (Daily Safety Checklist, Incident Report, Vehicle Inspection, Near-Miss Report) writing to `jobFormSubmissions` with `standalone: true`, optionally linked to a job. |
| Messaging | ✅ Real (Part 2, 2026-09-17) — new `messages` collection, threaded by dispatch job or a shared "general" thread. |
| Location | ✅ Real (Part 2, 2026-09-17) — reuses the `locations` GPS collection and the Facility page's Leaflet satellite-map pattern; records a real geolocation ping. |
| Invoices | ✅ Real (Part 2, 2026-09-17) — read-only billing status for the field worker's assigned jobs, reusing Phase 09's `getFinanceRows()`. |

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

## Part 2 implementation notes (2026-09-17): Forms, Messaging, Location, Invoices, and the gaps backlog

### Tiles

- **Forms.** Investigated first, per this repo's "verify before you trust a plan" rule: neither
  `jobTypeTemplates` nor anything else in the prototype defined a standalone "fill this out any time,
  not tied to a job step" form catalog, so guessing at a bigger config system wasn't warranted. Built
  `FRONTLINE_STANDALONE_FORMS` (`app.js`) — four hardcoded forms (Daily Safety Checklist, Incident
  Report, Vehicle Inspection, Near-Miss Report) — reusing `jobFormSubmissions` with `standalone: true`
  and an optional `jobId`, exactly the pattern the phase doc suggested.
- **Messaging.** New `messages` collection (`server.mjs`: `defaultBackend`, `collectionAccess` under
  `dispatch`, and `filterBackendForRole` — all three, per Part 1's trap). Threaded by `dispatchJobId`
  when one is picked, or a shared `"general"` thread key when not. No group channels, no attachments,
  no per-person office directory — the simulator has no office-side session to message as, so the
  recipient is always "Dispatch." Viewing a thread marks unread office-sent messages `readAt` with a
  real write.
- **Location.** Reuses the existing `locations` GPS-point collection (Phase 02's rename target for
  the old `mapLocations` — confirmed against `GLOSSARY.md` before touching it) and the exact Leaflet
  satellite-tile pattern from the Facility detail page's `renderFacilityMapPanel`/
  `initializeFacilityMap`, rather than a second map component. Records a real
  `navigator.geolocation` ping as a `locations` row. **Correction found during implementation:**
  `server.mjs`'s `normalizeRecord()` for `"locations"` is a strict field allowlist — a first version of
  this tile wrote `reportedByEmployeeId` on the client, but the server silently dropped it on save
  (same class of trap as Part 1's `filterBackendForRole` allowlist, different function). Fixed by
  adding `reportedByEmployeeId` to the server's `locations` normalizer explicitly. Caught live: the
  written-then-reloaded record was missing the field, so the tile's own "your pings" filter couldn't
  find it.
- **Invoices.** Read-only. Reuses Phase 09's `getFinanceRows()` (keyed by project) joined through each
  of the field worker's `dispatchJobs` via `job.projectId`, rather than recomputing cost/margin a
  second way. Shows job number, invoice status, and the same `invoiceSignal` text the office Finance
  workspace shows — no edit affordance.

### Concrete gaps backlog

- **Odometer/travel-time capture** — new `"Odometer"` job-action type (start/arrival odometer,
  computed distance), writing to the existing `jobMileageEntries` collection (`mileageType: "job"`)
  per the note left in Part 1 pointing future work there instead of a second mileage collection.
- **Multiple samples per job** and **"+ activity" ad hoc capture** — solved together, deliberately,
  because they're the same underlying problem. Rather than special-case "let Sample repeat," this
  built a general **"+ Activity"** mechanism (`ensureFrontlineAdHocStep`,
  `frontlineSubmitAdHocActivity`, `renderFrontlineAdHocCaptureForm`): a real `jobSteps` row (flagged
  `adHoc: true`, filtered out of the rendered work-plan step list so it never gates the template) that
  new `jobActions` rows get created under on the fly, for type Note / Photo / Signature / Sample /
  Odometer. This reuses every existing attachment/sample/mileage write path unchanged instead of a
  parallel data model. The template's single Sample/Odometer slot stays the first, structured capture;
  repeats go through "+ Activity" on the job detail screen. This is the concrete design implication
  the phase doc flagged: **the template no longer fully describes what job actions can exist for a
  job** — a hidden, non-gating step can hold an arbitrary number of ad hoc ones.
- **Sample photo-capture fields** (same item as Phase 07 item 7) — "North view," "Sample interval,"
  and "Container label" are now three separate required photo inputs on the Sample capture form
  (`renderFrontlineSampleCapture`), uploaded with distinct captions via the existing job-task-attachment
  endpoint. The prior free-text `depthInterval`/`containerSummary` fields were kept as supplementary
  metadata, not replaced — the photos are the new requirement, not a replacement for the written record.
- **PPE quantity handling** — `handleJobTaskConsume` (`server.mjs`) no longer hard-blocks a line that
  would take an item negative; a line with `force: true` is allowed through and raises a new
  `inventoryAlerts` row (`inventoryItemId`, `resultingBalance`, `requestedBy`, `status: "Open"`) for
  ops-manager visibility — no alerts-inbox UI was built for this pass, this is the record such an
  inbox would query. The client (`frontlineCompleteAction`) precomputes the negative-balance case and
  uses a `window.confirm` before setting `force: true`, so the worker is asked, not silently allowed
  or silently blocked. Free-text write-in items (`materialWriteInName`/`materialWriteInUnit`) never
  touch inventory at all — they're tracked as used via a `jobResources` row with no `inventoryItemId`.
  Verified live: forcing 9999 PPE kits against 34 on hand raised the confirm dialog, and after
  accepting it wrote a real `inventoryAlerts` row and drove `inventoryItems.onHand` negative, exactly
  as designed. Same "log what happened, don't gate on the count" philosophy as Phase 07 item 9's
  materials-over-reservation resolution — kept consistent rather than solved twice.
- **Completed jobs shouldn't be reschedulable in place** — `saveDispatchSchedule` and
  `openDispatchScheduleDialog` (`app.js`) both now refuse a job whose `status === "closed"`, with a
  toast naming the two allowed paths (edit the record, or a new dispatch request). The Dispatch Job
  Detail page's "Schedule" button is swapped for a "New dispatch request" button (pre-filled with the
  job's account/project) once a job is closed, so the blocked path isn't even offered as the first
  affordance. Verified live: the closed Riverbend job (`dispatch-job-riverbend`) shows "New dispatch
  request" instead of "Schedule" on its detail page.
- **Job status doesn't progress with work-plan completion** — checked directly in code before treating
  this as a new bug, per this repo's working rules. It is **already resolved**, and not by this pass:
  `advanceDispatchJob()` (`app.js`) calls `advanceProjectStageFromDispatchStatus()` on every dispatch
  status transition, which is exactly Phase 07 item 11's fix. The Front Line status-action path
  (`frontlineCompleteStatusAction`) calls `advanceDispatchJob()` too, so a Front Line-driven status
  change already propagates to the project's stage ladder the same way an office-driven one does. No
  code change was needed here; this entry exists so the gap is marked closed with its reasoning
  recorded rather than silently dropped.
- **Waste tracking for regulatory compliance** — still explicitly deferred, as planned. The permit
  data model doesn't exist yet (Phase 11/13), and guessing at capture fields before that model is
  decided was called out as the wrong order of operations in the original gap note. Not touched in
  this pass.
- **Research StreetSmart for reference** — done in Part 1; unchanged by Part 2.

### Click-testing (Playwright, live against `server.mjs` + `data/backend.json`)

Verified end-to-end with scripted Chromium sessions: submitted a standalone Incident Report form and
confirmed it appeared in Forms' recent-submissions list; sent a field-to-dispatch message and
confirmed it rendered in the thread; recorded a real geolocation ping on the Location tile and
confirmed it round-tripped through the API (after the `reportedByEmployeeId` normalizer fix above);
viewed the Invoices tile against a job with real Phase 09 billing data; completed a Sample task with
all three required photos, then added a **second** sample via "+ Activity" (multi-sample gap
resolved); added an ad hoc Odometer entry and an ad hoc Note outside the template; forced a Material
submission to 9999 units against 34 on hand, confirmed the `window.confirm` prompt text, accepted it,
and confirmed a real `inventoryAlerts` row and a negative `onHand` resulted; confirmed the closed
Riverbend job shows "New dispatch request" instead of "Schedule." Zero console or page errors across
every run. All test-session writes were reverted out of `data/backend.json` afterward
(`git checkout`) so only the intentional seed rows described above ship in the commit.

---

## Concrete gaps raised 2026-09-16 (`bioremedy crm notes 9.16.2026.docx`)

All items below are now resolved or explicitly deferred — see "Part 2 implementation notes" above for
what was built and why. Kept here as the original source record.

- **Odometer/travel time capture.** *"On frontline app for sampling job we need capture travel and truck time we need to capture start odometer and then arrival odometer on site then again for each time the truck relocates to a new site."* ✅ Resolved — new `"Odometer"` job-action type, repeatable per relocation via "+ Activity," writing to `jobMileageEntries`.
- **Only one sample can be added per job.** *"front line app doesn't let you add additional samples. Its only one."* ✅ Resolved — additional samples go through "+ Activity."
- **Job status doesn't progress with work-plan completion.** *"Job status progression does not move along with work plan completion."* ✅ Verified already resolved by Phase 07 item 11's fix, on both the office and Front Line status-change paths — see above.
- **Completed jobs shouldn't be reschedulable.** *"completed jobs should not be able to be rescheduled, it should be either an edit to the data or a new dispatch request."* ✅ Resolved — reschedule blocked for `status === "closed"`, with a "New dispatch request" alternative surfaced in the UI.
- **PPE quantity handling.** *"In frontline app for Log PPE you can get a negative amount of materials, this shouldn't block equipment usage, but should ask or confirm if this is correct and if they force it... it should flag the ops manager that inventory is wrong and going negative. Regardless of inventory count we should track what was used and potentially even let us do write in items."* ✅ Resolved — confirm-and-force flow plus `inventoryAlerts`, and free-text write-in items.
- **Waste tracking for regulatory compliance.** *"We also need to track waste post site work completion..."* Still deferred — permit data model doesn't exist yet (Phase 11/13). Not built.
- **Sample-adjacent fields that should be photo captures.** *"on samples it mentions north view, sample interval, and container label..."* ✅ Resolved — three required photo-capture fields on the Sample task.
- **Flexible "+ activity" capture alongside the structured template.** *"...There should almost be a '+ activity' button..."* ✅ Resolved — see "+ Activity" above.
- **Research StreetSmart for reference.** Done, 2026-09-17, in Part 1.

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
- **(Part 2) `normalizeRecord()` in `server.mjs` is the same kind of allowlist trap, one level down.**
  A collection can be wired into all three places above and still silently drop a field on every
  write, if that collection has its own `normalizeRecord()` branch (several do — `locations` among
  them) that only carries forward a fixed set of named fields. The Location tile's
  `reportedByEmployeeId` was written by the client, accepted with a 200, and silently dropped by the
  server before it ever reached `data/backend.json`. Caught by reading the value back after a real
  write, not by inspecting the client code that sent it — the same "verify against running code, not
  the plan" lesson as Part 1's `filterBackendForRole` finding, just one layer deeper. Fixed by adding
  the field to the `locations` branch of `normalizeRecord()` explicitly.
- **"Multiple samples per job" and "+ activity" were the same problem, not two.** The gap list
  presented them as separate items, but implementing repeatable Sample capture as its own special case
  would have meant re-solving "how does a field worker do something the template didn't pre-author"
  twice with two different mechanisms. Building the general "+ Activity" ad hoc path first and letting
  repeat samples (and repeat Odometer legs) use it resolved both gap items with one piece of work and
  kept the work-plan/task-gating model change to a single, well-reasoned place instead of two.

---

## Live bug report follow-up — 2026-09-17 (third session)

The owner reported three live issues about sample photos and lab reports after using the platform.
All three were reproduced against real code before fixing, per this phase doc's own rule.

1. **"On samples it says point overview, point closeup and point label look like they should be
   photos or clickable, but it just is a big box with labels."** The owner's field names didn't match
   any code string exactly (a `grep` for "Point Overview"/"Point Closeup"/"Point Label" found nothing)
   — they're a paraphrase of the real fields this same phase's Part 2 pass added: "North view,"
   "Sample interval," and "Container label." This is the desktop **Sample Record** view
   (`renderProjectSampleRecord` and the sample detail page, `app.js`), a completely different surface
   from the Front Line capture form the owner filled out to create the sample. Root cause:
   `renderProjectSampleRecord`/the sample detail page rendered `sample.photos` — a field
   `saveSampleFromTask` hardcoded to `photos: []` and nothing ever wrote to — falling back to three
   bare `<span>` labels styled by `.sample-photo-grid span` (`styles.css`) with a decorative gradient
   background and bold text, exactly the "big box with labels" the owner described: no `<img>`, no
   click handler, no `cursor: pointer`. The actual Sample-task photos **were** being uploaded
   correctly the whole time, to `jobTaskAttachments` keyed by `actionId` (the same pipeline the
   dispatch job detail's task-submission view already renders as real thumbnails from) — they were
   just never read back for this view. **Fix:** both render functions now call
   `attachmentsForAction(sample.actionId)` filtered to `kind === "photo"` and render real `<img>`
   thumbnails inside a clickable `<a href=".../view" target="_blank">` (`renderSamplePhotoThumb`,
   `app.js`), matching the working pattern already used elsewhere. `sample.photos` itself is now dead
   (nothing reads it) — left as-is rather than removed, since removing a field from in-flight seed
   records is out of scope for a bug-fix pass.
2. **"Sample photos don't appear anywhere... if its not connected it will [need fixing]."** Same root
   cause as item 1, confirmed by direct evidence, not by inference: this is a wiring bug, not a
   storage-limit issue. The known-open item in `docs/roadmap/README.md` ("Attachment inline-view route
   is not role-gated") pointed at a real, working attachment system —
   `handleJobTaskAttachmentUpload`/`handleJobTaskAttachmentView` (`server.mjs`), storing files under
   `data/uploads/` and serving them from `/api/job-task-attachments/:id/view`. Verified live: created a
   real ad hoc Sample activity via Front Line with three real PNG files, confirmed all three uploaded
   successfully to that pipeline, then confirmed the Sample Record detail page rendered all three as
   real `<img>` tags with `naturalWidth > 0` (the browser actually decoded them) once the item 1 fix
   was in place. No storage limit, no missing upload path — the photos were always being persisted
   correctly; only the read-back was missing.
3. **"Lab report reference is a link or text file name. We should have an option to upload test
   results which could be excel, or pdf. If a link is used it should detect it and make it
   clickable."** Confirmed: `sampleRecords.labReportUri` (set via the `#sampleLabDialog` "Lab report
   reference" field, `openSampleLabDialog`/`saveSampleLabInfo`, `app.js`) was free text only, rendered
   as inert `<code class="file-ref">` regardless of content. **Fix, two parts:**
   - **Real file upload.** New `sampleLabReports` collection (`server.mjs`: `collectionAccess`,
     `defaultBackend`, backend-load normalization, `filterBackendForRole`, all gated `operations`,
     following this phase's own "three places, not two" lesson above) with a dedicated
     `handleSampleLabReportUpload`/`handleSampleLabReportDownload` pair
     (`/api/samples/:sampleId/lab-reports` POST, `/api/sample-lab-reports/:id/download` GET) — cloned
     from the existing `jobRequestDocuments` upload/download pattern rather than the photo-only
     `jobTaskAttachment` pipeline, since a lab result is a PDF/Excel/Word/CSV document meant to be
     downloaded, not loaded from a bare `<img src>`. `id`, `sampleId`, `fileName`, `storageName`,
     `mimeType`, `sizeBytes`, `uploadedAt`, `uploadedBy`. The sample detail page's "Laboratory and
     results" panel now lists uploaded reports (`renderSampleLabReport`) and has a real
     `<input type="file">` (`data-action="upload-sample-lab-report"`, wired through the existing
     `handleInputInner` delegated-input dispatcher) that uploads immediately on file selection. The
     `labReportUri` text field is kept, not replaced — a lab may still just hand over a portal link
     rather than a file, and both should be supported.
   - **Auto-linkify.** `looksLikeUrl()`/`normalizeUrlHref()` (`app.js`) detect an `http(s)://` or
     `www.`-prefixed value and render it as a real `<a class="file-ref" target="_blank">` instead of
     `<code>`; anything else (a typed filename) still renders as plain text, since there's no real
     file behind a typed-in filename to link to.
   - **Verified live (Playwright, chromium via the bundled runtime, against the running dev server on
     port 4173):** logged into Front Line as a real field lead, opened an in-progress dispatch job
     whose `projectId` actually resolves (`dispatch-job-clearwater` — `dispatch-job-georgetown`'s
     `projectId` turned out to be a dangling reference to a project record that doesn't exist in the
     `projects` collection, a pre-existing seed-data gap unrelated to this fix, noted here rather than
     silently worked around), submitted a real "+ Activity" → Sample with three real PNG files,
     confirmed the sample detail page rendered three real, loading `<img>` thumbnails; uploaded a real
     PDF through the new lab-report upload input and confirmed it appeared as a downloadable
     "lab-report.pdf" entry; opened "Assign lab / report results," set the lab report reference to a
     real URL, saved, and confirmed it rendered as a clickable `<a class="file-ref">` pointing at that
     URL. Zero console/page errors across the run. All test-session writes (3 sample records, 3 job
     actions, 2 ad hoc job steps, 9 photo attachments, 1 lab report file, 3 form submissions) were
     identified precisely by id and removed from `data/backend.json` afterward (not a blanket
     `git checkout`, since the file already had real, pre-existing uncommitted owner data from before
     this session that had to be preserved) and their uploaded files deleted from `data/uploads/`.

### Corrections found during this pass

- **`dispatch-job-georgetown.projectId` ("project-georgetown-er") does not exist in the `projects`
  collection.** Discovered while picking a job to click-test against: `viewSample()` requires both the
  sample and `findProject(sample.projectId)` to resolve, and Georgetown's dangling reference made the
  desktop sample detail page unreachable for any sample logged against that job (silent
  "That sample record is not available." toast, not a crash). This is a pre-existing seed-data gap,
  not something introduced by this pass — flagged here rather than fixed, since correcting seed data
  under a live-bug-fix pass risks masking whether it's an isolated seed typo or a symptom of a real
  Georgetown-job data issue elsewhere; whoever picks it up should check whether other Georgetown-linked
  records have the same dangling `projectId` before just repointing it.
