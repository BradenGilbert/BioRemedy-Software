# Sample data plan — what every section should contain

**Written 2026-09-25**, after the owner pointed out that the first rebuild left whole sections empty (locations, facilities, addresses, bill-to…). This is the checklist the generator (`scripts/rebuild/`) is built against. `docs/sample-data.md` describes the resulting set; this file says what *should* be there, screen by screen, so nothing is forgotten when the set is redone after Front Line 2.

**Rule:** every panel a user can open should show something realistic, and every record should be reachable from at least one other record (an account's facility has contacts, a job's photos hang off an action, an invoice line points at a rate-sheet product). "Empty by design" needs a reason in the table.

## Sales

| Screen / panel | Collections | Target | Status |
|---|---|---|---|
| Accounts list, quick filters | `accounts`, `accountIndustries`, `accountRelationshipExtensions` | 16 customers + 4 vendors + 1 insurer, every one with an industry, type, rating, owner | Done |
| Account › Summary (owner, primary contact, AP contact, PO rules) | `accounts` (`primaryContactId`, `apContactId`, `poRequired`, `poFormat`) | Every customer has a primary contact; municipal/industrial ones require a PO | Done |
| Account › Locations & Addresses › Facilities | `facilities` (with lat/lng, category, badge, access, risk) | At least one facility per customer, two for the big accounts, none for the insurer | **Added 2026-09-25 (extras)**: Alamo plant, Sunbelt plant, Georgetown Fire Station 1, Permian field office |
| Account › Locations & Addresses › Addresses | `addresses` (`Primary`, `Bill To`, `Ship To`, `Remit-To`, `Vendor Dispatch`, `Vendor Billing`, `Tax`) | Every customer: Primary + Bill To; shipping for the ones that receive material; vendors: Remit-To + Vendor Dispatch + Vendor Billing; a Tax address on the two industrial accounts | **Added (extras)** — 40+ addresses |
| Account › Billing address panel | `addresses` type `Bill To` | Every account with an invoice has one | **Added (extras)** |
| Account › Contacts, facility contacts | `contacts`, `facilityContacts` (works-at / manages) | 1–3 contacts per account, each facility with a manager | Contacts done; **facility contacts added (extras)** |
| Account › Divisions | `accountDivisions`, `contacts.divisionId` | Divisions on the municipal and industrial accounts, contacts filed under them | **Added (extras)** |
| Account › Comments | `accountComments` | A working note on every active customer and vendor | **Added (extras)** |
| Account › Lab Work | `sampleRecords` via projects | Lone Star, HCH, Permian | Done |
| Account › Vendor & Subcontractor | `vendorProfiles`, `serviceAgreements`, `subcontractorAssignments`, `accountApprovedSubcontractors`, vendor `documentRequirements` | 4 vendors with profiles, COI expiry, one subcontractor assignment, one customer approval | Done; **vendor form documents added (extras)** |
| Account › Files / Paperwork | `documents`, `documentRequirements` | Customer packet on file (Approved, with the PDF) for every active customer; Sent / In review on the ones still negotiating | **Added (extras)** using the two packet/vendor PDFs in `docs/uploaded files` |
| Contact › Details, Relationships, Communications | `contacts`, `contactEmploymentHistory`, `connections`, `activities`, `activityParties` | Employment history on the decision makers, connections (budget owner / technical evaluator) on the two industrial deals, meeting attendees as activity parties | **Added (extras)** |
| Pipeline, Sales Race | `opportunities` (stage, closeBand, forecast), `opportunityContacts`, `opportunityLocations`, `opportunityAssignments`, `opportunityCompetitors` | One open deal per stage + a loss, every won deal behind a project | Done |
| Opportunity › Develop & Planning (needs, site walk, scope) | `opportunities.{equipment,vendor,resource}Needs`, `scheduleEvents` site_walk, `documents` site photos | Generic needs from Develop onward; one scheduled site walk; site-walk photos on two deals | Done |
| Opportunity › Proposal & Documents | `quotes`, `quoteLines`, `estimates`, `estimateLines`, `opportunityProducts`, `documentRequirements`, `annotations` | Estimate → quote on the Proposal deal, quotes on Negotiation and every won multi-day deal, products on the quoted deals, a note on each quote | Quotes done; **products, annotations, sales orders added (extras)** |
| Leads | `leads` | Two raw leads (one open, one qualified into the Alamo deal) | **Added (extras)** |
| Sales tasks / tasks | `salesTasks`, `tasks` | Task board with due dates across the team; a few sales tasks | Tasks done; **sales tasks added (extras)** |
| Competitors | `competitors`, `opportunityCompetitors` | 3 competitors, 2 linked | Done |

## Operations

