# Phase 11 — Field Ops Depth & Reporting

**Status:** ✅ **Shipped 2026-09-23 (sprint Wave 5).** The 2026-09-22 pass in full: the post-work report generator, the per-day case narrative, both weather snapshots, the post-job review and report photo curation. From the outline: the permit registry, per-job waste tracking into job cost, a stock-movement ledger, fleet maintenance depth, structured lab results, in-app notifications and QuickBooks export payloads. The remaining outline items are deferred, each with its reason, in "Build plan" below.
**Depends on:** nothing outstanding. The old "Depends on Phase 14" note dates from when this phase ran after Postgres; see Corrections.
**Detailed:** 2026-09-23, sprint planning pass (the owner asked to close every open phase before the Postgres/Entra cut-over, so the "wait for the pilot" gate was waived)

---

## Why this is an outline

This is the backlog of everything the architecture documents call out as missing but which is not on the path to a working pilot. Detailing it now would produce a plan shaped by guesses. Pull items out of here into real phases as the pilot creates demand for them.

---

## Carried-forward known-open items

| Item | Source |
|---|---|
| **`jobs.projectStage` is written but never read.** The visual stage ladder and `getMissingProjectStageFields` both key off free-text `status` / `activePhase` heuristics. Creating the field correctly was done in Round 2; wiring the ladder and gate to actually consume it was not. | `docs/dataverse-relationship-architecture.md` |
| **QuickBooks is a mock** export queue (`qboSettings`, `qboExports`) | prototype |
| **Full action dependency graph** unimplemented — prototype assumes sequential ordering | `docs/erp-operational-architecture.md` |
| **Activities vs `sales_tasks` split** — deliberately deferred in Phase 05; revisit with real usage data | `docs/dataverse-relationship-architecture.md` |
| **Lat/long on dispatch jobs** — deliberately not added in Round 3; nothing consumed it. Revisit if the map board and dispatch converge. | Round 3 notes |

---

## Priority 1 gaps (from `docs/database-handoff-map.md`)

1. **Inventory & purchasing ledger** — inventory locations, stock balances, stock movements, lots/batches, reorder rules, receiving, returns. The prototype has JSON inventory and POs; the SQL schema has no ledger. Note that Front Line material tasks *already decrement real stock* via a dedicated endpoint, so a real ledger has a live consumer waiting.
2. **Customer contracts & rate agreements** — MSAs, scopes of work, rate sheets, labor/equipment/material rate lines, change orders. Quotes and generic price lists exist; BioRemedy-specific contracted rates do not.
3. **Fleet & equipment maintenance** — vehicles, meter readings, inspections, PM plans, maintenance work orders, downtime, repair costs. `equipment` is only a basic asset record today.
4. **Accounting completion** — payments, allocations, credit memos, vendor bills, expenses, tax mappings, real QBO sync and reconciliation.

## Priority 2 gaps

