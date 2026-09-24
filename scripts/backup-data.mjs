// Rolling backup for data/backend.json — the only copy of all shared collections.
//
//   npm run backup
//
// Writes a timestamped, verified snapshot into data/backups/ (rolling 10) and, when CRM_BACKUP_DIR is
// set, mirrors the newest snapshot plus data/uploads/ to that off-machine folder (rolling 30). The
// server runs the same cycle itself on startup and every CRM_BACKUP_INTERVAL_MINUTES (default 240) --
// see scripts/backup-lib.mjs and server.mjs. This command is for taking one by hand.
//
// Retired at roadmap Phase 14, when the data moves into PostgreSQL and database backups take over.

import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBackupCycle } from "./backup-lib.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = process.env.CRM_DATA_DIR ? resolve(process.env.CRM_DATA_DIR) : join(projectRoot, "data");

try {
  const { snapshot, offMachine } = runBackupCycle({
    source: join(dataDir, "backend.json"),
    backupDir: join(dataDir, "backups"),
    uploadsDir: join(dataDir, "uploads"),
    offMachineDir: process.env.CRM_BACKUP_DIR ? resolve(process.env.CRM_BACKUP_DIR) : "",
  });
  console.log(`✓ ${snapshot.fileName}  (${snapshot.collections} collections, ${snapshot.sizeKb.toFixed(1)} KB)`);
  snapshot.pruned.forEach((name) => console.log(`  pruned ${name}`));
  console.log(`  ${snapshot.kept} snapshots kept in ${join(dataDir, "backups")}`);
  if (offMachine) {
    console.log(`✓ off-machine copy: ${offMachine.target} (${offMachine.kept} kept; uploads: ${offMachine.uploads.copied} copied, ${offMachine.uploads.skipped} unchanged)`);
  } else {
    console.log("  CRM_BACKUP_DIR is not set — no off-machine copy.");
  }
} catch (error) {
  console.error(`✗ backup failed — ${error.message}`);
  process.exit(1);
}
