# Phase 25 — Pilot fixes (feedback pass 2026-09-29)

**Status:** 🟡 In progress — started 2026-09-29. Wave A first.

**Depends on:** Phase 21 (Front Line 2), Phase 13 (documents), Phase 15 (project workspace), Phase 16 (emergency intake) — all shipped.

**Source:** `notes-2026-09-29.md` (verbatim notes + note→wave index). Every item below was traced against the code on 2026-09-29; line numbers are as of commit `50cf39b` and will drift.

**Owner decisions (2026-09-29):** facility site parties + a separate "Hired by" on the engagement; driver's licence scan check-in built now; Work Authorization drafted by us, wording reviewed by the owner before it goes live; MSA once per account with an expiry.

---

## What the 2026-09-29 trace found
- **Front Line job status never moves for a field login.** `frontlineCompleteStatusAction` (app.js:17814) → `advanceDispatchJob` saves `dispatchJobs.status` through the raw backend route. The server drops that field for field logins because `status` isn't in `fieldPartialWriteFields.dispatchJobs` (server.mjs:3018). The `jobStatusEvents` write then gets a 403, and a success toast hides it. `frontlineAutoAdvanceJob` (app.js:22680) fails the same way. That is why the bottom "Mark acknowledged" button stays.
- **Roll call "Mark arrived" is thrown away by the server.** `fieldUpsertBriefing` keeps `rollCall: stored?.rollCall ?? []` (server.mjs:6013). "Not acknowledged" on roll call means *briefing not signed*, not job status. The lead is never shown the acknowledge form (safety.js:50-67). The client and server also disagree on the briefing date. Nothing stops a briefing with nobody on site.
- **Finishing a site walk makes a duplicate record.** `fieldCompleteSiteWalk` (server.mjs:6113) looks for `regardingScheduleEventId`, which `saveSiteWalk` (app.js:23003) never sets. So it pushes a second activity with `type` instead of `activityType`, which loads as a "Task". The original Meeting stays Scheduled forever, and neither record links to the walk.
- **The sketch is saved as a document, but the walk never references it.** `walkBundle`/`walkShareDocumentIds` only follow sections and pins, so the sketch is missing from the PDF, share page and zip. With no opportunity, it isn't saved at all (media.js:289).
- **Every GPS check-in creates a new `locations` row** (walk.js:604) with no de-dup and no facility link. That ping can then become the opportunity's "site" and the project's `siteLocationId` (app.js:23884).
- **Walk pin photos never reach the project report.** `projectReportPhotos`/`buildPostWorkReport` filter by `observation.reportId`, which pins don't have (they carry `walkEventId`), and sort by `number` instead of `seq`.
- **The Needs-info round trip is broken.** Nobody is notified, and any requester save flips the request back to Submitted (app.js:18999).
- **Facility save deletes lat/long** (app.js:28073).


Wave F (job action forms, StreetSmart model) is recorded here too, and gets its own detailed plan before it is built.

---

## Wave A — bugs and small fixes (no new data model)

**Front Line**
1. **Job status from the field.** Route the Work-tab status action and auto-advance through the existing field command. On the phone, `frontlineCompleteStatusAction`/`frontlineAutoAdvanceJob` call `POST /api/field/jobs/:id/advance` (`fieldAdvanceJob`, server.mjs:5836) through the offline outbox, not `advanceDispatchJob`. Stop the false success toast.
   - One status source: the bottom button and the Work-tab step both read `job.status`. When a Status-transition action is complete but the status hasn't moved, the bottom button runs the same command.
2. **Roll call.**
   - `fieldUpsertBriefing` merges the client's `rollCall` per employee: `arrivedAt`/`leftAt` from any crew member for themselves, from the lead for anyone. `acknowledgedAt` stays server-set.
   - Show the acknowledge form to the lead too.
   - One date rule for "today's briefing" on both sides: `dispatchJobOperationalDate` logic.
   - Relabel the roll-call chip "Briefing not signed" so it isn't confused with job acknowledgement.
   - Add "+ Add person on site" for people not on the dispatch.
