# Phase 06 — Opportunity Domain Correctness

**Status:** 🟢 **Substantial progress, 2026-09-17 session.** Items 2, 4, 6, 7, 8, 11, 14, 18 (already done), 19 (partial), 23 done and verified live. Item 1's close-date half also decided and shipped this session (`closeDate`/`estimatedCloseDate` → `closeQuarter`, quarter granularity — see item 1's writeup). A major architectural finding: "Associated Contacts" (Summary tab) and "Stakeholders" (Develop & Planning tab) were two independent, non-synced systems for the same concept — the former read a buggy scalar-derived array (`contact.opportunityIds`, item 6's bug) with a wrong edit dialog (item 7's bug), while the latter (`opportunityContacts`, a real many-to-many junction) already had working add/edit/remove. Consolidated onto the working system rather than building new infrastructure for items 6/7/11/19. Remaining items are either product decisions the owner needs to make (1's cleanup-type/jobClass alignment, 5's vocabulary, 20), coordinated with other phases (3 with Phase 03/05, 13 with Phase 04, 16 with Phase 13), or not yet started (9, 10, 12's remaining scope, 15, 17, 21, 22, 24, 25).
**Depends on:** Phase 03 (Account domain patterns — edit-button audit, Create dropdown), Phase 05 (contact↔opportunity relationship touches the same `opportunityIds` field Phase 05 owns on the contact side)
**Estimated sessions:** 3–4
**Source:** `bioremedy crm notes 9.16.2026.docx`, verified against code 2026-09-16 (see per-item notes below)

---

## Why this phase exists

Phase 03 did the equivalent audit for Accounts. This is the same exercise for Opportunities — the single most feedback-dense entity in the 2026-09-16 notes. Most items here are either a confirmed bug (verified against code before this doc was written, not just transcribed from the notes) or a real gap in the associated-contacts / activity model that Opportunities and Contacts both touch.

**Every claim below was checked against the running code on 2026-09-16** before being written into this plan, per this project's own rule that plan docs written from assumption go stale fast. Each item says CONFIRMED, PARTIALLY CONFIRMED, or NOT FOUND, with the file:line evidence. Do not re-verify items marked CONFIRMED from scratch — trust the citation, spot-check only if the surrounding code has since changed.

---

## In scope

### 1. Close dates and cleanup-type alignment

> *"Opportunities should not have close dates, or atleast make it general. They can be hard to follow. Cleanup types in opportunity don't align with field work deployment."*

Two separable asks:
- Should `closeDate` be optional or replaced with a coarser field (quarter/month)? Needs a decision, not just a fix.
- The `serviceType`/cleanup-type vocabulary should be reconciled with whatever categorizes work once it becomes a project/dispatch job (`jobClass`: Emergency Response / Multi-Stage Remediation / Scheduled Work) — today these are two independent enumerations with no declared mapping. See item 5 for the related rename.

**✅ Close-date half done 2026-09-17 — owner decided: replace with a coarser field, quarter granularity chosen over month.** `opportunities.closeDate` and its parallel/redundant `estimatedCloseDate` (both were always written from the exact same value at record-build time — confirmed at `buildCoreOpportunityRecord()`, `app.js` — there was never a reason for both to exist) are gone, replaced by a single `opportunities.closeQuarter` field, a `"YYYY-Q#"` string (e.g. `"2027-Q1"`). **Why quarter, not month:** the note's complaint was specifically about *precision* ("hard to follow"), not display format — a month field (e.g. "Jan 2027") still commits to a specific 30-day window and doesn't meaningfully lower the cognitive load an exact date carries; a quarter is the more decisive cut and reads cleanly as a badge/column value ("Q1 2027") in every surface this touches (list column, board card, detail metrics). This was a judgment call within what the owner authorized ("replace with quarter/month, pick whichever reads better") — flagging here in case the owner disagrees once they see it live.
- Added a dedicated set of helpers (`formatCloseQuarter`, `closeQuarterStart`, `closeQuarterEnd`, `dateToCloseQuarter`, `closeQuarterOptionValues`, `defaultCloseQuarter`, `populateCloseQuarterSelect` — all in `app.js` near `parseDate`) instead of forcing the old exact-date functions to cope with a coarser value.
- `getCloseStatus()` was rewritten (it had just been enhanced this same session with days-overdue/days-to-close logic, before this decision landed) to work off quarter boundaries instead of day counts: a quarter that's fully in the past reads "overdue" (high tone), the current quarter reads "this quarter" (medium tone), and a future quarter just reads "Close Q# YYYY" (low tone). `opportunityPriorityScore()` (used to rank the pipeline's "needs attention" list) still needs day-level granularity internally for scoring — it now measures distance to the *end* of the close quarter, not an exact close day, which is a reasonable proxy without inventing false precision anywhere user-visible.
- The opportunity dialog's `<input type="date" name="closeDate">` (`index.html`) became `<select name="closeQuarter">`, populated at open-time with quarter options spanning last-year through 3-years-out (plus the record's existing value if it falls outside that window, so old/unusual data never silently disappears from the dropdown). New opportunities default to *next* quarter from today rather than "+30 days."
- Every display/sort/read site enumerated in the working map was updated: list/table columns (`opportunityTableViews.forecast`), the pipeline board card and mini-cards, the Summary tab's metric strip and "Dates & source" panel, the Contact page's opportunity card, the master `state.opportunities` sort (now a lexical `"YYYY-Q#"` compare, which sorts correctly since the format is fixed-width), and `saveOpportunity()`'s form read. The one non-obvious downstream site was `openProjectFromOpportunityDialog()`'s auto-fill of a *project's* `targetDate` from the opportunity's close date — deriving an exact day from a quarter would be false precision, so it now uses the quarter's start date only as a rough anchor when that's still in the future, otherwise falls back to the existing "+30 days" default every other quick-create flow in the app already uses.
- **Migrated existing data, not blanked:** every opportunity in `data/backend.json` and `server.mjs`'s fallback seed data had its exact `closeDate`/`estimatedCloseDate` converted to the quarter it fell in (e.g. `2026-07-24` → `2026-Q3`), not dropped. `buildCoreOpportunityRecord()` also keeps a defensive fallback (`dateToCloseQuarter(opportunity.closeDate || opportunity.estimatedCloseDate)`) for any record that somehow still carries only the legacy fields.
- **Verified live via Playwright:** created a new opportunity, confirmed the dialog defaulted to next-quarter and offered a full quarter/year range; saved with a future quarter (Q1 2027) and confirmed the detail page's metric strip, risk badge, and Contact-page card all render "Q1 2027"/"Close Q1 2027" correctly; reopened the same opportunity's edit dialog and confirmed the saved quarter round-trips into the `<select>`; confirmed the list ("Forecast View") sorts ascending by quarter (Q3 2026 → Q4 2026 → Q1 2027) and the pipeline board's badges show the right tone (medium/"this quarter" for Q3 2026, low/future for Q4 2026 and Q1 2027). No console or page errors during any of this. Test records were deleted from `data/backend.json` afterward.
- **Found and left alone, documented for future reference:** `tableViewRegistry.opportunities` and its sibling literal object (`app.js`, originally at the file's top table-view section) is dead code — it gets fully overwritten by `tableViewRegistry.opportunities = opportunityTableViews;` a few dozen lines later and is never read anywhere via bracket access. Its `columns: [...,"closeDate",...]` entry was updated to `"closeQuarter"` for hygiene/consistency, but this object has zero effect on the live UI; the only opportunity table columns that actually render come from `opportunityTableViews` (`board`/`forecast`/`qualification`/`activity`), which were the ones actually fixed and verified above. Not in scope to remove the dead code this session — flagging so a future cleanup pass doesn't have to re-discover it.
- Cleanup-type/`jobClass` alignment (the doc's second bullet) is untouched — out of scope for this pass, tracked separately under item 5.

### 2. New-opportunity-from-account-page doesn't navigate to the new record

> *"Sometimes creating a new opportunity from account page will be successful but wont take you to opportunity page."*

**CONFIRMED, but deterministic, not intermittent.** `saveOpportunity()` (`app.js:12500-12539`) is the single save handler for every "New opportunity" entry point (global pipeline button and the account-page button both route through the same dialog/handler, `app.js:2319`). On success it only does `closeDialogs(); await refreshState(); render();` — it never sets `state.selectedOpportunityId` / `state.view = "opportunity-detail"`, unlike `saveAccount()` and `saveContact()`, which both do. A working navigation helper already exists (`viewOpportunity(opportunityId)`, `app.js:17312-17323`) — `saveOpportunity()` just never calls it. **Fix: call `viewOpportunity()` (or set the two state fields directly) after a successful create**, matching the account/contact pattern. Rewrite the note as "always fails to navigate," not "sometimes."

**✅ Done 2026-09-17.** Replaced the bare `render()` call with `viewOpportunity(opportunity.id)` (which itself calls `render()`), for both create and edit. Verified live via Playwright — first attempt appeared to still fail, but that was a test-script bug (the dialog's required "Next step" field was left empty, so the browser's native HTML5 validation silently blocked submission before `handleSubmit` ever ran); with all required fields filled, navigation to the new opportunity's detail page is confirmed working, hash-routing included.

### 3. List-view search/filter cleanup (Opportunities)

> *"Do these same cleanup steps on contacts and opportunities. Note that on opportunity views that have lists should also have the same search ability like detailed above."*

Companion to Phase 03 item — replace ad hoc "Search accounts or sites" / "all industries" / "different views" style controls with consistent filter/search buttons, applied to opportunity list views specifically. Build once, reuse across Accounts (Phase 03), Contacts (Phase 05), and here — do not implement three separate filter bars.

### 4. Remove "blue text box" style on the opportunity table

> *"Also on the opportunity and contact table remove the blue text boxes like we did for accounts."*

Purely visual — find whatever styling was already removed from the account list/table view and apply the same treatment to the opportunity table. Cross-check against the account fix before assuming which class/style is meant.

**✅ Done 2026-09-17 — found by visual comparison, not by guessing.** The Accounts table has no equivalent column, so "what we did for accounts" wasn't a direct precedent to copy. Screenshotted all three list views to find the actual match: the Contacts table's "Opportunity Links" column renders each linked opportunity as a `.mini-button` — a bordered, light-blue-filled pill, meant for action buttons, reused here as an inline tag list, which reads as clutter with several per row. Fixed with a scoped CSS rule (`.chip-list .mini-button`) that strips the border/background/shadow and shows plain underlined blue text on hover, keeping the click behavior — "text link," not "text box." Applied the same class to the newly-clickable badges in item 8's fix (Contact page's "Connected via" panel) for consistency, since duplicating the boxed style there would have reintroduced the same complaint immediately.

### 5. Rename "Cleanup Type" → "Opportunity Type"; add new values

> *"When creating an opportunity is asks for cleanup type, we may want to add Investigation Needed or unknown or something like that. We might also want to rename it to Opportunity type."*

Rename the field/label everywhere it renders (creation dialog, detail page, any filters). Add `Investigation Needed` and `Unknown` (exact final wording TBD) to the value list. Cross-reference item 1 — if this field is going to reconcile with `jobClass` downstream, do that reconciliation here rather than twice.

### 6. Contact ↔ Opportunity is really many-to-many; UI and lifecycle both wrong

> *"When editing a contact you can only have one associated opportunity, this should be a one to many style relationship where a contact can be on many opportunities... but then later editing that contact leaves in the original opportunity in a stuck stage... we need to fix the associated opportunity when you go to edit the contact."*

**CONFIRMED — data model is already array-shaped, only the UI enforces single-select.** `contacts.opportunityIds` is a real array field (`app.js:12628`: `opportunityIds: opportunityId ? [opportunityId] : []`), but:
- The contact dialog's opportunity field is a plain `<select name="opportunityId">`, not multi-select (`index.html:1069-1071`)
- `openContactDialog()` only ever shows/edits the *first* array entry: `form.elements.opportunityId.value = (contact.opportunityIds || [])[0] || ""` (`app.js:15261`) — any additional entries would be silently dropped on next save
- No cleanup event exists for a won/lost opportunity that removes it from a contact's association — the note's suspicion ("I am not sure if there is a cleanup event") is correct, there isn't one

**Fix:** replace the single select with the multi-select/lookup pattern Phase 05 is already building (item 4 of that phase — "one reusable lookup component"). Decide whether won/lost opportunities should auto-drop off the contact's active list or move to a "past opportunities" section (mirrors the "formerly associated contact" pattern in item 12 below — consider building one generic "current vs. former association" UI pattern and reusing it for both).

**✅ Done 2026-09-17 — root cause was narrower than "needs a multi-select component."** The real damage wasn't that the contact dialog's picker only shows one entry — it's that `saveContact()` **overwrote** `opportunityIds` with a fresh one-element array on every save (`opportunityIds: opportunityId ? [opportunityId] : []`), silently destroying every other association a contact had accumulated via the (separately correct) opportunity-side Stakeholders flow, which already appends via `linkContactToOpportunity()` without dropping existing entries. Fixed by making `saveContact()` preserve the existing array untouched on every edit (`existing ? existing.opportunityIds || [] : ...`) — only a brand-new contact's initial pick is ever written from this dialog. The dialog's "Associated opportunity" field is now hidden entirely when editing an existing contact (with a note pointing to the opportunity's own Stakeholders panel), since a field that silently no-ops on save is worse than no field. **No new lookup component needed** — see item 7, which found the two "add a contact to an opportunity" surfaces were really the same underlying junction (`opportunityContacts`) already supporting true one-to-many.

