# Phase 23 — Work Inbox & Capabilities (the Office Manager rework and cross-applet work)

**Status:** 🔵 Planned 2026-09-28. Not started. Owner decisions recorded below.

**Depends on:** Phase 12a/12b (live). Absorbs Phase 12 item 3 ("roles and permissions as data"), which 12a/12b did not build.

**Origin:** owner conversation 2026-09-25/28 — "there are a lot of notices, but how should an office manager help take care of those?", "the schedule panel or office manager seems rather useless in its current design", and "different users need access to parts of certain applets … I don't want to flood them with multiple applets … we need to explore this idea of cross work."

---

## Why this phase exists

### What the code says today (verified 2026-09-25)

**The Office Manager applet** (`workspaceModules.office`) is four views: Overview, Alerts, Compliance, Schedule.

- Overview and Alerts both render `getOfficeAlerts()` (`app.js` ~32443). It is a *derived, stateless* list from five sources: unresolved `projectAlerts`, negative-stock events (`liveInventoryAlerts()`), consumables below reorder (`getConsumableStatus()`), equipment with a high status tone (`getEquipmentStatus()`), and past-due invoice rows (`getFinanceRows()`). `renderOfficeAlert()` renders a card with a group badge, an "owner" string and text. **No card has an action.** Nothing is persisted, so nothing remembers that anyone looked at it, assigned it, or dealt with it offline. The same list reappears every morning.
- The notification bell is a *second, persisted* system (`notifications` collection, `raiseNotification()` ~20736) for permits, waste deadlines and field alerts, addressed to roles with per-user `readBy`. Its only actions are Open and Mark read. The two systems do not know about each other: a permit shows in the bell but not in Office › Alerts; low stock shows in Office › Alerts but not the bell.
- Schedule (`renderOfficeSchedulePage()`) lists `getScheduleEvents()` as cards. The Operations calendar (Phase 17) shows the same rows with more context and actions. The office copy adds nothing.
- Compliance is the one view with real content (permits, vendor documents, credential expiry — Phase 04/11).

**The access model** is one layer. `roleAccess` in `server.mjs` maps a role to domains; `collectionAccess` maps each collection to one domain; a request may write a collection iff one of its roles is in that domain. There is no distinction between reading and writing, and no per-record scope. Consequences:

- "Field Lead can see inventory but not enter POs" only holds by accident: Field Lead is not in the `inventory` domain at all, so they cannot open the Inventory workspace either — they see stock only through the material picker on a dispatch job (via `dispatch`).
- "A sales lead on a project can manage it and request dispatch" has no answer. Sales Manager/Account Manager are in `sales` and `customerDirectory` only. The only way to let them touch `dispatchJobs` or `jobRequests` is to grant Scheduler, which hands them the whole Jobs & Dispatch applet. That is the flooding the owner is describing.
- Office Manager is a member of every internal domain. Under this model it is "Admin minus identity", not a role — which is why its applet has nothing of its own to do.
- `projectAssignments` (5 live rows) is the record-scoped role table Phase 12 item 3 pointed at. Nothing reads it for authorization.

### What Phase 12 already said

Phase 12 item 3: *"Global role — what you can generally access. Project assignment role — what you're doing on a specific job. The second lives in `projectAssignments`."* 12a/12b shipped identity, sessions, audit and combinable roles, and left item 3 unbuilt. This phase is where it lands.

---

## Owner decisions (2026-09-28)

| # | Question | Decision |
|---|---|---|
| D1 | Who raises purchase orders? | **Office Manager and Inventory Manager both.** |
| D2 | A sales lead wants a dispatch on their own project. | **They submit a dispatch request; someone with the dispatch role approves it.** If the same person also holds the dispatch role, they go into the Jobs & Dispatch applet and run that workflow there — no shortcut from the sales side. |
| D3 | Who resolves a high-severity field alert? | **Project manager, sales lead or the office** — any of the three. |
| D4 | Does Compliance stay in the Office applet? | **Yes.** Permits, vendor documents and credential expiry stay under Compliance; the inbox links into it rather than replacing it. |

D2 maps directly onto what exists: the intake queue (`jobRequests`, Phase 07/B11) already is "someone submits, dispatch converts". The sales lead's capability is *create a job request on a project they lead*, and the dispatch team's existing Mark ready / Convert / Needs info loop is the approval. No new workflow, only a new door into it.

---

## Design

### 1. Three layers of access

| Layer | Answers | Where it lives | Exists today? |
|---|---|---|---|
| **Global role → domains** | Which applets do I see? Which collections may I read? | `roleAccess` + `workspaces[].roles` | Yes. Unchanged. |
| **Capability** | Which *actions* may I take? | New `capabilities` list + `roleCapabilities` map (data, seeded, editable under Users & access) | No. Today write = read. |
| **Assignment on a record** | Which actions may I take *on this one record*? | `projectAssignments.role` → `assignmentCapabilities` map | Table exists, nothing reads it. |

