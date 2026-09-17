# Phase 07 — Dispatch & Operations Correctness

**Status:** 🟢 **Verification pass + fixes shipped 2026-09-17.** Items 1, 2, 3, 5, 6, 9, 10, 11, 12, 13 confirmed against code and fixed; all verified live via Playwright. Items 4, 7, 8 deliberately deferred (owner decision / cross-phase coordination — see below). Item 9 was added to this session's scope after the owner decided "warn, don't block" while work was already underway.
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

**⏸ Deferred — cross-phase, depends on Phase 10.** This is a Front Line task-type addition (a photo capture task), not a Dispatch/Operations change per se. Left untouched this session; implement in coordination with Phase 10's task-type work as originally scoped.

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
- [ ] Worker hours logged via a Front Line Timer task are added to the employee's tracked hours — fixed by code trace, not click-tested through a live Front Line session this session
- [x] A new project created from a won opportunity defaults its intake "Site" to the opportunity's own selected facility, not an arbitrary first facility on the account (2026-09-17 — fix verified by code trace and by confirming the bug's signature in existing pre-fix data; a fresh end-to-end UI creation through all opportunity stage gates to a brand-new Won record was not completed this session, see item 13's note)

---

## Open decisions

- **Resource planning: job-centric or schedule-board-centric?** (item 4) — still open, not addressed this session
- **Template rebuild scope and timing** relative to Phase 10/11 (item 8) — still open, not addressed this session
- ~~**Over-reservation: block or warn?**~~ (item 9) — ✅ resolved 2026-09-17: warn but allow, implemented

---

## Corrections found during implementation

- **2026-09-17 — item 5 ("Yeady") was a transcription artifact of a real bug, not a literal string anywhere in the app.** The phase doc's own instruction to "trace to source before assuming it's a simple string fix" was correct: grepping the entire repo for `Yeady` (or near variants) turned up nothing. The real bug was `getJobReadiness()` having no terminal-status branch, so closed jobs fell through to a default "Ready" badge — and "Yeady" is best explained as the notes author phonetically mishearing/mis-transcribing "Ready" while dictating (the words are near-homophones), not a garbled version of "Completed." Worth remembering for future notes-derived phase docs: a strange literal string that doesn't exist in code may describe a real status-value bug whose *correct* output the note-taker simply misheard.
- **2026-09-17 — item 9 was added to this session's scope mid-implementation once the owner's decision ("warn, don't block") came back**, after items 1/2/3/5/6/10/11/12/13 were already underway. Implemented and verified in the same session/commit rather than deferred to a follow-up, per the instruction that accompanied the decision.
- **2026-09-17 — items 6/10's "is this UI-only or does the gate/schema also need work" questions both resolved to "UI-only, but the existing mechanism had a real bug the notes didn't call out.**" Item 6 was cleanly UI-only as the doc suspected. Item 10 was *not* purely a missing "renew" button — the underlying `saveEmployeeCredential()` always minting a new `id` meant the only way to attempt a renewal (before this fix) would have silently left the old expired row in place, keeping dispatch blocked even after someone thought they'd fixed it. Worth noting as a pattern: "add a way to edit X" items are worth checking whether the save function underneath actually supports in-place update at all, not just whether an edit entry point exists.
- **2026-09-17 — item 12 and item 13 were verified by code trace plus (for 13) corroborating evidence in existing data, rather than a full fresh live click-through, given the number of steps required to reach a live end-to-end scenario (standing up a Front Line Timer session for item 12; walking a brand-new opportunity through every stage gate to Won for item 13).** Both fixes are small, low-risk, single-call-site changes; flagged here rather than overclaiming "verified live" for the parts that weren't.
