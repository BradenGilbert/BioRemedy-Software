// Front Line 2 — the annotated site map, pure core (Phase 21 W3, 2026-09-25).
//
// This module imports NOTHING from app.js so the recipient page (/walk/<token>, field/walk-share.js)
// can use it without the app shell. Everything app-specific (uploading photos, persisting rows,
// the current facility) comes in through the options of createSiteMap(); the wrapper in
// field/map.js supplies them for the phone tab and the office panels.
//
//   createSiteMap(container, {
//     mode: "edit" | "view",
//     center: { lat, lng }, zoom,
//     observations: [...siteWalkObservations rows], backgrounds: [{ id, kind: "aerial"|"plan", label, imageUrl, widthPx, heightPx }],
//     layers: [{ id, label, kind, geojson, source, sourceDate, visible }],
//     tileSource: "esri", offlineTiles: true,
//     onChange({ type: "add"|"update"|"remove", observation, observations }),   // every edit, one record at a time
//     onPhoto(observation, files) → Promise<documentIds[]>, photoUrl(documentId) → url,
//     onUploadPlan(file) → Promise<background>, onShare(), onBackgroundChange(id),
//     newId() → string, createdBy
//   }) → api { destroy, setObservations, setLayers, setBackground, fitAll, focus, select, startPlace, startDraw, undo, downloadCurrentArea, getMap }
//
// Pins are one record each (never a flattened image) and carry either lat/lng (aerial) or x/y in
// image pixels (an uploaded plan, drawn on L.CRS.Simple). Numbering runs across all backgrounds in
// walk order (`seq`). Lines/arrows/areas are GeoJSON in `geometry` with areaSqFt / lengthFt.

export const PIN_KINDS = {
  observation: { label: "Observation", color: "#0f5f9a", glyph: "!" },
  drain: { label: "Drain / discharge", color: "#0b7285", glyph: "≈" },
  access: { label: "Access point", color: "#2b8a3e", glyph: "→" },
  hazard: { label: "Hazard", color: "#c92a2a", glyph: "▲" },
  tank: { label: "Tank / equipment", color: "#6741d9", glyph: "▣" },
  staging: { label: "Staging", color: "#e67700", glyph: "⌂" },
  sample: { label: "Sample point", color: "#0ca678", glyph: "◇" },
  custom: { label: "Custom", color: "#495057", glyph: "✎" },
};

export const SHAPE_COLORS = {
  red: "#d9480f",
  orange: "#f08c00",
  yellow: "#f5c400",
  blue: "#1971c2",
};

export const SHAPE_KINDS = {
  line: { label: "Line", hint: "Fence, pipe run, flow path" },
  arrow: { label: "Arrow", hint: "Drainage direction, crew entry" },
  area: { label: "Area", hint: "Spill extent, staging, exclusion zone" },
};

// Basemaps. The keyless Esri endpoint the facility maps already use; Wayback releases plug in
// through the same template with a releaseId.
export const TILE_SOURCES = {
  esri: {
    label: "Esri World Imagery",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
  },
  wayback: {
    label: "Esri World Imagery Wayback",
    url: "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/{releaseId}/{z}/{y}/{x}",
    attribution: "Imagery &copy; Esri (Wayback)",
    maxZoom: 19,
  },
};
const WAYBACK_CONFIG_URL = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json";

const FIELD_DB_NAME = "environmental-crm-field";
const FIELD_DB_VERSION = 1;
const FIELD_DB_STORES = ["fieldPackages", "fieldOutbox", "fieldTiles", "fieldAreas"];

const SQ_M_TO_SQ_FT = 10.7639104;
const M_TO_FT = 3.28084;

// ---------------------------------------------------------------------------------------------
// Geometry (spherical, no plugin)
// ---------------------------------------------------------------------------------------------

export function haversineMeters(a, b) {
  const R = 6371008.8;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function pathLengthMeters(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += haversineMeters(points[index - 1], points[index]);
  return total;
}

// Spherical excess formula (the same one Leaflet.draw's GeometryUtil uses).
export function geodesicAreaSqMeters(points) {
  const R = 6378137;
  const toRad = (value) => (value * Math.PI) / 180;
  const n = points.length;
  if (n < 3) return 0;
  let area = 0;
  for (let index = 0; index < n; index += 1) {
    const p1 = points[index];
    const p2 = points[(index + 1) % n];
    area += toRad(p2.lng - p1.lng) * (2 + Math.sin(toRad(p1.lat)) + Math.sin(toRad(p2.lat)));
  }
  return Math.abs((area * R * R) / 2);
}

export function formatFeet(meters) {
  const feet = meters * M_TO_FT;
  return feet >= 1000 ? `${(feet / 5280).toFixed(2)} mi` : `${Math.round(feet).toLocaleString()} ft`;
}

export function formatSqFt(sqMeters) {
  const sqFt = sqMeters * SQ_M_TO_SQ_FT;
  return sqFt >= 43560 ? `${(sqFt / 43560).toFixed(2)} ac` : `${Math.round(sqFt).toLocaleString()} sq ft`;
}

function bearingDegrees(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ---------------------------------------------------------------------------------------------
// Offline tiles (IndexedDB `environmental-crm-field` / `fieldTiles`, key "source/z/x/y" → Blob)
// ---------------------------------------------------------------------------------------------

let fieldDbPromise = null;
export function openFieldDatabase() {
  if (fieldDbPromise) return fieldDbPromise;
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is not available."));
  fieldDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(FIELD_DB_NAME, FIELD_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of FIELD_DB_STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("The field database is blocked by another tab."));
  });
  return fieldDbPromise;
}

async function idbGet(store, key) {
  const db = await openFieldDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, "readonly").objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbPut(store, key, value) {
  const db = await openFieldDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
  });
}

export function tileKey(source, z, x, y) {
  return `${source}/${z}/${x}/${y}`;
}

export async function readStoredTile(source, z, x, y) {
  try {
    const value = await idbGet("fieldTiles", tileKey(source, z, x, y));
    return value instanceof Blob ? value : null;
  } catch {
    return null;
  }
}

function tileUrlFor(source, z, x, y, extra = {}) {
  const template = source.startsWith("wayback:") ? TILE_SOURCES.wayback.url : (TILE_SOURCES[source] || TILE_SOURCES.esri).url;
  const releaseId = source.startsWith("wayback:") ? source.slice("wayback:".length) : "";
  return template
    .replace("{releaseId}", releaseId)
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y))
    .replace(/\{(\w+)\}/g, (match, key) => (extra[key] !== undefined ? String(extra[key]) : match));
}

function lngToTileX(lng, z) {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

export function countTilesForArea(bounds, zooms) {
  let count = 0;
  for (const z of zooms) {
    const x1 = lngToTileX(bounds.west, z);
    const x2 = lngToTileX(bounds.east, z);
    const y1 = latToTileY(bounds.north, z);
    const y2 = latToTileY(bounds.south, z);
    count += (Math.abs(x2 - x1) + 1) * (Math.abs(y2 - y1) + 1);
  }
  return count;
}

// Fill the tile store for a bounding box. `bounds` = { north, south, east, west } in degrees.
export async function downloadArea({ bounds, zooms = [16, 17, 18, 19], source = "esri", label = "", onProgress, concurrency = 6, areaId = "" } = {}) {
  const jobs = [];
  for (const z of zooms) {
    const x1 = lngToTileX(bounds.west, z);
    const x2 = lngToTileX(bounds.east, z);
    const y1 = latToTileY(bounds.north, z);
    const y2 = latToTileY(bounds.south, z);
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 1) jobs.push({ z, x, y });
    }
  }
  let done = 0;
  let bytes = 0;
  let failed = 0;
  let cursor = 0;
  const total = jobs.length;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      const key = tileKey(source, job.z, job.x, job.y);
      try {
        const existing = await idbGet("fieldTiles", key);
        if (!(existing instanceof Blob)) {
          const response = await fetch(tileUrlFor(source, job.z, job.x, job.y), { mode: "cors" });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          bytes += blob.size;
          await idbPut("fieldTiles", key, blob);
        }
      } catch {
        failed += 1;
      }
      done += 1;
      if (onProgress) onProgress({ done, total, bytes, failed });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length || 1) }, worker));
  const area = { id: areaId || `area-${Date.now().toString(36)}`, label, bounds, sources: [source], zooms, tileCount: total, bytes, failed, downloadedAt: new Date().toISOString() };
  try {
    await idbPut("fieldAreas", area.id, area);
  } catch {
    // The area record is bookkeeping; the tiles are what matter offline.
  }
  return area;
}