### 7. Associated Contacts "Edit" opens the wrong dialog

> *"When in an opportunity under associated contacts you can click 'edit' and it will let you edit the contacts core details using the standard contact edit page. We should have this be a relevant edit page as it relates to the specific opportunity that is open."*

**CONFIRMED.** The opportunity's Associated Contacts panel (`app.js:3481`, `renderMiniContact` at `app.js:5642-5658`) wires its Edit button to the exact same `open-contact` action (`app.js:2073` → `openContactDialog`) used by every other "edit a contact's core details" entry point in the app. There is no opportunity-specific relationship/role editor. See item 19 for what that editor should actually contain (a Decision Maker tag, and likely other opportunity-scoped relationship metadata) — build both together, this item is the UI shell and item 19 is what goes inside it.

**✅ Done 2026-09-17 — a fully-working opportunity-scoped editor already existed, one tab over, unconnected.** The Develop & Planning tab's "Stakeholders" panel (`opportunityContacts` collection, `openOpportunityStakeholderDialog`/`saveOpportunityStakeholder`/`removeOpportunityStakeholder`) already had exactly what this item asks for: a relationship role, an influence-level vocabulary (including "Decision maker" — see item 19), a primary flag, and working add/edit/remove. It was simply never connected to the Summary tab's "Associated Contacts" panel, which used a completely different, buggier data source (see item 6). Extracted the shared rendering into `renderStakeholdersPanel()`/`renderStakeholderCard()` and pointed **both** panels at it — Associated Contacts and Stakeholders are now the same data, same dialog, same add/edit/remove, in two places on the page. Verified live: adding a stakeholder from Summary's "Associated Contacts" panel immediately shows up in Develop & Planning's "Stakeholders" panel and vice versa.

