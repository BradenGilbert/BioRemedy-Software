// Front Line 2 — reference layers for the site map (Phase 21 W3, 2026-09-25).
//
// A reference layer is context under the walk: a parcel outline, a city storm/sewer main, a
// customer drawing. They draw dashed grey with a source/date tag (field observations draw solid
// with a number) so nobody mistakes a tax map for a survey. Two modes:
//   live      — an ArcGIS REST service queried when online (jurisdictions[].layers[] or a
//               siteReferenceLayers row with mode "live" + serviceUrl/layerId)
//   snapshot  — GeoJSON stored on the siteReferenceLayers row (always available, offline too)
// snapshotReferenceLayers() freezes whatever was on the map into siteWalkReports.referenceSnapshot
// when a walk completes, so the report shows what the salesperson saw that day.
//
// No plugin: ArcGIS REST answers GeoJSON from any FeatureServer/MapServer layer's /query, and the
// TxGIO statewide parcels MapServer (which refuses /query) answers /identify with Esri JSON that
// esriToGeoJson() converts.
import * as crm from "../app.js";

// TxGIO (Texas Geographic Information Office) StratMap Land Parcels, statewide, "most recent"
// vintage. Verified 2026-09-25: the MapServer lists Query in its capabilities but /0/query returns
// "Requested operation is not supported"; /identify by point works and returns the polygon.
export const TXGIO_PARCELS_MAPSERVER = "https://feature.geographic.texas.gov/arcgis/rest/services/Parcels/stratmap_land_parcels_48_most_recent/MapServer";

const layerCache = new Map();

