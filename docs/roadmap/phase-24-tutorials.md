# Phase 24 — Tutorials: guided tours, a training copy, printed guides

**Status:** 🟢 **Built 2026-09-29, all four steps; smoke-green.**
- Step 1 (2026-09-28): the tour engine, per-person progress, the Sales tour.
- Step 2: the training copy.
- Step 3: six hands-on tutorials, the Home "Learn the app" card, and the library link-up.
- Step 4: 14 more screen tours, and a generated printed guide that doubles as the smoke check.

**Waiting on the owner (not code):**
- start the training copy and paste its address into live;
- register the nightly reset task;
- set trainees' passwords.

**Open:** the Office tour waits for Phase 23.

**Depends on:** Phase 21 (the Manuals & Training library; its Tutorials shelf lists the hands-on tutorials). The Office section tour waits for Phase 23 (Work Inbox & Capabilities), which rebuilds the Office applet.

**Source:** owner, 2026-09-28: "We need to explore making a tutorial for each section of the app."

## Why this phase exists

Before this phase, nothing in the app taught anyone how to use it: no tours, no help button, no first-run flow. The only related piece was the Phase 21 **Manuals & Training** library. Its "Tutorials & training" shelf held one placeholder item, and open decision 11 in Phase 21 (which tutorials go on the shelves first) was unanswered. The Phase 21 research warns that field workers ignore "anything needing training". So tutorials have to be short, run on the real screens, and let people practise.

## Decisions locked 2026-09-28 (owner)

1. **Format.** Guided tours on the real screens, plus a printable guide built from the same content.
2. **Structure.** Process first, then sections:
   - one end-to-end story per role;
   - short "what's on this screen" tours per section and per record page.
3. **Where people practise.** Hands-on tutorials run on a separate **training copy**, never on live.
   - The show-only screen tours run on live.
   - The owner first chose to practise on live and delete the data afterwards, then reversed it the same day. That practice-mode design is **out of scope**.
4. **Tracking.** Each hands-on tutorial is a Tutorials-shelf item on live.
   - Its last card links back to live, where the person taps **Acknowledge**.
   - That writes the existing `libraryAcknowledgements` row, so the required/overdue flags and the Workforce certifications view work unchanged.
5. **Addresses and Microsoft sign-in.**
   - Live runs on a Cloudflare *quick* tunnel (`cloudflared tunnel --url http://localhost:4173`); its `trycloudflare.com` address changes whenever cloudflared restarts. A permanent address comes later, once the team has taken to the app, and is not part of this phase.
   - Until then:
     - the training copy gets **its own quick tunnel** (→ `localhost:4174`);
     - it runs **password-only**, so **nothing changes in Entra**.
   - Later, the training address is one more SPA redirect URI on the **same** app registration.
   - Training under the live address (`/training/`) was rejected: a shared session cookie, root-relative paths everywhere, and a second Entra redirect entry anyway.

## How we explain things (content rules)

These rules apply to every tour. `tutorials/registry.js` repeats them at the top.

1. **Start with the big picture.** The first card shows the chain:
   Lead → Opportunity → Site walk → Quote → Won → Project → Dispatch job → Field work → Closeout → Invoice.
   The part the tour covers is highlighted.
2. **Keep steps short.** One action per step, at most two sentences: **Do** (the control named exactly as the screen labels it) and **Why** (one business reason).
3. **Wait for the person to act.** A hands-on step keeps Next disabled until the person does it, but can always be skipped, so a gate they can't clear never traps them.
4. **Use their own practice records.** On the training copy, a tutorial has the person create their own records ("<Name>'s practice customer"), so trainees never collide on one sample record.
5. **Use the words on screen and the glossary terms.** Facility, not "site"; Location only for a GPS point.
6. **Keep field tours tiny.** Front Line section tours are five steps.

## What was built

### Tutorial catalogue

Six hands-on tutorials (`kind: "process"`, on the training copy; each is a Tutorials-shelf item on live, `libraryItemId`):