| Screen / panel | Collections | Target | Status |
|---|---|---|---|
| All Projects, per-class views, calendar, map | `projects` (jobClass, projectStage, status), `locations`, `facilities` lat/lng | 11 projects across Intake / Plan / Mobilize / Field Work / Closeout; every facility mapped | Done; **facility coordinates completed (extras)** |
| Project › Intake (generator, insurance, emergency fields, weather) | `projects.*`, `weatherSnapshots` incident + response | Emergency projects carry the spill-call fields, insurance on the claim job, both weather snapshots | Done |
| Project › Plan (needs from sales, assignments, scheduled work, job requests) | `projectAssignments`, `scheduledWork`, `jobRequests` (+ `jobRequestDocuments`) | Every project has a sales lead + PM; requests converted or New | Done; **request documents added (extras)** |
| Project › Live (dispatch jobs, alerts, waste, spatial) | `dispatchJobs`, `projectAlerts`, `wasteRecords`, `spatialData`, `permits` | Alerts open on the in-progress project; waste under the 10-day permit; the LiDAR scan on Lone Star | Done |
| Project › Sampling | `sampleRecords`, `sampleResults`, `sampleLabReports`, sample-action photos | Every sample has three photos; results + report file where the lab has reported; two exceedances | Done |
| Project › Files / Report | `documents`, `jobTaskAttachments`, `dailyNarratives`, `postJobReview` | Field photos, narratives and the review on every closed job | Done |
| Dispatch intake / jobs / board / calendar | `jobRequests`, `dispatchJobs`, `jobAssignments`, `jobScheduleSegments`, `jobStatusEvents` | 12 jobs at draft / dispatched / scheduled / in-progress / closed | Done |
| Dispatch conflicts | `jobConflicts` | One open (credential expiring on a crew member) and one resolved | **Added (extras)** |
| Job › Plan & resources | `jobSteps`, `jobActions`, `jobResources` (equipment + materials), subcontractors | Work plan from the template, resources on every job | Done |
| Job › Messages | `messages` (job threads + `general`) | Crew ↔ dispatch on the active jobs, two general-channel posts | Done |
| Job › Files & Activity | `jobFormSubmissions`, `jobTaskAttachments`, `timeEntries`, `jobMileageEntries`, `jobExpenses` | Timer, checklist, signature, photo submissions; receipts on the travel jobs | Done; **expenses added (extras)** |
| Templates | `jobTypeTemplates` | Five real templates, test tasks removed | Done |

## Workforce, inventory, office, finance

| Screen / panel | Collections | Target | Status |
|---|---|---|---|
| Directory, credentials, teams & crews, availability, standby, devices | `employees`, `employeeCertifications`, `workforceTeams`, `workforceTeamMemberships`, `crewProfiles`, `availabilityBlocks`, `standbyAssignments`, `frontlineDevices` | The real six, realistic certs with one expiring and one expired, one crew, weekend on-call | Done |
| Consumables, stock movements, purchase orders, alerts | `inventoryItems`, `inventoryMovements`, `purchaseOrders`, `inventoryAlerts`, `equipmentRestockItems` | Every item on a rate line; a ledger that explains `onHand` (opening count, receipts, field usage) | Items done; **ledger added (extras)** |
| Equipment, maintenance | `equipmentAssets`, `equipmentMaintenanceRecords`, `equipmentLogs` | 21 assets on rate lines, one on hold, checkout logs from every job | Done |
| Office › Alerts / Compliance / Schedule | `notifications`, `documentRequirements`, `employeeCertifications`, vendor COI, `scheduleEvents` | Alerts for the blocked spill call, PO release, lab results, expiring cert, expiring COI | Done |
| Finance › Invoices / QuickBooks | `invoices`, `invoiceLines`, `qboExports`, `salesOrders`, `salesOrderLines` | Paid / Sent / Draft invoices itemized from the rate sheet; sales orders behind the accepted quotes | Invoices done; **sales orders added (extras)** |
| Identity › Users, IT messages | `systemUsers`, `itMessages` | The real logins; IT messages are **real, never generated** — carried over by the rebuild | Done |
| Client portal (Georgetown login) | scoped reads of the above | Georgetown has projects, spills, documents, contacts | Done |

## Empty by design

| Collection | Why |
|---|---|
| `gpsConsents` | Append-only, written only by the server when a worker accepts the terms on a personal phone; the generic API refuses writes. |
| `laborAssignments` | Never used by the app (0 rows before the rebuild too). |
| `sampleResults` on pending samples | The lab has not reported; results arrive with the report. |
| Phase 21 collections (`jobSafetyBriefings`, `jobEquipmentUsage`, `formTemplates`, `siteWalkReports`, `siteWalkObservations`, `siteReferenceLayers`, `jurisdictions`, `libraryItems`, `libraryAcknowledgements`, `ergMaterials`, `ergGuides`, `ergDistances`) | Registered 2026-09-25 by the Front Line 2 workstream; their shapes are still being built. Seed them when that phase ships — the owner expects to redo the sample set then. |
| Signed quotes, COIs, W-9s as files | No real or sample files exist for these; the requirements carry the status without a file. The two PDFs we do have (customer packet, vendor form) are attached wherever they fit. |
