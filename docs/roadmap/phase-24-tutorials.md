# Phase 24 — Tutorials: guided tours, a training copy, printed guides

**Status:** 🟡 **Step 1 of 4 shipped 2026-09-28**: the tour engine, the "?" button and first-visit offer, per-person tour progress, the Sales tour, and the smoke-test tour walk. Steps 2–4 (training copy, hands-on process tutorials, the other section tours and the printed guide) not started.
**Depends on:** Phase 21 (the Manuals & Training library; its Tutorials shelf is where process tutorials are listed). The Office section tour waits for Phase 23 (Work Inbox & Capabilities), which rebuilds the Office applet.
**Source:** owner, 2026-09-28: "We need to explore making a tutorial for each section of the app."

## Why this phase exists

We are close to the pilot, and before this phase nothing in the app taught anyone how to use it: no tours, no help button, no first-run flow. The only related piece was the Phase 21 **Manuals & Training** library. Its "Tutorials & training" shelf held one placeholder item, "How to run a job in Front Line", and open decision 11 in Phase 21 (which tutorials go on the shelves first) was unanswered. The Phase 21 research warns that field workers ignore "anything needing training". So tutorials have to be short, run on the real screens, and let people practise.

## Decisions locked 2026-09-28 (owner)

1. **Format.** Guided tours on the real screens, plus a printable guide built from the same content.
2. **Structure.** Process first, then sections:
   - one end-to-end story per role (Win a job, Take a spill call, Plan and dispatch, Run a job on your phone, Do a site walk, Close out and bill);
   - each story links to short "what's on this screen" tours, one per section.
3. **Where people practise.** Hands-on tutorials run on a separate **training copy** of the app, never on live.
   - The short "?" screen tours run on live. They only point and explain, and create nothing.
   - The owner first chose to practise on live and delete the data afterwards, then reversed it the same day. The practice-mode design (tagging every record created in a tutorial run, hiding it from others, blocking edits to real records, purging at the end) is **out of scope**.
4. **Tracking.** Each process tutorial is an item on the Tutorials shelf of the **live** library.
   - The last step of a training tutorial sends the person to that item on live to tap **Acknowledge**.
   - That writes the existing `libraryAcknowledgements` row, so the required/overdue flags and the Workforce certifications view work with no new code.
5. **Addresses and Microsoft sign-in.**
   - Live runs on a Cloudflare *quick* tunnel today (`cloudflared tunnel --url http://localhost:4173`). Its `trycloudflare.com` address changes every time cloudflared restarts.
   - The owner will set up a permanent address later, once the team has taken to the app. That work is not part of this phase.
   - Until then:
     - the training copy gets its own quick tunnel (→ `localhost:4174`);
     - it runs **without Microsoft sign-in**, so nothing changes in Entra;
     - trainees sign in with a training password that an Admin sets once on the training copy.
   - Later, the training address is added as one more SPA redirect URI on the **same** app registration. The tenant, client ID and app roles all stay the same.
   - Putting training under the live address (`/training/`) was rejected:
     - both copies would share the `crm_session` cookie (`Path=/`);
     - every root-relative path in the front end would need rewriting;
     - Entra would still need a second redirect entry, because the redirect is origin plus path.

## How we explain things (content rules)

These rules apply to every tour. `tutorials/registry.js` repeats them at the top.

1. **Start with the big picture.** The first card shows the whole chain:
   Lead → Opportunity → Site walk → Quote → Won → Project → Dispatch job → Field work → Closeout → Invoice.
   The part this tour covers is highlighted, so people see who hands them work and who they hand it on to.
2. **Keep steps short.** One action per step, at most two sentences: **Do** (the control named exactly as the screen labels it) and **Why** (one business reason).
3. **Wait for the person to act.** A step that asks for an action (`waitFor: "click"` or `"route:<view>"`) keeps Next disabled until the person does it.
4. **Follow one practice job through every step.** Even on the training copy, a process tutorial creates the person's own "<Name>'s practice …" job, so trainees never collide on one sample record.
5. **Use the words on screen and the glossary terms.** Facility, not "site"; Location only for a GPS point.
6. **Keep field tours tiny.** Front Line tours are at most five steps and cover only the three-tap paths.

## Tutorial catalogue

### Process tutorials (hands-on, on the training copy)

| # | Tutorial | Roles (required for) | Chain covered |
|---|---|---|---|
| P1 | Win a job | Sales Mgr, Account Mgr | account/contact/facility → opportunity → stage gates → schedule site walk → quote → Won → project |
| P2 | Take a spill call | Sales, Ops, Office | emergency intake in one submit → mobilization gate |
| P3 | Plan and dispatch a job | Ops Mgr, Scheduler | project intake/plan → job request → Create Job → assign crew → conflicts → board |
| P4 | Run a job on your phone | Field Lead, Crew | My Day → acknowledge → en route → on site → safety briefing → photos/materials → signature → field complete. Replaces `library-tutorials-app-basics`. |
| P5 | Do a site walk | Sales, Field Lead | Brief / Walk / Map / Finish |
| P6 | Close out and bill | Office Mgr, Finance Mgr | post-work report → closeout → itemized invoice → QuickBooks export (mock, safe on the training copy) |

