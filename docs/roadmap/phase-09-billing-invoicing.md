# Phase 09 — Billing & Invoicing

**Status:** 🟢 **Shipped 2026-09-17.** A real "close project" action gated on the `PROJECT_STAGES` ladder reaching Closeout; closing generates a stored cost-report/P&L snapshot from real equipment/labor/material usage, priced from Phase 08's rate card; a "Regenerate" action re-runs the same generator after post-close usage posts; the generated numbers now feed (not bypass) the existing manual invoice dialog. Verified live via Playwright: closed a real project with real logged usage, confirmed the report's numbers, confirmed the invoice dialog pre-filled from it, posted a new usage entry after close and confirmed the stale snapshot only updated on explicit Regenerate (with a new `regeneratedAt`, original `generatedAt` preserved), and confirmed a project with zero usage and no quote/estimate still closes cleanly to an all-zero report with no console errors.
**Depends on:** Phase 08 (rate data) — shipped 2026-09-17. Phase 07 item 11 (project stage must actually advance before "project close" means anything) — shipped 2026-09-17.
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

### Re-verified 2026-09-17, after Phases 06/07/08 shipped

All line numbers above had shifted (the file grew from ~18,300 to ~19,000+ lines across those phases) but the diagnosis itself was still accurate — confirmed by grep before writing any code:

