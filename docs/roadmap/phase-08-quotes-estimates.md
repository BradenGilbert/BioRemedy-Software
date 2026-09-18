# Phase 08 — Quotes & Estimates

**Status:** 🟢 **Shipped 2026-09-17. Live bug report follow-up shipped 2026-09-17 (second session)** — explicit "Mark current" override, print/export, notes, billing/shipping address, and write-in options. See "Live bug report follow-up" below. Real line-item builder built and reconnected for both Quote and Estimate (now two genuinely separate documents/collections, per owner decision). Rate-card admin screen built (products, units of measure, price levels) and confirmed to be the same data Phase 04's vendor-compliance and service-agreement panels already read via `populatePriceLevelSelect`. Item 3 (project value defaults from quote/estimate) implemented and verified live for all three cases: quote-present, estimate-only, and neither. Item 4 (reusable "+Create" wiring) intentionally skipped — see below. All verified live via Playwright except the Phase 04 vendor-compliance/service-agreement read-path, which was confirmed by code trace (both dialogs already call `populatePriceLevelSelect(dialog, "priceLevelId")` against `state.backend.priceLevels`, the same collection the new admin screen edits) rather than a fresh UI click-through, since Phase 04 built no new UI this session.
**Depends on:** Phase 06 (Proposal & Documents tab already has the stub this phase replaces)
**Note:** this phase builds the rate/pricing foundation — Phase 04's own rate-card items (7, 13, 14) depend on *this* phase, not the other way around. Sequence Phase 08 before those specific Phase 04 items.
**Estimated sessions:** 3–4
**Source:** `bioremedy crm notes 9.16.2026.docx`

> *"This is a major addition to the roadmap and needs to be done correctly as it integrates into almost every other section. We need a create Quote or Estimate button for opportunities. This is an entire section that we need to build out and then plug this ability into opportunities."*

The owner flagged this one explicitly as high-stakes because of how many other phases read from it. Take that seriously — this doc should be revisited and re-verified against the actual final design of Phase 04 (rate cards) before implementation starts, not built in isolation.

---

## Where this actually stands today (verified 2026-09-16, not assumed)

This is **not** a zero-UI, schema-only module — there's a real but minimal stub already wired into the Opportunity → Proposal & Documents tab:

- `renderOpportunityProposalDocumentsTab()` (`app.js:3684-3730`) has a "Quote" panel with an "Add quote" button (`data-action="open-opportunity-quote"`)
- `openOpportunityQuoteDialog()` / `saveOpportunityQuote()` (`app.js:14980-15025`) — a dialog that captures **name, one lump-sum `totalAmount`, status, and effective date range.** No line items.
- The backend already has the collections this needs: `quotes` (1 seed row), `quoteLines` (1 seed row, but **zero UI reads or writes it anywhere in `app.js`** — confirmed by grep), `products`, `priceLevels` (referenced exactly once, in a `<select>` populated from `state.backend.priceLevels`), `productPriceLevels`, `unitsOfMeasure`, `unitGroups` — all gated under the `salesDocuments` role group already.

**So the real gap is precise:** the header record (name/total/status) exists; the **line-item builder** — pick a product/service, quantity, unit, rate from a price level — does not exist at all. This phase builds that, and reconnects the existing stub to it instead of typing one raw total by hand.

---

## In scope

### 1. Quote/Estimate line-item builder

