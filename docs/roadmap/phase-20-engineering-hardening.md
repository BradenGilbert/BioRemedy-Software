# Phase 20 — Engineering Hardening

**Status:** In progress. Item 0 (static-file allowlist) shipped 2026-09-23 on its own commit and is live. Written 2026-09-23 from a code review of `server.mjs`, the client data layer and the live data, after the sprint Waves 0–5b and the owner's bug list.
**Depends on:** Nothing. Every item here is independent of the feature phases and most of it is server-side.
**Sequencing:** Item 0 ships **before the next tunnel session**, on its own commit. Items 1–6 are one wave (call it Wave 5c), **before Wave 6 / Phase 12** — Phase 12's done criteria then inherit the tests below. Item 7 is doc hygiene that rides along with any of the others.
**Two parts:** Part A (items 0–7) is the engineering plumbing. **Part B** (B1–B12, at the bottom) is an **unsorted backlog** of sales/project/billing flow findings from the same review, parked here at the owner's request until a triage session sorts them into the phases that own each entity.
**Estimated sessions:** 1 for item 0 (minutes), 1–2 for items 1–6, 0 extra for item 7.
**Source:** engineering review 2026-09-23, verified against a scratch copy of the server (`PORT=4199`, `CRM_DATA_DIR` pointed at a copy of `backend.json`).

---

## Why this phase exists

The feature roadmap (Phases 02–18) is nearly done. What is left before real users is not features — it is the plumbing that a prototype gets away with and a pilot does not. None of the items below appear in any other phase doc, and several of them are prerequisites for Phase 12's guarantees to mean anything. Phase 00 explicitly deferred "CI, linting, formatters, a test suite" and "splitting `app.js`"; this phase re-opens only the first of those, narrowly, and leaves the split deferred.

The one item that cannot wait is item 0: the server exposes the entire project folder, including the live database, to anyone who can reach the URL. Phase 12's role enforcement is irrelevant while that is true.

---

## In scope

### 0. Static-file allowlist — **do today**

**Confirmed 2026-09-23 on a scratch server.** The static branch of `server.mjs` resolves any request path against the project root and serves whatever exists there, with no role check (the `X-CRM-Role` header only gates `/api/*`). Plain unauthenticated `GET`s returned:

| Request | Result |
|---|---|
| `/data/backend.json` | 200, 1.5 MB — the entire shared database |
| `/server.mjs` | 200 — full server source, including the role table |
| `/docs/uploaded files/2026 RATES.xlsx` | 200 — the real 2026 rate sheet |
| `/.git/config` | 200 — git internals (any object under `.git/` is reachable the same way) |
| `/package.json` | 200 |

The cloudflared logs in the project root show this server has been on a public tunnel. The `filePath.startsWith(root)` check only prevents escaping *above* the root; it does nothing about what is *inside* it.

**Fix:** serve only an explicit allowlist — `index.html`, `app.js`, `styles.css`, `service-worker.js`, `manifest.webmanifest`, and anything under `public/`. Everything else on the static branch returns 404 (not the SPA fallback — a 404 for `/data/backend.json` must not hand back `index.html` with a 200, which would hide the problem from the test below). Keep the SPA fallback for extensionless view paths only.

**Verification:**
- [x] `GET /data/backend.json`, `/server.mjs`, `/.git/config`, `/docs/uploaded files/2026 RATES.xlsx`, `/data/uploads/<any>` all return 404 with no body from the file *(shipped 2026-09-23 — also `/package.json`, `/CLAUDE.md`, the cloudflared logs, the `.docx` notes in the root, `/public/../data/backend.json`, and bare directories such as `/public`, `/data`, `/.git`; the 404 body is the nine bytes "Not found")*
- [x] `GET /`, `/app.js`, `/styles.css`, `/public/vendor/leaflet/leaflet.js` still return 200 *(and `/service-worker.js`, `/manifest.webmanifest`, `/public/favicon.svg`, the brand images; extensionless view paths still fall back to `index.html`)*
- [x] The Front Line simulator and every map still load (Leaflet, three.js, brand images are all under `public/`) *(Home, Operations map, Race Track, Front Line, facility detail: zero failed requests, zero console errors)*
- [ ] These five requests become a permanent part of item 6's smoke script, and Phase 12 adds them to its own done criteria

