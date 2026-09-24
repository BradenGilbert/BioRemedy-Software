# Phase 13 — Document Storage

**Status:** **Shipped 2026-09-24 (sprint Wave 7)** — the generic document store, every Files tab, the document-type catalog with the two supplied PDFs as fixed forms, the requirement → instance → review → gate model, vendor paperwork (Phase 04 items 8/9/12), site photos (06/15), emergency onsite paperwork (16), and the Client Portal scoped server-side. Left: SharePoint links for bulk material, e-signature/delivery (Phase 19), PDF form-filling of Republic's form (the fields are captured; the PDF is not written).
**Depends on:** Phase 12 (documents must be access-controlled from day one, not retrofitted) — 12a shipped first, and every document route rides on its sessions.
**Estimated sessions:** 2
**Gate:** Last phase before the Pilot Milestone.

---

## Why this phase exists

Every **Files** tab in the CRM is an empty stub. Account, Contact, Opportunity — all of them display an empty state and have nothing behind them.

Meanwhile a real upload path already exists and works: job-request documents and Front Line task attachments (photos, signatures) write to disk under `data/uploads` with metadata in the JSON backend (`jobRequestDocuments`, 3 rows; `jobTaskAttachments`, 4 rows).

So the capability is proven — it is just wired to two places instead of everywhere.

By pilot, real users will try to attach a certificate of insurance, a signed quote, a lab report, or a site photo to an account. Today all of those fail silently.

Phases 04 and 02 both defer file work here: vendor compliance certificates, customer approval letters, and facility documents all need this.

---

## In scope

