# Cutover runbook — JSON backend → PostgreSQL, local sign-in → Entra

**Written:** 2026-09-24 (sprint Wave 8, pre-cutover readiness). **For:** the person running Phase 14 (Postgres) and Phase 12b (Entra) at the alpha. **Decisions this follows:** Q47 big-bang cut-over at the alpha with a rehearsal and a tested way back; Q45 managed cloud database (Azure preferred); Q46 raw SQL with a thin runner; the tenant is `bioremedy.com`.

Read `phase-14-postgres-migration.md` and `phase-12-identity-and-audit.md` first. This document is the *procedure*; those are the *scope*.

---

## 0. What moves, and from where

| Source today | Goes to | Notes |
|---|---|---|
| `data/backend.json` (~107 collections) | PostgreSQL tables per the **Cutover inventory** in `docs/database-handoff-map.md` | Every collection has a named destination or an explicit "not migrating" |
| `data/uploads/` (documents, attachments, receipts, lab reports) | Object storage or a mounted volume; `documents.storage_name` keeps the key | Phase 13's `documents` plus the three legacy stores (`jobRequestDocuments`, `sampleLabReports`, `jobTaskAttachments`) fold into `documents` during the move |
| `data/auth.json` (credentials, sessions, sign-on links, break-glass) | `user_credentials`, `user_sessions`, `dispatch_sign_on_links`; break-glass stays a server secret | Sessions do **not** migrate — everyone signs in again after cutover |
| `data/audit.log` (append-only NDJSON) | `audit_log` | Import verbatim; keep the file as the pre-cutover record |
| `data/demo-seed.json` | Nothing | Demo data is not seeded in production (`CRM_SEED_DEMO` unset) |
| Browser IndexedDB (`syncQueue`, `settings`) | Nothing | Device-local; survives untouched |

---

## 1. Prerequisites (weeks before)

- [ ] **Database:** the managed PostgreSQL instance exists (Azure Database for PostgreSQL recommended), reachable from the app host, with a database owner role and an application role.
- [ ] **Migration runner:** a thin script that applies `crm-schema/001`–`028` plus the new `029+` files in order and records what ran. Raw SQL, no ORM (Q46).
- [ ] **New migrations written (`029+`)** for everything the inventory marks *new*: schedule events + participants, GPS points with retention, `messages`, inventory (items, purchase orders, movements, alerts), equipment maintenance/restock, `weather_snapshots`, `permits`, `notifications`, `sample_results`, estimates + lines, opportunity assignments/facilities, `facility_contacts`, account relationship extensions/divisions/comments, contact employment history, approved subcontractors, `pricing_settings`, accounting connections/export batches, `gps_consents`, `documents` (rewrite of `012_files.sql`), `document_types`, `document_requirements`, `user_credentials`, `user_sessions`, `dispatch_sign_on_links`, `audit_log`, `project_assignments`, `workforce_teams`. Plus the columns Phase 20/12a/13 added to existing tables: `version`, `updated_at`, `deleted_at/by/via` everywhere; `system_users.role/username/employee_id/client_account_id/is_disabled`.
- [ ] **Entra app registration** in the `bioremedy.com` tenant: single tenant, SPA platform, the production HTTPS redirect URI, delegated `openid profile email User.Read` with admin consent, **app roles** matching the role table (`Admin`, `Office Manager`, `Sales Manager`, `Account Manager`, `Operations Manager`, `Scheduler`, `Field Lead`, `Inventory Manager`, `Finance Manager`, `Client Portal`), users/groups assigned to roles. Note the tenant ID and client ID.
- [ ] **HTTPS hostname** for the app (Entra refuses plain http except localhost; the cookie becomes `Secure`).
- [ ] **Off-machine backups running** (`CRM_BACKUP_DIR` pointed at a OneDrive-synced folder) — a cutover starts from a backup you have already restored once.

---

## 2. The migration script

One script, idempotent, run against a copy first:

1. Read `backend.json`, `auth.json`, `audit.log`, and the `uploads/` listing.
2. For each collection in the inventory: map fields → columns, keep the prototype string id in `legacy_id`, generate the UUID, and write rows in dependency order (accounts → contacts/facilities/addresses → opportunities → projects → job requests → work orders → steps → actions → submissions → …). Soft-deleted rows migrate with `deleted_at` set — never dropped.
3. Rebuild the three legacy file stores into `documents` (entity type, sha-256 computed from the file, `visibility: internal`).
4. Import `audit.log` lines into `audit_log`; import `credentials` into `user_credentials`; skip sessions and expired sign-on links.
5. Print a **reconciliation report**: row counts per collection vs per table, every foreign key resolved, `scripts/clean-orphans.mjs`-equivalent integrity on the database side, and a checksum of `uploads/` vs `documents.storage_name`.