Replace the single `totalAmount` field with a real line-item table:
- Add/remove line items, each referencing a `product` (or a free-text line for anything not yet in the catalog — don't block on catalog completeness)
- Quantity, unit (from `unitsOfMeasure`), rate (from a `priceLevel`/rate card — see item 2), computed line total
- `totalAmount` becomes a computed sum, not a manually typed number
- Decide: is "Quote" and "Estimate" one document type with a status flag, or two distinct concepts? The notes use the phrase "Quote or Estimate" together throughout, suggesting the owner may mean them loosely interchangeably — **confirm before building two parallel systems that don't need to exist separately.**

### 2. Connect to vendor and service-agreement rate cards

> *"On Vendor compliance it asks for rate card and lists 2026 standard environmental services, we need to figure out where/how we want this created. I think it should be tied to items able to be listed on estimates and quote forms."*

> *"On account service agreement mentions 'Rate Card' again and lists the '2026 standard environmental services' this may be different if a 'Rate agreement' is selected in agreement type..."*

Both Phase 04 rate-card mentions point back here: the "2026 Standard Environmental Services" rate card referenced on Vendor Compliance and Service Agreements should be the **same underlying `priceLevels`/`products` data** that quote line items pull from, not a separately-typed value living in three places. Build the line-item picker (item 1) against this shared rate structure so Phase 04's rate-card work has something real to point at instead of a free-text label.

### 3. Feed project value from the quote/estimate

> *"When creating a project, we want the value to be associated with the quote or estimate value found in the estimate or quote. If no quote or estimate was used then they can ask for an entry."*

Once an opportunity has a quote with a real computed total, project creation (from a won opportunity) should default `projects.budget`/value to that total rather than asking for a fresh manual entry. If no quote exists on the opportunity, fall back to the existing manual-entry behavior — this is additive, not a new requirement to always have a quote.

### 4. Wire "Add quote" into the reusable Create pattern

The existing "Add quote" button is a page-specific action. Once Phase 03's reusable "+Create" dropdown pattern and Phase 05's reusable lookup component exist, evaluate whether quote creation should be reachable the same way, for consistency — not a hard requirement, a consistency check.

---

## Out of scope

- Sending a quote/estimate to a customer for signature — that's the e-signature/sign-off workflow, tracked separately (see Phase 13's expanded scope and the open Docusign question below)
- Automated recurring rate-card updates (e.g. year-over-year rate escalation) — no evidence this is needed yet, don't build speculative infrastructure
- Sales orders (`salesOrders`/`salesOrderLines` collections exist but nothing in the notes asks for them) — leave alone unless a real need surfaces

---

## Data model changes

- `quoteLines` gets its first real UI (currently 1 orphaned seed row, zero code paths)
- `quotes.totalAmount` becomes derived/computed from line items rather than directly entered
- Likely new: a explicit link from `projects` to the quote it was valued from (confirm whether `opportunities.quoteId` is sufficient to trace this transitively, or whether `projects` needs its own `quoteId`)

Update `docs/database-handoff-map.md` once the line-item shape is finalized.

---

## Verification / done criteria

- [ ] Build a quote with 3+ line items from the product/rate catalog; the total computes correctly
- [ ] Edit an existing quote's line items; the total recalculates
- [ ] Create a project from a won opportunity that has a quote; the project's value defaults from the quote total
- [ ] Create a project from a won opportunity with **no** quote; still prompts for manual entry (no regression)
- [ ] The same rate/price data referenced by a quote line item is what Phase 04's vendor/service-agreement rate card panels point to (not a separate hardcoded value)

---

## Open decisions — resolved by the owner, 2026-09-17

- **Quote vs. Estimate: one document type or two?** **Two.** Built as genuinely separate collections/records (`quotes`/`quoteLines` and `estimates`/`estimateLines`), each with its own dialog (`opportunityQuoteDialog`/`opportunityEstimateDialog` in `index.html`) and its own opportunity-side "current" pointer (`opportunities.quoteId` / `opportunities.estimateId`). They share one line-item builder (add/remove line, product-or-free-text, quantity, unit, rate, computed line/document total) because the mechanics are identical — only the backend collection and dialog chrome differ. Implementation: `renderDocLineRowHtml()`, `populateDocLineContainer()`, `recomputeDocTotal()`, `applyLineProductDefaults()`, `applyPriceLevelToAllLines()`, and `collectDocLines()` in `app.js` are shared by both `saveOpportunityQuote()`/`openOpportunityQuoteDialog()` and `saveOpportunityEstimate()`/`openOpportunityEstimateDialog()`.
- **Where does the master rate card get authored and maintained?** A new **Rate Card** screen (`renderRateCard()`, view id `rate-card`, added to the Sales workspace nav) — create/edit products, units of measure, and price levels, and set a product's rate for a given price level (writes to `productPriceLevels`). This is the single source of truth: Phase 04's vendor-compliance and service-agreement `priceLevelId` selects already read `state.backend.priceLevels` (confirmed via `populatePriceLevelSelect()`, used identically in both places before this phase started), so they now point at real, editable data instead of a single hardcoded seed row with no edit surface.
- **Does `projects` need its own `quoteId`/`estimateId`?** **No — traceable transitively through `opportunityId`.** A project already carries `opportunityId`; the opportunity carries `quoteId`/`estimateId` for whichever document is "current." Adding a second FK on `projects` would just duplicate that pointer and risk drifting from it if the opportunity's current document changes after the project is created. The project's `budget` is still set once, at creation time, from whichever document's total was current then (see item 3) — that's a value snapshot, not a live link, which is consistent with how `budget` already behaved before this phase (a manually-typed snapshot of `opportunity.amount`).