function bboxParam(bbox) {
  return `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
}

// Query one layer of an ArcGIS REST service for everything inside a lat/lng bounding box.
export async function fetchArcgisLayer(serviceUrl, layerId, bboxLatLng, { outFields = "*", where = "1=1", signal } = {}) {
  // A layer id that is not a number (a placeholder like "TBD") cannot be queried; skip it quietly.
  if (!/^\d+$/.test(String(layerId ?? ""))) return { type: "FeatureCollection", features: [] };
  const base = String(serviceUrl || "").replace(/\/+$/, "");
  const url = `${base}/${encodeURIComponent(String(layerId ?? 0))}/query?where=${encodeURIComponent(where)}&geometry=${encodeURIComponent(bboxParam(bboxLatLng))}&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&outFields=${encodeURIComponent(outFields)}&returnGeometry=true&f=geojson`;
  const cacheKey = url;
  if (layerCache.has(cacheKey)) return layerCache.get(cacheKey);
  const response = await fetch(url, { mode: "cors", signal });
  if (!response.ok) throw new Error(`Layer request failed (${response.status}).`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || "Layer request failed.");
  const geojson = payload.type === "FeatureCollection" ? payload : esriToGeoJson(payload);
  layerCache.set(cacheKey, geojson);
  return geojson;
}

// Esri JSON (rings / paths / points) → GeoJSON FeatureCollection.
export function esriToGeoJson(payload) {
  const features = (payload.features || payload.results || []).map((feature) => {
    const geometry = feature.geometry || {};
    let geo = null;
    if (geometry.rings) geo = { type: geometry.rings.length > 1 ? "MultiPolygon" : "Polygon", coordinates: geometry.rings.length > 1 ? geometry.rings.map((ring) => [ring]) : [geometry.rings[0]] };
    else if (geometry.paths) geo = { type: geometry.paths.length > 1 ? "MultiLineString" : "LineString", coordinates: geometry.paths.length > 1 ? geometry.paths : geometry.paths[0] };
    else if (Number.isFinite(geometry.x) && Number.isFinite(geometry.y)) geo = { type: "Point", coordinates: [geometry.x, geometry.y] };
    return { type: "Feature", geometry: geo, properties: feature.attributes || {} };
  });
  return { type: "FeatureCollection", features: features.filter((feature) => feature.geometry) };
}

function facilityPoint(facility) {
  return crm.facilityCoordinates ? crm.facilityCoordinates(facility) : facility && Number.isFinite(Number(facility.latitude)) ? { lat: Number(facility.latitude), lng: Number(facility.longitude) } : null;
}

// One parcel by point from the statewide layer. Returns { geojson, source, sourceDate, properties }.
export async function fetchParcelAtPoint({ lat, lng }, { signal } = {}) {
  const pad = 0.002;
  const url = `${TXGIO_PARCELS_MAPSERVER}/identify?geometry=${encodeURIComponent(`${lng},${lat}`)}&geometryType=esriGeometryPoint&sr=4326&layers=all&tolerance=1&mapExtent=${encodeURIComponent(`${lng - pad},${lat - pad},${lng + pad},${lat + pad}`)}&imageDisplay=400,400,96&returnGeometry=true&f=json`;
  const response = await fetch(url, { mode: "cors", signal });
  if (!response.ok) throw new Error(`Parcel lookup failed (${response.status}).`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || "Parcel lookup failed.");
  const geojson = esriToGeoJson(payload);
  if (!geojson.features.length) throw new Error("No parcel polygon at that point.");
  const properties = geojson.features[0].properties || {};
  let title = "";
  try {
    const meta = await fetch(`${TXGIO_PARCELS_MAPSERVER}?f=json`, { mode: "cors", signal }).then((res) => (res.ok ? res.json() : null));
    title = meta?.documentInfo?.Title || "";
  } catch {
    // Metadata is a nicety for the source tag.
  }
  const year = /(\d{4})/.exec(title)?.[1] || "";
  return {
    geojson,
    properties,
    source: `County appraisal district via TxGIO ${title || "StratMap Land Parcels"}`,
    sourceDate: year ? `${year} vintage` : "",
  };
}

// Fetch the parcel under a facility's point and save it as a siteReferenceLayers snapshot row.
export async function fetchParcelForFacility(facilityId) {
  const facility = crm.findFacility(facilityId);
  if (!facility) throw new Error("Facility not found.");
  const point = facilityPoint(facility);
  if (!point) throw new Error("This facility has no coordinates yet — add latitude/longitude on the facility first.");
  const parcel = await fetchParcelAtPoint(point);
  const props = parcel.properties;
  const label = [props.SITUS_ADDR?.trim() || facility.name, props.OWNER_NAME?.trim() ? `owner ${props.OWNER_NAME.trim()}` : ""].filter(Boolean).join(" — ");
  const existing = (crm.state.backend.siteReferenceLayers || []).find((row) => row.facilityId === facilityId && row.kind === "parcel" && !row.deletedAt);
  const row = {
    ...(existing || {}),
    id: existing?.id || crm.makeId("ref-layer"),
    facilityId,
    jurisdictionId: existing?.jurisdictionId || "",
    kind: "parcel",
    label: `Parcel (approximate): ${label}`.slice(0, 160),
    mode: "snapshot",
    serviceUrl: TXGIO_PARCELS_MAPSERVER,
    layerId: "0",
    geojson: parcel.geojson,
    documentId: "",
    source: parcel.source,
    sourceDate: parcel.sourceDate || new Date().toISOString().slice(0, 10),
    visibility: "internal",
    properties: { propId: props.PROP_ID || "", ownerName: props.OWNER_NAME || "", situsAddress: props.SITUS_ADDR || "", legalArea: props.LEGAL_AREA || "", gisArea: props.GIS_AREA || "" },
    fetchedAt: new Date().toISOString(),
  };
  return crm.saveBackendRecord("siteReferenceLayers", row, { refresh: false });
}

function boundsContain(bounds, point) {
  if (!bounds || !point) return false;
  return point.lat <= Number(bounds.north) && point.lat >= Number(bounds.south) && point.lng <= Number(bounds.east) && point.lng >= Number(bounds.west);
}

// The layers to show at a facility: its own snapshot/live rows plus every live layer of a
// jurisdiction whose bounds contain the facility (or whose name matches the facility's city).
export function layersForFacility(facilityId) {
  const facility = crm.findFacility(facilityId);
  const point = facility ? facilityPoint(facility) : null;
  const rows = (crm.state.backend.siteReferenceLayers || []).filter((row) => !row.deletedAt && (row.facilityId === facilityId || (!row.facilityId && row.jurisdictionId)));
  const layers = rows
    .filter((row) => row.facilityId === facilityId || (row.jurisdictionId && jurisdictionCovers(row.jurisdictionId, facility, point)))
    .map((row) => ({
      id: row.id,
      label: row.label || row.kind || "Reference layer",
      kind: row.kind || "other",
      mode: row.mode || (row.geojson ? "snapshot" : "live"),
      geojson: row.geojson || null,
      serviceUrl: row.serviceUrl || "",
      layerId: row.layerId ?? "",
      source: row.source || "",
      sourceDate: row.sourceDate || "",
      visible: true,
    }));
  (crm.state.backend.jurisdictions || [])
    .filter((jurisdiction) => !jurisdiction.deletedAt && jurisdictionCovers(jurisdiction.id, facility, point, jurisdiction))
    .forEach((jurisdiction) => {
      (jurisdiction.layers || []).forEach((layer) => {
        const id = `${jurisdiction.id}:${layer.key || layer.layerId}`;
        if (layers.some((item) => item.id === id)) return;
        layers.push({
          id,
          label: `${layer.label || layer.key} (${jurisdiction.name})`,
          kind: layer.kind || "utility",
          mode: layer.mode || "live",
          geojson: layer.geojson || null,
          serviceUrl: layer.serviceUrl || "",
          layerId: layer.layerId ?? 0,
          source: jurisdiction.name,
          sourceDate: jurisdiction.lastImportedAt ? String(jurisdiction.lastImportedAt).slice(0, 10) : "live",
          visible: true,
        });
      });
    });
  return layers;
}

function jurisdictionCovers(jurisdictionId, facility, point, jurisdiction = null) {
  const row = jurisdiction || (crm.state.backend.jurisdictions || []).find((item) => item.id === jurisdictionId);
  if (!row) return false;
  if (row.bounds && point) return boundsContain(row.bounds, point);
  if (facility?.city && row.name) return String(row.name).toLowerCase().includes(String(facility.city).toLowerCase());
  return false;
}

// Resolve the live layers (fetch by bbox) so the map can draw them; snapshots pass straight through.
export async function resolveLayers(layers, bboxLatLng) {
  const online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  return Promise.all(
    layers.map(async (layer) => {
      if (layer.geojson || layer.mode !== "live" || !layer.serviceUrl || !online) return layer;
      try {
        const geojson = await fetchArcgisLayer(layer.serviceUrl, layer.layerId, bboxLatLng);
        return { ...layer, geojson, sourceDate: layer.sourceDate && layer.sourceDate !== "live" ? layer.sourceDate : `live ${new Date().toISOString().slice(0, 10)}` };
      } catch {
        return { ...layer, geojson: null, error: "unavailable" };
      }
    }),
  );
}

// A bounding box `meters` around a point.
export function bboxAround(point, meters = 300) {
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.cos((point.lat * Math.PI) / 180));
  return { north: point.lat + dLat, south: point.lat - dLat, east: point.lng + dLng, west: point.lng - dLng };
}

// Freeze the layers that were on the walk's map into the report.
export async function snapshotReferenceLayers(walk, bounds) {
  const facilityId = walk?.facilityId || "";
  const layers = facilityId ? layersForFacility(facilityId) : [];
  const resolved = await resolveLayers(layers, bounds || (facilityId ? bboxAround(facilityPoint(crm.findFacility(facilityId)) || { lat: 0, lng: 0 }) : null));
  return {
    capturedAt: new Date().toISOString(),
    bounds: bounds || null,
    layers: resolved
      .filter((layer) => layer.geojson)
      .map((layer) => ({ layerId: layer.id, label: layer.label, kind: layer.kind, geojson: layer.geojson, source: layer.source, sourceDate: layer.sourceDate })),
  };
}

// The style the map uses for every reference layer (kept here so the list and the map agree).
export const REFERENCE_LAYER_STYLE = { color: "#9aa4ad", weight: 2, dashArray: "6 6", fillColor: "#9aa4ad", fillOpacity: 0.06 };