| id | Title | Steps | Required for (library item) | Notes |
|---|---|---|---|---|
| `process-win-job` | Win a job | 19 | Sales Mgr, Account Mgr (`library-tutorials-win-job`) | Account → facility → opportunity → one real stage advance (Lead → Qualify through the gate) → site walk → quote. Negotiation/Won are explained, not forced (≈30 gated fields). |
| `process-spill-call` | Take a spill call | 7 | Ops Mgr, Office Mgr (`library-tutorials-spill-call`) | The one-screen intake → mobilization decision → paperwork → the job on the register. Sales roles cannot open Operations › Emergency Response, so the audience is Ops/Office/Scheduler. |
| `process-plan-dispatch` | Plan and dispatch a job | 12 | Ops Mgr, Scheduler (`library-tutorials-plan-dispatch`) | Project → job request (a service time, onsite contact and address are required before Create job) → work plan → crew → schedule → conflicts, board. |
| `process-field-job` | Run a job on your phone | 10 | Field Lead, Crew (`library-tutorials-app-basics`, the old placeholder row) | Phone surface. My Day → job page tabs → the status bar → safety → work → quick capture → close. |
| `process-site-walk` | Do a site walk | 11 | Sales Mgr (`library-tutorials-site-walk`) | Schedules a walk for today on an opportunity, then does it on Front Line: check in, Walk, Map, Finish. |
| `process-close-bill` | Close out and bill a project | 8 | Office Mgr, Finance Mgr (`library-tutorials-close-bill`) | Report tab → Close project → itemized invoice → QuickBooks (mock on the training copy). |

Fourteen show-only tours (`kind: "section"`):
- **Workspace tours**, from the "?" on each workspace header: Sales, Operations, Jobs & Dispatch, Workforce, Inventory, Finance, Client Portal.
- **Identity & Sync.** Admin-only steps are marked `roles`. The "?" is in the top bar.
- **Front Line.**
- **Record-page tours**, from a "?" in the top bar: Opportunity, Account, Contact, Project, Dispatch job.
- **Office has none yet.** Phase 23 rebuilds it.

### The engine (`tutorials/engine.js`) and content (`tutorials/registry.js`)

- **Overlay.**
  - Four shade panels around the target (clicks reach only the target or the card), a ring, and the card.
  - Esc exits; ← and → step.
  - Card placement, in order of preference:
    1. above or below the target;
    2. beside it, narrowed to the space;
    3. a compact card in the bottom-right corner over a wide dialog.
  - On a phone the card is a sheet at the bottom, or at the top when the target is in the lower half (the job status bar).
  - When a modal dialog is open, **the layer moves inside it**: outside a modal everything is inert, and inside it the layer paints above the dialog and stays clickable.
  - A MutationObserver re-finds the target after any re-render, including the field app's own renders.
- **Targets** are semantic hooks, never structural CSS:
  - `data-tour="…"` (added for tours);
  - `action:<data-action>`, `tab:<action>:<tab>`, `field:<data-field-action>`, `view:<data-view>`;
  - `dialog:<id>`;
  - `sel:<css>`, only for a dialog field by name.
- **Waits:**
  - `click`, `route:<view>`, `dialog:<id>`;
  - `created:<collection>` (a new record appears; its id is kept);
  - `until` (a predicate over `ctx.record(collection)` and `ctx.view`).
- **Scripted actions.** `auto` lists what a script does in the person's place: `click`, `fill`, `select` with `@first`, `label:<text>` and `@today[suffix]`, and `wait`.
  - `runAuto()` is exported for the guide builder, never used by a person.
- **Skipped steps.** A step is skipped when its `view` can't be opened, or its `roles` don't match.
- **Host wiring in `app.js`.**
  - `loadGuidedTours()` loads both modules with a **guarded dynamic `import()`**, so a server that doesn't serve `tutorials/` still runs the app (see the corrections).
  - `openView()` was extracted from the `[data-view]` click path.
  - `render()` ends with the engine's `notifyRender()`.

### Entry points (live and training)

- **"?" buttons.**
  - Workspace tours: after the page title in `renderWorkspaceHeader()`.
  - Record pages and Identity & Sync: in the top bar's quick actions (`topbarTourFor(view)`).
