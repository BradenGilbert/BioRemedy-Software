# Phase 07 — Dispatch & Operations Correctness

**Status:** ✅ **Complete except item 8.** The 2026-09-17 verification pass and live-bug follow-up, and the 2026-09-22 pass's four items (2026-09-23), are done; the Front Line timer-hours fix was verified live 2026-09-23. **Sprint Wave 4 (2026-09-23):** item 4 (job-centric Plan & resources tab, Q33) is built, and item 7 (sample photos) was found already done by Phase 10. **Remaining:** item 8, the job-template rebuild, which the owner explicitly left deferred (Q34).
**Depends on:** Phase 01 (shared data layer — dispatch and projects are already server-side, this phase fixes behavior, not data location)
**Estimated sessions:** 3
**Source:** `bioremedy crm notes 9.16.2026.docx`

---

## Why this phase exists

The Account/Contact/Opportunity domains got a code-verified audit (Phases 03, 05, 06) before this phase doc was written. **These items did not get that same verification pass** — they're transcribed from the notes as reported, not yet confirmed against `app.js`/`server.mjs`. Treat every item here as "reproduce first, then fix," not "known-confirmed, just implement." The first work in this phase should be a verification pass exactly like the one Phase 06 got, updating each item below with CONFIRMED / PARTIALLY CONFIRMED / NOT FOUND before real implementation starts.

This phase groups everything from the notes that's about **dispatch, jobs, scheduling, materials, and workforce hours** — the operational side, as distinct from the sales-side correctness work in Phases 03/05/06.

**Verification pass completed 2026-09-17** before any fix was written, per the rule above. Findings and fixes are recorded per item below.

---

## In scope

### 1. Worker assignment display broken on the dispatch board

> *"On job and dispatch board assignment of workers the worker assignment display is broken and crunched to the left."*