### 1. Optimistic concurrency — stop losing edits silently

The `POST /api/backend/{collection}` route replaces the whole record by `id`. There is no version check. Two people who open the same account and both save lose whichever edit landed first, with no error on either side. `serializeApi()` (2026-09-23) fixed *torn* writes; it does nothing for *overwritten* ones. Phase 14's done criteria list "two concurrent users editing the same record behave correctly" as the thing a JSON file cannot do — it can, and it should before the pilot, not after Postgres.

**Build:**
- Every record gets a server-stamped `updatedAt` (many already carry one, set by the client; the server must own it) and a monotonically increasing `version` integer.
- A save carries the `version` it was read at. If the stored version is newer, the server returns **409** with the current record in the body.
- The client, on 409: refresh the record, re-render the dialog with the newer values, and toast "This record was changed by someone else — your edit was not saved. Review and try again." No silent merge.
- Server-originated writes (weather capture, ledger, purchase-order receive, QBO export) bump the version like any other.
- Records created before this ships have no `version`; treat missing as 0 and accept the first save.

**Verification:**
- [ ] Two browser contexts open the same account; both edit; second save is refused with 409 and the dialog shows the first user's value
- [ ] A normal single-user edit round-trips with no extra prompts
- [ ] `saveJobRequest` → upload → refresh still works (multi-step flows that save the same record twice in one action pass the fresh version forward)

### 2. Saves return the record; stop re-downloading the whole backend

`saveBackendRecord()` defaults to `refresh: true`, which re-fetches `/api/backend` — 1.2 MB for an Office Manager today, growing with every job action — after **every** save. There are ~129 awaited API calls in the client, most on that default. On a field phone that is a visible pause per tap.

**Build:** the POST already returns the saved record. Merge it into `state.backend[collection]` by `id` and re-run only the projection for that collection (the `state.accounts = …` style derivations in `refreshBackendState()`), then render. Keep the full refresh for navigation between views, the explicit refresh action, and the 409 path in item 1. Flip the default to `refresh: false` and audit the call sites that genuinely need a full reload (the seed loop, multi-collection flows like `convertJobRequest`).

**Verification:**
- [ ] Edit an account name; the list and the header update with no `/api/backend` GET in the network log
- [ ] Item 6's smoke script passes unchanged
- [ ] Front Line task submit on a throttled "Slow 3G" profile completes in under 2 s

### 3. Scheduled, off-machine backups

Only `npm run backup` exists (manual, rolling 10, into `data/backups/` on the same disk as the live file). Phase 00's restore test proved the *file* can be restored; nothing guarantees a recent one exists.

**Build:**
- The server takes a snapshot on startup and every N hours (default 4) using the existing `scripts/backup-data.mjs` logic, into `data/backups/`.
- A second copy of the newest snapshot goes to an **off-machine** folder — `CRM_BACKUP_DIR`, pointed at a OneDrive-synced path (the company runs on Microsoft 365; no new service needed). Skip silently when unset, log once at startup that off-machine backups are off.
- `data/uploads/` is included in the off-machine copy (it is not in git and holds real customer documents).
- Retention: rolling 10 local, rolling 30 off-machine.

**Verification:**
- [ ] Start the server; a snapshot appears within a minute; a second appears after the interval (test with `CRM_BACKUP_INTERVAL_MINUTES=1`)
- [ ] The off-machine folder holds the newest snapshot and an `uploads/` copy
- [ ] Restore from the off-machine copy on a scratch server; row counts match

### 4. Demo seed data is gated, not self-healing

