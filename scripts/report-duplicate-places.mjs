// Likely duplicate places -- a dry-run report for the owner (Phase 25 D.3, 2026-09-29).
//
//   node scripts/report-duplicate-places.mjs                  report against data/backend.json
//   node scripts/report-duplicate-places.mjs --data <dir>     report against another data folder
//   node scripts/report-duplicate-places.mjs --json           the same findings as JSON
//
// Owner: "there are multiple locations with the same address now. We need to make sure this is avoided
// and we combine these as much as possible." This script changes nothing. It lists
//   1. pairs of facilities that look like the same place, and
//   2. clusters of places (facilities and locations) at one address or within ~75 m of each other that
//      include a location not yet attached to a facility (a spill origin, a walk check-in, a crew ping),
// so they can be merged by hand with the Wave D merge tools.
//
// The matching rules are not copied here: the block between "PLACE-MATCH RULES BEGIN/END" in app.js is
// read out of app.js and run, so this report and the in-app "This looks like an existing site" prompt
// always agree.

import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const dataDir = resolve(option("--data", process.env.CRM_DATA_DIR || join(projectRoot, "data")));
const asJson = args.includes("--json");

// ---- the shared rules, from app.js ----
const appSource = readFileSync(join(projectRoot, "app.js"), "utf8");
const begin = appSource.indexOf("// PLACE-MATCH RULES BEGIN");
const end = appSource.indexOf("// PLACE-MATCH RULES END");
if (begin < 0 || end < begin) {
  console.error("Could not find the PLACE-MATCH RULES block in app.js.");
  process.exit(1);
}
const rules = new Function(`${appSource.slice(begin, end)}\nreturn { comparePlaces, parsePlaceAddress, PLACE_MATCH_RADIUS_METERS };`)();

// ---- the data ----
const data = JSON.parse(readFileSync(join(dataDir, "backend.json"), "utf8"));
const live = (rows) => (rows || []).filter((row) => !row.deletedAt);
const facilities = live(data.facilities);
const locations = live(data.locations);
const projects = live(data.projects);
const accounts = new Map((data.accounts || []).map((account) => [account.id, account]));
const facilityById = new Map(facilities.map((facility) => [facility.id, facility]));
const projectFacility = new Map(projects.map((project) => [project.id, project.facilityId || ""]));
const real = (value) => (value !== "" && value != null && Number.isFinite(Number(value)) ? Number(value) : null);
const hasPoint = (row) => real(row.latitude) !== null && real(row.longitude) !== null;
const isPing = (location) => /^(check-in|job event)$/i.test(String(location.locationType || ""));
const effectiveFacilityId = (location) => location.facilityId || projectFacility.get(location.projectId) || "";

// Same order as facilityCoordinates() in app.js: the primary Facility-type point, the facility row,
// then a non-ping GPS point at the facility.
function facilityPoint(facility) {
  const own = locations.filter((location) => location.facilityId === facility.id && location.locationType === "Facility" && hasPoint(location));
  const primary = own.find((location) => location.isPrimary) || own[0];
  if (primary) return { lat: Number(primary.latitude), lng: Number(primary.longitude) };
  if (real(facility.latitude) !== null && real(facility.longitude) !== null) return { lat: Number(facility.latitude), lng: Number(facility.longitude) };
  const point = locations.find((location) => effectiveFacilityId(location) === facility.id && hasPoint(location) && !isPing(location));
  return point ? { lat: Number(point.latitude), lng: Number(point.longitude) } : null;
}

const nodes = [
  ...facilities.map((facility) => {
    const point = facilityPoint(facility);
    return {
      kind: "facility",
      id: facility.id,
      record: facility,
      name: facility.name || "",
      addressLine: [facility.street1 || facility.address, facility.city, facility.stateOrProvince, facility.postalCode].filter(Boolean).join(", "),
      place: {
        name: facility.name || "",
        address: rules.parsePlaceAddress({ street: facility.street1 || facility.address || "", city: facility.city || "", zip: facility.postalCode || "" }),
        lat: point ? point.lat : null,
        lng: point ? point.lng : null,
      },
    };
  }),
  // A facility's own point is the facility; it is compared as the facility.
  ...locations
    .filter((location) => !(location.locationType === "Facility" && facilityById.has(location.facilityId)))
    .map((location) => ({
      kind: "location",
      id: location.id,
      record: location,
      name: location.label || "",
      addressLine: location.addressText || "",
      place: {
        name: location.label || "",
        address: rules.parsePlaceAddress({ text: location.addressText || "" }),
        lat: real(location.latitude),
        lng: real(location.longitude),
      },
    })),
];