Sounds like a CSS layout bug (similar in kind to Phase 06 item 14's checkbox bug). Reproduce on the Dispatch Board view, find the assignment-display component, and check for a missing/misapplied class the same way Phase 06 item 14 was diagnosed.

**✅ CONFIRMED and fixed 2026-09-17 — same shape of bug as Phase 06 item 14, a CSS selector that no longer matched the real markup.** `.job-assignment-row` (`styles.css`) defined a 3-column grid (`38px minmax(0,1fr) auto`) directly on the `<article>`, with a child-combinator rule `.job-assignment-row > span:nth-child(2)` meant to lay out the name/role text. But `renderJobAssignment()` (`app.js`) renders the article's *actual* direct children as two `<button>`s (the clickable employee row, then a separate "Unassign" button) — there is no direct `<span>` child at all, so the nth-child rule never matched anything, the grid columns applied to the wrong element, and the inner button's own content (avatar, name, badge) rendered with no layout at all — exactly "crunched to the left." Fixed by moving the grid definition onto the actual grid container (`.job-assignment-row > button:first-child`, mirroring the working `.schedule-assignment-card` pattern used elsewhere) and making the outer `.job-assignment-row` a simple flex row. Verified live: the Assignment tab's Workers panel now shows avatar, name, role/status, and eligibility badge in proper columns with "Unassign" aligned to the right.

### 2. Creating a dispatch request from a job creates two jobs

> *"On job and dispatch somehow when creating a dispatch request from a job it created two a draft and then the main one. They are labled JOB-2026-0916-35 and JOB-2026-0916-36"*

> *"when pushing jobs to dispatch is creates duplicates."*

These two notes almost certainly describe the same underlying bug — a double-write somewhere in the job-request-to-dispatch-job creation path (possibly a draft record that's supposed to be discarded or promoted in place, but instead a second record gets created alongside it). Find the function that creates a `dispatchJobs` record from a job/job-request and check for a double-submit, a draft-then-finalize pattern that doesn't clean up the draft, or a duplicate event handler firing the create twice.

**✅ CONFIRMED and fixed 2026-09-17 — a double-submit race in `convertJobRequest()` (`app.js`), not a draft/finalize pattern.** There was no separate "draft" step at all — `convertJobRequest()` is the one function that creates a `dispatchJobs` record from a `jobRequests` row, and its job-number sequence (`getDispatchJobs().length + 1`) is read *before* the `await saveBackendRecord(...)` call resolves. Nothing disabled the "Create job" / template-select buttons after the first click, so a fast double-click (or a slow first request plus an impatient second click) ran the function twice before either write landed, each computing the same next sequence number and each creating its own `dispatchJobs` record — exactly `JOB-2026-0916-35` and `-36` from one click. Confirmed the *existing* broken data still has this pattern live: the seed data's "Tall Tree Test stage jump op" project has **six** near-duplicate dispatch jobs (`JOB-2026-0916-35/36/37/38/39/40`) all created from repeated clicks on the same request, corroborating the bug exactly as reported. Fixed with a re-entrancy guard (`jobRequestConversionsInFlight`, a `Set` of in-flight `requestId`s) plus an early-exit if the request is already `Converted`/has a `convertedJobId`. Verified live: firing two near-simultaneous clicks at the same "No template" option now creates exactly one `dispatchJobs` record (confirmed via the API, not just the UI). Pre-existing duplicate seed rows were left in place — this is a going-forward fix, not a data cleanup.

### 3. Need a "back to project" button from a dispatch job

> *"On Dispatch and jobs we need to always have a button to take us back to the Project the job is for."*

Concrete, additive. `dispatchJobs.projectId` already exists and resolves correctly (confirmed during Phase 01/02 testing) — this is purely a missing navigation button on the Dispatch Job Detail page.

**✅ CONFIRMED and fixed 2026-09-17 — exactly as scoped, no navigation existed at all.** `renderDispatchJobDetail()`'s topline only had "Back to jobs" (back to the list) and the job's own status-advance button — nothing pointed at the parent project even though `job.projectId` reliably resolves via the existing `view-project` action used everywhere else in the app. Added a "Back to project" button (only rendered when `job.projectId` is set, since a dispatch job created outside of a project has nothing to link to) using the same `data-action="view-project"` pattern as every other project link. Verified live: clicking it from a dispatch job detail page navigates to the correct project (`#view=project-detail&selectedProjectId=...`).

### 4. Resource planning/scheduling is confusing from inside a job

> *"for job and dispatch of jobs we need to work on the planning and scheduling of resources and such. Maybe its for the schedule board, but doing it all from inside the job is confusing."*

**✅ Done 2026-09-23 (sprint Wave 4), per Q33 ("job-centric: resources are planned from the job, not a schedule board").** The confusion was two partial places to plan: the Schedule dialog (time, lead, plus a free-text resource quick-add) and the job's Assignment tab (typed pickers). Consolidated so each thing has one home:
- The Schedule dialog is *when + who leads*. The free-text resource quick-add is gone, replaced by a pointer to the tab.
- The Assignment tab is renamed **Plan & resources**. It opens with a full-width **Plan** panel: the schedule window, field lead, crew/equipment/materials/subcontractor counts, the plan-related readiness checks (schedule, workers, resources, equipment condition, subcontractor approvals) and an "Edit schedule & lead" button. Workers, Equipment, Materials and the new **Subcontractors** panel (Phase 04 item 5) follow.
- **New readiness check "Equipment condition":** Block when an assigned asset is on maintenance hold; Warning when it has an open issue.
- Old quick-add rows (vehicles, free-text vendors) stay visible under "Vehicles & other".

**⏸ Deferred — owner decision pending, matches Phase 04/06's pattern for deferred items.** This is a product/UX question, not a discrete bug: whether resource assignment belongs primarily on the Schedule Board with the job as a read-only reference, or vice versa. Implementing a fix here risks getting "fixed" into the wrong shape twice, so this session left it untouched. See "Open decisions" below.

### 5. Calendar shows "Yeady" instead of "Completed"

> *"on the schedule within jobs and dispatch is shows completed work on the calendar as 'Yeady' instead of 'completed'."*

Almost certainly a literal string typo somewhere (a status label constant or a truncated/garbled label). Grep for `"Yeady"` or similar near-matches (could be a typo of "Ready" colliding with a completed-state label, not just "Completed" misspelled) — trace to source before assuming it's a simple string fix, since "Yeady" doesn't obviously derive from "Completed" by typo alone and might indicate a status-value mismatch rather than a spelling error.

**✅ CONFIRMED as a status-value mismatch, not a spelling typo — the literal string "Yeady" does not exist anywhere in `app.js`, `server.mjs`, or `data/backend.json`.** Traced it instead: `getJobReadiness()` (`app.js`) computes a status ladder of `Blocked` / `Warning` / `In field` / `Review` / `Ready`, keyed off `job.status`, but had **no branch at all for a terminal job** (`isTerminalDispatchStatus(job.status)`, i.e. `closed`/`cancelled`). A completed job's status falls through every `includes(...)` check and lands on the `Ready` default — so a *closed, completed* job showed a green "Ready" badge on the calendar and everywhere else `renderReadinessBadge(getJobReadiness(job).status)` is used, which reads as "still needs dispatch," not "done." "Yeady" is almost certainly the notes author's own phonetic mishearing/mis-transcription of "Ready" while dictating the note (the two words share every sound except the initial consonant), not a string that ever existed in the app. Fixed by adding a `Completed` branch (checked first) whenever `isTerminalDispatchStatus(job.status)` is true, with matching CSS (`.readiness-badge.completed`) and a `getReadinessTone` entry so it renders in the same green as `Ready`. Verified live: advancing a dispatch job all the way to `closed` now shows "● Completed" on both the job detail header and (by the same shared function) the calendar/board readiness badge, replacing what was previously "Ready."

### 6. Samples need lab assignment and results reporting

> *"for samples collected we need a way to assign a lab and report results."*

`sampleRecords` already has `labName`/`labStatus`/`labResults` fields per the seed data (confirmed present in `data/backend.json`), so this is likely a missing **UI** for setting them, not a missing data model. Verify field coverage before assuming new schema is needed.

**✅ CONFIRMED as UI-only, exactly as suspected — no schema change needed.** The Sample Detail page's "Laboratory and results" panel (`app.js`) was pure display: `labName`, `chainOfCustody`, `labStatus`, `labReceivedAt`, `requestedAnalyses`, `reviewedBy`, `labResults`/`results`, and `labReportUri` were all read with no edit path anywhere in the app — a sample's lab fields were set once at field-capture time (`saveSampleFromTask`, always blank: `labName: "", labStatus: "Logged in field", labResults: ""`) and then frozen forever. Added a new `#sampleLabDialog` (index.html) covering all of those fields, an "Assign lab / report results" button on the panel header, and `openSampleLabDialog()`/`saveSampleLabInfo()` (`app.js`) wired to it via a new `sample-lab` form handler. No new collection or field — every field this dialog writes already existed in `sampleRecords`. Verified live: opened a real sample record from a project, set lab name/status/results/reviewed-by, saved, and confirmed the panel updates immediately (toast "Sample lab information saved," badge and detail list both reflect the new values).

### 7. Sample fields that should be photo uploads

> *"on samples it mentions north view, sample interval, and container label. These are photos that should be uploaded during sampling. Can we get that added to the front line work load."*

**✅ Closed 2026-09-23: already done by Phase 10 Part 2 (2026-09-17).** The Front Line Sample task has three *required* photo inputs (north view, sample interval, container label; `renderFrontlineSampleCapture()`), uploaded to `jobTaskAttachments` and shown as thumbnails on the sample record. Confirmed in code during sprint Wave 4; nothing left to build. **⏸ Deferred — cross-phase, depends on Phase 10.** This is a Front Line task-type addition (a photo capture task), not a Dispatch/Operations change per se. Left untouched this session; implement in coordination with Phase 10's task-type work as originally scoped.

### 8. Job dispatch templates may need a rebuild

> *"to be honest we might want to adjust how we build out job dispatch templates, what all information they request from the frontline worker and then how that information is presented in the project report and sample report logs."*

**⏸ Explicitly not a checklist item — revisit later, per the original scoping.** A broader "is the template model right" question spanning Dispatch (this phase), Front Line (Phase 10), and reporting (Phase 11). Left untouched this session; revisit once items 6/7/13 (Phase 10) are further along, not before.

### 9. Materials can be over-reserved beyond stock

> *"materials listed in a job assignment section under materials are noted as reserved, but it is possible to reserve more than you have in stock."*

A real validation gap — reserving a material against a job should check against on-hand inventory (`inventoryItems.onHand`) and either block or warn. Decide which (block vs. warn-and-allow) before implementing; environmental field work sometimes has legitimate reasons to over-commit against expected restock, so a hard block may be wrong. See Phase 11's Priority 1 item on the inventory ledger — that real ledger is the eventual right foundation for this check; decide whether to build a lighter interim check now or wait.

**✅ CONFIRMED and fixed 2026-09-17 — added mid-session once the owner decision came back.** `saveDispatchAssignMaterial()` (`app.js`) had no check at all against `inventoryItems.onHand` — any quantity could be reserved regardless of stock. **Owner decision (2026-09-17): warn but allow, don't block** — environmental field work legitimately over-commits against expected restock sometimes. Implemented as a lightweight interim check (explicitly not the real inventory ledger from Phase 11): on save, sums all active (`status: "Reserved"`) `jobResources` for that `inventoryItemId` across every job, compares the new total against `item.onHand`, and if it exceeds on-hand stock shows a toast warning naming the item and quantities — the reservation still saves either way. Also added a persistent "Over stock" badge (not just a one-time toast) on any material resource row whose combined reservations exceed on-hand, so the condition stays visible after the toast disappears. Verified live: reserved 999,999 bags of a material with 16 on hand — the reservation saved, a warning toast named the exact over-reservation amount, and the "Over stock" badge appeared on the resource row and persisted after reload.

### 10. Expired credentials/certifications have no update/clear path

> *"Credentials and certifications can expire but there is no way to update or clear those blocks."*

`employeeCertifications` exists and presumably has expiry dates already gating something (scheduling/dispatch assignment, per the certification-gating check referenced in `docs/database-handoff-map.md`). This item is about the **UI to renew or clear** an expired certification — verify whether the gate itself works correctly (blocks assignment when expired) before assuming the only gap is the update path; both might be missing.

**✅ CONFIRMED — the gate works, but the update path was completely missing, and worse than just "missing": editing "renewed" a credential by creating a duplicate.** The gate itself is real: `saveEmployeeCredential()` recalculates `employee.readinessStatus` (`Blocked` if any credential is `Expired`/`Suspended`/`Revoked`) every time a credential is saved. But `openCredentialDialog()` had no way to load an *existing* credential — it only ever populated a blank "Add credential" form — and `saveEmployeeCredential()` always generated a fresh `id: makeId("cert")` regardless. The only available action anywhere in the app was "Add," meaning the one way to "renew" an expired credential was to add a second row next to the still-expired original, which would have kept `readinessStatus` blocked forever (the stale `Expired` row remains in the array `saveEmployeeCredential` checks). Fixed by: adding a hidden `id` field to the credential dialog, having `openCredentialDialog(employeeId, credentialId)` pre-fill from the existing record when a `credentialId` is passed, having `saveEmployeeCredential()` reuse the existing `id` instead of always minting a new one (true in-place update), adding a "Renew / update" button to each credential row, and adding a `Revoked` status option (referenced by the gate logic but missing from the dropdown). Verified live: opened an existing HAZWOPER credential via "Renew / update," confirmed the dialog pre-filled with its real data (not blank), changed the expiry date and status, saved, and confirmed the employee's credential list still shows exactly 3 rows (not 4) with the updated expiry — a true update, not a duplicate.

### 11. Project status never advances to Mobilize/Field Work

> *"Project status never moves to mobilize or field work when it is clearly scheduled and completed."*

This directly matches an already-known-open item from the roadmap: **`projects.projectStage` is written at creation but never read** (`docs/roadmap/README.md`'s "Known-open items," slotted to Phase 11 before this notes pass). This note may be describing the exact same root cause. **Do not treat this as a new bug — cross-check against that known item first** and consolidate into one fix rather than debugging it twice from scratch.

**✅ CONFIRMED as the exact same root cause as the known-open item — consolidated into one fix, not debugged twice.** `projectStage` (`PROJECT_STAGES = ["Intake", "Plan", "Mobilize", "Field Work", "Closeout"]`) was written once at project creation (`saveProjectFromOpportunity`) and never read anywhere — `getJobProgress()`, the function every stage-ladder UI (`app.js`, 4 render sites) calls to compute which stage to highlight, derived `stageIndex` purely from free-text keyword matching against `job.status`/`job.activePhase` (e.g. does the text contain "mobil" or "field"). Since nothing ever wrote new keywords into `activePhase` as a project's actual dispatch work progressed, a project could have a fully closed, completed dispatch job and still show as stuck on "Intake." Fixed in two parts: (1) `getJobProgress()` now reads `job.projectStage` first when present, only falling back to the old text heuristic for legacy records that predate the field; (2) a new `advanceProjectStageFromDispatchStatus(projectId, dispatchStatus)`, called from `advanceDispatchJob()` every time a dispatch job's status changes, maps the dispatch status onto `PROJECT_STAGES` (`scheduled`/`dispatched`/`acknowledged`/`en_route` → Mobilize, `on_site`/`in_progress` → Field Work, `field_complete`/`office_review`/`closed` → Closeout) and writes both `projectStage` and `activePhase` on the project — never moving it backwards. Verified live: took a real dispatch job (linked to the "UST removal and soil remediation" project, stuck on Intake at the start of the session) through every transition from `Ready` to `Closed`, and confirmed the project detail page's stage ladder lit up Intake → Plan → Mobilize → Field Work → Closeout in step, ending fully progressed at 97% complete.

### 12. Worker hours not tracked when scheduled

> *"Hours for workers in labor section not being tracked if you schedule them."*

Verify whether this is a missing write (scheduling doesn't create the expected labor/hours record at all) or a missing read (hours are recorded somewhere but not surfaced in the labor section's display) before assuming which side needs the fix.

**✅ CONFIRMED as a missing write, not a missing read.** `employee.hoursWorked` (the field the Labor section's capacity bars and `renderLaborCard` display) had exactly one write site in the entire app (`saveEmployee`, which only ever carries the existing value forward unchanged: `hoursWorked: existing?.hoursWorked || 0`). Nothing — not scheduling an employee onto a job, not a dispatch assignment, not even a Front Line worker completing a Timer task and logging real hours in the field — ever incremented it. The one place the app *does* capture genuine worked hours is the Front Line Timer task type (`buildTaskPayload`'s `payload.hours`, submitted via `frontlineCompleteAction`), which was being recorded into `jobFormSubmissions` and then never propagated anywhere else. Note: scheduling itself doesn't know actual hours worked (only planned start/end), so this fix tracks *actual logged* hours from completed field work rather than pre-populating an estimate at scheduling time — the more meaningful of the two readings of "not being tracked," and consistent with what the Labor section's capacity display is meant to represent. Fixed by having `frontlineCompleteAction()` add the submitted Timer hours onto the submitting employee's (`state.frontlineSession`'s) `hoursWorked` at submission time. Not click-tested end-to-end through the full Front Line simulator flow this session (would require standing up a Front Line session and a Timer-type task on a live job template), but verified by code trace and syntax-checked; flagged here rather than claimed as fully live-verified.

### 13. Operations "intake" site should default from the sales-side facility/location

> *"On operations the generator and responsible party panel known as 'intake' we want 'site' to be the facility or location we selected during the sales process. Generator contact"*

The intake panel's "site" field should default to (or directly reference) whatever facility was already selected on the opportunity (Phase 02's `facilityId`, Phase 06 item 1's related field), instead of being asked for again independently at intake. The note trails off after "Generator contact" — confirm during implementation whether a related generator-contact linkage was also intended here, or whether that's a separate incomplete thought.

**✅ CONFIRMED and fixed 2026-09-17 — the "Generator and responsible party" panel (edited via `data-action="open-project-intake"`, i.e. exactly the panel the note calls "intake") already had the right fallback logic on the *read* side (`getProjectGenerator()`: `siteName: job.generatorSiteName || location?.name || ...` where `location = findFacility(job.facilityId)`), but the *write* side picked the wrong facility at project creation.** `saveProjectFromOpportunity()` set `facilityId: facilitiesForAccount(account.id)[0]?.id` — an arbitrary "first facility on the account" — completely ignoring `opportunity.facilityId`, the specific facility actually selected during the sales process. For an account with only one facility this is invisible; for a multi-site account it silently picks the wrong site. Confirmed live against real (pre-existing, pre-fix) data: the "Tall Tree Test stage jump op" opportunity for City of Georgetown has `facilityId` pointing at "Old Fire Office," but its already-created project shows Site as "FD house" / subtitle "at CorpO office Toy Shop Cow Moo" (a different one of the account's three facilities) — the exact bug, live in the data. Fixed by preferring `opportunity.facilityId` when creating the project, falling back to the account's first facility only if the opportunity has none set. **Not fixed / left open:** the trailing "Generator contact" thought — `getProjectGenerator()`'s contact resolution also picks an arbitrary first account contact (`contactsForAccount(job.accountId)[0]`) rather than any opportunity-specific contact, but opportunities don't have a single scalar "primary contact" field to prefer (contact relationships live in the `opportunityContacts` junction, Phase 06 items 6/7/11/19) — confirming and wiring that up is a separate, larger piece of work than the one-line facility fix, and the note itself trails off without spelling out what it wants. Flagged for a future session rather than guessed at.

---

## Out of scope

- The inventory ledger itself (lots, reorder rules, receiving) — Phase 11 Priority 1 item; item 9 here is a narrower interim check, not the full ledger
- Billing/invoicing on project close — Phase 09
- Front Line task-type work (photo capture, multi-sample) — Phase 10

---

## Data model changes

None. Every fix in this phase wired new or corrected UI/logic onto fields that already existed in `sampleRecords`, `employeeCertifications`, `projects`, and `dispatchJobs` — no new collections or fields were added. See `docs/database-handoff-map.md`'s Phase 07 note for the full list of what's now actually read/written that wasn't before.

---

## Verification / done criteria

- [x] Dispatch Board / Dispatch Job Detail worker assignment row renders avatar, name, role, and eligibility badge in proper columns, not crunched left (2026-09-17, verified live)
- [x] Converting the same job request twice in quick succession creates exactly one `dispatchJobs` record, not two (2026-09-17, verified live via near-simultaneous double-click + API check)
- [x] Dispatch Job Detail has a working "Back to project" button when the job has a `projectId` (2026-09-17, verified live)
- [x] A closed/completed dispatch job shows a "Completed" readiness badge, not "Ready," on both the job detail page and anywhere else `getJobReadiness` feeds a badge (2026-09-17, verified live)
- [x] A sample record's lab name, status, results, and related fields can be set/edited from the Sample Detail page (2026-09-17, verified live)
- [x] Reserving a material beyond on-hand stock warns (toast + persistent "Over stock" badge) but does not block the reservation (2026-09-17, verified live — owner decision: warn, don't block)
- [x] An existing credential can be edited in place ("Renew / update") without creating a duplicate row (2026-09-17, verified live)
- [x] A project's stage ladder (Intake/Plan/Mobilize/Field Work/Closeout) advances as its dispatch job(s) move through real status transitions, not stuck on Intake (2026-09-17, verified live end-to-end)
- [x] Worker hours logged via a Front Line Timer task are added to the employee's tracked hours. Fixed by code trace 2026-09-17; **click-tested live 2026-09-23** (sprint Wave 0, against a scratch data copy): Logan signed in to Front Line, acknowledged a dispatched job and submitted 2.5 h on its "Capture travel and truck time" Timer task. `employees.hoursWorked` went from 22 to 24.5, the `jobFormSubmissions` payload recorded `hours: 2.5`, and there were no console errors
- [x] A new project created from a won opportunity defaults its intake "Site" to the opportunity's own selected facility, not an arbitrary first facility on the account (2026-09-17 — fix verified by code trace and by confirming the bug's signature in existing pre-fix data; a fresh end-to-end UI creation through all opportunity stage gates to a brand-new Won record was not completed this session, see item 13's note)

---

## Open decisions

- **Resource planning: job-centric or schedule-board-centric?** (item 4) — still open, not addressed this session
- **Template rebuild scope and timing** relative to Phase 10/11 (item 8) — still open, not addressed this session
- ~~**Over-reservation: block or warn?**~~ (item 9) — ✅ resolved 2026-09-17: warn but allow, implemented

---

## Live bug report follow-up — 2026-09-17 (second session)

The owner reported 8 fresh live bugs after using the app past this phase's original fix pass. All 8
were reproduced against running code before fixing, per this phase doc's own rule. Several shared one
root cause (noted below). All fixes verified live via Playwright against `data/backend.json`'s real
records unless noted.

1. **Alerts had no resolve/dismiss action.** `saveProjectAlert()` only ever created alerts; nothing in
   the app ever wrote `status: "Resolved"`. Added `resolveProjectAlert()`, a "Resolve alert" button on
   `renderAlertCard`, and a "Field alerts" panel on the Project Detail page (previously alerts only
   showed as a bare count, with no way to see or act on them from the project itself). Verified live on
   the "Tall Tree Test stage jump op" project's real open alert.

2. **Project stage advancement:** re-verified the Phase 07 item 11 fix (`advanceProjectStageFromDispatchStatus`)
   is intact and working — no regression found. The actual friction reported this session was item 4
   below (closed projects not leaving the active feed), not stage advancement itself.

3. **Planning-stage projects can already have multiple independent dispatches.** Verified live: the
   Project Detail page's "New job request" button has no stage gate and already supports creating
   additional job requests at any point (confirmed by pushing a second request against the
   "I-130 incident response" project, already mid-dispatch — it created a third, independently
   `Draft`/`Unassigned` dispatch job alongside the existing `Scheduled` and `Closed` ones). Added a
   `renderPendingJobRequestCard` fallback so a not-yet-converted request also shows an explicit "Needs
   scheduling" badge with a direct "Create job" action, rather than only a one-line count, for the path
   where conversion isn't automatic.

4. **CONFIRMED and fixed — closed projects never left the active feed.** Root cause: every "active
   projects" filter across the Operations applet (12+ call sites) checked `job.status !== "Complete"`,
   but `closeProject()` (Phase 09) never sets `status` to `"Complete"` — it only stamps `closedAt`. A
   fully closed project (confirmed live: "Tall Tree Test stage jump op", closed 2026-09-17) passed every
   one of those filters and kept showing in the Multi-Stage Remediation active list. Added
   `isActiveProject(project)` (`!project.closedAt`) and replaced all of those filters with it; added a
   "Show closed projects" / "Hide closed projects" toggle to the Operations "All Projects" view (closed
   projects hidden by default, a banner states how many are hidden) and a "Closed <date>" badge on the
   project card when shown. Verified live: the closed project disappeared from the default view and
   reappeared correctly when the toggle was used.

5. **CONFIRMED and fixed — stale "blocked" exceptions never cleared after the underlying cert was fixed,
   and there was no manual override.** Root cause shared with item 6 (below): conflict/eligibility state
   was computed once and cached, never recomputed. Two-part fix: (a) `conflictsForDispatchJob()` now
   auto-drops an "Expired certification" conflict the moment the linked assignment's *live* eligibility
   is no longer Blocked — verified live against the actual pre-existing seeded conflict
   (`jc-clearwater-cert`, "Asbestos worker renewal expired" on the Clearwater job), which disappeared on
   its own once Samira Holt's cert was confirmed valid, with no manual action; (b) added a manual
   "Acknowledge / Recheck" action (`acknowledgeJobConflict`) on every open exception for cases that don't
   self-clear (non-cert conflict types, or a conflict whose assignment was since removed) — verified live
   on the real "Second sampling technician not assigned" warning on the Riverbend job, which flipped to
   "Resolved" and cleared the job's "Open conflicts" readiness check on click.

6. **CONFIRMED and fixed — worker warning badges were snapshotted at assignment time, not live, and had
   no context.** This was the same root cause as item 5. `jobAssignments.eligibilityStatus`/`eligibilityNote`
   were computed once (from `employee.readinessStatus`) when a worker was assigned or scheduled and then
   frozen on the record — the only way to refresh it was to unassign and reassign, exactly the workaround
   the owner described for Trey Foster on JOB-2026-0726-07. Added `computeAssignmentEligibility(employeeId)`,
   which re-derives Eligible/Warning/Blocked live from the employee's current `employeeCertifications`
   on every render and names the specific certification and its status/expiry date. `renderJobAssignment()`
   and `getJobReadiness()` now both use it instead of the stored fields. **Verified live end-to-end**: on
   the real JOB-2026-0726-07 / Trey Foster case, expired his HAZWOPER credential via "Renew / update" —
   the assignment badge flipped to "Blocked" with the note "HAZWOPER annual refresher is expired
   (expired Aug 15, 2026)" with no touch to the assignment itself; then renewed the credential back to
   "Valid" — the badge cleared back to "Eligible" automatically, with no remove/re-add. This is the exact
   scenario the owner reported as broken.

7. **CONFIRMED and fixed — the Schedule dialog's "Required certification" field was a single free-text
   input, not a lookup.** It had no relationship to any certification actually on file and only accepted
   one value. Replaced with a multi-select (`<select multiple>`) populated from every distinct
   certification name/code found in `employeeCertifications` (plus a small curated fallback list so it's
   never empty), so scheduling can flag several potentially-relevant certifications as a lookup rather
   than forcing one typed value through as a pass/fail gate. `saveScheduleEvent()` now reads the full
   list of selected options into `requiredCertifications` (the field already supported an array; only one
   value was ever being put in it). Verified live: dialog now lists 20+ real certification names as
   multi-selectable options.

8. **CONFIRMED and fixed — equipment/labor/vendor information from intake or planning was invisible on
   the dispatch side.** `jobRequests.equipmentNotes` / `laborNotes` / `vendorNotes` were captured at
   intake and shown on the request card, but `convertJobRequest()` never copied them onto the resulting
   `dispatchJobs` record, and nothing on the Dispatch Job Detail page ever rendered them (or the parent
   project's `opportunityAssignments` Labor/Vendor entries from the sales stage) at all. Added the same
   three fields to `dispatchJobs` (copied at conversion; falls back to the source request's fields for
   jobs created before this session) and a new "Ordered at intake / planning" panel on the Details tab
   showing them plus any linked opportunity's Labor/Vendor assignments. Verified live on the real
   JOB-2026-0726-07 record (predates the field, exercised the fallback path): equipment "bible and f250",
   labor "all yo brothers in christ", vendor "who ever sells those fish john 316 braclets" now render.
   **Not modeled:** equipment specifically ordered/reserved during the sales stage has no dedicated
   schema anywhere yet (`opportunityAssignments.type` only distinguishes Internal/External/Vendor, not
   Equipment) — flagged for a future session rather than fabricated.

## Live bug report follow-up — 2026-09-17 (third session, workforce credentials/teams/crews)

**Home note:** this is a structural workforce request, not a dispatch-operations bug. There is no
dedicated workforce phase doc in `docs/roadmap/`, and the Credentials tab and dispatch-eligibility
logic this touches both live in code that this phase (item 10, above) already owns, so this section
was added here as the closest fit rather than to `docs/database-handoff-map.md` — see that doc's
"Workforce follow-up" note for the full collection/field inventory.

The owner described three structural gaps from live usage of the Workforce applet, verified against
running code (not assumed) before building:

1. **Certification TYPES were free text typed per employee-assignment.** Confirmed by reading the
   `#credentialDialog` form (`index.html`) and `saveEmployeeCredential()` (`app.js`) — `code` and
   `name` were plain `<input>` fields with no catalog behind them, and the seed/live data already
   showed the predicted drift ("HAZWOPER-40" / "haz 40 cred" / "40 hour hazwoper training" / "credential"
   all meaning the same thing). Built a real `certificationTypes` catalog collection (name, category,
   issuing body, renewal interval, active/inactive) with its own create/edit dialog on the Credentials
   tab, and changed the credential-assignment dialog to a required `certTypeId` select — `name`/`code`
   are now derived from the selected type at save time, never typed. All 17 pre-existing
   `employeeCertifications` rows were migrated in place (fuzzy-matched to one of 10 initial catalog
   types by name/code, e.g. "40-hour HAZWOPER" + "40 hour hazwoper training" + "haz 40 cred" all mapped
   to one `certtype-hazwoper-40`) rather than dropped or blanket-reset.
2. **Credentials tab was employee-first, one flat table, one status field.** Rebuilt
   `renderWorkforceCredentials()` as type-first: the catalog table, then a card per cert type showing
   live counts (holds it / in progress / held previously), each linking to a new
   `renderWorkforceCredentialTypeDetail()` drill-down with three real grouped tables. Added a genuine
   lifecycle field, `assignmentStatus` (Not Started → In Progress → Completed → Expired / Held
   Previously), plus `trainingStartedOn`/`trainingCompletedOn` for training BioRemedy itself
   administers — deliberately kept independent of the pre-existing `status` field (Valid/Expiring/
   Pending verification/Expired/Suspended/Revoked), which is the dispatch-eligibility axis read by
   `computeAssignmentEligibility()` and had to keep working unmodified.
3. **Teams vs. crews.** Checked the GLOSSARY.md correction that `crewMemberships` was found frozen at
   4 seed rows and never a live join table — **still true, and still the right design**: `workforceTeams`
   and `crewProfiles` are already two real, distinct backend collections, with membership derived live
   from `employees.teamId`/`employees.crewId` on every render, not from a join table. What was actually
   missing was create/edit UI for the team/crew records themselves — there was no way to add a team or
   crew, only to view seeded ones. Added `openTeamDialog`/`saveWorkforceTeam` and
   `openCrewDialog`/`saveCrewProfile` (new `#teamDialog`/`#crewDialog` in `index.html`). Per the owner's
   definition (Crew = cert-gated field-deployment group; Team = location/department-based, looser),
   crews gained `requiredCertTypeIds`, and `crewCertGapsForEmployee()` flags — warns, does not
   block, per instruction — any crew member missing a required cert: a red-outlined avatar on the crew
   roster card, and a toast at the moment an employee is assigned into a cert-gated crew missing a cert.

**Verified live (Playwright/Chromium, `C:\Users\Braden\.cache\codex-runtimes\...\node`, against the
running server on port 4173, all against real `data/backend.json` data):** cert-type catalog add
("Confined Space Attendant") appeared immediately in the assignment dropdown; drilling into
"HAZWOPER 40-Hour" showed the correct 4 migrated holders with real dates and zero console errors;
assigning a new credential end-to-end (type select, In Progress status, training-started date) saved
and rendered on the employee detail page; adding a new team ("Test Region Team") and a new
cert-gated crew ("Confined Space Test Crew", requiring Confined Space Entry) both appeared on the
Teams & Crews page immediately; assigning Trey Foster (who lacks HAZWOPER 40-Hour and Confined Space
Entry) into the existing cert-gated Emergency Response Alpha crew produced the exact expected toast
("Trey Foster is missing required certification(s) for Emergency Response Alpha: HAZWOPER 40-Hour,
Confined Space Entry.") and the crew card showed red-outlined warning avatars for all 4 affected
members (Logan, Trey, Tristan, John Jacob — none of whom hold Confined Space Entry, which is new and
correctly has zero holders). All test-created records (one cert type, one credential assignment, one
team, one crew) were identified by their generated ids and removed from `data/backend.json` by exact
id after testing — the file's pre-existing real data (including owner-entered records with generated
ids like `emp-msw86anj-p233rs`/"John Jacob" and `cert-msw87lo0-hi7k0a`) was left untouched.

**Not done / open:** no hard block on cert-gated crew assignment (explicitly out of scope per the
owner — warning only). No UI yet to bulk-review "who's missing what" across all crews at once (today
you see gaps per-crew-card or per-employee-save); would be a reasonable follow-up if crews multiply.
No migration of `crewCertGapsForEmployee`'s check into the dispatch-eligibility engine
(`computeAssignmentEligibility`) — a crew cert gap is currently a workforce-page-only signal, not
something that blocks or warns on the Dispatch Board itself.

## Corrections found during implementation

- **2026-09-24 — a job request could get stuck.** The intake card only ever offered "Create job" (when the request was complete) or "Open job" (once converted), so a request in "Needs information" — or one nobody wanted to convert — had no action at all and sat in the open queue for good (the July seed request for the City of Killeen Print Shop was the one the owner hit). Every open request card now carries Edit (same dialog, prefilled, saves in place and keeps the request number), Needs info (with a note shown on the card), Mark ready, Decline, Cancelled and, for an administrator, Delete (soft, restorable); closed ones show Reopen. Filling in the missing service date, onsite contact and address on a "Needs information" request returns it to the queue automatically (Phase 20 Part B, B11). `jobRequests` gained `statusNote`, `statusChangedAt`, `statusChangedBy`.

- **2026-09-23 (owner's bug list):** dispatch job details were read-only after conversion ("if there is an error there is no way to correct it"): `#dispatchJobEditDialog` now edits name, priority, description, address and coordinates, onsite contact, generator/RP, POs, pricing source and the three notes. A closed job no longer offers "New dispatch request" (that belongs to the project). The schedule dialog hides the crew pick when the job already has assignments. Front Line status now follows the work plan (`frontlineAutoAdvanceJob`): any step after Mobilize starts work, all required steps complete the field work. The dispatch assign dialog takes a whole crew as a quick-pick (`assignEmployeeToDispatchJob`).

- **2026-09-17 — item 5 ("Yeady") was a transcription artifact of a real bug, not a literal string anywhere in the app.** The phase doc's own instruction to "trace to source before assuming it's a simple string fix" was correct: grepping the entire repo for `Yeady` (or near variants) turned up nothing. The real bug was `getJobReadiness()` having no terminal-status branch, so closed jobs fell through to a default "Ready" badge — and "Yeady" is best explained as the notes author phonetically mishearing/mis-transcribing "Ready" while dictating (the words are near-homophones), not a garbled version of "Completed." Worth remembering for future notes-derived phase docs: a strange literal string that doesn't exist in code may describe a real status-value bug whose *correct* output the note-taker simply misheard.
- **2026-09-17 — item 9 was added to this session's scope mid-implementation once the owner's decision ("warn, don't block") came back**, after items 1/2/3/5/6/10/11/12/13 were already underway. Implemented and verified in the same session/commit rather than deferred to a follow-up, per the instruction that accompanied the decision.
- **2026-09-17 — items 6/10's "is this UI-only or does the gate/schema also need work" questions both resolved to "UI-only, but the existing mechanism had a real bug the notes didn't call out.**" Item 6 was cleanly UI-only as the doc suspected. Item 10 was *not* purely a missing "renew" button — the underlying `saveEmployeeCredential()` always minting a new `id` meant the only way to attempt a renewal (before this fix) would have silently left the old expired row in place, keeping dispatch blocked even after someone thought they'd fixed it. Worth noting as a pattern: "add a way to edit X" items are worth checking whether the save function underneath actually supports in-place update at all, not just whether an edit entry point exists.
- **2026-09-17 — item 12 and item 13 were verified by code trace plus (for 13) corroborating evidence in existing data, rather than a full fresh live click-through, given the number of steps required to reach a live end-to-end scenario (standing up a Front Line Timer session for item 12; walking a brand-new opportunity through every stage gate to Won for item 13).** Both fixes are small, low-risk, single-call-site changes; flagged here rather than overclaiming "verified live" for the parts that weren't.

---

# 2026-09-22 feedback pass

**Source:** `docs/roadmap/notes-2026-09-22.md` items 35–38. All four verified against code 2026-09-22. **Status:** ✅ Shipped 2026-09-23 — all four items live, verified via Playwright.

**Scope note:** the Operations *applet* rework from the same pass (project tables, filtered metric cards, 30-day calendar, map filters, left-nav treatment, inventory tables) is **not** here — it is large enough to be its own phase. See `phase-17-operations-console.md`. This section covers the Jobs & Dispatch applet only.

### 14. Intake feed never empties

> *"Once a job has been created via the 'Create Job' button. The intake feed should then empty. Intake should be empty if there are no jobs to create."*

**CONFIRMED — a real bug, and a one-line-ish fix.** `renderDispatchIntake()` (`app.js:9698-9722`) computes `open` (everything not Converted / Declined / Cancelled) and uses it for the metric strip — then renders the list from `requests`, the unfiltered set. So converting a request correctly flips its status, correctly decrements "Open intake," and correctly increments "Converted," while the card stays on the board forever.

Fix: render the list from `open`. Two things to get right while in there:

- The empty state (`No job requests.`) currently only appears when the account has never had a request at all. It needs to be the normal end state — reword it to say the queue is clear.
- Converted/declined requests must stay *reachable*, just not in the working queue. The card already links to its converted job; keep that path via a filter toggle or a "recently converted" section rather than making the records invisible.

This is the same class of bug as Phase 07 item 2 (`convertJobRequest()`'s double-submit) — the conversion path is where this applet's real defects live. Worth re-reading that item before starting.

**✅ Done 2026-09-23.** `renderDispatchIntake()` now lists `open` requests by default (empty state reworded to "Queue is clear — no open job requests."), with a "Show converted/closed" toggle (`state.showClosedJobRequests`) that reveals the full history — converted/declined/cancelled requests stay reachable, just out of the working queue, matching the "must stay reachable" requirement. Verified live: the intake screen and toggle render correctly with no console errors.

### 15. Job Register needs filters and search

> *"we need to have 'Job Register' to be filterable by time, status, etc. there should also be a search function to search by cuistomer, or job name, or job id"*

**CONFIRMED.** `renderDispatchJobs()` (`app.js:9815`) renders the full register with no filter or search control.

Do **not** build a bespoke filter bar here. Phase 03 item 6, Phase 05, and Phase 06 item 3 all carry the same "consistent search/filter controls" ask and all three are still open — that is now four surfaces wanting the same component. Build the shared list-filter component once (search box, status filter, date-range filter) and adopt it here as the first consumer. Whoever gets to this first owns the component; the other three items then become adoption work.

Search fields for this register: customer name, job name/number, job id, field lead. Filters: status, date range, job type, crew.

**✅ Done 2026-09-23 — adopted Phase 17's shared component (item 15 called it first, Phase 17's table ended up shipping first and became the "whoever builds it first owns it" case).** Replaced the register's manual `<table>` with `renderDataTable()`, keeping the existing status `<select>` above it. Search covers customer name, job name, job number, job id, and field lead, with sortable columns (job/customer/schedule/field lead/readiness/status). Date-range and crew filters were **not** added — the existing status select already covers the doc's coarser "status, job type" asks reasonably well, and a true date-range/crew filter on top would have pushed this past "small, can slot anywhere." Flagged as a real gap if the owner wants it later.

### 16. Schedule view → "Next 7 Days", 7-day rolling

> *"we want to rename that 'Next 7 Days' and change it from the next 5 day rolling schedule to a 7 day rolling schedule."*

**CONFIRMED.** `getDispatchCalendarDays()` (`app.js:23264-23280`) builds exactly 5 days. The header reads "Dispatch Schedule" (`app.js:9955`).

Change the count to 7 and the header to "Next 7 Days". Two non-obvious details:

- The window does **not** start today — it skips forward to the earliest upcoming scheduled job when there is nothing sooner (`app.js:23271-23275`). That behaviour makes an empty week look populated and quietly contradicts "rolling." Confirm with the owner whether "7 day rolling" means strictly today+6, which is what the words imply; recommendation is yes, drop the skip-ahead.
- `.dispatch-calendar-grid` is laid out for five columns. Seven columns at the same card width will not fit a laptop screen — either wrap to two rows or narrow the cards. Click-test this one, do not assume it reflows.

**✅ Done 2026-09-23, per the locked Q32 decision.** `getDispatchCalendarDays()` now always returns exactly today + 6 — the skip-ahead-to-first-scheduled-job block was deleted outright, not just bypassed. Header relabeled "Next 7 Days". `.dispatch-calendar-grid` widened to `repeat(7, minmax(170px, 1fr))` (narrower min column width than the old 5-column `210px`); the grid already had `overflow-x: auto`, so it scrolls horizontally on a narrow viewport rather than needing a two-row wrap. Verified live: 7 day columns render, no skip-ahead when the current week has no scheduled jobs before today.

### 17. Conflicts: jump to the blocker

> *"we want to make it where there is a button to jump to whatever is blocking the job. Have that panel outlined in red… the idea was to have it disappear if the page was reloaded."*

**CONFIRMED as new work.** `renderDispatchConflicts()` / `renderDispatchConflictCard()` (`app.js:9988-10038`) describe each conflict but offer no navigation to the conflicting record.

Build: a "Go to blocker" button on each conflict card that navigates to the blocking record (the double-booked employee, the held equipment asset, the over-reserved material) and highlights the specific panel with a red outline on arrival. The highlight is **transient UI state, not stored data** — the owner is explicit that it clears on reload. Hold it in `state` (a `state.highlightTarget` the render pass consumes and clears), not in the record and not in the URL hash.

The highlight-a-panel-on-arrival mechanism is the same one Phase 06 item 32 needs for its red dots on failing panels. Same pass or shared helper — do not build two.

**✅ Done 2026-09-23, scoped to the one blocker type the app actually generates.** Built the shared mechanism (`state.highlightPanel`, `isPanelHighlighted(key)` — in-memory only, cleared on ordinary navigation via the `[data-view]` click handler, so it always disappears on reload per the owner's spec) and used it for the employee-credential case: `getJobConflicts()`'s only real writer (`saveDispatchScheduleWork`) ever sets `assignmentId`, never an equipment or material reference, so "the held equipment asset" and "the over-reserved material" blockers the note describes have no backing field to jump to today (confirmed against live seed data — the one "Equipment hold" conflict record carries no equipment reference at all). A "Go to blocker" button now appears only on conflicts with a resolvable `assignmentId`, navigates to that employee's detail page, and outlines the Credentials panel in red. Conflicts without an assignment keep the existing "Open job" link only, rather than a button that goes nowhere useful. Verified live via Playwright: clicked "Go to blocker" on a Crew coverage conflict, landed on the correct employee's page, and confirmed exactly one `.panel-highlight` element (the Credentials panel) rendered. **The shared mechanism is ready for Phase 06 item 32 to reuse** — that item still needs its own missing-field→tab/panel mapping built on top of it.

---

## Decisions locked 2026-09-22 (owner)

- **Dispatch schedule window (Q32): strictly today + 6.** The skip-ahead-to-the-first-scheduled-job behaviour in `getDispatchCalendarDays()` is removed. The owner's reasoning is worth keeping: *"we want to show them nothing is scheduled and keep the day view predictable."* An empty week should look empty.
- **Resource planning (Q33): job-centric.** Resources are planned from the job, not from a schedule board. This closes item 4, open since 2026-09-17.
- **Job template rebuild (Q34): still open** — the owner is not sure, and this doc's original position was to revisit it after Phases 10/11 progressed. Leave it deferred; it is not blocking anything.

### Q34 confirmed 2026-09-22 — job template rebuild stays deferred

*"I agree lets let is chill."* Revisit after the Front Line work settles: the templates define what the field app asks for, and reshaping them before the post-work report and sample logs have settled their requirements means doing it twice.
