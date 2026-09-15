# Phase 05 — Contacts & Activity Timeline

**Status:** Not started
**Depends on:** Phase 02 (facility↔contact junction), Phase 03 (edit-button audit pattern)
**Estimated sessions:** 2

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

---

## Out of scope

- Splitting `activities` into dedicated Meeting/Call/Email/Task tables — explicitly deferred (item 2)
- Migrating `activity_type = 'Task'` rows into `sales_tasks` — same deferral
- Communication history sync with Outlook — Stage E

---

## Data model changes

- **New:** tag field on `activities` + a tag reference list
- **Changed:** contact notes separated so two dialogs stop writing one field
- **Changed:** `contacts.accountId` becomes optional (if decision (a))
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

---

## Open decisions

- **Account-less contacts: (a) or (b)?** Recommendation (a).
- **Tag vocabulary** — is the starting seven right? Should tags be per-workspace?
- **Can a tag be added to an existing activity after the fact**, or only at creation?

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*
