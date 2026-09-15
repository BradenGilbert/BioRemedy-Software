# Phase 02 — The Places Model (Facility / Address / Location)

**Status:** Not started
**Depends on:** Phase 01
**Estimated sessions:** 2–3
**Unblocks:** Phase 03 (Create Account captures a primary address), Phase 04 (vendor dispatch/billing addresses)

---

## Why this phase exists

Five overlapping concepts are currently doing the job of three:

| Today | Really is |
|---|---|
| JSON `locations` (6 rows) — dialog titled *"Facility or location"* | **Facility**, with Location duty bolted on |
| JSON `mapLocations` (4 rows) | **Location** (GPS) |
| JSON `addresses` (**0 rows**) — full correct dialog exists, writes fine | **Address** — but almost nothing renders |
| SQL `customer_addresses` | Contact addresses (still valid) |
| Legacy `accounts.billing_address_*`, `address_one_*`, `address_two_*` | Superseded flat columns |

**The good news:** `crm-schema/` already models all three correctly. The prototype drifted. This phase is mostly *realignment*, not new design.

---

## The model (locked 2026-09-15, in the owner's own words)

### FACILITY — a physical place where work can happen
> *"A facility is a physical place where work can happen, it has one address, and contacts can work at that facility or a contact could manage several facilities. A facility implies a structure or yard."*

- Target table: **`facilities`** (`crm-schema/003_facilities.sql`) — already exists
- Has exactly **one** address
- Many-to-many with contacts: works-at / manages

### ADDRESS — a postal record
> *"Addresses are also locations for offices, like Bill-To, Ship-To, etc. These utilize postal codes, street names, and have a contact person or info. There is a reason for an address to exist — it could be a facility, or it could be the nearest address to a spill."*

- Target table: **`addresses`** (`crm-schema/026`) — already exists with the correct `address_type` enum and an `address_contact_id`
- Exists for a **reason** (its type). Billing, shipping, and tax *require* this structure.

### LOCATION — a GPS point
> *"Locations can be GPS coordinates, they are not tied to postal boxes. They are given to crews to identify the exact location a sample was taken, a spill is located, waste was picked up or left, a truck is parked, a destination, etc."*

- Target table: **`job_sites`** (`crm-schema/005`) — already has `latitude`/`longitude`, `linear_reference` (highway mile markers), and `is_temporary`
- > *"Some locations should be tied to the account forever and some should not be. A sample that is collected once, we will need to notate its location in the auto-generated spill report, but beyond a year or two we won't want to keep that record."*

**The rule:** Everything can have a *location*. Only things that get mailed, billed, shipped, or taxed need an *address*. Only places where work physically happens are *facilities*.

---

## In scope

### 1. Rename the collections to match the model

| From | To |
|---|---|
| `locations` | `facilities` |
| `mapLocations` | `locations` |

Do this mechanically and completely. A half-rename is worse than either state.

### 2. Split the "Facility or location" dialog into two

The dialog at `index.html:3599` (`data-form="account-location"`) currently serves both concepts — which is precisely why it is confusing.

- **Facility dialog** — name, facility type, **one address** (picked from or created in `addresses`), badge, notes, contacts
- **Location dialog** — name, location type, lat/long, `linear_reference`, temporary vs permanent, retention

### 3. Make every address visible

`app.js:4755` currently does:

```js
const billingAddress = addresses.find(a => a.addressType === "Bill To") || addresses.find(a => a.isPrimary);
```

Only one address is ever surfaced. Everything else saved through `addressDialog` writes successfully to the backend and **renders nowhere** — this is the "any address type other than Bill To makes the address invisible" problem.

Replace with a real **address list** showing all types, grouped or filterable.

### 4. Fix Edit-is-actually-Add

The billing address "Edit" button opens a blank create dialog. There is currently **no way to edit an existing billing address.** Wire Edit to load the record.

### 5. Rename facility `status` → `badge`

Per the owner's request. Field rename on the facility record plus every render site.

### 6. NEW — `facility_contacts` junction

> *"Contacts can work at that facility or a contact could manage several facilities."*

**No such junction exists anywhere** — not in `crm-schema/`, not in the prototype. `contacts` has no facility reference at all.

| Column | Notes |
|---|---|
| `contact_id` | → contacts |
| `facility_id` | → facilities |
| `relationship_role` | `Works At` / `Manages` / `Site Contact` / `Emergency Contact` |
| `is_primary` | Primary contact for that facility |

Surfaced on both the Facility panel and the Contact detail page.

### 7. NEW — retention on temporary locations

`is_temporary` exists. A retention rule does not (the only `retention` reference in the whole schema is in Front Line device sync).

| Field | Notes |
|---|---|
| `retain_until` | Date after which the location may be purged |
| `retention_reason` | Why it is being kept — e.g. linked to an open report |

**Do not build the purge job in this phase.** Capture the intent in data; automate later. A location referenced by an un-archived report must never be silently purged.

### 8. Consolidate the account tab

One tab — *"Locations & Addresses"* — with three clear sections: Facilities, Addresses, Locations. Not two competing panels with overlapping dialogs.

---

## Out of scope

- Purge automation for expired locations (capture `retain_until`; act on it later)
- Map/GIS work beyond what already exists
- Contact addresses — `customer_addresses` stays as-is; `addresses` is account-scoped only
- Dropping the legacy `accounts.*_address_*` columns. Mark deprecated, migrate reads, drop in Phase 08.

---

## Data model changes

**New:** `facility_contacts`; `locations.retain_until` + `retention_reason`
**Renamed:** `locations` → `facilities`; `mapLocations` → `locations`; facility `status` → `badge`
**Newly used:** `addresses` gets real UI and real rows for the first time

Update `docs/database-handoff-map.md` and `docs/dataverse-relationship-architecture.md` in the same session.

---

## Verification / done criteria

- [ ] Save a `Ship To` address — **it appears on the account page** (today it vanishes)
- [ ] Save one address of every type; all eight are visible and distinguishable
- [ ] Edit an existing billing address and see the change persist (today: impossible)
- [ ] Create a facility, attach an address to it, attach two contacts with different roles
- [ ] One contact shows as managing two different facilities
- [ ] Create a GPS location with no postal address at all — it saves and renders
- [ ] Mark a location temporary, set `retain_until`, confirm it persists
- [ ] Facility dialog says "Badge", not "Status"
- [ ] No collection named `mapLocations` remains; no facility-shaped data sits in a collection named `locations`

---

## Open decisions

- **Facility type list** — reuse the existing `Corporate Office` / `Job Site / Field Location` / `Warehouse / Storage` / `Other`, or expand for environmental work (treatment yard, transfer station, monitoring well cluster)?
- **Location type list** — needs defining: Sample Point, Spill Origin, Waste Pickup, Waste Dropoff, Truck Parking, Destination, Access Point, Staging Area?
- **Default retention** — the owner said "a year or two." Pick a concrete default (24 months?) and make it overridable.
- **Can a location belong to a facility?** `job_sites.facility_id` already allows it. Confirm the UI should expose that nesting.

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*
