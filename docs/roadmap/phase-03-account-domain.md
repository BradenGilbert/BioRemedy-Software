# Phase 03 — Account Domain Correctness

**Status:** Not started
**Depends on:** Phase 02 (Create Account captures a primary *address*, which requires the address model to be real)
**Estimated sessions:** 2–3

---

## Why this phase exists

This phase is the bulk of the 2026-09-15 feedback list. Every item below is a direct quote or a direct consequence of one.

---

## In scope

### 1. Rebuild the Create Account form

**Decision (locked):** *Identity + a primary address.* Nothing else.

Today's form (`index.html:799`) requires:

| Field | Problem |
|---|---|
| `siteName` **required** | > *"The account creation tab forces the creation of a facility"* — an account is a company; it may not have a known site yet |
| `city` **required** | Same — forced facility data |
| `phase` (Lead / Assessment / Sampling / Proposal / Active) | > *"account phase uses some weird set of phases that don't make sense to the creation of an account"* — these are sales-pipeline values. Pipeline belongs on the Opportunity, not the company record. |
| `owner` free-text input | > *"Owner is a type in box and not locked to sales persons"* |
| `risk` (Low / Medium / High) | > *"there is a risk level for some reason?"* — company-level risk at creation time is meaningless; environmental risk belongs to a **facility or site**, not a corporation |

**New form:**

| Field | Control |
|---|---|
| Account name | text, required |
| Account type | Customer / Prospect / Vendor / Subcontractor (from `accountTypes`, 5 rows exist) |
| Industry | **picker from `industries`** — see item 3 |
| Owner | **employee picker, filtered to sales roles** |
| Phone / Email / Website | text |
| Primary address | inline address capture (an *address*, not a facility) |

Everything removed becomes a deliberate follow-on action from the account page — where it has room to be done properly. `phase` and `risk` are dropped from creation entirely; if an account lifecycle status is wanted, use `customer_status` / `relationship_status` (already on `accounts` per migration 026) rather than reviving `phase`.

### 2. Audit every edit button

> *"Many of the edit buttons on accounts, contacts, and opportunities don't edit the right stuff."*

The Account/Contact/Opportunity redesigns introduced **panel-scoped edit dialogs** — a good pattern, but the wiring drifted. Some buttons open the wrong dialog, some open a dialog missing the panel's fields, and at least one (billing address, Phase 02) is an Add button wearing an Edit label.

This is a **systematic audit**, not a bug hunt. For every panel on all three detail pages:

1. List the fields the panel *displays*
2. Open its Edit button
3. Confirm the dialog edits **exactly** that set — no missing fields, no foreign ones
4. Confirm it loads existing values rather than opening blank

Record the results as a table in this document so the audit is not repeated from scratch next time.

> Follow `feedback_audit_before_deleting_legacy_ui` — cross-check the old panel's data against the new dialog before concluding a field is unnecessary.

### 3. Real industry selection

> *"Industry selection seems random, we should tie it to some established industry list that might be valuable later on."*
> *"company profile edit button doesn't let you set industry"*

**The list already exists and is good.** `crm-schema/026` seeds 8 environmental-services-relevant industries: Oil & Gas, Agriculture, Wastewater, Manufacturing, Municipal / Government, Healthcare, Construction, Transportation / Logistics. The backend has `industries` (8 rows) and `accountIndustries` (7 rows).

The problem is purely that **the Company Profile edit dialog doesn't expose it.**

- Wire the picker into Company Profile edit
- An account can hold **more than one** industry — `accountIndustries` is deliberately many-to-many
- Free-text `accounts.industry` becomes display-only, then deprecated
- **Open question:** extend the curated 8, or map to NAICS codes for long-term reporting value? The owner flagged "valuable later on," which argues for NAICS-backed codes.

### 4. Per-workspace header title

> *"When you go into Sales Applet the title at the header still says Operations platform instead of 'Sales Dashboard'."*

`index.html:29` hardcodes `<h1>Operations Platform</h1>`. The app has nine workspaces; the header should name the one you're in — Sales, Operations, Dispatch, Workforce, Inventory, Office, Finance, Client Portal, Front Line. Drive it from the existing workspace registry (`app.js:244`ff) via `getCurrentWorkspaceId()`.

### 5. The "+ Create" entity dropdown

> *"The 'New opportunity' button should be a 'Create' button and have a drop down for Account, Contact, or Opportunity."*
> *"[on the account view] we should change that new opportunity to something more inclusive, like '+ entity' or '+ more' then it has a drop down for contact, opportunity, facility etc."*

Replace the context-specific primary button with one **Create** control whose menu is context-aware:

| Context | Menu |
|---|---|
| Sales workspace | Account, Contact, Opportunity |
| Account detail | Contact, Opportunity, Facility, Address, Location, Activity |
| Contact detail | Opportunity, Activity |

Built once in `renderQuickActions()` (`app.js:2761`), which already branches on workspace.

---

## Out of scope

- Contact-side fixes — Phase 05
- Vendor/subcontractor panels — Phase 04
- Opportunity pipeline logic. The stage-gate system works (verified 2026-08-17); only its *edit buttons* are in this phase's audit.

---

## Data model changes

- `accounts.phase` and `accounts.risk` retired from the creation path (keep columns until Phase 08; stop writing them)
- `accounts.industry` free text deprecated in favor of `accountIndustries`
- `accounts.owner` free text → `ownerEmployeeId` (follows the pattern already used for `jobs.projectManagerEmployeeId` in Round 2 — write the resolved display string too, for backward-compatible reads)
- Possible: extend `industries` with NAICS codes

---

## Verification / done criteria

- [ ] Create an account with **only** a name, type, industry, owner, and address — no facility required
- [ ] Owner field will not accept free text; only real salespeople appear
- [ ] No `phase` or `risk` field anywhere on the creation form
- [ ] Set two industries on one account; both persist and display
- [ ] Industry is settable from Company Profile edit
- [ ] Header reads "Sales" in Sales and "Dispatch" in Dispatch
- [ ] Create dropdown appears in both the Sales workspace and on an account, with correct menus
- [ ] The edit-button audit table below is filled in, with every row passing

---

## Edit button audit results

*(Fill this in during implementation. One row per panel.)*

| Page | Panel | Edit opens | Fields match panel? | Loads existing values? | Fixed |
|---|---|---|---|---|---|
| Account | Company Profile | | ✗ missing Industry | | |
| Account | Billing Address | Add dialog, not Edit | | ✗ opens blank | Phase 02 |
| Account | … | | | | |
| Contact | … | | | | |
| Opportunity | … | | | | |

---

## Open decisions

- **Industry list:** keep the curated 8, extend it, or back it with NAICS codes?
- **Account lifecycle status:** does the account need *any* status field after `phase` is removed, or is `customer_status` enough?
- **Where does risk live?** Recommendation: facility/site-level, in Phase 02's facility record — environmental risk is a property of a place, not a company.

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*
