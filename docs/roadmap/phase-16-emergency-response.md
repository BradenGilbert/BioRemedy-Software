# Phase 16 — Emergency Response Intake & Rapid Deployment

**Status:** Shipped 2026-09-23 — one-screen intake, mobilization gating, and single-submit project+dispatch-job creation are live and verified via Playwright (both the "cleared" and "blocked" mobilization paths).
**Depends on:** Phase 07 (dispatch job creation is the back half of the flow), Phase 15 (the project this creates is a project like any other), Phase 13 (onsite paperwork), Phase 08 (the emergency rate tier and four-hour minimums)
**Estimated sessions:** 2–3
**Source:** `docs/roadmap/notes-2026-09-22.md` item 26

---

## Why this phase exists

A spill call is not a sales pipeline. Someone is on the phone, there is product on the ground, and the question is whether a truck rolls in the next twenty minutes — not what quarter the deal closes. Today the only way to get work into the system is the opportunity → project → job-request → dispatch chain, which is correct for scheduled and multi-stage work and absurd for an emergency.

The app already knows emergencies exist — `jobClass: "Emergency Response"` is a first-class project class with its own operations view, and the 2026 rate sheet has an entire Emergency tier with four-hour minimums. What is missing is **the intake that gets there in one screen**: capture the call, create the project and the deployment together, and gate mobilization on the money and paperwork questions that actually decide whether BioRemedy rolls.

---

## In scope

### 1. The emergency intake form

> *"We need to know the following information. Where the caller is/ spill is, send a pin drop (GPS), how much he/was spilled, in the road or soil or both, is it in a storm drain? Is there Offroad discharge? Is Law enforcement fire department or other emergency services en route, involved, onscene? Is absorbent deployed?"*

One screen, ordered the way the call actually goes. Grouped:

**Caller and location**
- Caller name, callback number, relationship to the site (driver, facility contact, carrier dispatcher, agency)
- Existing account lookup — with an explicit "no account / unknown" path that does not block the form
- Location: address *and* a GPS pin. **Send a pin-drop link** to the caller's phone and capture the position they return, rather than trying to transcribe a highway location by voice. This writes a `locations` row (the GPS collection, per `GLOSSARY.md` — not `facilities`)

**The spill**
- Material and estimated quantity
- Surface: road / soil / both / water
- Storm drain involvement (yes / no / unknown)
- Off-road discharge (yes / no / unknown)
- Absorbent already deployed (yes / no), and by whom

**Who else is there**
- Law enforcement, fire department, other emergency services: en route / involved / on scene / not involved
- Agency or incident number if one has been issued

Storm drain, off-road discharge and agency involvement are not just intake trivia — they drive regulatory reporting and should be stored as real fields, not folded into a description.

### 2. Payment and insurance gating before mobilization

> *"does he have insurance, if so Will this be an insurance claim? If it wont be an insurance claim or they do not have insurance they must send us a copy, if not we need a down payment via cc to even mobilize? (send copy). Once we get on site we will need the person to sign paperwork, unless they already have an account with us (full new customer packet + service agreement) if he doesn't have insurance then we need payment upfront of X thousands."*

The dictation is compressed; the decision tree underneath it is clear enough to build, but **the owner must confirm it before implementation** — mobilizing or refusing to mobilize is a business decision, not an engineering one.

Read as:

