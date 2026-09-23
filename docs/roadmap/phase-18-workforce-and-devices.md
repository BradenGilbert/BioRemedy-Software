# Phase 18 — Workforce Scheduling & Device Management

**Status:** Shipped 2026-09-23 — items 1–3 (nav reorder, upcoming time off + standby/on-call, full device lifecycle) live and verified via Playwright. Item 4 (per-dispatch sign-on links) deliberately not started, per the locked Q38 sequencing decision (waits for Phase 12).
**Depends on:** Phase 12 for the consent/sign-on link half (it issues credentials to a phone — that is authentication, and it should not be invented twice)
**Estimated sessions:** 2
**Source:** `docs/roadmap/notes-2026-09-22.md` items 39–41, verified against code 2026-09-22

---

## Why this phase exists

Two unrelated complaints that happen to live in the same applet, plus one that is bigger than it looks.

The layout ones are small: the Team Roster is on the wrong view, and the Teams and Crews view is ordered wrong. The scheduling one is a real gap — dispatch cannot see who is on vacation or who is on standby this weekend. The device one is the largest: the Front Line device register is a read-only table, and the owner wants real device lifecycle management plus a way to use employees' personal phones for a single dispatch, with a record of consent.

---

## In scope

### 1. Move the Team Roster; reorder Teams and Crews

> *"we want the 'Team Roster' panel to be moved to 'Teams and Crews' view. It should be put on the left side and the current 'Organizational teams' panel should be moved above 'dispatchable crews' panel."*

**CONFIRMED.** The "Team roster" panel is rendered by `renderWorkforceAvailability()` (`app.js:9561`) — the Availability and Time Off view — while `renderWorkforceTeams()` (`app.js:9478-9498`) renders Organizational teams and Dispatchable crews side by side in `.workforce-groups-layout`.

Target layout for Teams and Crews: roster on the left, Organizational teams above Dispatchable crews on the right. Straightforward, with one thing to decide — the roster panel currently annotates each person with whether they have an availability exception, which is meaningful *next to* the exceptions list and less so away from it. Either carry that annotation over or replace it with something that earns its place on the new view (crew membership, certification standing).

Check what the Availability view is left with once the roster leaves. A view holding one panel may want rethinking, which overlaps item 2.

### 2. The schedule should answer real scheduling questions

> *"we want the schedule to show us upcoming vacation time, whos on standby this weekend, etc."*

`renderWorkforceSchedule()` (`app.js:9611`) and the availability blocks behind it have the raw material — `getAvailabilityBlocks()` returns typed, dated blocks per employee. What is missing is the read: nothing groups blocks into "upcoming time off," and **standby is not a concept the model has at all**.

Two pieces:

- **Upcoming absence view** — who is out, when, and what that does to crew coverage over the next N weeks. This is presentation over existing data.
- **Standby / on-call** — genuinely new. It needs a rotation: who is on call, for what window, and with what fallback. A standby assignment is not an availability *exception* (the person is not unavailable — they are specifically committed), so overloading the availability block type would be wrong. Model it separately.

Standby matters most for emergencies, so coordinate with **Phase 16**: an emergency intake should be able to answer "who is on call right now" without someone checking a group chat.

### 3. Front Line device management

> *"we want to have the ability to add new devices, have them be clickable, open up a device management page… we want it to lock hardware, EIME number, software, date of onboarding, and other important information. We should also be able to delete or suspend them."*

**CONFIRMED read-only.** `renderWorkforceDevices()` (`app.js:9650-9683`) renders a table from `frontlineDevices` with no add, no row click, no edit and no status action. The collection already carries display name, identifier, platform, app version, last seen, sync status and registration status.

Build: add a device, click a row into a device detail page, and act on it (suspend, retire, delete). New fields the note names — hardware model, **IMEI** ("EIME" in the note), OS/software version, onboarding date, assigned employee, ownership (company vs. personal). Suspended devices must stop being usable for Front Line sign-in, not merely display a badge; if that enforcement does not exist yet, say so in the doc rather than implying the badge does something.

**MDM integration (Apple Business Manager, Azure/Intune) is explicitly a "tie in later."** Do not build toward a specific vendor. Keep the record shape close to what those systems expose — serial, IMEI, enrollment state, OS version — so a later sync has somewhere to land.

### 4. Per-dispatch sign-on links and GPS consent

> *"We also want the ability to push sign on links to peoples personal mobile phones for each dispatch, so if for a dispatch we want to pull their GPS coordinates, we have a record of each time we did that and what device they used and when they agreed to those terms an such."*

This is the item worth slowing down on. It is three things:

1. **A scoped, expiring sign-on link** — this employee, this dispatch job, valid for that job's window, on a device that is not company-issued. That is credential issuance, which belongs with **Phase 12**. Building a parallel token mechanism here would create a second authentication path with none of Phase 12's audit properties.
2. **A consent record** — what was agreed to, by whom, on what device, at what time, with the terms text as presented. This must be an append-only record, never edited in place; it exists to answer a question months later about whether someone agreed to location tracking on their personal phone.
3. **Location capture scoped to that consent** — GPS pulls tied to the dispatch and the consent that authorised them, so the record shows not just where someone was but under what agreement. Phase 02's retention fields on `locations` (`retainUntil`, `retentionReason`, `isTemporary`) already exist and apply directly: personal-device location data should age out on a defined schedule, not accumulate indefinitely.

