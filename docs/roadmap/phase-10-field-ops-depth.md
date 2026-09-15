# Phase 10 — Field Ops Depth & Reporting

**Status:** OUTLINE ONLY — deliberately not detailed yet
**Depends on:** Phase 08
**Detail this phase when:** the pilot has shown which gaps actually hurt

---

## Why this is an outline

This is the backlog of everything the architecture documents call out as missing but which is not on the path to a working pilot. Detailing it now would produce a plan shaped by guesses. Pull items out of here into real phases as the pilot creates demand for them.

---

## Carried-forward known-open items

| Item | Source |
|---|---|
| **`jobs.projectStage` is written but never read.** The visual stage ladder and `getMissingProjectStageFields` both key off free-text `status` / `activePhase` heuristics. Creating the field correctly was done in Round 2; wiring the ladder and gate to actually consume it was not. | `docs/dataverse-relationship-architecture.md` |
| **QuickBooks is a mock** export queue (`qboSettings`, `qboExports`) | prototype |
| **Full action dependency graph** unimplemented — prototype assumes sequential ordering | `docs/erp-operational-architecture.md` |
| **Activities vs `sales_tasks` split** — deliberately deferred in Phase 05; revisit with real usage data | `docs/dataverse-relationship-architecture.md` |
| **Lat/long on dispatch jobs** — deliberately not added in Round 3; nothing consumed it. Revisit if the map board and dispatch converge. | Round 3 notes |

---

## Priority 1 gaps (from `docs/database-handoff-map.md`)

1. **Inventory & purchasing ledger** — inventory locations, stock balances, stock movements, lots/batches, reorder rules, receiving, returns. The prototype has JSON inventory and POs; the SQL schema has no ledger. Note that Front Line material tasks *already decrement real stock* via a dedicated endpoint, so a real ledger has a live consumer waiting.
2. **Customer contracts & rate agreements** — MSAs, scopes of work, rate sheets, labor/equipment/material rate lines, change orders. Quotes and generic price lists exist; BioRemedy-specific contracted rates do not.
3. **Fleet & equipment maintenance** — vehicles, meter readings, inspections, PM plans, maintenance work orders, downtime, repair costs. `equipment` is only a basic asset record today.
4. **Accounting completion** — payments, allocations, credit memos, vendor bills, expenses, tax mappings, real QBO sync and reconciliation.

## Priority 2 gaps

5. **Laboratory data normalization** — laboratories, analytical methods, analytes, test requests, custody transfers, result rows, qualifiers, detection limits. Samples exist; results are mostly JSON blobs.
6. **Safety & compliance** — JHAs, safety meetings, incidents, observations, permits, SDS records, corrective actions, regulatory deadlines.
7. **Approvals & notifications** — approval requests, ordered steps, notifications, delivery attempts, subscriptions, escalations, read state. **Note:** the scope-exception alert flow in `docs/crm-foundation.md` depends on this — today alerts are recorded but notify nobody.
8. **Project commercial controls** — budgets, committed costs, forecasts, change orders, not-to-exceed revisions tied to approvals.

## Also raised but never scoped

- **Daily field logs** — weather, crew attendance, delays, photos
- **Reporting dashboards** — pipeline, crew utilization, equipment utilization, material cost, gross margin, revenue by customer/service line, aging opportunities
- **Global search** across entities
- **"Activity progress report"** — raised in the original cleanup roadmap, deliberately skipped as undefined. Still needs a conversation before it can be built.

---

## Explicitly out of scope, permanently

Per both architecture documents: payroll, compensation, benefits, SSNs, detailed medical records, and payment-card data stay in restricted external systems unless a deliberately security-bounded module is created for them.
