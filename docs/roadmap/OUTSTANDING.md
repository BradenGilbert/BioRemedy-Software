# What's Left — compiled 2026-09-22

A single view of everything still to do, across all 20 phases. **This is a snapshot, not a source of truth** — the phase docs are. Regenerate or correct this when a phase ships rather than editing it in isolation, and if this file and a phase doc disagree, the phase doc wins.

Shipped work is deliberately not repeated here; `README.md` has the "already shipped" list.

---

## The shape of it

| | Count |
|---|---|
| Phases shipped | 17 (00, 01, 02, 04, 05, 08, 09, 10, 11, 12a, 12b, 13, 15, 16, 17, 18, 20) — the 2026-09-23/24 sprint (Waves 0–8) closed 04, 11, 12a, 13, 18 item 4 and 20, and every second-round item in 08, 09, 10; 12b (Entra sign-in) followed on 2026-09-24 once the app registration existed |
| Phases substantially done, with named leftovers | 3 (03, 06, 07) |
| Phases not started | 14 (Postgres — after the pilot; inventory and runbook ready), 19 (email/Teams — the Entra registration now exists; needs Graph permissions and a design pass) |
| Open items with a checkbox against them | ~80 |
| Blocked on an owner decision, not on engineering | 14 |

Three things dominate what is left, and they are worth naming because they are not "finish the feature list":

1. **Handover.** Sales scopes work that operations never sees; the office collects paperwork that dispatch re-asks for. Phases 15 and 13 are both fixes for information not travelling.
2. **Volume.** Card-per-record screens, unfiltered metrics and 5–7 day windows were built for demo data. Phase 17 is the correction.
3. **Truth about money.** ~~The rate card does not model how BioRemedy actually prices work.~~ **Resolved 2026-09-23 (Wave 1 rate card, Wave 5b itemized invoice).** What remains on money is Part B of Phase 20 (quoted-vs-actual, NTE enforcement, quote lifecycle, unbillable project-less jobs) — a triage session, not a phase.

---

## Sprint result — 2026-09-23/24 (Waves 0–8)

Everything on the JSON backend that could be finished before the switch to Postgres + Entra is finished: the rate card and itemized invoice (08/09), field-ops depth (11), the owner's 22-item bug list and Front Line clean-up, engineering hardening (20, live), identity without Entra (12a, live — sign in with the break-glass password in `data/break-glass-password.txt`, then set your own), documents and the Client Portal (13, live), and the cutover inventory + runbook (Wave 8). **Open for the owner:** the July demo draft jobs (B9), Part B triage, and the Directory (tenant) ID + Application (client) ID for `.env` so the shipped Entra sign-in (12b, 2026-09-24) can be tried against the real tenant. `CRM_BACKUP_DIR` was set 2026-09-24 (the bioremedy OneDrive folder). **Later on 2026-09-24, from live use:** Microsoft sign-in live on the real tenant; roles combine and Settings › Active role narrows a session; intake requests got a return loop (B11); Scheduled Work projects can be created; the dispatch/operations button tidy-up with "New job request" switched off for testing; spill calls get a work plan and bare jobs can be given one; and **Messages to IT** — a chat beside the notification bell with screenshots you can draw on, one conversation per person, answered by an Admin.

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

### Phase 04 — Vendor & Subcontractor · ✅ complete 2026-09-24
*2026-09-23: Compliance list (4), rate sheets (7), dispatch-time approval check + vendor links on jobs (5) and the subcontractor pricing basis (14). 2026-09-24 (Wave 7, on Phase 13): W-9/COI upload → review, agreement templates by type (8, 9, 12).*

### Phase 05 — Contacts & Timeline · ✅ complete 2026-09-23
Phone formatter (Wave 2); shared record lookup, timeline "Related" filter and Connected-via links (Wave 3).

### Phase 06 — Opportunity Domain · ✅ substantially complete 2026-09-23 (two sessions)
**Shipped:** account-context hint relabel + "Use this text"; stage badges no longer look like buttons; `proposedSolution`/`customerNeed`/`description` write-through fallbacks removed, 12 contaminated `proposedSolution` records blanked; needs lists renamed + comma splitting + combined dialog; industry inherits for display only; close forecast replaced with relative bands (`closeBand`/`closeBandSetAt`, all existing data migrated, reverses the earlier `closeQuarter` decision); new `opportunityLocations` junction + Sites & Locations / Associated Locations panels with inline facility creation; red-dot tab/panel validation highlighting + tab contrast; site-walk quick-schedule; `customerNeed` moved to Lead & Qualification. List search (item 3) was already working.
**Sprint (2026-09-23):** Proposed Solution scope summary (Wave 1), Connected-via panel finished and the "Regarding" cross-entity field with a new Facility timeline (Wave 3).
Wave 4: vendor needs pick from the approved list (13).
**Still open:** item 16's guided capture flow (its photos/documents shipped on Phase 13, 2026-09-24).

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

