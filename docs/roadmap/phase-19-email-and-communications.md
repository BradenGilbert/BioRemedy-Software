# Phase 19 — Email, Sending & Message Tracking

**Status:** Not started. The owner flagged this as "later" — it is written down so the things that depend on it stop being designed around its absence.
**Depends on:** Phase 08 (a quote must be printable before it can be attached), Phase 12 (an outbound message is sent *as* someone — that needs real identity), Phase 13 (attachments and document state)
**Estimated sessions:** 3+ — this is the largest unstarted phase in the roadmap and should be broken up before it is started
**Source:** `docs/roadmap/notes-2026-09-22.md` items 20 and 21

---

## Why this phase exists

> *"Later we will need a send quote button. Once that is clicked it should pop open a email sender window with a template email the pdf version of the quote attached and the option to edit To: cc: and BCC:. This is apart of an email sending and receiving function as well as message tracking and inboxing within the crm."* / *"Create, sent, edit, tracked from one thing"*

Three other phases are currently writing "manual for now" because this does not exist:

- **Phase 08** can produce a customer-presentable quote but cannot send it.
- **Phase 13** can track that the new customer packet is required and approve it once it comes back, but the "push it to the customer via email or a portal link" half has nowhere to live.
- **Phase 16** wants to send a pin-drop link to a caller's phone.

The owner's one-line summary — *create, sent, edit, tracked from one thing* — is the actual requirement. A quote that is created in the CRM and then emailed from Outlook is a quote the CRM cannot tell you anything about.

---

## In scope

This phase has a natural staging, and **it should be built in this order** rather than as one push.

### Stage 1 — Send one document, well

A **Send** action on a quote (later: estimates, invoices, reports, packets) that opens a composer:

- To / Cc / Bcc, prefilled from the opportunity's associated contacts, all editable
- A template body with real merge fields, editable before sending
- The rendered PDF attached, generated from Phase 08's existing print/export view
- The send recorded on the record's timeline — what went out, to whom, when, by whom, with the exact attachment version

Even with no inbound mail at all, this closes most of the loop. The attached-version detail matters: "we sent them a quote" is much less useful than "we sent them *this* quote," especially after it has been revised.

### Stage 2 — Delivery and outcome tracking

Delivered, bounced, opened, link clicked. This is what makes **Phase 13's** portal flow work: a customer fills the packet in via a link and the requirement completes itself, which is exactly what the notes describe. It also makes a follow-up queue possible ("sent 9 days ago, never opened").

Open tracking is not reliable and should never be presented as certainty. Label it as a signal.

### Stage 3 — Receiving and inboxing

Inbound mail associated to the account, contact, opportunity or job it belongs to, so the CRM holds the thread rather than fragments of it. This is the biggest and least defined piece:

- **Mailbox model** — a shared company mailbox (the 2026 rate sheet advertises `ER@BioRemedy.com` as the emergency inbox, so at least one shared box is already in use), individual mailboxes, or both?
- **Association** — by thread, by sender, by explicit user action, or heuristically? Heuristic association that guesses wrong is worse than no association.
- **Provider** — Microsoft 365 is what this company runs on (`bgilbert@micro-bac.com`), which makes Graph the obvious path, and OAuth per user the obvious cost.

### Cross-cutting: this is the first outbound-facing capability in the app

Everything the platform has done so far is internal. Sending mail changes that, and brings requirements the rest of the roadmap has not had to carry:

- **Sender identity and permissions** — who may send as whom (Phase 12).
- **Auditability** — an append-only record of what left the building.
- **A hard separation between draft and sent.** A sent message cannot be edited; the note's "create, sent, edit" means edit *before* sending.
- **Deliverability** — SPF/DKIM/DMARC on whatever domain sends. A CRM that sends into spam folders is worse than one that does not send.
- **A test/dry-run mode**, so nobody's first live test emails a real customer.

---

## Explicitly out of scope

- Marketing campaigns, bulk sending, and sequences. This is transactional correspondence attached to records.
- Replacing Outlook. People will keep using their mail client; the goal is that CRM-relevant correspondence lands in the CRM too.
- Choosing an e-signature vendor. Phase 13 owns that decision; this phase only delivers the link.

---

## Definition of done (Stage 1 only — later stages need their own scoping pass)

- [ ] A quote can be sent from the CRM with an editable template, editable To/Cc/Bcc and the PDF attached
- [ ] The send appears on the opportunity timeline with the exact version that went out
- [ ] Nothing can be sent as another user without permission to do so
- [ ] There is a dry-run mode that cannot reach a real customer

---

## Open decisions

- **Provider and mailbox model** (Microsoft 365 / Graph is the presumptive answer, per the company's existing stack).
- **Shared `ER@` style inboxes vs. per-user mailboxes** — probably both, but which first?
- **Open/click tracking** — worth the false-confidence risk, or delivery/bounce only?
- **Do sent messages live in a new `messages` collection**, or extend `activities`? `activities` is already carrying a lot and has an unresolved divergence with `sales_tasks` (see Phase 05).

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*

---

## Decisions locked 2026-09-22 (owner)

- **Mailbox rollout (Q50): per-user mailboxes first.** *"it will keep things the cleanest right now."* Shared `ER@`-style inboxes come later — worth noting that the 2026 rate sheet already publishes `ER@BioRemedy.com` to customers, so a shared box exists operationally even if the CRM does not model it yet.
- **Open/click tracking (Q51): yes, track both.** Record them as signals rather than facts — an unopened-looking email may simply have images blocked, and a "read" may be a scanner. Label them accordingly in the UI so nobody makes a customer-facing claim on the strength of a tracking pixel.
- **Provider (Q49) and message storage (Q52): still open** — the owner asked for the options to be explained. See the session notes.

### Q49 / Q52 answered 2026-09-22

- **Provider (Q49): Microsoft Graph.** Sends land in the real Sent folder, inbound reading stays possible later, no new vendor. The cost is per-user OAuth consent, which is a real setup step — plan for it rather than discovering it.
- **Message storage (Q52): a separate `messages` collection** that renders into the existing timeline. Email-specific fields (recipients, subject, body, attachment version, delivery and open status) do not get bolted onto `activities`, which is a generic timeline log already carrying an unresolved split with `sales_tasks`.