The script must exit non-zero on any unresolved reference. Fix the source data, not the script's tolerance.

---

## 3. Rehearsal (do this at least twice; the last time within a day of the real run)

1. Take a fresh snapshot: `npm run backup` (and confirm the off-machine copy landed).
2. Restore the snapshot on a scratch server (`CRM_DATA_DIR` at a copy) and run `node scripts/smoke.mjs` — the JSON side must be green before you move it.
3. Stand up an empty rehearsal database; apply migrations from zero; record the time it took.
4. Run the migration script against the copy; read the reconciliation report line by line.
5. Point a scratch app instance at the rehearsal database (`CRM_DATABASE_URL`) and run the smoke suite against it, plus the hand checks below. Record the time the whole rehearsal took — that is your cutover window.
6. **Rehearse the way back** (section 6): stop the Postgres-backed instance, start the JSON-backed one from the snapshot, confirm the smoke suite passes again.

Hand checks (no script covers these): open the three busiest accounts and compare a timeline, a quote, an invoice and a closed project's cost report side by side with the JSON instance; open a dispatch job with photos and a signature; open the Client Portal as a customer; download a document and a blank form.

---

## 4. Cutover day (big bang, Q47)

1. Announce the window; everyone signs out. Front Line users finish and submit anything in progress (there is no offline queue to drain).
2. Stop the live server. Take the final snapshot (`npm run backup`); copy `backend.json`, `auth.json`, `audit.log` and `uploads/` to the off-machine folder and **verify the copy opens**.
3. Apply migrations to the production database (already rehearsed; should be minutes).
4. Run the migration script against the final snapshot. Read the reconciliation report. **Any unresolved reference: stop and go to section 6.**
5. Start the app against the database with sign-in configured (section 5). Run `node scripts/smoke.mjs` against it and the hand checks.
6. Sign in with break-glass, confirm the audit trail shows the cutover entries, then sign in as yourself. Ask two other people to sign in with their Microsoft accounts before declaring it open.
7. Declare the JSON backend **read-only** (keep the server binary and the final snapshot; do not delete anything for 30 days).

---

## 5. Sign-in at cutover (Phase 12b)

The seam is `createSession()` in `server.mjs`: every session, whatever proved the identity, is born there. 12b adds one provider:

1. Client: the existing PKCE flow (Identity & Sync) sends the `id_token` to `POST /api/auth/login` with `provider: "entra"`.
2. Server: fetch the tenant's OpenID configuration and JWKS once (cache by `kid`), verify the RS256 signature, `iss` (`https://login.microsoftonline.com/<tenant-id>/v2.0`), `aud` (the client ID), `exp`, and the `nonce` the client stored. Node's built-in `crypto` does this; no package is required.
3. Map the token to a person: `oid` → `system_users.entra_object_id` (add the column), falling back to `preferred_username` → `internal_email_address` on first sign-in; take the role from the token's `roles` claim (the app roles above), or from the user row when the claim is absent.
4. `createSession()` as today. The cookie, revocation, audit and the Sessions panel all keep working unchanged.
5. Local passwords stay for **break-glass only**; the Users & access panel stops offering "Set password" once `CRM_AUTH_PROVIDER=entra`.

Test before cutover: a user with no app role is refused with a clear message; a disabled Entra account is refused on its next request (session revoked when the token refresh fails or the user is disabled locally); the forged-header and no-session checks in the smoke suite still pass.

---

## 6. The tested path back to JSON

Rollback is *"go back to the JSON file and lose whatever was written to Postgres since the cutover."* Keep it honest:

1. Stop the Postgres-backed server.
2. Restore the final snapshot into `data/` (`backend.json`, `auth.json`, `audit.log`, `uploads/`) from the off-machine copy.
3. Start the JSON-backed server (`node server.mjs` with no `CRM_DATABASE_URL`). Everyone signs in again (sessions did not migrate either way).
4. Run `node scripts/smoke.mjs`. Announce.

Anything written to Postgres during the failed window is exported (the reconciliation report's row counts tell you how much) and re-entered by hand. The longer the window, the more that costs — which is why the rehearsal's timing matters.

---

## 7. After cutover

- Retire `data/backups` scheduling in favour of database backups with a **performed** restore (Phase 14's done criteria).
- Rewrite `docs/database-handoff-map.md` to describe reality (Phase 14's last criterion).
- Remove the JSON code paths from `server.mjs` only after 30 clean days.