The owner's own note ends with *"There might be a better way to track this but not sure yet"* — so treat the above as a proposal to confirm, not a settled design. Tracking employees' personal phones has legal and policy dimensions beyond the software; flag that rather than quietly shipping it.

---

## Definition of done

- [x] Team Roster is on Teams and Crews, on the left; Organizational teams sits above Dispatchable crews
- [x] The Availability view still makes sense with the roster gone — replaced with "Upcoming time off" and "Standby / on-call" panels, which is what the owner's note actually wanted the schedule to answer
- [x] Upcoming time off is visible at a glance across the crew (filters `availabilityBlocks` to non-"On call" exceptions ending in the future)
- [x] Standby/on-call is a real, assignable thing (`standbyAssignments`, a new collection, not an availability block), with a "who's on call right now" read (`currentStandbyEmployee()`) ready for **Phase 16** to call — not yet wired into the emergency intake dialog, since that phase shipped first; see its own corrections
- [x] Devices can be added, opened, edited, suspended and retired, with IMEI/hardware/OS/onboarding recorded — verified live via Playwright (added a device, opened its detail page, suspended it, confirmed the block notice)
- [x] A suspended device cannot be used for Front Line sign-in — verified live: suspended Logan's registered device, attempted Front Line sign-in as Logan, got "This employee's registered device is suspended or retired" and stayed on the login screen
- [ ] A per-dispatch sign-on link can be sent to a personal phone, and every GPS consent is recorded immutably with terms, device and timestamp — **not started**, waits for Phase 12 per the locked Q38 decision (issuing credentials before real auth exists would mean a second login system Phase 12 then has to replace)

---

## Open decisions

- **Standby model** — a rotation the office maintains, or a per-weekend assignment?
- **Consent terms text** — who writes it, and is it versioned? (It must be, if the record is to mean anything.)
- **Personal-device location retention** — what `retainUntil` default applies?
- **Does the sign-on link wait for Phase 12**, or does this phase ship devices-only first? Recommendation: ship devices-only, wait for Phase 12 on the link.

---

## Corrections found during implementation

- **The app already had an "On call" availability block type before this phase** (`avail-logan-oncall` in the seed data, type `"On call"`). This is exactly the wrong model the phase doc warned against reusing ("standby is not an availability exception... overloading the availability block type would be wrong") — it's real prior data using the wrong shape, not a hypothetical risk. Left it alone (not migrated into `standbyAssignments`) since migrating seed data without an owner decision on it felt like overreach for this session; flagging so a future session doesn't mistake the old `"On call"` availability blocks for the new standby model, or vice versa.
- **Standby rotation settings live in a new one-row collection (`standbyRotationSettings`, `id: "default"`)**, not a proper settings surface — there's no generalized "app settings" mechanism in the JSON backend today (IndexedDB `settings` is explicitly device-scoped per `CLAUDE.md` and wrong for something an operations manager sets for everyone). This is a minimal, single-record stand-in; if Phase 12 or a later phase builds real shared settings infrastructure, this should move onto it rather than staying a bespoke one-off collection.
- **New server-side collections required server.mjs changes, not just app.js** — `collectionAccess`, `defaultBackend`, and the role-gated response filter in `server.mjs` all gate on a fixed, known collection list; a `saveBackendRecord()` call to an unregistered collection name 404s. `standbyAssignments`/`standbyRotationSettings` needed entries in all three places before the frontend code could persist anything. Worth remembering for any future phase that introduces a new top-level collection — it's a three-place change, not a JSON-file-only one.
- **Device deletion is soft (`deletedAt`), matching the app-wide convention** — there is no hard-delete/DELETE HTTP path anywhere in this codebase, so "Delete" on a device follows the same pattern every other removal uses rather than introducing a new one.

---

## Decisions locked 2026-09-22 (owner)

- **Standby model (Q35): a maintained rotation**, with the rotation pattern selectable by the operations manager as a setting rather than hard-coded. Build the setting alongside the rotation, not after.
- **Consent terms (Q36): use a generic text to start**, but **it is still versioned** — the version in force when someone consented is what makes the record meaningful. A generic starting text is fine; an unversioned one is not. Recommend a legal read before real employees consent on personal devices, since this is the one area here with exposure outside the software.
- **Personal-device location retention (Q37): 12 months default**, chosen rather than left open — half of Phase 02's 24-month default for temporary GPS locations, on the reasoning that personal-device tracking data should not outlive its operational use, and 12 months covers a full cycle of incident/billing/dispute lookback. Make it configurable. **Owner said "whatever seems normal," so this is a proposal, not a directive** — flag it for confirmation before it goes live.
- **Sequencing (Q38): devices first, sign-on links after Phase 12.** In practice: build the device register (add, open, edit, suspend, retire, IMEI/hardware/OS/onboarding) now, and leave the per-dispatch sign-on link for personal phones until real authentication exists — because that link *is* a credential, and issuing credentials before Phase 12 means building a second login system that Phase 12 then has to replace.

### Q37 / Q38 confirmed 2026-09-22

- **Personal-device location retention: 12 months**, confirmed by the owner (it was proposed here, not directed). Configurable.
- **Devices-only first, confirmed.** Build the device register in this phase. The per-dispatch sign-on link for personal phones waits for Phase 12, because it is credential issuance and must not become a second login system.
