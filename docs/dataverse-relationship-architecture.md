# Dataverse Relationship Architecture

This project now has a Dataverse-style relationship foundation in `crm-schema/015_dataverse_relationship_foundation.sql`.

The goal is to keep the CRM architecture compatible with Dynamics 365 Sales without forcing every Dynamics lookup into a normal SQL foreign key.

## Core Rules

1. Use Dataverse logical names as the stable model names.
   - `account`, `contact`, `opportunity`, `quote`, `salesorder`, `invoice`
   - Do not build long-term logic from display labels because labels can change.

2. Store lookup metadata explicitly.
   - Relationship definitions live in `dataverse_relationship_definitions`.
   - Table mapping lives in `dataverse_entity_map`.

3. Use two columns for polymorphic references.
   - Customer lookup: `customer_id` plus `customer_logical_name`
   - Owner lookup: `owner_id` plus `owner_logical_name`
   - Regarding lookup: `regarding_object_id` plus `regarding_object_logical_name`
   - Activity party: `party_id` plus `party_logical_name`

4. Use direct SQL foreign keys only when the target is one known local table.
   - Example: `opportunities.primary_contact_id -> contacts.id`
   - Example: `quote_lines.quote_id -> quotes.id`

5. Use relationship metadata or edge records when Dynamics allows many target types.
   - Example: `opportunity.customerid` can point to `account` or `contact`.
   - Example: `activitypointer.regardingobjectid` can point to many CRM tables.
   - Example: `annotation.objectid` can point to many note-enabled tables.

## Table Types

Every table tracked in `dataverse_entity_map` is classified with a
`table_type` column (added in `028_sales_task_activity.sql`):

- **Standard** -- owned by user, team, or org. Full relational modeling,
  joins, auditing, rules. Use case: general business entities needing full
  capabilities. Most tables are this type (`accounts`, `addresses`,
  `vendor_profiles`, `industries`, etc.).
- **Activity** -- owned by user or team only (never org). Key feature is
  time-based fields plus multi-record association. Use case: tasks,
  appointments, emails, and interactions (calls, meetings, etc.). Currently
  `activities`, `activity_parties`, and `sales_tasks`.

This migration only classifies tables already tracked in
`dataverse_entity_map` (the Dataverse-alignment layer). Most operational
tables (`work_orders`, `job_*`, etc.) were never added to that registry
either, so they are not yet classified.

## Added Foundation Tables

The foundation schema adds these model groups:

- Metadata: `dataverse_entity_map`, `dataverse_relationship_definitions`
- Generic local edges: `crm_relationship_edges`
- Owner/currency targets: `system_users`, `teams`, `business_units`, `transaction_currencies`
- Customer master extension: `customer_addresses`
- Sales process: `leads`, `opportunity_products`, `opportunity_contacts`
- Quotes/orders/invoices: `quotes`, `quote_lines`, `sales_orders`, `sales_order_lines`, `invoices`, `invoice_lines`
- Product catalog/pricing: `products`, `price_levels`, `product_price_levels`, `units_of_measure`, `unit_groups`
- Competition: `competitors`, `opportunity_competitors`
- Cross-cutting records: `activity_parties`, `annotations`, `connection_roles`, `connections`

## Existing Tables Augmented

The foundation schema augments these existing tables rather than replacing them:

- `accounts`
- `contacts`
- `opportunities`
- `activities`

Added relationship fields include Dataverse row IDs, owner references, currency references, customer references, account hierarchy, primary contact, parent customer, and activity regarding references.

## Account, Vendor, and Sales Task Extensions (026-028)

Three more migrations extend the account page and add the first dedicated
`Activity`-type table:

- `026_account_relationship_extensions.sql` -- `account_types`,
  `industries`, `account_industries` (many-to-many, an account can operate
  in more than one industry), `addresses` (account-scoped address book), and
  relationship-classification columns on `accounts`: `account_type_id`,
  `tax_address_id`, `is_client`, `is_prospect`, `is_vendor`,
  `is_subcontractor`, `eligible_for_subcontracting`, `relationship_status`,
  `primary_relationship`, `customer_status`. An account can be `is_client`,
  `is_vendor`, and `is_subcontractor` all at once. `is_client` is trigger-set
  from `customer_status` rather than hand-edited.
- `027_vendor_subcontractor_management.sql` -- `subcontractor_types`,
  `vendor_profiles` (1:1 extension of `accounts`), `service_agreements`,
  `subcontractor_assignments`, and the trigger that keeps
  `accounts.eligible_for_subcontracting` in sync with vendor compliance
  fields. `service_agreements` and `subcontractor_assignments` had no column
  spec provided and are first drafts.
- `028_sales_task_activity.sql` -- `sales_tasks`, a dedicated Dataverse
  Task-shaped `Activity`-type table. Distinct from `tasks`
  (`008_tasks.sql`, operational work-order checklist items) and from
  `activities` (`014_activities.sql`, the older generic
  Meeting/Call/Email/Task timeline table that new task work should move away
  from).

