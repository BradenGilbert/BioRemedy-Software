# CRM Foundation Notes

## Product direction

This first version is a conversation foundation, not the final production architecture. It makes the core workflows visible:

* Sales pipeline by environmental cleanup stage.
* Account plus physical cleanup site details.
* Account detail views for contacts, locations, previous projects, scheduled work, and opportunities.
* Contact views tied back to specific accounts and opportunities.
* Site notes, field tasks, proposal actions, and buyer follow-up.
* Offline local edits with a pending sync queue.
* Microsoft Entra ID configuration for business identity.

## Current assumptions

* An account can have one or more cleanup sites.
* Opportunities are tied to an account/site and move through Lead, Qualify, Develop, Proposal, Negotiation, and Won.
* Contacts can be associated with one or more opportunities.
* Offline work is allowed for notes, opportunity updates, account creation, contact creation, and task completion.
* Production data should live in a server database. IndexedDB is only the local offline cache.
* Microsoft Entra ID should be the source of user identity. The production API should validate tokens and enforce roles server-side.

## Microsoft identity path

The browser app includes Authorization Code with PKCE sign-in wiring for Microsoft Entra ID. To activate it, create an app registration as a single-page application and register the exact redirect URI shown in the app.

Recommended production roles to discuss:

* Sales representative: manage assigned accounts, opportunities, notes, and tasks.
* Sales manager: view team pipeline, reassign accounts, approve proposals.
* Field lead: update site visit notes, task status, and sampling details.
* Administrator: manage users, stages, required fields, and integration settings.

## Offline sync path

The app currently stores edits in IndexedDB and records a pending sync item. In production, the sync layer should add:

* Stable server IDs and local temporary IDs.
* Conflict rules for records edited by two people offline.
* Per-record version numbers or updated timestamps.
* Retry with backoff after failed uploads.
* User-visible sync errors and resolution prompts.
* Audit trail of who changed what and when.

## Data model to refine

Core records:

* Account: company, contacts, owner, industry, billing details.
* Site: address, contaminants, risk level, regulatory agency, permits, access constraints.
* Opportunity: value, stage, close date, service line, probability, proposal details.
* Activity: notes, calls, emails, site observations, attached photos or documents.
* Task: owner, due date, field or sales type, status.
* User: Microsoft object ID, email, display name, role, active status.

Possible next records:

* Contact people per account.
* Documents and proposals.
* Site samples and lab reports.
* Competitors or incumbent vendors.
* Contract terms and change orders.
* Regulatory deadlines.

## Questions for the team

1. What are the real sales stages your team uses today?
2. Does one account often have multiple active cleanup sites?
3. Which fields must be captured during a site walk?
4. What needs to work offline: notes only, full pipeline editing, photos, documents, or all of it?
5. Should Microsoft 365 integration stop at sign-in, or should we also connect Outlook email, calendar, Teams, SharePoint files, and Graph users?
6. Who should be allowed to see all accounts versus only assigned accounts?
7. What reports does management need weekly?



## Updated information

CRM \& Operations Foundation Notes

**Product direction**



This first version is a conversation foundation, not the final production architecture. It makes the core workflows visible across both sales and field operations:



Sales pipeline by environmental cleanup stage.



Account plus physical cleanup site details.



Account detail views for contacts, locations, previous projects, scheduled work, opportunities, and active field work.



Contact views tied back to specific accounts, opportunities, projects, and communication history.



Site notes, field tasks, proposal actions, buyer follow-up, material usage, equipment logs, and scope alerts.



Separate job paths for scheduled work, emergency response, and multi-stage remediation projects.



Per-project assignment roles so one person can serve as Sales Lead, Project Manager, Field Technician, or Sampler depending on the job.



Offline local edits with a pending sync queue for field notes, material logs, task completion, account/contact updates, and issue reporting.



Microsoft Entra ID configuration for business identity.