> **Sequencing (2026-09-23, from Phase 20's review):** build the **document requirement → instance → review → stage gate** model from the 2026-09-22 feedback pass *first*, and the generic store + Files tabs second. The store is proven by four working upload routes; the workflow is what unblocks Phase 04's vendor compliance and Phase 06's Negotiation gate.

### 1. Generic entity-attachment store

One store that any record can hang a file on, replacing per-feature upload paths.

| Field | Notes |
|---|---|
| `entity_type` / `entity_id` | Polymorphic — follows the Dataverse pattern already used by `annotations.object_id` + `object_logical_name` |
| `file_name`, `content_type`, `size` | |
| `storage_path` | |
| `hash` | Deduplication and integrity |
| `version` | `docs/database-handoff-map.md` Priority 0 explicitly calls for file versions |
| `uploaded_by`, `uploaded_at` | |
| `visibility` | Internal / customer-visible — matters for the Client Portal |
| `retention_until` | Mirrors the Phase 02 retention concept |

**Use the existing `annotations` pattern** rather than inventing a parallel polymorphic scheme — `docs/dataverse-relationship-architecture.md` is explicit that notes and attachments should not be account-only.

### 2. Wire every Files tab

Account, Contact, Opportunity, Project, Facility. One component, used everywhere.

### 3. Access control from the start

Phase 12 closes the un-gated attachment route. This phase must not reopen it:
- Every file request is authorized against the parent record
- No security-by-opaque-ID
- Customer-visible vs internal-only is enforced server-side

### 4. Account logo upload

Small, and it makes the CRM feel real. Was raised in the 2026-09-02 scoping questions.

### 5. Tagged document/forms archive, scoped by opportunity stage

> *"Negotiation sign-off panel on proposal & Documents. We need to have a way to send new account paperwork or send forms to associated contacts via email using established forms. I don't think we need to integrate the email or outlook function just yet, but we need to have a form or documents archive that has documents tagged with certain tags that allow us to pull only documents or forms relevant to that stage."*

Built on top of item 1's generic attachment store: a library of reusable forms/templates (not per-record uploads), each tagged so a stage (Negotiation, Proposal, etc.) can pull only the documents relevant to it. Explicitly **not** email/Outlook integration yet — the note is clear that sending happens some other way for now (manual download/attach is fine at pilot scale). Sales materials and literature (mentioned in the same note) belong in the same tagged library, not a separate system — see the open decision below on SharePoint/Teams.

---

## Out of scope

- **Cloud object storage** (S3/Azure Blob). Local disk is fine for pilot scale. `docs/crm-foundation.md` is right that large files eventually belong in object storage — but that is a Phase 14+ concern, and the schema above is written so the storage backend can change without a data migration.
- **LiDAR / point clouds / 3D viewers.** `spatialData` holds metadata; the viewer already exists for what it supports. Not yet slotted into a stage.
- **SharePoint / Teams integration.** Not yet slotted into a stage. The 2026-09-16 notes raise this again directly (*"I believe we may still use sharepoint and teams for this, but I need to figure out to what extent we want to continue our integration with that vs our own file sharing system"*) — this is an open product decision, not just a deferred build; see below.
- **E-signature / Docusign integration.** Raised explicitly: *"For sending sign-offs and getting them back we might want to look at integrating with Docusign or something similar... We send it via email, they sign via a portal... then it returns to us and notifies the team members and/or sales team then automatically updates the CRM that it has been signed/approved."* This is a substantial integration (or a custom-built signing portal, per the note's own "maybe a local custom built one, who knows") layered on top of item 5's document archive — track as a not-yet-slotted follow-on once item 5 exists, not part of reaching the Pilot Milestone.
- Full-text search inside documents.
- Retention *automation* — capture `retention_until`; act on it later.

---

## Data model changes

New: generic entity-attachment table (or a genuine extension of the existing `files` table — `crm-schema/012_files.sql` exists but `docs/database-handoff-map.md` states plainly that it "is not sufficient for production").

Decide early: extend `files` or supersede it. **Recommendation: extend.** A second file table repeats the exact mistake this roadmap keeps unwinding.

---

## Verification / done criteria

- [x] Upload a PDF to an account's Files tab; it persists across a reload and is visible to a second user *(2026-09-24: second session sees it)*
- [x] Upload the same file twice — the hash catches the duplicate *(409 "That exact file is already attached", per record)*
- [x] Attach a certificate of insurance to a vendor profile (Phase 04's deferred dependency) *(COI requirement → upload → In review → Approve with a valid-until date; the vendor profile's insurance status and expiry are written by the approval)*
- [x] Attach a customer approval letter to an `account_approved_subcontractors` row *(sets `evidenceDocumentId`, linked on the card)*
- [x] Mark a file internal-only; confirm a Client Portal role cannot retrieve it **via direct URL**, not just via hidden UI *(403 for an internal file, 403 for another account's file, 200 once shared)*
- [x] Upload a new version of an existing file; both versions are retrievable *(v1 and v2 both download)*
- [x] Signed-out file request is refused *(401)*
- [x] Account logo displays on the account header
- [x] A form tagged for the Negotiation stage can be pulled up from the Negotiation stage and no other *(the Negotiation panel's picker offers exactly the packet and the waste authorization; the account-level picker offers the full customer set)*

---

## Open decisions

- **Extend `files` or supersede it?** Recommendation: extend.
- **Size limits and allowed types?** Field photos and lab PDFs are the common cases; LiDAR is explicitly excluded here.
- **Does the Client Portal ship in pilot?** If yes, the visibility rules above are load-bearing. If no, build the field but defer enforcement testing.
- **SharePoint/Teams vs. this system's own file sharing** — the owner has explicitly not decided whether to keep using SharePoint/Teams for sales materials or fold everything into this CRM's own storage. Needs a real decision before item 5's sales-materials scope is finalized; don't build a migration off SharePoint speculatively.

---

## Corrections found during implementation

- **2026-09-24 — what shipped.** Three collections: `documents` (polymorphic `entityType`/`entityId`, `accountId` for the portal scope, `sha256`, `groupId` + `versionNumber`, `visibility` internal|customer, `documentTypeId`, `requirementId`), `documentTypes` (14 seeded, self-healing; `kind` external-form|upload, `counterparty`, `appliesTo`, `stageGate`, `requiresReview`, `expiryDays`, `templateFile` for the two supplied PDFs or `templateDocumentId` for an uploaded template, `formFields` for Republic's form), and `documentRequirements` (`status` Not started → Sent → Returned → In review → Approved | Rejected, `currentDocumentId`, `reviewedBy/At`, `reviewNote`, `expiresAt`, `formData`, `source`). Routes: `POST /api/documents` (raw body + headers), `GET /api/documents/{id}/view|download`, `GET /api/document-types/{id}/template`; requirement writes go through the generic route with a server-side lifecycle guard (`normalizeRequirementWrite`: "In review" only from an upload, Approved/Rejected only from Admin, Office Manager, Sales Manager or Operations Manager).
- **`files` extended, not superseded — but as a JSON collection, not `crm-schema/012_files.sql` yet.** The SQL table gets rewritten in Phase 14 to this shape (the handoff map has the column list). The three per-feature stores that already worked (`jobRequestDocuments`, `sampleLabReports`, `jobTaskAttachments`) were **left in place**: migrating binary metadata mid-sprint was more risk than value, and the Files tabs and the project's Sampling tab still show them. Fold them into `documents` in the Phase 14 migration.
- **"Fill" for Republic's form means capturing the fields, not writing the PDF.** `requirement.formData` holds the generator/agent fields and the Republic profile number (Q19), prefilled from the account; the blank form downloads from `docs/uploaded files/` (served by an authenticated API route, never the static branch) and the signed scan comes back as the instance. Writing the AcroForm fields into the PDF needs a PDF library, which the zero-install rule rules out for now.
- **Approval side effects live on the server** (`applyRequirementApproval`): a COI stamps the vendor profile's `insuranceStatus`/`insuranceExpiration`, a W-9 its `w9Status`, the customer packet marks the account's opportunities `accountPaperworkStatus: "Signed"` (the Won gate). The Negotiation gate itself reads approved, unexpired requirements (`paperworkApproved`). The project's Intake paperwork flag reads the same requirements when they exist and falls back to the old job-request heuristic when they don't.
- **Client Portal (Q21):** a portal user is a `systemUsers` row with role `Client Portal` and a `clientAccountId`; the session carries it and `filterBackendForRole` returns `portalView()` — the customer's own account, contacts, facilities, projects, alerts, samples, schedule, customer-visible documents and customer-counterparty requirements, nothing else, with employees and every other collection empty and the collection routes 403. Customers can download blank forms and upload signed copies against their own requirements (always customer-visible); they cannot write anything else. An administrator previews the portal as any account from the dashboard.
- **Not built:** SharePoint links for bulk material (Q20's other half — a URL field is trivial once the SharePoint decision is made), sending documents (Phase 19), e-signature, retention automation, full-text search.

---

# 2026-09-22 feedback pass

**Source:** `docs/roadmap/notes-2026-09-22.md` item 21. **Status:** Not started. This pass turns this phase from "attachment storage" into "attachment storage **plus** a document sign-off workflow" — the second half is the larger build.

### Customer paperwork as a tracked, gating workflow

> *"For negotiation, the new account paperwork should be a check on if we have uploaded it… This should also be a document pushed out to client via email or Docusign portal or a custom version, where the customer can receive an email and fill out the account paperwork via a link… The ingest of a pdf should be flagged for the office admin to review and approve prior to moving the deal to negotiation stage. This process should repeat for third party waste authorization and any other needed document… Some like quotes will be autogenerated, others like third party waste autorizations will require it be their form signed and some may even require a physical scan rather than an electronic signature."*

**Real forms supplied with this pass:** `docs/uploaded files/New Customer Packet trey.pdf` and `New Vendor Form.pdf`. **The third-party waste authorization is the final page of the customer packet — it is Republic's form** (owner-confirmed 2026-09-22). Nothing further needs to be requested.

That last page is a fillable AcroForm; its fields are `Name of Generator`, `Generator Mailing Address`, `Generator Contact (Print Name)`, `Generator Contact Title`, `Generator Contact Phone`, `Generator Signature`, `Profile Number`, `Name of Agent Company`, `Agent Company Address`, `Name of Agent Individual` (plus three numbered slots), `Agent Individual Title`, a Day/Month/Year date, and eleven check boxes. Three consequences for the model:

- **It is a third party's form on their letterhead.** We cannot generate or restyle it — only fill, route for signature, and store. This is the concrete case behind the note's *"others like third party waste authorizations will require it be their form signed."* The model needs a document type whose template is a fixed external PDF, distinct from types we generate ourselves (quotes).
- **It authorises BioRemedy as the customer's *agent*** at the disposal facility; the customer is the *generator*. That is a different relationship from the customer paperwork sitting beside it in the same packet, and it introduces a **fourth party** — the disposal facility — alongside customer, BioRemedy and subcontractor. Phase 04 already worked through a three-way "who is whose customer/vendor" confusion; read that item before modelling this one, and expect the answer to need a fourth seat.
- **One packet contains two different requirements.** The customer paperwork and the waste authorization arrive as one PDF but have different signers, different counterparties and different expiries. Splitting a multi-document packet into separate tracked requirements is a real requirement of the ingest path, not an edge case — and it is why "is a file attached?" was never going to be a sufficient check.

**Still needed from the owner:** whether the profile number on that form ties to something we should store per customer per waste stream (it looks like a Republic-assigned waste profile ID, which would be worth holding as a real field rather than living only inside a scanned PDF).

The owner is describing one mechanism used by several document types, not several features. Model it that way:

- **A document requirement** — this account (or this opportunity, or this job) needs document type X. Requirements can be generated by a stage gate, by a project, or by a dispatch request.
- **A document instance** with a lifecycle: `Not started → Sent → Returned → In review → Approved` (or `Rejected`, back to Sent). The lifecycle is the same whether the document came back through an e-sign portal, as an email attachment, or as a scan of a physically signed form — the owner is explicit that all three paths exist and that some forms can never be electronic.
- **An office-admin review step that is mandatory.** Ingest alone must not satisfy the requirement; a human approves. This is the part that gates the Negotiation stage.
- **Gate integration.** The opportunity stage gate reads approved requirements, not "is a file attached." Project creation and the job-dispatch request then read the same state instead of asking the user again — which is the note's "we should have all of those fields auto populated based on this response," and is the same complaint Phase 15 records about projects not knowing what sales already collected.

**Delivery is a separate concern from tracking.** Sending the packet by email, or as a portal link the customer fills in, belongs to `phase-19-email-and-communications.md`. **This phase should not wait for it** — upload-and-review works on its own and is what the pilot needs. Build the requirement/instance/review model here with a manual upload path, and let Phase 19 add send-and-track on top. Likewise, third-party e-signature (DocuSign or equivalent) is a vendor decision, not a prerequisite: leave a seam for it, do not design around a specific product.

**Vendor-side symmetry:** Phase 04 has open items blocked on "document uploads" for vendor compliance (insurance certificates, service agreements, the supplied `New Vendor Form.pdf`). Those are the same requirement/instance/review model pointed at a vendor account. Build once, point it at both, and unblock Phase 04 in the same pass.

---

## Decisions locked 2026-09-22 (owner)

- **Republic "Profile Number" (Q19): yes, hold it as a real field.** Internal use only, entered later — so it is a stored, editable value that does not need to appear on customer-facing output.
- **Client Portal ships in the pilot (Q21): yes.** This materially raises this phase's stakes. Internal-only visibility rules become **load-bearing on day one**, not a field to be enforced later — a customer with a login will be able to request URLs directly. The definition-of-done item about a Client Portal role being refused a direct URL is now a real test, not a precaution. It also pulls forward parts of Phase 12: a portal user is an external identity, which is a different problem from internal staff auth and should be scoped explicitly rather than assumed to come free with Entra.
- **Storage location (Q20) and file limits (Q22): still open, and correctly linked** — the owner notes the limits depend on the SharePoint decision. See the session notes for the trade-offs. Do not build either way until Q20 is settled; it changes the whole attachment design.

### Storage and file limits — answered 2026-09-22

- **Q20: the middle path.** The CRM holds **state-carrying documents** — the customer packet, the Republic waste authorization, COIs, service agreements, signed quotes, field photos — because their whole purpose is to be tracked, reviewed and gated, and a document whose status lives in a folder cannot gate a stage. **SharePoint keeps bulk material** — sales literature, photo archives, reference documents — with links from the CRM. Nothing migrates off SharePoint; it keeps what it is already good at.
  - The boundary to hold onto: **if a stage gate, a review step or a dispatch check reads it, the CRM owns it.** Everything else can live in SharePoint. When in doubt, ask whether the app needs to answer a question about the document's state.
- **Q22: 25MB per file, allowlist of PDF / images / Office formats.** That is sized for the middle path — paperwork and field photos, not video or point clouds. Revisit only if something legitimate starts bouncing off the cap.
