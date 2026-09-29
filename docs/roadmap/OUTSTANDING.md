# What's Left — compiled 2026-09-25 (end of the Front Line 2 sprint)

A single view of everything still to do, across all 22 phases. **This is a snapshot, not a source of truth** — the phase docs are. Regenerate or correct this when a phase ships rather than editing it in isolation, and if this file and a phase doc disagree, the phase doc wins.

Shipped work is deliberately not repeated here; `README.md` has the phase table with each one's "already shipped" summary. The previous snapshot (compiled 2026-09-22, updated through the 2026-09-23/24 sprint) is in git history.

---

## The shape of it

| | Count |
|---|---|
| Phases shipped | 19 — 00, 01, 02, 03, 04, 05, 08, 09, 10, 11, 12a, 12b, 13, 15, 16, 17, 18, 20, and **21 (built 2026-09-25 in one pass, pilot feedback pending)** |
| Phases substantially done, with named leftovers | 2 — 06 (one item, now covered by 21), 07 (item 8, owner-deferred) |
| Phases not started | 14 (Postgres — after the pilot; inventory and runbook ready), 19 (email/Teams — owner's "later") |
| Placeholders, not phases | 22 (site workspace), the AI assistant idea note (`docs/ai-assistant-idea.md`) |
| Engineering leftovers with a name | ~30 (listed below) |
| Blocked on an owner decision or an owner action, not on engineering | 27 (listed below) |

**Where the project is:** every feature phase before the pilot is built. The software for the Pilot Milestone (20, 12a, 12b, 13) has been live since 2026-09-24, and the field app was rebuilt on 2026-09-25. What is left is (1) pilot feedback on Front Line 2, (2) a short list of owner decisions and data chores, (3) engineering leftovers that were deliberately deferred, and (4) the two after-pilot phases.

---

## Gap map

One row per area. **Gap** = what a user would notice is missing or wrong; **Missed** = something a plan or doc claimed that the code does not do, found during the sprint.

| Area | State | Gap or missed item | Where it is recorded |
|---|---|---|---|
| **Front Line 2 — crew** | 🟢 built, 1 pilot day | Server-side advance gate checks fewer conditions than the client's readiness check; a person holding a field role *plus* an office role bypasses the device block | phase-21 build record |
| **Front Line 2 — sales walk** | 🟢 built, 1 pilot day | Walk PDF is the print page (no `site-map` document filed); video, scans and the GPS-walked perimeter built to contract but never exercised with real files or real GPS; imagery history needs network | phase-21, phase-21-site-walk-mapping |
| **Front Line 2 — access** | 🟢 fixed 2026-09-25 evening | **Missed:** walk collections were sales-domain, so a non-sales participant (Logan, Operations Manager) lost every pin. Fixed with the walk-participant rule; regression check 9 in `field-api-check.mjs` | phase-21 corrections |
| **Front Line 2 — reference data** | 🟡 owner action | ERG runs from a 25-material fixture until the two PHMSA PDFs are saved to `docs/uploaded files/erg/`; Manuals & Training shelves hold one placeholder each; Georgetown is the only jurisdiction seeded | phase-21 open decision 11 |
| **Front Line 2 — screens** | 🟡 cosmetic | Job Book, Time, Trips, Receipts, Messages, Location, Settings draw through their legacy renderers inside the field shell; native rewrites are polish, not function | phase-21 build record |
| **Sites model** | 🟢 changed 2026-09-25 | A location now counts as a site (GPS *or* address, promote-to-facility on demand, intake no longer creates a facility per spill call). **Missed:** Phase 02's doc still describes locations as GPS-only; the glossary was updated, the phase doc was not | GLOSSARY, phase-02 (needs a note) |
| **Access model (office roles)** | 🟢 changed | **Missed:** `GET /api/backend/{collection}` used to bypass the per-collection OR rules of the full read; it now goes through `filterBackendForRole` for everyone. No client breakage seen in the sweep, but any office role that relied on the wider single-collection read would notice | phase-21 corrections (W1) |
| **Money** | 🟡 known | Close report prices usage at *sell* rates and calls it cost (no cost basis on the rate card); invoices are one per project (no progress billing); quoted-vs-actual and NTE are not enforced (B5) | phase-08, phase-09, phase-20 Part B |
| **Sales flow truth** | 🟡 triage owed | Won/Lost dual truth and no lost reason (B1); Won owes no project (B2); quotes have no Sent/Accepted/Expired life (B4); stale deals are silent (B6); "Needs information" has no return loop (B11) | phase-20 Part B |
| **Dispatch data** | 🟡 owner data | 18 July-2026 draft dispatch jobs inflate every Blocked count (B9); 22 of 50 dispatch jobs had no project and could not be billed (B3, partly addressed by intake changes) | phase-20 Part B |
| **Recovered accounts** | 🟡 owner data | Six placeholder accounts ("ZZZ Company", "AAAAAAA company", four "Recovered account for <site>") were created by the orphan clean-up on 2026-09-24 so orphaned records kept a parent; the owner asked what they are. Merge or delete once their children are re-homed | phase-20 open decisions |
| **Backups** | 🟡 owner config | Off-machine copy is built but `CRM_BACKUP_DIR` is not set on the live server; backups are local only (rolling 10) | phase-20 open decisions |
| **Compliance data** | 🟡 owner data | The two permits still need numbers, agencies and expiry dates (Office → Compliance); fuel surcharge 10% needs confirming as current | phase-11, phase-08 |
| **Templates** | ⏸ owner-deferred | Job template rebuild (Phase 07 item 8, Q34); Front Line's action ordering is positional, the dependency graph is not built | phase-07, phase-10 |
| **Identity** | 🟡 known | OwnTracks pings still use a token-less endpoint (needs a per-device token); Q54 account lifecycle status back-burnered | phase-12 corrections, phase-20 B10 |
| **Postgres** | ⚪ after pilot | Big-bang cut-over with rehearsal and a tested path back; `cutover-runbook.md` and the handoff map are ready; 8 new Phase 21 collections need tables | phase-14, database-handoff-map |
| **Email / Teams** | ⚪ after pilot | Stage 1 (send a quote PDF, tracked on the timeline) is scoped; Graph permissions not requested | phase-19 |
| **Reporting** | ⚪ after pilot | Dashboards, global search, the "activity progress report" all wait for Postgres | phase-11 deferred list |

---

## Owner decisions and actions still open (27)

**Front Line 2 (phase-21, 11):** invoices tile dropped — confirm; crew logins (Microsoft for every crew member, or per-dispatch links + leads only); air monitoring in-app or on paper; customer signature required or optional at Field complete; edit the site-walk checklist sections and the seven required shots before they are seeded; confirm background location stays out; keep the name "Front Line"; LiDAR: is "share a scan from Polycam/Scaniverse" enough; video cap (500 MB) and customer visibility; crew-mates' phone numbers and the inventory catalog visible on the lead's phone — confirm; **save the two ERG PDFs into `docs/uploaded files/erg/`** and name the first manuals for each shelf.

**Site walk map (phase-21-site-walk-mapping, 5):** share-link expiry (14 days) and whether customers may ever receive one; live share page vs frozen snapshot; first reference layers (parcels only, or city storm/sewer too); the eight pin kinds and four colours; get a free ArcGIS Location Platform key or keep the keyless endpoint through the pilot.

**Data and config (6):** set `CRM_BACKUP_DIR` to a OneDrive folder; enter the two permits; confirm the fuel surcharge; decide the fate of the six Recovered accounts; clear the 18 July draft dispatch jobs (`scripts/clean-orphans.mjs --july-drafts`); Q54 account lifecycle status.

**Tutorials (phase-24, 4):** start the training copy (`node scripts/reset-training.mjs --tunnel`) and paste its address into live's Identity & Sync › Training copy; set each trainee's training password; register the nightly reset task (`schtasks` line in `README.md`); later, with a permanent address, add the training address as an Entra SPA redirect URI.

**Older, still open (5):** Phase 04 — does an expired customer approval block dispatch or warn; per-scope or blanket approval; who maintains the approved list. Phase 07 item 8 — template rebuild (Q34). Phase 20 — triage session for Part B (B1–B12).

---

## Engineering leftovers, by phase

Items a session could pick up without an owner decision. None blocks the pilot.

- **Phase 21 (Front Line 2):** port the client's live-eligibility / vendor / equipment readiness sub-checks into the server's advance gate; block a dual-role session by device when it is on the phone (e.g. when the `surface=phone` route is in use, or by narrowing `activeRole`); file the walk PDF as a `site-map` document (needs a client PDF path); exercise video (chunked upload + Range playback), scans (GLB in the viewer, USDZ AR link) and the GPS perimeter with real files on a phone; native `field-*` versions of the seven utility screens; `posterDataUrl` for video posters is not kept server-side; walk-package tile pre-cache (`downloadArea`) is not called automatically when a walk is scheduled.
- **Phase 21 docs:** Phase 02's places doc needs a 2026-09-25 note that a location is "GPS or address" and can be promoted; `erp-operational-architecture.md`'s Front Line contract rules 3 and 6 (append-only merge by key, hash-verified attachment linking) are partial.
- **Phase 20:** Part B triage (B1–B12) — B7 (Multi-Stage has no schedule) and B8 (projects' dual truth) are the two with a code shape already suggested in the doc; the 18 unused functions and 13 reader-less collections noted in the audit; `saveDispatchSchedule` reads two removed inputs; splitting `app.js` further (the `field/` split is done; the office app is still one 34k-line module).
- **Phase 09 / 08:** a cost basis on the rate card so the close report's P&L stops using sell rates; progress billing (more than one invoice per project).
- **Phase 11 deferred list:** approval chains (were waiting on Phase 12 — identities now exist); project commercial controls (needs "committed" defined); laboratory/methods master table; per-person notification of site walks (identities exist now; notification infrastructure does not).
- **Phase 12:** per-device token for `/api/owntracks`; Phase 04's "notification on W-9/COI submission" is the requirement's In-review red dot — a real notification waits on the same infrastructure.
- **Phase 10 / 07:** the action dependency graph (`job_action_definition_dependencies`) — positional ordering only; equipment/material conflicts have no reference field to "Go to blocker" on.
- **Phase 06:** item 16's guided capture flow is **delivered by Phase 21's site walk** — mark closed in the phase doc.
- **Phase 05 / glossary (B12):** verify whether the contact "account role vs job title" split (glossary says slotted into Phase 05 item 8) was ever built.

---

## After the pilot

- **Phase 14 — PostgreSQL migration.** Big bang at the alpha (owner reversal, 2026-09-22): rehearsal, cut-over day, tested path back to JSON. `docs/roadmap/cutover-runbook.md` and the cutover inventory in `docs/database-handoff-map.md` are ready; the eight Phase 21 collections (`jobSafetyBriefings`, `jobEquipmentUsage`, `formTemplates`, `siteWalkReports`, `siteWalkObservations`, `siteReferenceLayers`, `jurisdictions`, `libraryItems` + acknowledgements and the ERG tables) need tables designed. Hosting: managed cloud (Azure preferred).
- **Phase 19 — Email & message tracking.** Stage 1 is scoped (send a quote with the PDF attached, tracked on the timeline); Stages 2–3 need their own scoping pass. Needs Graph permissions on the `bioremedy.com` app registration.
- **Phase 22 — Site workspace.** Placeholder only. The four data rules Phase 21 follows keep a desktop editor cheap; plan it once real walks exist.
- **Phase 24 — Tutorials.** Built 2026-09-29: 14 screen tours, 6 hands-on tutorials on the training copy, the Home Learn card, the printed guide (`scripts/build-user-guide.mjs`, also the smoke check). Left: the Office tour after Phase 23; the owner actions above.
- **Phase 23 — Work Inbox & Capabilities.** Planned 2026-09-28 from the owner's "office manager applet is useless / cross work" conversation. Capabilities as data plus record-scoped assignment roles (the unbuilt Phase 12 item 3), the Office applet rebuilt as Inbox / Compliance / Readiness / Purchase Orders, sales leads requesting dispatch through the existing intake queue. Owner decisions D1–D4 are in the doc; three open decisions remain.
- **Not on the roadmap:** the AI assistant idea (`docs/ai-assistant-idea.md`).

---

## Decisions history

The owner answered all 52 questions on 2026-09-22 (each recorded under **"Decisions locked 2026-09-22 (owner)"** in its phase doc; only Q54 is back-burnered). On 2026-09-23 three more were answered with the 22-item bug list (site walks get the full build; dispatch picks people by availability and credentials, crews are quick-picks; a pause blocks outright). On 2026-09-24/25 the Front Line 2 plan locked: real phone route + keep the simulator; cached packages + outbox, not the full conflict protocol; projection-based field access; one app with a role-based home; the lead runs the job; LiDAR by sharing a scan; Google/Bing imagery out; offline service areas on company phones; city GIS layers live or as snapshots; and the four desktop-readiness rules. On 2026-09-25 the sites model changed: a location is a site (GPS or address), promoted to a facility only by hand.

---

## Suggested order

1. **Pilot Front Line 2 for a week** with real crews and one sales walk. Collect the feedback into the phase doc's build record; fix what the field says first.
2. **Owner half-day:** the 27 decisions and actions above — the ERG PDFs, `CRM_BACKUP_DIR`, the permits, the Recovered accounts and the July drafts are each under ten minutes.
3. **One engineering session on the Phase 21 leftovers** that pilot feedback confirms matter (advance gate, dual-role device block, real-file media checks).
4. **One triage session on Phase 20 Part B** (B1–B12) with the owner, then build what it picks.
5. **After the pilot:** Phase 14, then Phase 19 Stage 1.
