# Phase 03 — Account Domain Correctness

**Status:** 🟢 **Nearly complete, 2026-09-16 session.** Items 1, 2, 3, 4, 5, 8, 9, and 10 done and click-tested live. Only two items remain, and both are genuinely blocked on the owner, not on more engineering time: item 6 (list filter cleanup — likely already done via the pre-existing shared `renderCompactSearch`/`renderCompactSelect` components, but "buttons" vs. dropdowns is ambiguous, see item 6's note) and item 7 ("remove the Account Table" — no such UI element found, needs the owner to clarify what it refers to). See "Corrections found during implementation" before resuming — do not re-plan what's already done.
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
| `owner` free-text input | > *"Owner is a type in box and not locked to sales persons"* — **and it's worse than it looks.** Verified 2026-09-15: `saveAccountOwner()` resolves the picked employee to a display string and writes only `owner: "Priya Patel"`. It never writes an `ownerEmployeeId` FK. So even where the UI is already a picker, storage is still free text, and reassigning an employee leaves stale names on every account they owned. **🟡 Partially fixed 2026-09-16:** the Create Account form's Owner field is now a picker (`populateEmployeeSelect`), matching the pattern already used by the Owner & Primary Contact dialog and Contact Role dialog — free text is gone. But it still isn't "locked to sales persons": the picker lists the *entire* `employees` roster (dispatchers, field techs, samplers included), not a sales-role filter, and it still resolves to a display-string write, not an `ownerEmployeeId` FK. Both remain open for this phase. |
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

**✅ Done 2026-09-16.** `siteName`, `city`, `state`, `phase`, and `risk` removed from `index.html`'s `#accountDialog`; `saveAccount` (`app.js`) no longer reads or writes them for new accounts (existing accounts keep their stored values via `buildCoreAccountRecord`'s fallback defaults — columns aren't dropped, just stopped-writing, matching the "Data model changes" section below). Added an `industryId` single-select (writes the account's primary `accountIndustries` row on save) and an inline "Primary address (optional)" fieldset (street/city/state/postal/country) that writes a real `addresses` row with `addressType: "Primary"`, `isPrimary: true` — not a facility. The old side effect that auto-created a bare `facilities` record on every new account was removed entirely; facility creation is now only ever the deliberate "Add" button on the Locations & Addresses tab, confirmed via Playwright that a fresh account shows "No facilities for this account yet."

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

**✅ Done 2026-09-16 — full audit complete across all three pages, most panels clean, three real findings, two fixed.** Traced every panel on Account detail (29 panels, 8 tabs), Contact detail (23 panels, 7 tabs), and Opportunity detail (20 panels, 5 tabs) — full table below. Verdict by page:

- **Account detail: essentially clean.** Only one soft finding: "Business description" and "How we work with them" (General tab) are two separately-headed panels that both open the *same* `#relationshipNotesDialog`, which contains both fields — clicking either panel's Edit shows the other panel's field too. Not data-destructive (both fields always save correctly), just a UI surprise. **Not fixed this session** — recommend merging the two panels into one "Relationship notes" panel next time someone's in this file, since they already share state/action/dialog; low priority.
- **Contact detail: one real bug, fixed.** The page-header "Edit contact" dialog (`#contactDialog`, opened from every tab) wrote its "Relationship" dropdown value into `contact.accountRole` in addition to `contact.influence`/`relationshipRole` — silently overwriting the Details tab's "Role and account" panel's Account role field (a *different* vocabulary: Employee/Owner/Executive/Manager/Consultant/Other vs. Decision maker/Champion/etc.) any time someone saved the header dialog for any reason. **Fixed:** removed the `accountRole:` line from `saveContact` (`app.js`, `saveContact` function) — that field is now exclusively owned by `saveContactRole`/the Role-and-account dialog, as intended. Verified live: saving "Edit contact" no longer changes Account role.
- **Opportunity detail: one real bug fixed, two structural gaps recorded (not fixed, likely Phase 06 territory).**
  - **Fixed:** `saveOpportunityQuote` unconditionally reassigned the opportunity's "Current" quote (`quoteId`) on every save, including when editing a historical, non-current quote from the Quote panel — so editing an old quote's amount silently made it "Current" again. Fixed by only updating `quoteId` when the quote being saved is brand new (`isNewQuote`), never on an edit of an existing quote. Verified live: added two quotes, edited the non-current one, confirmed "Current" stayed on the other.
  - **Not fixed — recorded for Phase 06.** The core "Opportunity" panel (Summary tab) displays 8 fields (Account, Site/facility, Primary contact, Owner, Deal type, Service type, Industry, Source campaign) but its Edit button opens `#opportunityDialog`, which only actually edits 2 of those (Account, Service type) — the dialog instead carries Value/Close date/Status/Next step, none of which this panel shows. On top of that, **Owner**, **Deal type** (this panel) and **Decision maker**, **Competitor** (the separate "Situation & solution" panel) have **no edit path anywhere in the app** — they're permanently defaulted/computed, not just hard to find. This is real Opportunity-domain modeling work (which fields the core dialog should carry, whether Owner should follow the same `ownerEmployeeId`-FK pattern this phase just built for Accounts), not a quick wiring fix — flagging it into `phase-06-opportunity-domain.md` rather than attempting a redesign here, since Phase 03's own scope note already says "Opportunity pipeline logic... only its edit buttons are in this phase's audit."