Future spatial site support for LiDAR scans, 3D site views, excavation areas, staging routes, and exclusion zones.



**Current assumptions**



An account can have one or more cleanup sites.



A site can have one or more opportunities, projects, scheduled jobs, or emergency response events.



Opportunities are tied to an account/site and move through Lead, Qualify, Develop, Proposal, Negotiation, and Won.



Won opportunities may become one of three job classes: Scheduled Work, Emergency Response, or Multi-Stage Remediation.



Emergency Response jobs may bypass the normal sales pipeline and move directly into active dispatch, field intake, and Time \& Materials tracking.



Contacts can be associated with one or more accounts, opportunities, projects, and communication records.



Users have a global identity and security profile, but their operational role should be assigned per project or job.



A person may be Sales Lead on one project, Project Manager on another, and Field Technician or Sampler on another.



Offline work is allowed for notes, opportunity updates, account creation, contact creation, task completion, material usage, equipment logging, and scope exception alerts.



Production data should live in a server database. IndexedDB is only the local offline cache.



Microsoft Entra ID should be the source of user identity. The production API should validate tokens and enforce roles server-side.



Large LiDAR or spatial files should not be stored directly in the main database. They should be stored in secure object storage with metadata linked back to the Site or Project record.



**Microsoft identity path**



The browser app includes Authorization Code with PKCE sign-in wiring for Microsoft Entra ID. To activate it, create an app registration as a single-page application and register the exact redirect URI shown in the app.



**Recommended production roles to discuss:**



Administrator: manage users, stages, required fields, integration settings, system configuration, and project reassignment.



Staff/Employee: access assigned records, complete tasks, update notes, and participate in project workflows.



Sales representative: manage assigned accounts, opportunities, notes, proposal actions, and buyer follow-up.



Sales manager: view team pipeline, reassign accounts, approve proposals, and review sales activity.



Project manager: manage active projects, field assignments, scope changes, client reporting, safety plans, and project margin visibility.



Field lead: update site visit notes, task status, equipment usage, material usage, sampling details, and field observations.



Field technician: complete assigned field tasks, log materials, check equipment in/out, and submit scope or safety alerts.



Sampler: capture sample collection details, chain of custody information, lab delivery status, and related field notes.



Read-only user: view permitted records without making changes.



***Role assignment path***



The system should separate global security roles from project-specific job roles.



**Global security role:**



Defines what the user can generally access in the system.



Examples include Administrator, Staff/Employee, Read-Only, Sales Manager, and Field Lead.



**Project assignment role:**



Defines what the user is doing on a specific job.



Examples include Sales Lead, Project Manager, Field Technician, Field Lead, Sampler, Dispatcher, or Reviewer.



This should be handled through a Project\_Assignments junction table instead of relying only on static user roles.



**This allows:**



A salesperson to act as Project Manager on a specific job.



A field employee to be assigned as Sampler on one project and Field Lead on another.



Operations to quickly reassign active work during sick days, vacations, or emergencies.



Historical project records to remain accurate while current responsibilities are rerouted.



**Reassignment example:**



If Person A is out sick, an administrator can update all active project assignment records where assigned\_role = Project Manager and user\_id = Person A, then replace them with Person B.



This should update dashboard visibility, task routing, approval responsibility, and alert notifications without changing who originally sold the job or who completed past work.



Job classification path



The CRM should not treat every won opportunity the same. Once an opportunity becomes operational work, it should follow one of three job classes:



Scheduled Work



Used for recurring maintenance, compliance sampling, monitoring, or planned microbial treatment.



**Typical features:**



Calendar or dispatcher grid.



Recurring schedule rules.



Standardized checklists.



Assigned field personnel.



Planned material usage.



Routine reporting.



Emergency Response



Used for urgent spills, releases, pipeline issues, industrial incidents, or sudden customer emergencies.



**Typical features:**



Bypasses normal sales pipeline stages.



Moves directly to active dispatch.



Requires fast mobile field intake.



