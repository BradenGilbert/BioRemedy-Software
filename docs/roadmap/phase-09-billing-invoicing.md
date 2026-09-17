# Phase 09 — Billing & Invoicing

**Status:** Not started — new module
**Depends on:** Phase 08 (rate data), Phase 07 item 11 (project stage must actually advance before "project close" means anything)
**Estimated sessions:** 3
**Source:** `bioremedy crm notes 9.16.2026.docx`

> *"There is no way to progress a project to close. Once we close a project it needs to move to billing and invoicing, that should pull rates from the rate sheet, equipment used, labor used, consumables used and generate a cost report and a Profit and loss report for the job."*

---

## Where this actually stands today (verified 2026-09-16)

Finance already has real screens, not a stub: `renderFinance()` / `renderFinanceInvoices()` / `renderFinanceQbo()` (`app.js:10635-10733`), a manual invoice dialog (`openInvoiceDialog`, `app.js:16798-16816`, fields: project, quoted amount, invoice amount, status, due date, notes), `saveInvoice()` (`app.js:13799`), and a mock QuickBooks export (`exportInvoiceToQbo`, `app.js:13823` — already documented elsewhere as a mock export queue, not a real QBO connection).

**What's missing is exactly what the note describes:** every field in that invoice dialog is typed in by hand. There is no:
- Project "close" action/stage that triggers anything
- Automatic pull of actual equipment/labor/material usage into a cost figure
- A generated cost report or profit-and-loss report per job

This phase builds that pipeline; it does not replace the existing Finance/invoice UI, which stays as the place invoices are reviewed and sent.

---

## In scope

### 1. A real "close project" action

Projects need an explicit close transition (tie this to Phase 07 item 11 — project stage doesn't currently advance correctly at all, so "close" has to land on top of a working stage ladder, not instead of one). Closing a project is the trigger for item 2.

### 2. Auto-generated cost report from real usage

On close, pull together everything already being tracked per job:
- Equipment used (`equipmentLogs`)
- Labor used (whatever Phase 07 item 12 fixes for hours tracking — this depends on that being real first)
- Consumables/materials used (`materialUsage`)
- Rates for each (from Phase 08's rate cards/price levels)

...into a cost report. This is the first real **consumer** of Phase 08's rate data beyond quoting — treat it as the integration test for Phase 08's design, not an independent rebuild of rate logic.

### 3. Profit and loss report per job

Cost report (item 2) against the quoted/invoiced revenue for the same job — a straightforward P&L once both sides exist. Don't build a general-purpose reporting engine for this; a per-job P&L view is enough for pilot.

### 4. Feed the existing invoice flow, don't replace it

The generated cost report should pre-fill or feed the existing manual invoice dialog (`openInvoiceDialog`) rather than bypassing it — office/finance staff still review and send. This keeps the existing Finance workspace as the review surface, with this phase removing the "type every number by hand" step underneath it.

---

## Out of scope

- Real QuickBooks integration — stays a mock export queue; this phase does not touch that connection, only what feeds the invoice draft before export
- Payments, allocations, credit memos, vendor bills, AP — `docs/database-handoff-map.md` Priority 1 "Accounting completion" item, tracked separately in Phase 11, not duplicated here
- Waste-disposal cost tracking (permits, disposal receipts) — related but distinct; see the notes' TCEQ/EPA waste-tracking item, tracked in Phase 11. If disposal costs should feed the P&L in item 3, that's a real integration point to confirm during implementation, not assumed here.

---

## Data model changes

Not yet scoped in detail — depends on Phase 08 landing first. At minimum expect: a `closedAt`/close-transition field on `projects`, and some persisted form of the generated cost report (or it may be computed on-demand rather than stored — decide based on whether historical snapshots matter for audit purposes).

---

## Verification / done criteria

- [ ] A project can be explicitly closed, and closing it is a real, visible transition (not just a status string that nothing reads — see Phase 07 item 11's caution about this exact failure mode)
- [ ] Closing a project generates a cost report pulling real equipment/labor/material usage and rate data, not manually entered numbers
- [ ] A P&L view exists per closed job
- [ ] The generated cost data flows into the existing invoice dialog as a starting point, not a parallel/duplicate invoice path

---

## Open decisions

- **Does closing a project lock it from further usage entries** (equipment/labor/material), or can costs still post after close and require a report regeneration?
- **Snapshot vs. computed-on-demand** for the cost/P&L report — matters for audit trail once Phase 12 (Identity & Audit) exists
- **Does waste-disposal cost (Phase 11) feed this P&L**, and if so is that in this phase's scope or a follow-on once Phase 11's waste tracking exists?

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*
