# Phase 04 — Vendor & Subcontractor

**Status:** 🟢 **Most items done, 2026-09-17 session.** Items 1, 2, 3 (core build), 6, 10, 11, and 13 (documentation) done and click-tested live. Item 4 partially done (header badge shipped; the filterable list view was not). Items 7, 8 (vocab only, not upload+review), 9 (vocab only, not upload+review), 12, 14 not started — mostly blocked on Phase 08 (rate cards) or Phase 13 (document storage) per this doc's own dependency notes. Item 5 not started — bigger than the doc originally implied, see its corrected section below.
**Depends on:** Phase 02 (vendor dispatch/billing address types), Phase 03 (account type classification)
**Soft dependency:** items 7, 13, and 14 (rate-card questions) need Phase 08's rate/pricing foundation to exist first — sequence those three after Phase 08, or expect to redo them. Items 1–6 and 8–12 do not depend on Phase 08 and can proceed independently.
**Estimated sessions:** 2–3

---

## Why this phase exists

> *"Vendor compliance, and company profile 'Edit' mention subcontractor stuff, but I don't fully understand all of it. I know the core is we want to document who can be a subcontractor for us and if they filled out all the right paperwork, then we also want to know who is permitted to be a subcontractor for account X. Then on top of that there is vendor paperwork, we need to clearly break this out, maybe in its own tab maybe after 'Account Health'."*

The confusion is real and it is the UI's fault, not the reader's: **three genuinely different questions are currently answered in the same two panels.** Separating them is the whole phase.

---

## The three layers (locked 2026-09-15)

### Layer 1 — Can this company work for *us*?
Our own onboarding and compliance. Insurance certificates, W-9, safety record, expiry dates.

- **Table:** `vendorProfiles` (exists, **3 rows**, corrected 2026-09-17 from "2 rows") + `subcontractorTypes` (4 rows)
- A trigger already keeps `accounts.eligible_for_subcontracting` in sync with these compliance fields
- Answers: *"Is their paperwork current?"*

### Layer 2 — Is this company permitted to work for *customer X*? ⚠️ NEW
Customers frequently maintain their own approved-vendor lists. A sub who is fully compliant with us may still not be permitted on a given customer's sites.

- **Table: `account_approved_subcontractors` — does not exist anywhere today**
- Answers: *"Can we actually put them on this customer's job?"*

| Column | Notes |
|---|---|
| `account_id` | The **customer** account granting approval |
| `subcontractor_account_id` | The **vendor** account being approved |
| `status` | Approved / Pending / Rejected / Expired |
| `approved_scope` | What work they're approved for |
| `approved_from` / `approved_until` | Customer approvals expire |
| `evidence_file_id` | The customer's approval letter (real storage lands in Phase 13) |
| `notes` | |

### Layer 3 — Which sub is on *this job*?
Job-specific commitment: scope, rate, dates.

- **Table:** `subcontractorAssignments` (exists, **1 row, and it already has full working UI** — card renderer, open/save/remove dialogs, panel on the account Details tab. Corrected 2026-09-17: this doc originally said "0 rows, no UI"; verified against code before implementation, that was wrong.) + `serviceAgreements` (**2 rows**, corrected from "1 row")
- Answers: *"Who did we actually commit to this work packet, on what terms?"*
- **What's actually still missing at Layer 3** is not the UI — it's that the fields don't make sense together (item 14) and `relatedJobReference` is a free-text field with no real link to `dispatchJobs`/`jobResources` (ties into item 5).

---

## In scope

### 1. Give this its own tab

Per the owner: a dedicated tab, positioned **after "Account Health"** on the account page. Name it for what it answers — *"Vendor & Subcontractor"*.

Three clearly labeled sections matching the three layers:

| Section | Shows |
|---|---|
| **Compliance & Paperwork** | Our onboarding: insurance, W-9, safety, expiry status. Visible when the account `is_vendor` or `is_subcontractor`. |
| **Approved Subcontractors** | Which subs *this customer* permits. Visible when the account `is_client`. |
| **Service Agreements** | Standing agreements and rate cards. |

An account can be a client **and** a vendor simultaneously (migration 026 explicitly supports this), so both sections can appear on the same account. That is correct, not a bug.