3. **Briefing guard.** Saving a briefing as *complete* needs at least one person Arrived. The "Mark on site / in progress" advance (client gate + `fieldAdvanceJob`) needs today's briefing, at least one arrived crew, and every arrived person acknowledged.
3b. **Driver's-licence check-in (owner: build now).**
   - "Scan ID" on roll call reads the licence's PDF417 barcode with the phone camera. It uses the browser `BarcodeDetector` where it supports pdf417 (Android Chrome). Otherwise it uses a zxing decoder vendored under `public/vendor/` like Leaflet, so it works offline and on iOS.
   - It parses the AAMVA fields.
   - **Stored, minimum only:** name, issuing state, the last 4 of the licence number plus a salted hash of the full number (for matching), expiry, scan time and GPS. No DOB, no address, no image.
   - The hash matches an employee: the first scan links it to `employees.licenceHash`, with the lead confirming who it is. An unmatched scan adds a visitor/subcontractor row to roll call.
   - An expired licence shows a warning, not a block.
   - Manual "Mark arrived" stays available with a reason, e.g. no licence on hand.
   - New fields on `rollCall[]`: `checkInMethod` (scan | manual), `idLast4`, `idState`, `idExpiry`, `lat`, `lng`, `accuracyM`, `personType` (employee | visitor | subcontractor), `displayName`. Documented in database-handoff-map.
4. Smaller bugs found on the way:
   - Forms photo id discarded (forms.js:175).
   - Signature not uploaded (forms.js:181).
   - Travel clock-in saved as Work (server.mjs:5781 case).
   - The "safety" category case mismatch (app.js:21245).

**Site walk (phone)**

5. **Delete / replace photo** on walk trays (`renderPhotoTray`, walk.js:419) and the pin sheet (map-core.js:1061).
   - Delete removes the reference, and soft-deletes the document if nothing else references it.
   - Replace uploads a new version in the same document group.
   - Fix the offline `saved.id` crash (walk.js:1036).
6. **"+ Photo" asks "Choose existing / Upload new".**
   - "Existing" opens a picker of the walk's and opportunity's site-photo documents.
   - On a 409 duplicate, reuse the returned `documentId` instead of showing an error. That covers pins, sections and slots.
7. **Tap a photo to mark it up.** Open `openImageMarkup` (media.js:40) from the phone trays and the pin sheet, for any photo, uploaded or live. It saves a new version, as the desktop does.
8. **Measurements you can complete.**
   - Make Measurements a real walk section with a "Section complete" box, counted on Finish.
   - Wire "GPS walk" to the existing `openMeasurementsForm`/`startGpsWalk` (media.js:757).
   - Store the result in `siteWalkReports.measurements[]` so there's one shape. Retire or bridge `POST /api/field/measurements`.
9. **Sketch saved and shown.**
   - Store sketch doc ids on `siteWalkReports.sketchDocumentIds[]`.
   - Include them in `walkBundle`, `walkShareDocumentIds`, the PDF (`buildWalkExportHtml`), the share page and the zip.
   - With no opportunity, upload against the walk report (entityType `siteWalk`, the report id).
10. **Pins don't overlap**, on screen and in print.
    - Declutter in `map-core.js`: when pins fall within ~28 px, fan them out with a leader line to the true point. Recompute on zoom.
    - In print mode, also number the pins and fit to the pin bounds with padding.
    - No new library; Leaflet stays plugin-free.
    - Also draw plan-background pins on their own printed plan page.

**Office UI**

11. **Kanban overflow.** `min-width:0` and `overflow-wrap:anywhere` on `.opportunity-card` and its children; let `.risk-badge` wrap (styles.css:1165/344).
12. **Projects default to "My projects".**
    - Add a `mine` chip to `QUICK_FILTERS.projects` (app.js:3642), on by default. It matches `projectManagerEmployeeId`/`projectManager`/`salesLead`, plus dispatch-assignment crew for the current user.
    - An "All projects" chip clears it.
13. **Project hero toolbar** (app.js:8444).
    - Remove "Log material", "Log equipment" and "Schedule".
    - Show "Post-work report" only once the project has at least one dispatch job at `field_complete` or later *(assumed — the note was cut off; confirm)*.
14. **Intake "Site photos" textarea.** Remove it (index.html:1632, `saveProjectIntake`). The Intake count reads real site-photo documents from the opportunity walk and the project. Existing `sitePhotoRefs` text moves into project notes on load, once.
15. **Spill call "Not applicable".** Add N/A to `stormDrainInvolved`, `offRoadDischarge`, `absorbentDeployed`, `hasInsurance` and `isInsuranceClaim` (index.html ~4206–4285). Check that the mobilization gate treats N/A like "No" where relevant.
16. **Third-party waste authorization → N/A.**
    - Add a `Waived (N/A)` requirement status with a required reason, set by a reviewer role (server.mjs:4854 `REQUIREMENT_STATUSES`).
    - The Negotiation gate (app.js:83) and the project paperwork flag accept Approved **or** Waived.

