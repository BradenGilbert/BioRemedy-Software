# Phase 10 — Front Line: Real Tiles

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

---

## Concrete gaps raised 2026-09-16 (`bioremedy crm notes 9.16.2026.docx`)

This is still an outline — these items add specific, real detail to "likely scope" above, but this section is not yet a session-ready implementation plan. Treat it as the backlog to draw from once the pilot (or further scoping) says which of these matter most.

- **Odometer/travel time capture.** *"On frontline app for sampling job we need capture travel and truck time we need to capture start odometer and then arrival odometer on site then again for each time the truck relocates to a new site."* Needs a new task type or extension to the existing task model — capture start/arrival odometer readings, repeatable per site relocation within a single job.
- **Only one sample can be added per job.** *"front line app doesn't let you add additional samples. Its only one."* The Job Book's Sample task type needs to support repeatable entries, not a single fixed slot.
- **Job status doesn't progress with work-plan completion.** *"Job status progression does not move along with work plan completion."* Related to the already-known-open `projects.projectStage`-written-but-never-read gap (see Phase 07 item 11) — check whether this is the same root cause before treating it as a separate Front Line bug.
- **Completed jobs shouldn't be reschedulable.** *"completed jobs should not be able to be rescheduled, it should be either an edit to the data or a new dispatch request."* A workflow/state-machine gap — once a job reaches Completed, rescheduling it in place should be blocked; the two allowed paths are editing the existing completed record's data, or creating a fresh dispatch request.
- **PPE quantity handling.** *"In frontline app for Log PPE you can get a negative amount of materials, this shouldn't block equipment usage, but should ask or confirm if this is correct and if they force it... it should flag the ops manager that inventory is wrong and going negative. Regardless of inventory count we should track what was used and potentially even let us do write in items."* Specific, non-obvious behavior wanted: don't block on negative inventory, confirm-and-flag instead, and support free-text "write-in" material entries alongside the catalog. Related to Phase 07 item 9's materials-over-reservation gap — same underlying "inventory truth vs. field reality" tension, worth solving with one consistent philosophy across both.
- **Waste tracking for regulatory compliance.** *"We also need to track waste post site work completion if waste requires to be tracked per TCEQ and EPA guidelines, we will be using BioRemedy's 10 day storage permit and oily waste handler permit as well as many other permits the company holds. These permits should also be tracked and managed by the crm. We need to make sure we get disposal requests, receipts, and any other expenses needed to track total cost on jobs."* Two halves: (1) **field capture** of waste-tracking data belongs here in Front Line (what a worker records on-site); (2) **permit management and cost roll-up** is a bigger, ongoing-compliance concern — tracked in Phase 11, and the cost side connects to Phase 09 (Billing & Invoicing)'s P&L report. Do not build the capture UI without first deciding the permit data model in Phase 11 — the fields captured need to match what the permits actually require.
- **Sample-adjacent fields that should be photo captures.** *"on samples it mentions north view, sample interval, and container label. These are photos that should be uploaded during sampling."* Same item as Phase 07's item 7 — a new photo-capture task type for these three specific shots.
- **Flexible "+ activity" capture alongside the structured template.** *"We want the front line workers to fill in information in a structured way but also be able to note things as we progress... There should almost be a '+ activity' button and the front line worker can add different things into the report like notes, or additional samples, or a waste signature, or photos. This way the frontline worker follows their required template, but can add in additional info as needed since the front line environment may deviate from the template."* A real design principle, not just a feature request: the Job Book's template-driven work plan should stay the primary structure, but allow ad hoc additions (notes, extra samples, signatures, photos) that don't fit the predefined template steps. This has real design implications for the work-plan/task-gating model — it's not a small addition, it changes the assumption that the template fully describes what can happen on a job.
- **Research StreetSmart for reference.** *"look into streetsmart and see how granular the data can get for their connection. If looking at a few sample post work reports could help you get an understanding of what type of info we need to be gather that could be good."* A research task, not a build item — look at a comparable field-service product (StreetSmart) for how granular field data capture typically gets, before finalizing the task-type model above.
