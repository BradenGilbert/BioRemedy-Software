// Front Line 2 — the read-only share page at /walk/<token> (Phase 21 W3, 2026-09-25).
//
// No app shell, no sign-in, no app.js: the token in the path is the only credential. The page
// reads `GET /api/walk/<token>/data` → { report, observations, documents:[{id, caption, mimeType,
// viewUrl}], opportunityName, facilityName, facility:{latitude,longitude}?, updatedAt }, mounts the
// map core in view mode, lists the numbered observations with a photo lightbox and polls every
// 30 s while the walk is live. `?fixture=<url>` reads that JSON instead (tests, and W1's route
// absent in a worktree).
import { createSiteMap, PIN_KINDS, SHAPE_KINDS, SHAPE_COLORS } from "./map-core.js";

const params = new URLSearchParams(location.search);
const fixture = params.get("fixture") || "";
const token = fixture ? "" : decodeURIComponent(location.pathname.split("/").filter(Boolean).pop() || "");
const dataUrl = fixture || `/api/walk/${encodeURIComponent(token)}/data`;

const elements = {
  title: document.getElementById("shareTitle"),
  subtitle: document.getElementById("shareSubtitle"),
  status: document.getElementById("shareStatus"),
  map: document.getElementById("shareMap"),
  body: document.getElementById("shareBody"),
  lightbox: document.getElementById("shareLightbox"),
};

