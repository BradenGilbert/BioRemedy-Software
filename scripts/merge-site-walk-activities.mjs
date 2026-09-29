// One-time clean-up: one timeline record per site walk (Phase 25 Wave B, 2026-09-29).
//
//   node scripts/merge-site-walk-activities.mjs                          dry run, against data/backend.json
//   node scripts/merge-site-walk-activities.mjs --data <dir>             dry run, against another data folder
//   node scripts/merge-site-walk-activities.mjs --password <pw> [--url URL]           dry run, read from a running server
//   node scripts/merge-site-walk-activities.mjs --apply --password <pw> [--url URL]   write through the running server
//
// Before Wave B, completing a walk on the phone never found the Meeting that scheduling had created
// (the server looked for regardingScheduleEventId, which the client never set), so it pushed a second
// activity -- `type:"Site Visit"`, no activityType, no owner -- and the Meeting stayed "Scheduled"
// forever. For every site walk with a completed report this script:
//   1. finds the scheduled Meeting (the event's activityId, else a Meeting with regardingScheduleEventId);
//   2. finds the strays (any other live activity with regardingScheduleEventId = the walk, or
//      siteWalkReportId = its report);
//   3. folds the strays into the Meeting exactly as the server's completion now does (status Completed,
//      "Site walk completed — <facility>", activityType Meeting, tag Site Visit, an owner,
//      siteWalkReportId, the summary as description, the walk in relatedRecords) and soft-deletes them;
//   4. marks the walk's schedule event Completed and points its activityId at the Meeting.
// A walk with no Meeting but a stray has the stray promoted to the Meeting instead.
// --password (or CRM_PASSWORD) is the break-glass password; writes go through the API, never the file.

import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const dataDir = resolve(option("--data", process.env.CRM_DATA_DIR || join(projectRoot, "data")));
const baseUrl = option("--url", process.env.CRM_URL || "http://localhost:4173");
const password = option("--password", process.env.CRM_PASSWORD || "");
const apply = flag("--apply");

if (apply && !password) {
  console.error("--apply needs the break-glass password: pass --password <pw> or set CRM_PASSWORD (see data/break-glass-password.txt).");
  process.exit(1);
}