`ensureBackendSeedData()` in `app.js` re-creates the demo accounts, contacts, projects, tasks, activities and more whenever any of those collections is empty on load. If the pilot begins by clearing demo data, the next page load puts Riverbend Manufacturing back. The seed arrays (`seedAccounts` … `seedSpatialData`, roughly `app.js:857–1400`) also ship to every browser for no reason.

**Build:**
- Seeding moves to the server, behind `CRM_SEED_DEMO=1`. Default off. With it off, an empty collection stays empty.
- The client seed arrays and `ensureBackendSeedData()` are deleted. `server.mjs` already carries `defaultBackend`; the demo rows join it under the flag.
- One-shot `scripts/reset-demo-data.mjs` for the demo/tunnel instance, so "put the demo back" is an explicit act.

**Verification:**
- [ ] With the flag unset, delete every account on a scratch copy, reload — still zero accounts
- [ ] With the flag set, the demo set appears exactly once and is not duplicated on a second load

### 5. Soft delete, cascade, and the orphan clean-up

There is no delete path in the app. Some collections honour a `deletedAt` flag on read (99 client references, 2 server ones) but nothing sets it from the UI, so records get hand-deleted from the JSON — which is how the audit's orphans happened: 9 dispatch jobs and 8 job requests pointing at 5 missing projects; 6 dispatch jobs, 2 opportunities, 5 facilities, 2 addresses, 1 vendor profile and 6 job requests pointing at 6 missing accounts; 1 stakeholder link to a missing contact; 2 dispatch resources referencing equipment that never existed; 2 GPS points with junk tags.

**Build:**
- `DELETE /api/backend/{collection}/{id}` sets `deletedAt` (never removes the row). Role-gated like POST.
- A cascade table on the server: deleting an account soft-deletes its facilities, addresses, contacts' account links (not the contacts), opportunities, projects, job requests; deleting a project soft-deletes its job requests and dispatch jobs; and so on. The table is data, in one place, so Phase 14 can turn it into foreign-key rules.
- Every list, lookup and `find*` helper filters `deletedAt` consistently — today only some do.
- "Delete" buttons on Account, Contact, Opportunity, Project, Facility, Dispatch job, with a confirm that names what will cascade.
- `scripts/clean-orphans.mjs`: reports the orphans, then applies the owner's choice — see Open decisions.

**Verification:**
- [ ] Delete an account on a scratch copy; its facilities and opportunities disappear from every list and the referential-integrity pass reports zero new orphans
- [ ] A deleted record's id still resolves in the audit/timeline (no "Unknown account" on history)
- [ ] The orphan script's report matches the audit's counts before it runs and is empty after

### 6. A kept smoke-test script

The 2026-09-23 audit found 202 potential crash sites in 72 save handlers with a throwaway fuzz. Keep it. Playwright and Chromium are available (see `CLAUDE.md`).

**Build:** `scripts/smoke.mjs` that starts a scratch server on a copy of `backend.json`, then:
- opens every view and every detail tab for the first record of each kind
- presses every `data-action` opener and re-saves every edit dialog unchanged
- fails on any console error, any uncaught rejection, any `NaN`, `undefined`, `null` or `[object Object]` in rendered text
- runs the item 0 static-file checks and the forged-`X-CRM-Role` check (which should *pass* today and *fail* — i.e. be refused — once Phase 12 ships; the script flips expectation on a flag)
- runs the referential-integrity pass and fails on new orphans

Run it before every commit. It is one script, not a framework; no CI, no linting, no unit tests — Phase 00's deferral stands for those.

**Verification:**
- [ ] `node scripts/smoke.mjs` passes on `main`
- [ ] Reintroduce one of the fixed null-dropdown bugs on a branch; the script catches it

### 7. Doc and repo hygiene

Small, all found during the same review; do them in whichever session touches the neighbourhood.