Full per-panel results below.

#### Account detail (29 panels)

| Tab | Panel | Displayed fields | Edit/Add action | Opens | Verdict |
|---|---|---|---|---|---|
| Summary | Account information | Phone, Email, Fax, Website, Parent account | none (edited via header "Edit account") | `openAccountDialog` → `#accountDialog` | OK, dialog covers these plus more (industry/owner/address) |
| Summary | Billing address | Street/suite, City/State, Postal, Country | `open-address` | `openAddressDialog` → `#addressDialog` | OK, populates correctly |
| Summary | Cases | severity, type, status, job, description | none (read-only) | — | OK |
| Summary | Open tasks | title, account, due, priority, owner, type | "Complete" only | — | OK |
| Summary | Sales tasks | subject, due, contact, description, priority, status | Add (header) / row-click (edit) | `openSalesTaskDialog` → `#salesTaskDialog` | OK, populates correctly |
| Summary | Timeline | type, status, date, subject, body, links | Add-only picker (Meeting/Call/Email/Task/Note) | various activity dialogs | OK by design, no edit of past items |
| Summary | Owner & primary contact | Owner, Primary contact | `open-account-owner` | `openAccountOwnerDialog` → `#accountOwnerDialog` | Exact match, populates correctly |
| Summary | Industry | industry chips + primary flag | `open-industries` | `openIndustriesDialog` → `#industriesDialog` | Exact match, populates correctly (pre-existing, see item 3 correction above) |
| Summary | Contacts | name, title, preferred contact, influence | Add (header) / Edit (row) | `openContactDialog` → `#contactDialog` | OK, row edit populates correctly |
| Details | Company profile | Industry (own inline edit), SIC code, Ownership, subcontractor flags | `open-company-profile` | `openCompanyProfileDialog` → `#companyProfileDialog` | OK — industry intentionally excluded, has its own button |
| Details | Vendor compliance | Vendor #, type, onboarding, insurance, W-9, safety | `open-vendor-profile` | `openVendorProfileDialog` → `#vendorProfileDialog` | OK, populates fully (dialog has more fields than the summary card shows — not a bug, just an incomplete summary) |
| Details | Service agreements | agreement list + MSA/COI/W-9 status | Add/edit per row; separate `open-document-status` | `openServiceAgreementDialog`, `openDocumentStatusDialog` | OK — one panel houses two edit surfaces, both wired correctly |
| Details | Subcontractor assignments | assignment list | Add (if vendor profile exists) / edit per row | `openSubcontractorAssignmentDialog` | OK, populates correctly |
| Details | Contact & marketing preferences | preferred method, allow flags (email/phone/fax/mail/marketing/bulk) | `open-contact-preferences` | `openContactPreferencesDialog` | Exact match, populates correctly |
| Details | Billing | Currency, Credit hold, Billing type, Billing interval | `open-account-billing` | `openAccountBillingDialog` | Exact match |
| Details | AP / accounting | AP portal, AP email, AP contact, PO required, PO format | `open-account-ap` | `openAccountApDialog` | Exact match |
| General | Business description | businessDescription | `open-relationship-notes` | `openRelationshipNotesDialog` → `#relationshipNotesDialog` | **Shares dialog with "How we work with them" — see finding above** |
| General | Relationship snapshot | Type, status, primary role, customer status, flags | `open-relationship-snapshot` | `openRelationshipSnapshotDialog` | OK, `isClient`/eligibility correctly shown as computed, not editable |
| General | How we work with them | workingRelationshipNotes | `open-relationship-notes` (same as above) | same dialog | **Same finding** |
| General | Company structure | division cards + division-assign selects | "Add division" only | `openAccountDivisionDialog` | Add-only by design (no Edit for existing division, only Add/Remove) — feature gap, not a bug |
| Projects | 6 list panels (opportunities/projects/dispatch, active+closed) | mini cards | none — "See all" nav only | — | OK, no edit dialogs on this tab |
| Lab Work | 3 list panels | session/sample cards | none, links to Sample detail | — | OK, out of this audit's scope |
| Files | 3 placeholder panels | static text | none | — | OK, genuinely unbuilt |
| Locations & Addresses | Facilities | name, address, concern, access, category, badge, contacts | Add (header) / Edit (card) | `openFacilityDialog` → `#accountFacilityDialog` | OK, populates correctly |
| Locations & Addresses | Addresses | name/type, primary flag, street, city/state/postal | Add (header) / Edit (card) | `openAddressDialog` | OK, card shows a subset of the full form — not a bug |
| Locations & Addresses | Locations (GPS) | label, type, lat/long, status, temporary+retention | Edit (card only) | `openLocationDialog` → `#mapLocationDialog` | OK, populates correctly — confirmed this really is the GPS-point concept, not facilities (glossary naming hazard correctly avoided) |
| Account Health | Issues | severity, type, status, description | none (read-only) | — | OK |
| Account Health | Concern comments | author, date, body | Add (header) / Remove only | `openAccountCommentDialog` | OK, no edit path by design (Add/Remove only) |
| Account Health | Account status | status, paused by/reason/since, scope+notify flags | `open-account-pause` | `openAccountPauseDialog` | Exact match, populates correctly |