- **First-visit offer.** A one-line "Take the tour / No thanks" under a workspace header, until the person takes the tour or waves it off.
- **Home "Learn the app" card:**
  - lists the hands-on tutorials for the person's roles (Admin sees all), each marked Required, Done or Retake from the library acknowledgement;
  - required-and-not-done gets the red dot and the card a red outline (the app's red-dot rule);
  - then chips for every screen tour the person can open.
- **Library.** A Tutorials-shelf item with a `tourId` shows the launch control instead of Open, in both the office library and the field library.
- **Launch control (`renderTutorialLaunch`).**
  - On live it is **Open in training**, a link to `<training copy>#tutorial=<id>&return=<live origin>`, or "Training copy not set up yet" when no address is set.
  - On the training copy it is **Start**.
- **Round trip.**
  1. The training copy keeps `return` in `sessionStorage` and starts the tutorial after sign-in.
  2. The last card's **Open the live app to acknowledge** goes to `<live>#view=home&tutorialDone=<id>`.
  3. There the Home card scrolls into view with that tutorial highlighted and a primary **Acknowledge** button. It also works when the link lands in an already-open tab (popstate).
  4. Acknowledge needs the sign-in to be linked to an employee record; break-glass isn't.

### Tour progress (live)

- **`tutorialProgress`** in `backend.json`: one row per person per tutorial.
  - Fields: `{ ownerKey, systemUserId, employeeId, tutorialId, status: not-started|in-progress|exited|done, lastStep, startedAt, completedAt, dismissedOfferAt }`.
  - Read and written only through `GET`/`POST /api/tutorial/progress`, with the owner taken from the session. It has no `collectionAccess` entry.
  - `done` is sticky.
- This is a convenience (offers, re-takes). Training completion is the library acknowledgement.

### The training copy

- **It is `server.mjs` with `CRM_TRAINING=1`**, its own port (4174) and data folder (`data-training/`, gitignored). Training mode:
  - serves the TRAINING frame on every screen: an amber border and label that never takes clicks, over the sign-in page and the phone frame too;
  - adds "[Training]" to the tab title;
  - is **password-only**. Microsoft is off whatever the shared `.env` says, and the sign-in page says "Use your training password";
  - takes **no backups**. The `.env`'s `CRM_BACKUP_DIR` is live's OneDrive folder and is ignored;
  - uses **its own session cookie** (`crm_training_session`), so live and training on one computer don't sign each other out;
  - **refuses to start on the live `data/` folder**.
- **`scripts/reset-training.mjs`** (the nightly reset, and the way to start it):
  1. Stops only a `server.mjs` listening on the training port, and never port 4173.
  2. Rebuilds `backend.json` from `data/demo-seed.json` plus **live's reference catalog, read-only**: rate sheet, price levels, units, job and form templates, document types, permits, library items. It never copies live activity (IT messages, walks, GPS consents, tour progress).
  3. Shifts every sample date so the seed's "today" (read from `scripts/rebuild/core.mjs`) is the real today.
  4. Copies the 174 sample files once.
  5. Keeps `auth.json`, so trainees' passwords survive.
  6. Starts the server detached.
  7. With `--tunnel`, starts or finds a quick tunnel to the port and prints its address.
- **Live's pointer to it.** The Admin-only **Identity & Sync › Training copy** address: a `trainingSettings` object in `backend.json`, served by `GET`/`POST /api/training/settings`. Pasting a new quick-tunnel address takes effect with no restart. The training copy's own Identity & Sync says it *is* the training copy.

### The printed guide and the check (`scripts/build-user-guide.mjs`)

- It builds its own scratch training copy (reset script `--no-start` into a temp folder, then `CRM_TRAINING=1` on a free port, so parallel smoke runs never share one).
- It starts every tutorial through the real engine, screenshots every step, and completes hands-on steps with their `auto` actions.
- It writes `docs/user-guide/<id>.html`, an index and PDFs. These are gitignored (about 35 MB of screenshots): regenerate rather than commit.
- **`--check`** writes nothing and fails on:
  - a missing highlight target;
  - a hands-on step whose `auto` can't complete it;
  - a console error.
  `scripts/smoke.mjs` runs it ("Guided tours"). It uses Node Playwright, so it runs even while the Python sweep can't (see the corrections).

## Owner actions to switch it on

1. **Start the training copy:** `node scripts/reset-training.mjs --tunnel`.
2. **Sign in to it** with `data-training/break-glass-password.txt` and set a password for each trainee in Identity & Sync › Users & access.
3. **On live**, paste the printed address into Identity & Sync › Training copy.
4. **Register the nightly reset** (`schtasks` line in `README.md`).
5. **Restart the training copy** whenever live is restarted after an update.
6. **Later, with a permanent address:** add the training address as an Entra SPA redirect URI and set `CRM_ENTRA_*` on the training copy.
7. **Optionally, attach the generated PDFs** (`node scripts/build-user-guide.mjs`) to their library items.

## Build record

- **2026-09-28, step 1.** Engine, "?" and first-visit offer, `tutorialProgress`, the Sales tour. Committed with other work as `77a2a5e`.
- **2026-09-29, steps 2–4:**
  - **New files:** `scripts/reset-training.mjs`, `scripts/build-user-guide.mjs`.
  - **`tutorials/engine.js`**, rewritten: dialog seating, target kinds, waits, `auto`, skip, finish link, roles, placement modes.
  - **`tutorials/registry.js`**: 20 tours.
  - **`server.mjs`:**
    - `CRM_TRAINING` (Entra, local login, backups, cookie, data-folder guard, startup line, `training` on `/api/auth/providers`);
    - `trainingSettings` and `/api/training/settings`;
    - the six Tutorials-shelf seed rows with `tourId`, plus a one-time patch that gives the old placeholder row its `tourId`.
  - **`app.js`:**
    - the training ribbon and title, and password-only sign-in copy;
    - the Training copy panel;
    - deep links (`consumeTutorialLink`, `startPendingTutorial`, popstate);
    - the Home Learn card, acknowledgement, and `renderTutorialLaunch` (exported);
    - the top-bar "?";
    - anchors: `opportunity-stage-ladder`, `project-mobilization`, `project-paperwork`, `dispatch-job-register`, `home-learn`, `sync-*`.
  - **`field/library.js`:** the launch control.
  - **`styles.css`:** the ribbon, the Learn card, and card modes.
  - **Tests:** `scripts/smoke.mjs` (the Guided tours check); `scripts/smoke-browser.py` (the Python tour walk removed).
  - **Other:** `.gitignore` (`data-training/`, `docs/user-guide/`); `README.md`.
- **Verified:**
  - `build-user-guide.mjs` walks all 20 tours clean (156 steps), hands-on steps completed by their `auto` actions.
  - Click-tested at 1366×860 and 390×844.
  - Reset script:
    - refuses port 4173 and `data/`;
    - `CRM_TRAINING=1` on `data/` exits;
    - a second run stops and restarts cleanly;
    - dates shift so "today" has jobs;
    - live stayed up throughout.
  - The live → training → live round trip, as a Sales Manager on scratch servers:
    - the Home card shows Required + red dot + Open in training;
    - the training copy shows the sign-in with the TRAINING frame, then starts the tutorial after sign-in, and live stays signed in;
    - the finish link goes back to live, where Acknowledge writes `libraryAcknowledgements` and the card shows Done.
  - `node scripts/smoke.mjs` 2026-09-29: 25/25 passed, including "Guided tours: all 20 tutorials walk cleanly". The Python sweep ran with the scratch Playwright on `PYTHONPATH`.

## Corrections found during implementation

- **Phase number.** Planned as Phase 23. Another session recorded Phase 23 (Work Inbox & Capabilities) the same day, so this is Phase 24.
- **Break-glass session kind.** The break-glass session's `kind` is `breakglass`, not `break-glass`.
- **Python Playwright disappeared.** The bundled Python runtime was replaced on 2026-09-28 without Python Playwright, so `smoke.mjs`'s Python sweep can't start from the default `CRM_PYTHON`.
  - Workaround: `pip install --target <dir> playwright==1.62.0` (it matches the cached Chromium) and `PYTHONPATH=<dir>`.
  - The tour check was therefore written in **Node** Playwright, which the runtime still ships.
- **`.icon-button` is a block** (`display: grid`). The "?" overrides it to `inline-grid`.
- **A static import took live down (2026-09-28).**
  - The live server reads front-end files from disk, but builds its static allowlist at startup. The first cut's static `import "./tutorials/engine.js"` 404'd on the not-yet-restarted server and stopped the whole app for about 30 minutes.
  - Fixed with the guarded dynamic import in `loadGuidedTours()`.
  - **Rule:** a module in a new folder is loaded that way, or the server is restarted in the same step. The auto-mode permission check now refuses a session's live restart as a "production deploy".
- **The training reset does not run the sample-data generator.** The plan said to add `--today`/`--no-seed-file` to `scripts/rebuild/core.mjs`, but the generator:
  - needs the OneDrive Photos folder and `pillow_heif` (not in the bundled Python);
  - rewrites `data/demo-seed.json`;
  - carries real IT messages over;
  - hard-codes dates all through the sample files, not just `TODAY`.
  The reset instead rebuilds from the committed `demo-seed.json` and shifts every `YYYY-MM-DD` (ids, file names and URLs excluded) by the same number of days. The generator is unchanged.
- **Trainee passwords.** The plan copied live's `auth.json` to the training copy. That would carry live sessions and password hashes across. Instead the training copy has its own `auth.json`: the break-glass admin sets trainees' passwords once, and the reset keeps them. The user records themselves (`systemUsers`) come with the sample set.
- **The shared cookie between live and training.** Cookies are per host, not per port, so on one computer live and training shared `crm_session`. Training mode names its cookie `crm_training_session`.
- **Spill-call audience.** Sales roles can't open Operations › Emergency Response, so "Take a spill call" is for Ops/Office/Scheduler, not Sales as planned. The field phone intake is Phase 21's.
- **A job request needs more than the dialog requires.** Create job refuses a request without a service time, onsite contact and address, even though the dialog only requires the address and description. The tutorial asks for all three.
- **Site walks on My Day.** They are the "Site walks" section's `walk-open` cards (`field/walk.js`). The older `field-open-walk` card renders as a plain, untappable card because `field-walk` isn't in `FIELD_ROUTES`. The tutorial targets both.
- **Where the record-page "?" goes.** Record pages and Identity & Sync have no workspace header, so their "?" is in the top bar instead of beside each tab strip. That is one insertion instead of five page edits.
- **The printed guide is not committed.** It is about 35 MB of screenshots; it is gitignored and regenerated instead.
