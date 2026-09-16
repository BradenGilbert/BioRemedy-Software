# Phase 11 — Document Storage

**Status:** Not started
**Depends on:** Phase 10 (documents must be access-controlled from day one, not retrofitted)
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

Phase 10 closes the un-gated attachment route. This phase must not reopen it:
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

- **Cloud object storage** (S3/Azure Blob). Local disk is fine for pilot scale. `docs/crm-foundation.md` is right that large files eventually belong in object storage — but that is a Phase 12+ concern, and the schema above is written so the storage backend can change without a data migration.
- **LiDAR / point clouds / 3D viewers.** `spatialData` holds metadata; the viewer already exists for what it supports. Stage E.
- **SharePoint / Teams integration.** Stage E. The 2026-09-16 notes raise this again directly (*"I believe we may still use sharepoint and teams for this, but I need to figure out to what extent we want to continue our integration with that vs our own file sharing system"*) — this is an open product decision, not just a deferred build; see below.
- **E-signature / Docusign integration.** Raised explicitly: *"For sending sign-offs and getting them back we might want to look at integrating with Docusign or something similar... We send it via email, they sign via a portal... then it returns to us and notifies the team members and/or sales team then automatically updates the CRM that it has been signed/approved."* This is a substantial integration (or a custom-built signing portal, per the note's own "maybe a local custom built one, who knows") layered on top of item 5's document archive — track as a Stage E follow-on once item 5 exists, not part of reaching the Pilot Milestone.
- Full-text search inside documents.
- Retention *automation* — capture `retention_until`; act on it later.

---

## Data model changes

New: generic entity-attachment table (or a genuine extension of the existing `files` table — `crm-schema/012_files.sql` exists but `docs/database-handoff-map.md` states plainly that it "is not sufficient for production").

Decide early: extend `files` or supersede it. **Recommendation: extend.** A second file table repeats the exact mistake this roadmap keeps unwinding.

---

## Verification / done criteria

- [ ] Upload a PDF to an account's Files tab; it persists across a reload and is visible to a second user
- [ ] Upload the same file twice — the hash catches the duplicate
- [ ] Attach a certificate of insurance to a vendor profile (Phase 04's deferred dependency)
- [ ] Attach a customer approval letter to an `account_approved_subcontractors` row
- [ ] Mark a file internal-only; confirm a Client Portal role cannot retrieve it **via direct URL**, not just via hidden UI
- [ ] Upload a new version of an existing file; both versions are retrievable
- [ ] Signed-out file request is refused
- [ ] Account logo displays on the account header
- [ ] A form tagged for the Negotiation stage can be pulled up from the Negotiation stage and no other

---

## Open decisions

- **Extend `files` or supersede it?** Recommendation: extend.
- **Size limits and allowed types?** Field photos and lab PDFs are the common cases; LiDAR is explicitly excluded here.
- **Does the Client Portal ship in pilot?** If yes, the visibility rules above are load-bearing. If no, build the field but defer enforcement testing.
- **SharePoint/Teams vs. this system's own file sharing** — the owner has explicitly not decided whether to keep using SharePoint/Teams for sales materials or fold everything into this CRM's own storage. Needs a real decision before item 5's sales-materials scope is finalized; don't build a migration off SharePoint speculatively.

---

## Corrections found during implementation

*(Record here anything that turned out to be different from the plan.)*