#### Contact detail (23 panels)

| Tab | Panel | Displayed fields | Edit/Add action | Opens | Verdict |
|---|---|---|---|---|---|
| Summary | Contact information | Email, business/mobile phone, Account link | none (read-only) | — | OK |
| Summary | Open tasks | title, due, priority, owner, type | "Complete" only | — | OK |
| Summary | Sales tasks | subject, due, contact, description, priority | Add (header) / row-click (edit) | `openSalesTaskDialog` | OK, populates correctly |
| Summary | Linked opportunities | opportunity cards | none (read-only) | — | OK |
| Summary | Recent activity | timeline preview | jumps to Communications tab | — | OK, navigation only |
| Details | Contact info | First/last name, job title, email(s), phones, fax | `open-contact-info` | `openContactInfoDialog` → `#contactInfoDialog` | OK, populates correctly |
| Details | Personal | Birthday, Notes | `open-contact-personal` | `openContactPersonalDialog` | Exact match |
| Details | Communication preferences | preferred method, allow flags | `open-contact-comm-prefs` | `openContactCommPrefsDialog` | Exact match |
| Details | Employment history | employer/title/dates list | Add (header) / Edit (row) | `openContactEmploymentDialog` | OK, correctly branches Add-blank vs. Edit-populated |
| Details | Role and account | Account role, Relationship role, Lifecycle, Lead status, Owner, Division | `open-contact-role` | `openContactRoleDialog` → `#contactRoleDialog` | Exact match — **but see the fixed cross-dialog bug above: the page header's "Edit contact" button used to corrupt this panel's Account role field** |
| Details | Address one | street/city/state/zip/country/phone | `open-contact-address-one` | `openContactAddressOneDialog` | OK, populates correctly |
| Details | Address two | street/city/state/zip/country/fax | `open-contact-address-two` | `openContactAddressTwoDialog` | OK, populates correctly |
| Details | System info | Contact ID, source, created/modified, activity counts | none (read-only, computed) | — | OK |
| Communications | Timeline | activity feed | Add-only picker (Meeting/Call/Email/Task/Note) | various activity dialogs | OK by design, consistent with Account timeline |
| Opportunities | Active/Won/Lost opportunities | opportunity cards | none (read-only) | — | OK |
| Projects | Active/Closed projects, Scheduled work | project/work cards | none (read-only) | — | OK |
| Relationships | Coworkers, Facilities, Connections | cards | none (read-only) | — | OK |
| Files | 3 placeholder panels | static text | none | — | OK, genuinely unbuilt |

#### Opportunity detail (20 panels)

