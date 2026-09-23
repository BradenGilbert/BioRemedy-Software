# Phase 17 — Operations Console & Inventory Density

**Status:** Shipped 2026-09-23 — all 7 items live and verified via Playwright: All Projects table, class-scoped clickable metric cards, Scheduled/Multi-Stage tables, indented nav sub-options, a real month-grid calendar, filterable map, and searchable/sortable inventory tables, all on one shared `renderDataTable()` component.
**Depends on:** Phase 07 (dispatch data and readiness are what these views read), Phase 15 (project tabs are where these tables navigate to)
**Estimated sessions:** 2–3
**Source:** `docs/roadmap/notes-2026-09-22.md` items 27–34, all verified against code 2026-09-22

---

## Why this phase exists

The Operations applet was built card-first, for a demo-sized dataset. At real volume it stops working: cards do not scan, the same four metrics repeat unfiltered on three different views, and nothing a metric shows is clickable. Inventory has the same problem waiting — the owner expects **hundreds** of consumables and a large heavy-equipment fleet, and both are rendered one panel per item today.

This is density and navigation work, not data-model work. Almost every item is a rendering change against data that already exists — which is why it is one phase rather than scattered across several.

---

## In scope

### 1. All Projects: a real projects table

> *"under the 6 operatons metric panels I think we create a table that lists all of the projects… columns for project name, account, type of project ( ER, Scheduled, Multi-stage), date, scheduled dispatch (yes or no), dispatch work started, stage, alerts"*

`renderOperationsAllProjects()` (`app.js:7383`) is the surface. Add the table with the owner's columns; every one is derivable today — `dispatchJobsForProject()` answers "scheduled dispatch" and "work started," `getJobProgress()`/`projectStage` answers stage (now that Phase 07 item 11 made the stage real), `alertsForJob()` answers alerts.

> *"the Completed Dispatch Jobs and Non-dispatch projects panels don't need to be dispayed here but should be kept for later use."*

**Keep the code, stop rendering them here.** The instruction is explicit and matches this project's working rule about auditing before deleting legacy UI: confirm every field those two panels show is reachable from the new table (or somewhere else) before they stop being displayed, and leave the render functions in place.

### 2. The four metric cards become filtered and clickable

Today `renderOperationsMetrics()` (`app.js:8227-8257`) computes **one unfiltered set** — Active jobs, Emergency response, Open alerts, Resource blocks — and all three class views (`renderOperationsScheduled()`, `renderOperationsEmergency()`, `renderOperationsRemediation()`) render the same function. So the Scheduled Work view's "Active jobs" number counts emergency jobs too, and its "Emergency response" card is meaningless on that page. That is the root of items 30–32.

Rework it into one parameterised metric strip that takes a project-class filter and renders each card as a link into a filtered table:

| View | Card 1 | Card 2 | Card 3 | Card 4 |
|---|---|---|---|---|
| Scheduled Work | Active jobs | **Projects without scheduled dispatches** | Open alerts | Resource blocks |
| Emergency Response | Active jobs | Emergency response | Open alerts | Resource blocks |
| Multi-Stage Remediation | Active jobs | **Projects without scheduled dispatches** | Open alerts | Resource blocks |

All counts filtered to that view's `jobClass`. Every card navigates to a table of exactly the rows it counted — the count and the table must come from one query, not two, or they will disagree.

> *The Multi-Stage note says "filtered for Emergency Response projects."* Read as a copy/paste slip from the Emergency note above it — see `notes-2026-09-22.md`. Multi-Stage filters for Multi-Stage.

### 3. Replace the card lists with tables

