// Puts the demo data set back, explicitly (Phase 20 item 4, 2026-09-23).
//
//   node scripts/reset-demo-data.mjs [--url http://localhost:4173]
//
// Upserts every record in data/demo-seed.json through the running server's API, so the write goes
// through the same serialized, atomic path as any other save. Nothing is deleted: real records the
// pilot has added stay; demo records that were edited go back to the demo values. The server itself
// only seeds an empty collection when it starts with CRM_SEED_DEMO=1 -- an empty collection is
// otherwise left empty, which is what a pilot that has cleared the demo data needs.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const urlFlag = process.argv.indexOf("--url");
const baseUrl = (urlFlag >= 0 && process.argv[urlFlag + 1]) || process.env.CRM_URL || "http://localhost:4173";
const seed = JSON.parse(readFileSync(join(projectRoot, "data", "demo-seed.json"), "utf8"));

let written = 0;
for (const [collection, records] of Object.entries(seed)) {
  for (const record of records) {
    // No version claim: the demo values replace whatever is there.
    const { version, ...payload } = record;
    const response = await fetch(`${baseUrl}/api/backend/${collection}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CRM-Role": "Admin", "X-CRM-User": "reset-demo-data" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      console.error(`✗ ${collection}/${record.id}: ${response.status} ${body.error || ""}`);
      process.exit(1);
    }
    written += 1;
  }
  console.log(`✓ ${collection}: ${records.length} demo record${records.length === 1 ? "" : "s"}`);
}
console.log(`${written} records written to ${baseUrl}.`);
