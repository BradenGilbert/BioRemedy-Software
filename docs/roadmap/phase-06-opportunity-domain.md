# Phase 06 — Opportunity Domain Correctness

**Status:** Not started
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

Not yet investigated against code — this is a product-direction question as much as a bug. Two separable asks:
- Should `closeDate` be optional or replaced with a coarser field (quarter/month)? Needs a decision, not just a fix.
- The `serviceType`/cleanup-type vocabulary should be reconciled with whatever categorizes work once it becomes a project/dispatch job (`jobClass`: Emergency Response / Multi-Stage Remediation / Scheduled Work) — today these are two independent enumerations with no declared mapping. See item 5 for the related rename.

### 2. New-opportunity-from-account-page doesn't navigate to the new record

> *"Sometimes creating a new opportunity from account page will be successful but wont take you to opportunity page."*

**CONFIRMED, but deterministic, not intermittent.** `saveOpportunity()` (`app.js:12500-12539`) is the single save handler for every "New opportunity" entry point (global pipeline button and the account-page button both route through the same dialog/handler, `app.js:2319`). On success it only does `closeDialogs(); await refreshState(); render();` — it never sets `state.selectedOpportunityId` / `state.view = "opportunity-detail"`, unlike `saveAccount()` and `saveContact()`, which both do. A working navigation helper already exists (`viewOpportunity(opportunityId)`, `app.js:17312-17323`) — `saveOpportunity()` just never calls it. **Fix: call `viewOpportunity()` (or set the two state fields directly) after a successful create**, matching the account/contact pattern. Rewrite the note as "always fails to navigate," not "sometimes."

### 3. List-view search/filter cleanup (Opportunities)

> *"Do these same cleanup steps on contacts and opportunities. Note that on opportunity views that have lists should also have the same search ability like detailed above."*

Companion to Phase 03 item — replace ad hoc "Search accounts or sites" / "all industries" / "different views" style controls with consistent filter/search buttons, applied to opportunity list views specifically. Build once, reuse across Accounts (Phase 03), Contacts (Phase 05), and here — do not implement three separate filter bars.

### 4. Remove "blue text box" style on the opportunity table

> *"Also on the opportunity and contact table remove the blue text boxes like we did for accounts."*

Purely visual — find whatever styling was already removed from the account list/table view and apply the same treatment to the opportunity table. Cross-check against the account fix before assuming which class/style is meant.

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

### 7. Associated Contacts "Edit" opens the wrong dialog

> *"When in an opportunity under associated contacts you can click 'edit' and it will let you edit the contacts core details using the standard contact edit page. We should have this be a relevant edit page as it relates to the specific opportunity that is open."*

**CONFIRMED.** The opportunity's Associated Contacts panel (`app.js:3481`, `renderMiniContact` at `app.js:5642-5658`) wires its Edit button to the exact same `open-contact` action (`app.js:2073` → `openContactDialog`) used by every other "edit a contact's core details" entry point in the app. There is no opportunity-specific relationship/role editor. See item 19 for what that editor should actually contain (a Decision Maker tag, and likely other opportunity-scoped relationship metadata) — build both together, this item is the UI shell and item 19 is what goes inside it.

### 8. Opportunity links on the Contact page aren't clickable

> *"On contact linked opportunity page, opportunities are not clickable."*

**CONFIRMED** for the "Connected via projects and opportunities" panel: `renderContactConnectionCard()` (`app.js:6579-6595`) renders the connected *person's* name as a real button (`data-action="view-contact"`, `app.js:6588`) but concatenates the opportunity/project names into plain, inert text (`app.js:6592`) with no click handler at all. Make them real links (`data-action="view-opportunity"` / `view-project"`). If a *separate* "this contact's own associated opportunity" display also exists elsewhere on the contact page and is likewise non-clickable, fix it there too — confirm during implementation which surface(s) this note was pointing at (it may be exactly the panel above, since a contact's single associated opportunity would also show up in "connected via").

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

### 12. "Connected via" panel — broaden sources, add filtering, badge display, cap the list

> *"On contact page connected via projects and opportunities only populates if the contact is listed as a associated contact for a project which forces them to be a account contact. This should include 'team Members' and maybe some other areas. But we also want this filterable. ...we want those opportunities to be listed like badges and only list the most recent 3-4 opportunities or projects."*

