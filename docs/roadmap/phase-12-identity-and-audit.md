# Phase 12 — Identity, Authorization & Audit

**Status:** **12a shipped 2026-09-23 (sprint Wave 6)** — server sessions, local sign-in, API enforcement from the session, audit log, revocation, break-glass, the attachment route closed, and Phase 18 item 4 on top of it. **12b shipped 2026-09-24** — "Sign in with Microsoft" with the ID token verified on the server against the tenant's published keys, the CRM role taken from the Entra app role, a user record created on first sign-in, and the sign-in rules below. Verified against a synthetic tenant (signed test tokens; a mocked Microsoft in the browser). **Waits on the owner's Directory (tenant) ID and Application (client) ID in `.env`** for the first real-tenant sign-in.
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

- [x] Signing in requires real Entra credentials *(12b, 2026-09-24: with `CRM_ENTRA_TENANT_ID` and `CRM_ENTRA_CLIENT_ID` set, the sign-in screen leads with Microsoft and the server verifies the ID token itself. Passwords stay as a fallback until `CRM_LOCAL_LOGIN=off`; break-glass always works. Verified against a synthetic tenant; the first real-tenant sign-in is the owner's next step once the IDs are in `.env`.)*
- [x] **Forging the `X-CRM-Role` header to `Admin` changes nothing** — test this explicitly with a hand-crafted request *(2026-09-23: 401 with the header and no session; the header is never read. `scripts/smoke.mjs` checks it on every run.)*
- [x] A Sales role cannot read dispatch collections via the API directly, not just via hidden nav *(verified with a Scheduler session: `/api/backend/invoices` → 403, `/api/backend/systemUsers` write → 403; the role table is unchanged, only its input is now the session)*
- [x] Editing a record writes an audit entry naming the real user *(`data/audit.log`: actor name, role, session kind, IP, collection, record, the changed fields)*
- [ ] Reassigning a project assignment from one employee to another moves task routing and visibility *(not part of 12a; `projectAssignments` still has no UI that writes it — see Phase 15)*
- [x] Requesting an attachment URL while signed out is refused *(401; the `<img>` carries the session cookie when signed in)*
- [x] Revoking a user's access takes effect on their next request *(revoke from Identity & Sync › Active sessions, or disable the user: the next API call is 401 and the app returns to the sign-in screen)*

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

- **12a, 2026-09-23 — what shipped and where it lives.** Identity is in `<data>/auth.json` (credentials as scrypt hashes with per-user salts, sessions as SHA-256 token hashes, sign-on links, the break-glass hash) and the audit trail in `<data>/audit.log` (append-only NDJSON) — both gitignored, neither inside `backend.json`, so secrets never enter git or a data snapshot. The session is an HttpOnly, SameSite=Lax cookie (`crm_session`, 12 h sliding, `Secure` when the tunnel says https); `getRole()` reads the session and nothing else. Routes: `/api/auth/login|logout|me|break-glass|password|users|sessions|sessions/{id}/revoke|audit|terms|dispatch-links|consent`. `systemUsers` gained `role` (from the title where it matched), `username`, `employeeId`, `isDisabled`; writes to it are Admin-only and disabling revokes the user's sessions at once. The owner's record (`bgilbert`, Admin) is seeded without a password: the first sign-in is break-glass, then Users & access sets it.
- **Break-glass (Q43):** created on first start; the password is written to `<data>/break-glass-password.txt` (or taken from `CRM_BREAK_GLASS_PASSWORD`), every use is a `severity: high` audit line, and the Sessions panel shows it as "emergency access". Wrong attempts are rate-limited (8 per 15 minutes per IP).
- **Provider seam for 12b:** `handleAuth` dispatches by route; `createSession()` is the one place a session is born. 12b adds `POST /api/auth/login` with `provider: "entra"` carrying the id token, validates it against the tenant's keys (issuer, audience, expiry, nonce), maps `oid`/`preferred_username` to a `systemUsers` row (or the `roles` claim to a role), and calls the same `createSession()`. The local password path then becomes break-glass-only.
- **2026-09-24 (owner: "there is no sign-out button" → "it should be in settings"):** Logout is in the Settings dialog (gear icon → Account → Logout), the top bar shows who is signed in, and Front Line's Settings screen has a Session card with Sign out (Exit still just returns to the office app). Machine settings such as `CRM_BACKUP_DIR` live in a gitignored `.env` file read by the server at startup.
- **2026-09-24 — first-password bug, found by the owner's audit trail.** `POST /api/auth/password` only persisted the credential through `revokeSessions()`, which saves only when it revoked something; a user's *first* password therefore lived in memory and vanished on the next server restart ("bad password" after a restart). Fixed: the route saves before revoking. The same trail showed the owner's seeded record used a guessed address (`bgilbert@bioremedy.com`); it is `braden@bioremedy.com` / username `braden`, corrected in place at load. Administrators can now change the emergency password from Identity & Sync (`POST /api/auth/break-glass/password`, audited high); the generated file is not rewritten.
- **Not closed by 12a:** `/api/owntracks` (phone location pings) keeps its token-less contract because OwnTracks cannot send a cookie — it needs a per-device token, which belongs with the Front Line production API. A sign-on-link session carries the Field Lead role for the whole dispatch domain rather than only its one job; per-job package scoping is the Front Line production API's job (Phase 10 item 1). The smoke sweep and the scripts (`clean-orphans --apply`, `reset-demo-data`) sign in with the break-glass password (`--password` / `CRM_PASSWORD`).
- **12b, 2026-09-24 — what shipped and where it lives.** Turned on by `CRM_ENTRA_TENANT_ID` + `CRM_ENTRA_CLIENT_ID` in `.env` (nothing else changes when they are absent). The public `GET /api/auth/providers` tells the sign-in screen what to offer. The browser keeps the PKCE flow it already had (`prompt=select_account`, redirect URI = origin + path, so `https://<host>/` — register it under the **Single-page application** platform, plus `http://localhost:4173/` for local testing) and hands the ID token to `POST /api/auth/login { provider: "entra", idToken, nonce }`. The server trusts nothing in it until it has checked: RS256 only; the signing key by `kid` from the tenant's OpenID discovery document and JWKS (cached a day, refreshed on an unknown `kid` at most once a minute, so key rollover works); `iss`; `aud` = client ID; `exp` (60 s leeway) and `nbf`; `tid`; and the nonce the browser stored. Node's `crypto` does all of it — no package.
  **Mapping:** `oid` → `systemUsers.entraObjectId`; otherwise `preferred_username`/`email` (lowercased) against username or email, and the oid is stamped on that record; no match → a record is created (`createdBy: "entra"`, username = the local part of the address). The role is the highest app role in the token by this order — `Admin, OfficeManager, SalesManager, AccountManager, OperationsManager, Scheduler, FieldLead, InventoryManager, FinanceManager, ClientPortal` — and Entra wins over the local record on every sign-in; only when the token carries no role does the record's own role count. **Refused (403, with a message that says what to do):** no role anywhere; disabled here; Client Portal with no `clientAccountId` (the record is still created so an admin can link it under Users & access, then the person tries again). Every outcome is audited with `provider: "entra"`; provisioning is its own `user-provisioned` line.
  **Lockout rule:** only tokens that fail verification count toward the 8-per-15-minutes per-IP lock. A missing role or a disabled record is a configuration problem for a real person, and the office shares one IP, so those do not lock colleagues out.
  **Sessions:** the CRM session (the 12-hour sliding cookie from 12a) is what the app trusts; the ID token is used once and never stored on the server. No token refresh is needed for sign-in — the split note's "token refresh" only matters for Graph calls (Phase 19). Consequence worth knowing: someone disabled in Entra keeps their CRM session until it expires or an administrator revokes/disables them here (at most 12 hours). Acceptable for the pilot.
  **Passwords:** still on by default. `CRM_LOCAL_LOGIN=off` hides the password form and the Set password buttons and makes the route refuse password sign-ins — flip it once everyone has signed in with Microsoft once. The runbook had called this switch `CRM_AUTH_PROVIDER=entra`; corrected there.
  **UI:** Microsoft errors (Entra's own `AADSTS…` descriptions, or ours) render under the Microsoft button, password errors under the password form. Users & access marks Microsoft-linked people ("Signs in with Microsoft") and stops nagging them about passwords; Active sessions labels the kind. Identity & Sync shows the server's tenant/client IDs read-only; its own fields are a browser-only override for testing another registration.
  **Tests:** `CRM_ENTRA_TEST_JWKS_FILE` + `CRM_ENTRA_TEST_ISSUER` (scratch servers only — never set them in production) let a test sign tokens with a throwaway RSA key. Checked 2026-09-24: a new person with `SalesManager` is provisioned and gets Sales Manager access (accounts 200, employees 403); a second sign-in reuses the record and follows a role change; several roles → the highest; the owner's record is matched by email and stamped with the oid; wrong audience / expired / other tenant / bad signature / unknown key / wrong nonce / garbage / `alg: none` → 401 and the IP locks after eight; no role → 403 twice without locking; portal user unlinked → 403, linked by an admin → 200 with the account scoped; disabled → 403 and the old session dead; password sign-in still works; and in the browser the whole click-through (authorize → redirect → token → our server → signed in as Jane Sales, kind "Microsoft") with zero console errors.
- **2026-09-24, same day — roles combine; an active role per session (owner, after Tristan signed in with Inventory Manager + Field Lead and saw only Operations and Dispatch).** 12b had taken the *highest* app role; the owner wants the combination, plus a way to set the active role temporarily that resets at logout. Shipped: a session carries every role the person holds (`session.roles`, `systemUsers.roles`; `role` stays the primary one, first by the precedence order, for display) and authorization is the union — `canAccess()` accepts a list, `getRoles(request)` is what the server checks, `filterBackendForRole` and every route gate use it; on the client `currentRoles()`/`userHasRole()` drive `canAccessWorkspace`, notifications and paperwork review. Client Portal stays exclusive (an internal role on the same login wins). Users & access ticks roles instead of picking one; for a Microsoft sign-in the roles come from Entra on every sign-in. **Active role:** Settings › Roles and Permissions › Active role lists "All my roles" and each held role (an Admin gets every role, marked "view as"); the choice is stored on the server session (`POST /api/auth/active-role`, audited), so every API call honours it, the top bar says "acting as …", views outside it bounce to Home, and it ends with the session — a new sign-in always starts with every role. Always a narrowing: the held roles are what the route checks, so an Admin acting as Scheduler cannot touch admin routes until they switch back. Also fixed on the way: Logout inside Settings left the dialog open over the sign-in screen. Verified: server test (union access, narrowing, refusals for a role not held, reset on re-login, admin view-as, local users with several roles, exclusivity, fallback to the record's roles when the token has none) and a browser run (both apps on Home, narrow to Field Lead, top bar + bounce, logout, back in with everything, tick boxes in Users & access) with zero console errors.
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
