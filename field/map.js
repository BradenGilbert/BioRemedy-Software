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
import { uploadFieldFile } from "./package.js";

export { PIN_KINDS, SHAPE_KINDS, SHAPE_COLORS, downloadArea } from "./map-core.js";

export function photoUrl(documentId) {
  return `/api/documents/${encodeURIComponent(documentId)}/view`;
}

export function documentTypeIdByCode(code) {
  return (crm.state.backend.documentTypes || []).find((type) => type.code === code && !type.deletedAt)?.id || "";
}

// Upload one photo/plan as a `documents` row through the field upload path (W2's outbox queues it).
export async function uploadSiteDocument({ entityType, entityId, file, typeCode = "site-photo", caption = "", visibility = "internal", groupId = "" }) {
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
  const named = /\.[a-z0-9]+$/i.test(file.name || "") ? file : new File([file], `${typeCode}-${Date.now()}.${extensions[file.type] || "jpg"}`, { type: file.type || "image/jpeg" });
  return uploadFieldFile("/api/documents", named, {
    "X-Entity-Type": entityType,
    "X-Entity-Id": entityId,
    "X-Document-Type": documentTypeIdByCode(typeCode),
    "X-Group-Id": groupId,
    "X-Visibility": visibility,
    "X-Caption": encodeURIComponent(String(caption || "").trim().slice(0, 200)),
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
export function createSiteMap(container, { walk, report, mode = "edit", observations, layers, onChange, onShare, onPlanAdded, center, printing = false } = {}) {
  const facilityId = walk?.facilityId || report?.facilityId || "";
  const opportunityId = walk?.opportunityId || report?.opportunityId || "";
  const centerPoint = center || facilityCenter(facilityId) || null;
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
    photoUrl,
    onChange,
    onShare,
    onPhoto:
      mode === "edit" && opportunityId
        ? async (observation, files) => {
            const ids = [];
            for (const file of files) {
              const saved = await uploadSiteDocument({ entityType: "opportunity", entityId: opportunityId, file, typeCode: "site-photo", caption: `Pin ${observation.seq}${observation.label ? ` · ${observation.label}` : ""}` });
              if (saved?.id) ids.push(saved.id);
            }
            return ids;
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