A server check becomes: `hasCapability(request, capability, { projectId })` = role grants it globally **or** the user has an assignment on that project whose assignment role grants it. Domain gating stays as the read gate and the fallback; capabilities are checked on the *write* paths that matter (below), not on every collection.

### 2. The capability list (keep it short)

| Capability | Global roles | Assignment roles | Notes |
|---|---|---|---|
| `inventory.read` | Office Mgr, Inventory Mgr, Ops Mgr, **Field Lead** | — | Field Lead gains the Inventory workspace read-only: stock, equipment. |
| `po.create` | Office Mgr, Inventory Mgr | — | D1. Field Lead sees the Purchase Orders tab greyed with "ask the office". |
| `po.receive` | Office Mgr, Inventory Mgr | — | |
| `project.edit` | Ops Mgr, Office Mgr | **Sales Lead, Project Manager** on that project | Edit scope, notes, stage, documents. |
| `project.close` | Ops Mgr | Project Manager on that project | Phase 09 close-project action. |
| `dispatch.request` | Ops Mgr, Scheduler, Office Mgr | **Sales Lead, Project Manager** on that project | Creates a `jobRequest` — D2. |
| `dispatch.approve` | Ops Mgr, Scheduler | — | Mark ready / Convert. Dispatch applet only. |
| `dispatch.schedule` | Ops Mgr, Scheduler | — | Crew, dates, equipment on a `dispatchJob`. |
| `alert.resolve` | Office Mgr, Ops Mgr | **Sales Lead, Project Manager** on that project | D3. |
| `invoice.issue` | Finance Mgr, Office Mgr | — | |
| `permit.manage` | Office Mgr | — | Compliance. |
| `inbox.assign` | Office Mgr, Ops Mgr | — | Assign/snooze/escalate inbox items for others. |

Admin holds everything. Client Portal holds none. Roles ↔ capabilities are data so the owner can move a line without a code change; the table above is the seed.

### 3. The record is the workspace (how cross work surfaces without new applets)