**✅ Done 2026-09-17.** New `vendor-subcontractor` tab added to `accountDetailTabs` (`app.js`), positioned last (after Account Health). `renderAccountVendorSubcontractorTab()` renders four sections, not three — Compliance & Paperwork and Approved Subcontractors as specified, plus **Service Agreements** and **Subcontractor Assignments** (Layer 3, moved here too — they were co-located with the others in the old Details-tab cluster and belong with the rest of this material, not left behind). Compliance & Paperwork gates on `relationship?.isVendor || relationship?.isSubcontractor`; Approved Subcontractors gates on `relationship?.isClient`; each shows a clear explanatory empty-state (not just a blank panel) when gated off, telling the user where to set the flag that unlocks it. Verified live: an account flagged both vendor and subcontractor (Balfour Services) shows all four sections; an account flagged neither (Riverbend Manufacturing, before testing) shows the gated message for Compliance & Paperwork.

### 2. Strip subcontractor language out of Company Profile

Company Profile should describe the company. Compliance and approval belong on the new tab. Remove the confusing cross-references the owner flagged.

**✅ Done 2026-09-17.** `isSubcontractor`, `subcontractorPermitted`, `subcontractorPreapprovalRequired` removed from `#companyProfileDialog`/`openCompanyProfileDialog`/`saveCompanyProfile` entirely — Company Profile is now just SIC code and Ownership. The three fields moved into the Vendor Profile dialog (`#vendorProfileDialog`) instead, since they're Layer-1 compliance concerns, not company-description fields — no data model change, they still live on `accountRelationshipExtensions`, just edited from the vendor-compliance dialog now (`saveVendorProfile` patches both `vendorProfiles` and `accountRelationshipExtensions` in one save). Verified live: Company Profile dialog no longer shows any subcontractor language.

### 3. Build the Layer 2 table and UI

New collection, new picker ("approve a subcontractor for this customer"), expiry surfacing, and a warning when an expired or unapproved sub is selected.

**Note:** `vendorProfiles.subcontractorPermitted` (Unknown/Approved/Denied) already exists as a *blanket*, non-customer-specific flag on the vendor's own record — confirmed 2026-09-17. This phase doesn't touch that field; it's a separate, coarser gate that can coexist with the new per-customer Layer 2 table (a vendor could be blanket-`Approved` generally but still need per-customer approval for a specific account, or vice versa — not a conflict, just two different questions).