- `renderFinance()`/`renderFinanceInvoices()`/`renderFinanceQbo()`, `openInvoiceDialog()`, `saveInvoice()`, and `exportInvoiceToQbo()` all still exist, unchanged in shape, just at new line numbers (`app.js:11138`, `11202`, `11236`, `18217`, `14442`/originally, `14466` respectively — see the functions actually added/changed below for their current homes after this phase's edits shifted things further).
- `getFinanceRows()` (`app.js`, near the bottom of the file) was confirmed to be computing "field usage" cost with **flat hardcoded constants** (`quantity * 42` for materials, `equipmentLogs.length * 650`, `assignmentsForJob(job.id).length * 1200` for labor) — not reading Phase 08's rate card at all. This is the concrete gap item 2 below fixes.
- **Phase 07 item 11 dependency confirmed satisfiable:** `projects.projectStage` is now read by `getJobProgress()` and advanced by `advanceProjectStageFromDispatchStatus()` on real dispatch-status transitions (`PROJECT_STAGES = ["Intake", "Plan", "Mobilize", "Field Work", "Closeout"]`). This phase's close gate is built directly on top of that ladder (`projectCanClose()` checks `projectStage` has reached `"Closeout"`), not a new parallel status.
- **Phase 08 dependency confirmed satisfiable but with a real gap found:** `priceLevels`/`products`/`productPriceLevels` exist and are populated (3 seed services, all priced as whole-engagement day rates — e.g. "$14,500/day UST removal"). There was **no per-hour-labor, per-checkout-day-equipment, or per-unit-material rate anywhere in the catalog** — every existing product prices a multi-day service engagement as a lump sum, not a granular cost input. See item 2's writeup for how this was resolved.
- **A real gap not anticipated by the plan doc: there is no per-project labor-hours figure anywhere in the app.** Phase 07 item 12 fixed `employees.hoursWorked`, but that is a cumulative, cross-project running total — not attributable to any single job. The only place the app captures hours tied to a *specific* dispatch job is a Front Line Timer-task submission (`jobFormSubmissions`, `payload.hours`). See item 2's writeup.

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

- `projects.closedAt` — ISO timestamp, set once when a project is explicitly closed via the new "Close project" action. Absent/falsy means the project is not closed.
- `projects.closeReport` — the stored cost-report/P&L snapshot object. Shape:
  ```js
  {
    priceLevelId,
    costs: {
      materials: { unitCost, rateSource: "rate-card"|"fallback", items: [{ id, materialType, quantity, unit, unitCost, lineCost }], total },
      equipment: { unitCost, rateSource, items: [{ id, assetTag, equipment, unitCost, lineCost }], total },
      labor:     { unitCost, rateSource, hours, entries: [{ employee, hours, submittedAt, dispatchJobId }], total },
      total,
    },
    revenue: { quoted, quotedSource: "quote"|"estimate"|"opportunity"|"none", invoiced },
    margin,
    marginPercent,
    generatedAt,      // set once, at first close — never changes after that
    regeneratedAt,    // null until the first "Regenerate" click, then updated on every regenerate
  }
  ```
- Rate-card seed additions (Phase 08's `products`/`priceLevels`/`productPriceLevels`, plus a new `unitGroups`/`unitsOfMeasure` pair) — see item 2 below for why these were needed and item-by-item detail. Mirrored in both `server.mjs`'s `defaultBackend` and the live `data/backend.json` seed (server was stopped before hand-editing the JSON file directly, per the Phase 08 lesson about concurrent writes causing duplicate keys).

See `docs/database-handoff-map.md`'s Phase 09 note for the full inventory.

---

## Verification / done criteria

- [x] A project can be explicitly closed, and closing it is a real, visible transition (not just a status string that nothing reads) — 2026-09-17, verified live: `job-riverbend-ust` (already at `projectStage: "Closeout"` in seed data) closed via the new "Close project" button, `closedAt` and `closeReport` persisted and confirmed via API readback
- [x] Closing a project generates a cost report pulling real equipment/labor/material usage and rate data, not manually entered numbers — 2026-09-17, verified live: the generated report showed 1 material log ($42/unit, rate-card sourced), 1 equipment log ($650/day, rate-card sourced), 0 labor hours (no Timer submissions existed for this project's dispatch jobs — correctly reflects real data, not a fabricated number), total cost $1,658 against real seeded `materialUsage`/`equipmentLogs` rows
- [x] A P&L view exists per closed job — 2026-09-17, verified live: the project detail page's new "Billing & cost report" panel shows cost breakdown, revenue (quote/estimate/opportunity-value, whichever resolved), invoiced amount if one exists, margin, and margin %
- [x] The generated cost data flows into the existing invoice dialog as a starting point, not a parallel/duplicate invoice path — 2026-09-17, verified live: `openInvoiceDialog()` still the only invoice entry point; `getFinanceRows()` now prefers `project.closeReport` numbers over the old flat heuristic once a report exists, and the dialog reads through that same row data (existing behavior unchanged for un-closed projects)
- [x] Post-close usage entries don't silently change the report; an explicit regenerate updates it — 2026-09-17, verified live: logged a new material-usage entry against the already-closed `job-riverbend-ust`, confirmed the displayed report was unchanged (still 1 material item) until "Regenerate" was clicked, then confirmed it updated to 2 items / new total / `regeneratedAt` timestamp while `generatedAt` stayed at its original value
- [x] A project with no usage data and no quote/estimate still closes gracefully — 2026-09-17, verified live: `job-north-river-stormwater` (no `materialUsage`/`equipmentLogs`/Timer submissions, no `quoteId`/`estimateId` on its opportunity) was pushed to `projectStage: "Closeout"` (test-only, via direct API call, reverted after) and closed cleanly — report showed $0 costs across all three buckets, revenue correctly fell back to the opportunity's own `value` ($96,000), no console/page errors
- [x] No console/page errors across any of the above scenarios (confirmed via Playwright's console/pageerror listeners on every run)

---

## Open decisions — resolved by the owner, 2026-09-17

- **Does closing a project lock it from further usage entries, or can costs still post after close and require a report regeneration?** **Costs can still post after close.** Closing does not touch `materialUsage`/`equipmentLogs`/dispatch job submissions in any way — there is no lock. A "Regenerate" button on the project's Billing & cost report panel (visible only once `closedAt` is set) re-runs `buildProjectCostReport()` and overwrites `closeReport` in place.
- **Snapshot vs. computed-on-demand?** **Snapshot, generated at close time.** `buildProjectCostReport()` is only ever called from `closeProject()` and `regenerateProjectCloseReport()` — no render path recomputes it. `regenerateProjectCloseReport()` preserves the original `generatedAt` and sets `regeneratedAt` to the current time, so it's visible from the stored data alone whether/when the numbers were refreshed after close.
  - **History question (my call, documented per the task's framing):** no history array is kept — regenerating overwrites the previous snapshot rather than appending to a list. This keeps the shape simple for a pilot-stage prototype where nothing yet reads point-in-time audit history; Phase 12 (Identity & Audit) is the more appropriate place to add a real change log across the whole app rather than a bespoke one just for this report. If a real audit need surfaces before Phase 12, the fix is additive (push the old snapshot onto a `project.closeReportHistory` array before overwriting) rather than a redesign.
- **Does waste-disposal cost (Phase 11) feed this P&L?** **No — explicitly deferred, not forgotten.** `buildProjectCostReport()` has a code comment calling this out directly: Phase 11/Field Ops Depth's permit-and-waste-tracking work doesn't exist yet, so there's no data to include. When Phase 11 ships, add a fourth cost bucket to `closeReport.costs` there.

---

## What's built

1. **`projectCanClose(project)`** (`app.js`) — gate helper: true once `project.projectStage` has reached `"Closeout"` on the existing `PROJECT_STAGES` ladder.
2. **`closeProject(projectId)`** — validates the gate and that the project isn't already closed, builds the report, writes `closedAt`/`closeReport`. Wired to a new "Close project" button in the project detail hero toolbar (`data-action="close-project"`, only rendered when eligible and not yet closed).
3. **`regenerateProjectCloseReport(projectId)`** — rebuilds and overwrites `closeReport` for an already-closed project, stamping `regeneratedAt`. Wired to a "Regenerate" button in the new Billing & cost report panel (only rendered once `closedAt` is set).
4. **`buildProjectCostReport(project)`** — the generator itself: pulls `materialUsageForJob()`, `equipmentLogsForJob()`, and the new `laborHoursForProject()`, prices each via `resolveCostBasisRate()` against the opportunity's current quote/estimate price level (falling back to `defaultPriceLevelId()`), and resolves revenue from the current quote/estimate total, falling back to the opportunity's `value`/project `budget`, with an existing `invoices` row's `invoiceAmount` overriding as "actual" revenue when one exists.
5. **`laborHoursForProject(projectId)`** and **`currentQuoteOrEstimateForOpportunity(opportunity)`** — supporting lookups described in the corrections/decisions above.
6. **`renderProjectBillingPanel(job)`** — new panel on the project detail page (`renderProjectDetail()`), showing either the close-eligibility state (with an explanation of why, if not yet eligible) or the full stored report once one exists, with "Regenerate" and "Create invoice" actions.
7. **`getFinanceRows()` and `openInvoiceDialog()` updated, not replaced** — once `project.closeReport` exists, the Finance table's per-project cost/quoted/invoice-prep figures and the invoice dialog's pre-filled amounts (which read the same row data) use the real report numbers instead of the old flat per-item heuristic (`quantity * 42`, `equipmentLogs.length * 650`, `assignmentsForJob().length * 1200`). Un-closed projects still use the old heuristic — no regression there.
8. **Rate-card seed additions** (`server.mjs`'s `defaultBackend` and `data/backend.json`): a new `unit-group-consumables` unit group with a `uom-unit` unit of measure, and three new products (`prod-field-labor-standard`, `prod-equipment-standard-daily`, `prod-material-standard-unit`) each with a `productPriceLevels` row under the existing `price-standard-2026` price level.

---

## Corrections found during implementation

- **2026-09-17 — a real gap not visible from the plan doc alone: there is no per-project labor-hours figure anywhere in the app.** The plan doc pointed to "whatever Phase 07 item 12 fixes for labor/hours tracking," but that fix (`employees.hoursWorked`) is a cumulative, cross-project running total incremented on every Timer-task submission regardless of which job it was for — it cannot be attributed back to a single project's cost report. The only place the app captures hours tied to a *specific* dispatch job is a Front Line Timer-task submission itself (`jobFormSubmissions`, keyed by `jobId` = a `dispatchJobs` id, with `payload.hours`). Resolved by adding `laborHoursForProject(projectId)`, which walks every `dispatchJobs` row linked to the project (`dispatchJobsForProject()`, already existed) and sums `payload.hours` from any Timer-type submission on each — real per-job data, just assembled from a different path than the plan doc assumed existed already.
- **2026-09-17 — Phase 08's rate card had no per-unit cost basis for equipment/labor/materials, only whole-engagement day-rate services.** All three pre-existing seed products (`prod-ust-remediation`, `prod-asbestos-containment`, `prod-disposal-impacted-soil`) price a multi-day service engagement as a lump sum (e.g. $14,500/day), which isn't a resolvable per-log or per-hour cost input. Rather than fabricate false per-asset or per-employee-role granularity that doesn't exist in this prototype, three generic cost-basis products were added to the rate card so the report generator still resolves real rate-card data (not a re-hardcoded constant) for the common case: `prod-field-labor-standard` ($95/hr, `uom-hour`), `prod-equipment-standard-daily` ($650/day, `uom-day`), `prod-material-standard-unit` ($42/unit, a new `uom-unit`/`unit-group-consumables` pair — `materialUsage.unit` is free text with no UoM FK, so there was no existing per-unit measure to hang a rate off of). `resolveCostBasisRate()` falls back to the same flat numbers only if even this generic product has no rate configured for the resolved price level — a defensive fallback, not the primary path, and it's flagged in the UI (`rateSource: "fallback"` renders as "- fallback rate" next to the number) so it's visibly distinguishable from a genuine rate-card hit. This is a deliberate, documented interim design, not a claim that granular per-equipment-type or per-employee-role rates exist yet.
- **2026-09-17 — hand-edited `data/backend.json` only with the server stopped, per the exact lesson recorded in Phase 08's corrections section.** The dev server (`server.mjs`) was stopped before every direct edit to the rate-card seed data and before reverting test-session mutations (a temporarily-forced `projectStage: "Closeout"` on `job-north-river-stormwater` for the empty-state test, and a test material-usage row logged post-close on `job-riverbend-ust`), then restarted afterward. No duplicate-key issue this time — confirmed by parsing the file with `JSON.parse` after every edit.
- **2026-09-17 — one real bug caught by the JSON edit itself, not code:** a stray extra `}` was introduced while removing the test material-usage record from `data/backend.json` by hand, caught immediately by running `JSON.parse` against the file before restarting the server (rather than assuming the edit was clean) — fixed before restart, no corrupted state ever hit the running app.