| Tab | Panel | Displayed fields | Edit/Add action | Opens | Verdict |
|---|---|---|---|---|---|
| Summary | Opportunity | Account, Site/facility, Primary contact, Owner, Deal type, Service type, Industry, Source campaign | `open-opportunity` | `openOpportunityDialog` → `#opportunityDialog` | **MISMATCH — see finding above, recorded for Phase 06** |
| Summary | Situation & solution | Current situation, Customer need, Proposed solution, Next step, Decision maker, Competitor | none (no button) | — | **Decision maker/Competitor are dead fields — see finding above** |
| Summary | Description | Description | none (editable via Lead details dialog on another tab) | — | OK by design |
| Summary | Pipeline | Stage, Status, Probability, Forecast, Priority, Rating, Time in stage | none | — | Probability/Forecast/Priority/Rating/Time-in-stage have no edit path anywhere — appear intentionally computed, but nothing in the UI marks them as locked |
| Summary | Value | Amount, Estimated value, Weighted amount, Total contract value, Budget, Not-to-exceed, Currency | none | — | Amount/Budget editable elsewhere (core dialog / Qualify dialog); Estimated value/Weighted/TCV/Not-to-exceed/Currency have no edit path anywhere |
| Summary | Dates & source | Est./actual close, Purchase timeframe, Last contacted, Next activity, Created, Source | none | — | Est. close/Purchase timeframe editable elsewhere; rest are computed (expected) |
| Summary | Timeline | activity feed | Add-only picker | various activity dialogs | OK, consistent with Account/Contact timelines |
| Summary | Associated contacts | linked contact mini cards | none (managed via Stakeholders tab) | — | OK |
| Summary | Open tasks | up to 4 account tasks | none | — | OK |
| Summary | Team | name, type, role, purpose, status | Add / edit per row | `openOpportunityAssignmentDialog` | OK, populates correctly |
| Lead & Qualification | Lead details | Contact, Facility, Industry, Contamination, Originating lead, Source campaign, Description, Situation | `open-opportunity-lead` | `openOpportunityLeadDialog` | Exact match, populates correctly |
| Lead & Qualification | Qualification | Purchase timeframe, Budget, Purchase process, Decision maker found, Capture summary | `open-opportunity-qualify` | `openOpportunityQualifyDialog` | Exact match, populates correctly |
| Develop & Planning | Develop details | Customer need, Proposed solution, Site walk | `open-opportunity-develop` | `openOpportunityDevelopDialog` | Exact match |
| Develop & Planning | Stakeholders | contact, role, influence, primary flag | Add / edit per row | `openOpportunityStakeholderDialog` | OK, populates correctly |
| Develop & Planning | Competitors | name, note | Add / edit per row | `openOpportunityCompetitorDialog` | OK, populates correctly |
| Develop & Planning | Resource needs | Equipment/Vendor/Resource chip lists | Edit per list (3 buttons) | `openOpportunityNeedsListDialog` | OK, populates correctly |
| Proposal & Documents | Proposal status | 3 status fields | `open-opportunity-proposal` | `openOpportunityProposalDialog` | Exact match |
| Proposal & Documents | Quote | name, amount, status, "Current" tag | Add / edit per row | `openOpportunityQuoteDialog` | **Fixed this session — see finding above (editing a historical quote used to silently reassign "Current")** |
| Proposal & Documents | Negotiation sign-off | 3 status fields | `open-opportunity-negotiation` | `openOpportunityNegotiationDialog` | Exact match |
| Files & Activity | Activity timeline, Tasks, Files | feed / list / placeholder | Add-only picker / none / none | various | OK, files genuinely unbuilt |

### 3. Real industry selection

> *"Industry selection seems random, we should tie it to some established industry list that might be valuable later on."*
> *"company profile edit button doesn't let you set industry"*

**The list already exists and is good.** `crm-schema/026` seeds 8 environmental-services-relevant industries: Oil & Gas, Agriculture, Wastewater, Manufacturing, Municipal / Government, Healthcare, Construction, Transportation / Logistics. The backend has `industries` (8 rows) and `accountIndustries` (7 rows).

The problem is purely that **the Company Profile edit dialog doesn't expose it.**

- Wire the picker into Company Profile edit
- An account can hold **more than one** industry — `accountIndustries` is deliberately many-to-many
- Free-text `accounts.industry` becomes display-only, then deprecated
- **Open question:** extend the curated 8, or map to NAICS codes for long-term reporting value? The owner flagged "valuable later on," which argues for NAICS-backed codes.

**✅ Done 2026-09-16 — with a correction to this doc's own earlier claim.** This doc (and the research done to write the fix) initially claimed the `#industriesDialog`/`openIndustriesDialog`/`saveAccountIndustries` UI was **entirely unreachable** — that check only grepped `index.html` for `data-action="open-industries"` and found nothing, missing that the Account **Summary** tab already renders its own "Industry" panel with a working `open-industries` button dynamically from `app.js` (confirmed via `git log -S` that this button has existed since the very first commit, 2026-09-15 — it is not something this session introduced). So industry editing was never fully unreachable; it just wasn't reachable from **Company Profile specifically**, which is the literal complaint in the second quote above. The fix applied is still correct and still needed: added a "Set"/"Edit" button next to the Industry row in the Company Profile panel (`renderAccountDetailsTab`, Details tab) that opens the same dialog — industry is now editable from both the Summary tab's Industry panel and Company Profile, which is harmless duplication, not a conflict (both write to the same `accountIndustries` rows). Confirmed live: setting two industries and a primary both persist and redisplay from either entry point. **Still open:** the NAICS-vs-curated-8 question is unresolved (out of scope for a UI wiring fix); `accounts.industry` free text still exists on the record but neither UI location reads it now, only `accountIndustries`. **Lesson for next time:** when a claim is "X is unreachable in the UI," grep `app.js`'s rendered template strings too, not just `index.html` — most interactive elements on detail pages are generated dynamically, not static markup.