---

## Live bug report follow-up — 2026-09-17 (second session)

The owner reported two live issues after using the quote/estimate builder this phase shipped.
Both were reproduced against running code before fixing, per this phase doc's own rule.

1. **"When pushing a sales quote, the current badge is just awarded to the most recent quote on a
   quote. There is no way to print or export the quote."** Confirmed both halves:
   - **(a) "Current" was purely automatic, no override.** Traced `saveOpportunityQuote()`/
     `saveOpportunityEstimate()`: the only place `opportunities.quoteId`/`estimateId` was ever
     written was inside the save function itself, gated on `isNewQuote || !opportunity.quoteId`
     (added earlier this same phase — see "Corrections" below). That condition is true for *every*
     brand-new quote/estimate, meaning creating a new one always stole "Current" from whatever was
     there before, with zero way to switch it back to an older document without re-saving that
     older one (which would just make it the "newest" write and flip it right back). There was no
     button, action, or code path anywhere that set `quoteId`/`estimateId` to an explicit user
     choice independent of the create/edit flow. Fixed by adding `markQuoteCurrent(opportunityId,
     quoteId)` / `markEstimateCurrent(opportunityId, estimateId)` (`app.js`) — both just call
     `buildCoreOpportunityRecord` with the chosen id and save, no other side effects — wired to a
     new "Mark current" button that renders on every non-current quote/estimate card in the
     opportunity's Proposal & Documents tab (`renderOpportunityProposalDocumentsTab`). The existing
     "Current" `<span class="tag">` still renders in place of the button once a document is current.
   - **(b) No print/export existed anywhere.** Confirmed by grep — there was no `print`,
     `window.print`, or PDF-related code path touching quotes/estimates before this session. Built
     `renderPrintableDocHtml()` + `printOpportunityQuote()`/`printOpportunityEstimate()` (`app.js`):
     a "Print" button on every quote/estimate card opens a new browser tab with a clean,
     self-contained (inline `<style>`, no dependency on the app's own `styles.css` or its
     background/theme) customer-presentable layout — account, site/facility, billing/shipping
     address, effective dates, status, required line items with the document total, a separate
     "Optional / write-in options" table for anything not included in that total, and notes — plus
     a "Print / Save as PDF" button that calls `window.print()`. No PDF library was added; browser
     print-to-PDF covers a prototype's needs and nothing lightweight enough was worth pulling in for
     this.