### Section tours (show-only, 3–11 steps, on live and on the training copy)

- One tour per workspace: Sales ✅, Operations, Jobs & Dispatch, Workforce, Inventory, Office (after Phase 23), Finance, Client Portal, Identity & Sync, Front Line.
- One tour per tabbed detail page: Opportunity, Account, Contact, Project, Dispatch job.

## Design

### Tour engine and content (step 1 — built)

- **`tutorials/engine.js`** draws the overlay:
  - four shade panels around the target, so clicks reach only the target or the card;
  - a ring on the target, and the step card;
  - keyboard controls: Esc exits, ← and → move between steps.
  - On a phone (< 640px) the card docks to the bottom as a sheet, and the target is scrolled to just under the header.
  - When a target cannot be found within 1.5s, the text shows centred and the layer is marked `data-tour-status="missing"`, which the smoke test fails on.
  - The app's update banner is hidden while a tour runs, because it sits above the card.
- **`tutorials/registry.js`** holds every word. A tutorial is `{ id, kind: "section"|"process", workspace, title, summary, steps[] }`, and a step is `{ view?, tab?, target?, title, do, why?, chain?, waitFor? }`.
  - Targets are `data-tour="…"` attributes in the markup, never structural CSS selectors.
  - A step whose view the person cannot open is skipped.
- **Host wiring in `app.js`** (`loadGuidedTours`, a dynamic import; see the corrections):
  - The tour opens pages through the new `openView()`. That function was extracted from the `[data-view]` click branch, so a tour clears the same selections and filters a nav click does.
  - `render()` calls the engine's `notifyRender()` last, so the highlight re-attaches after every redraw.
- **Entry points:**
  - A "?" button after the page title in `renderWorkspaceHeader()` (`data-tour="tour-button"`), shown when that workspace has a section tour.
  - A one-line first-visit offer under the header ("Take the tour" / "No thanks"), hidden once the tour is started, finished or waved off.
- **Anchors added so far:**
  - `section-nav` (`#sideNav`) and `page-header` (every workspace header);
  - `pipeline-metrics`, `pipeline-board`, `new-opportunity`;
  - `accounts-list`, `new-account`, `contacts-list`.

### Tour progress (step 1 — built)

- **`tutorialProgress`** is a new collection in `backend.json`, one row per person per tutorial:
  - `ownerKey`, `systemUserId`, `employeeId`, `tutorialId`;
  - `status` (`not-started` | `in-progress` | `exited` | `done`), `lastStep`;
  - `startedAt`, `completedAt`, `dismissedOfferAt`, plus the usual `version`/`createdAt`/`updatedAt`.
- It is read and written **only** through `GET`/`POST /api/tutorial/progress`. The owner comes from the session, never the body. It has no `collectionAccess` entry, so the generic collection route returns 404 for it.
- The owner is the system user. A sign-on link session uses `employee:<id>`, and the break-glass session uses `breakglass`.
- `done` is sticky: re-taking a finished tour and leaving it halfway does not un-finish it.
- This holds tour progress and dismissed offers only. Training completion is the library acknowledgement (decision 4).

### The training copy (step 2 — not started)

- **Same code.** The same `server.mjs` runs with `PORT=4174`, `CRM_DATA_DIR=data-training/`, `CRM_BACKUP_INTERVAL_MINUTES=0` and a new `CRM_TRAINING=1`.
  - `/api/auth/providers` returns `training: true`.
  - The client shows a fixed "TRAINING – nothing here is real" ribbon on every screen, including sign-in and the phone frame, and puts "[Training]" in the tab title.
  - The Microsoft button is hidden, and the sign-in screen says "Use your training password".
- **Sign-in and users.** `auth.json` is copied from live once at setup. The nightly reset keeps it.
- **Live → training link.** A server-side, Admin-only "Training copy address" setting on live, stored as a `trainingSettings` object in `backend.json` like `qboSettings`. It is returned on `/api/auth/me`, so pasting a new quick-tunnel address takes effect with no restart.
- **Training → live link.** Live's "Open in training" link carries `#tutorial=<id>&return=<live origin>`. The training copy keeps `return` in `sessionStorage` and builds the final "Acknowledge on live" deep link from it, so it needs no live address configured.
- **Nightly reset: `scripts/reset-training.mjs`**
  1. Stop only the PID whose command line has `server.mjs` **and** the training data dir.
  2. Regenerate the sample data into `data-training/` dated today.
  3. Keep `auth.json`.
  4. Start the server again in the background.
  5. Print the training tunnel's current address.
  - It runs from a Windows scheduled task at 2 am.