### 4. Per-workspace header title

> *"When you go into Sales Applet the title at the header still says Operations platform instead of 'Sales Dashboard'."*

`index.html:29` hardcodes `<h1>Operations Platform</h1>`. The app has nine workspaces; the header should name the one you're in — Sales, Operations, Dispatch, Workforce, Inventory, Office, Finance, Client Portal, Front Line. Drive it from the existing workspace registry (`app.js:244`ff) via `getCurrentWorkspaceId()`.

**✅ Done 2026-09-16.** `renderHeaderTitle()` sets `#appHeaderTitle` from `findWorkspace(getCurrentWorkspaceId())?.label` (with the " View" suffix stripped, e.g. "Sales View" → "Sales"), called alongside `renderNav()`/`renderQuickActions()` on every render. Falls back to "Operations Platform" only on the home screen.

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

**✅ Done 2026-09-16.** The Sales-workspace row shipped earlier in the day (ad hoc). Later the same day, `renderQuickActions()` gained two more branches ahead of the generic Sales-workspace one: `state.view === "account-detail"` renders Contact / Opportunity / Facility / Address / Location / Activity (Location opens the GPS point dialog unscoped — it isn't tied to a project by default, matching the dialog's existing standalone behavior), and `state.view === "contact-detail"` renders Opportunity / Activity, both pre-populating `data-account-id`/`data-contact-id` from `state.selectedAccountId`/`state.selectedContactId`. Confirmed live via Playwright on both a fresh and an existing account, and on a contact detail page. The old page-specific "New opportunity" button on account-detail (`app.js:4702`ish) was left in place — it's redundant with the new menu's Opportunity item but removing it wasn't in scope for this pass; worth a follow-up cleanup pass.

### 6. List-view search/filter cleanup (Accounts)

> *"Make the sales account view list have buttons that can filter, or search accounts. This is inplace of the 'Search Accounts or sites' 'all industries filters' and 'different views'"*

Replace the current ad hoc controls with consistent filter/search buttons. Build this once and share it with Phase 05 (Contacts) and Phase 06 (Opportunities) — the notes explicitly ask for the same treatment on all three ("Do these same cleanup steps on contacts and opportunities").

**🟡 Investigated 2026-09-16 — likely already substantially done, one open question before closing it out.** Traced the actual code before planning further work: `renderAccounts()`, `renderContacts()`, and `renderPipeline()` (`app.js`) all already share one component pair — `renderCompactSearch()` (icon + text input) and `renderCompactSelect()` (icon + dropdown, highlights when a filter is active) — for search, the industry/view filters, and the view switcher, consistently across all three list pages. This is almost certainly the result of the "Cleanup roadmap, Rounds 1-4" work (shipped and verified 2026-08-17, see roadmap `README.md`), done before this phase doc existed. **Open question, not resolved this session:** the 2026-09-15 quote literally names "Search Accounts or sites" and "all industries filters" as the controls to *replace*, but the compact redesign still uses a search box + dropdowns (just restyled with icons) — it never became literal filter *buttons*/chips. It's unclear whether the compact redesign already satisfies the ask, or whether "buttons" meant something more specific (e.g., quick-filter chips like "Needs action" instead of a dropdown). Confirm with the owner which is wanted before spending more time here — building a speculative chip-based redesign without that answer risks the same "wrong until verified" trap the roadmap already flagged once for this file.

### 7. "Remove the Account Table" — unresolved, needs clarification

> *"remove the 'Account Table' one core account record shared by sales, operations…"*

**Investigated 2026-09-16, not found as a literal UI element.** No heading, panel, or dialog anywhere in the app is labeled "Account Table." The only matches for the phrase are a subtitle string under the Accounts page heading ("Role-specific account views built from the shared Account table," `app.js:4489`) and an invisible aria-label on a view-switcher dropdown (`app.js:4514-4517`). Both read like descriptive copy about the architecture (one shared account record across workspaces), not a UI element meant to be deleted. **Do not implement a removal for this until it's clarified what it refers to** — possible readings: (a) it's praise/reference to the architecture, not an action item, (b) it refers to the account list/table *view itself* in a way not yet understood, (c) it's about the view-switcher dropdown item 6 is already replacing. Confirm with the owner before writing any code against this line.

### 8. Facility detail page

