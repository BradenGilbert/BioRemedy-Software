// Front Line 2 — the site map wired to the app (Phase 21 W3, 2026-09-25).
//
// map-core.js is the pure Leaflet component (it also serves the /walk/<token> share page with no
// app.js at all). This wrapper gives it the app's pieces: photo uploads as `documents`, plan
// uploads as `site-plan` documents on the facility, record ids, the acting user, the facility's
// coordinates, and the read-only "walk map summary" panel the office pages embed. The circular
// app.js import is never read at module top level.
import * as crm from "../app.js";
import { createSiteMap as createCoreSiteMap, downloadArea, countTilesForArea, PIN_KINDS, SHAPE_KINDS, SHAPE_COLORS } from "./map-core.js";
import { layersForFacility, resolveLayers, bboxAround } from "./layers.js";
import { uploadFieldFile, fieldRequest, mergeRow, pendingUploadUrl } from "./package.js";

export { PIN_KINDS, SHAPE_KINDS, SHAPE_COLORS, downloadArea } from "./map-core.js";

export function photoUrl(documentId) {
  return `/api/documents/${encodeURIComponent(documentId)}/view`;
}

// On-screen thumbnails: a photo still waiting in the offline outbox is drawn from the phone's copy.
// (Exports and share links always use photoUrl -- they are only ever built from uploaded files.)
export function thumbUrl(documentId) {
  return pendingUploadUrl(documentId) || photoUrl(documentId);
}

export function documentTypeIdByCode(code) {
  return (crm.state.backend.documentTypes || []).find((type) => type.code === code && !type.deletedAt)?.id || "";
}

function findDocumentRow(documentId) {
  return (crm.state.backend.documents || []).find((document) => document.id === documentId) || null;
}

// Upload one photo/plan as a `documents` row through the field upload path (W2's outbox queues it).
// Phase 25 items 5-6 (2026-09-29): always resolves to a row with an id --
//   - online: the server's new row (merged into state so pickers and the markup tool can find it);
//   - offline: a stand-in row whose id the queued upload carries (X-Document-Id), `pendingUpload: true`;
//   - the same file already on that record (409): the existing row, `duplicate: true`, instead of an error.
export async function uploadSiteDocument({ entityType, entityId, file, typeCode = "site-photo", caption = "", visibility = "internal", groupId = "" }) {
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
  const named = /\.[a-z0-9]+$/i.test(file.name || "") ? file : new File([file], `${typeCode}-${Date.now()}.${extensions[file.type] || "jpg"}`, { type: file.type || "image/jpeg" });
  try {
    const saved = await uploadFieldFile("/api/documents", named, {
      "X-Entity-Type": entityType,
      "X-Entity-Id": entityId,
      "X-Document-Type": documentTypeIdByCode(typeCode),
      "X-Group-Id": groupId,
      "X-Visibility": visibility,
      "X-Caption": encodeURIComponent(String(caption || "").trim().slice(0, 200)),
      "X-Document-Id": crm.makeId("document"),
    });
    if (saved?.id && !saved.pendingUpload) mergeRow("documents", saved);
    if (!saved?.id) throw new Error("The upload did not return a document.");
    return saved;
  } catch (error) {
    const existingId = error?.status === 409 ? error.payload?.documentId : "";
    if (!existingId) throw error;
    return { ...(findDocumentRow(existingId) || {}), id: existingId, duplicate: true };
  }
}

// ---------------------------------------------------------------------------------------------
// Walk photos: choose existing / upload new, and the per-photo action sheet (Phase 25 items 5-7).
// Shared by the Walk tab's section trays and required-shot slots (walk.js) and the pin sheet.
// ---------------------------------------------------------------------------------------------