This is really a Contact-page item (Phase 05 owns the Contact detail page) but it's driven entirely by opportunity/project associations, so implement it alongside item 8 above once opportunity links are clickable. Scope:
- Include project **team member** assignments as a connection source, not just account-forced associated-contact relationships
- Make it filterable (ties to Phase 05's activity-tag filtering work — reuse the same filter-chip pattern if it fits)
- Render opportunities/projects as badges, not a comma-joined text blob
- Cap the display to the most recent 3–4, not the full history

### 13. Resource Needs (Develop & Planning) — vendor/sub free text now, approved-list-only later

> *"Develop and planning section of opportunities, under Resource needs it lists vendor/subcontractor needs... having it be open text free for any entry makes sense but later we will want the sub/vendor entries to be selected from the approved vendor/sub list."*

No action this phase — the owner explicitly says free text is fine *for now*. **Dependency to track:** once Phase 04's Layer 2 (`account_approved_subcontractors`) ships, come back and convert this field from free text to a picker scoped to subs approved for *this* customer account. Do not build the picker before Phase 04 ships the approval list it would read from.

### 14. Primary stakeholder checkbox — CSS layout bug

> *"on opportunity develop and planning the primary stakeholder checkbox is floating way off out of the way."*

**CONFIRMED, exact cause found.** The Stakeholder dialog's checkbox uses `class="checkbox-label"` (`index.html:407-410`), a class with **zero rules defined anywhere in `styles.css`**. Every other checkbox-plus-label pairing in the app (40+ occurrences) uses `class="check-row"`, which has real layout rules (`styles.css:4271-4283`). Without a matching rule, this one checkbox falls back to the bare `label` grid rule (`styles.css:2789-2795`), which is built for "label text above a single input," not "checkbox beside inline text" — producing exactly the "floating" look described. **Fix is one attribute change:** `class="checkbox-label"` → `class="check-row"` at `index.html:407`.

### 15. Site walk should be schedulable, not just a status dropdown

> *"...on oppoortuntity develop and planning stage we have site walk, but there is only a drop down for incomplete, complete, and not needed. We should have a site walk be a scheduleable task... Where it asks 'is site walk needed' yes or no? based on that it gives you the ability to schedule it really quick and then also just has the existing dropdown menu right after."*

**CONFIRMED as currently just a 3-option dropdown with no scheduling integration.** `opportunity.siteWalkStatus` (`app.js:3587`, edited via `index.html:363-370`, saved as a plain string `app.js:14574`) has no connection anywhere to the timeline, a due date, or any activity/scheduling record. Build: a yes/no "is a site walk needed" prompt that, on yes, offers a quick-schedule flow (creates a timeline activity, tagged appropriately per Phase 05's tag work), while keeping the existing dropdown for recording a site walk that happened outside the CRM without blocking the project on it.

### 16. Site walk — sales-side field capture app (new capability)

> *"If a site walk is needed and scheduled, we may want to have a field app for sales persons as well... If they click the site walk is complete, and no timeline activity for a site walk exists it could ask if the user would like to upload photos, videos, notes, lidar scans, pdfs, drawings, to a retroactively created site walk..."*

This is a genuinely new capability, distinct from Front Line (which is for field *operations* crews, not sales reps). Scope it explicitly as **sales-side site-walk capture**, separate from the Front Line simulator (Phase 13):
- A capture surface (mobile-friendly, does not need to be a separate "app" — could be a responsive dialog) for photos/videos/notes/LiDAR/PDFs/drawings
- Marking a site walk complete with no matching timeline activity prompts: "upload capture now?" → yes goes to the capture surface, no just marks complete
- Depends on Phase 11 (Document Storage) for real file upload — do not build this before Phase 11 ships, or it will need to be rebuilt on top of real storage anyway

### 17. Advance-button validation should highlight what's missing

> *"If someone tries to advance an opportunity using the advance button but all the prerequisites are not met, we should highlight those sections temporarily in red on each page and mark their section button with a red exclamation icon in the top right of the 'Lead & Qualify' or 'Develop & Planning' buttons. This could be a browser based save so reloading the page might retrigger it, but opening a new browser would make it disappear..."*

The stage-gate/required-fields check already exists (`STAGE_REQUIRED_FIELDS`, the missing-fields banner seen live on the Summary tab during Phase 02 testing: *"This opportunity is missing information expected by the Proposal stage: Facility, Contamination, Industry..."*). This item is a **presentation** upgrade on top of that existing check, not a new validation engine:
- Highlight the specific panels containing missing fields, not just a text banner
- Red exclamation badge on the relevant stage-tab button(s)
- Persist the highlight across a reload of the same browser session (the note's own suggestion: "browser based save"), but not across a different browser/device

### 18. "Open Account" button on the Opportunity page

> *"Opportunties need an 'Open Account' button"*

Small, concrete. Add alongside the existing account name/link if one doesn't already function as a real navigation button — verify during implementation whether the account name already does this before assuming it's missing entirely.

### 19. "Decision Maker Found" should check for a tagged associated contact, not a manual toggle

> *"Lead & Qualifications stage... it says 'Decision Maker Found' and requires a complete or not complete. This should have a check to see if we have connected an associated contact with the tag 'Decision Maker' now this associated contact panel does need an overhaul because it edits the core contact details, iin this overhaul we might be able to create opportunity specific role/relationship/duty tags..."*

Directly extends item 7. Building the opportunity-contextual Associated Contacts editor (item 7) should include an opportunity-scoped relationship tag (Decision Maker, and likely others worth defining alongside it — Champion, Technical Evaluator, Economic Buyer are common CRM equivalents, but confirm the real vocabulary wanted rather than importing a generic one). Once that tag exists, `decisionMakerFound` becomes a derived value (does any associated contact carry the Decision Maker tag?) instead of a manually-toggled field.

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

### 24. Won-opportunity status badge is stale/misleading

> *"...when an opportunity is won it says 'won' 'close date' and 'won'. I think the first badge is fine, but the second 'won' badge that used to say pipeline should say something like 'project: stage' and list the stage the project is at. This should be similar to the delivery tracker section of the sales applet..."*

The forecast-category badge (normally "Pipeline") doesn't update to reflect the resulting project's actual stage once won. Pull the linked project's stage into this badge, mirroring however the Delivery Tracker view already tracks won-opportunity → project status (reuse that logic/component rather than re-deriving it).

---

## Out of scope

- Building `account_approved_subcontractors` itself — Phase 04 (item 13 here only prepares for it)
- Real document/file upload for site-walk captures — Phase 11 (item 16 depends on it, does not duplicate it)
- The Quote/Estimate button and module — Phase 08, this phase only assumes it will eventually exist
- Splitting `activities` into per-type tables — deferred per Phase 05's own decision

---

## Data model changes

- `activities.contactId` (scalar) → `activities.contactIds` (array) — item 9, needs a migration for existing rows
- Opportunity-scoped contact relationship tags (Decision Maker, etc.) — item 19, likely a new field on whatever associated-contacts junction gets built for item 7
- Possible rename: `serviceType`/cleanup-type field → "Opportunity Type" with expanded value list — item 5
- Site walk gains a real scheduling link (activity/timeline reference) — item 15

Update `docs/database-handoff-map.md` when any of the above land.

---

## Verification / done criteria

- [ ] Create an opportunity from an account page — lands on the new opportunity's detail page every time
- [ ] A contact can be associated with two or more opportunities simultaneously; editing the contact doesn't drop any of them
- [ ] A won or lost opportunity no longer appears as a live "current" association without a decision (auto-dropped, or moved to a former-associations view — per whichever the open decision below resolves)
- [ ] Associated Contacts "Edit" on an opportunity opens an opportunity-scoped editor, not the generic contact-core-details dialog
- [ ] Opportunity/project names in the Contact page's "Connected via" panel are clickable
- [ ] An activity can be logged against more than one contact
- [ ] The primary-stakeholder checkbox renders inline with its label, not floating
- [ ] Marking "site walk needed: yes" offers an immediate quick-schedule action
- [ ] Trying to advance an opportunity with missing required fields highlights the specific panels and badges the relevant stage-tab button
- [ ] "Open Account" and (on a won opportunity) "Open Project" buttons both navigate correctly
- [ ] Decision Maker Found reflects a real tagged associated contact, not a manual toggle
- [ ] A won opportunity's second status badge reads the linked project's actual stage, not a stale "Won"

---

## Open decisions

- **Close date:** required, optional, or replaced with a coarser field? (item 1)
- **Opportunity Type vocabulary:** final list of values after adding Investigation Needed/Unknown, and whether it should map onto `jobClass` (item 1, 5)
- **Won/lost contact associations:** auto-drop from the active list, or move to a "past opportunities" section mirroring item 12's "formerly associated" pattern? (item 6)
- **Opportunity-scoped relationship tags:** final vocabulary beyond "Decision Maker" (item 19)
- **"Regarding" field:** same concept as an activity tag, or a distinct free-text subject? (item 20)

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*