- **Generator changes** (`scripts/rebuild/core.mjs`):
  - `--today YYYY-MM-DD`, because `NOW`/`TODAY` are fixed at 2026-09-25;
  - `--no-seed-file`, so the reset never rewrites the committed `data/demo-seed.json`;
  - sample text that spells out the date is built from `TODAY` instead.
  - `scripts/reset-demo-data.mjs` is not used, because it only upserts and never deletes what trainees added.
- **Updates.** Restart the training copy whenever live is restarted after an update.
- **Nothing leaves the app.** QuickBooks is a mock, and email is not built. Phase 19 must refuse to send when `CRM_TRAINING=1`.

### Process tutorials and library (step 3 — not started)

- Home gets a "Learn the app" card listing the person's process tutorials, marked required, done or overdue from the library acknowledgement status.
  - On live, each item is an "Open in training" link.
  - On the training copy, the card starts the tutorial directly.
- Library items gain `tourId`. One Tutorials-shelf item per process tutorial goes into `LIBRARY_ITEM_SEED`, with `requiredForRoles`.
- Order: P4 and P1 first (the pilot crews and the sales walk), then P3, P5, P6, P2.

### Printed guide (step 4 — not started)

- `scripts/build-user-guide.py` runs each registry tour on a scratch server with `CRM_SEED_DEMO=1` and screenshots every step with the spotlight on.
- It writes `docs/user-guide/<id>.html` and a PDF through Chromium. The PDFs can be attached to their library items.

## Build record

**2026-09-28, step 1.**
- **Files:**
  - new: `tutorials/engine.js`, `tutorials/registry.js`;
  - `app.js`: `loadGuidedTours()` (dynamic import), `openView()`, `start-tour` / `dismiss-tour-offer` actions, header button and offer, progress load/save, the engine's `notifyRender()` at the end of `render()`, anchors;
  - `server.mjs`: `tutorialProgress` default, `/api/tutorial/progress`, `tutorials/` on the static allowlist;
  - `index.html`: `data-tour` on `#sideNav`;
  - `styles.css`: overlay, card, offer and "?" styles on the theme tokens;
  - `service-worker.js`: both modules cached, cache `v65`;
  - `scripts/smoke-browser.py` + `scripts/smoke.mjs`: the tour walk.
- **Verified:**
  - Click-tested on a scratch server at 1440×900 and 390×844:
    - all 11 Sales steps find their targets on both sizes;
    - the offer shows on first visit and hides afterwards;
    - progress saves;
    - "?" restarts the tour and Esc exits it;
    - clicks outside the highlight hit the shade;
    - a missing target reports `missing`;
    - a `waitFor: "click"` step keeps Next disabled until the target is pressed, and the target's real dialog then opens.
  - `node scripts/smoke.mjs`: 24/24 passed, the sweep reporting "1 tours".

## Corrections found during implementation

- **Phase number.** Planned as Phase 23. Another session recorded Phase 23 (Work Inbox & Capabilities) the same day, so this is Phase 24.
- **Break-glass session kind.** The break-glass session's `kind` is `breakglass`, not `break-glass`. The first cut of `tutorialOwnerKey` refused it.
- **Python Playwright has gone missing.** The bundled Python runtime was replaced on 2026-09-28 (11:57), and the new one has **no Python Playwright**, so `scripts/smoke.mjs`'s browser sweep cannot start from the default `CRM_PYTHON`.
  - Workaround used here: install `playwright==1.62.0` (it matches the cached Chromium builds in `%LOCALAPPDATA%\ms-playwright`) into a scratch folder with `pip install --target <dir>`, then run the smoke test with `PYTHONPATH=<dir>`.
  - The Node copy of Playwright (1.62.1) is still in the bundled `node_modules`.
- **`.icon-button` is a block.** It is `display: grid`, so the "?" wrapped under the page title. `.tour-button` overrides it to `inline-grid`.
- **A static import took live down.** The first cut imported `tutorials/engine.js` statically at the top of `app.js`.
  - The live server reads front-end files from disk but builds its static allowlist at startup, so until it restarts it 404s `tutorials/`.
  - A failed static import stops the whole module graph, so live showed a broken app on any reload for about 30 minutes on 2026-09-28.
  - Fixed without a restart: `app.js` now loads both modules with a guarded dynamic `import()` in `loadGuidedTours()`, and every caller treats "no tours" as normal. Live's sign-in page was checked afterwards: it renders, with one "Guided tours are unavailable" warning.
  - **Rule for later steps:** any new module under a new folder is loaded this way, or the server is restarted in the same step.
  - Live shows no tours until it is restarted with the new `server.mjs`.