2. **"No way to add notes, billing or shipping address, or write in options."** Investigated each
   of the three separately rather than assuming they were one gap:
   - **Notes** — genuinely missing. Added `notes` (single free-text field, not split
     internal/customer — the dialog doesn't yet have a concept of "customer-facing" vs. "internal"
     anywhere else, and splitting it would be speculative scope for a field the owner described in
     one breath) to both `quotes` and `estimates`, a `<textarea name="notes">` in both dialogs, and
     rendered on the print view under "Notes:".
   - **Billing/shipping address** — genuinely missing, and confirmed the right fix was a *link*, not
     a new free-text address, per the Phase 02 Places Model (`docs/roadmap/GLOSSARY.md`): the
     `addresses` collection already exists with an `address_type` enum including `Bill To`/`Ship
     To`, and `populateAddressSelect(root, fieldName, accountId)` already exists and is already used
     identically by the service-agreement and subcontractor-assignment dialogs for `billingAddressId`
     (`app.js` — same field name reused here on purpose for consistency). Added `billingAddressId`
     and `shippingAddressId` FKs to `quotes`/`estimates`, two `<select>`s in both dialogs populated
     from the opportunity's account's addresses, and both render on the print view (falling back to
     "Not set" in italics when empty, not hidden, so a customer-facing print doesn't look broken).
     No new address types or a parallel address system were invented.
   - **Write-in options — investigated before assuming it duplicated existing scope.** Confirmed via
     this phase's own "What's built" section that free-text/custom *line items* already existed and
     worked (the product `<select>` defaults to "Custom / free text" and takes a typed description).
     So the owner's complaint could not be about that. Re-read in context, "write in options" reads
     as the standard quoting-industry meaning: an optional add-on the customer can accept or
     decline, distinct from the required/base line items and *excluded* from the total until picked
     — not a duplicate of free-text lines, a genuinely different line *behavior*. Added `isOptional`
     (boolean) to `quoteLines`/`estimateLines`, an "Option" checkbox on every line row, and changed
     `computeDocLinesTotal()` to exclude optional lines from `totalAmount`. The print view lists
     optional lines in their own "Optional / write-in options (not included in total above)" table
     rather than mixing them into the priced total silently. This is additive on top of the
     pre-existing free-text capability, not a replacement for it — a line can be both free-text
     *and* optional at the same time.

**Verified live (Playwright, `chromium.launch()` via the bundled `playwright` package under the
Codex Node runtime, against the running dev server on port 4173):**

- Opened the "UST removal and soil remediation" opportunity (`opp-riverbend-ust`, 3 seeded quotes).
  Confirmed only one had the "Current" tag and the other two showed a "Mark current" button.
  Clicked "Mark current" on a different quote — the tag moved to that quote and the previously
  current one's button reappeared. Reverted this test mutation from `data/backend.json` afterward
  (server stopped first, per the hand-edit lesson below) so the seed's original "current" pointer
  (`quote-mu65c5a9-s1sunr`) is unchanged in committed data.
- Clicked "Print" on a quote (`opp-mu4d3fc2-ix14uk` / "Tall Tree Test stage jump op quote") — a new
  tab opened with the clean print layout: account (City of Georgetown), site (Old Fire Office),
  status, effective dates, and total, with no console errors.
- Opened that same quote's Edit dialog, confirmed the billing/shipping address `<select>`s
  populated with all 4 of that account's real seeded addresses (Primary local, ship too testtt,
  remit address test jeff, billy office) plus "Not set", filled in notes, selected a billing and a
  shipping address, added a line and checked it as "Option" with a $15,000 rate — confirmed the
  computed total field did **not** include that $15,000 while the line's own total still showed
  "$15,000 (option)". Saved, reopened the dialog, and confirmed notes/addresses/optional-line state
  all persisted correctly. Printed it again and confirmed the billing/shipping address text and the
  separate "Optional / write-in options" table with the $15,000 line rendered correctly, excluded
  from the $0 required-lines total. Reverted this test mutation from `data/backend.json` afterward
  (this quote's real seed shape — `totalAmount: 7`, no lines/notes/addresses — was restored exactly
  via `git diff`/`git checkout` against `HEAD`, not by hand-guessing the original values).
- Created a brand-new, temporary second estimate on the Prairie Foods Phase II opportunity
  (`opp-prairie-phase2`, the seeded estimate-only case) with notes, a $1,000 required line, and
  confirmed the total computed correctly live before saving. Confirmed it became "Current"
  automatically (pre-existing create-time behavior, unchanged by this session) and printed it,
  confirming notes and the line rendered correctly. This test estimate and its lines were entirely
  new records, so cleanup was a straight `git checkout HEAD -- data/backend.json` rather than a
  field-by-field revert.
- Confirmed zero console/page errors across all of the above, and confirmed `data/backend.json` is
  byte-identical to `HEAD` (via `git diff HEAD -- data/backend.json`, empty) before committing — no
  test-session data pollution shipped.

**Not built:** a real PDF export library — out of scope per the task's own framing ("a real PDF
export library is not required unless something lightweight is trivially available"); nothing
lightweight enough was found bundled in this environment, and browser print-to-PDF meets the need.
Customer-facing vs. internal notes were not split into two fields — investigated and judged to be
speculative scope beyond what was reported (see above).

## Live bug report follow-up — 2026-09-18 (cross-reference)