### Superseded fields

`addresses` (026) is the go-forward source for the account page's address
section. These are not dropped, but are now legacy for account addresses:

- `accounts.address_one_*`, `accounts.address_two_*`,
  `accounts.billing_address_*` (`001_accounts.sql`)
- `customer_addresses` (`015_dataverse_relationship_foundation.sql`) for
  `parent_logical_name = 'account'` rows specifically -- it is still the
  right table for contact addresses, since `addresses` is account-only.

`accounts.industry` (`001_accounts.sql`, free text) is superseded by
`account_industries` + `industries` for accounts going forward.

`vendor_profiles.default_price_level_id` reuses the existing `price_levels`
entity as the "Rate Card" concept rather than introducing a parallel one.
`vendor_profiles.service_territory` is plain text because no `territories`
table exists yet -- add one and a real lookup if territory management grows
beyond a label.

## Prototype API Progress

`server.mjs` now exposes role-gated JSON collection routes for the first Dataverse-style sales foundation:

- Ownership and catalog metadata: `businessUnits`, `systemUsers`, `teams`, `transactionCurrencies`, `unitGroups`, `unitsOfMeasure`, `priceLevels`, `products`, `productPriceLevels`
- Sales relationships: `leads`, `opportunityContacts`, `opportunityProducts`, `competitors`, `opportunityCompetitors`
- Quote-to-cash records: `quotes`, `quoteLines`, `salesOrders`, `salesOrderLines`, `invoiceLines`
- Cross-cutting Dataverse records: `annotations`, `connectionRoles`, `connections`, `activityParties`

Each collection is available through `/api/backend/{collection}` using the same `X-CRM-Role` checks as the operations, inventory, and finance prototype APIs. The default seed records are wired to the existing `acct-*`, `cont-*`, `opp-*`, and invoice IDs used by the browser prototype.

## Views

`dataverse_relationship_matrix_view`

Shows the relationship blueprint: logical table, logical column, target logical names, local table/column mapping, and whether the relationship is polymorphic.

`customer_relationship_summary_view`

Shows the main customer relationship paths across account, contact, opportunity, and opportunity-contact associations.

`sales_document_chain_view`

Shows the sales document chain from quote to sales order to invoice.

## Modeling Notes

`customerid` is not one foreign key.

It must be modeled as:

```text
customer_id UUID
customer_logical_name TEXT -- account or contact
```

`ownerid` is not one foreign key.

It must be modeled as:

```text
owner_id UUID
owner_logical_name TEXT -- systemuser or team
```

Activities should not store participants as plain contact fields. Participants belong in `activity_parties`.

Notes and attachments should not be account-only. Use `annotations.object_id` and `annotations.object_logical_name`.

Quote/order/invoice billing and shipping addresses are document snapshots. They should not be assumed to stay synchronized with account/contact addresses.

## Contact Detail Page Redesign (Browser Prototype)

The Contact detail page was rebuilt to mirror the Account detail page's
header + tabs pattern (Summary, Details, Communications, Opportunities,
Projects, Relationships, Files), replacing the old single-scroll layout and
the one large "Edit contact" dialog with panel-scoped edit dialogs (Contact
info, Personal, Communication preferences, Employment history, Role and
account, Address one, Address two) -- same approach used for the Account
page's own edit-dialog cleanup. New in this pass: `contacts.birthday`, a
`contactEmploymentHistory` collection, and an `opportunities.status`
field carrying a real `Lost` value (previously only Won/Open existed
anywhere in the app). None of these have SQL columns/tables yet -- see
`docs/database-handoff-map.md` for the prototype-only inventory note.

**Known divergence -- `activities` vs. `sales_tasks`:** the new
Communications tab's "Schedule activity" picker (Meeting / Call / Email /
Task, plus a separate Quick note) is built on the existing `activities`
collection -- the same generic Meeting/Call/Email/Task timeline table that
the note under "Account, Vendor, and Sales Task Extensions" above says *new
task work should move away from*, in favor of dedicated Dataverse-style
Activity tables like `sales_tasks`. This pass added a `Note` activity type
and per-type fields (`phoneNumber` for calls; `meetingFormat` /
`meetingPlatform` / `meetingLocation` / `meetingLink` for meetings;
`emailAddress` for emails) directly onto `activities` rather than starting
dedicated tables for each. That was the faster path for a browser
prototype, but it doubles down on the table this doc flags as legacy.
Worth a deliberate decision before this goes further: either keep
extending `activities` as the one general-purpose interaction log, or split
Meeting/Call/Email out into their own Dataverse-shaped Activity tables the
way `sales_tasks` (028) did for Task, before more UI gets built on top of
the current shape.

## Account/Contact/Opportunity Cleanup Roadmap, Rounds 1-2 (Browser Prototype)