- [ ] **`phase-14-postgres-migration.md`** used pre-renumbering phase numbers ("Depends on: Phases 01–07", "identity / RBAC / audit (06)", "entity attachments (07)") — **fixed 2026-09-23** in this session — and its body still says "cut over domain by domain," which the locked Q47 decision reverses to big bang. Rewrite the "Suggested sequence" and "In scope §3" to match the decision.
- [ ] **`README.md`** still describes an offline-first IndexedDB app with a sync placeholder. It is the first thing anyone reads on GitHub. Replace with a short pointer to `CLAUDE.md` and `docs/roadmap/`.
- [ ] `.gitignore` and `scripts/backup-data.mjs` say the JSON file is retired "at Phase 08" — that is Phase 14.
- [ ] `phase-12-identity-and-audit.md` should split into **12a** (server sessions with local sign-in, API role enforcement, audit, revocation, break-glass — no Entra dependency, unblocks Phase 13 and the pilot) and **12b** (the Entra provider, once the tenant exists). OUTSTANDING already calls Wave 6 "the non-Entra half"; the phase doc should say so.
- [ ] `phase-13-documents.md` should sequence the requirement → instance → review model **first** and the file tabs second; the store is proven by four existing upload routes, the workflow is what unblocks Phases 04 and 06.
- [ ] Twenty-four of fifty dispatch jobs are `draft`, nineteen of them dated July — demo noise that inflates every "Blocked" count. Clear with item 5's script.

---

## Out of scope

- **Splitting `app.js`.** Phase 00 deferred it and nothing above needs it. Revisit after the pilot.
- **CI, linting, unit tests.** Item 6 is one script run by hand.
- **Rate limiting, HTTPS termination, headers hardening.** The tunnel provides TLS; the rest is Phase 12 / hosting.
- **Moving files to object storage.** Phase 13/14.

---

## Data model changes

- Every record: `version` (integer), server-owned `updatedAt`. Update `docs/database-handoff-map.md` when item 1 ships.
- `deletedAt` becomes universal and server-enforced (item 5). No new collections.

---

## Verification / done criteria

- [ ] Item 0's five 404s hold on the live server, not just scratch
- [ ] A concurrent edit is refused with 409 and the user sees why
- [ ] No `/api/backend` GET after an ordinary save
- [ ] A backup younger than the interval exists on the off-machine folder at all times while the server runs
- [ ] Clearing demo data stays cleared
- [ ] The orphan report is empty and a delete cascades correctly
- [ ] `scripts/smoke.mjs` exists, passes, and is mentioned in `CLAUDE.md` under "Click-test UI work"

---

## Open decisions

- **Orphans (item 5): soft-delete or recreate the parents?** Recreating means inventing 5 projects and 6 accounts from the children's `customerName`/`projectName` strings; soft-deleting loses 15 dispatch jobs' history from view. Recommendation: recreate the 6 accounts (the names are known and they are probably real prospects), soft-delete everything hanging off the 5 missing projects unless the owner recognises them.
- **Backup destination (item 3):** which OneDrive/SharePoint path. Needs a folder the server's user account can write to.
- **Should item 1's 409 ever auto-merge?** Recommendation: no. Field-by-field merge is where silent corruption comes from; the pilot is small enough that "reload and redo" is fine.

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*

---

# Part B — Sales, project and billing flow findings (unsorted backlog)

**Added 2026-09-23.** The same review traced the flow from opportunity → project → job request → dispatch job → invoice, in code and against the live data. These are **not yet triaged** — the owner asked for them written down here so they can be sorted later. Each one records what the code does, what the live data shows, and a suggested fix. When one is picked up, move it to the phase that owns the entity (06 for opportunities, 15 for projects, 07 for dispatch, 09 for billing) and leave a one-line pointer here.

Nothing in Part B is a bug in the "it crashes" sense. They are places where the model has two answers to one question, or where a record can fall off the path that billing and reporting depend on.

### B1. Won and Lost have two sources of truth on the opportunity