**✅ Done 2026-09-17.** New collection `accountApprovedSubcontractors` (registered in `server.mjs`'s `collectionAccess`/`defaultBackend`/bootstrap-hydration map, role `salesDocuments` — matching `vendorProfiles`/`serviceAgreements`/`subcontractorAssignments`). Fields: `accountId` (customer), `subcontractorAccountId` (vendor), `status` (Pending/Approved/Rejected/Expired), `approvedScope`, `approvedFrom`, `approvedUntil`, `notes` — `evidence_file_id` deliberately omitted, real uploads are Phase 13. New dialog `#approvedSubcontractorDialog`, vendor picker sourced from `vendorAccounts()` (accounts with `accountType === "Vendor"` or an existing vendor profile). Card renderer shows an expiry badge via the same `isExpiringOrExpired()` helper used for the header badge (item 4). **Not done:** the dispatch-time approval check (moved into item 5's scope, since it can't be built before item 5's own gap is closed — see that item's correction).

### 4. Expiry visibility

Compliance and customer approvals both expire. Surface them:
- Badge on the account header when something is expired or expiring within 30 days
- A filterable list somewhere in the Sales or Office workspace

**🟡 Partially done 2026-09-17.** The account header badge shipped: `accountVendorExpiryWarning()` checks both this account's own vendor-insurance expiration and any `accountApprovedSubcontractors` approvals it grants, using a new shared `isExpiringOrExpired(dateString, withinDays = 30)` helper — shows "Compliance expired" (red) or "Compliance expiring soon" (amber) next to the existing Paused/Account-status badges. Verified live on a seed account with an already-expired insurance date. **Not done:** the filterable Sales/Office-workspace list view — that's a new list page, not a quick addition, and wasn't started this session.

### 5. Close the known dispatch gap

From `docs/erp-operational-architecture.md` and `docs/dataverse-relationship-architecture.md`:

> `job_resource_allocations.vendor_account_id` (`crm-schema/022_jobs_dispatch_assignments.sql:451`) points **straight at `accounts`** instead of at a `subcontractor_assignments` row.

This mixes job-specific terms (scope, rate, dates) into the vendor's general standing record and loses assignment history when the vendor profile changes. Repoint it at Layer 3.

**Then add the Layer 2 check at dispatch time:** when a vendor is allocated to a job, validate that they are approved for *that job's customer account*. That validation is the entire payoff of Layer 2 — without it, the approval list is decoration.

**Correction, verified 2026-09-17 before implementation: this isn't a repoint, it's a from-scratch build.** `job_resource_allocations` is a SQL-schema-only concept — the running JS prototype's equivalent, `jobResources` (`server.mjs`, `state.backend.jobResources`), has **no vendor/account FK of any kind today**. Its "Vendor" resource type (one of `Equipment`/`Vehicle`/`Material`/`Vendor` in the dispatch "Assign resource" dialog) is a plain free-text `resourceName` input (placeholder: "Vactron, truck, sample kit") — there's nothing to repoint. Closing this gap means adding a `subcontractorAssignmentId` field to `jobResources`, replacing the free-text Vendor input with a picker sourced from `subcontractorAssignments`, and only then adding the Layer 2 approval check. This also lives in the Dispatch workspace's "Assign resource" dialog, not the Account page — touches Phase 07's territory as much as this one. Given the size, treat this as the last item to pick up in this phase, after Layer 1/2 exist to validate against.

### 6. Vendor Compliance uses placeholder names instead of real employees

> *"Vendor approval uses Maya chen, Luis Romero, and Priya Patel instead of actual employees. This is still a divide between users/employees and their roles, job descriptions."*

Same class of bug as the Account/Contact owner-field problems in Phases 03/05/06 — a hardcoded or demo-identity value standing in for a real employee reference. Trace wherever Vendor Compliance approval is attributed and wire it to the real `employees` roster, the same pattern used everywhere else roles have been fixed.

**✅ Done 2026-09-17.** `openVendorProfileDialog`'s `approvedById` picker was `populateSystemUserSelect(dialog, "approvedById")` — sourced from `systemUsers`, a nearly-empty 3-row collection (flagged as fragile in Phase 03's own corrections). Switched to `populateEmployeeSelect(dialog, "approvedById", "Not yet reviewed")`, matching the pattern used everywhere else in this codebase for owner/approver fields. Seed data remapped: the one vendor profile with `approvedById: "user-priya"` now reads `"emp-priya"` (Priya Patel already existed as both a systemUser and a real employee, so this was a clean 1:1 remap, not a guess). `renderVendorProfileSummary`'s approver display switched from `systemUsers.fullName` to `findEmployee(...).displayName` to match.

### 7. Rate card structure and origin

> *"On Vendor compliance it asks for rate card and lists 2026 standard environmental services, we need to figure out where/how we want this created. I think it should be tied to items able to be listed on estimates and quote forms."*

**Do not solve this independently of Phase 08 (Quotes & Estimates).** The owner's own instinct is correct — this rate card should be the same underlying rate/price data quote line items pull from (`priceLevels`/`products`), not a separately typed value. Phase 08's item 2 covers this from the quoting side; this item is the vendor-compliance-side half of the same fix.

### 8. W-9 upload + review workflow

> *"On Vendor compliance W-9 should ask for a copy to be uploaded, then it messages the office admin for review and approval before marking it as 'approved'. The other options should be 'Missing', 'Under Review', 'Approved', 'Expired', and 'Needs Attention'."*