A fresh round of user testing surfaced ~50 issues across Account, Contact, Opportunity,
Operations, and Workforce/Dispatch/Inventory, tracked as a phased roadmap (see the session's
plan file). Rounds 1-2 shipped 2026-08-17.

**Round 1 (Account/Contact):**
- `locations` (Account Facilities & Locations) moved from browser-only IndexedDB to the shared
  JSON backend, the same migration pattern used for `sampleRecords` -- see
  `docs/database-handoff-map.md` for the updated collection inventory. Gained a full structured
  address (street 1/2, city, state, postal code, country, phone, lat/long) matching the Billing
  Address dialog's field set, replacing a single flat `address`/`city` pair.
- The redundant `category: "Billing Address"` value on `locations` was retired in favor of
  `Corporate Office` / `Job Site / Field Location` / `Warehouse / Storage` / `Other`, since
  `addresses.addressType` already owns the billing-role concept -- `locations.category` now only
  describes physical facility type.
- Account creation no longer auto-creates a `contacts` row; contact creation is a separate,
  optional step.

**Round 2 (Opportunity):**
- `opportunityAssignments` gained `employeeId`, `contactId`, `vendorAccountId`, and
  `vendorContactId` fields, replacing a plain free-text `name` field. `type` (`Internal` /
  `External` / `Vendor`) now drives which of those FKs is populated: Internal resolves to an
  `employees` row, External to a `contacts` row on the opportunity's own account, Vendor to a
  two-step account-then-contact pick (any account with a `vendorProfiles` row). `name` is still
  written as a resolved display string for backward-compatible reads.
- `jobs` gained `projectManagerEmployeeId` alongside the existing free-text `projectManager`
  (still written, resolved from the employee pick, for backward-compatible reads).
- **Known-stale premise corrected:** the roadmap plan assumed `jobs.projectStage` was already
  read by the project stage-gate system and visual stage ladder. Tracing the code during
  implementation found `projectStage` is written once (project creation) and never read anywhere
  -- the visual ladder and `getMissingProjectStageFields` gate both key off free-text
  `status`/`activePhase` heuristics instead. The Create Project dialog now sets `projectStage`
  correctly (via a real `PROJECT_STAGES` select instead of hardcoding `"Intake"`), but nothing
  consumes it yet -- wiring the ladder/gate to actually read `projectStage` is still open.

**Round 4 (Workforce, Dispatch Job, Inventory), shipped 2026-08-17:**
- `laborResources` retired outright (not migrated) -- see `docs/database-handoff-map.md` for the
  full rationale and the `validateScheduleEvent` server-side fix that went with it.
- `jobResources` gained an `inventoryItemId` field (mirroring the Front-Line Material-task
  consumption path's existing `inventoryItemId` convention), plus real use of the pre-existing but
  previously-unused `assetTag` field, so desktop-assigned equipment/materials on a dispatch job are
  now genuine foreign keys instead of freeform text. A `status: "Removed"` value was added to both
  `jobAssignments` and `jobResources` as the soft-delete state for the new unassign/remove actions,
  matching the existing `"Cancelled"` convention already used for assignments.
- Dispatch Job Detail was rebuilt from one flat page into a tabbed page (Summary, Details,
  Assignment, Files & Activity), matching the Account/Contact/Opportunity/Project pattern. No new
  fields on `dispatchJobs` itself -- purely a UI reorganization plus the new Assignment-tab pickers
  above.
- **Known-stale premise corrected:** `saveDispatchSchedule` was deriving crew membership from
  `crewMemberships`, a join table never written to anywhere in the app (frozen at its 4 seed rows).
  Fixed to derive live from `employees.crewId`, the same source the Teams & Crews roster already
  used. `crewMemberships` itself was left in place (not retired) -- the plan scoped this as fixing
  the one bad consumer, not retiring the collection the way `laborResources` was retired.

## Still Needed

- Query real Dataverse metadata before production sync.
- Move local IndexedDB data toward these relationship tables.
- Add create/edit screens for leads, quotes, quote lines, orders, invoices, products, competitors, notes, connections, and activity parties.
- Add create/edit screens for the account/vendor extension layer: addresses, industries, account types, vendor profiles, service agreements, subcontractor assignments, and sales tasks.
- Migrate existing `activity_type = 'Task'` rows out of `activities` and into `sales_tasks`.
- **Future dispatch/operations work:** when job-level relationships are built (`022_jobs_dispatch_assignments.sql`), have them link to a `subcontractor_assignments` row instead of directly to `vendor_profiles`/`accounts`, so assignment-specific terms (rate, scope, dates) don't get mixed with the vendor's general standing. `job_resource_allocations.vendor_account_id` (`022_jobs_dispatch_assignments.sql:451`) is the current direct-to-account link this should eventually replace for subcontracted work. See also `docs/erp-operational-architecture.md` and `docs/database-handoff-map.md`.
- Replace the prototype JSON store with production persistence and record-level authorization.
- Decide which environmental operations tables map to Dataverse tables and which remain custom domain tables.
