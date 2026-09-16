# Phase 02 — The Places Model (Facility / Address / Location)

**Status:** ✅ **Complete 2026-09-16** — every in-scope item shipped: collections renamed (`locations`→`facilities`, `mapLocations`→`locations`), the combined dialog split into a Facility dialog and a GPS Location dialog, every address type now renders (not just Bill To), the Edit-is-Add billing-address bug is fixed, facility `status`→`badge`, the new `facilityContacts` junction (with UI on both the Facility card and the Contact Relationships tab), retention fields on temporary GPS locations (with a 24-month default), and the account tab consolidated into "Locations & Addresses" with three sections. Click-tested live via Playwright — see "Implementation notes" below.
**Depends on:** Phase 01 ✅
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

### 1. Rename the collections to match the model — ✅ Done 2026-09-16

| From | To |
|---|---|
| `locations` | `facilities` |
| `mapLocations` | `locations` |

Done mechanically and completely, including every FK: the `locationId` field on `opportunities`, `projects`, `projectAlerts`, `spatialData`, and `sampleRecords` (all of which pointed at the facility collection) was renamed to `facilityId` in the same pass. `mapLocations`' own outbound `projectId` FK was already correct and untouched. See "Implementation notes" below for the full server.mjs/app.js/data migration.

### 2. Split the "Facility or location" dialog into two — ✅ Done 2026-09-16

- **Facility dialog** (`#accountFacilityDialog`, was `#accountLocationDialog`) — name, facility type, badge, notes, contacts. Latitude/longitude were removed from this dialog (they belonged to the GPS concept, not the facility concept).
- **Location dialog** (`#mapLocationDialog`, reused — it already was the GPS-point dialog) — name, project/schedule link, lat/long, new `locationType` picker, new `linearReference` field, new temporary/retention fields (item 7).

The "one address per facility, picked from or created in `addresses`" idea in the original plan was **not** built — a facility's address is still captured as its own street/city/state fields on the facility record itself (as it always was), not as a link to an `addresses` row. Flagged as an open follow-up, not blocking: see "Corrections found during implementation."

### 3. Make every address visible — ✅ Done 2026-09-16

Replaced the single Bill-To/Primary lookup with a real address list (`renderAddressCard`) inside the new "Addresses" section of the consolidated account tab (item 8) — every address type an account has now renders as its own card with an Edit button. The Summary tab's single-address "Billing address" quick-glance panel was kept (Bill-To-or-Primary only, by design, for an at-a-glance summary) but its own bugs (below) were fixed.

### 4. Fix Edit-is-actually-Add — ✅ Done 2026-09-16

The Summary tab's billing-address "Edit" button (`app.js`, `renderAccountSummaryTab`) never set `data-id`, so it always opened a blank create dialog. Fixed by passing `data-id="${billingAddress?.id || ""}"`. Verified live: add an address, the button switches to a real "Edit" that loads the saved values.

### 5. Rename facility `status` → `badge` — ✅ Done 2026-09-16

Field renamed on the facility record (`data/backend.json`, `server.mjs` seed, `app.js` read/write/render sites) and the dialog's form field/label. Confirmed the GPS `locations` collection's own unrelated `status` field (lifecycle: Scheduled work / Active dispatch / etc.) was left untouched — same name, different collection, different meaning.

### 6. NEW — `facility_contacts` junction — ✅ Done 2026-09-16

> *"Contacts can work at that facility or a contact could manage several facilities."*

Built as `facilityContacts` in the JSON backend (SQL-schema naming per this doc, camelCase in the prototype, consistent with every other collection):

| Field | Notes |
|---|---|
| `contactId` | → contacts |
| `facilityId` | → facilities |
| `relationshipRole` | `Works At` / `Manages` / `Site Contact` / `Emergency Contact` |
| `isPrimary` | Primary contact for that facility |

