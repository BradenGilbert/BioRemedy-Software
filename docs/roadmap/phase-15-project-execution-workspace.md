# Phase 15 — Project Execution Workspace

**Status:** Shipped 2026-09-23 — sales-scope carryover, Lost→closes-project rule, Intake/Plan/Live tabs, and the four project-creation dialog fixes are live and verified via Playwright.
**Depends on:** Phase 06 (the scope data being handed over lives on the opportunity), Phase 07 (dispatch status is what the Live tab reads), Phase 08 (quote/estimate lines are part of the handover)
**Estimated sessions:** 2–3
**Source:** `docs/roadmap/notes-2026-09-22.md` items 22–24, verified against code 2026-09-22

---

## Why this phase exists

When an opportunity is won, sales has already scoped the work: heavy equipment, vendors, resources, a site walk, site photos, quote lines, and whether the customer's paperwork is on file. **None of it reaches the project.** Operations opens the new project and finds a name, a date, a budget and a site — then re-collects everything else by phone.

This is verifiable, not anecdotal. `saveProjectFromOpportunity()` (`app.js:17090-17137`) builds the project record from six inputs (name, job class, dates, budget, project manager) plus three derived links (account, opportunity, facility) and a contact list. `equipmentNeeds`, `vendorNeeds`, `resourceNeeds`, `siteWalkStatus` (set to a hardcoded `"Incomplete"` regardless of what sales recorded), `sitePhotoRefs` (initialised empty), and the linked quote's lines are all dropped on the floor. The quote total is used — the quote's *contents* are not.

The second half of the phase is the workspace itself. `renderProjectDetail()` (`app.js:7579`) is one long scrolling page with no tabs, mixing intake facts, planning material and live dispatch state in one column. The owner wants three tabs — Intake, Plan, Live — with clear ownership: Intake is what came in, Plan is what we intend to do, Live is what is happening.

---

## In scope

### 1. Carry the sales scope into the project

> *"Operations project currently does not carry over any of the scoped heavy equipment, site walk, labor or resources or vendor notes or line items. Or photos. It also does not detail if third party waste authorizations are not on file."* / *"Projects don't carry over any of the information scoped by sales."*

The handover is the whole point of this item, and the design question is **copy or reference**.

- **Reference** (project reads through `opportunityId`) keeps one source of truth and never goes stale, but the opportunity keeps changing after the win, and a project should not silently change scope because someone edited a closed deal.
- **Copy** gives operations a stable snapshot they own, at the cost of divergence.

**Recommendation: copy at creation, keep the link, and show provenance** — each carried-over item marked "from sales" with a link back, and a visible "the opportunity has changed since this project was created" affordance rather than silent drift. This mirrors how Phase 09's close report is an explicit snapshot with a Regenerate action, which is a pattern this project has already accepted once.

What must carry over:

| From the opportunity | To the project | Note |
|---|---|---|
| `equipmentNeeds` (Heavy Equipment Needed) | Plan tab resource draft | Phase 06 item 33 renames the label |
| `vendorNeeds` | Plan tab, plus the vendor/subcontractor check | Phase 04's approval check applies here |
| `resourceNeeds` | Plan tab resource draft | |
| Site walk record and status | Intake tab | Today overwritten with `"Incomplete"` |
| Site photos | Plan tab | Blocked on Phase 13 for pre-sale photos |
| Sites/facilities on the opportunity | Intake tab | Needs Phase 06 item 30's junction for multi-site |
| Quote / estimate lines | Plan tab as the priced baseline | Total already carries; lines do not |
| Customer paperwork status | Intake tab, as a blocking flag | See item 2 |

### 2. Surface missing customer paperwork on the project

The note singles out third-party waste authorization: the project does not show when it is missing. Once **Phase 13** builds the document requirement/review model, the project reads that state and shows an explicit blocker — not a free-text note, and not a re-ask. Until Phase 13 lands, a simple carried-over flag from the opportunity is better than nothing, but do not build a second paperwork-tracking mechanism here to fill the gap.