### 8. Opportunity links on the Contact page aren't clickable

> *"On contact linked opportunity page, opportunities are not clickable."*

**CONFIRMED** for the "Connected via projects and opportunities" panel: `renderContactConnectionCard()` (`app.js:6579-6595`) renders the connected *person's* name as a real button (`data-action="view-contact"`, `app.js:6588`) but concatenates the opportunity/project names into plain, inert text (`app.js:6592`) with no click handler at all. Make them real links (`data-action="view-opportunity"` / `view-project"`). If a *separate* "this contact's own associated opportunity" display also exists elsewhere on the contact page and is likewise non-clickable, fix it there too — confirm during implementation which surface(s) this note was pointing at (it may be exactly the panel above, since a contact's single associated opportunity would also show up in "connected via").

**✅ Done 2026-09-17.** `renderContactConnectionCard()` now renders each shared opportunity/project as its own `view-opportunity`/`view-project` button instead of a joined text blob, capped at 4 (partially covers item 12's "render as badges, cap to most recent 3-4" too — see that item for what's still missing). Styled as plain chips, not boxed buttons (see item 4).

### 9. Multiple contacts per activity

> *"Adding associated contacts to an opportunity is only possible through editing statuses like 'Lead details' or by connecting them via an activity. But activities only allow one contact included per activity. We need to expand that to allow multiple contacts be connected to a single activity."*

