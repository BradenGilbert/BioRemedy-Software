// Front Line 2 — the job page (Phase 21, W2, 2026-09-25).
//
// field-job: four tabs (Brief / Safety / Work / Close) over crm.state.fieldJobTab, a status ladder
// button pinned at the bottom, and a quick-capture bar. Safety and Work are built in safety.js /
// capture.js; Brief and Close live here since they're mostly read-only wiring over data other
// workstreams and app.js already expose.
import * as crm from "../app.js";
import { registerFieldRoute, registerFieldAction, registerFieldForm, currentFieldEmployee } from "./index.js";
import * as fieldPackage from "./package.js";
import { renderSafetyTab, afterSafetyRender } from "./safety.js";
import { renderWorkTab, afterCaptureRender } from "./capture.js";

function currentJob() {
  return crm.findDispatchJob(crm.state.frontlineSelectedJobId);
}

function isFieldLead(job, employee) {
  if (!job || !employee) return false;
  if (job.fieldLeadEmployeeId === employee.id) return true;
  return crm.dispatchAssignmentsForJob(job.id).some((a) => a.employeeId === employee.id && a.isFieldLead);
}

function isOnJob(job, employee) {
  if (!job || !employee) return false;
  return job.fieldLeadEmployeeId === employee.id || crm.dispatchAssignmentsForJob(job.id).some((a) => a.employeeId === employee.id);
}

const TABS = [
  { key: "brief", label: "Brief" },
  { key: "safety", label: "Safety" },
  { key: "work", label: "Work" },
  { key: "close", label: "Close" },
];

function renderJob() {
  const job = currentJob();
  const employee = currentFieldEmployee();
  if (!job) return `<section class="field-card"><p>Job not found.</p><button class="field-button field-button--secondary" type="button" data-view="field-jobs">All jobs</button></section>`;
  if (!isOnJob(job, employee)) {
    return `<section class="field-card"><p>You're not assigned to this job.</p><button class="field-button field-button--secondary" type="button" data-view="field-home">My Day</button></section>`;
  }
  const lead = isFieldLead(job, employee);
  const tab = TABS.some((t) => t.key === crm.state.fieldJobTab) ? crm.state.fieldJobTab : "brief";
  if (tab === "close" && !lead) crm.state.fieldJobTab = "brief"; // Close is lead-only; guard a stale link.
  const activeTab = tab === "close" && !lead ? "brief" : tab;
  const nextTransition = crm.getNextDispatchTransition(job.status);
  const holdTransition = crm.getDispatchHoldTransition ? crm.getDispatchHoldTransition(job.status) : null;
  const gate = lead ? crm.getWorkPlanGate(job) : { blocked: true, reason: "Only the field lead can advance the job." };
  const project = job.projectId ? crm.findProject(job.projectId) : null;
  const account = project?.accountId ? crm.findAccount(project.accountId) : null;
  const unread = crm.frontlineUnreadTotal ? crm.getMessages().filter((m) => m.threadKey === job.id && m.senderRole === "office" && !m.readAt).length : 0;

  return `
    <div class="field-job">
      <section class="field-card field-job-header">
        <div class="field-card-row">
          <strong>${crm.escapeHtml(job.jobNumber || "")}</strong>
          ${crm.renderDispatchStatusBadge(job.status)}
          ${crm.renderReadinessBadge(crm.getJobReadiness(job).status)}
        </div>
        <span>${crm.escapeHtml(account?.name || job.customerName || "")}</span>
        <small class="field-card-sub">${crm.escapeHtml(job.addressText || job.locationName || "")}</small>
      </section>

      <div class="field-quick-bar">
        <button class="field-icon-button" type="button" data-field-action="field-quick-photo">Photo</button>
        <button class="field-icon-button" type="button" data-field-action="field-quick-video">Video</button>
        <button class="field-icon-button" type="button" data-field-action="field-quick-note">Note</button>
        <button class="field-icon-button" type="button" data-action="frontline-messaging-open-thread" data-thread="${crm.escapeAttribute(job.id)}">Message${unread ? ` (${unread})` : ""}</button>
      </div>
      <input type="file" id="fieldQuickPhotoInput" accept="image/png,image/jpeg" capture="environment" style="display:none" data-camera-ready="1" data-job-id="${crm.escapeAttribute(job.id)}" />

      <nav class="field-tabs" role="tablist">
        ${TABS.filter((t) => t.key !== "close" || lead)
          .map((t) => `<button class="field-tab ${activeTab === t.key ? "is-active" : ""}" type="button" data-field-action="field-job-tab" data-tab="${t.key}">${crm.escapeHtml(t.label)}</button>`)
          .join("")}
      </nav>

      <div class="field-tab-panel">
        ${activeTab === "brief" ? renderBriefTab(job, project, account) : ""}
        ${activeTab === "safety" ? renderSafetyTab(job, employee, lead) : ""}
        ${activeTab === "work" ? renderWorkTab(job, employee, lead) : ""}
        ${activeTab === "close" && lead ? renderCloseTab(job, employee) : ""}
      </div>

      ${
        holdTransition && lead
          ? `<button class="field-button field-button--secondary field-hold-button" type="button" data-field-action="field-job-timer" data-timer="stop" data-id="${crm.escapeAttribute(job.id)}">${crm.escapeHtml(holdTransition.label)}</button>`
          : ""
      }
      ${
        job.status === "on_hold"
          ? `<p class="help-text field-gap">On hold -- the job timer is stopped and the crew is clocked out. Resume work clocks everyone on site back in.</p>`
          : ""
      }
      ${
        nextTransition
          ? `<button class="field-button field-button--primary-bar" type="button" data-field-action="${job.status === "on_hold" ? "field-job-timer" : "field-advance-job"}" data-timer="start" data-id="${crm.escapeAttribute(job.id)}" data-to="${crm.escapeAttribute(nextTransition.status)}" ${gate.blocked ? "disabled" : ""}>${crm.escapeHtml(nextTransition.label)}</button>
           ${gate.blocked ? `<p class="help-text field-gap" data-advance-blocked>${crm.escapeHtml(gate.reason || "")}</p>` : ""}
           ${gate.blocked && gate.viaBriefing && activeTab !== "safety" ? `<button class="mini-button" type="button" data-field-action="field-job-tab" data-tab="safety">Open the Safety tab</button>` : ""}`
          : ""
      }
    </div>
  `;
}