// A tile layer that serves stored tiles first and falls back to the network. Nothing is written
// on plain browsing; downloadArea() is the only writer, so the store cannot grow by accident.
function makeStoredTileLayerClass(L) {
  return L.TileLayer.extend({
    createTile(coords, done) {
      const tile = document.createElement("img");
      tile.alt = "";
      tile.setAttribute("role", "presentation");
      tile.crossOrigin = "anonymous";
      const finish = (error) => done(error || null, tile);
      tile.addEventListener("load", () => finish(null));
      tile.addEventListener("error", () => finish(new Error("tile failed")));
      const source = this.options.tileSourceKey || "esri";
      const z = this._getZoomForUrl();
      readStoredTile(source, z, coords.x, coords.y).then((blob) => {
        if (blob) {
          const objectUrl = URL.createObjectURL(blob);
          tile.addEventListener("load", () => URL.revokeObjectURL(objectUrl), { once: true });
          tile.src = objectUrl;
        } else {
          tile.src = this.getTileUrl(coords);
        }
      });
      return tile;
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Wayback (historical imagery releases)
// ---------------------------------------------------------------------------------------------

let waybackPromise = null;
export function fetchWaybackReleases() {
  if (waybackPromise) return waybackPromise;
  waybackPromise = fetch(WAYBACK_CONFIG_URL, { mode: "cors" })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
    .then((config) =>
      Object.entries(config)
        .map(([releaseId, item]) => {
          const match = /(\d{4}-\d{2}-\d{2})/.exec(item.itemTitle || "");
          return { releaseId, title: item.itemTitle || releaseId, date: match ? match[1] : "", identifier: item.layerIdentifier || "" };
        })
        .filter((item) => item.date)
        .sort((a, b) => b.date.localeCompare(a.date)),
    )
    .catch((error) => {
      waybackPromise = null;
      throw error;
    });
  return waybackPromise;
}

// ---------------------------------------------------------------------------------------------
// Small DOM helpers (this module builds its own chrome so the share page needs no app CSS classes
// beyond field/styles.css)
// ---------------------------------------------------------------------------------------------

function escape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function el(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function pinIconHtml(observation) {
  const kind = PIN_KINDS[observation.kind] || PIN_KINDS.custom;
  return `<span class="sitemap-pin" style="--pin-color:${kind.color}"><b class="sitemap-pin-seq">${escape(observation.seq)}</b><i class="sitemap-pin-glyph" aria-hidden="true">${escape(kind.glyph)}</i></span>`;
}

// ---------------------------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------------------------

export function createSiteMap(container, options = {}) {
  const L = options.L || window.L;
  if (!L) {
    container.innerHTML = `<div class="sitemap-empty">Map library did not load.</div>`;
    return null;
  }
  const mode = options.mode === "view" ? "view" : "edit";
  const printing = Boolean(options.printing);
  const newId = options.newId || (() => `obs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const state = {
    observations: (options.observations || []).map((row) => ({ ...row })),
    backgrounds: normalizeBackgrounds(options.backgrounds),
    layers: (options.layers || []).map((layer) => ({ visible: true, ...layer })),
    activeBackgroundId: options.activeBackgroundId || "aerial",
    tileSource: options.tileSource || "esri",
    imageryLabel: "",
    center: options.center || null,
    zoom: options.zoom || 18,
    selectedId: "",
    placing: null, // { kind: "new" | "move", observationId, pinKind }
    drawing: null, // { kind: "line"|"arrow"|"area", points: [], preview }
    moving: null, // observationId being dragged
    undoStack: [],
    map: null,
    markers: new Map(),
    shapes: new Map(),
    layerGroups: new Map(),
    accuracyCircles: new Map(),
    gpsMarker: null,
    tileLayer: null,
    destroyed: false,
    suppressClickFor: "",
  };
  const StoredTileLayer = makeStoredTileLayerClass(L);

  container.classList.add("sitemap", `sitemap--${mode}`);
  if (printing) container.classList.add("sitemap--print");
  container.innerHTML = "";
  const canvas = el(`<div class="sitemap-canvas" role="application" aria-label="Site map"></div>`);
  const crosshair = el(`<div class="sitemap-crosshair" hidden aria-hidden="true"><span></span></div>`);
  const topbar = el(`<div class="sitemap-topbar"></div>`);
  const cornerTag = el(`<div class="sitemap-imagery-tag"></div>`);
  const placebar = el(`<div class="sitemap-bar sitemap-placebar" hidden></div>`);
  const drawbar = el(`<div class="sitemap-bar sitemap-drawbar" hidden></div>`);
  const confirmbar = el(`<div class="sitemap-bar sitemap-confirmbar" hidden></div>`);
  const bottombar = el(`<div class="sitemap-bottombar"></div>`);
  const sheet = el(`<div class="sitemap-sheet" hidden></div>`);
  const panel = el(`<div class="sitemap-panel" hidden></div>`);
  const toast = el(`<div class="sitemap-toast" hidden></div>`);
  container.append(canvas, crosshair, topbar, cornerTag, placebar, drawbar, confirmbar, bottombar, sheet, panel, toast);

  let toastTimer = 0;
  function say(message, { undo } = {}) {
    clearTimeout(toastTimer);
    toast.innerHTML = `<span>${escape(message)}</span>${undo ? `<button type="button" class="sitemap-toast-undo">Undo</button>` : ""}`;
    toast.hidden = false;
    if (undo) toast.querySelector(".sitemap-toast-undo").addEventListener("click", () => {
      toast.hidden = true;
      undo();
    });
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, undo ? 6000 : 2500);
  }

  function activeBackground() {
    return state.backgrounds.find((background) => background.id === state.activeBackgroundId) || state.backgrounds[0];
  }

  function isPlan() {
    return activeBackground()?.kind === "plan";
  }

  function nextSeq() {
    return state.observations.reduce((max, row) => Math.max(max, Number(row.seq) || 0), 0) + 1;
  }

  function observationsOnActiveBackground() {
    const background = activeBackground();
    return state.observations.filter((row) => (row.backgroundId || "aerial") === (background?.id || "aerial"));
  }

  // Coordinates: on the aerial a pin is lat/lng; on a plan it is x/y pixels from the top-left of
  // the image, which L.CRS.Simple represents as latlng [heightPx - y, x].
  function toLatLng(row) {
    if (isPlan()) {
      const background = activeBackground();
      return L.latLng(Number(background.heightPx || 0) - Number(row.y || 0), Number(row.x || 0));
    }
    return L.latLng(Number(row.lat), Number(row.lng));
  }

  function fromLatLng(latLng) {
    if (isPlan()) {
      const background = activeBackground();
      return { x: Math.round(latLng.lng), y: Math.round(Number(background.heightPx || 0) - latLng.lat), lat: null, lng: null };
    }
    return { lat: Number(latLng.lat.toFixed(7)), lng: Number(latLng.lng.toFixed(7)), x: null, y: null };
  }

  function geometryPoints(row) {
    const coords = row.geometry?.coordinates;
    if (!coords) return [];
    const ring = row.geometry.type === "Polygon" ? coords[0] : coords;
    return ring.map((pair) => (isPlan() ? L.latLng(Number(activeBackground().heightPx || 0) - pair[1], pair[0]) : L.latLng(pair[1], pair[0])));
  }

  // ---- map mount / remount (a background switch changes the CRS, so the map is rebuilt) ----
  function mountMap() {
    if (state.map) {
      state.map.remove();
      state.map = null;
    }
    state.markers.clear();
    state.shapes.clear();
    state.layerGroups.clear();
    state.accuracyCircles.clear();
    state.gpsMarker = null;
    canvas.innerHTML = "";
    const background = activeBackground();
    const plan = background?.kind === "plan";
    const map = L.map(canvas, {
      crs: plan ? L.CRS.Simple : L.CRS.EPSG3857,
      zoomControl: false,
      attributionControl: !plan,
      tap: false,
      minZoom: plan ? -4 : 3,
      maxZoom: plan ? 4 : 22,
      zoomSnap: plan ? 0.25 : 1,
      scrollWheelZoom: true,
      doubleClickZoom: false,
      preferCanvas: false,
    });
    state.map = map;
    if (plan) {
      const width = Number(background.widthPx || 1000);
      const height = Number(background.heightPx || 1000);
      const bounds = L.latLngBounds([[0, 0], [height, width]]);
      L.imageOverlay(background.imageUrl, bounds, { interactive: false, alt: background.label || "Site plan" }).addTo(map);
      map.setMaxBounds(bounds.pad(0.5));
      map.fitBounds(bounds);
      cornerTag.textContent = `${background.label || "Plan"} · customer-provided, not to scale`;
      cornerTag.hidden = false;
    } else {
      state.tileLayer = new StoredTileLayer(state.tileSource.startsWith("wayback:") ? TILE_SOURCES.wayback.url.replace("{releaseId}", state.tileSource.slice(8)) : (TILE_SOURCES[state.tileSource] || TILE_SOURCES.esri).url, {
        attribution: (state.tileSource.startsWith("wayback:") ? TILE_SOURCES.wayback : TILE_SOURCES[state.tileSource] || TILE_SOURCES.esri).attribution,
        maxNativeZoom: 19,
        maxZoom: 22,
        tileSourceKey: state.tileSource,
        crossOrigin: true,
      });
      state.tileLayer.addTo(map);
      if (!printing) L.control.zoom({ position: "topright" }).addTo(map);
      if (!printing) L.control.scale({ imperial: true, metric: false, position: "bottomleft" }).addTo(map);
      cornerTag.textContent = state.imageryLabel || "Imagery: Esri World Imagery (current release)";
      cornerTag.hidden = false;
      const center = state.center && Number.isFinite(Number(state.center.lat)) ? [Number(state.center.lat), Number(state.center.lng)] : [30.63, -97.68];
      map.setView(center, state.zoom);
    }
    map.on("click", onMapClick);
    map.on("move", onMapMove);
    drawLayers();
    drawObservations();
    fitAll({ animate: false });
    setTimeout(() => {
      if (!state.destroyed && state.map) state.map.invalidateSize();
    }, 60);
    // Report tile load to a listener (the print page waits for this before printing).
    if (state.tileLayer && options.onTilesLoaded) state.tileLayer.once("load", () => options.onTilesLoaded());
    if (!state.tileLayer && options.onTilesLoaded) setTimeout(() => options.onTilesLoaded(), 200);
    renderTopbar();
  }

  function fitAll({ animate = true } = {}) {
    const map = state.map;
    if (!map) return;
    const rows = observationsOnActiveBackground();
    const points = [];
    rows.forEach((row) => {
      if (row.geometry) geometryPoints(row).forEach((point) => points.push(point));
      else points.push(toLatLng(row));
    });
    if (isPlan()) {
      if (!points.length) return;
      map.fitBounds(L.latLngBounds(points).pad(0.4), { animate });
      return;
    }
    if (points.length >= 2) map.fitBounds(L.latLngBounds(points).pad(0.3), { animate, maxZoom: 19 });
    else if (points.length === 1) map.setView(points[0], Math.max(map.getZoom(), 18), { animate });
  }

  // ---- reference layers (dashed grey, source/date tag) ----
  function drawLayers() {
    const map = state.map;
    if (!map || isPlan()) return;
    state.layers.forEach((layer) => {
      if (!layer.geojson || !layer.visible) return;
      const group = L.geoJSON(layer.geojson, {
        style: () => ({ color: "#9aa4ad", weight: 2, dashArray: "6 6", fillColor: "#9aa4ad", fillOpacity: 0.06, opacity: 0.95 }),
        pointToLayer: (feature, latLng) => L.circleMarker(latLng, { radius: 5, color: "#9aa4ad", weight: 2, fillOpacity: 0.3 }),
        onEachFeature: (feature, leafletLayer) => {
          leafletLayer.bindTooltip(`${escape(layer.label)}<br><small>${escape([layer.source, layer.sourceDate].filter(Boolean).join(" · ") || "reference layer")}</small>`, { sticky: true, className: "sitemap-layer-tip" });
        },
        interactive: mode === "view" || printing,
      });
      group.addTo(map);
      state.layerGroups.set(layer.id, group);
    });
  }

  // ---- observations ----
  function drawObservations() {
    const map = state.map;
    if (!map) return;
    state.markers.forEach((marker) => marker.remove());
    state.shapes.forEach((shape) => shape.forEach((part) => part.remove()));
    state.accuracyCircles.forEach((circle) => circle.remove());
    state.markers.clear();
    state.shapes.clear();
    state.accuracyCircles.clear();
    observationsOnActiveBackground().forEach((row) => (row.geometry ? drawShape(row) : drawPin(row)));
  }

  function drawPin(row) {
    const map = state.map;
    const latLng = toLatLng(row);
    if (!isPlan() && (!Number.isFinite(latLng.lat) || !Number.isFinite(latLng.lng))) return;
    const marker = L.marker(latLng, {
      icon: L.divIcon({ className: "sitemap-pin-wrap", html: pinIconHtml(row), iconSize: [40, 40], iconAnchor: [20, 20] }),
      title: row.label || (PIN_KINDS[row.kind] || PIN_KINDS.custom).label,
      draggable: false,
      keyboard: false,
      riseOnHover: true,
    });
    marker.on("click", (event) => {
      L.DomEvent.stop(event);
      // A long-press ends with a click too; that click must not reopen the sheet over the delete bar.
      if (state.suppressClickFor === row.id) {
        state.suppressClickFor = "";
        return;
      }
      select(row.id);
    });
    marker.on("dragend", () => {
      const before = { ...row };
      Object.assign(row, fromLatLng(marker.getLatLng()), { accuracyM: null, updatedAt: new Date().toISOString() });
      pushUndo({ type: "update", before, after: { ...row } });
      emit("update", row);
      drawAccuracy(row);
    });
    if (!isPlan() && Number(row.accuracyM) > 0) drawAccuracy(row);
    if (mode === "edit") installLongPress(marker, row);
    marker.addTo(map);
    if (mode === "view" && !printing) marker.bindPopup(() => popupHtml(row), { maxWidth: 280, className: "sitemap-popup" });
    state.markers.set(row.id, marker);
  }

  function drawAccuracy(row) {
    const existing = state.accuracyCircles.get(row.id);
    if (existing) existing.remove();
    if (isPlan() || !(Number(row.accuracyM) > 0)) return;
    const circle = L.circle(toLatLng(row), { radius: Number(row.accuracyM), color: "#ffffff", weight: 1, fillColor: "#ffffff", fillOpacity: 0.12, interactive: false });
    circle.addTo(state.map);
    state.accuracyCircles.set(row.id, circle);
  }

  function drawShape(row) {
    const map = state.map;
    const points = geometryPoints(row);
    if (points.length < 2) return;
    const color = SHAPE_COLORS[row.color] || row.color || SHAPE_COLORS.blue;
    const parts = [];
    const shapeKind = row.shapeKind || (row.geometry.type === "Polygon" ? "area" : "line");
    if (shapeKind === "area") {
      parts.push(L.polygon(points, { color, weight: 3, fillColor: color, fillOpacity: 0.22 }));
    } else {
      parts.push(L.polyline(points, { color, weight: 4, lineCap: "round", lineJoin: "round" }));
      if (shapeKind === "arrow") {
        const end = points[points.length - 1];
        const previous = points[points.length - 2];
        const angle = isPlan() ? (Math.atan2(end.lng - previous.lng, end.lat - previous.lat) * 180) / Math.PI : bearingDegrees(previous, end);
        parts.push(
          L.marker(end, {
            icon: L.divIcon({ className: "sitemap-arrowhead-wrap", html: `<span class="sitemap-arrowhead" style="--shape-color:${color};transform:rotate(${angle}deg)"></span>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
            interactive: false,
            keyboard: false,
          }),
        );
      }
    }
    const labelPoint = shapeKind === "area" ? L.latLngBounds(points).getCenter() : points[Math.floor(points.length / 2)];
    parts.push(
      L.marker(labelPoint, {
        icon: L.divIcon({ className: "sitemap-shape-label-wrap", html: `<span class="sitemap-shape-label" style="--shape-color:${color}"><b>${escape(row.seq)}</b>${row.label ? ` ${escape(row.label)}` : ""}${row.areaSqFt ? ` · ${escape(formatSqFtValue(row.areaSqFt))}` : row.lengthFt ? ` · ${escape(Math.round(row.lengthFt).toLocaleString())} ft` : ""}</span>`, iconSize: null }),
        interactive: true,
        keyboard: false,
      }),
    );
    parts.forEach((part) => {
      part.on("click", (event) => {
        L.DomEvent.stop(event);
        select(row.id);
      });
      part.addTo(map);
      if (mode === "view" && !printing && part.bindPopup) part.bindPopup(() => popupHtml(row), { maxWidth: 280, className: "sitemap-popup" });
    });
    state.shapes.set(row.id, parts);
  }

  function formatSqFtValue(sqFt) {
    return sqFt >= 43560 ? `${(sqFt / 43560).toFixed(2)} ac` : `${Math.round(sqFt).toLocaleString()} sq ft`;
  }

  function popupHtml(row) {
    const kind = PIN_KINDS[row.kind] || PIN_KINDS.custom;
    const photos = (row.photoDocumentIds || []).slice(0, 4);
    const photoUrl = options.photoUrl || (() => "");
    return `
      <div class="sitemap-popup-body">
        <strong>${escape(row.seq)}. ${escape(row.label || (row.geometry ? SHAPE_KINDS[row.shapeKind]?.label || "Shape" : kind.label))}</strong>
        <small>${escape(row.geometry ? [row.areaSqFt ? formatSqFtValue(row.areaSqFt) : "", row.lengthFt ? `${Math.round(row.lengthFt).toLocaleString()} ft` : ""].filter(Boolean).join(" · ") : kind.label)}${row.accuracyM ? ` · GPS ±${Math.round(row.accuracyM)} m` : row.lat ? " · placed manually" : ""}</small>
        ${row.note ? `<p>${escape(row.note)}</p>` : ""}
        ${photos.length ? `<div class="sitemap-popup-photos">${photos.map((id) => `<a href="${escape(photoUrl(id))}" target="_blank" rel="noopener"><img src="${escape(photoUrl(id))}" alt="" loading="lazy" /></a>`).join("")}</div>` : ""}
      </div>`;
  }

  // ---- long press = delete (with undo) ----
  function installLongPress(marker, row) {
    marker.on("add", () => {
      const element = marker.getElement();
      if (!element) return;
      let timer = 0;
      let startPoint = null;
      const clear = () => {
        clearTimeout(timer);
        timer = 0;
      };
      element.addEventListener("pointerdown", (event) => {
        startPoint = { x: event.clientX, y: event.clientY };
        clear();
        timer = setTimeout(() => {
          timer = 0;
          state.suppressClickFor = row.id;
          askDelete(row);
        }, 650);
      });
      element.addEventListener("pointermove", (event) => {
        if (startPoint && Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y) > 12) clear();
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach((name) => element.addEventListener(name, clear));
      element.addEventListener("contextmenu", (event) => event.preventDefault());
    });
  }

  function askDelete(row) {
    closeSheet();
    confirmbar.innerHTML = `
      <span>Delete ${escape(row.seq)}${row.label ? ` · ${escape(row.label)}` : ""}?</span>
      <button type="button" class="sitemap-button sitemap-button--danger" data-confirm="delete">Delete</button>
      <button type="button" class="sitemap-button sitemap-button--ghost" data-confirm="cancel">Cancel</button>`;
    confirmbar.hidden = false;
    confirmbar.querySelector('[data-confirm="delete"]').onclick = () => {
      confirmbar.hidden = true;
      removeObservation(row.id);
    };
    confirmbar.querySelector('[data-confirm="cancel"]').onclick = () => {
      confirmbar.hidden = true;
    };
  }

  // ---- edits: add / update / remove + undo ----
  function emit(type, observation) {
    if (typeof options.onChange === "function") {
      try {
        options.onChange({ type, observation: { ...observation }, observations: state.observations.map((row) => ({ ...row })) });
      } catch (error) {
        say(error?.message || "Could not save that change.");
      }
    }
  }

  function pushUndo(entry) {
    state.undoStack.push(entry);
    if (state.undoStack.length > 50) state.undoStack.shift();
    renderBottombar();
  }

  function addObservation(fields) {
    const now = new Date().toISOString();
    const row = {
      id: newId(),
      seq: nextSeq(),
      kind: "observation",
      label: "",
      note: "",
      backgroundId: activeBackground()?.id || "aerial",
      lat: null,
      lng: null,
      accuracyM: null,
      x: null,
      y: null,
      geometry: null,
      shapeKind: "",
      areaSqFt: null,
      lengthFt: null,
      color: "",
      photoDocumentIds: [],
      createdBy: options.createdBy || "",
      createdAt: now,
      updatedAt: now,
      ...fields,
    };
    state.observations.push(row);
    pushUndo({ type: "add", after: { ...row } });
    emit("add", row);
    drawObservations();
    return row;
  }

  function updateObservation(id, patch, { undoable = true } = {}) {
    const row = state.observations.find((item) => item.id === id);
    if (!row) return null;
    const before = { ...row };
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    if (undoable) pushUndo({ type: "update", before, after: { ...row } });
    emit("update", row);
    return row;
  }

  function removeObservation(id, { undoable = true } = {}) {
    const index = state.observations.findIndex((item) => item.id === id);
    if (index < 0) return;
    const [row] = state.observations.splice(index, 1);
    if (undoable) pushUndo({ type: "remove", before: { ...row } });
    emit("remove", row);
    if (state.selectedId === id) closeSheet();
    drawObservations();
    say(`Removed ${row.seq}${row.label ? ` · ${row.label}` : ""}`, { undo: () => undo() });
  }

  function undo() {
    const entry = state.undoStack.pop();
    if (!entry) return;
    if (entry.type === "add") {
      const index = state.observations.findIndex((item) => item.id === entry.after.id);
      if (index >= 0) {
        const [row] = state.observations.splice(index, 1);
        emit("remove", row);
      }
    } else if (entry.type === "remove") {
      state.observations.push({ ...entry.before });
      state.observations.sort((a, b) => Number(a.seq) - Number(b.seq));
      emit("add", entry.before);
    } else if (entry.type === "update") {
      const row = state.observations.find((item) => item.id === entry.before.id);
      if (row) {
        Object.keys(row).forEach((key) => delete row[key]);
        Object.assign(row, entry.before);
        emit("update", row);
      }
    }
    closeSheet();
    drawObservations();
    renderBottombar();
  }

  // ---- placement (crosshair) ----
  function startPlace({ kind = "new", observationId = "", pinKind = "observation" } = {}) {
    cancelDraw();
    closeSheet();
    state.placing = { kind, observationId, pinKind };
    crosshair.hidden = false;
    const moving = kind === "move";
    if (moving) {
      const row = state.observations.find((item) => item.id === observationId);
      if (row && !row.geometry) state.map.panTo(toLatLng(row), { animate: false });
    }
    placebar.innerHTML = `
      <span class="sitemap-bar-hint">${moving ? "Pan until the crosshair is on the new spot" : "Pan until the crosshair is on the spot"}</span>
      ${!isPlan() && "geolocation" in navigator ? `<button type="button" class="sitemap-button sitemap-button--secondary" data-place="gps">Use my GPS</button>` : ""}
      <button type="button" class="sitemap-button" data-place="here">${moving ? "Move here" : "Place here"}</button>
      <button type="button" class="sitemap-button sitemap-button--ghost" data-place="cancel">Cancel</button>`;
    placebar.hidden = false;
    bottombar.hidden = true;
    placebar.querySelector('[data-place="here"]').onclick = () => finishPlace(state.map.getCenter(), null);
    placebar.querySelector('[data-place="cancel"]').onclick = cancelPlace;
    const gpsButton = placebar.querySelector('[data-place="gps"]');
    if (gpsButton) gpsButton.onclick = () => useGps();
  }

  function cancelPlace() {
    state.placing = null;
    crosshair.hidden = true;
    placebar.hidden = true;
    bottombar.hidden = mode !== "edit";
  }

  function finishPlace(latLng, accuracyM) {
    const placing = state.placing;
    if (!placing) return;
    const coords = fromLatLng(latLng);
    cancelPlace();
    if (placing.kind === "move") {
      updateObservation(placing.observationId, { ...coords, accuracyM: accuracyM ?? null });
      drawObservations();
      say("Moved.");
      select(placing.observationId);
      return;
    }
    const row = addObservation({ ...coords, kind: placing.pinKind, accuracyM: accuracyM ?? null });
    select(row.id);
  }

  function useGps() {
    if (!("geolocation" in navigator)) {
      say("This device has no GPS.");
      return;
    }
    const gpsButton = placebar.querySelector('[data-place="gps"]');
    if (gpsButton) {
      gpsButton.disabled = true;
      gpsButton.textContent = "Getting a fix…";
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latLng = L.latLng(position.coords.latitude, position.coords.longitude);
        const accuracy = Math.round(position.coords.accuracy || 0);
        showGpsDot(latLng, accuracy);
        finishPlace(latLng, accuracy || null);
        say(accuracy ? `GPS fix ±${accuracy} m` : "GPS fix");
      },
      (error) => {
        if (gpsButton) {
          gpsButton.disabled = false;
          gpsButton.textContent = "Use my GPS";
        }
        say(error?.code === 1 ? "Location permission denied." : error?.code === 3 ? "GPS timed out." : "GPS unavailable.");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }

  function showGpsDot(latLng, accuracy) {
    if (isPlan() || !state.map) return;
    if (state.gpsMarker) state.gpsMarker.remove();
    state.gpsMarker = L.layerGroup([
      L.circle(latLng, { radius: Math.max(accuracy || 0, 2), color: "#4dabf7", weight: 1, fillColor: "#4dabf7", fillOpacity: 0.15, interactive: false }),
      L.circleMarker(latLng, { radius: 6, color: "#ffffff", weight: 2, fillColor: "#1c7ed6", fillOpacity: 1, interactive: false }),
    ]).addTo(state.map);
  }

  // ---- drawing (line / arrow / area by tapping vertices) ----
  function startDraw(kind) {
    cancelPlace();
    closeSheet();
    state.drawing = { kind, points: [], preview: L.layerGroup().addTo(state.map), color: kind === "area" ? "red" : "blue" };
    crosshair.hidden = true;
    bottombar.hidden = true;
    renderDrawbar();
  }

  function renderDrawbar() {
    const drawing = state.drawing;
    if (!drawing) {
      drawbar.hidden = true;
      return;
    }
    const measure = drawMeasureText();
    drawbar.innerHTML = `
      <div class="sitemap-draw-head">
        <span class="sitemap-bar-hint">${escape(SHAPE_KINDS[drawing.kind].label)} · tap to add points${drawing.kind === "area" ? " (3+)" : " (2+)"}</span>
        <strong class="sitemap-draw-measure">${escape(measure)}</strong>
      </div>
      <div class="sitemap-draw-colors" role="radiogroup" aria-label="Colour">
        ${Object.entries(SHAPE_COLORS)
          .map(([key, value]) => `<button type="button" class="sitemap-swatch ${drawing.color === key ? "is-active" : ""}" data-color="${key}" style="--swatch:${value}" aria-label="${key}"></button>`)
          .join("")}
      </div>
      <div class="sitemap-draw-actions">
        <button type="button" class="sitemap-button sitemap-button--secondary" data-draw="undo" ${drawing.points.length ? "" : "disabled"}>Undo point</button>
        <button type="button" class="sitemap-button" data-draw="done" ${drawing.points.length >= (drawing.kind === "area" ? 3 : 2) ? "" : "disabled"}>Done</button>
        <button type="button" class="sitemap-button sitemap-button--ghost" data-draw="cancel">Cancel</button>
      </div>`;
    drawbar.hidden = false;
    drawbar.querySelector('[data-draw="undo"]').onclick = () => {
      drawing.points.pop();
      updateDrawPreview();
      renderDrawbar();
    };
    drawbar.querySelector('[data-draw="done"]').onclick = finishDraw;
    drawbar.querySelector('[data-draw="cancel"]').onclick = cancelDraw;
    drawbar.querySelectorAll("[data-color]").forEach((button) => {
      button.onclick = () => {
        drawing.color = button.dataset.color;
        updateDrawPreview();
        renderDrawbar();
      };
    });
  }

  function drawMeasureText() {
    const drawing = state.drawing;
    if (!drawing || drawing.points.length < 2) return isPlan() ? "plan · not to scale" : "—";
    if (isPlan()) return `${drawing.points.length} points · not to scale`;
    if (drawing.kind === "area") return drawing.points.length >= 3 ? formatSqFt(geodesicAreaSqMeters(drawing.points)) : formatFeet(pathLengthMeters(drawing.points));
    return formatFeet(pathLengthMeters(drawing.points));
  }

  function updateDrawPreview() {
    const drawing = state.drawing;
    if (!drawing) return;
    drawing.preview.clearLayers();
    const color = SHAPE_COLORS[drawing.color];
    drawing.points.forEach((point) => drawing.preview.addLayer(L.circleMarker(point, { radius: 6, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1, interactive: false })));
    if (drawing.points.length >= 2) {
      if (drawing.kind === "area" && drawing.points.length >= 3) drawing.preview.addLayer(L.polygon(drawing.points, { color, weight: 3, dashArray: "4 4", fillColor: color, fillOpacity: 0.2, interactive: false }));
      else drawing.preview.addLayer(L.polyline(drawing.points, { color, weight: 3, dashArray: "4 4", interactive: false }));
    }
  }

  function finishDraw() {
    const drawing = state.drawing;
    if (!drawing) return;
    const minimum = drawing.kind === "area" ? 3 : 2;
    if (drawing.points.length < minimum) return;
    const toPair = (point) => (isPlan() ? [Math.round(point.lng), Math.round(Number(activeBackground().heightPx || 0) - point.lat)] : [Number(point.lng.toFixed(7)), Number(point.lat.toFixed(7))]);
    const pairs = drawing.points.map(toPair);
    const geometry = drawing.kind === "area" ? { type: "Polygon", coordinates: [[...pairs, pairs[0]]] } : { type: "LineString", coordinates: pairs };
    const areaSqFt = drawing.kind === "area" && !isPlan() ? Math.round(geodesicAreaSqMeters(drawing.points) * SQ_M_TO_SQ_FT) : null;
    const lengthFt = drawing.kind !== "area" && !isPlan() ? Math.round(pathLengthMeters(drawing.points) * M_TO_FT) : null;
    const color = drawing.color;
    cancelDraw();
    const row = addObservation({ kind: "custom", geometry, shapeKind: drawing.kind, areaSqFt, lengthFt, color });
    select(row.id);
  }

  function cancelDraw() {
    if (state.drawing) {
      state.drawing.preview.remove();
      state.drawing = null;
    }
    drawbar.hidden = true;
    bottombar.hidden = mode !== "edit";
  }

  function onMapClick(event) {
    if (state.drawing) {
      state.drawing.points.push(event.latlng);
      updateDrawPreview();
      renderDrawbar();
      return;
    }
    if (!state.placing && state.selectedId) closeSheet();
  }

  function onMapMove() {
    // nothing to do yet; kept so the crosshair could show live coordinates later
  }

  // ---- selection + pin sheet ----
  function select(id) {
    state.selectedId = id;
    const row = state.observations.find((item) => item.id === id);
    if (!row) return;
    if (typeof options.onSelect === "function") options.onSelect(row);
    if (mode !== "edit") {
      const marker = state.markers.get(id);
      if (marker) marker.openPopup();
      else {
        const parts = state.shapes.get(id);
        const withPopup = parts?.find((part) => part.getPopup && part.getPopup());
        if (withPopup) withPopup.openPopup();
      }
      return;
    }
    renderSheet(row);
  }

  function focus(id) {
    const row = state.observations.find((item) => item.id === id);
    if (!row || !state.map) return;
    if ((row.backgroundId || "aerial") !== (activeBackground()?.id || "aerial")) setBackground(row.backgroundId || "aerial");
    const target = row.geometry ? L.latLngBounds(geometryPoints(row)).getCenter() : toLatLng(row);
    state.map.setView(target, Math.max(state.map.getZoom(), isPlan() ? 0 : 19));
    select(id);
  }

  function closeSheet() {
    state.selectedId = "";
    sheet.hidden = true;
    sheet.innerHTML = "";
    if (state.moving) stopMove(false);
  }

  function renderSheet(row) {
    const kind = PIN_KINDS[row.kind] || PIN_KINDS.custom;
    const isShape = Boolean(row.geometry);
    const photoUrl = options.photoUrl || (() => "");
    const photos = row.photoDocumentIds || [];
    sheet.innerHTML = `
      <div class="sitemap-sheet-grip" aria-hidden="true"></div>
      <div class="sitemap-sheet-head">
        <span class="sitemap-sheet-pin" style="--pin-color:${isShape ? SHAPE_COLORS[row.color] || SHAPE_COLORS.blue : kind.color}">${escape(row.seq)}</span>
        <div class="sitemap-sheet-title">
          <strong>${escape(isShape ? `${SHAPE_KINDS[row.shapeKind]?.label || "Shape"}${row.areaSqFt ? ` · ${formatSqFtValue(row.areaSqFt)}` : row.lengthFt ? ` · ${Math.round(row.lengthFt).toLocaleString()} ft` : isPlan() ? " · not to scale" : ""}` : kind.label)}</strong>
          <small>${escape(isShape ? `${geometryPoints(row).length - (row.geometry?.type === "Polygon" ? 1 : 0)} points` : row.accuracyM ? `GPS ±${Math.round(row.accuracyM)} m` : isPlan() ? "on plan" : "placed manually")}</small>
        </div>
        <button type="button" class="sitemap-sheet-close" data-sheet="close" aria-label="Close">×</button>
      </div>
      <div class="sitemap-sheet-body">
        ${
          isShape
            ? `<div class="sitemap-field"><span>Colour</span><div class="sitemap-draw-colors">${Object.entries(SHAPE_COLORS)
                .map(([key, value]) => `<button type="button" class="sitemap-swatch ${row.color === key ? "is-active" : ""}" data-sheet-color="${key}" style="--swatch:${value}" aria-label="${key}"></button>`)
                .join("")}</div></div>`
            : `<label class="sitemap-field"><span>Kind</span><select data-sheet-field="kind">${Object.entries(PIN_KINDS)
                .map(([key, item]) => `<option value="${key}" ${row.kind === key ? "selected" : ""}>${escape(item.label)}</option>`)
                .join("")}</select></label>`
        }
        <label class="sitemap-field"><span>Label</span><input type="text" data-sheet-field="label" value="${escape(row.label)}" maxlength="80" placeholder="${isShape ? "e.g. Spill extent" : "e.g. Storm inlet by dock 3"}" /></label>
        <label class="sitemap-field"><span>Note</span><textarea data-sheet-field="note" rows="2" maxlength="1000" placeholder="Tap the mic on the keyboard to dictate">${escape(row.note)}</textarea></label>
        <div class="sitemap-field">
          <span>Photos ${photos.length ? `(${photos.length})` : ""}</span>
          <div class="sitemap-photo-tray">
            ${photos
              .map((id) =>
                // Phase 25 items 5-7: with onPhotoTap a photo opens the caller's action sheet (view, mark up, replace, remove).
                options.onPhotoTap
                  ? `<button type="button" class="sitemap-photo" data-sheet-photo-id="${escape(id)}" aria-label="Photo options"><img src="${escape(photoUrl(id))}" alt="" loading="lazy" /></button>`
                  : `<a class="sitemap-photo" href="${escape(photoUrl(id))}" target="_blank" rel="noopener"><img src="${escape(photoUrl(id))}" alt="" loading="lazy" /></a>`,
              )
              .join("")}
            ${options.onPhotoAdd ? `<button type="button" class="sitemap-photo-add" data-sheet-photo-add><span>+ Photo</span></button>` : options.onPhoto ? `<label class="sitemap-photo-add"><input type="file" accept="image/*" multiple data-sheet-photo /><span>+ Photo</span></label>` : ""}
          </div>
        </div>
      </div>
      <div class="sitemap-sheet-actions">
        ${!isShape ? `<button type="button" class="sitemap-button sitemap-button--secondary" data-sheet="move">Move</button>` : ""}
        <button type="button" class="sitemap-button sitemap-button--danger" data-sheet="delete">Delete</button>
        <button type="button" class="sitemap-button" data-sheet="done">Done</button>
      </div>`;
    sheet.hidden = false;
    let saveTimer = 0;
    const queueSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(commitFields, 500);
    };
    const commitFields = () => {
      clearTimeout(saveTimer);
      const patch = {};
      sheet.querySelectorAll("[data-sheet-field]").forEach((field) => {
        patch[field.dataset.sheetField] = field.value;
      });
      const changed = Object.keys(patch).some((key) => (row[key] || "") !== (patch[key] || ""));
      if (changed) {
        updateObservation(row.id, patch);
        drawObservations();
      }
    };
    sheet.querySelectorAll("[data-sheet-field]").forEach((field) => {
      field.addEventListener("input", queueSave);
      field.addEventListener("change", commitFields);
    });
    sheet.querySelectorAll("[data-sheet-color]").forEach((button) => {
      button.onclick = () => {
        updateObservation(row.id, { color: button.dataset.sheetColor });
        drawObservations();
        renderSheet(row);
      };
    });
    sheet.querySelector('[data-sheet="close"]').onclick = () => {
      commitFields();
      closeSheet();
    };
    sheet.querySelector('[data-sheet="done"]').onclick = () => {
      commitFields();
      closeSheet();
    };
    sheet.querySelector('[data-sheet="delete"]').onclick = () => {
      commitFields();
      askDelete(row);
    };
    const moveButton = sheet.querySelector('[data-sheet="move"]');
    if (moveButton) moveButton.onclick = () => {
      commitFields();
      startMove(row);
    };
    const photoInput = sheet.querySelector("[data-sheet-photo]");
    if (photoInput) photoInput.addEventListener("change", async () => {
      const files = [...(photoInput.files || [])];
      if (!files.length) return;
      commitFields();
      say(`Uploading ${files.length} photo${files.length === 1 ? "" : "s"}…`);
      try {
        const ids = await options.onPhoto({ ...row }, files);
        if (Array.isArray(ids) && ids.length) {
          updateObservation(row.id, { photoDocumentIds: [...(row.photoDocumentIds || []), ...ids] }, { undoable: false });
          say(`${ids.length} photo${ids.length === 1 ? "" : "s"} added to ${row.seq}.`);
        }
      } catch (error) {
        say(error?.message || "Photo upload failed.");
      }
      if (state.selectedId === row.id) renderSheet(row);
    });
    // Phase 25 item 6 (2026-09-29): "+ Photo" hands off to the caller (choose existing / upload new),
    // which returns the document ids to link.
    const addButton = sheet.querySelector("[data-sheet-photo-add]");
    if (addButton) addButton.onclick = async () => {
      commitFields();
      try {
        const ids = await options.onPhotoAdd({ ...row });
        const fresh = (Array.isArray(ids) ? ids : []).filter((id) => id && !(row.photoDocumentIds || []).includes(id));
        if (fresh.length) {
          updateObservation(row.id, { photoDocumentIds: [...(row.photoDocumentIds || []), ...fresh] }, { undoable: false });
          say(`${fresh.length} photo${fresh.length === 1 ? "" : "s"} added to ${row.seq}.`);
        }
      } catch (error) {
        say(error?.message || "Photo upload failed.");
      }
      if (state.selectedId === row.id) renderSheet(row);
    };
    // Items 5 and 7: a photo tap returns the pin's new photo list (a photo removed, or swapped for its
    // replacement / marked-up version), or nothing when the sheet was dismissed.
    sheet.querySelectorAll("[data-sheet-photo-id]").forEach((button) => {
      button.onclick = async () => {
        commitFields();
        try {
          const next = await options.onPhotoTap({ ...row }, button.dataset.sheetPhotoId);
          if (Array.isArray(next)) updateObservation(row.id, { photoDocumentIds: [...new Set(next.filter(Boolean))] }, { undoable: false });
        } catch (error) {
          say(error?.message || "That photo could not be changed.");
        }
        if (state.selectedId === row.id) renderSheet(row);
      };
    });
  }

  // Move = a drag handle: the pin becomes draggable until Done, or the crosshair can be used.
  function startMove(row) {
    const marker = state.markers.get(row.id);
    if (!marker) return;
    sheet.hidden = true;
    state.moving = row.id;
    marker.dragging?.enable();
    marker.getElement()?.classList.add("is-moving");
    confirmbar.innerHTML = `
      <span>Drag pin ${escape(row.seq)} to its new spot</span>
      <button type="button" class="sitemap-button sitemap-button--secondary" data-confirm="crosshair">Use crosshair</button>
      <button type="button" class="sitemap-button" data-confirm="done">Done</button>`;
    confirmbar.hidden = false;
    confirmbar.querySelector('[data-confirm="done"]').onclick = () => stopMove(true);
    confirmbar.querySelector('[data-confirm="crosshair"]').onclick = () => {
      stopMove(false);
      startPlace({ kind: "move", observationId: row.id });
    };
  }

  function stopMove(reselect) {
    const id = state.moving;
    state.moving = null;
    confirmbar.hidden = true;
    const marker = id ? state.markers.get(id) : null;
    if (marker) {
      marker.dragging?.disable();
      marker.getElement()?.classList.remove("is-moving");
    }
    if (reselect && id) select(id);
  }

  // ---- chrome: top bar (backgrounds, layers, history), bottom bar ----
  function renderTopbar() {
    if (printing) {
      topbar.hidden = true;
      return;
    }
    const background = activeBackground();
    topbar.innerHTML = `
      <div class="sitemap-topbar-left">
        <label class="sitemap-bg-switch">
          <span class="sitemap-visually-hidden">Background</span>
          <select data-bg-select aria-label="Background">
            ${state.backgrounds.map((item) => `<option value="${escape(item.id)}" ${item.id === background?.id ? "selected" : ""}>${escape(item.kind === "aerial" ? "Aerial" : `Plan: ${item.label || "untitled"}`)}</option>`).join("")}
            ${mode === "edit" && options.onUploadPlan ? `<option value="__upload">Upload plan…</option>` : ""}
          </select>
        </label>
      </div>
      <div class="sitemap-topbar-right">
        ${!isPlan() ? `<button type="button" class="sitemap-chip" data-top="history" title="Historical imagery">History</button>` : ""}
        ${state.layers.length && !isPlan() ? `<button type="button" class="sitemap-chip" data-top="layers">Layers</button>` : ""}
        <button type="button" class="sitemap-chip" data-top="fit" title="Fit to pins">Fit</button>
      </div>`;
    topbar.hidden = false;
    const select = topbar.querySelector("[data-bg-select]");
    select.onchange = async () => {
      if (select.value === "__upload") {
        select.value = background?.id || "aerial";
        pickPlanFile();
        return;
      }
      setBackground(select.value);
    };
    const history = topbar.querySelector('[data-top="history"]');
    if (history) history.onclick = () => openHistoryPanel();
    const layers = topbar.querySelector('[data-top="layers"]');
    if (layers) layers.onclick = () => openLayersPanel();
    topbar.querySelector('[data-top="fit"]').onclick = () => fitAll();
  }

  function pickPlanFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.dataset.cameraSource = "1";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      say("Uploading plan…");
      try {
        const background = await options.onUploadPlan(file);
        if (background) {
          state.backgrounds = normalizeBackgrounds([...state.backgrounds.filter((item) => item.id !== background.id), background]);
          setBackground(background.id);
          say(`Plan "${background.label || "untitled"}" added.`);
        }
      } catch (error) {
        say(error?.message || "Plan upload failed.");
      }
    });
    input.click();
  }

  function setBackground(id) {
    if (!state.backgrounds.some((item) => item.id === id)) return;
    closeSheet();
    cancelDraw();
    cancelPlace();
    state.activeBackgroundId = id;
    mountMap();
    if (typeof options.onBackgroundChange === "function") options.onBackgroundChange(id);
  }

  function renderBottombar() {
    if (mode !== "edit" || printing) {
      bottombar.hidden = true;
      return;
    }
    bottombar.innerHTML = `
      <button type="button" class="sitemap-button sitemap-button--big" data-bottom="observation">+ Observation</button>
      <button type="button" class="sitemap-button sitemap-button--big sitemap-button--secondary" data-bottom="draw">Draw</button>
      ${options.onShare ? `<button type="button" class="sitemap-button sitemap-button--big sitemap-button--secondary" data-bottom="share">Share</button>` : ""}
      <button type="button" class="sitemap-button sitemap-button--icon" data-bottom="undo" aria-label="Undo" title="Undo" ${state.undoStack.length ? "" : "disabled"}>↶</button>`;
    bottombar.hidden = false;
    bottombar.querySelector('[data-bottom="observation"]').onclick = () => openKindMenu();
    bottombar.querySelector('[data-bottom="draw"]').onclick = () => openDrawMenu();
    bottombar.querySelector('[data-bottom="undo"]').onclick = () => undo();
    const share = bottombar.querySelector('[data-bottom="share"]');
    if (share) share.onclick = () => options.onShare();
  }

  function openPanel(title, bodyHtml) {
    panel.innerHTML = `
      <div class="sitemap-panel-head"><strong>${escape(title)}</strong><button type="button" class="sitemap-sheet-close" data-panel="close" aria-label="Close">×</button></div>
      <div class="sitemap-panel-body">${bodyHtml}</div>`;
    panel.hidden = false;
    panel.querySelector('[data-panel="close"]').onclick = closePanel;
    return panel;
  }

  function closePanel() {
    panel.hidden = true;
    panel.innerHTML = "";
  }

  function openKindMenu() {
    const body = `<div class="sitemap-kind-grid">${Object.entries(PIN_KINDS)
      .map(([key, item]) => `<button type="button" class="sitemap-kind" data-kind="${key}" style="--pin-color:${item.color}"><i>${escape(item.glyph)}</i><span>${escape(item.label)}</span></button>`)
      .join("")}</div>`;
    openPanel("What are you marking?", body);
    panel.querySelectorAll("[data-kind]").forEach((button) => {
      button.onclick = () => {
        closePanel();
        startPlace({ kind: "new", pinKind: button.dataset.kind });
      };
    });
  }

  function openDrawMenu() {
    const body = `<div class="sitemap-kind-grid sitemap-kind-grid--3">${Object.entries(SHAPE_KINDS)
      .map(([key, item]) => `<button type="button" class="sitemap-kind" data-shape="${key}"><i class="sitemap-shape-glyph sitemap-shape-glyph--${key}"></i><span>${escape(item.label)}</span><small>${escape(item.hint)}</small></button>`)
      .join("")}</div>`;
    openPanel("Draw", body);
    panel.querySelectorAll("[data-shape]").forEach((button) => {
      button.onclick = () => {
        closePanel();
        startDraw(button.dataset.shape);
      };
    });
  }

  function openLayersPanel() {
    const body = `<ul class="sitemap-layer-list">${state.layers
      .map(
        (layer) => `
        <li>
          <label class="sitemap-check">
            <input type="checkbox" data-layer="${escape(layer.id)}" ${layer.visible ? "checked" : ""} ${layer.geojson ? "" : "disabled"} />
            <span><strong>${escape(layer.label)}</strong><small>${escape([layer.kind, layer.mode === "live" ? "live" : "snapshot", layer.source, layer.sourceDate].filter(Boolean).join(" · "))}${layer.geojson ? "" : " · not loaded"}</small></span>
          </label>
        </li>`,
      )
      .join("")}</ul>
      <p class="sitemap-panel-note">Reference layers are dashed grey and show their source and date. Parcel lines are tax-map accuracy, not a survey; no public map shows underground lines.</p>`;
    openPanel("Reference layers", body);
    panel.querySelectorAll("[data-layer]").forEach((input) => {
      input.onchange = () => {
        const layer = state.layers.find((item) => item.id === input.dataset.layer);
        if (layer) layer.visible = input.checked;
        state.layerGroups.forEach((group) => group.remove());
        state.layerGroups.clear();
        drawLayers();
      };
    });
  }

  async function openHistoryPanel() {
    openPanel("Imagery history", `<p class="sitemap-panel-note">Loading Esri World Imagery Wayback releases…</p>`);
    let releases = [];
    try {
      releases = await fetchWaybackReleases();
    } catch {
      openPanel("Imagery history", `<p class="sitemap-panel-note">The release list needs a connection. Showing the current imagery.</p>`);
      return;
    }
    const body = `<ul class="sitemap-layer-list sitemap-history-list">
      <li><button type="button" class="sitemap-history-item ${state.tileSource === "esri" ? "is-active" : ""}" data-release="esri"><strong>Current</strong><small>Esri World Imagery, latest release</small></button></li>
      ${releases
        .slice(0, 60)
        .map((release) => `<li><button type="button" class="sitemap-history-item ${state.tileSource === `wayback:${release.releaseId}` ? "is-active" : ""}" data-release="wayback:${escape(release.releaseId)}" data-date="${escape(release.date)}"><strong>${escape(release.date)}</strong><small>${escape(release.identifier || release.title)}</small></button></li>`)
        .join("")}
    </ul>
    <p class="sitemap-panel-note">Each release is the imagery Esri published on that date; the photo itself may be older. Not every release changed this spot.</p>`;
    openPanel("Imagery history", body);
    panel.querySelectorAll("[data-release]").forEach((button) => {
      button.onclick = () => {
        state.tileSource = button.dataset.release;
        state.imageryLabel = button.dataset.release === "esri" ? "Imagery: Esri World Imagery (current release)" : `Imagery: Wayback release ${button.dataset.date}`;
        closePanel();
        const view = state.map ? { center: state.map.getCenter(), zoom: state.map.getZoom() } : null;
        mountMap();
        if (view && state.map && !isPlan()) state.map.setView(view.center, view.zoom, { animate: false });
      };
    });
  }

  // ---- public api ----
  function setObservations(rows) {
    state.observations = (rows || []).map((row) => ({ ...row }));
    drawObservations();
    if (state.selectedId && !state.observations.some((row) => row.id === state.selectedId)) closeSheet();
  }

  function setLayers(layers) {
    state.layers = (layers || []).map((layer) => ({ visible: true, ...layer }));
    state.layerGroups.forEach((group) => group.remove());
    state.layerGroups.clear();
    drawLayers();
    renderTopbar();
  }

  function setBackgrounds(backgrounds) {
    state.backgrounds = normalizeBackgrounds(backgrounds);
    if (!state.backgrounds.some((item) => item.id === state.activeBackgroundId)) state.activeBackgroundId = "aerial";
    renderTopbar();
  }

  function currentBounds() {
    if (!state.map || isPlan()) return null;
    const bounds = state.map.getBounds();
    return { north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest() };
  }

  async function downloadCurrentArea({ zooms = [16, 17, 18, 19], label = "" } = {}) {
    const bounds = currentBounds();
    if (!bounds) throw new Error("Switch to the aerial to download tiles.");
    say("Downloading tiles…");
    const result = await downloadArea({
      bounds,
      zooms,
      source: state.tileSource,
      label,
      onProgress: ({ done, total }) => {
        toast.hidden = false;
        toast.innerHTML = `<span>Downloading tiles ${done}/${total}</span>`;
      },
    });
    say(`${result.tileCount - result.failed} tiles stored${result.failed ? `, ${result.failed} failed` : ""}.`);
    return result;
  }

  function destroy() {
    state.destroyed = true;
    if (state.map) state.map.remove();
    state.map = null;
    container.innerHTML = "";
    container.classList.remove("sitemap", `sitemap--${mode}`, "sitemap--print");
  }

  mountMap();
  renderBottombar();

  return {
    destroy,
    getMap: () => state.map,
    getObservations: () => state.observations.map((row) => ({ ...row })),
    setObservations,
    setLayers,
    setBackgrounds,
    setBackground,
    fitAll,
    focus,
    select,
    startPlace,
    startDraw,
    undo,
    currentBounds,
    downloadCurrentArea,
    activeBackground,
    say,
  };
}

function normalizeBackgrounds(list) {
  const backgrounds = (list || []).filter(Boolean).map((item) => ({ ...item }));
  if (!backgrounds.some((item) => item.kind === "aerial")) backgrounds.unshift({ id: "aerial", kind: "aerial", label: "Aerial" });
  return backgrounds;
}