## Wave B — the site walk as a first-class record

1. **One walk, clearly shown on the timeline.**
   - Fix the completion path: `saveSiteWalk` sets `regardingScheduleEventId` on its Meeting. `fieldCompleteSiteWalk` then *updates* that Meeting to Completed, retitled "Site walk completed — …", with `activityType` set, tags `["Site Visit"]`, an owner, and `siteWalkReportId`. It no longer pushes a second record.
   - The walk's `facilityId` comes from the event, not the opportunity.
   - A one-time cleanup script merges the existing duplicate pair (the Dell R3 walk and any others).
   - The timeline row shows a "Site walk" badge with Scheduled → Completed, and links to the walk.
2. **"Site walk" in the Regarding field.** Add `siteWalk` to `RECORD_LOOKUP_TYPES` (app.js:31896), backed by `scheduleEvents kind:"site_walk"`, so any activity, document or task can be *regarding* a walk.
3. **Schedule a site walk from the opportunity timeline.** Add "Site walk" to `renderActivityPicker` (app.js:15285) → `openSiteWalkDialog`.
4. **Site walk detail page** (desktop, `#view=site-walk&id=`), opened from the timeline, project and opportunity. It shows:
   - when, who attended, check-in (time, accuracy, distance from facility);
   - the summary, sections, measurements, sketch, map and photos;
   - links to its PDF and share page.
   It reuses `renderSiteWalkReportPanel`/map-core read-only (Phase 22 rule 4).
5. **Walk PDF filed as a document.** On completion, and on demand, render `buildWalkExportHtml` to a stored `site-walk-report` document on the opportunity. It is carried to the project; see the next item.
6. **Carry-over to the project.**
   - `siteWalkReports` gains `projectId` when the deal is won.
   - Fix the `reportId`→`walkEventId` and `number`→`seq` filters in `projectReportPhotos`/`buildPostWorkReport` (app.js:21026/21277).
   - Project **Plan tab**: the top-right "Site sample map" (`renderProjectSampleMap`) is replaced by a **Site walk panel** (summary, attendees, closure, measurements, sketch thumbnail, "Open walk", PDF link). The sample map moves into the Sampling tab.
   - **Files tab › Project documents** also lists documents on the source opportunity and anything *Regarding* the opportunity or project: walk PDF, sketches, quotes, estimates, packets, generated PDFs. Each is labelled with its source.
7. **Live tab chronology** (`getProjectChronology`, app.js:32651). Walk photos collapse into one "Site walk" event (date, lead, attendees, photo count, closure summary). It expands inline and links to the walk page.
8. **"Priced baseline"** (`renderProjectPricedBaselinePanel`) moves inside the Billing & cost panel as a collapsed `<details>` sub-section.

## Wave C — dispatch requests

1. A **Title** field on `#jobRequestDialog`, e.g. "Confirmation Sampling", carried to the dispatch job's name and shown on the register and the calendar.
2. **Pre-fill from the project:** equipment, labor and vendor from `project.equipmentNeeds`/`resourceNeeds`/`vendorNeeds`.
   - Customer packet status from Phase 13 requirements (`paperworkApproved`).
   - Quote status and file from `project.quoteId`.
   - Pricing on every request, not only the first.
3. **Needs info → alert the requester.**
   - `setJobRequestStatus` raises a notification addressed to the requester (`recipientUserId`) and puts a red dot on the project and the request row (red-dot rule).
   - Replace `window.prompt` with a small dialog.
4. **Clearing it.** When a request in Needs info is edited, the save dialog shows the dispatcher's note and a checkbox: "This edit answers dispatch's request — clear Needs info". Only ticked → Submitted, and dispatch is notified. Unticked → it stays Needs info with the edit logged.

## Wave D — places: GPS, duplicates, facility parties

1. **Facility GPS.**
   - Add lat/long to the facility dialog, plus "Use my location" and "Pick on map".
   - Stop `saveFacility` deleting them (app.js:28073). Stored on a primary linked `locations` row (keeps `facilityCoordinates`).
2. **Check-in hygiene.**
   - A check-in reuses an existing location within ~50 m instead of adding a new one.
   - It records `facilityId`, time and accuracy.
   - If the fix is more than ~500 m from the facility address, ask: "You're X km from the site — use this location anyway / check in without GPS".
   - Check-in pings are never used as the opportunity's site or the project's `siteLocationId` (`opportunitySiteLinks`, app.js:32280/23884).
