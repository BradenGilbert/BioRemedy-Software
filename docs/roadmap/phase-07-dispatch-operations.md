# Phase 07 — Dispatch & Operations Correctness

**Status:** Not started
**Depends on:** Phase 01 (shared data layer — dispatch and projects are already server-side, this phase fixes behavior, not data location)
**Estimated sessions:** 3
**Source:** `bioremedy crm notes 9.16.2026.docx`

---

## Why this phase exists

The Account/Contact/Opportunity domains got a code-verified audit (Phases 03, 05, 06) before this phase doc was written. **These items did not get that same verification pass** — they're transcribed from the notes as reported, not yet confirmed against `app.js`/`server.mjs`. Treat every item here as "reproduce first, then fix," not "known-confirmed, just implement." The first work in this phase should be a verification pass exactly like the one Phase 06 got, updating each item below with CONFIRMED / PARTIALLY CONFIRMED / NOT FOUND before real implementation starts.

This phase groups everything from the notes that's about **dispatch, jobs, scheduling, materials, and workforce hours** — the operational side, as distinct from the sales-side correctness work in Phases 03/05/06.

---

## In scope

### 1. Worker assignment display broken on the dispatch board

> *"On job and dispatch board assignment of workers the worker assignment display is broken and crunched to the left."*

Sounds like a CSS layout bug (similar in kind to Phase 06 item 14's checkbox bug). Reproduce on the Dispatch Board view, find the assignment-display component, and check for a missing/misapplied class the same way Phase 06 item 14 was diagnosed.

### 2. Creating a dispatch request from a job creates two jobs

> *"On job and dispatch somehow when creating a dispatch request from a job it created two a draft and then the main one. They are labled JOB-2026-0916-35 and JOB-2026-0916-36"*

> *"when pushing jobs to dispatch is creates duplicates."*

These two notes almost certainly describe the same underlying bug — a double-write somewhere in the job-request-to-dispatch-job creation path (possibly a draft record that's supposed to be discarded or promoted in place, but instead a second record gets created alongside it). Find the function that creates a `dispatchJobs` record from a job/job-request and check for a double-submit, a draft-then-finalize pattern that doesn't clean up the draft, or a duplicate event handler firing the create twice.

### 3. Need a "back to project" button from a dispatch job

> *"On Dispatch and jobs we need to always have a button to take us back to the Project the job is for."*

Concrete, additive. `dispatchJobs.projectId` already exists and resolves correctly (confirmed during Phase 01/02 testing) — this is purely a missing navigation button on the Dispatch Job Detail page.

### 4. Resource planning/scheduling is confusing from inside a job

> *"for job and dispatch of jobs we need to work on the planning and scheduling of resources and such. Maybe its for the schedule board, but doing it all from inside the job is confusing."*

Product/UX question, not a discrete bug — needs a decision on whether resource assignment belongs primarily on the Schedule Board with the job as a read-only reference, or vice versa. Do not implement a fix until that decision is made; this is the kind of item that risks getting "fixed" into the wrong shape twice.

### 5. Calendar shows "Yeady" instead of "Completed"

> *"on the schedule within jobs and dispatch is shows completed work on the calendar as 'Yeady' instead of 'completed'."*

Almost certainly a literal string typo somewhere (a status label constant or a truncated/garbled label). Grep for `"Yeady"` or similar near-matches (could be a typo of "Ready" colliding with a completed-state label, not just "Completed" misspelled) — trace to source before assuming it's a simple string fix, since "Yeady" doesn't obviously derive from "Completed" by typo alone and might indicate a status-value mismatch rather than a spelling error.

### 6. Samples need lab assignment and results reporting

> *"for samples collected we need a way to assign a lab and report results."*

`sampleRecords` already has `labName`/`labStatus`/`labResults` fields per the seed data (confirmed present in `data/backend.json`), so this is likely a missing **UI** for setting them, not a missing data model. Verify field coverage before assuming new schema is needed.

### 7. Sample fields that should be photo uploads

> *"on samples it mentions north view, sample interval, and container label. These are photos that should be uploaded during sampling. Can we get that added to the front line work load."*

Cross-references Phase 13 (Front Line) — this is a Front Line task-type addition (a photo capture task), not a Dispatch/Operations change per se. Track here because it was raised alongside other sample-workflow items, but implement in coordination with Phase 13's task-type work.

### 8. Job dispatch templates may need a rebuild

> *"to be honest we might want to adjust how we build out job dispatch templates, what all information they request from the frontline worker and then how that information is presented in the project report and sample report logs."*

A broader "is the template model right" question spanning Dispatch (this phase), Front Line (Phase 13), and reporting (Phase 14). Do not treat this as a checklist item — it's a flag that the template design itself may need revisiting once enough of items 6/7/13 (Phase 13) are scoped. Revisit after those are further along, not before.

### 9. Materials can be over-reserved beyond stock

> *"materials listed in a job assignment section under materials are noted as reserved, but it is possible to reserve more than you have in stock."*

A real validation gap — reserving a material against a job should check against on-hand inventory (`inventoryItems.onHand`) and either block or warn. Decide which (block vs. warn-and-allow) before implementing; environmental field work sometimes has legitimate reasons to over-commit against expected restock, so a hard block may be wrong. See Phase 14's Priority 1 item on the inventory ledger — that real ledger is the eventual right foundation for this check; decide whether to build a lighter interim check now or wait.

### 10. Expired credentials/certifications have no update/clear path

> *"Credentials and certifications can expire but there is no way to update or clear those blocks."*

`employeeCertifications` exists and presumably has expiry dates already gating something (scheduling/dispatch assignment, per the certification-gating check referenced in `docs/database-handoff-map.md`). This item is about the **UI to renew or clear** an expired certification — verify whether the gate itself works correctly (blocks assignment when expired) before assuming the only gap is the update path; both might be missing.

### 11. Project status never advances to Mobilize/Field Work

> *"Project status never moves to mobilize or field work when it is clearly scheduled and completed."*

This directly matches an already-known-open item from the roadmap: **`projects.projectStage` is written at creation but never read** (`docs/roadmap/README.md`'s "Known-open items," slotted to Phase 14 before this notes pass). This note may be describing the exact same root cause. **Do not treat this as a new bug — cross-check against that known item first** and consolidate into one fix rather than debugging it twice from scratch.

### 12. Worker hours not tracked when scheduled

> *"Hours for workers in labor section not being tracked if you schedule them."*

Verify whether this is a missing write (scheduling doesn't create the expected labor/hours record at all) or a missing read (hours are recorded somewhere but not surfaced in the labor section's display) before assuming which side needs the fix.

### 13. Operations "intake" site should default from the sales-side facility/location

> *"On operations the generator and responsible party panel known as 'intake' we want 'site' to be the facility or location we selected during the sales process. Generator contact"*

The intake panel's "site" field should default to (or directly reference) whatever facility was already selected on the opportunity (Phase 02's `facilityId`, Phase 06 item 1's related field), instead of being asked for again independently at intake. The note trails off after "Generator contact" — confirm during implementation whether a related generator-contact linkage was also intended here, or whether that's a separate incomplete thought.

---

## Out of scope

- The inventory ledger itself (lots, reorder rules, receiving) — Phase 14 Priority 1 item; item 9 here is a narrower interim check, not the full ledger
- Billing/invoicing on project close — Phase 09
- Front Line task-type work (photo capture, multi-sample) — Phase 13

---

## Data model changes

Not yet known — this phase starts with reproduction/verification, not a pre-planned schema. Update this section once each item is confirmed and its real fix is scoped.

---

## Verification / done criteria

*(To be filled in once each item above is confirmed against code — do not write done-criteria for unverified bug reports.)*

---

## Open decisions

- **Resource planning: job-centric or schedule-board-centric?** (item 4)
- **Over-reservation: block or warn?** (item 9)
- **Template rebuild scope and timing** relative to Phase 13/14 (item 8)

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan — including the verification pass this phase should start with.)*