### 3. Intake / Plan / Live tabs

> *"For Operation projects we should move to an intake tab, a Plan, and 'Live' tab. The plan tab should detail site specific information, documents and files, draft resource planning, sample schedule options, etc. The project section here is where we will generate all reports, store all deployment info, and notes. The live tab should pull data from the dispatches, and all active or past events and create a 'Live' dashboard."*

- **Intake** — what arrived: account, site, the sales handover, generator/EPA/TCEQ identifiers, insurance and claim details (the existing project intake dialog's fields), paperwork status, and the originating opportunity.
- **Plan** — what we intend: site-specific information, documents and files, draft resource planning (from item 1's carried scope), sample schedule options, notes, and the reports generated for this project (Phase 11's post-work report lands here).
- **Live** — what is happening: dispatch jobs and their status, active and past events, alerts, field capture as it arrives, and usage accumulating toward the close report.

Reuse the tab pattern from Account (9 tabs), Contact (7), Opportunity (5) and Dispatch Job Detail rather than inventing a fourth — including the state key for the selected tab, which every one of those keeps in `state`.

**Do not delete the existing single-page panels until their data has a confirmed home in one of the three tabs.** This project's own working rules require an audit before removing legacy UI, and this page has accumulated panels across several phases.

### 4. Project creation dialog fixes

> *"we should grey out 'Project Stage' so that it doesn't invite people to change it."* / *"Budget on the created project should not require rounding to the thousands place."* / *"When creating a project, we should change 'target date' to be Completion date."*

All three CONFIRMED:

- **Project Stage** — `index.html:913-921` offers a free choice of Intake/Plan/Mobilize/Field Work/Closeout, while `openProjectFromOpportunityDialog()` sets `"Intake"` and Phase 07 item 11 made the stage advance automatically from dispatch status. Letting someone pick a stage at creation now contradicts the ladder that maintains it. Render it disabled, showing "Intake," and keep submitting the value.
- **Budget** — `step="1000"` appears in three places (`index.html:319`, `:910`, `:1839`), so the browser rejects any value that is not a round thousand. **Owner-confirmed 2026-09-22:** entering `4567` is refused today; only `4000` or `5000` are accepted. Remove the constraint on all three inputs so any whole dollar amount is valid; `min="0"` stays. Note that `openProjectFromOpportunityDialog()` now prefills this from the quote/estimate total (Phase 08), and a real quote total is never a round thousand — so today's default value can itself fail validation, which is probably how this surfaced.
  - Use `step="0.01"` or `step="any"` rather than simply deleting the attribute — a `type="number"` input defaults to `step="1"`, which silently rejects cents. Decide whether budgets carry cents at all; whole dollars is defensible, but it should be a choice, not a leftover default.
- **Target date → Completion date** — label change at `index.html:903` and `:1832`. Do **not** rename the `targetDate` field; it is read in several places (`renderRemediationCard()`, the calendar, progress calculations) and the label is the complaint.

---

## Definition of done

- [x] A project created from a won opportunity shows the equipment, vendor and resource scope sales entered — **not** marked as coming from sales, per the locked decision dropping provenance
- [x] The site walk status carries over instead of being reset to "Incomplete". Site *list* (multi-site) still does not — that needs Phase 06 item 30's `opportunityLocations` junction, which doesn't exist yet; a single `facilityId` was already carried (Phase 07 item 13)
- [x] Quote/estimate lines appear as the project's priced baseline (read live from the copied `quoteId`/`estimateId` reference), not just a total
- [x] Missing customer paperwork is visible on the project rather than re-asked at dispatch — reads live from the project's job requests (see correction below), not a carried opportunity field
- [x] Project detail is three tabs — Intake, Plan, Live — with no panel lost in the move
- [x] The Live tab reflects real dispatch state, not a static snapshot
- [x] Project Stage cannot be chosen at creation
- [x] A budget of $127,450.50 can be entered
- [x] The field reads "Completion date"

---

## Open decisions

- **Copy vs. reference for the sales handover** — recommendation above, needs an owner call.
- **What happens when the opportunity changes after the project exists?** Notify, auto-update, or ignore.
- **Does the Live tab replace the operations project card**, or do both stay?

---

## Corrections found during implementation

- **2026-09-23 (owner's bug list):** the Intake dialog opened blank on projects whose generator details were shown from the account/facility fallback; `projectIntakeFallbacks()` now feeds the dialog and the "missing generator" check. The Live tab's "Project team and logistics" panel read `projectAssignments`, which nothing writes; it now reads the dispatch jobs' crews, equipment resources and vendors. A new **Sampling** tab (events per dispatch job, awaiting results, analyte rows, lab documents) and a "next step" line (`projectNextStep`: awaiting lab results / no further work scheduled) were added. The account Projects tab's "Closed projects" panel used stage index 4; it now uses `closedAt`.

- **Item 2's premise was wrong.** The doc's own item 1 table says "Customer paperwork status" carries from the opportunity to the Intake tab as a blocking flag, but the opportunity has **no such field** — `customerPacketStatus` only exists on `jobRequests`, set the first time a job request is raised (after the project already exists). There is nothing to carry at project-creation time. Built instead: `projectPaperworkFlag(job)` reads the project's own job requests live (same `customerPacketStatus`/`documentRole: "customer_packet"` data the job-request dialog's existing "prior packet" logic already reads), which is closer to "do not build a second paperwork-tracking mechanism" than inventing a synthetic opportunity field would have been. Before any job request exists, the flag reads "Unknown," not "Missing" — there's a real difference between "known missing" and "never asked."
- **Site *list* carryover is not built.** The doc flagged this as needing Phase 06 item 30's `opportunityLocations` junction; that junction still doesn't exist, so only the single `facilityId` (already fixed in Phase 07 item 13) carries over. Revisit once Phase 06 ships that junction.
- **Quote/estimate lines are read live off the copied `quoteId`/`estimateId` reference, not copied as a snapshot.** The doc's table says "Quote/estimate lines appear as the project's priced baseline" without specifying copy-vs-reference for the lines specifically (item 1's copy-vs-reference decision was about the opportunity's scope fields). Since `quotes`/`estimates` are independent, persisted records that already survive the opportunity's own lifecycle, copying `quoteId` (not the lines themselves) gets the same "stable baseline, no live drift" property with far less code — if the opportunity's "current" quote changes later, the project keeps reading the one it had at creation.

---

## Decisions locked 2026-09-22 (owner)

- **Copy vs. reference (Q7): copy at creation.** Provenance is explicitly **not** a requirement — *"we might be able to note where the data came from, but realistically we just need the data, where it came from doesn't matter."* So do not build the "from sales" badging and the change-detection affordance this doc originally proposed. Copy the fields, keep `opportunityId` as the link (it already exists), and stop there. Less work than the original plan.
- **Opportunity changes after the project exists (Q8): ignore them.** *"once the project is created it will form and flex to any changes."* No notification, no auto-update, no drift warning.
- **But one linkage is required (Q8, second half):** if the **opportunity is later marked Lost, the project closes**, and closing the project amends the opportunity accordingly. That is a real two-way rule and it is new work — it does not exist today. Note the interaction with Phase 09's `closeProject()`, which currently gates closing on reaching the Closeout stage; a Lost-driven close is a different path and probably should not require that gate.
- **Live tab vs. the operations project card (Q9):** **both stay for now.** Do not remove the card when the tabs ship.
- **Budget precision (Q6):** cents allowed. Use `step="0.01"`, not a bare removal of `step="1000"` (which silently falls back to whole dollars).