// This walk's reusable photos: the latest version of every site photo on the walk's opportunity (or
// on the walk report itself when there is no opportunity), newest first.
export function walkPhotoCandidates(walk, report) {
  const targets = [];
  if (walk?.opportunityId) targets.push(["opportunity", walk.opportunityId]);
  if (report?.id) targets.push(["siteWalk", report.id]);
  const photoTypeId = documentTypeIdByCode("site-photo");
  const seen = new Set();
  return targets
    .flatMap(([entityType, entityId]) => crm.latestDocumentsForEntity(entityType, entityId))
    .filter((document) => /^image\//.test(document.mimeType || "") && (!document.documentTypeId || document.documentTypeId === photoTypeId))
    .filter((document) => !seen.has(document.id) && seen.add(document.id));
}

function shotDocumentId(shot) {
  return typeof shot === "string" ? shot : shot?.documentId || "";
}

// Does any walk (report sections, required shots, sketches, plan backgrounds, pins) still point at
// this document? `report` is the caller's in-memory copy of its own report (it may be newer than
// state); `skipObservationId` a pin whose list is being changed right now.
export function walkReferencesDocument(documentId, { report = null, skipObservationId = "" } = {}) {
  const reports = (crm.state.backend.siteWalkReports || []).filter((row) => !row.deletedAt).map((row) => (report && row.id === report.id ? report : row));
  if (report && !reports.includes(report)) reports.push(report);
  for (const row of reports) {
    if ((row.sketchDocumentIds || []).includes(documentId)) return true;
    if ((row.backgrounds || []).some((background) => background.documentId === documentId)) return true;
    for (const section of Object.values(row.sections || {})) {
      if ((section?.photoDocumentIds || []).includes(documentId)) return true;
      if (Object.values(section?.shots || {}).some((shot) => shotDocumentId(shot) === documentId)) return true;
    }
  }
  return (crm.state.backend.siteWalkObservations || []).some((row) => !row.deletedAt && row.id !== skipObservationId && (row.photoDocumentIds || []).includes(documentId));
}

// Item 5: after a photo is taken off a section, slot or pin, soft-delete it when nothing references
// any version of it any more. Only versions uploaded since the walk started are deleted -- a photo
// that was already on the opportunity (an office upload, an earlier walk) is only unlinked.
export async function releaseWalkDocument(documentId, { report = null, skipObservationId = "" } = {}) {
  const document = findDocumentRow(documentId);
  if (!document) return false;
  const key = document.groupId || document.id;
  const versions = (crm.state.backend.documents || []).filter((row) => !row.deletedAt && (row.groupId || row.id) === key);
  if (versions.some((row) => walkReferencesDocument(row.id, { report, skipObservationId }))) return false;
  const since = Date.parse(report?.startedAt || report?.createdAt || "");
  if (!Number.isFinite(since)) return false;
  let removed = false;
  for (const row of versions) {
    if (!(Date.parse(row.uploadedAt || "") >= since - 5 * 60 * 1000)) continue;
    try {
      await fieldRequest(`/api/backend/documents/${encodeURIComponent(row.id)}`, { method: "DELETE", kind: "document-delete", label: `Remove ${row.caption || row.fileName || "photo"}` });
      mergeRow("documents", { ...row, deletedAt: new Date().toISOString() });
      removed = true;
    } catch (error) {
      console.warn("walk photo delete failed", error);
    }
  }
  return removed;
}

// Upload the chosen files (or pass through the chosen existing ids) and say what happened.
export async function addWalkPhotos(choice, { entityType, entityId, caption = () => "" }) {
  if (!choice) return [];
  if (Array.isArray(choice.documentIds)) {
    const linked = [...new Set(choice.documentIds)];
    if (linked.length) crm.showToast(`${linked.length} existing photo${linked.length === 1 ? "" : "s"} linked.`);
    return linked;
  }
  const files = choice.files || [];
  const ids = [];
  let duplicates = 0;
  let queued = 0;
  if (files.length) crm.showToast(`Uploading ${files.length} photo${files.length === 1 ? "" : "s"}…`);
  for (const [index, file] of files.entries()) {
    const saved = await uploadSiteDocument({ entityType, entityId, file, typeCode: "site-photo", caption: caption(index, files.length) });
    if (!saved?.id) continue;
    if (!ids.includes(saved.id)) ids.push(saved.id);
    if (saved.duplicate) duplicates += 1;
    if (saved.pendingUpload) queued += 1;
  }
  if (duplicates) crm.showToast(duplicates === files.length ? `Already uploaded — linked the existing photo${duplicates === 1 ? "" : "s"}.` : `${files.length - duplicates} uploaded; ${duplicates} already uploaded — linked the existing photo${duplicates === 1 ? "" : "s"}.`);
  else if (queued) crm.showToast(`Saved on this phone — ${queued === 1 ? "it attaches" : "they attach"} when you're back online.`);
  else if (ids.length) crm.showToast(`${ids.length} photo${ids.length === 1 ? "" : "s"} uploaded.`);
  return ids;
}

function typeCodeFor(document) {
  return (crm.state.backend.documentTypes || []).find((type) => type.id === document?.documentTypeId)?.code || "";
}

// Item 5/7: tap a photo → View / Mark up / Replace / Remove. Resolves { type: "remove" },
// { type: "swap", documentId } (the replacement or marked-up version, a new version in the same
// document group) or null. The caller changes its own references; references always name a version.
export async function runWalkPhotoAction(documentId, { title = "Photo", markupLabel = "Mark up", removeLabel = "Remove from walk", replace = true, typeCode = "site-photo" } = {}) {
  const document = findDocumentRow(documentId);
  const choice = await photoActionSheet({ documentId, document, title, markupLabel, removeLabel, replace });
  if (!choice) return null;
  if (choice.action === "remove") return { type: "remove" };
  if (!document) {
    crm.showToast("That photo is not on this phone yet — refresh and try again.");
    return null;
  }
  const groupId = document.groupId || document.id;
  const code = typeCodeFor(document) || typeCode;
  if (choice.action === "replace") {
    const file = choice.files?.[0];
    if (!file) return null;
    const saved = await uploadSiteDocument({ entityType: document.entityType, entityId: document.entityId, file, typeCode: code, caption: document.caption || "", visibility: document.visibility || "internal", groupId });
    if (!saved?.id || saved.id === documentId) {
      crm.showToast("That is the same photo — nothing changed.");
      return null;
    }
    crm.showToast(saved.duplicate ? "Already uploaded — linked the existing photo." : saved.pendingUpload ? "Replaced on this phone — it uploads when you're back online." : "Photo replaced. The original is kept as an earlier version.");
    return { type: "swap", documentId: saved.id };
  }
  if (choice.action === "markup") {
    const openMarkup = window.fieldMedia?.openImageMarkup;
    if (!openMarkup) {
      crm.showToast("The markup tool is not loaded.");
      return null;
    }
    const localCopy = pendingUploadUrl(document.id);
    const result = await openMarkup(document.pendingUpload && localCopy ? localCopy : document, { entityType: document.entityType, entityId: document.entityId, documentType: code, groupId, caption: document.caption || "", title: markupLabel === "Mark up" ? "Mark up this photo" : markupLabel });
    if (!result?.id) return null;
    crm.showToast(result.pendingUpload ? "Markup saved on this phone — it uploads when you're back online." : "Markup saved as a new version; the original is kept.");
    return { type: "swap", documentId: result.id };
  }
  return null;
}

// ---- the bottom sheet (one <dialog>, created on first use) ----
let photoSheetDialog = null;
let photoSheetToken = 0;
function photoSheetElement() {
  if (photoSheetDialog?.isConnected) return photoSheetDialog;
  photoSheetDialog = document.createElement("dialog");
  photoSheetDialog.id = "fieldPhotoSheet";
  photoSheetDialog.className = "field-photo-sheet";
  document.body.append(photoSheetDialog);
  return photoSheetDialog;
}

function runPhotoSheet(render) {
  return new Promise((resolve) => {
    const dialog = photoSheetElement();
    const token = ++photoSheetToken;
    let settled = false;
    const onClose = () => {
      if (token === photoSheetToken && !dialog.open) done(null);
    };
    const done = (value) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    dialog.addEventListener("close", onClose);
    render(dialog, done);
    if (!dialog.open) dialog.showModal();
  });
}

function sheetHead(title) {
  return `<div class="field-photo-sheet-head"><strong>${esc(title)}</strong><button type="button" class="field-photo-sheet-close" data-photo-sheet-close aria-label="Close">×</button></div>`;
}

function wireSheetClose(dialog, done) {
  dialog.querySelectorAll("[data-photo-sheet-close]").forEach((button) => (button.onclick = () => done(null)));
}

// Item 6: "+ Photo" → Upload new (file picker / camera) or Choose existing (a multi-select grid of
// `candidates`). Resolves { files } | { documentIds } | null.
export function choosePhotoSource({ title = "Add photo", candidates = [], excludeIds = [], multiple = true } = {}) {
  const exclude = new Set(excludeIds.filter(Boolean));
  const list = candidates.filter((document) => !exclude.has(document.id));
  return runPhotoSheet((dialog, done) => {
    const picked = new Set();
    const showStart = () => {
      dialog.innerHTML = `
        ${sheetHead(title)}
        <div class="field-photo-sheet-actions">
          <label class="field-button field-photo-sheet-upload"><input type="file" accept="image/*" ${multiple ? "multiple" : ""} data-photo-sheet-file /><span>Upload new</span></label>
          <button type="button" class="field-button field-button--secondary" data-photo-sheet-existing ${list.length ? "" : "disabled"}>${list.length ? `Choose existing (${list.length})` : "Choose existing — none on this walk yet"}</button>
          <button type="button" class="field-button field-button--ghost" data-photo-sheet-close>Cancel</button>
        </div>`;
      wireSheetClose(dialog, done);
      const input = dialog.querySelector("[data-photo-sheet-file]");
      input.addEventListener("change", () => {
        const files = [...(input.files || [])];
        if (files.length) done({ files });
      });
      const existing = dialog.querySelector("[data-photo-sheet-existing]");
      if (existing) existing.onclick = () => showPicker();
    };
    const showPicker = () => {
      dialog.innerHTML = `
        ${sheetHead(multiple ? "Choose existing photos" : "Choose an existing photo")}
        <div class="field-photo-pick-grid">
          ${list.map((document) => `<button type="button" class="field-photo-pick ${picked.has(document.id) ? "is-picked" : ""}" data-pick-id="${attrEsc(document.id)}" aria-pressed="${picked.has(document.id)}"><img src="${attrEsc(thumbUrl(document.id))}" alt="" loading="lazy" /><span>${esc(document.caption || document.fileName || "Photo")}</span></button>`).join("")}
        </div>
        <div class="field-photo-sheet-actions field-photo-sheet-actions--row">
          <button type="button" class="field-button field-button--ghost" data-photo-sheet-back>Back</button>
          <button type="button" class="field-button" data-photo-sheet-add ${picked.size ? "" : "disabled"}>Add${picked.size ? ` ${picked.size}` : ""}</button>
        </div>`;
      wireSheetClose(dialog, done);
      dialog.querySelectorAll("[data-pick-id]").forEach((button) => {
        button.onclick = () => {
          const id = button.dataset.pickId;
          if (picked.has(id)) picked.delete(id);
          else {
            if (!multiple) picked.clear();
            picked.add(id);
          }
          showPicker();
        };
      });
      dialog.querySelector("[data-photo-sheet-back]").onclick = () => showStart();
      dialog.querySelector("[data-photo-sheet-add]").onclick = () => picked.size && done({ documentIds: [...picked] });
    };
    showStart();
  });
}

// Items 5/7: the per-photo sheet. Resolves { action: "markup" } | { action: "replace", files } |
// { action: "remove" } | null.
export function photoActionSheet({ documentId, document = null, title = "Photo", markupLabel = "Mark up", removeLabel = "Remove from walk", replace = true } = {}) {
  return runPhotoSheet((dialog, done) => {
    const caption = document?.caption || document?.fileName || "";
    const version = Number(document?.versionNumber || 1);
    dialog.innerHTML = `
      ${sheetHead(title)}
      <figure class="field-photo-sheet-preview"><img src="${attrEsc(thumbUrl(documentId))}" alt="${attrEsc(caption)}" /><figcaption>${esc(caption)}${version > 1 ? ` · version ${version}` : ""}${document?.pendingUpload ? " · waiting to upload" : ""}</figcaption></figure>
      <div class="field-photo-sheet-actions">
        <a class="field-button field-button--secondary" data-photo-sheet-view href="${attrEsc(thumbUrl(documentId))}" target="_blank" rel="noopener">View full size</a>
        <button type="button" class="field-button field-button--secondary" data-photo-sheet-markup>${esc(markupLabel)}</button>
        ${replace ? `<label class="field-button field-button--secondary field-photo-sheet-upload"><input type="file" accept="image/*" data-photo-sheet-replace /><span>Replace</span></label>` : ""}
        <button type="button" class="field-button field-button--danger" data-photo-sheet-remove>${esc(removeLabel)}</button>
        <button type="button" class="field-button field-button--ghost" data-photo-sheet-close>Close</button>
      </div>`;
    wireSheetClose(dialog, done);
    dialog.querySelector("[data-photo-sheet-markup]").onclick = () => done({ action: "markup" });
    const replaceInput = dialog.querySelector("[data-photo-sheet-replace]");
    if (replaceInput) {
      replaceInput.addEventListener("change", () => {
        const files = [...(replaceInput.files || [])];
        if (files.length) done({ action: "replace", files });
      });
    }
    // Two taps to remove, so a stray tap on a phone never takes a photo off the walk.
    const remove = dialog.querySelector("[data-photo-sheet-remove]");
    remove.onclick = () => {
      if (remove.dataset.armed) return done({ action: "remove" });
      remove.dataset.armed = "1";
      remove.textContent = "Tap again to remove";
    };
  });
}

function imageDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ widthPx: image.naturalWidth || 1000, heightPx: image.naturalHeight || 1000 });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve({ widthPx: 1000, heightPx: 1000 });
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