1. **Existing account in good standing** → mobilize. Paperwork already on file.
2. **Insurance, and it will be an insurance claim** → capture carrier, policy and claim number, require a copy of the policy/declarations page, mobilize.
3. **No insurance, or not filing a claim** → card down payment required before mobilization; threshold amount configurable (the note's "X thousands").
4. **On site, in every non-account case** → the full new customer packet plus a service agreement gets signed before or during work.

What the app has to do with that: show the mobilization decision as an explicit, visible state on the emergency record (`Blocked — awaiting down payment`, `Cleared to mobilize`, with who cleared it and when), rather than leaving it in someone's head. The paperwork half rides on **Phase 13's** document requirement model — the new customer packet (`docs/uploaded files/New Customer Packet trey.pdf`) and the service agreement become requirements attached to the emergency, satisfiable onsite.

**Payment capture is out of scope as a real integration.** No payment processor exists in this app and adding one is its own decision. Model the down payment as a recorded, attributed fact ("$X taken, by whom, reference number"), not as a charge the CRM performs.

### 3. One action creates the project and the deployment

> *"we can streamline a deployment and project creation simultaniously without going through opportunity stages"*

Submitting a cleared emergency intake creates, in one write path:

- a **project** with `jobClass: "Emergency Response"`, the GPS location attached, the intake answers on its Intake tab (Phase 15), and the paperwork requirements from item 2
- a **dispatch job** already linked to it, priority Emergency, ready for crew assignment
- an **account** and **facility**, where none existed — provisional records flagged for cleanup by the office, not perfect ones. An unknown caller must never be a reason the truck cannot be dispatched

**Watch the double-submit failure mode.** Phase 07 item 2 found `convertJobRequest()` creating two dispatch jobs from one request, and six near-duplicate jobs in real seed data. This flow creates *more* records per submit, under time pressure, with people who will click twice. Guard it at the start.

### 4. Where it lives

The Operations applet's Emergency Response view is the natural home for the entry point, alongside the existing "Field alert" button. Phase 17 reworks that view's cards and tables; coordinate so the new action lands in the reworked header rather than being moved twice.

The emergency rate tier and the four-hour minimum on labor, trucks and equipment (Phase 08's rate-sheet findings) are what makes an emergency job price correctly. This phase does not need them to ship, but an emergency job priced at standard rates will be wrong — note the dependency on the job, do not silently mis-price it.

### 5. Weather at incident time

The emergency intake is where **incident weather** gets its timestamp and coordinates (the caller's pin drop). The full two-snapshot spec — incident weather and response weather, both pulled automatically and stored as immutable snapshots — lives in `phase-11-field-ops-depth.md`, so that it serves scheduled and multi-stage work too. This phase's obligation is narrow: record the incident time and GPS precisely enough that the fetch is meaningful.

---

## Definition of done

- [x] A spill call can be taken start to finish on one screen — `#emergencyIntakeDialog`, opened via a new "New spill call" button on the Emergency Response operations view. GPS pin capture is a pasted-coordinate field (parsed for common formats), not a link sent to the caller's phone, per the locked Q18 decision
- [x] Storm drain, off-road discharge, emergency-services status (law enforcement/fire/other, each independently) and absorbent deployment are stored as real fields on the project record, not folded into a description
- [x] Insurance, claim and down-payment state is explicit (`mobilizationStatus`/`mobilizationNote`), and the record says plainly whether it is cleared to mobilize — verified live for both the "Blocked — awaiting down payment" and "Cleared to mobilize" ($15,000 down payment) paths
- [x] Onsite paperwork requirements are attached automatically *(2026-09-24, on Phase 13: emergency intake creates the customer packet, the waste authorization and an MSA as requirements on the new project's account unless already approved; they show on the project's Files tab and drive its Intake paperwork flag)*
- [x] One submit produces a linked project and dispatch job — guarded against double-click with an in-flight flag (`emergencyIntakeSubmissionInFlight`) and a disabled submit button, same pattern as Phase 07 item 2's `convertJobRequest()` fix
- [x] An unknown caller with no account can still be dispatched — a provisional account (`isProvisional: true`) and a provisional facility are created inline in the same submit, verified live

---

## Open decisions

- **Confirm the mobilization decision tree in item 2**, including the down-payment threshold and who is allowed to override it.
- **Provisional accounts:** create them immediately, or hold the intake unattached until the office reviews it?
- **Does an emergency project ever need a retrospective opportunity** for reporting/attribution, or is it complete on its own?
- **Pin-drop delivery** — SMS or a link the caller opens? This overlaps Phase 19 and Phase 18's consent-link mechanism; the same machinery may serve all three.

---

## Corrections found during implementation

- **Found a real bug while testing the "Blocked" path: `getJobProgress()` returned `NaN%` for a project with no `targetDate`.** `getDateProgress(startDate, targetDate)` divides by the start/target span with no guard for a missing end date — every other project-creation path in the app (opportunity-to-project, the manual remediation dialog) always sets one, so this was never hit before. Fixed by defaulting the emergency project's `targetDate` to `addDays(3)` at creation (a provisional estimate, revised once real scope is known onsite) rather than patching `getDateProgress()` itself, since a project with literally no target date is a real data gap other creation paths don't have and shouldn't silently tolerate either.
- **The onsite paperwork requirement (item 2's "full new customer packet plus a service agreement gets signed") was not built.** It depends on Phase 13's document requirement/review model, which doesn't exist yet — same dependency Phase 15 hit for its "customer paperwork" flag. The mobilization gating itself (down payment / insurance) does not depend on Phase 13 and is fully built; only the "paperwork requirement gets attached automatically" half is blocked.
- **Facility creation is a plain inline object literal, not routed through `saveFacility()`'s form-handling path**, since the intake has no form for it — the facility record is built directly in `submitEmergencyIntake()` with the minimum fields the render sites read (`accountId`, `name`, `street1`, `category`, `badge`). If the Facility detail page grows required fields later, this construction site needs updating alongside it.
- **The "Convert to quote"-style dispatch record intentionally skips `jobRequests` entirely** — no job-request record is created for an emergency intake, per item 3's explicit "streamline... without going through opportunity stages." This means `jobRequestsForProject()` will always be empty for an emergency project created this way, so Phase 15's "customer paperwork" flag (which reads job requests) will always show "Unknown" for these projects — expected, not a bug, until Phase 13 gives emergency intakes their own paperwork-tracking path.

---

## Decisions locked 2026-09-22 (owner)

- **Mobilization decision tree (Q14):** signed off as written in item 2, *"for now."* Treat it as provisional — revisit once real calls run through it.
- **Down-payment threshold and override (Q15): $15,000, overridable by the Director of Sales.** Both belong in configuration, not in code: the threshold will move, and the overriding role has to line up with Phase 12's real roles. Record who overrode, when, and why — an override on a mobilization decision is exactly the kind of event an audit log exists for.
- **Provisional accounts (Q16): an account is required before dispatch — no exceptions — but it can be created in the field.** This is a correction to this doc's original framing, which proposed dispatching first and tidying the record up later. The account creation moves into the intake/field flow rather than being deferred; what must never happen is a truck waiting on *paperwork*, which is a different thing from waiting on a customer record. Make field account creation fast enough that this holds in practice.
- **Retrospective opportunity for ER projects (Q17): no.** An emergency project is complete on its own.
- **Pin drop (Q18): it is just GPS coordinates** — whatever the caller's phone produces (Google Maps pin, Android share, plain lat/long). So this is **not** a link-issuing system and does not share Phase 18's consent-link machinery as this doc suggested. Accept a pasted pin/coordinate string, parse the common formats, and write a `locations` row. Sending the caller a link to capture their position is a possible later refinement, not the requirement.
