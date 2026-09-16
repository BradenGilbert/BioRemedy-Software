# Phase 04 — Vendor & Subcontractor

**Status:** Not started
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

- **Table:** `vendorProfiles` (exists, 2 rows) + `subcontractorTypes` (4 rows)
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
| `evidence_file_id` | The customer's approval letter (real storage lands in Phase 11) |
| `notes` | |

### Layer 3 — Which sub is on *this job*?
Job-specific commitment: scope, rate, dates.

- **Table:** `subcontractorAssignments` (exists, **0 rows**, no UI) + `serviceAgreements` (1 row)
- Answers: *"Who did we actually commit to this work packet, on what terms?"*

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

### 2. Strip subcontractor language out of Company Profile

Company Profile should describe the company. Compliance and approval belong on the new tab. Remove the confusing cross-references the owner flagged.

### 3. Build the Layer 2 table and UI

New collection, new picker ("approve a subcontractor for this customer"), expiry surfacing, and a warning when an expired or unapproved sub is selected.

### 4. Expiry visibility

Compliance and customer approvals both expire. Surface them:
- Badge on the account header when something is expired or expiring within 30 days
- A filterable list somewhere in the Sales or Office workspace

### 5. Close the known dispatch gap

From `docs/erp-operational-architecture.md` and `docs/dataverse-relationship-architecture.md`:

> `job_resource_allocations.vendor_account_id` (`crm-schema/022_jobs_dispatch_assignments.sql:451`) points **straight at `accounts`** instead of at a `subcontractor_assignments` row.

This mixes job-specific terms (scope, rate, dates) into the vendor's general standing record and loses assignment history when the vendor profile changes. Repoint it at Layer 3.

**Then add the Layer 2 check at dispatch time:** when a vendor is allocated to a job, validate that they are approved for *that job's customer account*. That validation is the entire payoff of Layer 2 — without it, the approval list is decoration.

### 6. Vendor Compliance uses placeholder names instead of real employees

> *"Vendor approval uses Maya chen, Luis Romero, and Priya Patel instead of actual employees. This is still a divide between users/employees and their roles, job descriptions."*

Same class of bug as the Account/Contact owner-field problems in Phases 03/05/06 — a hardcoded or demo-identity value standing in for a real employee reference. Trace wherever Vendor Compliance approval is attributed and wire it to the real `employees` roster, the same pattern used everywhere else roles have been fixed.

### 7. Rate card structure and origin

> *"On Vendor compliance it asks for rate card and lists 2026 standard environmental services, we need to figure out where/how we want this created. I think it should be tied to items able to be listed on estimates and quote forms."*

**Do not solve this independently of Phase 08 (Quotes & Estimates).** The owner's own instinct is correct — this rate card should be the same underlying rate/price data quote line items pull from (`priceLevels`/`products`), not a separately typed value. Phase 08's item 2 covers this from the quoting side; this item is the vendor-compliance-side half of the same fix.

### 8. W-9 upload + review workflow

> *"On Vendor compliance W-9 should ask for a copy to be uploaded, then it messages the office admin for review and approval before marking it as 'approved'. The other options should be 'Missing', 'Under Review', 'Approved', 'Expired', and 'Needs Attention'."*

