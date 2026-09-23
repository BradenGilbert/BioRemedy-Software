# What's Left — compiled 2026-09-22

A single view of everything still to do, across all 20 phases. **This is a snapshot, not a source of truth** — the phase docs are. Regenerate or correct this when a phase ships rather than editing it in isolation, and if this file and a phase doc disagree, the phase doc wins.

Shipped work is deliberately not repeated here; `README.md` has the "already shipped" list.

---

## The shape of it

| | Count |
|---|---|
| Phases shipped | 10 (00, 01, 02, 08, 09, 10, 15, 16, 17, 18) — though 08 and 10 both gained a second round on 2026-09-22 (08's rate-card rework still outstanding), and 18's item 4 waits for Phase 12 |
| Phases substantially done, with named leftovers | 5 (03, 04, 05, 06, 07) |
| Phases not started | 4 (12, 13, 14, 19). Phase 11 shipped 2026-09-23 (Wave 5) |
| Open items with a checkbox against them | ~80 |
| Blocked on an owner decision, not on engineering | 14 |

Three things dominate what is left, and they are worth naming because they are not "finish the feature list":

1. **Handover.** Sales scopes work that operations never sees; the office collects paperwork that dispatch re-asks for. Phases 15 and 13 are both fixes for information not travelling.
2. **Volume.** Card-per-record screens, unfiltered metrics and 5–7 day windows were built for demo data. Phase 17 is the correction.
3. **Truth about money.** The rate card does not model how BioRemedy actually prices work (four tiers, minimums, surcharges, cost-plus). Until Phase 08's second round lands, quotes, invoices and cost reports are all approximations.

---

## Decisions — 44 of 52 answered 2026-09-22

The owner answered the full decision list on 2026-09-22. Each answer is recorded in its own phase doc under **"Decisions locked 2026-09-22 (owner)"** — that is the authoritative place, not this summary.

**Answers that changed the plan rather than confirming it, and are therefore worth reading before implementing:**

| Phase | What changed |
|---|---|
| 15 | **Provenance is not wanted.** Copy the sales scope, keep `opportunityId`, drop the "from sales" badging and change-detection this doc originally proposed — *less* work than planned |
| 15 | **New rule:** an opportunity going Lost closes the project, and closing amends the opportunity. Does not exist today |
| 04 | **Customer approvals do not expire.** Reconciled 2026-09-23: the expiry alert is now vendor-insurance-only (the unused `approvedUntil` field is still in the dialog) |
| 16 | **An account is required before dispatch**, though it can be created in the field. Reverses this doc's "dispatch first, tidy up later" framing |
| 16 | **Pin drop is just GPS coordinates**, not a link-issuing system. Removes the shared machinery with Phase 18 |
| 13 | **The Client Portal ships in the pilot.** Internal-only visibility becomes load-bearing on day one, and external identity joins Phase 12's scope |
| 14 | **Dataverse is no longer a target.** Its alignment rules stop being constraints; `dataverse-relationship-architecture.md` needs a note saying so |
| 06 | **Comma splitting takes the simple rule** — commas in notes will break, and that is accepted |
| 06 | **Stage gates per opportunity type: deferred**, not built now |
| 03 | **"Remove the Account Table" is dropped** as an incomplete note — one of the two items holding Phase 03 open is gone |
| 12 | **No Entra tenant exists yet.** Now the longest-lead external dependency in the roadmap |

**All 52 answered as of 2026-09-22**, after a second round covering the ones that needed explaining first. Only **Q54 (account lifecycle status)** is deliberately back-burnered — it needs the actual field values laid side by side before it can be answered, and it blocks nothing.

Two answers from that second round changed earlier entries and are already corrected at source:

- **Rate tiers are THREE, not four** — Standard, "OT & Emergency" (one combined rate), Double Time. The rate sheet backs this: Section I has exactly two rate columns. Emergency still needs to be *distinguishable* though, because the four-hour minimum applies to emergency call-outs specifically, not to overtime generally.
- **Postgres cut-over is big bang at the alpha, not domain-by-domain** — a deliberate reversal of this roadmap's recommendation, so that iteration on the JSON backend stays unconstrained until one planned switchover. That makes a migration rehearsal and a tested path back to the JSON backend requirements of Phase 14, not optional extras.

---

## Stage B — Make the CRM Correct (the bulk of the work)

### Phase 03 — Account Domain · ✅ complete 2026-09-23
*2026-09-23 (Wave 2): industries added (plus DOT under Government, and a NAICS code per industry), `accountIndustries` confirmed authoritative, opportunity industry is now a curated picker, and facility-level environmental risk (Q55) built. "Remove the Account Table" was dropped (Q30).*
- ~~List-filter cleanup (item 6)~~: quick-filter chips shipped 2026-09-23 (Wave 3) on Accounts, Contacts and Opportunities.

### Phase 04 — Vendor & Subcontractor · *3 items, all blocked on Phase 13*
*2026-09-23: Compliance list (4), rate sheets (7), dispatch-time approval check + vendor links on jobs (5) and the subcontractor pricing basis (14) all shipped.*
- W-9/COI upload → review workflow; agreement templates by type (items 8, 9, 12; blocked on Phase 13)

### Phase 05 — Contacts & Timeline · ✅ complete 2026-09-23
Phone formatter (Wave 2); shared record lookup, timeline "Related" filter and Connected-via links (Wave 3).

### Phase 06 — Opportunity Domain · ✅ substantially complete 2026-09-23 (two sessions)
**Shipped:** account-context hint relabel + "Use this text"; stage badges no longer look like buttons; `proposedSolution`/`customerNeed`/`description` write-through fallbacks removed, 12 contaminated `proposedSolution` records blanked; needs lists renamed + comma splitting + combined dialog; industry inherits for display only; close forecast replaced with relative bands (`closeBand`/`closeBandSetAt`, all existing data migrated, reverses the earlier `closeQuarter` decision); new `opportunityLocations` junction + Sites & Locations / Associated Locations panels with inline facility creation; red-dot tab/panel validation highlighting + tab contrast; site-walk quick-schedule; `customerNeed` moved to Lead & Qualification. List search (item 3) was already working.
**Sprint (2026-09-23):** Proposed Solution scope summary (Wave 1), Connected-via panel finished and the "Regarding" cross-entity field with a new Facility timeline (Wave 3).
Wave 4: vendor needs pick from the approved list (13).
**Still open:** item 16 (blocked on Phase 13).

### Phase 07 — Dispatch & Operations · ✅ 4 new items shipped 2026-09-23; 1 old item remains
**Shipped 2026-09-23:** intake feed now empties (open-only by default, toggle for converted/closed); Job Register gained search + sortable columns (adopted Phase 17's shared `renderDataTable()`); dispatch schedule is a real 7-day window, no skip-ahead; conflicts gained a "Go to blocker" button (employee-credential conflicts only — no equipment/material reference field exists yet to jump to) with a transient red-outline highlight (`state.highlightPanel`, shared mechanism Phase 06 item 32 can reuse).
**Verified live 2026-09-23:** Front Line Timer hours reach the employee's tracked hours (22 → 24.5 after a 2.5 h submission). **Wave 4:** job-centric Plan & resources tab built (4); sample photos found already done by Phase 10 (7). **Still open:** item 8, template rebuild (deferred by the owner, Q34).

### Phase 08 — Quotes & Estimates · ✅ round two shipped 2026-09-23 (sprint Wave 1)
**Shipped:** the rate-card rework. Both tabs of `2026 RATES.xlsx` were imported as rate sheets (owner: both, "Rate Sheet" default) with three tier prices, cost-plus rows, 4-hour emergency minimums and fuel-surcharge flags. The 18% Energy/Security/Insurance fee (owner: automatic, removable) and the fuel surcharge are generated as real lines. A per-line tier, section-grouped pickers filtered to the document's sheet, a rebuilt Rate Card screen with catalog alignment, equipment and consumables linked to their rate line, and the Estimation Tool drafting lines from Resource Needs. All five round-one boxes are ticked. Also fixed app-wide: whole-dollar rounding of every amount.
**Still open:**
- ~~Link employees to their labor-role rate line~~: shipped 2026-09-23 (Wave 5b, Catalog alignment)
- ~~Owner to enter the fuel surcharge %~~: 10% is set in the live data as of 2026-09-23; confirm it's current
- Phase 09's close report prices usage at sell rates (now visible, flagged in both phase docs)

### Phase 10 — Front Line · ✅ 2026-09-22 pass shipped 2026-09-23 (Wave 2)
Map markers fixed (two maps used the broken default, not one), Receipts tile with per-job expenses rolled up to the project and the close report, Exit as a full-width bar, tile grid overflow fixed.

### Phase 09 — Billing & Invoicing · ✅ 2026-09-22 pass shipped 2026-09-23 (Wave 5b)
Itemized, day-grouped invoices on the quote pricing engine, drafted from field records, printed in the Lone Star layout. Owner decisions: tax column at 0% with lines non-taxable until the accountant confirms; Net 30 + 1.5%/month; emergency work starts at OT & Emergency. QuickBooks exports now carry real lines.
**Still open:** the close report prices usage at sell rates (needs a cost basis); invoices are one per project (no progress billing yet).

### Phase 11 — Field Ops Depth & Reporting · ✅ shipped 2026-09-23 (Wave 5)
Post-work report with per-day case narrative, both weather snapshots, post-job review (required to close a job) and photo curation. Permits, waste tracking into job cost, stock ledger, fleet PM plans, structured lab results, notifications and QBO payloads. **Deferred with reasons in the phase doc:** approval chains (to Phase 12), project commercial controls, dashboards/global search (Phase 14), template redesign (Q34).
**Owner to-do:** enter the two permits' numbers, agencies and expiry dates (Office → Compliance). Both are flagged until then.
**Data clean-up for Wave 8:** two seed dispatch jobs reference projects that don't exist.

### Phase 15 — Project Execution Workspace · ✅ shipped 2026-09-23
Equipment/vendor/resource needs, site walk status, and a quote/estimate reference now carry into the project at creation. Opportunity-Lost closes linked projects. Project detail is now Intake/Plan/Live tabs. Project Stage is greyed out at creation, budget accepts cents, and the label reads "Completion date". Not carried: site photos (opportunity has no field to carry — blocked on Phase 13) and multi-site lists (blocked on Phase 06's `opportunityLocations` junction, not yet built). The customer-paperwork flag reads live from the project's job requests rather than a carried opportunity field — see the phase doc's corrections section for why.

### Phase 16 — Emergency Response · ✅ shipped 2026-09-23
One intake screen: caller, pasted GPS pin, spill facts (storm drain, off-road discharge, absorbent), agency involvement. Explicit insurance/claim/down-payment state with a visible "Cleared to mobilize" / "Blocked" status. One guarded submit creates a linked project + dispatch job, plus a provisional account/facility when the caller has no account on file. Incident time/coordinates are captured (`incidentReportedAt`/`incidentLatitude`/`incidentLongitude`) for Phase 11's weather-snapshot fetch to anchor to later. Not done: onsite paperwork auto-attachment (blocked on Phase 13).

### Phase 17 — Operations Console & Inventory · ✅ shipped 2026-09-23
All 8 items live: All Projects table (old panels kept in code, not rendered); metric cards filtered per project class and clickable through to the matching table; Scheduled Work/Multi-Stage's second card reads "Projects without scheduled dispatches"; left-nav sub-option indent treatment; a real month-grid calendar; map filters (class/point-type/account/status/date/alerts-only); searchable+sortable consumables and equipment tables; one shared `renderDataTable()` component across all of it. Not done: equipment-category alignment to the 2026 rate sheet's sections (deferred to Phase 08, which already owns that import) and plotting facilities on the map (they aren't plotted at all today, not just unfiltered). **Follow-up 2026-09-23:** Resource Blocks is now a per-project count that filters the table. That work exposed that `equipmentAssets` rows still carried `assignedJobId`. This was migrated to `assignedProjectId` 2026-09-23, fixing a server normalizer that had been dropping every UI equipment assignment on save.

### Cross-cutting rule (owner, 2026-09-23)
Any alert on any panel uses the red-dot style: a red dot (`renderAlertDot()`) on the tab and list row, plus `.panel-needs-attention` on the panel. **Sweep done 2026-09-23 (Wave 2):**
- **Projects:** open field alerts put a dot on the Live tab, the project row and job cards, and outline the Field alerts panel.
- **Dispatch jobs:** an open conflict, or "Blocked" on a job past draft, dots the Summary tab and the Job Register row, and outlines the readiness/exceptions panels. Blocked *drafts* aren't flagged, since every unplanned draft is blocked.
- **Credentials:** a live date check dots the directory row, the credential row and the credential-type row, and outlines the Credentials panel.
- **Inventory:** below-reorder consumables and equipment on hold, with an issue, or overdue for maintenance are dotted in their tables and outlined in their detail panels.
- **Compliance and the rate card** also follow the rule.
- **Deliberately excluded:** opportunity list rows. Nearly every open deal is missing *some* next-stage field, so a dot there is noise; stage-gate dots stay on the opportunity's tabs and panels.

### Phase 18 — Workforce & Devices · ✅ items 1–3 shipped 2026-09-23; item 4 waits for Phase 12
**Shipped:** Team Roster moved to Teams and Crews, panels reordered; Upcoming Time Off + Standby/on-call as a real assignable thing (`standbyAssignments`, separate from availability blocks) with a configurable rotation setting; device lifecycle (add, open, edit, suspend, reinstate, retire, delete) with IMEI/hardware/OS/onboarding, and suspended/retired devices verified blocked from Front Line sign-in.
**Still open:** Per-dispatch sign-on links for personal phones + immutable GPS consent records — waits for Phase 12 (it's credential issuance).

---

## Stage C — Pilot gate

### Phase 12 — Identity, Authorization & Audit · *not started, 7 criteria*
Real sign-in, a forged `X-CRM-Role` header changing nothing, API-level role enforcement, audit entries naming real users, revocation taking effect. **Nothing above ships safely to real customer data without this.**

### Phase 13 — Documents · *not started, 9 criteria + the new workflow*
- Generic attachment store (every Files tab is a stub today)
- **Document requirement → instance → office-admin review → stage gate**, one mechanism for the customer packet, the Republic waste authorization, vendor COIs and service agreements
- Republic's form is a third party's PDF: fill/route/store only, never regenerate — and one packet splits into two tracked requirements
- Unblocks Phase 04

> ### ◆ PILOT MILESTONE

---

## Stage D / E — after the pilot

- **Phase 14 — PostgreSQL migration** · 9 criteria, not started. Deliberately off the critical path
- **Phase 19 — Email & message tracking** · your own "later." Stage 1 (send a quote with the PDF attached, tracked on the timeline) could move earlier if sending from the CRM starts to matter

---

## Suggested order

**2026-09-23 shipped in full or in substantial part:** Phase 15, Phase 16, Phase 17, Phase 18 (items 1–3), Phase 07 (all four remaining items), Phase 06 (substantially complete — see its own status), Phase 08 (2 of 6 new items).

**Now (2026-09-23 sprint):** Waves 1–5 shipped. Phase 11 is done, and Stage B's correctness work is complete apart from items blocked on Phase 13, the owner-deferred template rebuild, Phase 09's Lone Star invoice also shipped (Wave 5b). Next is Wave 6: the non-Entra half of Phase 12 (server sessions, API role enforcement, audit, revocation, break-glass account, pluggable provider), then Phase 18 item 4.
**Before real users:** Phase 12, then Phase 13.
**After:** Phase 11's reporting depth, Phase 14, Phase 19.

Phase 10's remaining two small items are independent — a good candidate to clear in a single session when a bigger phase is blocked on a decision.
