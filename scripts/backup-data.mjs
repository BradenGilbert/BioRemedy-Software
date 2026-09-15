// Rolling backup for data/backend.json — the only copy of all shared collections.
//
//   npm run backup
//
// Writes a timestamped snapshot into data/backups/ and prunes to the newest
// KEEP files. Verifies the snapshot parses as JSON before pruning anything, so
// a corrupt source can never quietly evict good backups.
//
// Retired at roadmap Phase 08, when the data moves into PostgreSQL and real
// database backups take over.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const KEEP = 10;
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(projectRoot, "data", "backend.json");
const backupDir = join(projectRoot, "data", "backups");

const raw = readFileSync(source, "utf8");

// Parse before writing. A snapshot of a half-written file is worse than none.
let parsed;
try {
  parsed = JSON.parse(raw);
} catch (error) {
  console.error(`✗ ${source} is not valid JSON — no backup taken.`);
  console.error(`  ${error.message}`);
  process.exit(1);
}

const collections = Object.keys(parsed).length;
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
const target = join(backupDir, `backend-${stamp}.json`);

mkdirSync(backupDir, { recursive: true });
writeFileSync(target, raw, "utf8");

// Read it back. "Wrote the file" and "the file is good" are different claims.
JSON.parse(readFileSync(target, "utf8"));

const sizeKb = (statSync(target).size / 1024).toFixed(1);
console.log(`✓ backend-${stamp}.json  (${collections} collections, ${sizeKb} KB)`);

const snapshots = readdirSync(backupDir)
  .filter((name) => /^backend-\d{8}-\d{6}\.json$/.test(name))
  .sort()
  .reverse();

for (const stale of snapshots.slice(KEEP)) {
  unlinkSync(join(backupDir, stale));
  console.log(`  pruned ${stale}`);
}

console.log(`  ${Math.min(snapshots.length, KEEP)} of ${KEEP} snapshots kept in data/backups/`);