Needs: file upload (depends on Phase 11), a notification to office admin on submission (no notification infrastructure exists yet per `docs/roadmap/phase-14-field-ops-depth.md`'s "Approvals & notifications" gap — decide whether to build a minimal one-off notification here or wait), and the five-state status vocabulary replacing whatever exists today.

### 9. Insurance/COI upload + review workflow

> *"On Vendor compliance Insurance should ask for a copy of their COI be uploaded and then request review and approval on it before it marks the status as valid. The other drop down options should be 'Valid' 'Under Review' 'Expired', 'Expiring', 'Waived'"*

Same shape as item 8 — upload, review/approval step, and a five-state vocabulary (`Valid`/`Under Review`/`Expired`/`Expiring`/`Waived`) distinct from W-9's vocabulary. Build the upload+review pattern once and reuse it for both items 8 and 9 rather than two parallel implementations.

### 10. Performance rating should be a real A–F dropdown

> *"On Vendor compliance We need to fix performance rating so that is says (+A – F) as a drop down."*

Small, concrete — whatever performance rating field exists today, replace with a proper letter-grade dropdown (confirm exact grade set wanted: straight A–F, or with +/– modifiers as the note's "(+A – F)" notation suggests).

### 11. Auto-generated Vendor ID

> *"On Vendor compliance we need to autogenerate an account Vendor ID or have someway it is created… maybe an auto assigned vendor ID? Not sure what best practices are for this."*

The owner is explicitly unsure of the right convention here — this needs a short decision (sequential number, prefix + sequence like other ID schemes already in this codebase, e.g. `INV-###`/`PO-###` patterns visible in existing seed data) before implementation, not a guess baked into code.

### 12. Service agreement templates by type, with upload+review for anything custom

> *"On account service agreement we need agreements selected under agreement type to utilize a preexisting form for MSA, standing work order, and or rate agreement. It should also allow for the option to upload a different one that would need to be sent to office admin or someone internally for review and approval."*

For each `agreement type` value (MSA, Standing Work Order, Rate Agreement), offer a pre-built template; also allow uploading a custom document that routes through the same review/approval pattern as items 8/9.

### 13. Service agreement's own rate-card question, and disambiguating who is customer vs. provider

> *"On account service agreement mentions 'Rate Card' again and lists the '2026 standard environmental services' this may be different if a 'Rate agreement' is selected in agreement type or something else... Under service Agreement there is also Master service agreement – not sent, COI, and W-9. We are listing sent, not sent, and on file. If we are expecting to receive W-9s then that makes sense... If it is for us to receive their stuff, this has some overlap with the vendor tab above. We need to sort out when they are our customer and when we are their service provider. Then the off case where we are both each others customer and service provider. This is just a bit confusing currently so we need to flush it out with good detail."*

This is a genuine conceptual ambiguity, not a bug — **resolve the model before touching the UI.** The account relationship fields already support an account being client and vendor simultaneously (migration 026, referenced in this doc's own "Why this phase exists" section), but the *documents* panel doesn't yet distinguish "documents we send them" (their MSA, our W-9 if we're their subcontractor) from "documents we collect from them" (their W-9/COI, because they're our vendor) from "documents both directions apply" (mutual MSA/service agreement). Write out the three-way matrix (we're their customer / we're their vendor / both) explicitly before building the service-agreement panel, so it doesn't inherit the same confusion the note is describing.

### 14. Subcontractor assignment's rate fields don't make sense together

> *"The subcontractor assignment section doesn't make since since it asks for a rate card, rate amount and rate type (hourly, unit based, etc.) these seem contradictory."*

A rate card (a whole schedule of rates) and a single rate amount + rate type (one specific number) are different levels of specificity being asked for in the same form — likely one should derive from the other (pick a rate card, then it populates or constrains the rate amount/type) rather than being three independent, contradictory inputs. Fix once the rate-card foundation from item 7/Phase 08 exists.

---

## Out of scope

- Real document storage for certificates and approval letters. Phase 11 — capture metadata and file references now, wire real uploads later.
- Automated insurance-certificate expiry *notifications*. Surface expiry in the UI here; notification infrastructure is Stage E.
- Vendor bills, payments, and AP. Accounting is Phase 14.
- Building the underlying quote/rate-card line-item system — Phase 08. Items 7 and 13 here only consume it.

---

## Data model changes

**New:** `account_approved_subcontractors`
**Newly used:** `subcontractorAssignments` (0 rows today) gets its first real UI
**Changed:** `job_resource_allocations.vendor_account_id` → subcontractor-assignment reference

Update `docs/database-handoff-map.md` (Priority 1 item 4 partially closes) and `docs/dataverse-relationship-architecture.md` ("Still Needed" list).

---

## Verification / done criteria

- [ ] Vendor & Subcontractor tab appears after Account Health
- [ ] Company Profile no longer mentions subcontractor compliance
- [ ] Mark a vendor account compliant with a W-9 and insurance expiry; status reflects it
- [ ] Approve that vendor as a subcontractor **for one specific customer account**
- [ ] The same vendor shows as *not* approved for a different customer
- [ ] Set a customer approval to expire yesterday → it surfaces as expired
- [ ] Allocate a subcontractor to a job and see the approval check fire for that job's customer
- [ ] An account that is both a client and a vendor shows both sections correctly
- [ ] Vendor Compliance approvals attribute to a real employee, not a placeholder name
- [ ] Uploading a W-9 or COI triggers a review step before the status can reach Approved/Valid
- [ ] Performance rating renders as a real letter-grade dropdown
- [ ] A new vendor account gets an auto-generated Vendor ID with no manual entry
- [ ] Selecting an agreement type (MSA / Standing Work Order / Rate Agreement) offers its matching template
- [ ] The three-way client/vendor/both document matrix (item 13) is written down and the service-agreement panel matches it

---

## Open decisions

- **Does an expired customer approval block dispatch, or just warn?** Recommendation: warn loudly, allow override with a reason and an audit event — matching the existing dispatcher-override pattern in `docs/erp-operational-architecture.md`.
- **Is customer approval per-scope or blanket?** The `approved_scope` column assumes per-scope; confirm whether that granularity is real or whether a blanket approval is enough.
- **Who maintains the approved list** — sales, ops, or compliance? Affects which role can write to it in Phase 10.
- **Vendor ID convention** — sequential, prefixed (matching the existing `INV-###`/`PO-###`-style patterns), or something else? (item 11)
- **Performance rating scale** — straight A–F, or with +/– modifiers? (item 10)
- **Notification on W-9/COI submission** — build a minimal one-off notification now, or wait for Phase 14's "Approvals & notifications" gap to close? (items 8, 9)

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*
