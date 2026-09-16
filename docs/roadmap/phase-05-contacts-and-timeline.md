# Phase 05 — Contacts & Activity Timeline

**Status:** Not started
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

### 4. Opportunity lookup, not a dropdown

> *"The opportunity section is just a random drop down. We should have this be a look up."*

A plain `<select>` of every opportunity does not scale past a few dozen and gives no context. Replace with a **typeahead lookup** showing name + account + stage, scoped sensibly to the record in context but not hard-filtered to it.

This is the same control the Create dropdown (Phase 03) and subcontractor picker (Phase 04) want. **Build one reusable lookup component** and use it in all three places.

### 5. Surface contact ↔ facility relationships

From Phase 02's `facility_contacts` junction: show on the Contact detail page which facilities a person works at or manages.

### 6. Contact owner silently inherits the logged-in session user, not the account owner

> *"Contact owner on details page auto assigned to Olivia grant for some reason."*

**CONFIRMED 2026-09-16, mechanism traced.** Not a hardcoded fallback — `saveContact()` sets `owner: existing?.owner || state.currentUser?.name || "Unassigned"` (`app.js:12631`) for every new contact. The demo app's default logged-in identity is hardcoded as `Olivia Grant` (`demoUser`, `app.js:124-130`, loaded into `state.currentUser` at `app.js:1826`), so every contact created in the demo environment silently gets "Olivia Grant" as owner regardless of who's actually creating it or who owns the parent account. **Fix:** default a new contact's owner from the account's actual owner, not the session identity — the note's own expectation ("it is given an account owner when created") is the correct behavior, it's just not what the code does.

### 7. "Role and account" owner field can silently reset to Unassigned

> *"Owner on 'Role and account' section lists unassigned even tho it is given an account owner when created."*

**PARTIALLY CONFIRMED — real bug, different mechanism than a field-name mismatch.** There's only one `owner` field (no separate `ownerId`); the panel, the create path, and the edit path all read/write the same field. Two real problems stack here:
- Per item 6, a new contact's owner is the session identity, not the account owner — so "it is given an account owner when created" isn't actually true yet, which is worth fixing regardless.
- `openContactRoleDialog()` tries to preselect the owner dropdown by matching `core.owner` against an employee's `displayName` (`app.js:15335`). "Olivia Grant" (and any other session-only demo identity) **does not exist in the `employees` roster** — so the picker can't preselect anyone, and if the dialog is saved without manually re-picking someone, `saveContactRole()` writes `owner: ownerName || "Unassigned"` (`app.js:12726`), **silently overwriting whatever owner was there.** This is a real data-loss-on-edit bug: opening and saving this dialog without touching the owner field can blank it out.
- **Fix both:** (a) item 6's creation-time inheritance, and (b) make the edit dialog refuse to silently downgrade to Unassigned when it can't match the current owner — at minimum, warn, don't silently overwrite.

### 8. Account Role vs. Job Title — should be two distinct concepts

> *"the 'account role' for a contact should be their job position, unless that is specifically different than title. I think it should be different, I think Account role should be something our internal system understands while job title is something that is written on their business card."*