const fmtDistance = (meters) => (meters === null || meters === undefined ? "" : meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`);
const describe = (match) =>
  match.codes
    .map((code) => ({ address: "same address", "similar-address": "similar address", nearby: `${fmtDistance(match.distanceM)} apart`, name: "similar name" })[code])
    .join(", ");

// ---- 1. facility pairs ----
const facilityNodes = nodes.filter((node) => node.kind === "facility");
const facilityPairs = [];
for (let i = 0; i < facilityNodes.length; i += 1) {
  for (let j = i + 1; j < facilityNodes.length; j += 1) {
    const match = rules.comparePlaces(facilityNodes[i].place, facilityNodes[j].place);
    if (match) facilityPairs.push({ a: facilityNodes[i], b: facilityNodes[j], match });
  }
}
facilityPairs.sort((x, y) => y.match.score - x.match.score);

// ---- 2. place clusters (address or distance; a name alone does not join a cluster) ----
const parent = nodes.map((_, index) => index);
const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));
const edges = [];
for (let i = 0; i < nodes.length; i += 1) {
  for (let j = i + 1; j < nodes.length; j += 1) {
    const match = rules.comparePlaces(nodes[i].place, nodes[j].place);
    if (!match || !match.codes.some((code) => code !== "name")) continue;
    edges.push({ i, j, match });
    parent[find(i)] = find(j);
  }
}
const groups = new Map();
nodes.forEach((node, index) => {
  const root = find(index);
  if (!groups.has(root)) groups.set(root, []);
  groups.get(root).push(index);
});
const clusters = [...groups.values()]
  .filter((members) => members.length > 1)
  .map((members) => {
    const memberNodes = members.map((index) => nodes[index]);
    const facilityIds = new Set(memberNodes.filter((node) => node.kind === "facility").map((node) => node.id));
    const unattached = memberNodes.filter((node) => node.kind === "location" && !facilityIds.has(effectiveFacilityId(node.record)));
    const siteIds = new Set(memberNodes.map((node) => (node.kind === "facility" ? node.id : effectiveFacilityId(node.record))));
    const clusterEdges = edges.filter((edge) => members.includes(edge.i) && members.includes(edge.j));
    return { members: memberNodes, facilityCount: facilityIds.size, unattached, siteIds, edges: clusterEdges };
  })
  // Worth a look: two facilities at one place, points at one place filed under different facilities (or
  // none), or a point with no facility at all. Points all filed under the same facility are fine.
  .filter((cluster) => cluster.facilityCount > 1 || cluster.siteIds.size > 1 || cluster.siteIds.has(""))
  .sort((a, b) => b.members.length - a.members.length);

// ---- 3. phone pings far from (or with no) site to measure against ----
const walkFacility = new Map(live(data.scheduleEvents).map((event) => [event.id, event.facilityId || ""]));
const pings = locations
  .filter((location) => isPing(location) && hasPoint(location))
  .map((location) => {
    const facilityId = location.facilityId || walkFacility.get(location.scheduleEventId) || effectiveFacilityId(location);
    const facility = facilityById.get(facilityId) || null;
    const site = facility ? facilityPoint(facility) : null;
    const distanceM = site ? rules.comparePlaces({ name: "", address: {}, lat: Number(location.latitude), lng: Number(location.longitude) }, { name: "", address: {}, lat: site.lat, lng: site.lng }, Infinity)?.distanceM ?? null : null;
    return { location, facility, distanceM };
  })
  .filter((row) => row.distanceM === null || row.distanceM > 500);

const summarizeNode = (node) => {
  const record = node.record;
  const account = accounts.get(record.accountId || "")?.name || "";
  const point = node.place.lat !== null ? `${node.place.lat.toFixed(5)}, ${node.place.lng.toFixed(5)}` : "no GPS";
  if (node.kind === "facility") return { kind: "Facility", id: node.id, name: node.name, address: node.addressLine, gps: point, account, note: "" };
  const facilityId = effectiveFacilityId(record);
  const notes = [
    record.locationType || "untyped",
    record.source || "",
    facilityId ? `at facility ${facilityById.get(facilityId)?.name || facilityId}` : "not attached to a facility",
    record.projectId ? `project ${record.projectId}` : "",
    isPing(record) ? "phone ping -- may have been taken away from the site" : "",
  ].filter(Boolean);
  return { kind: "Location", id: node.id, name: node.name, address: node.addressLine, gps: point, account, note: notes.join("; ") };
};

if (asJson) {
  console.log(
    JSON.stringify(
      {
        dataDir,
        facilityPairs: facilityPairs.map((pair) => ({ a: summarizeNode(pair.a), b: summarizeNode(pair.b), reasons: pair.match.codes, distanceM: pair.match.distanceM === null ? null : Math.round(pair.match.distanceM) })),
        clusters: clusters.map((cluster) => ({ members: cluster.members.map(summarizeNode), links: cluster.edges.map((edge) => ({ a: nodes[edge.i].id, b: nodes[edge.j].id, reasons: edge.match.codes, distanceM: edge.match.distanceM === null ? null : Math.round(edge.match.distanceM) })) })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const line = (text = "") => console.log(text);
line(`Duplicate places report (dry run -- nothing is changed)`);
line(`Data: ${join(dataDir, "backend.json")}`);
line(`${facilities.length} live facilities, ${locations.length} live locations; match radius ${rules.PLACE_MATCH_RADIUS_METERS} m.`);
line();
line(`1. Facilities that look like the same place (${facilityPairs.length})`);
if (!facilityPairs.length) line("   None.");
facilityPairs.forEach((pair, index) => {
  const a = summarizeNode(pair.a);
  const b = summarizeNode(pair.b);
  line(`   ${index + 1}. ${describe(pair.match)}`);
  line(`      - ${a.name} [${a.id}] ${a.address || "(no address)"} | ${a.gps}${a.account ? ` | ${a.account}` : ""}`);
  line(`      - ${b.name} [${b.id}] ${b.address || "(no address)"} | ${b.gps}${b.account ? ` | ${b.account}` : ""}`);
});
line();
line(`2. Places at one address or within ${rules.PLACE_MATCH_RADIUS_METERS} m that are not combined yet (${clusters.length})`);
if (!clusters.length) line("   None.");
clusters.forEach((cluster, index) => {
  const anchor = cluster.members.find((node) => node.kind === "facility") || cluster.members[0];
  line(`   ${index + 1}. Around "${anchor.name}"${anchor.addressLine ? ` -- ${anchor.addressLine}` : ""} (${cluster.members.length} records)`);
  cluster.members.forEach((node) => {
    const row = summarizeNode(node);
    line(`      - ${row.kind}: ${row.name || "(no label)"} [${row.id}]`);
    line(`          ${row.address || "(no address)"} | ${row.gps}${row.account ? ` | ${row.account}` : ""}${row.note ? ` | ${row.note}` : ""}`);
  });
  line(`      why: ${cluster.edges.map((edge) => `${nodes[edge.i].id} ~ ${nodes[edge.j].id} (${describe(edge.match)})`).join("; ")}`);
  const facilityCount = cluster.facilityCount;
  line(
    `      suggest: ${
      facilityCount > 1
        ? "merge the facilities into one (Facility > Merge), then attach the loose points to it."
        : facilityCount === 1
          ? `attach the ${cluster.unattached.length} loose point(s) to "${anchor.name}" (Locations > Attach to facility).`
          : "if this is a place we go back to, promote one point to a facility and attach the others; otherwise leave them."
    }`,
  );
});
line();
line(`3. Phone pings more than 500 m from their facility, or with no facility coordinates to check against (${pings.length})`);
if (!pings.length) line("   None.");
pings.forEach((row, index) => {
  const location = row.location;
  const where = row.facility ? (row.distanceM === null ? `"${row.facility.name}" has no coordinates to check against` : `${fmtDistance(row.distanceM)} from "${row.facility.name}"`) : "no facility";
  line(`   ${index + 1}. ${location.label || "(no label)"} [${location.id}] ${Number(location.latitude).toFixed(5)}, ${Number(location.longitude).toFixed(5)} | ${location.locationType} | ${where} | ${location.lastPingAt || location.capturedAt || ""}`);
});
line();
line("Phone pings (walk check-ins, crew arrivals) are listed so desk-GPS points can be spotted; since Phase 25 D they are never used as a site.");