- **Scheduled Work:** drop "Scheduled work queue" and "Scheduled project cards"; one table of scheduled-work projects with the same column vocabulary as item 1.
- **Emergency Response:** *"The 'Active emergency jobs', and 'Emergency approvals and alerts' panels are both good as they are"* — leave both. Remove the "Log material" and "Log equipment" header buttons, which the owner says are not needed there. Note that the Scheduled Work view has the same two buttons; the note only asks for the emergency view, so leave Scheduled Work's alone unless told otherwise.
- **Multi-Stage:** the remediation cards carry stage ladders, sample counts and spatial-file counts that a table row cannot hold well. Reworking the metric cards may be enough; confirm with the owner before replacing these cards wholesale.

### 4. Left nav: sub-options that look like sub-options

> *"we need the 'Scheduled work', 'Emergency response', 'multi-stage' to have a different look, they are sub options of 'all Projects' but we don't want to hide them or collapse them."*

Indent and restyle those three under All Projects. No collapsing, no hiding, no accordion — they stay visible and one click away. Purely nav CSS plus the nav structure that renders the workspace menu.

### 5. Calendar: 30 days, not 7

> *"the Calendar view should be a 30 day calendar instead of a 7 day view."*

`buildCalendarDays()` (`app.js:22301-22313`) returns exactly 7 days, rendered by `renderCalendarBoard()` (`app.js:8302`) as a flat strip. Thirty days is a **month grid**, not a longer strip — weekday columns, week rows, dense day cells showing counts with detail on click. That is a rewrite of the board, not a loop bound change, and it is the largest single item in this phase.

Note that the Jobs & Dispatch applet has its own separate calendar (`getDispatchCalendarDays()`, going from 5 days to 7 in Phase 07's items). Two calendars with different windows is defensible — one is a month overview, one is the dispatch working week — but they should at least share day-cell rendering. Decide deliberately rather than by accident.

### 6. Map filters

> *"the map view should have the ability to filter displayed information based on different filters. Not sure what all we want those to be."*

The owner explicitly has not decided the filter set. From what `renderOperationsMapBoard()` (`app.js:8342`) already plots, the useful candidates are: project class, project stage/status, open alerts only, date range, account, and point type (facility vs. GPS location vs. active job). Propose that set, ship it behind a filter panel that is easy to add to, and let real use decide the rest.

### 7. Inventory: searchable tables

> *"consumables, are listed on individual panels, inorder to save space we should list these in a table that is searchable. We anticipate having hundreds of consumables. For equipment we should also put these in a table that is clickable… This table should also be sorted by heavy equipment, ppe, testing equipment, etc."*

`renderInventoryConsumables()` (`app.js:11021`) renders a `renderConsumableCard()` per item; `renderInventoryEquipment()` (`app.js:11206`) is the equipment equivalent. Both become tables with search, sortable columns, and a row click through to the existing detail views (`renderConsumableDetail()` already exists — the card list is not the only path).

**Equipment categories** (heavy equipment, PPE, testing equipment, …) need somewhere to live. Check whether `equipmentAssets` already carries a usable type field before adding one — and if a category field is added, align it with the equipment sections in `docs/uploaded files/2026 RATES.xlsx` (Heavy Equipment, Trailers, Marine, Pumps, Hoses/Fittings, Generators/Air Compressors, Flood Water Removal) so the catalog and the rate card do not end up with two different taxonomies. That file is also the best available inventory of what the fleet actually contains.

Use the shared list-filter/search component Phase 07 item 15 calls for. This phase produces five or six tables; five or six bespoke search boxes would be a bad outcome.

---

## Definition of done

- [x] All Projects shows a projects table with the owner's columns (project, account, type, date, scheduled dispatch, work started, stage, alerts); `renderOperationsDispatchJobRow`/`renderNonDispatchedProjectRow`/`renderProjectOverviewCard` are no longer called from this view but still exist in code
- [x] Each class view's metric cards count only that class, and card 1/2/3 (not Resource Blocks, which isn't a project-row count) filter the same `operationsClassRows()` query the table reads
- [x] Scheduled Work's second card reads "Projects without scheduled dispatches" and filters the table when clicked (Multi-Stage shares the same card; Emergency's second card is "Emergency response," per the doc's own table)
- [x] The three class views read as sub-options of All Projects in the nav (`nav-item--sub`), uncollapsed
- [x] The operations calendar is a real month grid (weekday columns, week rows, padded leading/trailing days), not a longer flat strip
- [x] The operations map can be filtered (project class, point type, account, status-contains, date range, open-alerts-only)
- [x] Consumables and equipment are searchable, sortable tables that click through to their existing detail views; equipment sorts by category by default
- [x] Every table and search box in this phase uses one shared component (`renderDataTable`/`getTableState`)