**CONFIRMED — and this is a schema change, not just a UI change**, weaker than item 6's case. `activities.contactId` is a plain scalar string everywhere it's written (`buildCoreActivityRecord()`, `app.js:4160/4168`; every save site, `app.js:13884/13893/13938/13963/13984/14006/15447/15686/16155`), not an array. The activity dialog's contact field is a single non-multiple `<select>` (`index.html:2054-2056`). Fixing this requires: (a) `contactId` → `contactIds: []` on the activities schema, (b) a migration path for existing single-`contactId` rows, (c) a multi-select or the same reusable lookup component from item 6/Phase 05 item 4. This is the same underlying capability Phase 05 needs for its own timeline work — coordinate, do not build two different multi-contact patterns.

### 10. Lead stage refinement + "current situation" data source

> *"Lead stage is a bit irrelevant if the industry is coming from an account... Lead stage gets it's current situation from somewhere, I don't know where that data comes from but regardless of the cleanup type it lists the same thing. 'Municipal emergency response and environmental services'"*

Two distinct issues bundled in one note:
- **Product question:** should Lead stage be shortened/skipped when industry is already known from the account? Needs a decision on the stage-gate flow, not just a bug fix.
- **Bug to trace:** find where `currentSituation` (or whatever field renders that sentence) gets its default value — the note's suspicion that it's the same text "regardless of cleanup type" suggests either a single hardcoded seed string leaking into new records, or a template/placeholder rendering as if it were real data. Verify against `buildCoreOpportunityRecord()` and the Lead Qualification tab's render function before assuming the mechanism.

### 11. Associated Contacts — add/remove with a "Formerly Associated" section

> *"we need to allow users the ability to add and remove associated contacts, if someone is removed, they should be dropped down to a formerly associated contact section that only appears if they were removed. The user can then hide the 'formerly associated contact section with a small button click that should be aligned to the right side of the box on the same line as 'Associated Contacts'..."*

Specific UI spec, not just a data model gap:
- Add/remove controls on the Associated Contacts panel (removal currently has no path at all — confirm during implementation whether any `remove-opportunity-contact`-style action exists; the notes author separately says "I think I somehow was able to remove a contact from an opportunity, I am not sure how I did this," suggesting the removal path may exist accidentally/undiscoverably rather than not at all — find and confirm before building a new one)
- Removed contacts move to a "Formerly Associated Contacts" section, not deleted
- That section is hidden by default, shown only when at least one former contact exists
- A small toggle button, right-aligned on the same header line as "Associated Contacts," shows/hides it

