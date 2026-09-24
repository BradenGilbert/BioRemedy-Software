// Backup logic shared by `npm run backup` (scripts/backup-data.mjs) and the server's own schedule
// (Phase 20 item 3, 2026-09-23). One snapshot = a verified copy of backend.json in data/backups/;
// optionally mirrored, with the uploads folder, to an off-machine folder (CRM_BACKUP_DIR -- a
// OneDrive-synced path is the intended target).
//
// Retired at roadmap Phase 14, when the data moves into PostgreSQL and database backups take over.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync, existsSync, copyFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";

export const LOCAL_KEEP = 10;
export const OFF_MACHINE_KEEP = 30;
const snapshotPattern = /^backend-\d{8}-\d{6}\.json$/;

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function prune(dir, keep) {
  const pruned = [];
  const snapshots = readdirSync(dir)
    .filter((name) => snapshotPattern.test(name))
    .sort()
    .reverse();
  for (const stale of snapshots.slice(keep)) {
    unlinkSync(join(dir, stale));
    pruned.push(stale);
  }
  return { kept: Math.min(snapshots.length, keep), pruned };
}

// Writes a verified snapshot of `source` into `backupDir` and prunes to `keep`. Throws if the source
// is not valid JSON: a snapshot of a half-written file is worse than none, and a corrupt source must
// never evict good backups.
export function takeSnapshot({ source, backupDir, keep = LOCAL_KEEP }) {
  const raw = readFileSync(source, "utf8");
  const parsed = JSON.parse(raw);
  const collections = Object.keys(parsed).length;
  const fileName = `backend-${stamp()}.json`;
  const target = join(backupDir, fileName);
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(target, raw, "utf8");
  // Read it back. "Wrote the file" and "the file is good" are different claims.
  JSON.parse(readFileSync(target, "utf8"));
  const sizeKb = statSync(target).size / 1024;
  const { kept, pruned } = prune(backupDir, keep);
  return { fileName, target, collections, sizeKb, kept, pruned };
}

// Copies every file under `sourceDir` into `targetDir` that is missing there or differs in size or
// mtime. Nothing is deleted from the target: an upload removed locally stays recoverable off-machine.
function mirrorFolder(sourceDir, targetDir) {
  let copied = 0;
  let skipped = 0;
  if (!existsSync(sourceDir)) return { copied, skipped };
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fromPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fromPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const toPath = join(targetDir, relative(sourceDir, fromPath));
      const from = statSync(fromPath);
      const to = existsSync(toPath) ? statSync(toPath) : null;
      if (to && to.size === from.size && Math.abs(to.mtimeMs - from.mtimeMs) < 2000) {
        skipped += 1;
        continue;
      }
      mkdirSync(dirname(toPath), { recursive: true });
      copyFileSync(fromPath, toPath);
      copied += 1;
    }
  };
  walk(sourceDir);
  return { copied, skipped };
}

// Copies the newest snapshot and the uploads folder to the off-machine folder, keeping `keep`
// snapshots there.
export function mirrorOffMachine({ snapshotPath, uploadsDir, offMachineDir, keep = OFF_MACHINE_KEEP }) {
  mkdirSync(offMachineDir, { recursive: true });
  const target = join(offMachineDir, snapshotPath.split(/[\\/]/).pop());
  copyFileSync(snapshotPath, target);
  JSON.parse(readFileSync(target, "utf8"));
  const { kept, pruned } = prune(offMachineDir, keep);
  const uploads = mirrorFolder(uploadsDir, join(offMachineDir, "uploads"));
  return { target, kept, pruned, uploads };
}

// One full cycle: local snapshot, then the off-machine mirror when a folder is configured.
export function runBackupCycle({ source, backupDir, uploadsDir, offMachineDir = "" }) {
  const snapshot = takeSnapshot({ source, backupDir });
  const offMachine = offMachineDir ? mirrorOffMachine({ snapshotPath: snapshot.target, uploadsDir, offMachineDir }) : null;
  return { snapshot, offMachine };
}