**Decision (locked, per the note's own reasoning):** these are different things and should be two separate fields. `jobTitle` is what's printed on their business card (external, whatever they call themselves). `accountRole`/`influence`-style field should be an internal-system vocabulary (Decision Maker, Technical Evaluator, etc. — the same relationship-tag concept Phase 06 item 19 needs for opportunity-scoped roles; check whether one shared vocabulary serves both the account-level role and the opportunity-level role, or whether they're genuinely different scopes). Confirm current field usage (`title`/`jobTitle` vs `influence`/`accountRole`, per `buildCoreContactRecord()`) before assuming which fields already exist vs. need to be added.

### 9. Notes collision — three-way split needed, not just two

Refines item 1 above. The original plan said "one general `notes` field... personal captures become timeline activities tagged Personal." The 2026-09-16 notes are more specific:

> *"Contacts have notes next to birthday this should be a specific note only for their birthday and not a universally shared note. There should be another note section for general contact notes."*

So the real ask is a **birthday-specific note**, distinct from **both** the general contact notes field **and** whatever the Personal dialog captures — not a two-way split. Reconcile this with item 1's "personal captures become timeline activities" plan before implementing either; it's possible the birthday note itself should also become a tagged timeline entry, or it may be simple enough to stay as its own small field. Decide before building.

### 10. Activities don't show up on the contact's upcoming list, only tasks do

> *"Tasks on contacts show up but when you create other activities they do not. We need that to list all upcoming activities."*

Not yet traced to code — find wherever the contact detail page renders "upcoming"/open items and confirm whether it queries only `tasks` or also `activities`. Given `tasks` and `activities` are genuinely different collections in this codebase (per the glossary), this may be as simple as adding the missing query, or may run into the same activities/sales_tasks architectural divergence this phase already defers elsewhere — check before assuming it's a one-line fix.

### 11. Timeline filtering by person, related entity, tag, and event type

> *"Filter account Timeline by person, Related, tag, or event type. Related should list all persons, opportunities, projects, ect associated with that account."*

Extends item 2's tag-filter-chip work with three more filter dimensions: by person (whoever logged/is associated with the activity), by "Related" (any account/contact/opportunity/project associated with the timeline's parent account), and by event type. Build as part of the same filter-chip renderer from item 2, not a separate mechanism.

### 12. Timeline search only accepts one character at a time

> *"When using search function in timeline it only lets you type one character at a time"*

Classic "the input loses focus on every re-render" bug — almost certainly the search box's `oninput` (or equivalent) handler triggers a full re-render of the timeline (and the search input along with it) on every keystroke, destroying and recreating the `<input>` element and its focus/cursor state each time. Fix by either debouncing the re-render or ensuring the search input isn't destroyed/recreated while the user is actively typing in it.

### 13. Contact address inheritance — confirmed scope

> *"Created contacts are given address one of the account, but I am not sure where the city/state comes from?"*

**CONFIRMED and precisely scoped 2026-09-16.** In `buildCoreContactRecord()` (`app.js:4263-4274`): street address fields have **no** account fallback at all (contact-only). City/state/country/zip **do** fall back to the account's address fields when the contact doesn't have its own. The account's own city/state is frequently stored as one combined string (e.g. `"St. Louis, MO"`), which a helper (`splitCityState()`, `app.js:4207-4211`) parses via regex to derive the contact's separate city/state values — this parsing step is likely the actual source of the "not sure where this comes from" confusion, since it's a derived value, not a direct field copy. No code change required unless the behavior itself is deemed wrong — this item may just need documenting/explaining, not fixing. Confirm with the owner whether the current behavior (partial inheritance: city/state/country/zip yes, street no) is actually what's wanted before changing anything.

### 14. Contact's opportunity/project links aren't clickable

> *"On contact linked opportunity page, opportunities are not clickable."*

**CONFIRMED** — see Phase 06 item 8 for the full citation (the "Connected via projects and opportunities" panel renders opportunity/project names as inert text, not links). Implement alongside Phase 06 item 12's broader overhaul of that same panel (team-member sources, badges, filtering, recency cap) — don't fix the click-target in isolation and then redo the whole panel again shortly after.

### 15. List-view search/filter cleanup (Contacts)

> *"Do these same cleanup steps on contacts and opportunities."* / *"Also on the opportunity and contact table remove the blue text boxes like we did for accounts."*

Same shared filter/search-button component as Phase 03 item 6 and Phase 06 item 3, applied to the Contacts list view. Also remove whatever "blue text box" styling was already removed from the Account list.

---

## Out of scope

- Splitting `activities` into dedicated Meeting/Call/Email/Task tables — explicitly deferred (item 2)
- Migrating `activity_type = 'Task'` rows into `sales_tasks` — same deferral
- Communication history sync with Outlook — Stage E

---

## Data model changes

- **New:** tag field on `activities` + a tag reference list
- **Changed:** contact notes separated into (at least) three concepts — general notes, birthday note, Personal-tagged timeline captures — so no two dialogs write the same field (item 9)
- **Changed:** `contacts.accountId` becomes optional (if decision (a))
- **Changed:** contact owner defaults from the account's real owner at creation, not session identity (item 6)
- **Possible new field:** a real `accountRole`/internal-relationship-role vocabulary, distinct from `jobTitle` (item 8)
- **Newly surfaced:** `facility_contacts` from Phase 02

Update `docs/database-handoff-map.md` — `activities` gains fields, as does `contacts`.

---

## Verification / done criteria

- [ ] Write a 600-character personal note, then open the contact dialog — **the note is not truncated**
- [ ] A contact's birthday note appears in the timeline tagged `Personal`
- [ ] Filter a timeline to `Personal` and see only those entries; clear it and see everything
- [ ] Log an activity against a contact with no account
- [ ] Opportunity lookup returns results by typing, and shows account + stage per result
- [ ] The same lookup component is used in the activity dialog, the Create menu, and the subcontractor picker
- [ ] A contact managing two facilities shows both on their detail page
- [ ] A newly created contact's owner defaults to the account's real owner, not whoever is logged in
- [ ] Opening and saving the Role & Account dialog without touching Owner does not blank it to Unassigned
- [ ] Job Title and Account Role are two distinct fields with two distinct values on the same contact
- [ ] The contact detail page's upcoming-items list includes activities, not just tasks
- [ ] Typing a multi-character search into the timeline search box does not lose focus after each keystroke
- [ ] Opportunity/project names in "Connected via" are clickable links

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