**✅ Done 2026-09-17 — confirms the note's own suspicion: add/remove already existed, just on the wrong panel.** `removeOpportunityStakeholder()` was real (soft-delete via `deletedAt`) but only reachable from the Develop & Planning tab's "Stakeholders" panel — exactly the "I somehow was able to remove a contact... not sure how" the notes describe. Now reachable from Associated Contacts too (item 7's consolidation). Built the rest of the spec on top: former (soft-deleted) stakeholders are queried separately (`formerStakeholdersForOpportunity()`), a toggle button on the panel header reads "Show/Hide formerly associated (N)" and only appears when N > 0, and a new "Restore" action clears `deletedAt` to bring one back without re-creating it from scratch. Verified live: remove → toggle appears → show reveals the former entry with Restore → restore brings it back to the active list.

### 12. "Connected via" panel — broaden sources, add filtering, badge display, cap the list

> *"On contact page connected via projects and opportunities only populates if the contact is listed as a associated contact for a project which forces them to be a account contact. This should include 'team Members' and maybe some other areas. But we also want this filterable. ...we want those opportunities to be listed like badges and only list the most recent 3-4 opportunities or projects."*

This is really a Contact-page item (Phase 05 owns the Contact detail page) but it's driven entirely by opportunity/project associations, so implement it alongside item 8 above once opportunity links are clickable. Scope:
- Include project **team member** assignments as a connection source, not just account-forced associated-contact relationships
- Make it filterable (ties to Phase 05's activity-tag filtering work — reuse the same filter-chip pattern if it fits)
- Render opportunities/projects as badges, not a comma-joined text blob
- Cap the display to the most recent 3–4, not the full history

**🟡 Partially done 2026-09-17, alongside item 8.** Badges (not text blob) and the cap (4, not "most recent" — no reliable recency field to sort by was found) are both done. **Not done:** including project team-member assignments as a connection source, and filtering. Both are real additions beyond the click-target fix, left for a dedicated pass.

### 13. Resource Needs (Develop & Planning) — vendor/sub free text now, approved-list-only later

> *"Develop and planning section of opportunities, under Resource needs it lists vendor/subcontractor needs... having it be open text free for any entry makes sense but later we will want the sub/vendor entries to be selected from the approved vendor/sub list."*

No action this phase — the owner explicitly says free text is fine *for now*. **Dependency to track:** once Phase 04's Layer 2 (`account_approved_subcontractors`) ships, come back and convert this field from free text to a picker scoped to subs approved for *this* customer account. Do not build the picker before Phase 04 ships the approval list it would read from.

### 14. Primary stakeholder checkbox — CSS layout bug

> *"on opportunity develop and planning the primary stakeholder checkbox is floating way off out of the way."*

**CONFIRMED, exact cause found.** The Stakeholder dialog's checkbox uses `class="checkbox-label"` (`index.html:407-410`), a class with **zero rules defined anywhere in `styles.css`**. Every other checkbox-plus-label pairing in the app (40+ occurrences) uses `class="check-row"`, which has real layout rules (`styles.css:4271-4283`). Without a matching rule, this one checkbox falls back to the bare `label` grid rule (`styles.css:2789-2795`), which is built for "label text above a single input," not "checkbox beside inline text" — producing exactly the "floating" look described. **Fix is one attribute change:** `class="checkbox-label"` → `class="check-row"` at `index.html:407`.

**✅ Done 2026-09-17 — exactly as scoped, plus the matching markup pattern.** Confirmed `checkbox-label` had zero other uses anywhere in `index.html` (a one-off, not a class other dialogs depend on). Swapped to `check-row` and wrapped the label text in a `<span>` (the pattern every other `check-row` checkbox in the app uses) for full consistency.

### 15. Site walk should be schedulable, not just a status dropdown

> *"...on oppoortuntity develop and planning stage we have site walk, but there is only a drop down for incomplete, complete, and not needed. We should have a site walk be a scheduleable task... Where it asks 'is site walk needed' yes or no? based on that it gives you the ability to schedule it really quick and then also just has the existing dropdown menu right after."*

**CONFIRMED as currently just a 3-option dropdown with no scheduling integration.** `opportunity.siteWalkStatus` (`app.js:3587`, edited via `index.html:363-370`, saved as a plain string `app.js:14574`) has no connection anywhere to the timeline, a due date, or any activity/scheduling record. Build: a yes/no "is a site walk needed" prompt that, on yes, offers a quick-schedule flow (creates a timeline activity, tagged appropriately per Phase 05's tag work), while keeping the existing dropdown for recording a site walk that happened outside the CRM without blocking the project on it.

### 16. Site walk — sales-side field capture app (new capability)

> *"If a site walk is needed and scheduled, we may want to have a field app for sales persons as well... If they click the site walk is complete, and no timeline activity for a site walk exists it could ask if the user would like to upload photos, videos, notes, lidar scans, pdfs, drawings, to a retroactively created site walk..."*

This is a genuinely new capability, distinct from Front Line (which is for field *operations* crews, not sales reps). Scope it explicitly as **sales-side site-walk capture**, separate from the Front Line simulator (Phase 10):
- A capture surface (mobile-friendly, does not need to be a separate "app" — could be a responsive dialog) for photos/videos/notes/LiDAR/PDFs/drawings
- Marking a site walk complete with no matching timeline activity prompts: "upload capture now?" → yes goes to the capture surface, no just marks complete
- Depends on Phase 13 (Document Storage) for real file upload — do not build this before Phase 13 ships, or it will need to be rebuilt on top of real storage anyway

### 17. Advance-button validation should highlight what's missing

> *"If someone tries to advance an opportunity using the advance button but all the prerequisites are not met, we should highlight those sections temporarily in red on each page and mark their section button with a red exclamation icon in the top right of the 'Lead & Qualify' or 'Develop & Planning' buttons. This could be a browser based save so reloading the page might retrigger it, but opening a new browser would make it disappear..."*

The stage-gate/required-fields check already exists (`STAGE_REQUIRED_FIELDS`, the missing-fields banner seen live on the Summary tab during Phase 02 testing: *"This opportunity is missing information expected by the Proposal stage: Facility, Contamination, Industry..."*). This item is a **presentation** upgrade on top of that existing check, not a new validation engine:
- Highlight the specific panels containing missing fields, not just a text banner
- Red exclamation badge on the relevant stage-tab button(s)
- Persist the highlight across a reload of the same browser session (the note's own suggestion: "browser based save"), but not across a different browser/device

### 18. "Open Account" button on the Opportunity page

> *"Opportunties need an 'Open Account' button"*

Small, concrete. Add alongside the existing account name/link if one doesn't already function as a real navigation button — verify during implementation whether the account name already does this before assuming it's missing entirely.

**✅ Already done, confirmed 2026-09-17 — no code change needed.** `renderOpportunityDetailHeader()`'s toolbar already has a working `data-action="view-account"` "Open account" button. This item's premise was stale by the time this session picked it up (or was already fixed incidentally by other work) — verifying before implementing avoided adding a duplicate button.

### 19. "Decision Maker Found" should check for a tagged associated contact, not a manual toggle

> *"Lead & Qualifications stage... it says 'Decision Maker Found' and requires a complete or not complete. This should have a check to see if we have connected an associated contact with the tag 'Decision Maker' now this associated contact panel does need an overhaul because it edits the core contact details, iin this overhaul we might be able to create opportunity specific role/relationship/duty tags..."*

Directly extends item 7. Building the opportunity-contextual Associated Contacts editor (item 7) should include an opportunity-scoped relationship tag (Decision Maker, and likely others worth defining alongside it — Champion, Technical Evaluator, Economic Buyer are common CRM equivalents, but confirm the real vocabulary wanted rather than importing a generic one). Once that tag exists, `decisionMakerFound` becomes a derived value (does any associated contact carry the Decision Maker tag?) instead of a manually-toggled field.

**🟡 Partially done 2026-09-17 — vocabulary already existed, wired a safe derivation, didn't fully replace the manual field.** The Stakeholder dialog's `influenceLevel` vocabulary already included "Decision maker" (and Evaluator/Influencer/Gatekeeper/User — a reasonable existing set, no new vocabulary needed). Added `hasDecisionMakerStakeholder(opportunityId)` and used it in the stage-gate check (`STAGE_REQUIRED_FIELDS.Develop`) as an **OR** with the existing manual field — an opportunity passes if either a tagged stakeholder exists or someone already marked it Complete by hand. Checked the seed data first: one opportunity had `decisionMakerFound: "Complete"` with no tagged stakeholder behind it — fully replacing the field (as the roadmap originally specified) would have silently un-completed that opportunity's stage-gate status. The Qualification tab's display now shows a "✓ Tagged stakeholder found" hint alongside the manual status rather than replacing it outright. **Still open:** whether to fully deprecate the manual dropdown in favor of the derived value — that's a UX decision (what happens to existing set-by-hand values) this session didn't have enough context to make unilaterally.

### 20. Quick Notes need a "Regarding" field

> *"Quick notes need a 'Regarding' section this is similar or identical to the note I made about timeline tags earlier."*

The notes author is explicitly cross-referencing their own earlier timeline-tags item (Phase 05, item 2). Do not build a separate "Regarding" field independent of that tagging work — confirm whether "Regarding" means the same thing as an activity tag, or a free-text subject line distinct from tags, before implementing. If distinct, it's a small addition to the Quick Note dialog; if the same concept, it's just Phase 05's tag picker reused here.

### 21. "Schedule Activity" button renders broken

> *"Opportunity File and activity tab on the log activity panel the 'schedule Activity' button drops down into nothing with a weird scrollable bar."*

Reproduce and fix. Not yet traced to a specific line — likely a dropdown/popover with a sizing or empty-options bug. Check whether it's populating from a list that's empty in current data (making the dropdown look "broken" when it's actually just empty) versus a genuine CSS/overflow bug.

### 22. "Add Activity" should go straight to the relevant activity type

> *"On opportunity that add activity button sends a generic activity add panel, we need it to be the drop down and then go to the relevant activity."*

Same "+Create"-style dropdown pattern from Phase 03 item 5 — Add Activity should offer a type menu (Call, Email, Meeting, Site Walk, etc.) and route to the activity type's specific form, rather than one generic form for everything.

### 23. Won opportunity needs an "Open Project" button

> *"Once an opportunity has been won and a project is created we need a button at the top of the opportunity next to 'Edit opportunity' and 'awarded' that says 'Open Project' and takes you to the linked project."*

Concrete, add alongside the existing header actions once the opportunity→project link exists to navigate through (`projects.opportunityId` already exists per the seed data — confirm the reverse lookup, opportunity→its resulting project, is straightforward before building).

**✅ Done 2026-09-17.** Reverse lookup was indeed straightforward (`state.projects.find(project => project.opportunityId === opportunity.id)`, same pattern already used elsewhere for the "Won but no project yet" prompt). Added an "Open project" button to the header toolbar, shown whenever a resulting project exists (not gated strictly to the Won stage, since the button is only ever meaningful when a project actually exists regardless).

### 24. Won-opportunity status badge is stale/misleading

> *"...when an opportunity is won it says 'won' 'close date' and 'won'. I think the first badge is fine, but the second 'won' badge that used to say pipeline should say something like 'project: stage' and list the stage the project is at. This should be similar to the delivery tracker section of the sales applet..."*

The forecast-category badge (normally "Pipeline") doesn't update to reflect the resulting project's actual stage once won. Pull the linked project's stage into this badge, mirroring however the Delivery Tracker view already tracks won-opportunity → project status (reuse that logic/component rather than re-deriving it).

### 25. Core "Opportunity" panel's Edit dialog doesn't match what the panel displays, and Owner/Deal Type/Decision Maker/Competitor are permanently non-editable

**CONFIRMED 2026-09-16**, found during Phase 03's edit-button audit (not from the notes doc — a code-level finding, added here because it's squarely Opportunity-domain work, not an Account fix). Full detail in `phase-03-account-domain.md`'s item 2 section; summary:

- The Summary tab's "Opportunity" panel displays 8 fields (Account, Site/facility, Primary contact, Owner, Deal type, Service type, Industry, Source campaign — `app.js`, `renderOpportunityMainInformation`), but its Edit button opens `#opportunityDialog`, which only actually edits **Account** and **Service type** from that list — the dialog instead carries Value/Close date/Status/Next step, none of which this panel shows.
- **Owner** and **Deal type** (this panel) and **Decision maker**/**Competitor** (the separate "Situation & solution" panel) have **no edit path anywhere in the app** — confirmed by grep across `app.js`/`index.html`, not just "hard to find." `owner` always resolves to `account?.owner || "Unassigned"`; `dealType` always defaults to `"New Business"`; `decisionMaker`/`competitor` are similarly only ever defaulted, never settable.
- Two separable decisions needed before fixing: (a) should the core dialog be redesigned to actually cover what the panel shows (add Site/facility, Primary contact, Owner, Industry, Source campaign fields), or should the panel be trimmed to only show what's genuinely editable there today? (b) should Opportunity `owner` follow the same `ownerEmployeeId`-FK-to-employees pattern Phase 03 just built for Accounts (see that doc's item 1/4), given the same "picker resolves to a display string, no FK" gap likely exists here too — not yet verified whether an opportunity-owner picker exists at all.
- Also found in the same audit pass: editing a historical (non-"Current") quote from the Quote panel used to silently reassign it as the opportunity's current quote. **Already fixed** in `saveOpportunityQuote` (`app.js`) as part of the Phase 03 audit — no action needed here, noted for awareness only.

---

## Out of scope

- Building `account_approved_subcontractors` itself — Phase 04 (item 13 here only prepares for it)
- Real document/file upload for site-walk captures — Phase 13 (item 16 depends on it, does not duplicate it)
- The Quote/Estimate button and module — Phase 08, this phase only assumes it will eventually exist
- Splitting `activities` into per-type tables — deferred per Phase 05's own decision

---

## Data model changes

- `activities.contactId` (scalar) → `activities.contactIds` (array) — item 9, needs a migration for existing rows, **not done**
- ✅ **Not a new field after all, corrected 2026-09-17:** opportunity-scoped contact relationship tags (item 19) already existed on `opportunityContacts.influenceLevel` (Decision maker/Evaluator/Influencer/Gatekeeper/User) — this doc assumed a new junction/field was needed for item 7; the junction (`opportunityContacts`) already existed and just wasn't connected to the Associated Contacts panel. See item 7/11/19's corrections.
- Possible rename: `serviceType`/cleanup-type field → "Opportunity Type" with expanded value list — item 5, **not done**, needs an owner decision on final vocabulary
- ✅ **Done 2026-09-17:** `opportunities.closeDate` and `opportunities.estimatedCloseDate` (both exact-date, redundant with each other) → `opportunities.closeQuarter` (`"YYYY-Q#"` string) — item 1. Migrated existing rows in `data/backend.json` and `server.mjs`'s seed data by deriving the quarter from the old exact date. See `docs/database-handoff-map.md` for the full note.
- Site walk gains a real scheduling link (activity/timeline reference) — item 15, **not done**

Update `docs/database-handoff-map.md` when any of the above land.

---

## Verification / done criteria

- [x] Create an opportunity from an account page — lands on the new opportunity's detail page every time (2026-09-17, verified live)
- [x] A contact can be associated with two or more opportunities simultaneously; editing the contact doesn't drop any of them (2026-09-17 — fixed at the root: `saveContact` no longer overwrites `opportunityIds`)
- [ ] A won or lost opportunity no longer appears as a live "current" association without a decision — not started; the "current vs. former" mechanism now exists (item 11) but nothing auto-triggers it on Won/Lost yet
- [x] Associated Contacts "Edit" on an opportunity opens an opportunity-scoped editor, not the generic contact-core-details dialog (2026-09-17 — consolidated onto the Stakeholders dialog)
- [x] Opportunity/project names in the Contact page's "Connected via" panel are clickable (2026-09-17)
- [ ] An activity can be logged against more than one contact — not started, real schema change (item 9)
- [x] The primary-stakeholder checkbox renders inline with its label, not floating (2026-09-17)
- [ ] Marking "site walk needed: yes" offers an immediate quick-schedule action — not started
- [ ] Trying to advance an opportunity with missing required fields highlights the specific panels and badges the relevant stage-tab button — not started
- [x] "Open Account" and (on a won opportunity) "Open Project" buttons both navigate correctly (Open Account already existed; Open Project added 2026-09-17)
- [x] Opportunity close date is coarser (quarter, not exact day) everywhere it's created, edited, sorted, and displayed, with existing data migrated rather than blanked (2026-09-17, verified live via Playwright — create, edit, list sort, board badge tone)
- [x] Decision Maker Found reflects a real tagged associated contact — partially: now true in addition to the manual toggle, not instead of it (see item 19's note on why a full replacement was deferred)
- [ ] A won opportunity's second status badge reads the linked project's actual stage, not a stale "Won" — not started

---

## Open decisions

- ~~**Close date:** required, optional, or replaced with a coarser field?~~ **Decided and shipped 2026-09-17:** replaced with `closeQuarter` (quarter granularity, not month — see item 1 for why). Still optional (a "No target quarter" option exists in the dialog, matching the old "optional" label).
- **Opportunity Type vocabulary:** final list of values after adding Investigation Needed/Unknown, and whether it should map onto `jobClass` (item 1, 5)
- **Won/lost contact associations:** auto-drop from the active list, or move to a "past opportunities" section mirroring item 12's "formerly associated" pattern? (item 6)
- **Opportunity-scoped relationship tags:** final vocabulary beyond "Decision Maker" (item 19)
- **"Regarding" field:** same concept as an activity tag, or a distinct free-text subject? (item 20)
- **Core Opportunity dialog scope:** redesign it to cover everything the Summary panel displays, or trim the panel to only show what's editable today? And should Owner become an `ownerEmployeeId` FK like Accounts got in Phase 03? (item 25)

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*

- **2026-09-17 — the biggest finding this session: "Associated Contacts" and "Stakeholders" were two parallel, non-syncing systems for the same concept, not one panel with a wiring bug.** Items 6, 7, and 11 were each scoped in this doc as if "Associated Contacts" (Summary tab) needed new capability built (multi-select, an opportunity-scoped editor, add/remove). In fact, a fully-correct, already-working implementation of everything those three items ask for already existed one tab over, under a different name: the Develop & Planning tab's "Stakeholders" panel, backed by the real `opportunityContacts` many-to-many junction, with a working add/edit/remove dialog and a relationship/influence-level vocabulary that already included "Decision maker" (item 19's ask). "Associated Contacts" was a completely separate, older, buggier codepath reading `contact.opportunityIds` — a scalar-shaped array that the contact's own edit dialog could silently overwrite down to one entry. The fix for all four items (6, 7, 11, 19) was consolidation, not new construction: point Associated Contacts at the same data and the same dialog Stakeholders already used. **Lesson for future phase-doc authors:** when a note describes a capability gap ("we can't do X"), check whether X already exists somewhere else in the app under a different label before scoping it as new work — this doc's per-item CONFIRMED citations were accurate about the *symptom* (Associated Contacts' Edit button, the contact dialog's single-select) but didn't cross-reference the *other* panel that had already solved the same problem correctly.
- **2026-09-17 — a live-testing false alarm, recorded so it isn't repeated.** Item 2's fix initially appeared to still fail when tested live via Playwright — the page didn't navigate after "saving" a new opportunity. Root cause was the test script, not the app: the Opportunity dialog's "Next step" field is `required`, the test left it blank, and the browser's native HTML5 form validation silently blocked submission before any JavaScript ran (no console error, no network request, nothing to see except the page not changing). Filling every required field resolved it. Worth remembering when a fix "doesn't seem to work" in an automated test against a form with `required` fields — check native validation before suspecting the application code.

## Live bug report follow-up

**2026-09-18 — three items from a live owner report, all shipped and verified.**

1. **Redundant "Add activity" button on the Opportunity page.** Investigated the Account-page precedent first: `renderAccountDetailHeader()` (`app.js`) has no bare "Add activity" button at all — Phase 03 replaced it with the header-level, context-aware "+ Create" `<details>` menu in `renderQuickActions()` (`app.js`), which already special-cases `state.view === "account-detail"` (Contact/Opportunity/Facility/Address/Location/Activity) and `state.view === "contact-detail"` (Opportunity/Activity). There was no equivalent `state.view === "opportunity-detail"` branch, so the opportunity-detail page's own bare "Add activity" button (in `renderOpportunityDetailHeader()`) was a duplicate of nothing — removing it without a replacement would have removed the only way to log an activity from that header. Fixed by adding the missing `opportunity-detail` branch to `renderQuickActions()` (offering "Activity", pre-filled with the opportunity's `accountId` and `id`, same pattern as the other branches), then removing the two now-redundant bare buttons: the opportunity list page's toolbar (`renderPipeline()`) and the opportunity detail header (`renderOpportunityDetailHeader()`). A third "Add activity" button, on the unrelated Fieldwork/tasks page (`renderFieldwork()`), was left alone — it's not an Account or Opportunity page, has no "+ Create" equivalent, and removing it would remove real functionality with no replacement.
2. **Timeline/activity panel pushing sibling panels down (the Georgetown-account bug).** Root cause: `.record-list` (`styles.css`) is `display:grid; gap:10px` with no bounded height, and both the Account Summary tab's Timeline panel and the Opportunity page's Timeline panels (Summary tab and Files & Activity tab) rendered the full, unfiltered activity list straight into it inside a `.detail-stack` column — a long history pushed every sibling panel in that column down the page with no internal scroll. Same root cause on both surfaces, fixed once: added `renderTimelinePanel(activities, contextKey, emptyMessage)` (`app.js`, near `renderTimelineItem`) that slices to a `TIMELINE_PAGE_SIZE` (15) window, wraps it in a new `.timeline-scroll` class (`styles.css`: `max-height: 420px; overflow-y: auto`), and renders a "Load N more (N left)" button (`data-action="load-more-timeline"`) when more remain, backed by a new `state.timelineVisibleCounts` map keyed per-record so paging state doesn't leak across records. Wired into all three affected call sites: `renderOpportunitySummaryTab()`, `renderOpportunityFilesActivityTab()`, `renderAccountSummaryTab()`. The Contact page's timeline panels and the dashboard's "Recent activity" panels were left as plain `.record-list` — they were not reported as broken and are either already capped (`.slice(0, 5)`) or lower-traffic; can be moved onto `renderTimelinePanel()` later if they turn out to have the same problem.
3. **"Account Target" tooltip.** Added a `statusTooltips` lookup in `renderAccountDetailHeader()` covering all four `relationshipStatus` values (Target/Active/Inactive/Suspended), rendered as a `title` attribute on the badge — same pattern as the existing "Compliance expired" badge tooltip a few lines above it.

**Verified live via Playwright** (bundled runtime at `C:\Users\Braden\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`, against the already-running server on port 4173): confirmed no "Add activity" text remains anywhere on the opportunity list or detail pages; opened the "+ Create" menu on an opportunity detail page and confirmed it shows only "Activity", clicked it, and confirmed the Add Activity dialog opens pre-filled with the correct Account and Opportunity; seeded 20 synthetic activities (ids `test-timeline-scroll-1..20`, removed from `data/backend.json` immediately after the test — the file was diffed back to byte-identical except a trailing newline, which was also restored) onto a real opportunity and confirmed the Timeline panel rendered exactly 15 items in a 420px-tall scrolling container with a working "Load 5 more (5 left)" button that loaded the rest and then disappeared, while the sibling "Associated contacts" panel stayed at the top of its column instead of being pushed down; separately confirmed the same fix against real (non-synthetic) data on the actual City of Georgetown account referenced in the report, which already has >15 timeline entries and showed "Load 9 more (9 left)" with the same bounded/scrolling behavior; confirmed the "Account Target" badge on that same Georgetown account (a real `relationshipStatus: "Target"` record) renders the new tooltip text on hover. No console or page errors observed during any of this.