- **Code:** `opportunities.stage` (the six-step ladder, ending in Won) and `opportunities.status` (Open / Won / Lost) both exist. Filters, chips and the account page all test `stage === "Won" || status === "Won"`. Lost exists only as a status; a Lost deal keeps whatever stage it died in.
- **Live data:** 5 opportunities are in stage Won; 4 of them still have `status: "Open"`. 1 has no status at all.
- **Missing:** no lost-reason field exists anywhere (`lostReason`, `lossReason`, `competitorWon` — none). Win/loss reporting cannot be built on this data.
- **Suggested fix:** `stage` is the pipeline position; Open/Won/Lost is derived from it. One explicit "Mark lost" action that captures a reason (curated list), the competitor if any, and a note, and writes a timeline entry. Migrate the four inconsistent records.
- **Owner decision needed:** the lost-reason vocabulary.

### B2. Winning does not owe a project

- **Code:** `maybeOfferProjectForWonOpportunity()` asks "Create a project?" in a `window.confirm`. Declining ends the flow. Nothing lists Won opportunities without a project.
- **Live data:** 1 of 5 Won opportunities has no project.
- **Also:** the locked Phase 15 rule says "closing amends the opportunity," but `closeProject()` writes only to the project — the opportunity never learns its project closed, what it cost, or what it invoiced.
- **Suggested fix:** a "Won, no project" alert with the red-dot treatment (opportunity row, Won chip, and the operations All Projects header), and a write-back on `closeProject()` that stamps `actualCloseDate`, the final invoiced amount and the margin onto the opportunity.

### B3. Nearly half of dispatch work is invisible to billing

- **Code:** invoices and the close report are per project (`invoices.find(projectId)`, `buildProjectCostReport(project)`). `saveJobRequest()` accepts an empty `projectId`; `convertJobRequest()` carries the empty value onto the dispatch job. `openJobRequestDialog(accountId, opportunityId, projectId)` takes an opportunity but the saved request has no `opportunityId` field.
- **Live data:** 22 of 50 dispatch jobs have no project (3 of them already closed). 0 of 33 job requests carry an opportunity. Those 22 jobs can never be invoiced, close-reported, or shown on a project's Live tab.
- **Suggested fix:** a dispatch job must have a project. When a request arrives without one, create a lightweight project from the account + service category, exactly as the Phase 16 emergency intake already does. Store `opportunityId` on the request when it came from a deal.

### B4. Quotes have no life after they are sent

- **Code:** `quotes.statusCode` is never set, so every quote renders as "Draft". `effectiveTo` is auto-filled 30 days out (Phase 08) but nothing checks it — an open Negotiation deal whose quote expired three weeks ago looks identical to a live one. The Negotiation gate checks only that `quoteId` is set. "Quote signed" (`quoteSignedStatus`) is a hand-set dropdown on the opportunity, unconnected to the quote record.
- **Live data:** 11 quotes, all statusless; 3 have `effectiveTo` in July/August 2026, i.e. already expired.
- **Suggested fix:** a quote status of Draft → Sent → Accepted / Declined / Expired (Expired derived from `effectiveTo`), a red dot on the opportunity when the current quote is expired, and the Won gate reading the quote's Accepted state (or, once Phase 13 lands, the signed document instance) instead of the dropdown. Phase 19 Stage 1's "Send" action sets Sent.

### B5. Nothing compares what was sold to what was billed

- **Code:** `draftInvoice…` builds lines from field records; `buildProjectCostReport()` prices real usage. Neither is laid against the quote lines the project carries as its "priced baseline" (`projects.quoteId`). `notToExceed` exists on projects and opportunities and is only ever *displayed* as a badge — nothing alerts when cost passes it or the budget.
- **Live data:** 1 of 14 projects has an NTE. 5 projects have invoices; 5 are closed; one closed project has no invoice.
- **Suggested fix:** a quoted-vs-actual section on the close report and on the invoice draft (per line where product ids match, else per section), a project alert when accumulated cost exceeds NTE or budget, and a "closed, not invoiced" chip on the finance list.

