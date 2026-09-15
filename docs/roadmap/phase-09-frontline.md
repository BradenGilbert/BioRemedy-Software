# Phase 09 — Front Line: Real Tiles

**Status:** OUTLINE ONLY — deliberately not detailed yet
**Depends on:** Phases 06, 07, 08
**Detail this phase when:** the pilot has shown which field workflows actually matter

---

## Why this is an outline

Detailing this now would be guessing. The pilot will show which field workflows people actually reach for, and that should drive which tiles get built and in what order. Writing a precise plan today means writing it from assumptions that Phases 01–08 are about to invalidate.

---

## Where Front Line stands

**Schema:** complete. `crm-schema/024_frontline_devices_and_sync.sql` defines 11 tables — devices, assignments, sessions, job packages, commands, resumable uploads, sync cursors, conflicts, push subscriptions. `docs/erp-operational-architecture.md` specifies the endpoint shapes and eight conflict/offline rules.

**Built:** an in-browser phone-frame simulator inside the CRM (`app.js`, `renderFrontline*`, `FRONTLINE_TILES` at `app.js:11375`). It has a fake login (field-lead picker, no real auth), a 3×3 tile launcher, and a **genuinely working Job Book / Work Plan flow** that reads and writes the real `dispatchJobs` / `jobSteps` / `jobActions` / `jobFormSubmissions` collections through the same API the desktop uses.

It validates the data model and UX end-to-end. It is not the real mobile app.

**Tile status:**

| Tile | State |
|---|---|
| Job Book | ✅ Real — work-plan gating, typed task capture (photo / signature / timer / material / checklist / sample) |
| Time Sheet | Stub — would write the existing `timeEntries` collection |
| Forms | Stub — would reuse `jobFormSubmissions` |
| Messaging | Stub — needs a new `messages` collection |
| Trips | Stub — mileage; `job_mileage_entries` is designed |
| Location | Stub |
| Invoices | Stub |
| Settings | Stub |

---

## Likely scope

1. **Production Front Line API** — the endpoints in `docs/erp-operational-architecture.md`: `/frontline/bootstrap`, `/assignments`, `/jobs/{id}/package`, `/commands`, `/uploads`, `/sync`
2. **Real device auth**, replacing the employee picker
3. **Real offline sync** — the eight conflict rules, idempotency keys, `row_version`, resumable uploads
4. **Tiles, prioritized by pilot evidence.** Time Sheet is the strongest candidate on paper — it feeds both workforce and billing — but confirm against real usage.
5. **Decide the delivery target:** PWA (the simulator is already most of the way there) vs. native iOS/Android. This is the biggest open question and it has cost implications well beyond this phase.

---

## Known constraints to carry forward

- Job packages must contain **only** the assigned worker's jobs and permitted customer data — never unrelated customers
- Front Line does not own a second business data model; it holds temporary projections, commands, and upload queues
- Lifecycle transitions are revalidated server-side; Front Line submits commands, it does not update job rows
- The prototype implements only simple sequential action ordering — the full `job_action_definition_dependencies` graph is not built