let api = null;
let lastSignature = "";
let pollTimer = 0;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function timeLabel(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function dateTimeLabel(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function viewUrlFor(documents, id) {
  const document = documents.find((item) => item.id === id);
  return document?.viewUrl || (token ? `/api/walk/${encodeURIComponent(token)}/documents/${encodeURIComponent(id)}/view` : "");
}

function backgroundsFrom(payload) {
  const documents = payload.documents || [];
  return [{ id: "aerial", kind: "aerial", label: "Aerial" }, ...((payload.report?.backgrounds || []).map((background) => ({ ...background, imageUrl: background.imageUrl || viewUrlFor(documents, background.documentId) })))];
}

function centerFrom(payload) {
  const facility = payload.facility || {};
  if (Number.isFinite(Number(facility.latitude)) && Number.isFinite(Number(facility.longitude))) return { lat: Number(facility.latitude), lng: Number(facility.longitude) };
  const checkIn = payload.report?.checkIn;
  if (checkIn && Number.isFinite(Number(checkIn.lat))) return { lat: Number(checkIn.lat), lng: Number(checkIn.lng) };
  const pin = (payload.observations || []).find((row) => Number.isFinite(Number(row.lat)));
  return pin ? { lat: Number(pin.lat), lng: Number(pin.lng) } : null;
}


// The Walk tab's photo trays and required shots, grouped by section (2026-09-25: the share page only
// showed pin photos before, and a walk's photos mostly live here).
const WALK_SECTION_TITLES = { access: "Access & staging", hazards: "Hazards & PPE", area: "Area of concern", waste: "Waste streams expected", needs: "Needs", contacts: "Contacts met", notes: "Notes", measurements: "Measurements" };

function renderWalkPhotos(payload, documents) {
  const sections = payload.report?.sections || {};
  const groups = [];
  for (const [key, section] of Object.entries(sections)) {
    const shotByDocument = new Map();
    for (const [label, shot] of Object.entries(section?.shots || {})) {
      const id = typeof shot === "string" ? shot : shot?.documentId;
      if (id) shotByDocument.set(id, label);
    }
    const ids = [...new Set([...(section?.photoDocumentIds || []), ...shotByDocument.keys()])];
    const photos = ids
      .map((id) => ({ id, url: viewUrlFor(documents, id), caption: shotByDocument.get(id) || documents.find((item) => item.id === id)?.caption || "" }))
      .filter((photo) => photo.url && documents.some((item) => item.id === photo.id));
    if (photos.length) groups.push({ title: WALK_SECTION_TITLES[key] || key, photos });
  }
  if (!groups.length) return "";
  return `<section class="share-gallery">
    <h2>Walk photos</h2>
    ${groups
      .map(
        (group) => `<h3>${esc(group.title)}</h3>
      <div class="sitemap-popup-photos share-gallery-grid">${group.photos
        .map((photo) => `<button type="button" class="share-photo" data-photo="${esc(photo.url)}" data-caption="${esc(photo.caption)}"><img src="${esc(photo.url)}" alt="${esc(photo.caption)}" loading="lazy" />${photo.caption ? `<small>${esc(photo.caption)}</small>` : ""}</button>`)
        .join("")}</div>`,
      )
      .join("")}
  </section>`;
}

// Phase 25 items 8-9 (2026-09-29): the walk's sketches and measurements.
function renderSketches(payload, documents) {
  const sketches = (payload.report?.sketchDocumentIds || []).filter((id) => documents.some((item) => item.id === id)).map((id) => ({ id, url: viewUrlFor(documents, id), caption: documents.find((item) => item.id === id)?.caption || "Site sketch" }));
  if (!sketches.length) return "";
  return `<section class="share-gallery share-sketches">
    <h2>Site sketch${sketches.length === 1 ? "" : "es"}</h2>
    <div class="share-gallery-grid">${sketches.map((sketch) => `<button type="button" class="share-photo" data-photo="${esc(sketch.url)}" data-caption="${esc(sketch.caption)}"><img src="${esc(sketch.url)}" alt="${esc(sketch.caption)}" loading="lazy" /><small>${esc(sketch.caption)}</small></button>`).join("")}</div>
  </section>`;
}

const METHOD_LABELS = { scan: "Scan", tape: "Tape / wheel", "gps-walk": "GPS walk", estimate: "Estimate" };

function renderMeasurements(payload) {
  const rows = payload.report?.measurements || [];
  if (!rows.length) return "";
  const value = (item) => {
    const main = item.value !== undefined && item.value !== null && item.value !== "" ? `${item.value} ${item.unit || ""}`.trim() : item.area ? `${item.area} ${item.areaUnit || "sq ft"}` : "";
    const extra = [item.length && item.kind !== "length" ? `${item.length} ft long` : "", item.depth && item.kind !== "depth" ? `${item.depth} ft deep` : "", item.volume && item.kind !== "volume" ? `${item.volume} cu ft` : ""].filter(Boolean);
    return [main, ...extra].filter(Boolean).join(" · ");
  };
  return `<section class="share-gallery share-measurements">
    <h2>Measurements</h2>
    <ul class="sitemap-summary-list">${rows.map((item) => `<li class="sitemap-summary-item"><div><strong>${esc(item.label || item.kind || "Measurement")}: ${esc(value(item))}</strong><small>${esc([METHOD_LABELS[item.method] || item.method || "", item.note || ""].filter(Boolean).join(" · "))}</small></div></li>`).join("")}</ul>
  </section>`;
}

function render(payload) {
  const report = payload.report || {};
  const observations = [...(payload.observations || [])].sort((a, b) => Number(a.seq) - Number(b.seq));
  const documents = payload.documents || [];
  const completed = Boolean(report.completedAt);
  document.title = `Site walk — ${payload.opportunityName || payload.facilityName || ""}`;
  elements.title.textContent = payload.opportunityName || "Site walk";
  elements.subtitle.textContent = [payload.facilityName, report.checkIn ? `checked in ${timeLabel(report.checkIn.at)}` : ""].filter(Boolean).join(" · ");
  elements.status.className = `share-status ${completed ? "is-done" : ""}`;
  elements.status.innerHTML = `<i></i><span>${completed ? `Walk completed ${esc(timeLabel(report.completedAt))}` : `Live · updated ${esc(timeLabel(payload.updatedAt || new Date().toISOString()))}`}</span>`;

  const layers = (report.referenceSnapshot?.layers || []).map((layer) => ({ id: layer.layerId, label: layer.label, kind: layer.kind, geojson: layer.geojson, source: layer.source, sourceDate: layer.sourceDate, visible: true, mode: "snapshot" }));
  const signature = JSON.stringify({ o: observations.map((row) => [row.id, row.updatedAt, (row.photoDocumentIds || []).length]), b: (report.backgrounds || []).map((background) => background.id) });
  if (!api) {
    api = createSiteMap(elements.map, { mode: "view", center: centerFrom(payload), observations, backgrounds: backgroundsFrom(payload), layers, photoUrl: (id) => viewUrlFor(documents, id) });
  } else if (signature !== lastSignature) {
    api.setBackgrounds(backgroundsFrom(payload));
    api.setObservations(observations);
  }
  lastSignature = signature;

  elements.body.innerHTML = `
    ${report.summary ? `<p class="share-summary">${esc(report.summary)}</p>` : ""}
    ${
      observations.length
        ? `<ol class="sitemap-summary-list">${observations
            .map((row) => {
              const kind = PIN_KINDS[row.kind] || PIN_KINDS.custom;
              const color = row.geometry ? SHAPE_COLORS[row.color] || SHAPE_COLORS.blue : kind.color;
              const title = row.label || (row.geometry ? SHAPE_KINDS[row.shapeKind]?.label || "Shape" : kind.label);
              const facts = [row.geometry ? SHAPE_KINDS[row.shapeKind]?.label || "Shape" : kind.label, row.areaSqFt ? `${Math.round(row.areaSqFt).toLocaleString()} sq ft` : "", row.lengthFt ? `${Math.round(row.lengthFt).toLocaleString()} ft` : "", row.accuracyM ? `GPS ±${Math.round(row.accuracyM)} m` : row.lat ? "placed manually" : row.geometry ? "" : "on plan", timeLabel(row.createdAt)].filter(Boolean);
              const photos = (row.photoDocumentIds || []).map((id) => ({ id, url: viewUrlFor(documents, id), caption: documents.find((item) => item.id === id)?.caption || "" })).filter((photo) => photo.url);
              return `
                <li class="sitemap-summary-item" data-focus="${esc(row.id)}">
                  <span class="sitemap-summary-seq" style="--pin-color:${color}">${esc(row.seq)}</span>
                  <div>
                    <strong>${esc(title)}</strong>
                    <small>${esc(facts.join(" · "))}</small>
                    ${row.note ? `<p>${esc(row.note)}</p>` : ""}
                    ${photos.length ? `<div class="sitemap-popup-photos">${photos.map((photo) => `<button type="button" class="share-photo" data-photo="${esc(photo.url)}" data-caption="${esc(photo.caption)}"><img src="${esc(photo.url)}" alt="${esc(photo.caption)}" loading="lazy" /></button>`).join("")}</div>` : ""}
                  </div>
                </li>`;
            })
            .join("")}</ol>`
        : `<div class="share-empty">No pins yet. ${completed ? "" : "This page updates as the walk goes on."}</div>`
    }
    ${renderSketches(payload, documents)}
    ${renderMeasurements(payload)}
    ${renderWalkPhotos(payload, documents)}
    <p class="share-fineprint">Imagery may be months to years old. GPS is ±3–10 m outdoors and none indoors; pins without a GPS reading were placed by hand. Reference layers (dashed grey) show their source and date; parcel lines are tax-map accuracy, not a survey. ${completed ? "" : "This link shows the walk as it is being recorded and stops working when it expires or is revoked."}</p>`;
  elements.body.querySelectorAll("[data-focus]").forEach((item) => {
    item.addEventListener("click", (event) => {
      if (event.target.closest(".share-photo")) return;
      api?.focus(item.dataset.focus);
      elements.map.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  elements.body.querySelectorAll(".share-photo").forEach((button) => {
    button.addEventListener("click", () => openLightbox(button.dataset.photo, button.dataset.caption));
  });
  return completed;
}

function openLightbox(url, caption) {
  const image = elements.lightbox.querySelector("img");
  image.src = url;
  image.alt = caption || "";
  elements.lightbox.querySelector("figcaption").textContent = caption || "";
  elements.lightbox.hidden = false;
}

elements.lightbox.querySelector("button").addEventListener("click", () => {
  elements.lightbox.hidden = true;
});
elements.lightbox.addEventListener("click", (event) => {
  if (event.target === elements.lightbox) elements.lightbox.hidden = true;
});

function showError(message) {
  elements.subtitle.textContent = "";
  elements.status.className = "share-status is-done";
  elements.status.innerHTML = `<i></i><span>Unavailable</span>`;
  elements.body.innerHTML = `<div class="share-empty">${esc(message)}</div>`;
}

async function load() {
  let response;
  try {
    response = await fetch(dataUrl, { cache: "no-store", credentials: "same-origin" });
  } catch {
    if (!api) showError("No connection. Try again when you are back online.");
    return schedule(false);
  }
  if (!response.ok) {
    showError(response.status === 404 || response.status === 410 ? "This link has expired or was revoked." : response.status === 403 ? "This link is not valid." : `The walk could not be loaded (${response.status}).`);
    return;
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    console.error("Walk data could not be parsed", error);
    showError("The walk data could not be read.");
    return;
  }
  const completed = render(payload);
  schedule(completed);
}

function schedule(completed) {
  clearTimeout(pollTimer);
  if (completed) return;
  pollTimer = setTimeout(load, 30000);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") load();
});

load();
