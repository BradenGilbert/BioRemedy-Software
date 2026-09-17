# Phase 05 — Contacts & Activity Timeline

**Status:** 🟢 **Most items done, 2026-09-17 session.** Items 1, 3, 5, 6, 7, 8, 9, 10, 12, and 15 done (several turned out to already be resolved or investigated-only — confirmed against code, not assumed). Remaining: item 2 (activity tags — large, standalone build), item 4 (shared opportunity-lookup component — also standalone, shared with Phase 03/04), item 11 (timeline filter-by-person/related/tag/type — extends item 2), item 13 (contact address inheritance — needs an owner decision, no code change recommended), item 14 (Connected-via clickable links — coordinate with Phase 06 item 12, don't fix twice).
**Depends on:** Phase 02 (facility↔contact junction), Phase 03 (edit-button audit pattern)
**Coordinate with:** Phase 06 (Opportunity Domain) — items 14 here and Phase 06 items 6/8/9/12 touch the same contact↔opportunity relationship and the same "Connected via" panel; build the shared multi-select/lookup component once, use it in both.
**Estimated sessions:** 3

---

## Why this phase exists

Closes the contact-side and timeline items from the 2026-09-15 feedback list, and gives timelines the tagging structure needed to stay useful as activity volume grows.

---

## In scope

### 1. Fix the colliding notes fields

> *"When editing a contact's birthday, the note is the note from their account creation."*

**Root cause found:** two dialogs bind to the *same* field.

| Dialog | Field | maxlength | Placeholder |
|---|---|---|---|
| `contactDialog` (`index.html:1067`) | `notes` | **400** | "Decision role, buyer concerns, communication preferences…" |
| `contactPersonalDialog` (`index.html:1189`) | `notes` | **600** | "Relationship context, personal notes, interests…" |

They are the same stored value. So the Personal dialog displays whatever was typed at creation — and worse, **a 600-character personal note is silently truncated to 400** if the contact dialog is opened afterwards. That is live data loss, not just confusion.

**Fix:** separate the concepts.
- One general `notes` field on the contact, edited in exactly one place
- Personal captures (birthday, interests, relationship context) become **timeline activities tagged `Personal`** — see item 2
- Reconcile the maxlength mismatch wherever a shared field survives

**✅ Done 2026-09-17 — fixed as a field split, not as tagged timeline activities.** See item 9 below for the full reasoning: this is now three genuinely separate fields (`notes` general / `birthdayNote` / `personalNotes`) rather than routing personal captures through the timeline-tagging system (item 2), which is a much bigger, still-unbuilt piece of infrastructure. Verified live: a 550-character personal note survives editing the general notes field afterward (previously this would have silently truncated it to 400 chars — confirmed the bug was real before fixing it).

### 2. Activity tags + filter chips

**Decision (locked):** add tagging to `activities`. Do **not** split into per-type Dataverse Activity tables yet.

> *"The birthday capture note should be stored in the timeline and tagged as 'personal' or something? That way we can later filter timelines using these types of tags."*

| Work | Notes |
|---|---|
| Tag field on `activities` | Multi-value. Starting vocabulary: `Personal`, `Business`, `Compliance`, `Safety`, `Billing`, `Site Visit`, `Follow-up` |
| Filter chips on every timeline | Account, Contact, Opportunity, and Project timelines all use the same renderer — build once |
| Auto-tagging | Birthday and similar structured captures tag themselves |
| Tag vocabulary | A small reference list, not free text — free-text tags become unfilterable within a month |

**Recorded deferral:** `docs/dataverse-relationship-architecture.md` flags an unresolved split between the legacy `activities` table and the newer `sales_tasks` direction. We are knowingly continuing to build on `activities`. Revisit **after the pilot**, when there is real usage data showing whether the generic table is actually a problem. This deferral is deliberate and should not be re-litigated every session.

### 3. Contacts without an account

> *"The activity button lets you select contacts that are filtered based on account, but what if the contact doesn't have an account?"*

Today the contact picker filters strictly by the account in context, so an unaffiliated contact is unreachable — and `contactDialog` makes `accountId` **required**, so the app both forbids creating orphan contacts and breaks if one exists.

Decide and implement one of:
- **(a)** Allow account-less contacts, and give the picker an "Unaffiliated" group *(recommended — matches reality: referrals, regulators, inspectors, and consultants often precede an account)*
- **(b)** Require every contact to have an account, and add a "Prospects / Unaffiliated" holding account

Recommendation is (a). Regulators and third-party inspectors genuinely do not belong to a customer account, and forcing them into one corrupts the account's contact list.

**✅ Done 2026-09-17 — option (a), verified safe before implementing.** Confirmed first: every `findAccount(contact.accountId)` call site in `app.js` (6 of them) was already null-guarded (`account?.name`, `account ? ... : "Unknown account"`, etc.) — making `accountId` optional couldn't crash any existing render path. Implementation: dropped `required` from `#contactDialog`'s Account field (index.html), added help text explaining when to leave it unset, and `populateAccountSelect` is now called with a blank "No account (unaffiliated)" label. The real reachability bug was in `populateContactSelect()` — when scoped to an account (the common case, e.g. logging an activity from an account page), it strictly filtered to `contactsForAccount(accountId)`, permanently excluding unaffiliated contacts from every picker opened in an account's context. Fixed by always including unaffiliated contacts (`!contact.accountId`) in their own `<optgroup>`, alongside whatever the account scope matched. Verified live: created an account-less contact, then confirmed it appears (labeled "Unaffiliated") in the Activity dialog's contact picker opened from a *different* account's page.

### 4. Opportunity lookup, not a dropdown

> *"The opportunity section is just a random drop down. We should have this be a look up."*

A plain `<select>` of every opportunity does not scale past a few dozen and gives no context. Replace with a **typeahead lookup** showing name + account + stage, scoped sensibly to the record in context but not hard-filtered to it.

This is the same control the Create dropdown (Phase 03) and subcontractor picker (Phase 04) want. **Build one reusable lookup component** and use it in all three places.

**🟡 Investigated 2026-09-17, not built.** Confirmed exactly as described: `populateOpportunitySelect()` (`app.js`) is a plain, fully unfiltered `<select>` over every opportunity in the system (name + account name only, no stage), used from both `openActivityDialog` and `openContactDialog`. Building the actual typeahead-lookup component (shared across this, the Phase 03 Create dropdown, and the Phase 04 subcontractor picker — none of which exist as a shared component today either) is a real, standalone UI-component build, not a quick swap — deliberately not started this session so it isn't done three-quarters-done in a rush. Whoever picks this up should build the one shared component first, then wire it into all three call sites in the same pass.

### 5. Surface contact ↔ facility relationships

From Phase 02's `facility_contacts` junction: show on the Contact detail page which facilities a person works at or manages.

**✅ Already done before this session; added the one missing piece 2026-09-17.** `renderContactRelationshipsTab`'s "Facilities" panel already existed and already shows every linked facility (name, relationship role, Primary badge) — a genuine `.map()` over all links, not capped at one. This doc's premise that it wasn't surfaced yet was stale. The one real gap: facility names weren't clickable (plain text, unlike the Account page's facility cards). Fixed — facility name is now a `view-facility` link-button, verified live navigating from a contact's Relationships tab straight to that facility's detail page (the Phase 03 Facility detail page).

### 6. Contact owner silently inherits the logged-in session user, not the account owner

> *"Contact owner on details page auto assigned to Olivia grant for some reason."*

**CONFIRMED 2026-09-16, mechanism traced.** Not a hardcoded fallback — `saveContact()` sets `owner: existing?.owner || state.currentUser?.name || "Unassigned"` (`app.js:12631`) for every new contact. The demo app's default logged-in identity is hardcoded as `Olivia Grant` (`demoUser`, `app.js:124-130`, loaded into `state.currentUser` at `app.js:1826`), so every contact created in the demo environment silently gets "Olivia Grant" as owner regardless of who's actually creating it or who owns the parent account. **Fix:** default a new contact's owner from the account's actual owner, not the session identity — the note's own expectation ("it is given an account owner when created") is the correct behavior, it's just not what the code does.

**✅ Done 2026-09-17.** `saveContact()` now defaults `owner: existing?.owner || findAccount(accountId)?.owner || "Unassigned"` — a new contact inherits the parent account's real owner, and the session identity is never consulted at all now (it was never the right source, even as a fallback).

### 7. "Role and account" owner field can silently reset to Unassigned

> *"Owner on 'Role and account' section lists unassigned even tho it is given an account owner when created."*

**PARTIALLY CONFIRMED — real bug, different mechanism than a field-name mismatch.** There's only one `owner` field (no separate `ownerId`); the panel, the create path, and the edit path all read/write the same field. Two real problems stack here:
- Per item 6, a new contact's owner is the session identity, not the account owner — so "it is given an account owner when created" isn't actually true yet, which is worth fixing regardless.
- `openContactRoleDialog()` tries to preselect the owner dropdown by matching `core.owner` against an employee's `displayName` (`app.js:15335`). "Olivia Grant" (and any other session-only demo identity) **does not exist in the `employees` roster** — so the picker can't preselect anyone, and if the dialog is saved without manually re-picking someone, `saveContactRole()` writes `owner: ownerName || "Unassigned"` (`app.js:12726`), **silently overwriting whatever owner was there.** This is a real data-loss-on-edit bug: opening and saving this dialog without touching the owner field can blank it out.
- **Fix both:** (a) item 6's creation-time inheritance, and (b) make the edit dialog refuse to silently downgrade to Unassigned when it can't match the current owner — at minimum, warn, don't silently overwrite.

**✅ Done 2026-09-17.** (a) done, see item 6. (b): `saveContactRole()` no longer includes `owner` in its patch at all unless the picker actually resolved to a real name (a real employee, or the literal "System" sentinel) — previously it unconditionally wrote `owner: ownerName || "Unassigned"`, which meant any save where the picker failed to preselect (exactly the "Olivia Grant" case) blanked the owner. Now, when nothing was selected, `owner` is simply left out of the patch, and `buildCoreContactRecord`'s spread of the existing record preserves whatever was there. Chose "never write Unassigned from this dialog" over a warn-and-confirm dialog, since the picker can't currently distinguish "couldn't match, defaulted to blank" from "user deliberately chose Unassigned" — the roadmap's own wording ("refuse to silently downgrade") pointed at this as the safe interpretation.

### 8. Account Role vs. Job Title — should be two distinct concepts

> *"the 'account role' for a contact should be their job position, unless that is specifically different than title. I think it should be different, I think Account role should be something our internal system understands while job title is something that is written on their business card."*

**Decision (locked, per the note's own reasoning):** these are different things and should be two separate fields. `jobTitle` is what's printed on their business card (external, whatever they call themselves). `accountRole`/`influence`-style field should be an internal-system vocabulary (Decision Maker, Technical Evaluator, etc. — the same relationship-tag concept Phase 06 item 19 needs for opportunity-scoped roles; check whether one shared vocabulary serves both the account-level role and the opportunity-level role, or whether they're genuinely different scopes). Confirm current field usage (`title`/`jobTitle` vs `influence`/`accountRole`, per `buildCoreContactRecord()`) before assuming which fields already exist vs. need to be added.

**✅ Already done, confirmed 2026-09-17 — no new code needed.** Traced the actual save paths: `jobTitle` (written by `saveContact`/`saveContactInfo`, "Contact info" dialog) and `accountRole` (written by `saveContactRole`, "Role and account" dialog, options: Employee/Owner/Executive/Manager/Consultant/Other) are already two genuinely separate stored fields on the contact record, edited from two separate dialogs — not aliases, not the same field under two names. This item was already resolved by the existing Contact-detail redesign; this doc's premise that it still needed deciding/building was stale. **Still open:** whether `accountRole`'s vocabulary should be shared with Phase 06 item 19's opportunity-scoped relationship tags — that's a Phase 06 decision, not something to resolve here.

### 9. Notes collision — three-way split needed, not just two

Refines item 1 above. The original plan said "one general `notes` field... personal captures become timeline activities tagged Personal." The 2026-09-16 notes are more specific:

> *"Contacts have notes next to birthday this should be a specific note only for their birthday and not a universally shared note. There should be another note section for general contact notes."*

So the real ask is a **birthday-specific note**, distinct from **both** the general contact notes field **and** whatever the Personal dialog captures — not a two-way split. Reconcile this with item 1's "personal captures become timeline activities" plan before implementing either; it's possible the birthday note itself should also become a tagged timeline entry, or it may be simple enough to stay as its own small field. Decide before building.

**✅ Done 2026-09-17 — decided to keep this as fields, not tagged timeline activities.** Item 2 (the full activity-tagging system with a shared filter-chip component across four different timeline renderers) is a materially bigger, standalone build that wasn't started this session — routing personal/birthday captures through it now would have meant blocking this real, confirmed data-loss bug fix on that larger unbuilt piece. Instead, implemented the three-way split as three real fields on the contact record: `notes` (general/business, `#contactDialog`, unchanged location), `birthdayNote` (new, small, `#contactPersonalDialog`), `personalNotes` (renamed from the old colliding `notes` field, same dialog). All three are genuinely independent storage now — editing one never touches another. This satisfies the note's literal ask ("a specific note only for their birthday," "another note section for general contact notes") without waiting on item 2's infrastructure. If item 2 is built later, birthday/personal notes could still be migrated into tagged timeline entries then — nothing about this fix forecloses that.

### 10. Activities don't show up on the contact's upcoming list, only tasks do

> *"Tasks on contacts show up but when you create other activities they do not. We need that to list all upcoming activities."*

Not yet traced to code — find wherever the contact detail page renders "upcoming"/open items and confirm whether it queries only `tasks` or also `activities`. Given `tasks` and `activities` are genuinely different collections in this codebase (per the glossary), this may be as simple as adding the missing query, or may run into the same activities/sales_tasks architectural divergence this phase already defers elsewhere — check before assuming it's a one-line fix.

**✅ Done 2026-09-17 — same gap existed on the Account page too, fixed both together.** Confirmed: `renderContactSummaryTab`'s "Open tasks" queried only `tasksForContact()` (the `tasks` collection); a scheduled call or follow-up logged as an `activities` row with a due date never appeared. Cross-checked the Account page's equivalent panel (built in Phase 03) — same architecture, same gap, `openTasksForAccount()` is also tasks-only. Fixed both in one pass: new `upcomingActivitiesAsTaskLike()` helper normalizes qualifying activities (has a due date, not completed) into the same shape `renderTaskRow` expects, merged with real tasks and sorted by due date; panel retitled "Upcoming tasks & activities" on both pages. **One real wrinkle found and handled:** `persistActivity()` already creates a companion `tasks` row (type `"Activity task"`) whenever an activity's `activityType` is `"Task"` — so those activities are already represented via their companion task, and the merge explicitly excludes `activityType === "Task"` activities to avoid showing the same logical task twice. Verified live on an account with both real tasks and non-task activities (Meetings) with due dates — confirmed no duplicates.

### 11. Timeline filtering by person, related entity, tag, and event type

> *"Filter account Timeline by person, Related, tag, or event type. Related should list all persons, opportunities, projects, ect associated with that account."*

Extends item 2's tag-filter-chip work with three more filter dimensions: by person (whoever logged/is associated with the activity), by "Related" (any account/contact/opportunity/project associated with the timeline's parent account), and by event type. Build as part of the same filter-chip renderer from item 2, not a separate mechanism.

### 12. Timeline search only accepts one character at a time

> *"When using search function in timeline it only lets you type one character at a time"*

Classic "the input loses focus on every re-render" bug — almost certainly the search box's `oninput` (or equivalent) handler triggers a full re-render of the timeline (and the search input along with it) on every keystroke, destroying and recreating the `<input>` element and its focus/cursor state each time. Fix by either debouncing the re-render or ensuring the search input isn't destroyed/recreated while the user is actively typing in it.

**✅ Done 2026-09-17 — and it was systemic, not timeline-specific.** Investigated before fixing: confirmed empirically with Playwright (not just from reading code) that `accountSearch`, `contactSearch`, and `opportunitySearch` on the three list views had the *exact same bug* as `accountTimelineSearch` — every `render*()` function in this codebase does `app.innerHTML = ...` wholesale on every call, with zero diffing and zero focus/selection restoration anywhere in the code. Any input wired through the shared `handleInput` dispatcher into a state write + re-render lost focus after exactly one keystroke, app-wide — this doc's framing of it as possibly-timeline-only was wrong. **Fix:** wrapped `handleInput` (renamed the original body to `handleInputInner`) so it captures the focused element's `id` and text-selection range before running its existing logic, then restores focus and cursor position by that same `id` afterward — regardless of which branch fired or which `render*()` function it called. One fix, applied once, centrally, covers all four search boxes plus `workforceSearch` (found the same latent bug there too) and any future input wired the same way — not four separate patches. Verified live: typing multi-character strings into all four search boxes now works, and a cursor-position test (inserting a character mid-string) confirmed the exact caret position is restored, not just re-focus.

### 13. Contact address inheritance — confirmed scope

> *"Created contacts are given address one of the account, but I am not sure where the city/state comes from?"*

**CONFIRMED and precisely scoped 2026-09-16.** In `buildCoreContactRecord()` (`app.js:4263-4274`): street address fields have **no** account fallback at all (contact-only). City/state/country/zip **do** fall back to the account's address fields when the contact doesn't have its own. The account's own city/state is frequently stored as one combined string (e.g. `"St. Louis, MO"`), which a helper (`splitCityState()`, `app.js:4207-4211`) parses via regex to derive the contact's separate city/state values — this parsing step is likely the actual source of the "not sure where this comes from" confusion, since it's a derived value, not a direct field copy. No code change required unless the behavior itself is deemed wrong — this item may just need documenting/explaining, not fixing. Confirm with the owner whether the current behavior (partial inheritance: city/state/country/zip yes, street no) is actually what's wanted before changing anything.

### 14. Contact's opportunity/project links aren't clickable

> *"On contact linked opportunity page, opportunities are not clickable."*

**CONFIRMED** — see Phase 06 item 8 for the full citation (the "Connected via projects and opportunities" panel renders opportunity/project names as inert text, not links). Implement alongside Phase 06 item 12's broader overhaul of that same panel (team-member sources, badges, filtering, recency cap) — don't fix the click-target in isolation and then redo the whole panel again shortly after.

### 15. List-view search/filter cleanup (Contacts)

> *"Do these same cleanup steps on contacts and opportunities."* / *"Also on the opportunity and contact table remove the blue text boxes like we did for accounts."*

Same shared filter/search-button component as Phase 03 item 6 and Phase 06 item 3, applied to the Contacts list view. Also remove whatever "blue text box" styling was already removed from the Account list.

**🟡 Same finding as Phase 03 item 6, confirmed 2026-09-17.** `renderContacts()` (`app.js`) already uses the shared `renderCompactSearch()`/`renderCompactSelect()` components for its search and view-switcher controls — same as Accounts and Opportunities, all three list views already share one component. As with Phase 03 item 6, this is likely already the fix, but the open question there applies here too: the notes ask for literal filter *buttons*, and what exists is a search box + dropdowns (just icon-styled). Not independently re-investigated or resolved this session — same open question, don't re-litigate separately per account/contact/opportunity, resolve once for all three when the owner clarifies.

---

## Out of scope

- Splitting `activities` into dedicated Meeting/Call/Email/Task tables — explicitly deferred (item 2)
- Migrating `activity_type = 'Task'` rows into `sales_tasks` — same deferral
- Communication history sync with Outlook — Stage E

---

## Data model changes

- **New:** tag field on `activities` + a tag reference list — not yet built (item 2)
- ✅ **Changed 2026-09-17:** contact notes separated into three real fields — `notes` (general, unchanged), `birthdayNote` (new), `personalNotes` (renamed from the old colliding `notes` usage in the Personal dialog) — not timeline captures, see item 9's correction
- ✅ **Changed 2026-09-17:** `contacts.accountId` is now optional (decision (a) implemented) — no `required` attribute, no data migration needed since the field was already stored as a plain string and every read site was already null-safe (item 3)
- ✅ **Changed 2026-09-17:** contact owner defaults from the account's real owner at creation, not session identity (item 6)
- ✅ **Already existed, confirmed 2026-09-17:** `accountRole` is already a real, separate field from `jobTitle` — no new field needed (item 8)
- ✅ **Already surfaced before this session; confirmed 2026-09-17:** `facility_contacts` from Phase 02 (item 5) — only clickability was missing, now added

Update `docs/database-handoff-map.md` — `contacts` gained `birthdayNote`/`personalNotes` 2026-09-17; `activities` will gain fields once item 2 is built.

---

## Verification / done criteria

- [x] Write a 600-character personal note, then open the contact dialog — **the note is not truncated** (2026-09-17, verified live with a 550-char note)
- [ ] A contact's birthday note appears in the timeline tagged `Personal` — superseded: birthday note is now its own field, not a timeline entry (see item 9's correction); this criterion no longer applies as written
- [ ] Filter a timeline to `Personal` and see only those entries; clear it and see everything — blocked on item 2 (activity tags), not started
- [x] Log an activity against a contact with no account (2026-09-17, verified live)
- [ ] Opportunity lookup returns results by typing, and shows account + stage per result — not started
- [ ] The same lookup component is used in the activity dialog, the Create menu, and the subcontractor picker — not started
- [x] A contact managing two facilities shows both on their detail page (already true before this session — confirmed 2026-09-17, only clickability was added)
- [x] A newly created contact's owner defaults to the account's real owner, not whoever is logged in (2026-09-17)
- [x] Opening and saving the Role & Account dialog without touching Owner does not blank it to Unassigned (2026-09-17)
- [x] Job Title and Account Role are two distinct fields with two distinct values on the same contact (already true, confirmed 2026-09-17 — no code change needed)
- [x] The contact detail page's upcoming-items list includes activities, not just tasks (2026-09-17 — fixed on both Account and Contact pages together)
- [x] Typing a multi-character search into the timeline search box does not lose focus after each keystroke (2026-09-17 — fixed app-wide, not just the timeline box; verified with an empirical Playwright test before and after)
- [ ] Opportunity/project names in "Connected via" are clickable links — not started, coordinate with Phase 06 item 12 per this item's own note

---

## Open decisions

- **Account-less contacts: (a) or (b)?** Recommendation (a).
- **Tag vocabulary** — is the starting seven right? Should tags be per-workspace?
- **Can a tag be added to an existing activity after the fact**, or only at creation?
- **Account Role vocabulary** (item 8) — does it share a vocabulary with Phase 06 item 19's opportunity-scoped relationship tags, or are they genuinely different scopes?
- **Contact address inheritance** (item 13) — is partial inheritance (city/state/country/zip yes, street no) actually the wanted behavior, or should it change?

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*