function afterJob() {
  afterSafetyRender();
  afterCaptureRender();
}

registerFieldRoute("field-job", { title: "Job", render: renderJob, after: afterJob });

registerFieldAction("field-job-tab", (button) => {
  crm.state.fieldJobTab = button.dataset.tab;
  crm.render();
});

// Item 10 (2026-09-28 IT report): every weather snapshot on a location-only site failed because
// nothing on the advance path ever sent a position. On On site / Start work, grab a GPS fix -- 10 s,
// non-blocking: a denied permission or a timeout still lets the advance go through with no position.
const GPS_ADVANCE_STATUSES = new Set(["on_site", "in_progress"]);
function getAdvanceGpsFix(toStatus) {
  if (!GPS_ADVANCE_STATUSES.has(toStatus) || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    navigator.geolocation.getCurrentPosition(
      (position) => finish({ lat: position.coords.latitude, lng: position.coords.longitude, accuracyM: Math.round(position.coords.accuracy || 0) }),
      () => finish(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
    setTimeout(() => finish(null), 10000);
  });
}

function localDateIso(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Phase 25 A.1 (2026-09-29): the ONE way the phone -- and the desktop Front Line simulator, through
// app.js frontlineCompleteStatusAction()/frontlineAutoAdvanceJob() -- moves a job's status: the
// POST /api/field/jobs/:id/advance command, through the offline outbox. The Work tab's "Acknowledge
// dispatch" step used to save dispatchJobs.status through the raw backend route instead; the server
// drops `status` from a field login's row save, so the job never moved and the bottom button kept
// saying "Mark acknowledged". Both now run this, so they can't disagree: each reads job.status after.
//
// Resolves {ok, queued, blocked, reason, job}; never throws. Offline, the command is queued and the
// new status is applied to the local row so the ladder moves on screen (the server re-checks every
// gate when the command replays).
export async function advanceJobFromField(jobId, toStatus = "") {
  const job = crm.findDispatchJob(jobId);
  const transition = job ? crm.getNextDispatchTransition(job.status) : null;
  if (!job || !transition) return { ok: false, reason: "This job has no next status." };
  const target = toStatus || transition.status;
  if (target !== transition.status) return { ok: false, blocked: true, reason: `This job is ${crm.formatDispatchStatus(job.status)}; the next step is "${transition.label}".` };
  const gate = crm.getWorkPlanGate(job);
  if (gate.blocked) return { ok: false, blocked: true, reason: gate.reason || "That job can't advance yet." };
  const fix = await getAdvanceGpsFix(target);
  const body = { toStatus: target, at: new Date().toISOString(), localDate: localDateIso() };
  if (fix) Object.assign(body, { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM });
  try {
    const updated = await fieldPackage.fieldRequest(`/api/field/jobs/${encodeURIComponent(jobId)}/advance`, {
      method: "POST",
      kind: "advance",
      label: `Advance job → ${transition.label}`,
      body,
      apply: () =>
        fieldPackage.mergeRow("dispatchJobs", {
          id: job.id,
          status: target,
          dispatchStatus: transition.dispatchStatus,
          completionPercent: Math.max(Number(job.completionPercent || 0), transition.completionPercent),
        }),
    });
    if (!updated) return { ok: true, queued: true, job: crm.findDispatchJob(jobId) };
    fieldPackage.mergeRow("dispatchJobs", updated);
    await crm.refreshBackendState().catch(() => {});
    return { ok: true, queued: false, job: crm.findDispatchJob(jobId) || updated };
  } catch (error) {
    if (/does not have advance yet/.test(error.message || "")) {
      await crm.advanceDispatchJob(jobId, { silent: true });
      const after = crm.findDispatchJob(jobId);
      return after?.status === target ? { ok: true, queued: false, job: after } : { ok: false, reason: "Could not advance the job." };
    }
    // The server's refusal comes back as {error, blocked:true} (see server.mjs's error handler);
    // this used to read a `reason` field that never existed, so every block said "can't advance yet".
    return { ok: false, blocked: Boolean(error?.payload?.blocked), reason: error?.payload?.error || error?.message || "Could not advance the job." };
  }
}

registerFieldAction("field-advance-job", async (button) => {
  if (button.disabled) return;
  button.disabled = true;
  const result = await advanceJobFromField(button.dataset.id, button.dataset.to);
  crm.render();
  if (!result.ok) crm.showToast(result.reason || "Could not advance the job.");
  else if (result.queued) crm.showToast("Offline -- the status change is queued and will sync when you're back online.");
});

// ---------------------------------------------------------------------------------------------
// Phase 25 Wave F (2026-09-30): the job timer, and what a performed work-plan task does to the job
// ---------------------------------------------------------------------------------------------

// The client twin of server.mjs JOB_TIMER_ACTIONS (used for the offline optimistic apply only; the
// server decides).
const TIMER_RULES = {
  start: { from: ["on_site", "on_hold"], to: "in_progress", dispatchStatus: "In field", completionPercent: 25, verb: "Start work" },
  stop: { from: ["in_progress"], to: "on_hold", dispatchStatus: "On hold", completionPercent: 25, verb: "Put on hold" },
  complete: { from: ["in_progress", "on_hold"], to: "field_complete", dispatchStatus: "Returned", completionPercent: 100, verb: "Complete job" },
};

// POST /api/field/jobs/:id/timer through the outbox. Resolves {ok, queued, blocked, reason, job,
// opened, closed}; never throws. Offline, the status and the job's open entries are applied locally
// (start adds provisional entries for everyone on site) and the server re-checks everything when the
// command replays.
export async function jobTimerFromField(jobId, timerAction, { actionId = "" } = {}) {
  const job = crm.findDispatchJob(jobId);
  const rule = TIMER_RULES[timerAction];
  if (!job || !rule) return { ok: false, reason: "Unknown job timer action." };
  if (job.status !== rule.to && !rule.from.includes(job.status)) {
    return { ok: false, blocked: true, reason: `This job is ${crm.formatDispatchStatus(job.status)}; "${rule.verb}" needs it ${rule.from.map(crm.formatDispatchStatus).join(" or ")}.` };
  }
  if (timerAction === "start" && job.status !== "in_progress") {
    const briefing = crm.briefingReadiness(job);
    if (!briefing.ready) return { ok: false, blocked: true, viaBriefing: true, reason: briefing.reason };
  }
  const at = new Date().toISOString();
  const body = { action: timerAction, actionId, at, localDate: localDateIso() };
  const applyLocally = () => {
    fieldPackage.mergeRow("dispatchJobs", { id: job.id, status: rule.to, dispatchStatus: rule.dispatchStatus, completionPercent: Math.max(Number(job.completionPercent || 0), rule.completionPercent) });
    const entries = crm.state.backend.timeEntries || [];
    if (timerAction === "start") {
      const present = crm.briefingReadiness(job).present.filter((row) => row.employeeId);
      for (const row of present) {
        if (entries.some((entry) => entry.employeeId === row.employeeId && entry.dispatchJobId === job.id && !entry.endedAt && !entry.deletedAt)) continue;
        entries.push({ id: crm.makeId("time-entry"), employeeId: row.employeeId, dispatchJobId: job.id, entryType: "Work", startedAt: at, endedAt: null, durationMinutes: null, source: "job-timer", pendingSync: true });
      }
    } else {
      entries.forEach((entry, index) => {
        if (entry.dispatchJobId !== job.id || entry.endedAt || entry.deletedAt) return;
        if (timerAction === "stop" && String(entry.entryType || "").toLowerCase() !== "work") return;
        entries[index] = { ...entry, endedAt: at, durationMinutes: Math.max(0, Math.round((Date.parse(at) - Date.parse(entry.startedAt)) / 60000)) };
      });
    }
    crm.state.backend.timeEntries = entries;
  };
  try {
    const result = await fieldPackage.fieldRequest(`/api/field/jobs/${encodeURIComponent(jobId)}/timer`, {
      method: "POST",
      kind: "job-timer",
      label: `Job timer — ${rule.verb}`,
      body,
      apply: applyLocally,
    });
    if (!result) return { ok: true, queued: true, job: crm.findDispatchJob(jobId), opened: [], closed: [] };
    if (result.job) fieldPackage.mergeRow("dispatchJobs", result.job);
    for (const entry of [...(result.opened || []), ...(result.closed || [])]) fieldPackage.mergeRow("timeEntries", entry);
    if (result.statusEvent) fieldPackage.mergeRow("jobStatusEvents", result.statusEvent);
    return { ok: true, queued: false, job: crm.findDispatchJob(jobId) || result.job, opened: result.opened || [], closed: result.closed || [], statusChanged: Boolean(result.statusChanged) };
  } catch (error) {
    return { ok: false, blocked: Boolean(error?.payload?.blocked), reason: error?.payload?.error || error?.message || "The job timer could not be changed." };
  }
}

function describeTimerResult(result, timerAction) {
  if (!result.ok) return result.reason || "The job timer could not be changed.";
  if (result.queued) return `Offline -- "${TIMER_RULES[timerAction].verb}" is queued and will sync when you're back online.`;
  const clock = [result.opened.length ? `${result.opened.length} clocked in` : "", result.closed.length ? `${result.closed.length} clocked out` : ""].filter(Boolean).join(", ");
  return `Job is ${crm.formatDispatchStatus(result.job?.status)}${clock ? ` -- ${clock}` : ""}.`;
}

registerFieldAction("field-job-timer", async (button) => {
  if (button.disabled) return;
  button.disabled = true;
  const timerAction = button.dataset.timer;
  const result = await jobTimerFromField(button.dataset.id, timerAction);
  crm.render();
  crm.showToast(describeTimerResult(result, timerAction));
});

// What happens after a work-plan task is performed and saved (app.js frontlineCompleteAction and
// friends call this once the action row is Complete): its Timer option runs the job timer, "Delete on
// server" archives the job (the phone asked for confirmation before the task was submitted -- see
// app.js confirmJobActionRemoval), and "Delete on device" drops the job from this phone. Resolves
// {messages[], removed, archived, timer}; never throws.
export async function performJobActionEffects(actionId) {
  const action = crm.findJobAction(actionId);
  const outcome = { messages: [], removed: false, archived: false, timer: null };
  if (!action) return outcome;
  const jobId = action.jobId;
  if (action.timerAction && action.timerAction !== "none" && TIMER_RULES[action.timerAction]) {
    const result = await jobTimerFromField(jobId, action.timerAction, { actionId });
    outcome.timer = result;
    outcome.messages.push(result.ok ? describeTimerResult(result, action.timerAction) : `The job timer did not change: ${result.reason}`);
  }
  if (action.deleteOnServer) {
    try {
      await fieldPackage.fieldRequest(`/api/field/jobs/${encodeURIComponent(jobId)}/actions/${encodeURIComponent(actionId)}/archive`, {
        method: "POST",
        kind: "archive-job",
        label: `Remove job from the server — ${action.name}`,
        body: {},
      });
      outcome.archived = true;
      outcome.removed = true;
      outcome.messages.push("The job was removed from the server (archived; the office can restore it).");
    } catch (error) {
      outcome.messages.push(`The job could not be removed from the server: ${error?.payload?.error || error?.message || "refused"}`);
    }
  }
  if (action.deleteOnDevice) {
    outcome.removed = true;
    if (!outcome.archived) outcome.messages.push("The job was removed from this device.");
  }
  if (outcome.removed) await fieldPackage.dropJobFromDevice(jobId);
  return outcome;
}

// ---------------------------------------------------------------------------------------------
// Quick bar
// ---------------------------------------------------------------------------------------------

registerFieldAction("field-quick-photo", () => document.getElementById("fieldQuickPhotoInput")?.click());
registerFieldAction("field-quick-video", () => {
  const job = currentJob();
  // Item 8b (2026-09-28 IT report): openVideoCapture was handed the whole job record as its options
  // object, which the upload rejected ("Unknown record type") -- it wants {entityType, entityId}.
  if (window.fieldMedia?.openVideoCapture) window.fieldMedia.openVideoCapture({ entityType: "dispatchJob", entityId: job?.id || "", documentType: "site-video" });
  else crm.showToast("Video capture is not available yet.");
});
registerFieldAction("field-quick-note", () => {
  crm.state.frontlineAdHocType = "Note";
  crm.state.fieldJobTab = "work";
  crm.render();
});

document.addEventListener("change", async (event) => {
  const input = event.target.closest("#fieldQuickPhotoInput");
  if (!input || !input.files?.[0]) return;
  const jobId = input.dataset.jobId;
  const file = input.files[0];
  try {
    // Item 8b/8c: no X-Document-Type meant these landed untyped, so the report (which reads
    // documentType job-photo/site-photo) never picked them up. includeInReport defaults true for a
    // field capture -- a second write after the upload, since /api/documents doesn't take it as a
    // header (see server.mjs's documents metadata route).
    const uploaded = await fieldPackage.uploadFieldFile(`/api/documents`, file, { "X-Entity-Type": "dispatchJob", "X-Entity-Id": jobId, "X-Document-Type": "job-photo", "X-Visibility": "internal" });
    if (uploaded?.id) {
      await fieldPackage.saveFieldRecord("documents", { ...uploaded, includeInReport: true }, { kind: "document-flag", label: "Include photo in report" });
    }
    crm.showToast("Photo attached to the job.");
  } catch (error) {
    crm.showToast(error.message || "Photo could not be uploaded.");
  }
  input.value = "";
});

// ---------------------------------------------------------------------------------------------
// Brief tab
// ---------------------------------------------------------------------------------------------

function renderBriefTab(job, project, account) {
  const crew = crm.dispatchAssignmentsForJob(job.id).map((a) => ({ assignment: a, employee: crm.findEmployee(a.employeeId) }));
  const resources = crm.resourcesForDispatchJob(job.id);
  const equipment = resources.filter((r) => r.type === "Equipment");
  const materials = resources.filter((r) => r.type === "Material");
  const documents = job.id ? crm.latestDocumentsForEntity("dispatchJob", job.id) : [];
  const projectDocuments = project ? crm.latestDocumentsForEntity("project", project.id) : [];
  const responseWeather = project ? crm.weatherSlot(project, "response", job) : null;
  const incidentWeather = project ? crm.weatherSlot(project, "incident") : null;

  return `
    <section class="field-card">
      <div class="field-card-row"><strong>Schedule</strong></div>
      <span>${crm.formatDateTime(job.scheduledStart)}${job.scheduledEnd ? ` – ${crm.formatShortTime(job.scheduledEnd)}` : ""}</span>
      <div class="field-card-row"><strong>Site</strong></div>
      <span>${crm.escapeHtml(job.addressText || job.locationName || "No address")}</span>
      ${job.addressText ? `<a class="field-icon-button" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.addressText)}" target="_blank" rel="noopener">Navigate</a>` : ""}
      ${job.onsiteContactName || job.onsiteContactPhone ? `<div class="field-card-row"><span>${crm.escapeHtml(job.onsiteContactName || "Site contact")}</span>${job.onsiteContactPhone ? `<a class="field-icon-button" href="tel:${crm.escapeAttribute(job.onsiteContactPhone.replace(/[^0-9+]/g, ""))}">Call</a>` : ""}</div>` : ""}
      <div class="field-card-row"><strong>Class</strong><span>${crm.escapeHtml(project?.serviceType || project?.projectClass || "—")}</span></div>
    </section>

    ${project ? renderIntakeCard(project) : ""}
    ${project ? renderScopeCard(project) : ""}

    <section class="field-card">
      <div class="field-card-row"><strong>Assigned crew</strong></div>
      ${
        crew
          .map(
            ({ assignment, employee }) => `
        <div class="field-card-row">
          <span>${crm.escapeHtml(employee?.displayName || "Unknown")}${assignment.isFieldLead ? " (Field Lead)" : ""}</span>
          ${employee?.mobilePhone ? `<a class="field-icon-button" href="tel:${crm.escapeAttribute(employee.mobilePhone.replace(/[^0-9+]/g, ""))}">Call</a>` : ""}
        </div>
      `,
          )
          .join("") || `<div class="empty-state compact">No crew assigned.</div>`
      }
      <button class="mini-button" type="button" data-field-action="field-crew-clock-all" data-job-id="${crm.escapeAttribute(job.id)}">Clock crew in/out</button>
    </section>

    <section class="field-card">
      <div class="field-card-row"><strong>Equipment &amp; materials</strong></div>
      ${equipment.map((item) => `<div class="field-card-row"><span>${crm.escapeHtml(item.name)}${item.assetTag ? ` (${crm.escapeHtml(item.assetTag)})` : ""}</span></div>`).join("")}
      ${materials.map((item) => `<div class="field-card-row"><span>${crm.escapeHtml(item.name)}</span><small>${crm.escapeHtml(String(item.quantity || ""))} ${crm.escapeHtml(item.unit || "")}</small></div>`).join("")}
      ${!equipment.length && !materials.length ? `<div class="empty-state compact">Nothing reserved.</div>` : ""}
    </section>

    <section class="field-card">
      <div class="field-card-row"><strong>Documents</strong></div>
      ${[...projectDocuments, ...documents]
        .slice(0, 10)
        .map((doc) => `<a class="field-icon-button" href="${crm.mediaViewUrl ? crm.mediaViewUrl(doc.id) : "#"}" target="_blank" rel="noopener">${crm.escapeHtml(doc.fileName || doc.documentTypeId || "Document")}</a>`)
        .join("") || `<div class="empty-state compact">No documents on file.</div>`}
    </section>

    ${
      responseWeather || incidentWeather
        ? `<section class="field-card">
        <div class="field-card-row"><strong>Weather</strong></div>
        ${incidentWeather?.state === "captured" ? `<span>At incident: ${crm.escapeHtml(incidentWeather.snapshot?.conditions || "")}</span>` : ""}
        ${responseWeather?.state === "captured" ? `<span>When work started: ${crm.escapeHtml(responseWeather.snapshot?.conditions || "")}</span>` : ""}
        ${responseWeather?.state === "failed" ? `<span class="field-gap">Start-of-work weather not captured</span>` : ""}
      </section>`
        : ""
    }
  `;
}

// Item 4 (2026-09-28, owner report: "hard surface" and septic in a confined/crawl space) — this
// used to test `project.stormDrainInvolved ? "Yes" : "No"`, which is true for ANY non-empty string
// including the literal text "No", so a stored "No" rendered as "Yes". These fields are already
// the human-readable "Yes"/"No"/"Unknown" strings the intake writes — render them as-is.
function renderIntakeCard(project) {
  const rows = [
    ["Material", project.spillMaterial],
    ["Quantity", project.spillQuantity],
    ["Surface", crm.formatSpillSurface(project.spillSurface)],
    ["Location type", project.spillLocationType],
    ["Storm drain involved", project.stormDrainInvolved],
    ["Off-road discharge", project.offRoadDischarge],
    ["Absorbent deployed", project.absorbentDeployed],
    ["Agencies", Array.isArray(project.agencies) ? project.agencies.join(", ") : project.agencies],
    ["Mobilization status", project.mobilizationStatus],
  ].filter(([, value]) => value);
  if (!rows.length) return "";
  return `
    <section class="field-card">
      <div class="field-card-row"><strong>ER intake</strong>${project.ergGuideNumber ? `<span>ERG Guide ${crm.escapeHtml(project.ergGuideNumber)}</span>` : ""}</div>
      ${rows.map(([label, value]) => `<div class="field-card-row"><span>${crm.escapeHtml(label)}</span><span>${crm.escapeHtml(String(value))}</span></div>`).join("")}
    </section>
  `;
}

// Item 7 (2026-09-28, "Scope from sales is not editable once a project is created") — read-only on
// the field Brief; editing stays an office action (the project's Plan tab / dispatch job Details).
function renderScopeCard(project) {
  const lists = [
    ["Equipment", project.equipmentNeeds],
    ["Vendor / subcontractor", project.vendorNeeds],
    ["Resources", project.resourceNeeds],
  ].filter(([, items]) => Array.isArray(items) && items.length);
  if (!lists.length) return "";
  return `
    <section class="field-card">
      <div class="field-card-row"><strong>Scope</strong></div>
      ${lists.map(([label, items]) => `<div class="field-card-row"><span>${crm.escapeHtml(label)}</span></div><div class="chip-list">${crm.renderOpportunityNeedsChips(items)}</div>`).join("")}
    </section>
  `;
}

registerFieldAction("field-crew-clock-all", async (button) => {
  const jobId = button.dataset.jobId;
  const job = crm.findDispatchJob(jobId);
  const employee = currentFieldEmployee();
  const assignments = crm.dispatchAssignmentsForJob(jobId);
  const openEntries = crm.getTimeEntries().filter((e) => !e.endedAt && assignments.some((a) => a.employeeId === e.employeeId) && e.dispatchJobId === jobId);
  const toClockIn = assignments.filter((a) => !openEntries.some((e) => e.employeeId === a.employeeId));
  for (const assignment of toClockIn) {
    const record = { id: crm.makeId("time-entry"), employeeId: assignment.employeeId, dispatchJobId: jobId, entryType: "work", startedAt: new Date().toISOString(), endedAt: null, durationMinutes: null, notes: "", source: "field-crew-clock" };
    await fieldPackage
      .fieldRequest("/api/field/clock", {
        method: "POST",
        kind: "clock",
        label: `Clock in — ${crm.findEmployee(assignment.employeeId)?.displayName || "crew"}`,
        body: { employeeId: assignment.employeeId, dispatchJobId: jobId, entryType: "work", action: "in", enteredByEmployeeId: employee?.id },
        apply: () => (crm.state.backend.timeEntries = [...(crm.state.backend.timeEntries || []), record]),
      })
      .catch(async (error) => {
        if (/does not have clock yet/.test(error.message || "")) await fieldPackage.saveFieldRecord("timeEntries", record, { kind: "clock" });
      });
  }
  for (const entry of openEntries) {
    const endedAt = new Date().toISOString();
    const durationMinutes = Math.max(0, Math.round((new Date(endedAt) - new Date(entry.startedAt)) / 60000));
    const updated = { ...entry, endedAt, durationMinutes };
    await fieldPackage
      .fieldRequest("/api/field/clock", {
        method: "POST",
        kind: "clock",
        label: `Clock out — ${crm.findEmployee(entry.employeeId)?.displayName || "crew"}`,
        body: { employeeId: entry.employeeId, dispatchJobId: jobId, entryType: entry.entryType, action: "out", enteredByEmployeeId: employee?.id },
        apply: () => (crm.state.backend.timeEntries = (crm.state.backend.timeEntries || []).map((item) => (item.id === entry.id ? updated : item))),
      })
      .catch(async (error) => {
        if (/does not have clock yet/.test(error.message || "")) await fieldPackage.saveFieldRecord("timeEntries", updated, { kind: "clock" });
      });
  }
  crm.showToast(toClockIn.length ? "Crew clocked in." : "Crew clocked out.");
  crm.render();
});

// ---------------------------------------------------------------------------------------------
// Close tab
// ---------------------------------------------------------------------------------------------

function renderCloseTab(job, employee) {
  const days = crm.dispatchJobWorkDays(job);
  if (!days.length) days.push(crm.todayIso());
  const ack = job.customerAcknowledgement;
  const billables = computeBillables(job);

  return `
    <div class="field-close-tab">
      <h3 class="field-section-title">Case narrative</h3>
      ${days
        .map((date, index) => `
          <div class="field-narrative-day">
            ${crm.renderNarrativeDayForm(job, date, index, { open: index === days.length - 1 })}
          </div>
        `)
        .join("")}

      ${
        crm.postJobReviewAvailable(job)
          ? `<h3 class="field-section-title">Post-job review</h3>${crm.renderPostJobReviewForm(job)}`
          : `<p class="help-text">The post-job review appears once the job is Field complete.</p>`
      }

      <h3 class="field-section-title">Customer acknowledgement</h3>
      ${
        ack?.signatureAttachmentId
          ? `<p>Signed by ${crm.escapeHtml(ack.name)}${ack.title ? `, ${crm.escapeHtml(ack.title)}` : ""} — ${crm.escapeHtml(crm.formatDateTime(ack.signedAt))}</p>`
          : `<form class="frontline-action-form" data-field-form="field-customer-ack">
              <input type="hidden" name="jobId" value="${crm.escapeAttribute(job.id)}" />
              <label>Customer name <input name="name" required /></label>
              <label>Title <input name="title" /></label>
              <label>Signature
                <canvas id="frontlineSignaturePad" class="frontline-signature-pad" width="360" height="150"></canvas>
              </label>
              <div class="inline-actions"><button class="mini-button" type="button" data-action="frontline-clear-signature">Clear</button></div>
              <button class="primary-button" type="submit">Save signature</button>
            </form>`
      }

      <h3 class="field-section-title">Billables preview</h3>
      ${renderBillablesPreview(billables)}
    </div>
  `;
}

function computeBillables(job) {
  const employeeHours = {};
  crm.getTimeEntries().filter((e) => e.dispatchJobId === job.id && e.durationMinutes != null).forEach((e) => {
    employeeHours[e.employeeId] = (employeeHours[e.employeeId] || 0) + e.durationMinutes / 60;
  });
  // Timer-task submissions (payload.hours) aren't attributed to a specific crew member in the
  // submission payload today, so labor hours are drawn from timeEntries only — a known gap noted in
  // the phase doc's corrections section.
  const equipmentUsage = (crm.state.backend.jobEquipmentUsage || []).filter((row) => row.jobId === job.id);
  const materials = crm.resourcesForDispatchJob(job.id).filter((r) => r.type === "Material" && r.status === "Consumed");
  const waste = crm.wasteRecordsForProject(job.id);
  const expenses = crm.getJobExpenses().filter((e) => e.dispatchJobId === job.id);
  return { employeeHours, equipmentUsage, materials, waste, expenses };
}

function renderBillablesPreview(billables) {
  const hoursRows = Object.entries(billables.employeeHours).map(([employeeId, hours]) => `<div class="field-card-row"><span>${crm.escapeHtml(crm.findEmployee(employeeId)?.displayName || "Unknown")}</span><span>${hours.toFixed(2)} hrs</span></div>`).join("");
  return `
    <section class="field-card">
      <div class="field-card-row"><strong>Labor hours</strong></div>
      ${hoursRows || `<div class="field-gap">No time entries logged for this job yet.</div>`}
      <div class="field-card-row"><strong>Equipment usage</strong></div>
      ${billables.equipmentUsage.map((row) => `<div class="field-card-row"><span>${crm.escapeHtml(row.assetTag)}</span><span>${row.hours ? `${row.hours}h` : ""}${row.days ? ` ${row.days}d` : ""}</span></div>`).join("") || `<div class="field-gap">None logged.</div>`}
      <div class="field-card-row"><strong>Materials consumed</strong></div>
      ${billables.materials.map((row) => `<div class="field-card-row"><span>${crm.escapeHtml(row.name)}</span><span>${crm.escapeHtml(String(row.quantity || ""))} ${crm.escapeHtml(row.unit || "")}</span></div>`).join("") || `<div class="field-gap">None logged.</div>`}
      <div class="field-card-row"><strong>Waste</strong></div>
      ${billables.waste.map((row) => `<div class="field-card-row"><span>${crm.escapeHtml(row.description || row.containerType || "Waste")}</span><span>${crm.escapeHtml(crm.formatWasteQuantity(row))}</span></div>`).join("") || `<div class="field-gap">None logged.</div>`}
      <div class="field-card-row"><strong>Expenses</strong></div>
      ${billables.expenses.map((row) => `<div class="field-card-row"><span>${crm.escapeHtml(row.category || "Expense")}</span><span>${crm.money ? crm.money(row.amount) : row.amount}</span></div>`).join("") || `<div class="field-gap">None logged.</div>`}
    </section>
  `;
}

registerFieldForm("field-customer-ack", async (form) => {
  const data = new FormData(form);
  const jobId = data.get("jobId").toString();
  const job = crm.findDispatchJob(jobId);
  if (!job) return;
  if (!crm.state.frontlineSignatureStrokes?.length) {
    crm.showToast("Capture a signature first.");
    return;
  }
  let signatureAttachmentId = "";
  try {
    const blob = await crm.signatureToBlob();
    if (blob) {
      const file = new File([blob], `customer-ack-${jobId}.png`, { type: "image/png" });
      const uploaded = await fieldPackage.uploadFieldFile(`/api/documents`, file, { "X-Entity-Type": "dispatchJob", "X-Entity-Id": jobId, "X-Visibility": "internal", "X-Caption": encodeURIComponent(data.get("name")?.toString() || "") });
      signatureAttachmentId = uploaded?.id || "";
    }
  } catch (error) {
    crm.showToast("Signature could not be uploaded; try again once you're back online.");
    return;
  }
  const customerAcknowledgement = { name: (data.get("name") || "").toString().trim(), title: (data.get("title") || "").toString().trim(), signatureAttachmentId, signedAt: new Date().toISOString() };
  await fieldPackage.saveFieldRecord("dispatchJobs", { ...job, customerAcknowledgement }, { kind: "customer-ack", label: "Customer acknowledgement" });
  crm.state.frontlineSignatureStrokes = [];
  crm.showToast("Customer signature saved.");
  crm.render();
});
