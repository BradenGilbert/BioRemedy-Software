// Loads the DOT/PHMSA Emergency Response Guidebook (ERG 2024) into ergMaterials/ergGuides/
// ergDistances, through the running server's API (Phase 21, Front Line 2, 2026-09-25).
//
//   node scripts/import-erg.mjs --fixture [--url http://localhost:4173] [--password <break-glass>]
//   node scripts/import-erg.mjs --pdf docs/uploaded files/erg/ERG2024-Eng-Web-a.pdf ...   (not implemented here)
//
// Sign-in follows the break-glass pattern in scripts/reset-demo-data.mjs: POST /api/auth/break-glass,
// reuse the session cookie, write with X-CRM-User for attribution (the old X-CRM-Role header pattern
// in scripts/import-rate-sheet.mjs is stale and NOT used here).
//
// ---- The --fixture path (implemented) ------------------------------------------------------------
// Loads scripts/fixtures/erg-sample.json: ~25 common materials (UN1203 gasoline -> Guide 128, UN1075
// LPG -> 115, UN1017 chlorine -> 124 with its green-page isolation/protective-action distances, UN1005
// ammonia -> 125 with distances, and 21 more), their guide text (short paraphrases, not the verbatim
// ERG -- see the fixture's own header comment), and Table 1 distances for the two TIH materials the
// fixture carries. Upserts are idempotent: ids are erg-mat-<un>, erg-guide-<n>, erg-dist-<un>, so
// running this twice against the same server is a no-op the second time (same ids, same content).
//
// ---- The --pdf path (documented, not implemented) -------------------------------------------------
// The owner must save the two PHMSA PDFs from a normal browser into docs/uploaded files/erg/ --
// PHMSA's CDN returns Akamai "Access Denied" to curl, Node's fetch and headless Chromium alike
// (confirmed 2026-09-25), so this script cannot download them itself:
//   docs/uploaded files/erg/ERG2024-Eng-Web-a.pdf   (the guidebook itself: yellow/blue/orange/green pages)
//   docs/uploaded files/erg/ERG2024-v10.pdf          (the methodology behind the green-page distances)
// A real --pdf importer would use the bundled Python's pypdf (6.x, available per CLAUDE.md) to pull
// real text out of the yellow pages (UN number -> name -> guide number), the orange guide pages
// (guide number -> title -> Potential Hazards / Public Safety / Emergency Response sections), and the
// green pages (Table 1 initial isolation / protective-action distances by spill size and day/night,
// plus Table 3 for the six common TIH gases by container size). It should record the edition and the
// page ranges it read, and fail itself against a spot-check table of ten known UN numbers (their
// expected guide and, where applicable, distances) before writing anything -- the same "fail loud if
// the parse drifted" pattern scripts/import-rate-sheet.mjs uses for the rate sheet. That importer is
// NOT written in this pass (no working shell in this environment to iterate against the real PDF's
// exact layout without the file present); --fixture is what tests and the seeded demo data use today.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const baseUrl = option("--url", process.env.CRM_URL || "http://localhost:4173");
const password = option("--password", process.env.CRM_PASSWORD || "");
const useFixture = flag("--fixture");
const pdfPath = option("--pdf", "");

if (!useFixture && !pdfPath) {
  console.error("Pass --fixture (loads scripts/fixtures/erg-sample.json) or --pdf <path> (not implemented -- see this file's header comment).");
  process.exit(1);
}
if (pdfPath && !useFixture) {
  console.error("--pdf is documented but not implemented in this build; run with --fixture, or write the pypdf-based parser described at the top of this file.");
  process.exit(1);
}

const fixturePath = join(projectRoot, "scripts", "fixtures", "erg-sample.json");
if (!existsSync(fixturePath)) {
  console.error(`Fixture not found: ${fixturePath}`);
  process.exit(1);
}
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

// Ten-row spot check (small subset of the phase doc's list): the exact materials the plan named, so a
// bad fixture edit fails loudly instead of quietly importing wrong guide numbers.
const SPOT_CHECK = [
  ["1203", "128"], ["1075", "115"], ["1830", "137"], ["1993", "128"], ["1017", "124"],
  ["1005", "125"], ["1267", "128"], ["3082", "171"], ["1863", "128"], ["2031", "157"],
];
const materialByUn = new Map(fixture.materials.map((item) => [item.unNumber, item]));
for (const [un, expectedGuide] of SPOT_CHECK) {
  const material = materialByUn.get(un);
  if (!material) {
    console.error(`Spot check failed: UN${un} is missing from the fixture.`);
    process.exit(1);
  }
  if (material.guide !== expectedGuide) {
    console.error(`Spot check failed: UN${un} (${material.name}) is Guide ${material.guide} in the fixture, expected Guide ${expectedGuide}.`);
    process.exit(1);
  }
}
console.log(`Spot check passed: ${SPOT_CHECK.length} known UN numbers matched their expected guide.`);

if (!password) {
  console.error("Pass --password <break-glass password> or set CRM_PASSWORD (see data/break-glass-password.txt).");
  process.exit(1);
}
const loginResponse = await fetch(`${baseUrl}/api/auth/break-glass`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
if (!loginResponse.ok) {
  console.error(`✗ sign-in failed: ${loginResponse.status}`);
  process.exit(1);
}
const cookie = (loginResponse.headers.get("set-cookie") || "").split(";")[0];

async function upsert(collection, record) {
  const response = await fetch(`${baseUrl}/api/backend/${collection}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CRM-User": "import-erg", Cookie: cookie },
    body: JSON.stringify(record),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`${collection}/${record.id}: ${response.status} ${body.error || ""}`);
  }
}

let written = 0;
for (const material of fixture.materials) {
  await upsert("ergMaterials", {
    id: `erg-mat-${material.unNumber}`,
    unNumber: material.unNumber,
    name: material.name,
    guide: material.guide,
    tihFlag: Boolean(material.tihFlag),
    source: "fixture",
    edition: "2024 (fixture sample)",
  });
  written += 1;
}
console.log(`✓ ergMaterials: ${fixture.materials.length} rows`);

for (const guide of fixture.guides) {
  await upsert("ergGuides", {
    id: `erg-guide-${guide.guide}`,
    guide: guide.guide,
    title: guide.title,
    sections: guide.sections,
    source: "fixture",
    edition: "2024 (fixture sample)",
  });
  written += 1;
}
console.log(`✓ ergGuides: ${fixture.guides.length} rows`);

for (const distance of fixture.distances || []) {
  await upsert("ergDistances", {
    id: `erg-dist-${distance.unNumber}`,
    unNumber: distance.unNumber,
    name: distance.name,
    small: distance.small,
    large: distance.large,
    source: "fixture",
    edition: "2024 (fixture sample)",
  });
  written += 1;
}
console.log(`✓ ergDistances: ${(fixture.distances || []).length} rows`);

console.log(`${written} records written to ${baseUrl} from the fixture. This is a small sample (${fixture.materials.length} materials), not the full ERG 2024 -- see this file's header comment for the real PDF import path.`);