---

## Open decisions

- **Multi-Stage cards:** replace with a table, or keep the cards and only fix the metrics?
- **Map filter set** — confirm the proposed list.
- **Two calendars** (operations month vs. dispatch week) — keep both, or unify?
- **Equipment categories:** reuse an existing field, or add one aligned to the rate sheet's sections?

---

## Corrections found during implementation

- **Item 3's Emergency Response note was already true.** The doc says to "remove the Log material and Log equipment header buttons" from the Emergency view, but the running code's `renderOperationsEmergency()` toolbar only ever had a "Field alert" button — no Log material/Log equipment buttons to remove. Scheduled Work has those two buttons (left alone, as the doc says). No code change needed for this sub-item.
- **Point-type map filter isn't quite "facility vs. GPS location vs. active job."** `getMapMarkers()` only ever plots `state.backend.locations` (GPS points) — facilities are not plotted on this map at all today, so a facility/location/job three-way split doesn't exist in the data. Point type instead distinguishes "asset ping" (OwnTracks pings and unlinked GPS points) from "project location" (a GPS point tied to a dispatched job), which is the real distinction the current marker source supports. Plotting facilities separately is a real gap, not addressed here.
- **Equipment categories were not realigned to the rate sheet's sections.** The existing `equipmentCategoryConfig` taxonomy (Vehicle, Vacuum / Vactron, Pump, Air Filtration, General equipment) is what the new table sorts/groups by. Aligning it to `2026 RATES.xlsx`'s sections (Heavy Equipment, Trailers, Marine, Pumps, Hoses/Fittings, Generators/Air Compressors, Flood Water Removal, plus PPE/testing equipment) is real work that overlaps with Phase 08's still-outstanding rate-card rework (which already owns importing that sheet) — doing it here would mean either duplicating that import or building a second, temporary taxonomy. Deferred to Phase 08.
- **"Dispatch work started"** (the All Projects table column) isn't a status the app defines explicitly. Implemented as "any dispatch job on this project whose status is past `dispatched`" (`en_route`, `on_site`, `in_progress`, `field_complete`, `office_review`, `closed`, `cancelled`) — i.e., the crew is past pure scheduling. `dispatchWorkHasStarted()` documents the assumption inline; revisit if dispatch adds an explicit "in progress" flag that should own this instead.

---

## Decisions locked 2026-09-22 (owner)

- **Multi-Stage view (Q26):** replace the cards with a table, same as Scheduled Work. The stage ladder, sample counts and spatial-file counts the cards carried need to survive as columns or be dropped deliberately — decide per column when building, do not lose them silently.
- **Map filters (Q27):** the proposed set is confirmed — project class, stage/status, open alerts only, date range, account, point type (facility / GPS location / active job).
- **Two calendars (Q28):** keep both; share the day-cell rendering.
- **Equipment categories (Q29):** yes, aligned to the rate sheet's sections (Heavy Equipment, Trailers, Marine, Pumps, Hoses/Fittings, Generators/Air Compressors, Flood Water Removal, plus PPE and testing equipment). This ties into Phase 08's locked decision to import the rate sheet's items into the operational catalogs — same taxonomy, one import.
- **Shared list-filter component (Q31):** confirmed. One component, adopted by the Job Register (Phase 07), this phase's tables, and the Account / Contact / Opportunity list views (Phases 03, 05, 06). Whoever builds it first owns it; the rest is adoption.
