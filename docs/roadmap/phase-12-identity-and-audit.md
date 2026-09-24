# Phase 12 — Identity, Authorization & Audit

**Status:** Not started. **Split 2026-09-23 into 12a and 12b** (see below); 12a is sprint Wave 6.
**Depends on:** Phase 01 (shared data must exist before it can be protected)
**Estimated sessions:** 3–4
**Gate:** This phase plus Phase 13 is the boundary before real customer data enters the system.

---

## Why this phase exists

There is no authentication. There is a **role picker** in Settings and an `X-CRM-Role` header that *the client sets on its own requests* (`app.js:1952`, `app.js:13100`).

That means today, anyone who can reach the URL can:
- pick any role, including Admin, from a dropdown
- or simply send a different header value

`canAccessWorkspace()` (`app.js:2802`) hides navigation. It does not protect data. As `docs/erp-operational-architecture.md` states plainly:

> *"Identity and API claims determine access; UI visibility is not authorization."*

That is survivable for demo data behind a Cloudflare quick tunnel. It is **not** survivable for real customer records, which is the stated 3-month goal.

`docs/database-handoff-map.md` lists this as **Priority 0, item 1**.

---

## In scope

### 1. Real authentication

Microsoft Entra ID, Authorization Code + PKCE. **The wiring already exists** in the app's Identity & Sync screen — it needs a tenant ID, client ID, and a registered SPA redirect URI, then activation as the real login path rather than an optional extra.

- Replace the role picker as the identity source
- Session handling, sign-out, token refresh
- Keep a documented break-glass path for local/offline work

### 2. Server-side authorization

The critical change: **the server stops trusting the client's role claim.**

- Validate Entra tokens server-side
- Derive role from the validated token, not from a request header
- Enforce on every `/api/backend/*` route — the role-gated route table exists, it is just gated on a spoofable input
- Map Entra identities to `system_users` (exists, 3 rows) and on to `employees`

> `system_users` answers *"who can sign in?"*; `employees` answers *"who can be scheduled?"* Keep them separate — an employee can exist with no application access.

### 3. Roles and permissions as data

Today roles are string comparisons scattered through the app. Needed:
- Role definitions, user-role assignments, permissions, role-permission mappings
- Revocation

**Global security role vs. project assignment role** — `docs/crm-foundation.md` is emphatic about this distinction, and it is the right model:

- **Global role** — what you can generally access (Administrator, Staff, Sales Manager, Field Lead, Read-Only)
- **Project assignment role** — what you're doing on a specific job (Sales Lead, PM, Technician, Sampler, Dispatcher)

The second lives in `projectAssignments` (migrated in Phase 01), which is why that collection matters more than its current emptiness suggests. It is what makes "reassign everything Person A owns to Person B when they're out sick" a data operation rather than a code change.

### 4. Audit log

Immutable, append-only: who changed what, when, from where. `docs/database-handoff-map.md` Priority 0, item 2.

Minimum for pilot: writes to core business records. Not every read.

### 5. Close the known attachment hole

From `docs/erp-operational-architecture.md`:

> *"The attachment inline-view route is **not** role-gated: it is loaded by `<img src>`, and browsers cannot attach the `X-CRM-Role` header to an image request. Access rests on attachment ids being opaque."*

Security-by-opaque-ID is not access control. Once real sessions exist, cookie or signed-URL based auth closes this. Coordinate with Phase 13.

---

## Out of scope

- Full Microsoft 365 integration — Outlook, Teams, SharePoint. Sign-in only here.
- MFA policy, conditional access — these are Entra tenant configuration, not application work.
- Payroll/HR data. Explicitly out of scope per both architecture docs.
- Field-level permissions. Record- and route-level is enough for pilot.

---

## Data model changes

New: role definitions, user-role assignments, permissions, role-permission mappings, audit log, API/service clients.

None of these exist in `crm-schema/` yet — this is net-new schema design, and it should be written as new numbered migrations (`029+`) so it lands in the Phase 14 migration set cleanly.