let headers = null;
async function call(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${payload.error || ""}`);
  return payload;
}

let data;
if (password) {
  const loginResponse = await fetch(`${baseUrl}/api/auth/break-glass`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  if (!loginResponse.ok) {
    console.error(`✗ sign-in failed: ${loginResponse.status}`);
    process.exit(1);
  }
  headers = { "Content-Type": "application/json", "X-CRM-User": "merge-site-walk-activities", Cookie: (loginResponse.headers.get("set-cookie") || "").split(";")[0] };
  data = await call("GET", "/api/backend");
  console.log(`Reading ${baseUrl}${apply ? "" : " (dry run)"}`);
} else {
  data = JSON.parse(readFileSync(join(dataDir, "backend.json"), "utf8"));
  console.log(`Reading ${join(dataDir, "backend.json")} (dry run)`);
}

const live = (rows) => (rows || []).filter((row) => !row.deletedAt);
const activities = live(data.activities);
const reports = live(data.siteWalkReports);
const walks = live(data.scheduleEvents).filter((event) => event.kind === "site_walk");
const facilityName = (id) => live(data.facilities).find((row) => row.id === id)?.name || "";
const opportunityName = (id) => {
  const row = live(data.opportunities).find((item) => item.id === id);
  return row?.name || row?.opportunityName || "";
};
const describe = (activity) => `${activity.id} [${activity.activityType || `type:${activity.type || "?"}`}, ${activity.status || "?"}] "${activity.subject || ""}"`;

const plan = [];
for (const event of walks) {
  const report = reports.find((row) => row.walkEventId === event.id && row.completedAt);
  if (!report) continue;
  const meeting =
    (event.activityId && activities.find((row) => row.id === event.activityId)) ||
    activities.find((row) => row.regardingScheduleEventId === event.id && row.activityType === "Meeting" && !/completed/i.test(row.subject || "") && row.type !== "Site Visit") ||
    null;
  const strays = activities.filter((row) => row.id !== meeting?.id && (row.regardingScheduleEventId === event.id || (row.siteWalkReportId && row.siteWalkReportId === report.id)));
  const target = meeting || strays[0] || null;
  const remove = meeting ? strays : strays.slice(1);
  if (!target) {
    plan.push({ event, report, note: "no activity at all -- the next completion (or a re-save) creates one; nothing merged" });
    continue;
  }
  const alreadyClean = !remove.length && target.status === "Completed" && target.siteWalkReportId === report.id && target.activityType === "Meeting" && event.activityId === target.id && event.status === "Completed";
  if (alreadyClean) {
    plan.push({ event, report, target, note: "already one Completed record" });
    continue;
  }
  const facilityId = event.facilityId || report.facilityId || "";
  const placeName = facilityName(facilityId) || opportunityName(event.opportunityId);
  const pieces = [target, ...remove];
  const related = [
    ...pieces.flatMap((row) => (Array.isArray(row.relatedRecords) ? row.relatedRecords : [])),
    ...(event.opportunityId ? [{ type: "opportunity", id: event.opportunityId }] : []),
    ...(facilityId ? [{ type: "facility", id: facilityId }] : []),
    { type: "siteWalk", id: event.id },
  ].filter((item, index, list) => item?.id && list.findIndex((other) => other.type === item.type && other.id === item.id) === index);
  const knownOwner = pieces.map((row) => row.owner).find((owner) => owner && owner !== "Unassigned") || report.completedBy || "Unassigned";
  const merged = {
    ...target,
    activityType: "Meeting",
    kind: "Meeting",
    subject: `Site walk completed${placeName ? ` — ${placeName}` : ""}`,
    status: "Completed",
    tags: [...new Set([...pieces.flatMap((row) => (Array.isArray(row.tags) ? row.tags : [])), "Site Visit"])],
    regardingScheduleEventId: event.id,
    siteWalkReportId: report.id,
    description: report.summary || pieces.map((row) => row.description).find(Boolean) || "",
    occurredAt: report.completedAt,
    completedAt: report.completedAt,
    relatedRecords: related,
    owner: target.owner && target.owner !== "Unassigned" ? target.owner : knownOwner,
    author: target.author && target.author !== "Unassigned" ? target.author : knownOwner,
    accountId: target.accountId || event.accountId || "",
    opportunityId: target.opportunityId || event.opportunityId || "",
    channel: target.activityType === "Meeting" ? target.channel || "In person" : "In person",
    direction: "Internal",
  };
  if (!target.activityDate) merged.activityDate = event.date || String(report.completedAt).slice(0, 10);
  delete merged.type;
  if (target.activityType !== "Meeting") {
    // A promoted stray was re-saved by the client as a Task; a site walk is a Meeting.
    merged.priority = "";
    merged.meetingFormat = "Offline";
    merged.dueDate = merged.activityDate || merged.dueDate || "";
  }
  const eventUpdate = event.activityId !== target.id || event.status !== "Completed" ? { ...event, activityId: target.id, status: "Completed" } : null;
  plan.push({ event, report, target, merged, remove, eventUpdate });
}

console.log(`Site walks with a completed report: ${plan.length}`);
let changes = 0;
for (const item of plan) {
  console.log(`\n• ${item.event.id} — ${item.event.title || ""}`);
  console.log(`  report ${item.report.id}, completed ${item.report.completedAt}`);
  if (item.note) {
    console.log(`  ${item.note}${item.target ? `: ${describe(item.target)}` : ""}`);
    continue;
  }
  changes += 1;
  console.log(`  keep   ${describe(item.target)}`);
  console.log(`      -> [Meeting, Completed] "${item.merged.subject}", owner ${item.merged.owner}, tags ${item.merged.tags.join("/")}, regarding ${item.merged.relatedRecords.map((row) => row.type).join("/")}`);
  for (const stray of item.remove) console.log(`  delete ${describe(stray)}`);
  if (item.eventUpdate) console.log(`  event  status ${item.event.status || "?"} -> Completed, activityId ${item.event.activityId || "(none)"} -> ${item.target.id}`);
}

if (!apply) {
  console.log(`\n${changes} walk${changes === 1 ? "" : "s"} to merge.${changes ? " Run again with --apply --password <pw> to write through the server." : ""}`);
} else {
  // (No process.exit here: exiting with fetch sockets open trips a libuv assertion on Windows.)
  let written = 0;
  let deleted = 0;
  for (const item of plan) {
    if (item.note) continue;
    await call("POST", "/api/backend/activities", item.merged);
    written += 1;
    for (const stray of item.remove) {
      try {
        await call("DELETE", `/api/backend/activities/${encodeURIComponent(stray.id)}`);
        deleted += 1;
      } catch (error) {
        if (!/already deleted/.test(error.message)) throw error;
      }
    }
    if (item.eventUpdate) await call("POST", "/api/backend/scheduleEvents", item.eventUpdate);
  }
  console.log(`\nApplied: ${written} Meeting${written === 1 ? "" : "s"} updated, ${deleted} stray activit${deleted === 1 ? "y" : "ies"} soft-deleted.`);
}
