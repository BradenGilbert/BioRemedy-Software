# Phase 04 — Vendor & Subcontractor

**Status:** Not started
**Depends on:** Phase 02 (vendor dispatch/billing address types), Phase 03 (account type classification)
**Estimated sessions:** 2

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
| `evidence_file_id` | The customer's approval letter (real storage lands in Phase 07) |
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

---

## Out of scope

- Real document storage for certificates and approval letters. Phase 07 — capture metadata and file references now, wire real uploads later.
- Automated insurance-certificate expiry *notifications*. Surface expiry in the UI here; notification infrastructure is Stage E.
- Vendor bills, payments, and AP. Accounting is Phase 10.

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

---

## Open decisions

- **Does an expired customer approval block dispatch, or just warn?** Recommendation: warn loudly, allow override with a reason and an audit event — matching the existing dispatcher-override pattern in `docs/erp-operational-architecture.md`.
- **Is customer approval per-scope or blanket?** The `approved_scope` column assumes per-scope; confirm whether that granularity is real or whether a blanket approval is enough.
- **Who maintains the approved list** — sales, ops, or compliance? Affects which role can write to it in Phase 06.

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*