> *"Facilities should be clickable and go to a facility specific page that lists location, contacts, photos from site, any previous work done at site, notes for site, and satellite map view of site."*

New page, reachable by clicking a facility card (today facility cards in the Locations & Addresses tab render but don't navigate anywhere). Sections: location detail, contacts (see item 9), site photos (depends on Phase 11 — Document Storage — for real uploads), prior work history (query projects/dispatch jobs against this facility once Phase 02's `facilityId` FK makes that traceable), site notes, and a satellite map view (the app already has Leaflet wired in for other map views — reuse that, don't add a second mapping library).

**✅ Done 2026-09-16.** New `facility-detail` view (`renderFacilityDetail()` in `app.js`), reached via `view-facility` action — facility cards now have a clickable name and an "Open" button. Registered in `viewWorkspace`, `isActiveModule` (highlights "Accounts" in nav), and `ROUTE_ID_FIELDS` (so the back button and hash routing work). Six panels: Location (full address/phone/access/concern), Contacts (same add/edit/remove as item 9, scoped to just this facility), Site notes (new — see below), Satellite view, Prior work at this site, Site photos (stub).

Two corrections worth recording:
- **"Prior work history" and "site coordinates" needed real joins, not new fields.** `projects.facilityId` already exists and is live (not dead) — `projectsForFacility()` reuses the existing `renderOpsProjectMiniCard`. For the map, facilities do **not** carry their own latitude/longitude — that was a deliberate Phase 02 decision (`docs/roadmap/phase-02-places-model.md`: "Latitude/longitude were removed from this dialog — they belonged to the GPS concept, not the facility concept"). Re-adding them would have undone that decision. Instead, the map plots the `locations` (GPS points) collection for any project tied to this facility, via `locationsForFacility()` — the same indirect-join pattern `locationsForAccount()` already used. If a facility has no project history yet, the map correctly shows an empty state rather than a stray pin.
- **"Site notes" got a small new collection, not a repurposed field.** The facility record already has `concern`/`access` text fields, but those are single overwritable values, not a growing log. Added `facilityComments` (mirrors the existing `accountComments` pattern exactly — same shape, same soft-delete via `deletedAt`) rather than force-fitting notes into `concern`. Registered in `server.mjs`'s `collectionAccess`/`defaultBackend`/bootstrap-hydration map (role: `sales`, same as `accountComments`).
- **Map tiles are genuinely satellite imagery, not what the rest of the app uses.** The existing Leaflet maps elsewhere (project samples, operations map) use plain OpenStreetMap street tiles, not satellite — despite one of them being informally called a "map view." Since the roadmap explicitly asked for a *satellite* view here, this one uses Esri World Imagery tiles instead, to actually match the request. Worth knowing if a future session assumes all the app's maps look the same.

Verified live via Playwright on two facilities (one with no linked projects/notes, one with existing project history): navigation, add/remove site note, and the map's empty-state vs. populated-marker paths all work; no console errors.

### 9. Facility-contact editing gaps

> *"On an account for facilities there is no way to edit contacts listed for each facility. There is also no clear explanation for what primary contact checkbox does."*

Phase 02 shipped adding a contact to a facility (`facilityContacts` junction + "Add contact" button) but not editing or removing an existing link. Add both, and add explanatory text (a tooltip or inline caption) for what `isPrimary` actually controls — right now it's a bare, unlabeled checkbox.

**✅ Done 2026-09-16.** `openFacilityContactDialog` now takes an optional `linkId` and pre-fills contact/relationship/primary for editing; `renderFacilityCard` gives each linked contact its own Edit/Remove buttons (Remove soft-deletes via `deletedAt`) plus a "★ Primary" badge with a title tooltip; the dialog itself gained a help-text caption explaining what the primary checkbox controls. **Found and fixed a real, previously-invisible server bug while testing this:** `server.mjs`'s `normalizeRecord` had a hand-written field whitelist for `facilityContacts` that never included `deletedAt`, so every save — including the new soft-delete — silently stripped it back out server-side. Any future "remove" UI built on this collection before today would have looked like it worked (toast fired, client-side filter hid it briefly) but the row would reappear on next refresh. Fixed by adding `deletedAt: payload.deletedAt || ""` to that branch; confirmed via Playwright that add → edit → remove now actually persists across a refetch.

### 10. Account "Contacts" page / real company-structure hierarchy

> *"Account pages need a 'contacts' page that lists all contacts in the org, this might be the company structure section that is supposed to be a hierarchy tree, but for right now is just a boxed style display."*

Confirm during implementation whether an existing "company structure" panel is meant to become this (per the note, it currently renders as a plain box, not a hierarchy tree) or whether this is a new tab entirely. Either way: a full list of every contact at the account's organization, and if a real reporting-structure hierarchy is wanted, that's a materially bigger build than a flat list — scope which one is actually needed before starting.

**✅ Done 2026-09-16 — scoped to the flat-list reading.** Confirmed "Company structure" (General tab) is genuinely just division-grouped boxes with no manager/reports-to relationship, no nesting — the note's "boxed style display" complaint is accurate. Building a real hierarchy tree would need a new reporting-line data model (materially bigger, per the doc's own caution) with no concrete ask for it beyond this one line, so left "Company structure" untouched and did not attempt a tree. Instead: a full flat contact list *did* already exist in code (`renderMiniContact` list in the Details tab, tucked under "Contacts" next to Company Profile/Vendor Compliance — unrelated neighbors, easy to miss, likely why the user thought it was missing) — promoted it into its own top-level "Contacts" tab (`renderAccountContactsTab`, new tab in `accountDetailTabs`) instead of duplicating it, enriched each row with email/phone/linked-opportunity-count (the Details-tab version only showed title + preferred-contact-method). Removed the old panel from Details tab. Verified live: new tab shows all contacts with working Edit/Add, Details and Summary tabs unaffected.