Tracks labor, equipment, materials, and expenses in real time.



Supports Time \& Materials billing.



May require not-to-exceed budget tracking.



Requires immediate alerts to Project Manager, Sales Lead, and possibly dispatch.



Multi-Stage Remediation



Used for larger soil, groundwater, PFAS, PCE, hydrocarbon, or long-term bioremediation projects.



**Typical features:**



Phased milestones.



Regulatory deadlines.



Sampling events.



Change orders.



Budget tracking by phase.



Progress updates.



Site photos, documents, and possible LiDAR scan history.



Field service and logistics path



The field-facing experience should be mobile-first and simple enough for technicians using shared phones, tablets, or rugged devices in difficult site conditions.



**Key field workflows:**



Truck and asset logging.



Equipment check-out and return.



Material and consumable usage.



Task completion.



Site notes and observations.



Sampling records.



Scope exception alerts.



Safety alerts.



Equipment downtime alerts.



Photo and document capture.



Field logistics records should connect directly to the active Project or Site record.



Equipment examples:



Trucks.



Vacuum trailers.



Pumps.



Sprayers.



Tanks.



Generators.



Specialized field equipment.



Material usage examples:



Biological media.



Chemical formulas.



Carbon filters.



Drums packed.



PPE kits used.



Absorbents.



Sampling containers.



Other job-specific consumables.



This field data should be available to accounting and management so actual job cost can be compared against the original quote, Time \& Materials contract, or project budget.



Scope exception path



The app should include a high-visibility field alert button for out-of-scope conditions.



Example alert:



Site conditions out of scope. Unexpected subsurface issue or unlisted contaminant found. Work paused pending review.



When triggered, the alert should:



Create a Project Alert record.



Capture the reporting user, project, site, time, severity, and description.



Notify the assigned Project Manager.



Notify the assigned Sales Lead.



Optionally notify dispatch, safety, or management depending on severity.



Pause or flag related work tasks if needed.



Create a visible audit trail for later review.



Alert types to consider:



Scope Exception.



Safety Hazard.



Equipment Down.



Access Issue.



Weather Delay.



Material Shortage.



Customer Approval Needed.



Regulatory Concern.



Offline sync path



The app currently stores edits in IndexedDB and records a pending sync item. In production, the sync layer should add:



Stable server IDs and local temporary IDs.



Temporary local UUID generation for offline-created records.



Server-side ID reconciliation after sync.



Conflict rules for records edited by two people offline.



Per-record version numbers or updated timestamps.



Retry with backoff after failed uploads.



User-visible sync errors and resolution prompts.



Audit trail of who changed what and when.



Ability to sync notes, tasks, material logs, asset logs, alerts, contact updates, account updates, and opportunity/project changes.



Rules for when photos, documents, or LiDAR files can upload after reconnecting.



The offline boundary needs to be clearly defined. The team should decide whether offline mode supports notes only, full pipeline editing, field logistics, photos, documents, or all field workflows.



LiDAR and spatial site path



Future versions may support LiDAR or spatial data linked directly to Sites and Projects.



The goal is to give sales, project managers, and field teams a better view of the physical cleanup area without needing everyone on-site.



Possible workflow:



A field lead captures a scan using a LiDAR-capable tablet, phone, or professional scanner.



The scan file is uploaded through the app or stored in a project folder.



Supported files could include .LAS, .LAZ, .OBJ, point clouds, mesh files, or related spatial formats.



The database stores metadata, file location, scan date, site/project link, and annotations.



The actual large scan file is stored in secure object storage, not directly in the production database.



The Site Detail View may include an in-browser 3D viewer using tools such as Three.js or Potree.



Potential uses:



Map sample collection points.



Track excavation progress.



Show clients progress remotely.



Plan truck staging.



Mark exclusion zones.



Review access constraints.



Compare site conditions before and after work.



Identify field layout issues before dispatch.



Data model to refine



