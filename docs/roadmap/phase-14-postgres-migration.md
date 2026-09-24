# Phase 14 — PostgreSQL Migration

**Status:** Not started
**Depends on:** Phases 01–13 (every data-model change that lands before the pilot, plus identity and documents). Do not start early. *(Corrected 2026-09-23: this line and the two bullets below used pre-renumbering phase numbers.)*
**Estimated sessions:** Many. This is the largest phase on the roadmap.

---

## Why this phase exists — and why it is *here*

`docs/database-handoff-map.md` opens with the core observation:

> *"The architecture is much farther along than the production database implementation."*

141 tables and 27 views are designed across 28 SQL files. **None of it is deployed.** The running system is a 394 KB JSON file.

**Why this phase is not earlier:** the JSON backend can carry a small pilot, provided it is shared (Phase 01), backed up (Phase 00), and behind a real login (Phase 12). Postgres is the blocker for *production and scale*, not for *pilot*. Doing it first would freeze every user-visible improvement for weeks and would migrate a data model that Phases 02–05 are about to change substantially.

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
  - identity / RBAC / audit (12)
  - entity attachments (13)
- Seed and reference data: industries, account types, subcontractor types, job status definitions, units, currencies
- **Backups and a tested restore.** Not an assumed restore — a tested one.

### 2. Reconcile the three naming systems

> *"The same concepts currently use different names in IndexedDB, JSON, and SQL. That duplication must be removed during the production database migration."* — `docs/database-handoff-map.md`

**`GLOSSARY.md` in this folder is the contract.** Phases 01 and 02 already did the hardest renames (`jobs`→`projects`, `locations`→`facilities`, `mapLocations`→`locations`), which is a large part of why they come first.

### 3. Build the real API

Collection routes become genuine endpoints with validation, transactions, and authorization. Build them in the order `docs/database-handoff-map.md` recommends (CRM core → projects → workforce → templates → dispatch → execution → reporting), but **switch the application over all at once** at the alpha — the locked Q47 decision below, which reverses the earlier domain-by-domain plan. The JSON backend stays authoritative until that day.

### 4. Migrate the data

Real pilot data exists by now. This is a **migration**, not a reseed.

- ID strategy: the prototype uses readable string IDs (`acct-riverbend`, `opp-riverbend-ust`); SQL uses UUIDs. Map deliberately and keep the legacy ID as a column — debugging and support both need it.
- Verify row counts and spot-check relationships after every table.

### 5. Retire the JSON backend

Only after parity is proven. Keep it readable in parallel until then.

---

## Out of scope

- Cloud hosting, containers, CI/CD — infrastructure, decided separately
- Front Line production API — Phase 10
- The 27 SQL views. `docs/erp-operational-architecture.md`: *"Views and application panels should be implemented only after these tables and service contracts are accepted."*

---

## Suggested sequence

`docs/database-handoff-map.md` already recommends a build order; this phase follows it:

1. Stand up Postgres, migration tooling, backups
2. Apply `001`–`028` plus the new `029+`
3. Reconcile names per the glossary
4. Every API route against Postgres, domain by domain, behind a switch — the app keeps running on JSON
5. Rehearse the full migration on a copy with real volumes; reconcile row counts and relationships; repeat shortly before the real run
6. **Big-bang cut-over at the alpha** (Q47): migrate, flip the switch, verify — with the tested path back to the JSON file ready
7. Retire JSON once parity is proven

*(Rewritten 2026-09-23 to match the locked Q47 decision; this section previously said "cut over domain by domain".)*

---

## Verification / done criteria

- [ ] Database rebuilds from zero via migrations, repeatably
- [ ] A restore from backup has been **performed**, not assumed
- [ ] Every prototype collection has a mapped destination table, documented
- [ ] Row counts reconcile; relationships spot-checked
- [ ] Legacy string IDs retained and queryable
- [ ] Two concurrent users editing the same record behave correctly *(Phase 20 item 1 already does this on the JSON backend with a per-record `version`; Postgres keeps the same rule as `WHERE version = $n`)*
- [ ] Referential integrity is enforced by the database, not by hope
- [ ] `data/backend.json` is no longer read by the running application
- [ ] `docs/database-handoff-map.md` rewritten to describe reality

---

## Open decisions

- **Hosting** — local, on-prem, Azure (fits the Entra/M365 direction), or another cloud?
- **Migration tooling** — node-pg-migrate, Knex, Prisma, or raw SQL runner? The 28 files are raw SQL; a thin runner preserves them, an ORM means rewriting them.
- **Cut-over style** — settled: big bang at the alpha (Q47, below).
- **Is Dataverse still a target?** The schema is deliberately Dataverse-compatible. If real Dynamics sync is ever intended, `docs/dataverse-relationship-architecture.md` says to query real Dataverse metadata *before* this migration, not after.

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*

---

## Decisions locked 2026-09-22 (owner)

- **Dataverse (Q48): no longer a target.** *"I think we will go outside and run custom database."* This closes a question that has shaped several documents. Consequences worth acting on rather than leaving implicit:
  - `docs/dataverse-relationship-architecture.md` stays useful as a record of *why* entities are shaped the way they are, but its alignment rules are no longer constraints. It should carry a note saying so, so a future session does not treat Dataverse compatibility as a requirement.
  - The schema's Dataverse-compatible choices (`stateCode`/`statusCode`, `transactionCurrencyId`, and similar) can be simplified during the migration if they cost anything. They are not free, and nothing now depends on them.
  - No Dataverse metadata query is needed before migrating, which removes a prerequisite this doc previously carried.
- **Hosting (Q45), tooling (Q46), cut-over (Q47): still open** — the owner asked for more explanation on all three. See the session notes. None of them block anything until this phase actually starts, which is after the pilot.

### Q45–Q47 answered 2026-09-22

- **Hosting (Q45): a managed cloud database — Azure or AWS.** Not local. The owner's reasoning: local is appealing but does not scale. Azure remains the recommendation over AWS purely because identity and mail are already going to Microsoft, so it is one fewer account, one fewer bill and one fewer identity model — but either is a defensible choice and the migration work is the same.
- **Tooling (Q46): raw SQL with a thin runner.** The 28 existing files stay as they are. No ORM.
- **Cut-over (Q47): big bang at the alpha, not domain-by-domain.** This **reverses this doc's recommendation**, deliberately and with a clear rationale from the owner: *"I want to keep editing it, and once we are ready to push it all live for the alpha we will do it all at once."* Continuing to iterate freely on the JSON backend is worth more right now than incremental migration safety, and a single switchover at a planned moment is easier to reason about than a long period where two stores are both half-authoritative.

  **What that decision costs, so it is chosen with open eyes:** a big-bang cut-over concentrates all the risk into one day, and the rollback is "go back to the JSON file and lose whatever was written to Postgres." Two things make it survivable and should be treated as requirements of this phase, not nice-to-haves:
  1. **A rehearsal.** Run the full migration against a copy, with real data volumes, and check row counts and relationships — more than once, and most importantly again shortly before the real run.
  2. **A tested restore path back to the JSON backend**, exercised during rehearsal rather than discovered on the day. `npm run backup` already exists; the point is having proven the way back, not having the file.
