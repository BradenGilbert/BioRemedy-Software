# Phase 12 — PostgreSQL Migration

**Status:** Not started
**Depends on:** Phases 01–07. Do not start early.
**Estimated sessions:** Many. This is the largest phase on the roadmap.

---

## Why this phase exists — and why it is *here*

`docs/database-handoff-map.md` opens with the core observation:

> *"The architecture is much farther along than the production database implementation."*

141 tables and 27 views are designed across 28 SQL files. **None of it is deployed.** The running system is a 394 KB JSON file.

**Why this phase is not earlier:** the JSON backend can carry a small pilot, provided it is shared (Phase 01), backed up (Phase 00), and behind a real login (Phase 10). Postgres is the blocker for *production and scale*, not for *pilot*. Doing it first would freeze every user-visible improvement for weeks and would migrate a data model that Phases 02–05 are about to change substantially.

**Why it must not be skipped:** a JSON file has no transactions, no concurrent-write safety, no referential integrity, no real backup story, and no query layer. It is a prototype store and it will fail under real concurrent use.

---

## Stack decision (locked 2026-09-15)

**Node + PostgreSQL.** `server.mjs` grows into the real API. The existing role-gated collection routes are already the right shape.

`laravel-ready/` is **deprecated** — 12 of 141 tables, untouched since. Reference only. Do not add to it.

---

## In scope

### 1. Stand up PostgreSQL with managed migrations

- Real database, real migration history, repeatable from zero
- The existing 28 files become the baseline
- New migrations `029+` from Phases 02, 04, 05, 06, 07:
  - `facility_contacts`, location retention (02)
  - `account_approved_subcontractors` (04)
  - activity tags (05)
  - identity / RBAC / audit (06)
  - entity attachments (07)
- Seed and reference data: industries, account types, subcontractor types, job status definitions, units, currencies
- **Backups and a tested restore.** Not an assumed restore — a tested one.

### 2. Reconcile the three naming systems

> *"The same concepts currently use different names in IndexedDB, JSON, and SQL. That duplication must be removed during the production database migration."* — `docs/database-handoff-map.md`

**`GLOSSARY.md` in this folder is the contract.** Phases 01 and 02 already did the hardest renames (`jobs`→`projects`, `locations`→`facilities`, `mapLocations`→`locations`), which is a large part of why they come first.

### 3. Build the real API

Collection routes become genuine endpoints with validation, transactions, and authorization. Domain by domain, in the order `docs/database-handoff-map.md` recommends: CRM core → projects → workforce → templates → dispatch → execution → reporting.

### 4. Migrate the data

Real pilot data exists by now. This is a **migration**, not a reseed.

- ID strategy: the prototype uses readable string IDs (`acct-riverbend`, `opp-riverbend-ust`); SQL uses UUIDs. Map deliberately and keep the legacy ID as a column — debugging and support both need it.
- Verify row counts and spot-check relationships after every table.

### 5. Retire the JSON backend

Only after parity is proven. Keep it readable in parallel until then.

---

## Out of scope

- Cloud hosting, containers, CI/CD — infrastructure, decided separately
- Front Line production API — Phase 13
- The 27 SQL views. `docs/erp-operational-architecture.md`: *"Views and application panels should be implemented only after these tables and service contracts are accepted."*

---

## Suggested sequence

`docs/database-handoff-map.md` already recommends a build order; this phase follows it:

1. Stand up Postgres, migration tooling, backups
2. Apply `001`–`028` plus the new `029+`
3. Reconcile names per the glossary
4. CRM core API (accounts, contacts, opportunities, projects) and cut the app over
5. Workforce, templates, dispatch, execution
6. Reporting and billing
7. Retire JSON

Cut over **domain by domain**, not all at once. The app should run against a mixed backend during transition — which is exactly why Phase 01's clean server boundary matters.

---

## Verification / done criteria

- [ ] Database rebuilds from zero via migrations, repeatably
- [ ] A restore from backup has been **performed**, not assumed
- [ ] Every prototype collection has a mapped destination table, documented
- [ ] Row counts reconcile; relationships spot-checked
- [ ] Legacy string IDs retained and queryable
- [ ] Two concurrent users editing the same record behave correctly — the thing a JSON file cannot do
- [ ] Referential integrity is enforced by the database, not by hope
- [ ] `data/backend.json` is no longer read by the running application
- [ ] `docs/database-handoff-map.md` rewritten to describe reality

---

## Open decisions

- **Hosting** — local, on-prem, Azure (fits the Entra/M365 direction), or another cloud?
- **Migration tooling** — node-pg-migrate, Knex, Prisma, or raw SQL runner? The 28 files are raw SQL; a thin runner preserves them, an ORM means rewriting them.
- **Cut-over style** — domain-by-domain (recommended) or big bang?
- **Is Dataverse still a target?** The schema is deliberately Dataverse-compatible. If real Dynamics sync is ever intended, `docs/dataverse-relationship-architecture.md` says to query real Dataverse metadata *before* this migration, not after.

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*