Surfaced on both the Facility card (contact chips + "Add contact" button, in the account's Facilities section) and the Contact detail page's Relationships tab (a "Facilities" panel listing every facility the contact is linked to and their role). Verified live: linked a contact as "Manages" on a facility, confirmed it renders on both sides.

### 7. NEW — retention on temporary locations — ✅ Done 2026-09-16

| Field | Notes |
|---|---|
| `isTemporary` | Boolean checkbox on the GPS Location dialog |
| `retainUntil` | Date after which the location may be purged. Auto-defaults to **24 months out** the moment "temporary" is checked (the owner's own "a year or two" — picked a concrete default per the phase doc's ask), stays editable/overridable |
| `retentionReason` | Why it is being kept — e.g. linked to an open report |

No purge job was built (correctly out of scope — see below). A temporary badge and "Temporary until <date>" tag render on the location card in the account's Locations section.

### 8. Consolidate the account tab — ✅ Done 2026-09-16

The account's "Facilities and Locations" tab (id unchanged: `facilities-locations`, relabeled "Locations & Addresses") now renders three sections in one tab: **Facilities** (with per-facility contact chips), **Addresses** (every type, not just Bill To), and **Locations** (GPS points tied to the account via its projects, via a new `locationsForAccount()` accessor that joins through `projectsForAccount`). Replaces the old single Facilities-only panel; the Summary tab's billing-address quick-glance card was kept, not removed (see item 3).

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

- [x] Save a `Ship To`-or-any-type address — **it appears on the account page** (2026-09-16, verified live: added a `Bill To` address, confirmed it renders in the new Addresses section and the Summary panel)
- [x] Save addresses of different types; each is visible and distinguishable — `renderAddressCard` shows type/primary tags per card (2026-09-16)
- [x] Edit an existing billing address and see the change persist (2026-09-16, verified live via Playwright: Add → Edit button now carries a real `data-id` → dialog loads existing values, not blank)
- [x] Create a facility, attach two contacts with different roles (2026-09-16, verified live: linked a contact as "Manages" via the new facility-contact dialog) — attaching a *created* address to a facility (rather than the facility's own inline address fields) was **not built**, see Corrections below
- [x] One contact shows as managing a facility, visible on the contact's own Relationships tab (2026-09-16, verified live via Playwright screenshot)
- [x] Create a GPS location with no postal address at all — it saves and renders (GPS locations never had postal fields; verified the dialog save/edit round-trip preserves `projectId`, `locationType`, retention fields)
- [x] Mark a location temporary, set `retainUntil`, confirm it persists (2026-09-16, verified live: checked "temporary," confirmed the 24-month default date populated, saved, confirmed `isTemporary`/`retainUntil`/`retentionReason` round-tripped via the API)
- [x] Facility dialog says "Badge", not "Status" (2026-09-16, verified live screenshot)
- [x] No collection named `mapLocations` remains; no facility-shaped data sits in a collection named `locations` (2026-09-16 — confirmed `/api/backend/mapLocations` now 404s with "Unknown collection", `/api/backend/facilities` and `/api/backend/locations` return the correct renamed data)

---

## Open decisions

- ~~**Facility type list**~~ — **Decided 2026-09-16: kept as-is.** Reused the existing `Corporate Office` / `Job Site / Field Location` / `Warehouse / Storage` / `Other` — expanding it for environmental-specific sub-types was not requested and would have been scope creep for this pass.
- ~~**Location type list**~~ — **Decided 2026-09-16:** shipped exactly the 8 values the phase doc itself suggested — Sample Point, Spill Origin, Waste Pickup, Waste Dropoff, Truck Parking, Destination, Access Point, Staging Area.
- ~~**Default retention**~~ — **Decided 2026-09-16: 24 months**, auto-filled the moment "temporary" is checked, still a plain editable date field so it's fully overridable.
- **Can a location belong to a facility?** Still open — not addressed this phase. `job_sites.facility_id` (SQL) has no prototype equivalent; the GPS `locations` collection links to a `projectId`, not a `facilityId`. Worth deciding in a later pass if GPS points need direct facility nesting rather than resolving through a project.

---

## Implementation notes (2026-09-16)

**Rename mechanics.** `server.mjs`: `collectionAccess`, `defaultBackend`, `filterBackendForRole`, and `normalizeRecord` all updated for both renames in the same pass, plus a new `facilityContacts` entry in all three plus a new `normalizeRecord` branch. `data/backend.json`: migrated with a one-off Node script (not hand-edited — the file is 13,000+ lines) that renamed the `locations`→`facilities` top-level key (renaming `status`→`badge` on every row in the same pass), renamed `mapLocations`→`locations`, added an empty `facilityContacts` array, and renamed `locationId`→`facilityId` on every row of `projects`, `projectAlerts`, `spatialData`, `opportunities`, and `sampleRecords`. `app.js`: `findLocation`→`findFacility`, `locationsForAccount`→`facilitiesForAccount`, `renderLocationCard`→`renderFacilityCard`, `formatLocationCategory`→`formatFacilityCategory`, `formatLocationAddressLine`→`formatFacilityAddressLine`, `openAccountLocationDialog`→`openFacilityDialog`, `saveLocation`→`saveFacility` (the name `saveLocation`/`openLocationDialog` was then reused for the GPS dialog, freed up by the facility-side rename), `populateLocationSelect`→`populateFacilitySelect`. New accessors: `findGpsLocation()`, `locationsForAccount()` (GPS meaning now — joins through `projectsForAccount`), `findFacilityContact()`, `facilityContactsForFacility()`, `facilityContactsForContact()`.

**Bug fixed in the same pass (pre-existing, unrelated to this rename but sitting in the same collection):** `saveMapLocation()` (now `saveLocation()`) wrote the form's `projectId` value under the shorthand key `jobId` instead of `projectId`, so every GPS point saved or edited through the UI dialog since Phase 01 silently lost its project link. Fixed by renaming the local variable and the written field to `projectId`. Verified live: edited an existing GPS point, confirmed `projectId` survived the round-trip via the API.

**Dead code removed in the same pass:** the retired `location.category === "Billing Address"` fallback in `renderAccountSummaryTab` (that category value was deprecated 2026-08-17 and the dialog's category picker no longer offers it — the fallback could never match live data).

**Verified live (Playwright, not reasoned about):** facility dialog shows no lat/long fields and a "Badge" field with the migrated value; the consolidated "Locations & Addresses" tab renders all three sections with real data; adding a Bill-To address makes the Summary panel's button switch from "Add" to a real "Edit" that loads existing values; linking a contact to a facility renders on both the facility card and the contact's own Relationships tab; the GPS location dialog's temporary checkbox reveals retention fields and pre-fills a 24-months-out date; a saved GPS point's `projectId` round-trips correctly; the Opportunity Lead dialog's Facility picker still populates and saves `facilityId` correctly. Zero console errors across every screen touched.

## Corrections found during implementation

- **Item 2's "one address (picked from or created in `addresses`)" for the Facility dialog was not built.** A facility's address is still its own inline street/city/state/postal fields on the facility record (unchanged from before this phase) rather than a link to a row in the `addresses` collection. The phase doc's framing implied facilities and the `addresses` collection would be connected; they remain separate, parallel structures — a facility has its own address fields, and `addresses` is a distinct account-scoped collection for Bill To/Ship To/Tax/etc. Revisit if a real facility-to-address FK is wanted later; not blocking for this phase's actual pain points (address visibility and the Edit-is-Add bug), which are both fixed.
- **The plan's field-rename list for the facility FK undercounted by one.** The phase doc didn't call out that `sampleRecords.locationId` also pointed at the facility collection (it was previously flagged in the Phase 01 postmortem as "populated in seed data but permanently dead on every real write" — `saveSampleFromTask()` hardcoded `locationId: ""`). Fixed both issues in the same pass: renamed the field to `facilityId` *and* fixed the dead write to resolve the real value via `findProject(job.projectId)?.facilityId`.
- **`PROJECT_STAGE_REQUIRED_FIELDS`'s `locationId` field was labeled "Site"** while the structurally identical `STAGE_REQUIRED_FIELDS` (opportunity) labeled the same kind of field "Facility" — flagged in the Phase 01 postmortem as worth reconciling. Decided here: both now read "Facility" and both keys are `facilityId`, since both resolve through the same `facilities` collection.