// Backgrounds a report can show: the aerial plus each uploaded plan with its image URL.
export function backgroundsForReport(report) {
  return [{ id: "aerial", kind: "aerial", label: "Aerial" }, ...((report?.backgrounds || []).map((background) => ({ ...background, imageUrl: background.imageUrl || (background.documentId ? photoUrl(background.documentId) : "") })))];
}

export function walkReportForEvent(walkEventId) {
  return (crm.state.backend.siteWalkReports || []).find((report) => report.walkEventId === walkEventId && !report.deletedAt) || null;
}

export function walkReportsForOpportunity(opportunityId) {
  return (crm.state.backend.siteWalkReports || []).filter((report) => report.opportunityId === opportunityId && !report.deletedAt).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export function observationsForWalk(walkEventId) {
  return (crm.state.backend.siteWalkObservations || []).filter((row) => row.walkEventId === walkEventId && !row.deletedAt).sort((a, b) => Number(a.seq) - Number(b.seq));
}

export function facilityCenter(facilityId) {
  const facility = crm.findFacility(facilityId);
  return facility ? crm.facilityCoordinates(facility) : null;
}

// The app-wired map. `walk` is the scheduleEvents row; `report` the siteWalkReports row.
// `getReport` / `ensureReport` (walk.js): the walk's live in-memory report, and one that is saved to
// the server first -- photos on a walk with no opportunity are filed on the report (entityType siteWalk).
export function createSiteMap(container, { walk, report, mode = "edit", observations, layers, onChange, onShare, onPlanAdded, center, printing = false, getReport, ensureReport } = {}) {
  const facilityId = walk?.facilityId || report?.facilityId || "";
  const opportunityId = walk?.opportunityId || report?.opportunityId || "";
  const centerPoint = center || facilityCenter(facilityId) || null;
  const currentReport = () => (typeof getReport === "function" ? getReport() : report) || null;
  const photoTarget = async () => {
    if (opportunityId) return { entityType: "opportunity", entityId: opportunityId };
    const saved = typeof ensureReport === "function" ? await ensureReport() : currentReport();
    if (!saved?.id) throw new Error("Save the walk before adding photos.");
    return { entityType: "siteWalk", entityId: saved.id };
  };
  const photosEditable = mode === "edit" && Boolean(opportunityId || report || getReport);
  const pinCaption = (observation) => `Pin ${observation.seq}${observation.label ? ` · ${observation.label}` : ""}`;
  const api = createCoreSiteMap(container, {
    mode,
    printing,
    center: centerPoint,
    zoom: 18,
    observations: observations || (walk ? observationsForWalk(walk.id) : []),
    backgrounds: backgroundsForReport(report),
    layers: layers || [],
    newId: () => crm.makeId("obs"),
    createdBy: crm.currentActorName ? crm.currentActorName() : crm.state.currentUser?.name || "",
    photoUrl: thumbUrl,
    onChange,
    onShare,
    onPhoto: photosEditable
      ? async (observation, files) => addWalkPhotos({ files }, { ...(await photoTarget()), caption: () => pinCaption(observation) })
      : null,
    // Phase 25 items 5-7 (2026-09-29): "+ Photo" offers the walk's existing photos too, and a tap on a
    // pin photo opens View / Mark up / Replace / Remove.
    onPhotoAdd: photosEditable
      ? async (observation) => {
          const choice = await choosePhotoSource({ title: `Photo for pin ${observation.seq}`, candidates: walkPhotoCandidates(walk, currentReport()), excludeIds: observation.photoDocumentIds || [] });
          if (!choice) return [];
          return addWalkPhotos(choice, { ...(await photoTarget()), caption: () => pinCaption(observation) });
        }
      : null,
    onPhotoTap: photosEditable
      ? async (observation, documentId) => {
          const result = await runWalkPhotoAction(documentId, { title: `Pin ${observation.seq} photo`, removeLabel: "Remove from this pin" });
          if (!result) return null;
          const ids = observation.photoDocumentIds || [];
          if (result.type === "remove") {
            await releaseWalkDocument(documentId, { report: currentReport(), skipObservationId: observation.id });
            return ids.filter((id) => id !== documentId);
          }
          return ids.map((id) => (id === documentId ? result.documentId : id));
        }
      : null,
    onUploadPlan:
      mode === "edit"
        ? async (file) => {
            const entityType = facilityId ? "facility" : "opportunity";
            const entityId = facilityId || opportunityId;
            if (!entityId) throw new Error("This walk has no facility or opportunity to file the plan on.");
            const label = window.prompt("Name this plan (e.g. Building A, Fire plan)", file.name.replace(/\.[a-z0-9]+$/i, "")) || file.name;
            const dims = await imageDimensions(file);
            const saved = await uploadSiteDocument({ entityType, entityId, file, typeCode: "site-plan", caption: label });
            const background = { id: crm.makeId("bg"), kind: "plan", label, documentId: saved.id, widthPx: dims.widthPx, heightPx: dims.heightPx, imageUrl: photoUrl(saved.id) };
            if (typeof onPlanAdded === "function") await onPlanAdded(background);
            return background;
          }
        : null,
  });
  // Live reference layers arrive after the first paint; snapshots draw immediately.
  if (api && facilityId && !layers) {
    const initial = layersForFacility(facilityId);
    if (initial.length) {
      api.setLayers(initial);
      if (centerPoint) resolveLayers(initial, bboxAround(centerPoint, 400)).then((resolved) => api.setLayers(resolved)).catch(() => {});
    }
  }
  return api;
}

// ---------------------------------------------------------------------------------------------
// Read-only summary for office panels (Develop & Planning, project Plan tab, W2's job Brief)
// ---------------------------------------------------------------------------------------------

function esc(value) {
  return crm.escapeHtml(value ?? "");
}

function attrEsc(value) {
  return crm.escapeAttribute(value ?? "");
}

// `ref` = { walkEventId } | { opportunityId } | { facilityId }. Returns { html, after, report, observations }.
export function renderWalkMapSummary(ref = {}, { height = 360, showList = true } = {}) {
  let report = null;
  if (ref.walkEventId) report = walkReportForEvent(ref.walkEventId);
  else if (ref.opportunityId) report = walkReportsForOpportunity(ref.opportunityId)[0] || null;
  else if (ref.facilityId) report = (crm.state.backend.siteWalkReports || []).filter((row) => row.facilityId === ref.facilityId && !row.deletedAt).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null;
  const walkEventId = report?.walkEventId || ref.walkEventId || "";
  const observations = walkEventId ? observationsForWalk(walkEventId) : [];
  const facilityId = report?.facilityId || ref.facilityId || (ref.opportunityId ? crm.findOpportunity(ref.opportunityId)?.facilityId : "") || "";
  const center = facilityCenter(facilityId);
  if (!report && !observations.length && !center) {
    return { html: `<div class="empty-state compact">No site walk map yet, and this site has no coordinates to show.</div>`, after() {}, report, observations };
  }
  const key = walkEventId || `facility-${facilityId}`;
  const html = `
    <div class="sitemap-summary">
      <div class="sitemap-summary-map" data-walk-map="${esc(key)}" data-walk-event-id="${esc(walkEventId)}" data-facility-id="${esc(facilityId)}" style="height:${Number(height)}px"></div>
      ${showList && observations.length ? `<ol class="sitemap-summary-list">${observations.map(renderObservationLine).join("")}</ol>` : showList ? `<p class="help-text">No pins or shapes on this walk yet.</p>` : ""}
    </div>`;
  return { html, after: () => mountSummaryMaps(document), report, observations };
}

export function renderObservationLine(row) {
  const kind = PIN_KINDS[row.kind] || PIN_KINDS.custom;
  const color = row.geometry ? SHAPE_COLORS[row.color] || SHAPE_COLORS.blue : kind.color;
  const title = row.label || (row.geometry ? SHAPE_KINDS[row.shapeKind]?.label || "Shape" : kind.label);
  const measure = row.areaSqFt ? `${Math.round(row.areaSqFt).toLocaleString()} sq ft` : row.lengthFt ? `${Math.round(row.lengthFt).toLocaleString()} ft` : "";
  const where = row.geometry ? "" : row.accuracyM ? `GPS ±${Math.round(row.accuracyM)} m` : row.lat ? "placed manually" : "on plan";
  const photos = (row.photoDocumentIds || []).length;
  return `
    <li class="sitemap-summary-item" data-walk-focus="${esc(row.id)}">
      <span class="sitemap-summary-seq" style="--pin-color:${color}">${esc(row.seq)}</span>
      <div>
        <strong>${esc(title)}</strong>
        <small>${esc([row.geometry ? SHAPE_KINDS[row.shapeKind]?.label || "Shape" : kind.label, measure, where, photos ? `${photos} photo${photos === 1 ? "" : "s"}` : "", row.createdAt ? crm.formatShortTime(row.createdAt) : ""].filter(Boolean).join(" · "))}</small>
        ${row.note ? `<p>${esc(row.note)}</p>` : ""}
      </div>
    </li>`;
}

const summaryMaps = new WeakMap();

// Mount a view-mode map in every `[data-walk-map]` that hasn't got one. Idempotent; safe to call
// after any render (app.js calls it through window.fieldMap).
export function mountSummaryMaps(root = document) {
  root.querySelectorAll("[data-walk-map]").forEach((element) => {
    if (summaryMaps.has(element) || !element.isConnected) return;
    const walkEventId = element.dataset.walkEventId || "";
    const facilityId = element.dataset.facilityId || "";
    const report = walkEventId ? walkReportForEvent(walkEventId) : null;
    const walk = walkEventId ? crm.siteWalkEvents().find((event) => event.id === walkEventId) || { id: walkEventId, facilityId, opportunityId: report?.opportunityId || "" } : { id: "", facilityId, opportunityId: "" };
    const layers = report?.referenceSnapshot?.layers?.length ? report.referenceSnapshot.layers.map((layer) => ({ id: layer.layerId, label: layer.label, kind: layer.kind, geojson: layer.geojson, source: layer.source, sourceDate: layer.sourceDate, mode: "snapshot" })) : undefined;
    const api = createSiteMap(element, { walk, report, mode: "view", observations: walkEventId ? observationsForWalk(walkEventId) : [], layers });
    if (api) summaryMaps.set(element, api);
    const list = element.parentElement?.querySelector(".sitemap-summary-list");
    if (list && api) list.querySelectorAll("[data-walk-focus]").forEach((item) => item.addEventListener("click", () => api.focus(item.dataset.walkFocus)));
  });
}

// "Download facility tiles" from the facility page: zoom 16–19 around the facility point.
export async function downloadFacilityTiles(facilityId, { radiusMeters = 300 } = {}) {
  const center = facilityCenter(facilityId);
  if (!center) throw new Error("This facility has no coordinates yet.");
  const facility = crm.findFacility(facilityId);
  const bounds = bboxAround(center, radiusMeters);
  const zooms = [16, 17, 18, 19];
  const total = countTilesForArea(bounds, zooms);
  crm.showToast(`Downloading ${total} tiles for ${facility?.name || "the facility"}…`);
  const result = await downloadArea({ bounds, zooms, source: "esri", label: facility?.name || facilityId, areaId: `facility-${facilityId}` });
  crm.showToast(`${result.tileCount - result.failed} of ${result.tileCount} tiles stored for offline use${result.failed ? ` (${result.failed} failed)` : ""}.`);
  return result;
}

// app.js reaches these without importing the module (keeps the import graph one-way).
window.fieldMap = { mountSummaryMaps, downloadFacilityTiles, renderWalkMapSummary };