The owner's report that "each new job request... reuses opportunity priced amount" touches this
phase's quote/estimate data (`pricingSourceForOpportunity()` reads the opportunity's current
quote/estimate total, which this phase built). The actual bug and fix are in the job-request
dialog (`openJobRequestDialog()`, Phase 07 territory), not in the quote/estimate data itself — the
quote/estimate total resolution this phase built (`currentQuoteOrEstimateForOpportunity()`, also
used by Phase 09's cost report) was re-verified and is correct, always resolving the CURRENT
document, not a stale one. Full writeup and live verification in
`docs/roadmap/phase-09-billing-invoicing.md`'s "Live bug report follow-up — 2026-09-18" section,
item 2.

## Corrections found during implementation

- **2026-09-17 — the phase doc's "verified 2026-09-16" section undercounted the seed data:** there are 2 seeded quotes (`quote-riverbend-revision`, `quote-clearwater-night-shift`), not 1, and `quoteLines` has 4 rows across them, not 1. Otherwise the doc's diagnosis was accurate: the line-item builder genuinely did not exist, and `quoteLines` had zero UI reads/writes before this session.
- **2026-09-17 — found and fixed a real bug in the pre-existing stub while building on top of it:** `openOpportunityQuoteDialog()`/`saveOpportunityQuote()` only ever set `opportunities.quoteId` when creating a *brand-new* quote (`isNewQuote`). Both pre-existing seeded quotes were attached to their opportunities via `quotes.opportunityId` but their opportunities' own `quoteId` pointer was blank — meaning the "Current" tag never appeared on either seeded quote, and (more importantly for this phase) the Negotiation stage-gate's "Quote" requirement (`STAGE_REQUIRED_FIELDS.Negotiation`, keyed on `opportunity.quoteId`) could never be satisfied by editing an existing quote, only by creating a new one. Fixed by changing the condition to `isNewQuote || !opportunity.quoteId` (mirrored for estimates) — now saving a quote/estimate marks it "current" whenever nothing else already is, without stomping on an intentional switch to a different quote later. Seed data (`data/backend.json` and `server.mjs`'s `defaultBackend`) was corrected in the same session to carry the right `quoteId`/`estimateId` values so this isn't a bug a fresh install would still exhibit.
- **2026-09-17 — hand-editing `data/backend.json` mid-session while the dev server was live caused a duplicate-key data bug worth flagging for future sessions:** editing a raw opportunity record on disk to add `quoteId` while the running app had already round-tripped that same record through `buildCoreOpportunityRecord()` (which writes a full, differently-ordered field set including its own `quoteId` position near `priceList`) produced **two `"quoteId"` keys in the same JSON object** — one from the manual edit, one from the app's own save. `JSON.parse` silently keeps the *last* occurrence, so the manual edit appeared to "not stick" even though `grep` found it in the file. Lesson: never hand-edit `data/backend.json` while a server instance that might resave the same record is running (or has ever resaved it in a shape with more fields than the raw seed) — patch it with the server stopped, or better, drive the fix through the app's own dialogs so there's only ever one write path.
- **2026-09-17 — Phase 04's rate-card cross-reference required no new wiring, only confirmation.** `openServiceAgreementDialog()` and `openSubcontractorAssignmentDialog()` (both shipped in Phase 04) already call `populatePriceLevelSelect(dialog, "priceLevelId")`, reading `state.backend.priceLevels` — the exact same collection and function the new Rate Card admin screen's product-rate dialog also populates via. No Phase 04 code changed; the "single source of truth" requirement was satisfied by this phase adding the missing *write* path (admin screen), not by Phase 04 needing a new *read* path.

---

## What's built

1. **Line-item builder**, shared by Quote and Estimate dialogs (`index.html` `#opportunityQuoteDialog` / `#opportunityEstimateDialog`, both `wide-modal-panel`): add/remove line, pick a product (rate/unit/description auto-fill from the selected price level) or leave it as free text, quantity, unit (from `unitsOfMeasure`), rate, a live computed line total, and a live computed document total (`totalAmount` is now a readonly field, never hand-typed). Switching the dialog's price level re-prices every already-picked product line.
2. **Rate Card admin screen** (`view=rate-card`, Sales workspace nav): list and add/edit price levels, units of measure, and products, including each product's rate under each price level. Backed by the pre-existing `products`/`priceLevels`/`unitsOfMeasure`/`unitGroups`/`productPriceLevels` collections — no new collections needed here, just the missing UI.
3. **New collections:** `estimates` and `estimateLines`, structurally identical to `quotes`/`quoteLines` (see `docs/database-handoff-map.md`). Added to `server.mjs`'s `collectionAccess` map (gated under `salesDocuments`, same as quotes) and `defaultBackend` seed, and to `data/backend.json` with one seed estimate (`estimate-prairie-phase2`, on the Prairie Foods Phase II opportunity, which had no quote so it exercises the estimate-only path in seed data).
4. **`opportunities.estimateId`** added alongside the existing `opportunities.quoteId`, both handled identically by `buildCoreOpportunityRecord()`.
5. **Item 3 — project value defaults from quote/estimate.** `openProjectFromOpportunityDialog()` now looks up the opportunity's current quote and current estimate (via `quoteId`/`estimateId`), prefers the quote's `totalAmount` if present, falls back to the estimate's `totalAmount`, and falls back to the opportunity's own `amount` (the pre-existing manual-entry behavior) only if neither document exists. Additive — the manual entry field is untouched and still editable before saving.
6. **Item 4 — reusable "+Create" wiring: skipped, documented per the phase doc's own "nice-to-have, not a hard requirement."** The existing "+Create" dropdown (`.create-menu` in the header) is scoped to Account/Contact/Opportunity/Activity creation from the Sales workspace's top-level pages; quote/estimate creation is inherently opportunity-scoped (a quote without an opportunity has nowhere to attach), so it doesn't fit that pattern's "create a new top-level record" shape without a parent-opportunity picker step the pattern doesn't have yet. Left as page-scoped "Add quote"/"Add estimate" buttons on the opportunity's Proposal & Documents tab, consistent with how the stub worked before this phase.

## Verified live (Playwright, `chromium.launch()` via the bundled `playwright` package under the Codex Node runtime — `chromium-cli` was not available in this environment)

- Built a quote with 3 line items on an existing seeded quote (edited quantity on one line, added a third referencing a newly-created rate-card product) — total recomputed live from $171,500 → $218,900 as lines changed, saved correctly, and reloaded with the same 3 lines and total.
- Built a separate estimate (not a status flag on the same quote) with 3 line items on the same opportunity — both the Quote and Estimate panels render independently side by side on the Proposal & Documents tab, each with their own "Current" tag and total.
- Edited an existing quote's line items (quantity change, added line) and confirmed both the per-line total and the document total recomputed live in the browser before saving, then confirmed the saved total matched after reload.
- Used the Rate Card admin screen to add a new unit of measure ("week") and a new product ("Groundwater monitoring well install", $9,200/week), then confirmed both appeared immediately in the quote line-item product/unit pickers with the rate auto-filled on selection. Also edited an existing product's rate and confirmed the new rate flowed into the picker on the next line added.
- Won an opportunity with a quote attached (`opp-mu4c4qxs-1ucxl8`, quote total $35,400 vs. opportunity amount $85,000) and confirmed the project-create dialog's budget field defaulted to $35,400 (the quote total), not the opportunity amount.
- Won an opportunity with only an estimate attached (`opp-prairie-phase2`, estimate total $14,500) and confirmed the project-create dialog's budget field defaulted to $14,500.
- Won an opportunity with neither a quote nor an estimate attached (`opp-mu4covno-mqlp5w`, amount $1,000) and confirmed the project-create dialog's budget field still defaulted to the opportunity's own amount ($1,000) — no regression in the manual-entry fallback.
- Confirmed no console/page errors across all of the above.
- **Not click-tested:** the Phase 04 vendor-compliance/service-agreement dialogs' rate-card selects specifically in this session (no Phase 04 UI changed, so this was confirmed by code trace instead — see Corrections above).

All test-session-only data mutations (extra quotes/estimates/products/UoM created while click-testing, and 3 opportunities temporarily forced to Won via direct API calls to reach the project-creation flow without walking every stage gate) were reverted from `data/backend.json` before committing; only the intentional seed additions (`estimates`/`estimateLines` collections, one seed estimate, and the `quoteId`/`estimateId` corrections described above) remain.