- **Applet nav stays role-based.** A Sales Manager sees the Sales View. They do not get Jobs & Dispatch unless they hold that role (D2).
- **Record pages become capability-based.** Project Detail shows *Edit*, *Request dispatch*, *Resolve alert* when the viewer holds the capability globally *or* via assignment on this project. A sales lead reaches their project from the opportunity and the account, as today; nothing is added to the Sales applet's nav.
- **One cross-applet surface: Home / My work.** The existing Home view gains two lists: *My records* (projects/opportunities/jobs I'm assigned on, from `projectAssignments` + `ownerEmployeeId` + `salesLead`) and *My inbox* (section 4). This is the only place cross-work is aggregated; everything else stays where it lives.
- **Sales applet gets nothing new** beyond the "Request dispatch" button that already exists on Project Detail as "New job request" (`open-job-request`) — it becomes capability-gated instead of role-gated.

### 4. The work inbox (replaces Office › Overview + Alerts + the bell's list)

One persisted collection, `workItems`, replacing the split between derived `getOfficeAlerts()` and persisted `notifications`:

```
workItems: {
  id, dedupeKey,            // idempotent, same trick as raiseNotification
  source,                   // "low-stock" | "negative-stock" | "equipment-down" | "past-due" |
                            // "permit" | "waste-deadline" | "field-alert" | "job-conflict" | "manual"
  severity,                 // "info" | "warning" | "critical"
  title, body, link,
  audienceRoles,            // who sees it unassigned (today's notification audience)
  ownerUserId,              // set on Assign; the item then shows in that person's My inbox
  status,                   // "open" | "assigned" | "snoozed" | "resolved" | "auto-cleared"
  snoozedUntil, resolvedAt, resolvedBy, resolution (note),
  projectId, accountId, inventoryItemId, permitId, ...   // whichever apply
  createdAt, version
}
```

Rules:

- **Derived conditions become rows the first time they are seen** (a sweep after load and after the relevant saves, like `sweepDeadlineNotifications()` today) and **auto-clear when the condition goes away** (stock back above reorder, invoice paid, permit renewed). A resolved row is not re-raised for the same key; a *new* key (next expiry date, next negative-stock event) is.
- **"Go and talk to someone" is a first-class outcome.** *Resolve with a note* records "Spoke to Priya 9/28, pump back Monday" and the item is gone. *Snooze until* hides it and returns it. *Assign to* hands it to a named user. Without this the notice comes back tomorrow with no memory — which is the actual reason the applet feels useless.
- **Each row shows one or two contextual actions** decided by `source` and the viewer's capabilities:

| Source | Primary action | Secondary |
|---|---|---|
| low-stock / negative-stock | **Create PO** (prefilled item + quantity to target) — `po.create` | Snooze |
| equipment-down | Open equipment | Assign to scheduler |
| past-due | Log collections call (activity + promise-to-pay date → snooze) | Open invoice |
| permit | Open in Compliance (D4) | Snooze |
| waste-deadline | Open project | Assign |
| field-alert | **Resolve** — `alert.resolve` (D3) | Open project, Assign |
| job-conflict | Acknowledge (existing) | Open job |
| manual | whatever the creator typed | — |

- The bell stays as the badge and a short list, reading `workItems` where `ownerUserId` is me or unassigned-in-my-audience. Mark read is replaced by the item's own status.
- **Aging.** Items show age; anything open past a threshold (default 3 days, per source) gets the red dot on the Office tab per the red-dot rule.

### 5. This week's readiness (replaces Office › Schedule)

Office does not need a second calendar. It needs to know what is going out that the office has not finished getting ready. A table of dispatch jobs and scheduled visits in the next N days (default 7, same window as Phase 07's intake feed) with a readiness column derived from existing checks:

- subcontractor on the job without customer approval (Phase 04 item 5 block)
- required paperwork missing (Phase 13 `documentRequirements`)
- an open PO for a material reserved on the job not yet received
- a permit the job's facility needs that is expiring before the job date
- a crew member's certification expiring before the job date (Phase 11 credential expiry)

Each row links to the thing to fix. This is the office's real relationship to the schedule: lead time, not the calendar itself. The existing `getJobReadiness()` covers the crew-side checks; the office-side checks are the new part.

### 6. What the Office applet becomes

| Today | After |
|---|---|
| Overview (metrics + same alert cards) | **Inbox** — grouped by owner / unassigned, aging, actions |
| Alerts (same cards again) | *removed* (folded into Inbox) |
| Compliance | **Compliance** — unchanged (D4); inbox permit items link here |
| Schedule (calendar cards) | **Readiness** — section 5 |
| — | **Purchase orders** — the PO list from Inventory, surfaced here too because D1 makes the office a buyer; same renderer, not a copy |

Audit rule applies before removing Overview/Alerts/Schedule: every field each card shows must be shown by the replacement.

---

## Out of scope

- Field-level permissions (Phase 12 already excluded them).
- Email/Teams delivery of inbox items — Phase 19.
- A general approvals engine. D2 is served by the existing intake queue; PO approval thresholds are not asked for.
- Changing the Front Line access model (`fieldProjections`, Phase 21) — it already is a capability-style model for field sessions and stays separate.

---

## Data model changes

- New collection `workItems` (above). `notifications` migrates into it (one-shot script; `readBy` → status "open" with the reader dropped, since read ≠ handled) and is then retired.
- New seed tables `capabilities`, `roleCapabilities`, `assignmentCapabilities` — data, editable in Identity & Sync › Users & access.
- `projectAssignments.role` gains a controlled vocabulary: `Sales Lead`, `Project Manager`, `Technician`, `Sampler`, `Dispatcher` (the Phase 12 list). Existing free-text values are mapped by the migration script; unmapped ones are listed for the owner.
- `projects.salesLead` (a display name today) gets a companion `salesLeadEmployeeId`, or the sales lead is written as a `projectAssignments` row on project creation from a Won opportunity (preferred — one source of truth).
- `docs/database-handoff-map.md` updated in the same session.

---

## Verification / done criteria

- Server test: a Sales Manager with a `Sales Lead` assignment can POST a `jobRequest` for that project and gets 403 for another project; a Field Lead gets 200 on `GET inventoryItems` and 403 on `POST purchaseOrders`; an Inventory Manager gets 200 on `POST purchaseOrders` (D1); Admin acting as Field Lead is refused the same way.
- Browser: sign in as a sales lead, open their project, click Request dispatch, see it appear in the intake queue; sign in as Scheduler, Mark ready and convert. Sign in as Office Manager, Inbox shows a low-stock item, Create PO opens prefilled, saving the PO auto-clears the item; Resolve with a note on a field alert removes it and the note appears on the project timeline.
- Smoke green; no `NaN`/`undefined`; red-dot rule honoured on the Office tab.

---

## Open decisions

1. Assignment vocabulary: is `Project Manager` on `projectAssignments` the same person as `projects.projectManager` today, and should creation from a Won opportunity write both the Sales Lead and PM rows automatically?
2. Aging threshold per source before the red dot (proposed default 3 days).
3. Should `dispatch.request` from a sales lead require a template/work plan choice at submission, or is that dispatch's job at conversion (today: conversion)?

---

## Corrections found during implementation

*(none yet)*