5. **Laboratory data normalization** — laboratories, analytical methods, analytes, test requests, custody transfers, result rows, qualifiers, detection limits. Samples exist; results are mostly JSON blobs. **2026-09-16 notes confirm this is felt, not theoretical:** *"for samples collected we need a way to assign a lab and report results."* `sampleRecords.labName`/`labStatus`/`labResults` fields already exist in the seed data — the gap is UI, not schema (verify this before assuming new fields are needed).
6. **Safety & compliance** — JHAs, safety meetings, incidents, observations, permits, SDS records, corrective actions, regulatory deadlines. **2026-09-16 notes add a concrete, company-specific case:** *"we need to track waste post site work completion if waste requires to be tracked per TCEQ and EPA guidelines, we will be using BioRemedy's 10 day storage permit and oily waste handler permit as well as many other permits the company holds. These permits should also be tracked and managed by the crm. We need to make sure we get disposal requests, receipts, and any other expenses needed to track total cost on jobs."* This is real regulatory exposure, not a nice-to-have — scope it as: (a) a permit registry (what permits the company holds, their terms/renewal dates), (b) per-job waste tracking tied to those permits, (c) disposal requests/receipts/expenses feeding job cost (connects to Phase 09's P&L report — coordinate rather than building cost-tracking twice). Front Line's field-capture side of this is tracked in Phase 10; this item owns the permit data model and compliance tracking itself.
7. **Approvals & notifications** — approval requests, ordered steps, notifications, delivery attempts, subscriptions, escalations, read state. **Note:** the scope-exception alert flow in `docs/crm-foundation.md` depends on this — today alerts are recorded but notify nobody. Phase 04's W-9/COI review workflow (items 8–9) also needs a notification step and may be a good forcing function to build a minimal version of this sooner rather than later.
8. **Project commercial controls** — budgets, committed costs, forecasts, change orders, not-to-exceed revisions tied to approvals.
9. **Job dispatch template redesign** — *"we might want to adjust how we build out job dispatch templates, what all information they request from the frontline worker and then how that information is presented in the project report and sample report logs."* Cross-references Phase 07 item 8 and Phase 10's "+activity" flexible-capture item — this is a design question spanning three phases; don't scope it in only one.

## Also raised but never scoped

- **Daily field logs** — weather, crew attendance, delays, photos
- **Reporting dashboards** — pipeline, crew utilization, equipment utilization, material cost, gross margin, revenue by customer/service line, aging opportunities
- **Global search** across entities
- **"Activity progress report"** — raised in the original cleanup roadmap, deliberately skipped as undefined. Still needs a conversation before it can be built.

---

## Explicitly out of scope, permanently

Per both architecture documents: payroll, compensation, benefits, SSNs, detailed medical records, and payment-card data stay in restricted external systems unless a deliberately security-bounded module is created for them.

---

# 2026-09-22 feedback pass

**Source:** `docs/roadmap/notes-2026-09-22.md` item 44. **Status:** Not started.

### Post-work report generator

> *"On the project page for a project we need a button that will pull all the relevant project data and create a post work report similar to the one made by Lonestar hazmat that I have lined in this chat."*

The reference is `docs/uploaded files/lonestar hazmat report2026-0809-01 WAC CP.pdf` — a competitor's completed-work report for the same incident as the invoice in Phase 09's note. It is 12 pages: one summary header, per-day narrative, a photo page, per-day and summary billables, a safety/JSA section, a post-job review, and crew e-signatures. **The owner has named the three parts that matter most: the timeline, the signatures, and the case narrative.**

**Its full structure, transcribed 2026-09-22.** (The text does not extract with ordinary tooling — the fonts are subset-encoded with array-form `bfrange` ToUnicode maps — so this transcription exists to save the next session that work. The photo pages are still worth opening visually.)

Title on every page: `RESPONSE SUMMARY` + the incident number (`#2026-0809-01`), with the remit-to address on page 1 and a copyright line in the footer.

| Section | Contents | Where BioRemedy's data would come from |
|---|---|---|
| **Header block** | Broker; Incident Date/Time; Responding District; Weather (`Clear Sky, Temp: 79.66°F, Wind: NE @ 4mph`); Incident Status (`Under Review`); Incident Needs (`Ready for Invoicing, RP Billing Info Needed`); Responsible Party + address; Reported by; Project Manager; Sales Representative; Reported Location as **both** `GPS: 30.4531118, -97.6655011` **and** a street address; Responsible Party Contact; Government Agency; Reported Incident Description | Project/account/facility, the GPS `locations` row, project manager and owner. **Weather at time of incident is not captured anywhere today** — a real gap, and a nice one to fill at intake. Government Agency and the incident narrative are exactly what Phase 16's intake form collects |
| **Per-day narrative** | `Incident Response Day 1: Sunday, August 09, 2026` → `SCENE DETAILS AS REPORTED BY RESPONSE MANAGER`, split into **Scene Description** (what was found) and **Scene Activities** (what was done, in detail — PPE level, equipment used, drum counts, who took possession of the waste) | **This is the case narrative, and nothing in the app captures it.** See the narrative gap below |
| **Photo page** | Site photos, full page | Front Line photo capture |
| **Billables for each day** | Three tables — Manpower (role, Reg Hrs, OT Hrs, H Hrs), Equipment (item + rate basis, quantity), Material (item, quantity) | Front Line timer hours, `equipmentLogs`, `materialUsage`. The Reg/OT/Holiday split is Phase 08's rate tiers; the per-day grouping is the same day-stamping question Phase 09 raises |
| **Billables summary** | The same three tables aggregated across all days | Same sources, rolled up |
| **Safety / JSA** | `Initial Dispatch - Safety Information / JSA Acknowledgements`: selected types, required PPE, emergency contact number, muster point, then a three-column JSA table (Major Job Steps / Potential Hazards & Consequences / Actions Taken to Eliminate Hazard), then five yes-no safety reminders (orientation, hazard understanding, permits, task training, evacuation plan) | Front Line Forms/checklist capture (Phase 10). Check what the existing form tiles already cover before building new ones |
| **Post job review** | Three yes-no questions: accidents, near misses, injuries | New — small, and clearly worth capturing at job close |
| **E-signatures** | `Signed By Quentin Brown on Sun Aug 09, 2026 - 03:07 am`, one per crew member, four in this report | Front Line signature capture already produces exactly this |

The shape to copy: **a timeline of days, each with a narrative and its own billables, then one summary, then the safety and signature record.** That is the document. Everything else is header.

What the app can already feed it, verified present today: project and account identity, site/facility and its address, GPS locations, the dispatch jobs under the project with their scheduled and actual times, work-plan steps and per-task capture from Front Line (photos, signatures, timer entries, materials, checklists, samples), sample records with lab assignment and results (Phase 07/10), material and equipment usage, project alerts, and the close-out cost report (Phase 09). Most of the billables and all of the signatures are already there — the gaps are narrative, weather, and the post-job review.

Known gaps to settle when scoping it:

- **The case narrative is the missing piece.** Lone Star's Scene Description / Scene Activities prose is written by the response manager, per day, and it is what makes the document worth reading. Nothing in the app captures it. **Build it as a per-day field on the dispatch job, filled by the field lead at close-out**, not as one project-level box — a multi-day job needs a narrative per day or the timeline collapses. A draft generated from work-plan steps and material/equipment usage is a reasonable starting point, but it must be editable prose, not a generated list pretending to be a narrative.
- **Photo selection.** Field capture produces many photos; a report needs a curated subset with captions. That is a real screen, not a checkbox.
- **Waste manifests and disposal records** are still Phase 11's own open scope (permit registry, per-job waste tracking) and are almost certainly part of a real report. Sequence the report after them, or ship it with that section omitted and say so on the document.
- **Output format.** Print view like the quote/invoice export, or a stored PDF artifact? A stored artifact needs Phase 13.

Build the generator against the same print/export machinery Phase 08 shipped for quotes and Phase 09 will use for invoices — three bespoke print layouts is two too many.

### Weather capture — two snapshots, pulled not typed

> *"weather should be pulled by operations or sales. we should have weather be relevant to when it happened and when clean up commenced. so two different weather reports."* (owner, 2026-09-22)

Lone Star's report header carries one weather line (`Clear Sky, Temp: 79.66°F, Wind: NE @ 4mph`). BioRemedy wants **two**, because they answer different questions:

| Snapshot | Taken at | Why it matters |
|---|---|---|
| **Incident weather** | The reported incident date/time | Conditions when the spill happened — rain moves product into drains, wind drives vapour, temperature affects volatility. This is the regulatory/causation record |
| **Response weather** | When cleanup actually commenced (crew on site and working, not dispatch time) | Conditions the crew worked in — justifies method choices, delays, extra equipment, and re-work |

Design points:

- **Pulled automatically, not typed.** The owner's "pulled by operations or sales" is read as *the system fetches it, whoever happens to own the record* — a person hand-entering weather at 2am will either skip it or get it wrong, and a typed value has no provenance. Confirm that reading before building; the alternative (a person looks it up and pastes it) is a much smaller build but a much weaker record.
- **Snapshot, never recomputed.** Store the observation with the time and coordinates it was fetched for, the source, and the fetch time. Weather history changes as stations report; a report regenerated a month later must show what was true then. Same principle as Phase 09's close-report snapshot.
- **Where the two timestamps come from.** Incident time already exists on the emergency intake (Phase 16) and on any project with a reported incident date. **Cleanup commencement does not exist as a distinct field today** — dispatch job status transitions are the closest thing, and "arrived on site" is not the same as "work started." Decide which transition counts and make it explicit, because the whole second snapshot hangs off it.
- **Coordinates come from the GPS location** (Phase 02's `locations`), which is the accurate anchor — a facility's mailing address can be miles from where the crew is standing, which is exactly the case in the Lone Star incident (a highway frontage road).
- **Provider** is an outside API and therefore a dependency this project does not otherwise have. Keep the fetch behind one small adapter so the provider can change, and make a failed fetch a visible "not captured" rather than a blank that reads as "clear."

**Applies to scheduled and multi-stage work too, not just emergencies** — this belongs to any project with a site and a start, which is why it is specified here rather than inside Phase 16.

---

## Decisions locked 2026-09-22 (owner)

- **Weather (Q39): pulled automatically.** No hand-entry path.
- **"Cleanup commenced" (Q40): when field work began.** Concretely, that is the dispatch job transitioning to in-progress work — **not** crew dispatch, and not arrival on site. Whichever status transition represents "work started" is the one that stamps the second weather snapshot; if no transition cleanly means that today, add one rather than approximating with arrival.
- **Report output (Q41): generated on demand from stored values when the button is pressed** — a print view, not a stored PDF artifact. Consistent with Phase 08's quote export. Note the consequence: a report re-run later reflects the data as it stands then, **except** for the weather snapshots and any other explicitly stored snapshot, which are frozen by design.

---

## Build plan (2026-09-23 planning pass)

The outline became this plan after tracing the code. Several items were already partly built (see Corrections), which changed the scope from "build" to "deepen".

| Item | Decision | Shape |
|---|---|---|
| Post-work report generator | **Build** | A print view built on demand (Q41) from the project's records. `buildPostWorkReport()` gathers data and `renderPostWorkReportHtml()` lays it out, so Phase 13 or the Client Portal can reuse the data half. Printed through the shared shell quotes and estimates use. Sections follow Lone Star's structure. |
| Case narrative | **Build** | `dispatchJobs.dailyNarratives[]`, one entry per work day, with Scene description and Scene activities. Written on the dispatch job's new Close-out tab or on Front Line. "Draft activities from field data" fills a starting point from status events, submissions and consumption; the lead then rewrites it as prose. |
| Weather snapshots | **Build** | New `weatherSnapshots` collection, written only by `POST /api/weather-snapshots/capture`, with the provider behind one adapter (Open-Meteo; `CRM_WEATHER_PROVIDER=off` forces the failure path). The incident snapshot is taken on emergency-intake save; the response snapshot at Start work (Q40). Anchored to the project's GPS `locations` row, then the job's coordinates, then the intake pin. A failure is stored and shown as "Not captured" with its reason and a Try again button. |
| Post-job review | **Build** | `dispatchJobs.postJobReview`: accidents, near misses and injuries (Yes/No), with details required on any Yes. Closing the job requires it. A Yes notifies operations. |
| Photo curation | **Build** | New project Report tab: a readiness checklist, then every field photo on the project's dispatch jobs with an include box and a report caption (`jobTaskAttachments.includeInReport` / `reportCaption`). |
| Permit registry | **Build** | New `permits` collection on Office → Compliance, seeded with the two permits the owner named (numbers and dates left blank for the owner, and flagged). |
| Per-job waste tracking | **Build** | New `wasteRecords` collection on the project's Live tab. A permit's `storageLimitDays` turns accumulation into a ship-by deadline, flagged within 2 days and when passed. `disposalCost` feeds a new `waste` bucket in the cost report (Phase 09's deferred fourth bucket). |
| Inventory ledger (P1 #1) | **Build the ledger; defer locations/lots/reorder** | New `inventoryMovements`, written server-side inside the same save as every `onHand` change (PO receive, Front Line consume, manual adjustment). |
| Fleet maintenance (P1 #3) | **Deepen the existing records** | PM interval (days and meter), meter readings, downtime, vendor and work order number; next due computed automatically; meter-overdue raises the red dot. |
| Lab normalization (P2 #5) | **Build result rows** | New `sampleResults` with server-computed `resultNumeric` / `exceedsActionLevel`. Exceedances drive the sample's tone and red dots. A laboratories/methods master table is deferred. |
| Approvals & notifications (P2 #7) | **Build notifications; move approval chains to Phase 12** | New `notifications` collection and a topbar bell. Raised by field alerts (which previously recorded `notified` without telling anyone), post-job safety events, weather failures, and swept deadlines (permit renewal/expiry, waste storage limits). Ordered approval steps need named approvers, which is Phase 12's identity work. |
| QuickBooks (carried item) | **Real payloads; transport at cut-over** | The export builds the QBO v3 Invoice JSON, validates it, and stores the payload on the queue row. Intuit OAuth waits for cut-over. |
| Customer contracts / rate agreements (P1 #2) | **Covered, rest deferred** | Rate sheets, per-account service agreements and the subcontractor pricing basis shipped in Phases 04/08. MSAs and change-order documents need Phase 13's document store. |
| Accounting completion (P1 #4) | **Deferred to cut-over** | Payments, credit memos and vendor bills are QuickBooks' job once it's connected. |
| Project commercial controls (P2 #8) | **Deferred** | Budgets vs committed vs forecast needs an owner definition of "committed". Not raised in any note. |
| Template redesign (P2 #9) | **Deferred by the owner** | Q34. |
| Daily field logs | **Covered** | The per-day narrative, weather, curated photos and timer hours together are the daily log. |
| Dashboards, global search, "activity progress report" | **Deferred** | Reporting belongs on Postgres (Phase 14). The progress report still needs a definition. |
| Action dependency graph, activities vs sales tasks | **Deferred** | Unchanged from the outline. |

## What's built (2026-09-23, sprint Wave 5)

- **Weather.** `fetchWeatherObservation()` in `server.mjs` picks the observation nearest the requested hour, using Open-Meteo's forecast endpoint for the last ~80 days and its archive for older dates. It returns conditions (WMO code mapped to words), °F, humidity, precipitation, wind speed, gusts and compass direction. The capture route runs outside the API queue so a slow provider never blocks other requests, re-checks for a race before writing, and never re-fetches a captured snapshot. The project Intake tab has a "Weather at the scene" panel (incident + one slot per dispatch job); the dispatch Close-out tab shows its own. Verified against Open-Meteo live (incident: clear sky 81.2°F, SSW 5 mph; start of work: mainly clear 93.5°F, E 14 mph) and the stored-failure path.
- **Close-out tab** on dispatch job detail: the operational day (correctable), one narrative form per work day, the post-job review, and start-of-work weather. It carries its own red dot while close-out is owed (Field complete / Office review) and a day lacks a narrative, the review is unanswered, or weather failed. Front Line shows the same forms under the work plan while the job is on site, in progress or field complete.
- **Report tab** on the project, plus a "Post-work report" button in the project header. The report prints the header block (both weather snapshots with provenance, responsible party, contact, caller, PM, sales rep, GPS + street location, agencies, incident description), then a day-by-day timeline with each day's narrative and billables (manpower from timer hours, equipment, material), selected photos, a billables summary, samples and structured results, waste and disposal, safety/JSA checklists, the post-job review per job, and e-signatures with images. Every gap prints as a red "not recorded" line.
- **Permits** on Office → Compliance with a red dot for missing number/expiry, inside renewal lead time, or expired. **Waste** on the project Live tab, with the Live tab and project-list dots for storage deadlines; status changes stamp their dates.
- **Notifications:** the topbar bell shows the unread count, and the dialog offers Open (navigates), Mark read and Mark all read.
- **Worker-built, merged and re-verified in the combined tree:** the stock ledger (Stock movements panel on a consumable), fleet PM plans (asset dialog, maintenance totals, meter-based dots), Analytical results on the sample page, and QBO payloads with validation issues, View payload and Download JSON.
- Verified with Playwright on a scratch copy: all 38 workspace views, every project on all four tabs, and every dispatch job's Close-out tab, with zero console errors. No horizontal overflow at 390 px.

## Corrections found during implementation

- **The "Depends on Phase 14" line was stale**, as its own text suspected. Nothing in this phase needed Postgres.
- **"`jobs.projectStage` is written but never read" (carried item) was already fixed** by Phase 07 item 11 (`advanceProjectStageFromDispatchStatus()`). Struck.
- **"Lat/long on dispatch jobs — deliberately not added" is out of date:** `dispatchJobs` has `latitude`/`longitude`. The weather anchor uses them as its second choice after the project's GPS point.
- **Fleet maintenance and lab reports were not greenfield.** `equipmentMaintenanceRecords` (type/date/cost/next due, updating `equipmentAssets.maintenanceDue`) and `sampleLabReports` (uploaded report files) already existed. Wave 5 deepened them rather than adding parallel tables. The outline's claim that lab results were "mostly JSON blobs" was also wrong: they were one free-text field, `labResults`.
- **"Cleanup commenced" needed no new status.** `on_site → in_progress` ("Start work") already meant work started, so Q40 hangs off that transition.
- **Day grouping follows Phase 09's Q5, which the outline didn't mention.** The per-day billables are the same day-stamping question Phase 09 answered: a record belongs to its dispatch job's *operational day*, not the calendar date it was logged. `dispatchJobs.operationalDate` is stamped at Start work and never recomputed; older jobs derive it from their first start-work/on-site event, then the schedule. To keep the Phase 11 note that a multi-day job needs a narrative per day, the field lead can add extra work days. A record keeps its own calendar day only when that day was added; otherwise, like a 1am entry, it rolls to the operational day. If the pilot shows multi-day jobs are common, revisit Q5 with the owner. The alternative is one dispatch job per day.
- **Two seed dispatch jobs point at projects that don't exist** (`dispatch-job-georgetown` → `project-georgetown-er`, `dispatch-job-msw82clh-jflvmm` → `job-msw7bs9r-pw20zg`). Their weather capture is skipped instead of 404ing, and their "Back to project" button leads nowhere. This is a data clean-up for Wave 8's pre-cutover mapping, not a code fix.
- **2026-09-23 (owner): the post-job review was visible on every job, including drafts.** Both the office Close-out tab and the Front Line close-out rendered the form regardless of status, although the design says it is "answered at job close." Fixed: `postJobReviewAvailable()` gates it to Field complete / Office review / Closed. Before that the office panel shows "Appears once the job is marked Field complete", Front Line shows only the day narratives, and `saveDispatchPostJobReview()` refuses a save on an unfinished job. Verified via Playwright on a scratch copy: draft, scheduled and on-site jobs show no form on either surface; field-complete and closed jobs do; no console errors.
- **Worker worktrees started from a stale commit.** Three of the four Sonnet workers branched from `19c30f5` (before Waves 1–4) and had to rebase onto `f970be2` before merging. One worker's cleanup also stopped the live server, which was restarted. Future waves should tell workers to rebase first and to stop only processes they started.