---

## Verification / done criteria

- [ ] Signing in requires real Entra credentials
- [ ] **Forging the `X-CRM-Role` header to `Admin` changes nothing** — test this explicitly with a hand-crafted request
- [ ] A Sales role cannot read dispatch collections via the API directly, not just via hidden nav
- [ ] Editing a record writes an audit entry naming the real user
- [ ] Reassigning a project assignment from one employee to another moves task routing and visibility
- [ ] Requesting an attachment URL while signed out is refused
- [ ] Revoking a user's access takes effect on their next request

---

## Open decisions

- **Entra tenant + app registration** — does this exist yet, or does it need to be created? External dependency; start early, it can block the phase.
- **Break-glass local admin?** `docs/crm-foundation.md` lists it as optional. Recommended for a solo-developer prototype, with a loud audit entry on every use.
- **Audit storage** — same JSON backend for now, or straight to a real database? Leaning toward an append-only file until Phase 14.

---

## Split (2026-09-23): 12a local sessions, 12b Entra

Phase 20's review recommended, and the owner accepted, splitting this phase so the pilot is not blocked on the Entra app registration:

- **12a — the identity seam, no Entra dependency (sprint Wave 6).** Server-side sessions with a local sign-in (`system_users` with password hashes, or a one-time link), an HttpOnly session cookie, role derived from the session on every `/api/*` request — the `X-CRM-Role` header is ignored — audit log naming the real user, revocation on the next request, the break-glass admin (Q43), the attachment route gated by the cookie, and a pluggable identity provider so 12b drops in without touching the routes. Unblocks Phase 13 and the pilot.
- **12b — the Entra provider.** The existing browser PKCE flow plus server-side token validation against the tenant's keys, roles from the token's `roles` claim (app roles assigned in Entra), token refresh, and the local sign-in demoted to break-glass only. Needs the app registration.

**Tenant (owner, 2026-09-23): the Entra tenant is `bioremedy.com`** — not micro-bac.com. The app registration, the app roles and the HTTPS redirect URI all live there.

**Done criteria inherited from Phase 20 (2026-09-23):** `scripts/smoke.mjs` with `CRM_SMOKE_EXPECT_AUTH=1` must pass once 12a ships — the forged-role check flips from "honoured" to "refused", and the static-file 404s stay.

## Corrections found during implementation

- **2026-09-23 — inherited from Phase 11 (sprint Wave 5):** in-app `notifications` now exist, addressed to roles (`audienceRoles`), with `readBy` tracked by user name and `recipientUserId` left empty. When real identities land, address notifications to users and replace `readBy` names with user ids. Phase 11's "approvals" half (approval requests with ordered steps and escalation) was moved here, because an approval step needs a named approver.

*(Record here anything that turned out to be different from the plan.)*

---

## Decisions locked 2026-09-22 (owner)

- **Entra tenant / app registration (Q42): does not exist yet.** This is now the single longest-lead dependency in the roadmap and it is outside the codebase. Creating a tenant and registering the application should start well before this phase does — everything in Stage C waits on it, and Phase 18's sign-on links wait behind that.
- **Audit storage (Q44): keep it simple until 1.0.** An append-only file in the JSON backend until the real database lands in Phase 14, at which point audit moves with it. Matches this doc's original leaning.
- **Break-glass admin (Q43): still open** — the owner asked what it means. See the session notes; re-ask once the concept is clear. It is not blocking, but it should be settled before real sign-in ships, because retrofitting an emergency access path after lockout is painful.

### Q43 answered 2026-09-22 — build the break-glass admin

A local emergency account that works when Entra does not (outage, tenant misconfiguration, lockout). **Build it as part of this phase, not after** — an emergency access path added once you are already locked out is not an emergency access path.

Requirements: credentials stored separately from the normal auth path; every single use written to the audit log as a high-visibility event, not a routine entry; and the account exercised deliberately during the phase so it is known to work before it is needed.