---

## Out of scope

- Contact-side fixes — Phase 05
- Vendor/subcontractor panels — Phase 04
- Opportunity pipeline logic. The stage-gate system works (verified 2026-08-17); only its *edit buttons* are in this phase's audit.
- Opportunity-specific items from the 2026-09-16 notes pass — Phase 06

---

## Data model changes

- ✅ `accounts.phase` and `accounts.risk` retired from the creation path (2026-09-16 — columns kept, both still readable on existing accounts; `saveAccount` just stops writing them for new accounts)
- ✅ `accounts.industry` free text deprecated in favor of `accountIndustries` (2026-09-16 — UI never reads/writes the free-text field now; column untouched on the record)
- ✅ `accounts.owner` free text → `ownerEmployeeId` (2026-09-16 — `saveAccount`/`saveAccountOwner` now write both; two new employee seed rows (`emp-maya`, `emp-luis`) were required to make the sales-role filter meaningful — see corrections)
- Possible: extend `industries` with NAICS codes — still open

---

## Verification / done criteria

- [x] Create an account with **only** a name, type, industry, owner, and address — no facility required (2026-09-16, verified live via Playwright — "No facilities for this account yet.")
- [x] Owner field will not accept free text, and only real *salespeople* appear (2026-09-16) — filtered to employees whose `jobTitle` is in `SALES_OWNER_JOB_TITLES` (`Sales Manager`, `Account Manager`); see corrections below for why two employee seed rows had to be added for this to show real options
- [x] No `phase` or `risk` field anywhere on the creation form (2026-09-16)
- [x] Set two industries on one account; both persist and display (2026-09-16, verified via the now-reachable Industries dialog)
- [x] Industry is settable from Company Profile edit (2026-09-16 — via a new "Set"/"Edit" button that opens the pre-existing, previously-unreachable Industries dialog)
- [x] Header reads "Sales" in Sales and "Dispatch" in Dispatch (2026-09-16, verified live via Playwright)
- [x] Create dropdown appears in the Sales workspace with the correct menu (2026-09-16) — [x] now also on Account detail (Contact/Opportunity/Facility/Address/Location/Activity) and Contact detail (Opportunity/Activity), verified live
- [x] The edit-button audit table below is filled in (2026-09-16) — 72 panels across all 3 pages; two real bugs found and fixed (Contact `accountRole` corruption, Opportunity quote "Current" reassignment), two structural gaps recorded for follow-up (not every row is a clean pass, but every row was checked)

---

## Edit button audit results