### B6. Stale deals are silent

- **Code:** accounts have a "No touch in 30 days" quick-filter chip. Opportunities have none. `stageAgeDays` is computed from `updatedAt`, so any edit (a note, a tag) resets it — it measures "days since anyone touched the record," not time in stage. `nextActivityDate` exists but overdue is not surfaced.
- **Live data:** 8 of 14 open deals have a next activity date; 1 open deal has not been updated since July.
- **Suggested fix:** stamp `stageEnteredAt` on every stage move (and backfill from `updatedAt` once), add an overdue-next-activity red dot, and a per-stage age threshold that drives a "Stale" chip. Together these are the weekly pipeline view — the original foundation doc's "what reports does management need weekly?" was never answered; this is the first candidate.

### B7. Multi-Stage Remediation has no schedule

- **Code:** the three project classes differ only in filtering and metric cards. A quarterly monitoring program or a sampling campaign is a series of planned visits, but each visit is a manual job request. Phase 15's Plan tab named "sample schedule options" and it was not built.
- **Suggested fix:** a planned-visits list on the project Plan tab (date or cadence, service category, template, assigned lead) that generates a job request N days ahead of each visit and shows the next one on the project header next to "Awaiting lab results." This is also what would make the operations calendar useful more than a week out.

### B8. Projects repeat the dual-truth problem

- **Code:** a project carries `status` (Pre-mobilization / Awarded / Active dispatch / Complete / Cancelled), `projectStage` (Intake → Closeout) and `activePhase` (a copy of the stage). Different panels read different ones.
- **Live data:** 6 of 14 projects have no `projectStage`; `status` and `projectStage` disagree on several (e.g. "Pre-mobilization" with stage Closeout).
- **Suggested fix:** same as B1 — `projectStage` is the truth (Phase 07 item 11 and the 2026-09-23 "honest stage" work already made it live), `status` is derived (Cancelled and Complete stay explicit), `activePhase` is dropped. Migrate.

### B9. Demo draft dispatch jobs inflate every "Blocked" count

- **Live data:** 24 of 50 dispatch jobs are `draft`; 19 are dated July 2026 and belong to the original seed. Every draft is "Blocked" by definition, so the dispatch metrics and the Resource Blocks card are mostly counting noise.
- **Suggested fix:** clear them with Part A item 5's script (soft-delete). Decide with the owner which, if any, are real.

### B10. Account lifecycle status could be derived instead of decided

- **Live data:** all 14 accounts have an empty `status`. Q54 (account lifecycle vocabulary) is back-burnered because the values were never laid side by side.
- **Suggested fix:** derive it — Prospect (no Won deal, no invoice) → Customer (first Won deal or first invoice) → Dormant (no activity, no open deal, no open project in N days) — and show the derived value with the rule in a tooltip. That gives the owner real values to react to, which is what Q54 was waiting on. Vendor stays an `accountType`, not a status.

### B11. "Needs information" has no return loop

- **Live data:** 1 of 33 job requests is in "Needs information" with nothing recording who was asked, what is missing, or when.
- **Suggested fix:** the status change asks for the missing items and an owner (defaults to the request's `receivedBy`), writes a task for them, and the intake feed shows the request with the ask. Small.

### B12. Contacts: account role vs. job title

- **Glossary:** says the split was "locked 2026-09-16, not yet built" and slotted into Phase 05 item 8. Phase 05's status line says the phase is complete and does not mention item 8. **Verify** which is true before assuming either; if it was never built, it is a Phase 05 leftover, not a new item.

---

### Sorting guide (for the triage session)

| Pick first if the goal is… | Items |
|---|---|
| Money is trustworthy | B3, B5, B4 |
| Sales can see the pipeline honestly | B1, B6, B2 |
| The data model stops lying | B8, B1, B10 |
| Ops runs long programs | B7 |
| Cheap clean-ups | B9, B11, B12 |