3. **Duplicate detection.** When a facility or location is created, look for same or similar address (normalised) or a point within ~75 m. Show "Is this the same as …?" → use existing / create anyway.
4. **Merge tools.**
   - Locations → facility: attach one or many GPS points to an existing facility.
   - Facility → facility merge: repoint every reference (opportunities, projects, dispatch jobs, contacts, documents, walks, observations), then soft-delete the loser. It uses the server's cascade table.
   - Admin/Office only, audited.
5. **Facility parties** *(owner chose: site parties + hired-by)*.
   - New junction `facilityParties {facilityId, accountId, role: Owner | Tenant/Occupant | Property manager | Other, since, until, notes}`.
   - The engagement side stays separate: a project/dispatch "Hired by" account (e.g. AIRCO, a spill broker), which can differ from the facility's owner or tenant.
   - The spill-call form gets an optional "Who called us" account plus "Facility owner/tenant if known".
   - The facility page shows a Parties panel.
   - `facilities.accountId` stays as "primary account" for now.

## Wave E — paperwork

1. **Document review queue for office admin** (interim, before the Phase 23 Inbox).
   - An "Awaiting review" list on the Office Manager page: every requirement In review, any entity.
   - Uploads moving a requirement to In review raise a role notification to reviewers (server.mjs:5159).
   - Phase 23's Inbox later absorbs the list.
2. **Signed quote.**
   - Add an acceptance block to `renderPrintableDocHtml` (app.js:25828): accepted by, title, signature, date, customer PO, plus the validity statement.
   - The Won gate (app.js:89) reads an approved `signed-quote` document or legacy `accountPaperworkStatus`.
3. **Work Authorization document** *(owner: we draft, owner reviews the wording before it goes live)*.
   - A generated one-page form from the project/quote: parties (incl. Hired by), site, scope summary, rate-sheet basis, emergency terms, payment responsibility, signature block.
   - New doc type `work-authorization`. Printable through the same `renderPrintableDocHtml` path.
   - The draft wording is put in front of Braden before it is enabled.
4. **MSA rule** *(owner: once per account, with expiry)*.
   - The `service-agreement-msa` requirement lives on the **account** with `expiresOn`.
   - The emergency intake (app.js:19743) and the project Files tab only ask for one if the account has no unexpired Approved/Waived MSA. The project panel shows "MSA on file until …" instead.
   - Existing per-project MSA requirements on accounts that already have one are closed by a one-time cleanup.

## Wave F — job templates with actions, and job action forms (StreetSmart model)

1. **Template subtask gains:**
   - `timerAction` (none / Start-resume job / On hold / Terminate);
   - `repeatable`;
   - `formTemplateId` ("Job Action form attached");
   - `deleteOnDevice`, `deleteOnServer`.
   The editor is in `renderTemplateTaskEditor` (app.js:11981). They are copied onto `jobActions` in `applyJobTypeTemplateToJob` (app.js:19764).
2. **Job timer.**
   - Add a real `paused` ("On hold") dispatch status and a job-clock state driven by `timerAction`.
   - Start/resume opens crew work time entries; On hold closes them; Terminate closes everything and ends the job day.
   - Server-side through `fieldAdvanceJob`/`fieldClock`.
3. **Forms builder** (office, a new Forms tab next to Job Templates).
   - `formTemplates` gains `displayName`, `description`, `availableOnFormsMenu`, `timesheetActions[]` (shift start / shift end / break start / break end), `isActive`.
   - An ordered `fields[]` of `{displayName, fieldRef (auto-slug), type, required, options/config}`.
   - Types: calculation, cascading list, checkbox, date, label, money, multi-select, number, odometer, picture capture, select, signature, text, time, url. Existing `yesno`/`checklist`/`photo` map onto these.
4. **Field rendering.**
   - `field/forms.js` renders every type.
   - A "Form" task with `formTemplateId` opens that form inline. Today it falls through to a notes box (`renderFrontlineTaskCapture`, app.js:15713).
   - Repeatable tasks allow N submissions.
   - Timesheet-action forms open on clock in/out.
   - `deleteOnDevice`/`deleteOnServer` govern the cached package and the retained submission.

---

## Still open for the owner (recorded in the phase doc, not blocking)

- **The "Post-work report" note was cut off** ("hidden until at least one …"). The plan assumes *one dispatch job reaching field complete*.
- **The live Dell data** (duplicate walk activities, desk-GPS check-in points, several locations at one address) gets cleaned with the Wave B cleanup script and the Wave D merge tools. It runs on a scratch copy first, then on live only with the owner's go-ahead. The live server is in use.
- **Work Authorization wording** needs the owner's review before it is enabled.