Core records:



Account: company, contacts, owner, industry, billing details, payment terms, active status, and historical portfolio value.



Site: address, coordinates, contaminants, risk level, regulatory agency, permits, access constraints, site notes, and LiDAR/spatial file references.



Contact: individual people tied to accounts, opportunities, projects, roles, communication history, and buyer influence.



Opportunity: value, sales stage, close date, service line, probability, proposal details, estimated budget, and linked account/site.



Project/Job: operational record created from or tied to an opportunity. Tracks job class, current status, project manager, active phase, target dates, budget, and completion status.



Project Assignment: junction table connecting users to projects with assigned roles such as Sales Lead, Project Manager, Field Lead, Technician, or Sampler.



Activity: notes, calls, emails, site observations, field updates, attached photos, and documents.



Task: owner, due date, field or sales type, priority, status, project link, and completion details.



User: Microsoft object ID, email, display name, global role, active status, and assignment history.



Field and operations records:



Equipment Log: project, site, asset tag, truck ID, equipment ID, checked-out time, returned time, condition, and user.



Material Usage: project, material type, quantity used, unit of measure, logged by user, timestamp, and related task.



Project Alert: project, site, alert type, reported by user, severity, description, status, resolution notes, and notified users.



Sample Record: project, site, sample location, sample type, collection time, collector, chain of custody, and lab status.



Spatial Data Object: site/project link, file type, storage path, scan date, uploaded by, annotations, and viewer metadata.



Possible next records:



Documents and proposals.



Site samples and lab reports.



Competitors or incumbent vendors.



Contract terms and change orders.



Regulatory deadlines.



Dispatch schedules.



Inventory or warehouse stock.



Customer approvals.



Safety plans.



Permits and compliance records.



Invoices or accounting exports.



Current technical assumptions



Production data should live in a server database.



IndexedDB should only be used as the local offline cache.



Microsoft Entra ID should handle authentication through Authorization Code with PKCE.



The production API should validate Microsoft tokens server-side.



Global permissions should be enforced server-side.



Project-specific responsibilities should be enforced through assignment records.



Offline-created records should receive temporary local IDs and later reconcile with stable server IDs.



Large files such as photos, documents, and LiDAR scans should use secure cloud object storage.



The app should store file metadata in the database and stream or download the file only when needed.



Field operations should be designed for low-connectivity environments.



Accounting and management should eventually be able to compare quoted work against actual labor, equipment, and material usage.



Questions for the team



What are the real sales stages your team uses today?



Does one account often have multiple active cleanup sites?



Should a cleanup site have multiple active jobs at the same time?



Which fields must be captured during a site walk before an opportunity can move to Proposal?



What needs to work offline: notes only, full pipeline editing, field logistics, photos, documents, LiDAR, or all of it?



Should Emergency Response jobs bypass the sales pipeline completely?



Do Emergency Response jobs need a not-to-exceed budget entered at dispatch, or should they run on open Time \& Materials until stabilized?



Who should receive immediate alerts when a field tech triggers a Scope Exception?



Should Scope Exception alerts notify only the Project Manager and Sales Lead, or also dispatch, safety, and management?



Do field techs need to track material usage against warehouse inventory automatically, or should it export to accounting later?



Which equipment needs to be tracked: trucks only, heavy equipment, pumps, trailers, tanks, tools, or all assets?



Should Microsoft 365 integration stop at sign-in, or should we also connect Outlook email, calendar, Teams, SharePoint files, and Graph users?



Should new projects automatically create folders in SharePoint or Teams?



Who should be allowed to see all accounts versus only assigned accounts?



Can one person hold multiple roles on the same project?



How should sick-day or vacation reassignment work?



What reports does management need weekly?



What reports does accounting need to compare quoted work against actual field cost?



Should LiDAR be captured by field technicians using mobile devices, or imported from professional survey/specialist scans?



How detailed does the 3D site viewer need to be in the first production version?