**✅ Filled in 2026-09-16 — see the full per-panel tables under item 2 above** (Account detail, Contact detail, Opportunity detail — 72 panels total). Billing Address (Phase 02's Add-disguised-as-Edit bug, listed below as the original seed for this table) was already fixed in Phase 02. Company Profile's missing Industry field was fixed this session (item 3). Two new bugs found and fixed this session (Contact `accountRole` corruption, Opportunity quote "Current" reassignment); two structural gaps recorded but not fixed (Account's shared relationship-notes dialog — low priority; Opportunity core dialog's field mismatch plus dead Owner/Deal type/Decision maker/Competitor fields — flagged for Phase 06).

---

## Open decisions

- **Industry list:** keep the curated 8, extend it, or back it with NAICS codes?
- **Account lifecycle status:** does the account need *any* status field after `phase` is removed, or is `customer_status` enough?
- **Where does risk live?** Recommendation: facility/site-level, in Phase 02's facility record — environmental risk is a property of a place, not a company.

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*

- **2026-09-16 — items 4, 5, and part of 1 shipped outside formal phase sequencing.** A QoL-cleanup session (not scoped as "Phase 03 work" at the time) independently built the header fix and the "+ Create" dropdown, and fixed the Create Account Owner field's free-text problem, because a user reported them directly. Discovered afterward that all three were already documented here. Left unfinished, still open for whoever picks this phase up:
  - Owner picker is not filtered to sales roles (shows the entire `employees` table).
  - Owner storage is still display-name-only — no `ownerEmployeeId` FK, so the original Phase 01 correction ("Owner is still free text in storage despite being a picker in the UI") still applies even though free-typing itself is gone.
  - The "+ Create" dropdown only exists in the Sales workspace quick-actions bar. The Account-detail and Contact-detail context-aware menus (Contact/Opportunity/Facility/Address/Location/Activity, and Opportunity/Activity respectively) were never built — those pages still use their own separate buttons.
  - The Create Account form itself was **not** rebuilt — `siteName`, `city`, `phase`, and `risk` are all still present and still required exactly as this doc describes. Only the Owner field within that form changed.
- **2026-09-16 notes pass re-confirms two already-tracked gaps, no new scope:** *"Account creation still lists site names as an option"* re-confirms the `siteName` item above. *"Company profile – industry 'not set' is not editable via the edit button for company profile"* re-confirms item 3 (Real industry selection) exactly as already scoped.
- **2026-09-16 — "filtered to sales roles" required adding seed employees, not just a filter.** Verified before trusting the plan: the `employees` collection has zero rows with a sales-flavored `jobTitle` — every existing employee is a field/ops role (Response Technician, Environmental Sampler, Dispatcher, etc.). Meanwhile most seeded accounts already have `owner: "Maya Chen"` or `owner: "Luis Romero"` as free text, and those two names exist only in the `systemUsers` collection (`title: "Sales Manager"` / `"Account Manager"`), not in `employees` — meaning `openAccountDialog`/`openAccountOwnerDialog`'s existing "match by display name" fallback silently failed for the majority of accounts (the Owner picker would show blank/Unassigned for any Maya- or Luis-owned account, even though the account record itself had a perfectly good owner string). The roadmap's locked decision (`accounts.owner` → `ownerEmployeeId` FK against `employees`) is still right — the fix was adding `emp-maya`/`emp-luis` employee rows (linked to the existing `user-maya`/`user-luis` system users, `dispatchEligible: false`, `frontlineEnabled: false`, since they're sales-only and don't get scheduled for field work) rather than changing the FK target to `systemUsers`. **Flag for whoever builds Phase 10 (Identity):** `systemUsers` is otherwise a nearly-empty, partially-dangling collection today — only 3 rows exist, and most `employees.systemUserId` values (e.g. `user-logan`, `user-trey`) don't resolve to any row in it. Don't assume it's populated.
- **2026-09-16 — found a real server bug via testing, not via the plan.** See item 9 above: `server.mjs`'s `normalizeRecord("facilityContacts", ...)` never round-tripped `deletedAt`, so soft-deletes on that collection silently no-opped. Fixed alongside the edit/remove UI. Worth a quick grep of `normalizeRecord`'s other hand-written per-collection branches for the same class of bug (a field the client sends that the whitelist drops) before building more soft-delete UI on any of them.
- **2026-09-16 — item 2 (edit-button audit) and item 8 (facility detail page) not started.** Item 2 is a genuine systematic audit (every panel × Account/Contact/Opportunity) that deserves its own dedicated session rather than a partial pass bolted onto this one. Item 8 is a full new page (facility detail: location, contacts, photos, work history, notes, map) gated in part on Phase 11 (Document Storage) for real photo uploads — worth scoping as its own session too rather than a rushed stub.
- **2026-09-16 — a Windows/PowerShell encoding trap, for whoever next edits `data/backend.json` directly.** Windows PowerShell 5.1's `Get-Content`/`Set-Content` do not round-trip UTF-8 safely: `Get-Content` without an explicit `-Encoding utf8` on a BOM-less UTF-8 file misreads multibyte characters (em-dashes, etc.) via the system codepage, and `Set-Content -Encoding utf8` then re-encodes the misread text as UTF-8 mojibake (`—` → `â€”`) across the *entire* file, not just the touched region — plus it silently adds a UTF-8 BOM, which `JSON.parse` in Node does **not** strip and will fail on. This actually happened this session (caught immediately via a `git diff` sanity check before anything was committed, reverted with `git checkout`, redone with a pure Node `fs.readFileSync(..., 'utf8')`/`JSON.parse`/`fs.writeFileSync` script instead). **Never use PowerShell `Get-Content`/`Set-Content` on `data/backend.json` — use Node or the Edit tool.**