## Order of work

A → B → C → D → E → F. A is mostly independent fixes; per the budget memory, ~4 Sonnet worktree workers per wave, split by file area (field/, app.js office UI, server.mjs, styles/index.html), each rebasing first and merged by 3-way apply. B depends on A.9 (sketch ids). D.2 depends on D.1. F is the largest and is planned in its own doc before building.

## Verification (every wave)

- `node scripts/smoke.mjs` green before each commit.
- Playwright click-test on a scratch server (`PORT` + `CRM_DATA_DIR` copy, `CRM_BACKUP_INTERVAL_MINUTES=0`, break-glass password), including a **field login** (not admin). That was the hole that hid the status bug.
- Licence scan: decode a sample AAMVA PDF417 barcode image through both the `BarcodeDetector` path and the vendored-decoder path in Playwright. Confirm only the minimum fields are stored.
- Wave A: acknowledge on the Work tab → bottom button advances to "Mark en route". Roll call Arrived persists after reload. Briefing blocked with nobody arrived. Walk photo delete/replace/reuse/markup. Sketch appears in the PDF and share page. 12 stacked pins print legibly.
- Wave B: complete a walk → one timeline record, Completed, links to the walk page; win the deal → the project Plan/Files/Live tabs show the walk.
- Wave C: Needs info → requester notified, red dot; edit without the tick stays Needs info.
- Wave D: a check-in at the desk far from the facility prompts; a duplicate address prompts; merging two facilities keeps every link.
- Docs: phase doc status, README table, OUTSTANDING, database-handoff-map updated in the same session.

---

## Build record

*(filled in as each wave ships)*

## Corrections found during implementation

**Wave A (2026-09-29)**
- **Two upload paths had never worked.** Briefing signatures (`X-Entity-Type: jobSafetyBriefing`) and form photos/signatures (`formSubmission`) were refused as unknown document entity types. Both are valid types now, readable by field logins.
- **The phone crashed on refresh** for any job whose account has two or more contacts: `projectBackendState` sorted contacts by `a.name`, but field sessions only receive `fullName` (the "reading 'localeCompare'" toast). The name sorts are now null-safe.
- **Blocked-step reasons were never shown.** The bottom-button handler read `error.payload.reason`; the server sends `{error, blocked}`.
- **Standalone forms could not save** from a field login: no jobId → 403, and the submitter could not read it back. The submitter can now do both.
- **Field logins now see all active employees (name and title only)** so "+ Add person on site" works. Before, a field session saw only itself and its crew-mates.
- **The project stage never moved from the phone:** `fieldAdvanceJob` did not advance the project stage the way the office path does. It does now.
- **Who counts as lead is decided per job.** A dispatch-link session always carries the Field Lead role, so the server now uses the job's lead or the `isFieldLead` assignment and only falls back to the role when the job names no lead.
- **Multi-day jobs share one briefing.** `dispatchJobOperationalDate` is fixed once work starts, so every day of a multi-day job maps to the same briefing row. Recorded, not changed; a per-day briefing needs its own decision.
- **Still open:** `frontlineAutoAdvanceJob` writes `completionPercent` with a raw save, which the server drops for field logins (unchanged).
- **Opening a walk share link bumped the report's version**, so an offline-queued walk save came back 409 and dropped the photo link. Walk report saves queued offline now replay without a version (`queuedLastWriteWins`); the generic POST keeps `shares` and `completedAt`/`completedBy` from the stored row.
- **A pure Sales (Account Manager) phone showed "No field employee"**, because Sales cannot read employees. `withWalkParticipantRows` now includes the walker's own employee row (id, names, title, status).
- **Photo Remove only soft-deletes versions uploaded since the walk started** (5 minutes' leeway). A photo that was already on the opportunity and linked in with "Choose existing" is only unlinked.
- **The measurements dialog's Close button was never wired.** Fixed; closing also stops a GPS walk in progress.
- **Pins on uploaded floor plans were never printed** (only the aerial background's pins). The PDF now prints one figure per background that has pins.
- **Mobilization gating already treated anything but "Yes" as No**, so the spill-call N/A option needed no gate change.
- **Both Wave A and Phase 24 bumped the service worker to v66** on the same day; the merge took v67 so phones refetch.
- **Not done in A:** the desktop walk panel does not show sketches yet (Wave B, with the walk page).
