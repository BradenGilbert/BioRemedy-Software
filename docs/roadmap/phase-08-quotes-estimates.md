# Phase 08 — Quotes & Estimates

**Status:** Not started — new module
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

- Sending a quote/estimate to a customer for signature — that's the e-signature/sign-off workflow, tracked separately (see Phase 11's expanded scope and the open Docusign question below)
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

## Open decisions

- **Quote vs. Estimate: one document type or two?** The notes treat them as interchangeable; confirm before building separate models.
- **Where does the master rate card ("2026 Standard Environmental Services") actually get authored and maintained?** Needs an owner and an edit surface — right now it's referenced from three places (this phase, Phase 04 vendor compliance, Phase 04 service agreements) with no clear single source.
- **Does a project need its own `quoteId`, or is opportunity→quote→project traceable transitively through `opportunityId`?**

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*