## Code audit — 2026-09-23 (between Waves 5 and 6)

The owner asked for a bug scan before Wave 6. Three passes: a static wiring audit (buttons vs handlers, forms vs save functions, dialog fields, server whitelists, view routes), a click-fuzz that pressed every opener on every view and detail tab and re-saved every edit dialog unchanged, and a render sweep of every record on every detail tab looking for `NaN`/`undefined`/`[object Object]`. Plus a referential-integrity pass over the live data.

**Fixed (commit "Audit fixes"):**
- **202 dropdown reads in 72 save handlers could crash.** A `<select>` whose stored value has no matching option submits nothing, so `data.get(...)` is null and `.toString()` threw (the City of Georgetown bug, and the fuzz found it again on an opportunity's team-member and lead dialogs). Every select read in a save handler is now `(data.get("x") || "").toString()`.
- **GPS points with seven-decimal coordinates couldn't be saved:** the dialog's `step="0.000001"` rejected them, and OwnTracks pings and intake pins have seven. Now `step="any"`.
- **A consumable that had gone negative couldn't be edited** (`min="0"` on On hand) even though going negative is a deliberate Front Line feature.
- **Negative-stock alerts were written and never shown.** `inventoryAlerts` (Phase 10 Part 2) now appear on Office → Alerts, on the consumable's page, and as the red dot's reason in the consumables list, until the item is back above zero.
- **Renaming an equipment tag detached its history:** logs, dispatch resources, maintenance records, restock items and GPS points are keyed by tag. Renames now cascade, and the live "VAC-204" → "VAC TRAILER - 204" references were moved (5 records).
- **Four project pages read "NaN% complete"** (no dates); progress now falls back to stage-only. A blank project manager printed a bare "PM" badge.
- **Three Remove handlers had no button:** addresses, vendor profiles and the relationship snapshot now have one.
- **"Edit schedule & lead" on a closed job did nothing** (it only raised a toast); it's hidden there now, like the header's Schedule button already was.
- A Forms-tile submission (no task behind it) would have listed every actionless attachment, i.e. field receipts, on its card. Guarded.

**Found, needs the owner (data, not code):** the live data holds children of records that no longer exist, all hard-deleted by hand or by an old reset (no delete path exists in the app): 9 dispatch jobs and 8 job requests point at 5 missing projects; 6 dispatch jobs, 2 opportunities, 5 facilities, 2 addresses, 1 vendor profile and 6 job requests point at 6 missing accounts; one stakeholder link points at a missing contact. They render as "Unknown account" and their edit dialogs can't save (the account dropdown has nothing to select). Options: soft-delete the orphans, or recreate the parents. Decide in Wave 8's clean-up, or now. Two dispatch resources reference equipment that never existed (`HAND-03`, `PID-09`) and two GPS points carry junk tags (`7q`, `Corporate Office`).

**Noted, not changed:** 18 functions are no longer called (`renderOperationsLegacy`, `saveNote`, `openNoteDialog`, `renderProjectOverviewCard`…) and 13 server collections have no client reader (`salesOrders`, `leads`, `connections`, `annotations`…). Neither hurts; both are Wave 8 clean-up candidates. `saveDispatchSchedule` still reads two inputs Wave 4 removed, harmlessly.

---

## Owner's bug list — 2026-09-23 (after the audit)

The owner sent 22 findings from using the app. Three needed decisions; all were answered the same day: **site walks get the full build** (facility, participants, team, calendars, dispatch board, Front Line); **dispatch picks people by availability and credentials, crews are quick-picks** and a person can belong to several groups; **a pause blocks outright.**

**Shipped (commits "Owner list, batch 1/2"):**
- Operations: class tables are titled "<card> for <class> Projects", every class view has the same four clickable cards (the Emergency view's odd card is gone), the All Projects cards follow the account filter, and project tables have quick-filter chips (stage, class, alerts, no dispatch, work started, awaiting lab results).
- Operations map plots dispatch jobs that have coordinates, with "Open job" in the popup.
- **Project stage is honest.** A finished dispatch moves the project to *Field Work*, not Closeout; Closeout is only the explicit close, which now requires no open dispatch job or request. A new dispatch on a finished project steps the stage back to Plan. The account's Projects tab lists only actually-closed projects as closed. A project with samples out shows "Awaiting lab results (n)" on its header and in the projects table.
- **Sampling tab** on the project: one sampling event per dispatch visit (samples used to each be their own "event"), samples awaiting results, analyte results, lab documents.
- Project Live tab's team panel reads the dispatch jobs' crews, equipment and vendors.
- Intake dialog prefills the generator details the page already shows (they came from the account and facility), and the "missing generator" check accepts them.
- Front Line: completing any step after Mobilize moves the job to In progress (stamping the operational day and weather); completing every required step moves it to Field complete; completion tracks required tasks.
- Dispatch job details are editable ("Edit details" on the job header and Details tab); a closed job no longer offers "New dispatch request"; the schedule dialog stops asking for a crew when people are already assigned.
- Whole numbers for items: material and Front Line quantities step by 1; quote/invoice lines step by 1 unless the unit is hours (0.25) or days (0.5).
- Estimation lines drafted from vendor needs are labelled "Vendor / subcontractor".
- Inventory: "Add from rate sheet" onboards consumables and equipment from rate-sheet sections; equipment has Owned / Rented / Subcontracted.
- **Paused accounts block** new opportunities, job requests, projects, scheduling or dispatch according to the pause's scope, and every pause and resume is kept in the account's pause history.
- **Site walks**: a scheduler on the opportunity (Develop & Planning → Site walk → Schedule) with the opportunity's facility and a BioRemedy participant picker; participants join the opportunity's Team; the walk sits on the workforce schedule, the operations calendar, the dispatch board (Scheduled column, blue "Sales activity" card) and Front Line's Job Book (Sales activities section). Stored as a `scheduleEvents` row with `kind: "site_walk"` plus a Site Visit meeting on the timeline.
- **Crews as quick-picks**: a person keeps a home crew and team and can be added to any number of others (`workforceTeamMemberships`, which the server had seeded and nothing read). Crew and team cards have "Add member"; the dispatch assign dialog can add a whole crew, then individuals are adjusted per job.

**Not built (deferred):** "Anticipate results in project notes" beyond the next-step line; a laboratory master table; per-person notification of site walks (waits for Phase 12 identities).

**Later the same day -- Front Line clean-up (owner: "the messaging section just has a ton of job ids to click or general chat"):** Messaging is an inbox (Dispatch, your open jobs, earlier jobs with a conversation) opening into a real thread; the office answers from the dispatch job's new Messages tab or the Dispatch Board's Field messages panel, with red dots while a field message is unread. Home tiles show unread messages and open jobs; the job page has "Message dispatch"; Settings wording and checkbox rows fixed. See Phase 10's corrections.

---

## Stage C — Pilot gate

### Phase 20 — Engineering Hardening · *shipped 2026-09-23 (Wave 5c)*
All of Part A is in: the static-file allowlist (live), per-record `version` with 409 on a stale save, merge-on-save, scheduled + off-machine backups (mechanism; `CRM_BACKUP_DIR` still to be pointed at a OneDrive folder), demo seed behind `CRM_SEED_DEMO`, soft delete with a cascade table + Restore, `scripts/smoke.mjs`, and the doc hygiene. The orphan clean-up ran on live data (0 orphans now). Still open: B9's 18 July demo draft jobs (owner's call) and the Part B triage. Original list, for the record:
- **0. Static-file allowlist.** `GET /data/backend.json`, `/server.mjs`, `/.git/config` and the uploaded rate sheet all return 200 with no role header today (confirmed on a scratch server). **Ship before the next tunnel session.**
- 1. Optimistic concurrency: `version` per record, 409 on a stale save, no silent overwrite
- 2. Saves merge the returned record instead of re-downloading the 1.2 MB backend every time
- 3. Server-scheduled backups with an off-machine (OneDrive) copy, uploads included
- 4. Demo seed data behind `CRM_SEED_DEMO`, seed arrays out of the client
- 5. Soft-delete route with a cascade table, Delete buttons, and the orphan clean-up script (needs the owner's soft-delete-vs-recreate call)
- 6. A kept `scripts/smoke.mjs` (every view, every dialog re-saved, console-error and `NaN`/`undefined` sweep, the static-file and forged-header checks, the integrity pass)
- 7. Doc hygiene: Phase 14's stale phase numbers (fixed 2026-09-23) and big-bang wording, stale README, "Phase 08" comments, split Phase 12 into 12a/12b, resequence Phase 13 workflow-first, clear the 19 July draft dispatch jobs

**Part B — flow findings, unsorted (B1–B12), parked in the same doc for a later triage session:** Won/Lost dual truth + no lost reason (B1); Won owes no project and close never writes back (B2); 22 of 50 dispatch jobs have no project so can't be billed (B3); quotes have no Sent/Accepted/Expired state (B4); no quoted-vs-actual, NTE never enforced (B5); no stale-deal signal, stage age resets on any edit (B6); no planned-visit schedule for Multi-Stage (B7); project status/stage/activePhase triple (B8); 19 July draft jobs inflate Blocked counts (B9); derive account lifecycle for Q54 (B10); ~~"Needs information" has no return loop (B11)~~ — **closed 2026-09-24:** intake cards carry Edit (in place), Needs info with a note, Mark ready, Decline, Cancelled, Reopen and Delete, and filling in the missing pieces sends the request back to the queue; verify the account-role/job-title split actually shipped (B12).

### Phase 12 — Identity, Authorization & Audit · ✅ *12a shipped 2026-09-23; 12b shipped 2026-09-24*
Server sessions (cookie), local sign-in with passwords set by an admin, the role taken from the session on every API call (the `X-CRM-Role` header is dead), an append-only audit log naming the real user and the changed fields, revocation and disabling on the next request, break-glass emergency admin, the attachment route closed. 12b: "Sign in with Microsoft" with the ID token verified server-side against the bioremedy.com tenant's keys, the role from the Entra app role, users created on first sign-in, refusals with guidance, `CRM_LOCAL_LOGIN=off` to retire passwords. Live on the real tenant since 2026-09-24; the same day roles became combinable (a session holds every role, Settings › Active role narrows it until logout). Left: a per-device token for the OwnTracks endpoint; per-job scoping of sign-on-link sessions; someone disabled in Entra keeps a CRM session for up to 12 hours unless revoked here.

### Phase 13 — Documents · ✅ shipped 2026-09-24 (Wave 7)
Generic document store with hash de-duplication and versions, every Files tab live, 14 document types (the customer packet and Republic's waste authorization as fixed PDFs), requirement → review → gate (the Negotiation gate reads approved paperwork; the project and emergency intake read the same state), vendor paperwork, site photos, account logo, and the Client Portal scoped server-side with customer uploads of returned paperwork. Left: SharePoint links, sending/e-signature (Phase 19), PDF form-filling.

> ### ◆ PILOT MILESTONE

---

## Stage D / E — after the pilot

- **Phase 14 — PostgreSQL migration** · 9 criteria, not started. Deliberately off the critical path
- **Phase 19 — Email & message tracking** · your own "later." Stage 1 (send a quote with the PDF attached, tracked on the timeline) could move earlier if sending from the CRM starts to matter

---

## Suggested order

**2026-09-23 shipped in full or in substantial part:** Phase 15, Phase 16, Phase 17, Phase 18 (items 1–3), Phase 07 (all four remaining items), Phase 06 (substantially complete — see its own status), Phase 08 (2 of 6 new items).

**Now (2026-09-23 sprint):** Waves 1–5 shipped. Phase 11 is done, and Stage B's correctness work is complete apart from items blocked on Phase 13, the owner-deferred template rebuild, Phase 09's Lone Star invoice also shipped (Wave 5b). **Phase 20 shipped 2026-09-23 (item 0 on its own commit, then Wave 5c). Wave 6 shipped 2026-09-23: Phase 12a (sessions, local sign-in, API enforcement, audit, revocation, break-glass) and Phase 18 item 4 (sign-on links + GPS consent).** Wave 6 was: the non-Entra half of Phase 12 (server sessions, API role enforcement, audit, revocation, break-glass account, pluggable provider), then Phase 18 item 4.
**Before real users:** put the tenant and client IDs in `.env`, restart, and sign in with Microsoft once (12b shipped 2026-09-24) — everything in Stage C is done (20, 12a, 12b, 13). The Pilot Milestone's software is in place.
**After:** Phase 11's reporting depth, Phase 14, Phase 19.

Phase 10's remaining two small items are independent — a good candidate to clear in a single session when a bigger phase is blocked on a decision.