Needs: file upload (depends on Phase 13), a notification to office admin on submission (no notification infrastructure exists yet per `docs/roadmap/phase-11-field-ops-depth.md`'s "Approvals & notifications" gap — decide whether to build a minimal one-off notification here or wait), and the five-state status vocabulary replacing whatever exists today.

**🟡 Partially done 2026-09-17 — vocabulary only.** `w9Status` options replaced with the exact five states asked for (`Missing`/`Under Review`/`Approved`/`Expired`/`Needs Attention`); the old `Received` value had no direct equivalent in the new vocabulary, so existing seed rows were remapped `Received` → `Approved` (closest match — a W-9 that was "received" and never flagged otherwise is functionally what "Approved" means here). `computeSubcontractingEligibility()` updated to check `w9Status === "Approved"` instead of the old `"Received"`. **Not done:** upload UI and the office-admin review/notification step — both explicitly depend on Phase 13 (uploads) and an undecided notification approach, per this item's own scoping.

### 9. Insurance/COI upload + review workflow

> *"On Vendor compliance Insurance should ask for a copy of their COI be uploaded and then request review and approval on it before it marks the status as valid. The other drop down options should be 'Valid' 'Under Review' 'Expired', 'Expiring', 'Waived'"*

Same shape as item 8 — upload, review/approval step, and a five-state vocabulary (`Valid`/`Under Review`/`Expired`/`Expiring`/`Waived`) distinct from W-9's vocabulary. Build the upload+review pattern once and reuse it for both items 8 and 9 rather than two parallel implementations.

**🟡 Partially done 2026-09-17 — vocabulary only.** `insuranceStatus` already had 4 of the 5 target states; added `Under Review` to complete the set (`Valid`/`Under Review`/`Expiring`/`Expired`/`Waived`). No seed-data remapping needed — all existing values were already valid under the new list. **Not done:** upload UI and review workflow, same reason as item 8. The shared upload+review pattern this item asks to build once (for both 8 and 9) still needs to happen when Phase 13 lands — nothing built here should need rework then, since only the vocabulary changed, not the field shape.

### 10. Performance rating should be a real A–F dropdown

> *"On Vendor compliance We need to fix performance rating so that is says (+A – F) as a drop down."*

Small, concrete — whatever performance rating field exists today, replace with a proper letter-grade dropdown (confirm exact grade set wanted: straight A–F, or with +/– modifiers as the note's "(+A – F)" notation suggests).

**✅ Done 2026-09-17.** Was a free `<input type="number" min="0" max="5" step="0.1">`. Replaced with a `<select>` offering A+ through F with +/- modifiers on A/B/C/D (matching the note's "(+A – F)" notation), plus "Not yet rated". Existing numeric seed values (5, 5, 1 on a 0–5 scale) remapped: 5→A, 1→F (no 2/3/4 values existed in seed data to map, but the same 5/4/3/2/1/0 → A/B/C/D/F/F scale is the convention going forward if that ever comes up).

### 11. Auto-generated Vendor ID

> *"On Vendor compliance we need to autogenerate an account Vendor ID or have someway it is created… maybe an auto assigned vendor ID? Not sure what best practices are for this."*

The owner is explicitly unsure of the right convention here — this needs a short decision (sequential number, prefix + sequence like other ID schemes already in this codebase, e.g. `INV-###`/`PO-###` patterns visible in existing seed data) before implementation, not a guess baked into code.

**✅ Done 2026-09-17 — decision made and documented, not guessed.** Checked the codebase's actual existing conventions first: there's no real `INV-###`/`PO-###` business-number pattern anywhere (purchase orders have no `poNumber` field at all — that assumption in this doc didn't hold up). The two real precedents found were `JOB-YYYY-MMDD-##` (dispatch jobs) and `Q-YYYY-####` (quotes). **Decision: `VEND-####`**, sequential, 4-digit zero-padded — simplest of the existing patterns, no date component needed since vendor numbers aren't time-scoped the way jobs/quotes are. Auto-suggested (not force-locked) into the `vendorNumber` field when opening the dialog for a brand-new vendor profile — still an editable text input, matching the "suggest, don't force" pattern already used for sample IDs elsewhere in the app, so an account that already has an external vendor number from elsewhere can keep it. `nextVendorNumber()` only considers existing values that already match the `VEND-####` pattern exactly (not the pre-existing free-typed junk values like `"11111"`/`"00001"` — those were left as-is, not retroactively renumbered, since nothing asked for a migration and doing so risked breaking references elsewhere). The separate `accountingVendorId` field (for an external accounting system's own vendor ID) was left untouched — that's legitimately something entered from outside this system, not something to auto-generate.

### 12. Service agreement templates by type, with upload+review for anything custom

> *"On account service agreement we need agreements selected under agreement type to utilize a preexisting form for MSA, standing work order, and or rate agreement. It should also allow for the option to upload a different one that would need to be sent to office admin or someone internally for review and approval."*

For each `agreement type` value (MSA, Standing Work Order, Rate Agreement), offer a pre-built template; also allow uploading a custom document that routes through the same review/approval pattern as items 8/9.

### 13. Service agreement's own rate-card question, and disambiguating who is customer vs. provider

> *"On account service agreement mentions 'Rate Card' again and lists the '2026 standard environmental services' this may be different if a 'Rate agreement' is selected in agreement type or something else... Under service Agreement there is also Master service agreement – not sent, COI, and W-9. We are listing sent, not sent, and on file. If we are expecting to receive W-9s then that makes sense... If it is for us to receive their stuff, this has some overlap with the vendor tab above. We need to sort out when they are our customer and when we are their service provider. Then the off case where we are both each others customer and service provider. This is just a bit confusing currently so we need to flush it out with good detail."*

This is a genuine conceptual ambiguity, not a bug — **resolve the model before touching the UI.** The account relationship fields already support an account being client and vendor simultaneously (migration 026, referenced in this doc's own "Why this phase exists" section), but the *documents* panel doesn't yet distinguish "documents we send them" (their MSA, our W-9 if we're their subcontractor) from "documents we collect from them" (their W-9/COI, because they're our vendor) from "documents both directions apply" (mutual MSA/service agreement). Write out the three-way matrix (we're their customer / we're their vendor / both) explicitly before building the service-agreement panel, so it doesn't inherit the same confusion the note is describing.

**✅ Matrix resolved 2026-09-17, verified against the two existing (and previously confusingly-overlapping) status trackers before moving either:**

| Relationship direction | What it means | Which existing field tracks it | Vocabulary | Visible when |
|---|---|---|---|---|
| **They are our customer** (`is_client`) — *we* are their service provider | We may need to send **our own** compliance paperwork (our W-9, our COI, a signed MSA) to them, the same way any of our vendors sends paperwork to us. | `accountRelationshipExtensions.msaStatus` / `coiStatus` / `w9DocumentStatus` (`"Not Sent"` / `"Sent"` / `"On File"`) | Outbound — "Sent" only makes sense as something *we* did | Service Agreements section (this is fundamentally about *our* agreement with *our* customer) |
| **They are our vendor/subcontractor** (`is_vendor` / `is_subcontractor`) — *they* are our service provider | We collect **their** compliance paperwork (their W-9, their insurance certificate) before we can use them. | `vendorProfiles.w9Status` / `insuranceStatus` (`"Missing"` → `"Approved"` / `"Valid"` → `"Expired"`) | Inbound — "Received"/"Valid" only makes sense as something verified from *them* | Compliance & Paperwork section (item 1) |
| **Both** — mutual relationship (a subcontractor network partner who is also sometimes hired as a customer) | Both trackers apply simultaneously, on the same account, tracking two different documents in two different directions. Not a conflict — this was already structurally possible (migration 026 supports `is_client` + `is_vendor` together) — the confusion was purely that both trackers shared similar-sounding vocabulary ("W-9 status") with no direction label. | Both, shown in their respective sections | Both, unchanged | Both sections render (per item 1's visibility rule) |

**Resolution: keep both existing trackers as-is — do not merge them.** They already model the right two directions; the only real fix needed is (a) making sure each one only ever appears in the section matching its direction (Service Agreements = outbound/we-send, Compliance & Paperwork = inbound/we-collect) so they're never shown side-by-side looking like duplicates, and (b) a one-line label on each ("Documents we send them" / "Documents we collect from them") so the direction is explicit instead of inferred. No data model change needed for this item — a labeling and placement fix once the new tab (item 1) exists to place them in.

### 14. Subcontractor assignment's rate fields don't make sense together

> *"The subcontractor assignment section doesn't make since since it asks for a rate card, rate amount and rate type (hourly, unit based, etc.) these seem contradictory."*

A rate card (a whole schedule of rates) and a single rate amount + rate type (one specific number) are different levels of specificity being asked for in the same form — likely one should derive from the other (pick a rate card, then it populates or constrains the rate amount/type) rather than being three independent, contradictory inputs. Fix once the rate-card foundation from item 7/Phase 08 exists.

---

## Out of scope

- Real document storage for certificates and approval letters. Phase 13 — capture metadata and file references now, wire real uploads later.
- Automated insurance-certificate expiry *notifications*. Surface expiry in the UI here; notification infrastructure is not yet slotted into a stage.
- Vendor bills, payments, and AP. Accounting is Phase 11.
- Building the underlying quote/rate-card line-item system — Phase 08. Items 7 and 13 here only consume it.

---

## Data model changes

**New:** `account_approved_subcontractors`
**Newly used:** `subcontractorAssignments` (0 rows today) gets its first real UI
**Changed:** `job_resource_allocations.vendor_account_id` → subcontractor-assignment reference

Update `docs/database-handoff-map.md` (Priority 1 item 4 partially closes) and `docs/dataverse-relationship-architecture.md` ("Still Needed" list).

---

## Verification / done criteria

- [x] Vendor & Subcontractor tab appears after Account Health (2026-09-17)
- [x] Company Profile no longer mentions subcontractor compliance (2026-09-17)
- [x] Mark a vendor account compliant with a W-9 and insurance expiry; status reflects it (2026-09-17, verified live)
- [x] Approve that vendor as a subcontractor **for one specific customer account** (2026-09-17, verified live)
- [x] The same vendor shows as *not* approved for a different customer (structurally true — approvals are keyed by `accountId`, verified by reading `approvedSubcontractorsForAccount`'s filter; not separately re-tested on a second account)
- [x] Set a customer approval to expire yesterday → it surfaces as expired (2026-09-17, `isExpiringOrExpired` verified against a past date)
- [ ] Allocate a subcontractor to a job and see the approval check fire for that job's customer — blocked on item 5, not started
- [x] An account that is both a client and a vendor shows both sections correctly (2026-09-17, verified live on Balfour Services)
- [x] Vendor Compliance approvals attribute to a real employee, not a placeholder name (2026-09-17)
- [ ] Uploading a W-9 or COI triggers a review step before the status can reach Approved/Valid — blocked on Phase 13
- [x] Performance rating renders as a real letter-grade dropdown (2026-09-17)
- [x] A new vendor account gets an auto-generated Vendor ID with no manual entry (2026-09-17, verified live — `VEND-0001` suggested, still editable)
- [ ] Selecting an agreement type (MSA / Standing Work Order / Rate Agreement) offers its matching template — not started, needs Phase 13 for custom-upload review
- [x] The three-way client/vendor/both document matrix (item 13) is written down and the service-agreement panel matches it (2026-09-17 — see item 13's resolved matrix; panel now labels each tracker by direction)

---

## Open decisions

- **Does an expired customer approval block dispatch, or just warn?** Recommendation: warn loudly, allow override with a reason and an audit event — matching the existing dispatcher-override pattern in `docs/erp-operational-architecture.md`.
- **Is customer approval per-scope or blanket?** The `approved_scope` column assumes per-scope; confirm whether that granularity is real or whether a blanket approval is enough.
- **Who maintains the approved list** — sales, ops, or compliance? Affects which role can write to it in Phase 12.
- ~~**Vendor ID convention**~~ — ✅ Resolved 2026-09-17: `VEND-####`, sequential, auto-suggested but editable. See item 11.
- ~~**Performance rating scale**~~ — ✅ Resolved 2026-09-17: A–F with +/- modifiers on A/B/C/D. See item 10.
- **Notification on W-9/COI submission** — build a minimal one-off notification now, or wait for Phase 11's "Approvals & notifications" gap to close? (items 8, 9) — still open, blocked on Phase 13 for uploads regardless.

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*

- **2026-09-17 — row counts and Layer 3's actual state, verified before implementation.** This doc's opening framing had three factual errors, all corrected inline above at their source: `vendorProfiles` has 3 rows (not 2), `serviceAgreements` has 2 rows (not 1), and most importantly `subcontractorAssignments` already has **1 row and full working UI** (card renderer, open/save/remove dialogs, a panel on the account page) — not "0 rows, no UI" as originally written. Layer 3 was never the gap; the real remaining Layer 3 work is items 14 (contradictory rate fields) and 5 (no real dispatch linkage), not building UI from nothing.
- **2026-09-17 — item 5 ("close the dispatch gap") is a from-scratch build, not a repoint.** Verified against the running JS prototype before touching anything: `job_resource_allocations.vendor_account_id` is a SQL-schema-only concept. The prototype's equivalent (`jobResources`) has no vendor/account FK of any kind — its "Vendor" resource type is a bare free-text input. There's nothing to repoint at `subcontractorAssignments`; the field needs to be built first. Also touches the Dispatch workspace's "Assign resource" dialog, not the Account page, so this is as much Phase 07's territory as this one's. Deliberately not started this session — recommend picking it up only after confirming with Phase 07's own doc whether it already plans to touch the same dialog, to avoid two phases redesigning the same UI independently.
- **2026-09-17 — a duplicate rate-card selector was found that the original doc didn't mention.** Item 13 only called out the Vendor Compliance vs. Service Agreement "Rate Card" duplication. There is actually a **third** independent `priceLevelId` selector, on Subcontractor Assignments, also labeled "Rate card" (`index.html`, `#subcontractorAssignmentDialog`). Not resolved this session — folded into item 14's existing scope (the contradictory rate-card/rate-amount/rate-type fields on that same dialog), since fixing one without the other would be incomplete. Both remain blocked on Phase 08's rate-card foundation as the doc's soft-dependency note already anticipated.
