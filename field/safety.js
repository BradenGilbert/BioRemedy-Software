// Front Line 2 — the Safety tab (Phase 21, W2, 2026-09-25).
//
// One jobSafetyBriefings row per job per operational day: PPE level + rationale, muster point,
// emergency contact, nearest hospital, hazard rows (Major job step / Potential hazard / Control,
// prefilled from the job template's step names), five yes/no reminders, optional air-monitoring
// readings, crew roll call, and a per-person acknowledgement (tap + signature).
//
// Server contract (W1, may not exist yet in this worktree):
//   POST /api/field/jobs/:id/briefing              — upsert the day's briefing
//   POST /api/field/jobs/:id/briefing/acknowledge   — {employeeId, signatureAttachmentId?}
// Both fall back to a plain jobSafetyBriefings upsert through the outbox (fieldRequest/saveFieldRecord
// already treat a 404 as "not ready yet" and fall back below).
//
// Signature storage: the simpler of the two options the plan offered — an acknowledgement signature
// is uploaded through the existing /api/documents route (X-Entity-Type "jobSafetyBriefing") rather
// than inventing a synthetic jobActions row just to reuse the job-task-attachments endpoint.
//
// Phase 25 A.3b (2026-09-29): "Scan ID" -- a driver's-licence check-in on the roll call. The PDF417
// barcode on the back of the licence is read by the browser's BarcodeDetector where it supports
// pdf417 (Android Chrome, live camera), else from a photo by the vendored zxing-wasm decoder
// (public/vendor/zxing/, loaded only when needed, precached for offline use). field/aamva.js parses
// it; the licence number goes to POST /api/field/jobs/:id/roll-call/scan once and is never kept on
// the phone (the photo is decoded here and never uploaded). A manual "Mark arrived" asks for a reason.
import * as crm from "../app.js";
import { registerFieldAction, registerFieldForm } from "./index.js";
import * as fieldPackage from "./package.js";
import { parseAamva } from "./aamva.js";

const REMINDER_KEYS = [
  { key: "ppeInspected", label: "PPE inspected" },
  { key: "sdsReviewed", label: "SDS reviewed" },
  { key: "deconPlan", label: "Decon plan in place" },
  { key: "spillKitStaged", label: "Spill kit staged" },
  { key: "communicationCheck", label: "Communication check complete" },
];

function briefingsForJob(jobId) {
  return (crm.state.backend.jobSafetyBriefings || []).filter((row) => row.jobId === jobId && !row.deletedAt);
}

function briefingForDay(job, date) {
  return briefingsForJob(job.id).find((row) => row.operationalDate === date) || null;
}

function isJobErClass(job) {
  const project = job.projectId ? crm.findProject(job.projectId) : null;
  return Boolean(project?.spillMaterial || project?.incidentLatitude || project?.stormDrainInvolved != null);
}

// A roll-call row's identity: the employee, or (a visitor/subcontractor with no employee record) the
// row's own id. Phase 25 A.2.
function rollCallRowFor(briefing, key) {
  return (briefing?.rollCall || []).find((row) => (key.employeeId ? row.employeeId === key.employeeId : row.id === key.rollCallId)) || null;
}

function rollCallName(row) {
  if (row?.employeeId) return crm.findEmployee(row.employeeId)?.displayName || row.displayName || "Unknown";
  return row?.displayName || "Visitor";
}

export function renderSafetyTab(job, employee, isLead) {
  // Phase 25 A.2: the same date rule as the server (dispatchJobOperationalDate, else today).
  const readiness = crm.briefingReadiness(job);
  const { date, briefing } = readiness;
  // Item 1 (2026-09-28 IT report): the acknowledgement is stored on the roll-call row
  // (rollCall[].acknowledgedAt, written by POST .../briefing/acknowledge), not a separate
  // `acknowledgements` array -- nothing in the server ever wrote that field.
  const myRow = briefing?.rollCall?.find((row) => row.employeeId === employee?.id) || null;
  const myAck = myRow?.acknowledgedAt ? myRow : null;

  if (!isLead) {
    // Crew member: their own arrival, and "Acknowledge briefing".
    return `
      <div class="field-safety-tab">
        ${renderIdScanPanel(job)}
        <section class="field-card">
          <div class="field-card-row"><strong>Safety briefing — ${crm.escapeHtml(crm.formatDate(date))}</strong></div>
          ${renderMyArrival(job, employee, myRow)}
          ${
            !briefing || !briefing.ppeLevel
              ? `<p class="help-text field-gap">The field lead hasn't filled out today's briefing yet.</p>`
              : myAck
                ? `<p class="field-ack-tag">Briefing signed ${crm.escapeHtml(crm.formatDateTime(myAck.acknowledgedAt))}.</p>`
                : renderAcknowledgeSection(job, briefing, { employeeId: employee?.id || "", name: employee?.displayName || "" })
          }
        </section>
        ${renderSafetyLinks(job)}
      </div>
    `;
  }

  // The lead signs too (Phase 25 A.2: this form used to be crew-only), and can hand the phone to
  // anyone on the roll call -- a crew member with no phone, a visitor -- to sign for themselves.
  const signFor = crm.state.fieldBriefingSignFor || null;
  const signForRow = signFor && briefing ? rollCallRowFor(briefing, signFor) : null;
  const signCard = !briefing
    ? ""
    : signForRow && !signForRow.acknowledgedAt
      ? `<section class="field-card">
          <div class="field-card-row"><strong>Sign the briefing — ${crm.escapeHtml(rollCallName(signForRow))}</strong><button class="mini-button" type="button" data-field-action="field-briefing-sign-cancel">Cancel</button></div>
          ${renderAcknowledgeSection(job, briefing, { ...signFor, name: rollCallName(signForRow) })}
        </section>`
      : myAck
        ? `<section class="field-card"><div class="field-card-row"><strong>Your signature</strong><span class="field-ack-tag">Briefing signed ${crm.escapeHtml(crm.formatShortTime(myAck.acknowledgedAt))}</span></div></section>`
        : `<section class="field-card">
            <div class="field-card-row"><strong>Your signature</strong></div>
            ${renderAcknowledgeSection(job, briefing, { employeeId: employee?.id || "", name: employee?.displayName || "" })}
          </section>`;

  return `
    <div class="field-safety-tab">
      ${renderBriefingStatus(job, readiness)}
      <form class="frontline-action-form" data-field-form="field-safety-save">
        <input type="hidden" name="jobId" value="${crm.escapeAttribute(job.id)}" />
        <input type="hidden" name="operationalDate" value="${crm.escapeAttribute(date)}" />
        <h3 class="field-section-title">PPE &amp; site</h3>
        <div class="form-grid">
          <label>PPE level
            <select name="ppeLevel">
              ${["A", "B", "C", "D"].map((level) => `<option ${briefing?.ppeLevel === level ? "selected" : ""}>${level}</option>`).join("")}
            </select>
          </label>
          <label>Rationale <input name="ppeRationale" maxlength="160" value="${crm.escapeAttribute(briefing?.ppeRationale || "")}" /></label>
        </div>
        <div class="form-grid">
          <label>Muster point <input name="musterPoint" maxlength="120" value="${crm.escapeAttribute(briefing?.musterPoint || "")}" /></label>
          <label>Emergency contact <input name="emergencyContact" maxlength="120" value="${crm.escapeAttribute(briefing?.emergencyContact || job.onsiteContactPhone || "")}" /></label>
          <label>Nearest hospital <input name="nearestHospital" maxlength="160" value="${crm.escapeAttribute(briefing?.nearestHospital || "")}" /></label>
        </div>

        <h3 class="field-section-title">Job safety analysis</h3>
        <div class="field-jsa-rows" data-jsa-rows>
          ${renderHazardRows(job, briefing)}
        </div>
        <button class="mini-button" type="button" data-field-action="field-jsa-add-row">Add hazard row</button>

        <h3 class="field-section-title">Reminders</h3>
        <div class="field-reminders">
          ${REMINDER_KEYS.map(
            ({ key, label }) => `
              <label class="check-row">
                <input type="checkbox" name="reminder-${key}" ${briefing?.reminders?.[key] ? "checked" : ""} />
                <span>${crm.escapeHtml(label)}</span>
              </label>
            `,
          ).join("")}
        </div>

        ${isJobErClass(job) ? renderAirMonitoring(briefing) : ""}

        <button class="primary-button" type="submit">Save briefing</button>
      </form>

      <h3 class="field-section-title">Roll call — who's on site${readiness.present.length ? ` (${readiness.present.length} now)` : ""}</h3>
      <div class="field-id-scan-cta field-gap-bottom">
        <button class="field-button" type="button" data-field-action="field-id-scan-start" data-job-id="${crm.escapeAttribute(job.id)}">Scan ID</button>
        <small class="field-card-sub">Scan the barcode on the back of anyone's driver's licence to check them in.</small>
      </div>
      ${renderIdScanPanel(job)}
      ${renderRollCall(job, briefing)}

      ${signCard}

      ${renderSafetyLinks(job)}
    </div>
  `;
}

// Phase 25 A.3: the briefing's state at the top of the lead's Safety tab -- the blocker (red outline,
// per the red-dot rule) until someone is on site and everyone on site has signed, then "Complete
// briefing". Start work checks the same rule (app.js getWorkPlanGate / server fieldAdvanceJob).
function renderBriefingStatus(job, readiness) {
  const { briefing, present, unsigned, ready } = readiness;
  const blocker = !briefing
    ? "Not started. Fill out the briefing below and save it."
    : !present.length
      ? "Nobody is marked arrived. Mark at least one person on site on the roll call below."
      : unsigned.length
        ? `Waiting on ${unsigned.length === 1 ? "1 signature" : `${unsigned.length} signatures`}: ${unsigned.map(rollCallName).join(", ")}.`
        : "";
  if (briefing?.completedAt) {
    return `
      <section class="field-card ${ready ? "" : "field-card--alert"}">
        <div class="field-card-row"><strong>Briefing complete</strong><span class="field-ack-tag">${crm.escapeHtml(crm.formatShortTime(briefing.completedAt))}</span></div>
        <small class="field-card-sub">${present.length} on site${briefing.completedBy ? ` · completed by ${crm.escapeHtml(briefing.completedBy)}` : ""}</small>
        ${ready ? "" : `<p class="field-gap">Since then: ${crm.escapeHtml(blocker)} Work can't start until they sign.</p>`}
      </section>
    `;
  }
  return `
    <section class="field-card ${ready ? "" : "field-card--alert"}" data-briefing-status>
      <div class="field-card-row"><strong>Today's briefing</strong>${ready ? `<span class="field-ack-tag">Ready to complete</span>` : `<span class="field-gap">Not complete</span>`}</div>
      ${blocker ? `<p class="field-gap">${crm.escapeHtml(blocker)}</p>` : `<small class="field-card-sub">${present.length} on site, all signed.</small>`}
      <button class="primary-button" type="button" data-field-action="field-briefing-complete" data-job-id="${crm.escapeAttribute(job.id)}" ${ready ? "" : "disabled"}>Complete briefing</button>
      <small class="field-card-sub">Work can't start until at least one person is on site and everyone on site has signed.</small>
    </section>
  `;
}

// A crew member's own arrival (Phase 25 A.2: any crew member may mark themselves arrived/left).
function renderMyArrival(job, employee, myRow) {
  if (!employee) return "";
  const key = { employeeId: employee.id };
  if (!myRow?.arrivedAt || myRow.leftAt) {
    return `
      <div class="field-card-row"><span class="field-card-sub">${myRow?.leftAt ? `Left ${crm.escapeHtml(crm.formatShortTime(myRow.leftAt))}.` : "You're not marked on site."}</span></div>
      <div class="field-card-actions">
        <button class="mini-button" type="button" data-field-action="field-id-scan-start" data-employee-id="${crm.escapeAttribute(employee.id)}" data-job-id="${crm.escapeAttribute(job.id)}">Scan my licence</button>
        <button class="mini-button" type="button" data-field-action="field-roll-call-arrive" data-employee-id="${crm.escapeAttribute(employee.id)}" data-job-id="${crm.escapeAttribute(job.id)}">I'm on site (no scan)</button>
      </div>
      ${renderManualArrivalForm(job, key)}
    `;
  }
  return `<div class="field-card-row"><span class="field-card-sub">On site since ${crm.escapeHtml(crm.formatShortTime(myRow.arrivedAt))} · ${crm.escapeHtml(crm.rollCallCheckInLabel(myRow))}</span><button class="mini-button" type="button" data-field-action="field-roll-call-leave" data-employee-id="${crm.escapeAttribute(employee.id)}" data-job-id="${crm.escapeAttribute(job.id)}">I've left</button></div>`;
}

// Phase 25 A.3b: a manual arrival (no licence scanned) needs a reason. The form opens in place under
// the button that asked for it.
const MANUAL_REASONS = ["No licence on hand", "Licence won't scan", "Camera not working", "Other"];

function manualArrivalOpenFor(jobId, key) {
  const open = crm.state.fieldManualArrival;
  if (!open || open.jobId !== jobId) return false;
  return key.employeeId ? open.employeeId === key.employeeId : Boolean(key.rollCallId) && open.rollCallId === key.rollCallId;
}

function renderManualArrivalForm(job, key) {
  if (!manualArrivalOpenFor(job.id, key)) return "";
  return `
    <form class="frontline-action-form field-manual-arrival" data-field-form="field-roll-call-arrive-manual">
      <input type="hidden" name="jobId" value="${crm.escapeAttribute(job.id)}" />
      <input type="hidden" name="employeeId" value="${crm.escapeAttribute(key.employeeId || "")}" />
      <input type="hidden" name="rollCallId" value="${crm.escapeAttribute(key.rollCallId || "")}" />
      <label>Why no ID scan?
        <select name="reason" required>
          <option value="">Choose a reason</option>
          ${MANUAL_REASONS.map((reason) => `<option>${crm.escapeHtml(reason)}</option>`).join("")}
        </select>
      </label>
      <label>Details (optional) <input name="detail" maxlength="100" placeholder="e.g. left wallet in the truck" /></label>
      <div class="field-card-actions">
        <button class="primary-button" type="submit">Mark arrived</button>
        <button class="mini-button" type="button" data-field-action="field-roll-call-arrive-cancel">Cancel</button>
      </div>
    </form>
  `;
}

function manualNoteFrom(data) {
  const reason = (data.get("reason") || "").toString().trim();
  const detail = (data.get("detail") || "").toString().trim();
  if (!reason) return "";
  return detail ? `${reason} — ${detail}`.slice(0, 160) : reason;
}

function renderHazardRows(job, briefing) {
  const rows = briefing?.hazards?.length
    ? briefing.hazards
    : crm.stepsForDispatchJob(job.id).filter((step) => !step.adHoc).slice(0, 6).map((step) => ({ step: step.name, hazard: "", control: "" }));
  return rows
    .map(
      (row, index) => `
        <div class="field-jsa-row">
          <input name="jsaStep" placeholder="Major job step" value="${crm.escapeAttribute(row.step || "")}" data-row="${index}" />
          <input name="jsaHazard" placeholder="Potential hazard" value="${crm.escapeAttribute(row.hazard || "")}" data-row="${index}" />
          <input name="jsaControl" placeholder="Control" value="${crm.escapeAttribute(row.control || "")}" data-row="${index}" />
        </div>
      `,
    )
    .join("");
}

function renderAirMonitoring(briefing) {
  const readings = briefing?.airMonitoring || [];
  return `
    <h3 class="field-section-title">Air monitoring</h3>
    <div class="field-air-rows" data-air-rows>
      ${readings
        .map(
          (reading) => `
        <div class="field-jsa-row">
          <input type="time" name="airTime" value="${crm.escapeAttribute(reading.time || "")}" />
          <input name="airReading" placeholder="Reading (ppm/LEL/etc.)" value="${crm.escapeAttribute(reading.reading || "")}" />
          <input name="airNotes" placeholder="Notes" value="${crm.escapeAttribute(reading.notes || "")}" />
        </div>
      `,
        )
        .join("")}
    </div>
    <button class="mini-button" type="button" data-field-action="field-air-add-row">Add reading</button>
  `;
}

// Phase 25 A.2: the roll call is everyone on the dispatch plus anyone the lead added -- another
// employee, a visitor or a subcontractor. The chip is about the *briefing* signature (it used to say
// "Not acknowledged", easily read as the job's acknowledgement status).
function renderRollCall(job, briefing) {
  const assignments = crm.dispatchAssignmentsForJob(job.id);
  const rollCall = briefing?.rollCall || [];
  const people = assignments.map((assignment) => ({
    key: { employeeId: assignment.employeeId },
    name: crm.findEmployee(assignment.employeeId)?.displayName || "Unknown",
    note: assignment.isFieldLead ? "Field Lead" : "",
    entry: rollCall.find((row) => row.employeeId === assignment.employeeId) || null,
  }));
  rollCall
    .filter((row) => !(row.employeeId && assignments.some((assignment) => assignment.employeeId === row.employeeId)))
    .forEach((row) =>
      people.push({
        key: row.employeeId ? { employeeId: row.employeeId } : { rollCallId: row.id || "" },
        name: rollCallName(row),
        note: row.employeeId ? "Not on the dispatch" : row.personType === "subcontractor" ? "Subcontractor" : "Visitor",
        entry: row,
      }),
    );
  const keyAttrs = (key) =>
    key.employeeId ? `data-employee-id="${crm.escapeAttribute(key.employeeId)}"` : `data-roll-call-id="${crm.escapeAttribute(key.rollCallId)}"`;
  return `
    <div class="field-card-list" data-roll-call>
      ${people
        .map(({ key, name, note, entry }) => {
          const signed = Boolean(entry?.acknowledgedAt);
          const onSite = Boolean(entry?.arrivedAt && !entry?.leftAt);
          return `
            <div class="field-card ${onSite && !signed && briefing ? "field-card--alert" : ""}" data-roll-call-row="${crm.escapeAttribute(key.employeeId || key.rollCallId)}">
              <div class="field-card-row">
                <strong>${crm.escapeHtml(name)}${note ? ` (${crm.escapeHtml(note)})` : ""}</strong>
                ${signed ? `<span class="field-ack-tag">Briefing signed</span>` : `<span class="field-gap">Briefing not signed</span>`}
              </div>
              <small class="field-card-sub">${entry?.arrivedAt ? `Arrived ${crm.escapeHtml(crm.formatShortTime(entry.arrivedAt))}` : "Not marked arrived"}${entry?.leftAt ? ` · Left ${crm.escapeHtml(crm.formatShortTime(entry.leftAt))}` : ""}</small>
              ${entry?.arrivedAt ? `<small class="field-card-sub" data-check-in>${crm.escapeHtml(crm.rollCallCheckInLabel(entry))}</small>` : ""}
              <div class="field-card-actions">
                ${!onSite && key.employeeId ? `<button class="mini-button" type="button" data-field-action="field-id-scan-start" ${keyAttrs(key)} data-job-id="${crm.escapeAttribute(job.id)}">Scan ID</button>` : ""}
                ${!onSite ? `<button class="mini-button" type="button" data-field-action="field-roll-call-arrive" ${keyAttrs(key)} data-job-id="${crm.escapeAttribute(job.id)}">Mark arrived</button>` : ""}
                ${onSite ? `<button class="mini-button" type="button" data-field-action="field-roll-call-leave" ${keyAttrs(key)} data-job-id="${crm.escapeAttribute(job.id)}">Mark left</button>` : ""}
                ${onSite && !signed && briefing?.ppeLevel ? `<button class="mini-button" type="button" data-field-action="field-briefing-sign-for" ${keyAttrs(key)}>Sign briefing</button>` : ""}
              </div>
              ${!onSite ? renderManualArrivalForm(job, key) : ""}
            </div>
          `;
        })
        .join("") || `<div class="empty-state compact">No crew assigned.</div>`}
    </div>
    ${renderAddPersonForm(job, people)}
  `;
}

function renderAddPersonForm(job, people) {
  const listed = new Set(people.map((person) => person.key.employeeId).filter(Boolean));
  const others = crm
    .getEmployees()
    .filter((employee) => !listed.has(employee.id) && (employee.employmentStatus || "Active") === "Active")
    .sort((a, b) => String(a.displayName || "").localeCompare(String(b.displayName || "")));
  return `
    <details class="field-card" data-add-person>
      <summary><strong>+ Add person on site</strong></summary>
      <form class="frontline-action-form" data-field-form="field-roll-call-add">
        <input type="hidden" name="jobId" value="${crm.escapeAttribute(job.id)}" />
        <label>Employee
          <select name="employeeId">
            <option value="">— Not an employee (enter a name below) —</option>
            ${others.map((employee) => `<option value="${crm.escapeAttribute(employee.id)}">${crm.escapeHtml(employee.displayName || employee.id)}${employee.jobTitle ? ` — ${crm.escapeHtml(employee.jobTitle)}` : ""}</option>`).join("")}
          </select>
        </label>
        <div class="form-grid">
          <label>Visitor name <input name="displayName" maxlength="120" placeholder="e.g. customer rep, inspector" /></label>
          <label>Type
            <select name="personType">
              <option value="visitor">Visitor</option>
              <option value="subcontractor">Subcontractor</option>
            </select>
          </label>
        </div>
        <div class="form-grid">
          <label>Why no ID scan?
            <select name="reason">
              <option value="">Choose a reason</option>
              ${MANUAL_REASONS.map((reason) => `<option>${crm.escapeHtml(reason)}</option>`).join("")}
            </select>
          </label>
          <label>Details (optional) <input name="detail" maxlength="100" /></label>
        </div>
        <small class="field-card-sub">Have their licence? Use Scan ID above instead; it fills in the name for you.</small>
        <button class="primary-button" type="submit">Add and mark arrived</button>
      </form>
    </details>
  `;
}

// `who` names the signer: {employeeId} for an employee (the person signed in, or someone the lead hands
// the phone to), {rollCallId} for a visitor/subcontractor row.
function renderAcknowledgeSection(job, briefing, who = {}) {
  return `
    <form class="frontline-action-form" data-field-form="field-safety-acknowledge">
      <input type="hidden" name="jobId" value="${crm.escapeAttribute(job.id)}" />
      <input type="hidden" name="briefingId" value="${crm.escapeAttribute(briefing.id)}" />
      <input type="hidden" name="operationalDate" value="${crm.escapeAttribute(briefing.operationalDate || "")}" />
      <input type="hidden" name="employeeId" value="${crm.escapeAttribute(who.employeeId || "")}" />
      <input type="hidden" name="rollCallId" value="${crm.escapeAttribute(who.rollCallId || "")}" />
      <p><strong>PPE level ${crm.escapeHtml(briefing.ppeLevel || "—")}</strong>${briefing.ppeRationale ? ` — ${crm.escapeHtml(briefing.ppeRationale)}` : ""}</p>
      ${briefing.musterPoint ? `<p>Muster point: ${crm.escapeHtml(briefing.musterPoint)}</p>` : ""}
      ${(briefing.hazards || []).filter((row) => row.hazard).length ? `<p>Hazards: ${crm.escapeHtml(briefing.hazards.filter((row) => row.hazard).map((row) => row.hazard).join("; "))}</p>` : ""}
      <label>Signature${who.name ? ` — ${crm.escapeHtml(who.name)}` : ""}
        <canvas id="frontlineSignaturePad" class="frontline-signature-pad" width="360" height="150"></canvas>
      </label>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="frontline-clear-signature">Clear</button>
      </div>
      <button class="primary-button" type="submit">Sign briefing</button>
    </form>
  `;
}

function renderSafetyLinks(job) {
  const sds = crm.documentsForEntity ? crm.documentsForEntity("dispatchJob", job.id).filter((doc) => /sds/i.test(doc.documentTypeId || doc.fileName || "")) : [];
  return `
    <div class="field-card">
      <div class="field-card-row"><strong>Safety library</strong></div>
      <button class="field-button field-button--secondary" type="button" data-view="field-library">Manuals &amp; Training</button>
      ${sds.length ? `<small class="field-card-sub">${sds.length} SDS document${sds.length === 1 ? "" : "s"} on this job (see Brief).</small>` : ""}
    </div>
  `;
}

export function afterSafetyRender() {
  if (document.getElementById("frontlineSignaturePad")) crm.initializeSignaturePad();
  afterIdScanRender();
}

// ---------------------------------------------------------------------------------------------
// Scan ID (Phase 25 A.3b)
// ---------------------------------------------------------------------------------------------
//
// crm.state.fieldIdScan holds only what the panel shows -- never the licence number:
//   { jobId, forKey: {employeeId}|null, stage: "choose"|"camera"|"reading"|"sending"|"confirm"|"done",
//     live: bool, error, licence: {displayName, idLast4, idState, idExpiry, expired}, warning,
//     suggestions, canLink, offline, result }
// The decoded licence (number included) lives in `pendingLicence`, in memory, until the scan command
// has been answered or queued, or the panel is closed.

let pendingLicence = null;
let scanStream = null;
let scanTimer = 0;
let scanFix = null;
let liveSupport = null;
let zxingPromise = null;

function scanState() {
  return crm.state.fieldIdScan || null;
}

function setScan(patch) {
  crm.state.fieldIdScan = { ...(crm.state.fieldIdScan || {}), ...patch };
  crm.render();
}

function closeScan() {
  stopScanCamera();
  pendingLicence = null;
  scanFix = null;
  crm.state.fieldIdScan = null;
  crm.render();
}

async function liveScanSupported() {
  if (liveSupport !== null) return liveSupport;
  try {
    liveSupport = Boolean(
      window.BarcodeDetector && navigator.mediaDevices?.getUserMedia && (await window.BarcodeDetector.getSupportedFormats()).includes("pdf417"),
    );
  } catch {
    liveSupport = false;
  }
  return liveSupport;
}

// A GPS fix for the check-in: started when the scan opens, so it is usually ready by the time the
// barcode is read. A denied permission or a timeout just means no position on the row.
function startScanFix() {
  scanFix = { value: null, promise: null };
  const holder = scanFix;
  if (!navigator.geolocation) {
    holder.promise = Promise.resolve(null);
    return;
  }
  holder.promise = new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      holder.value = value;
      resolve(value);
    };
    navigator.geolocation.getCurrentPosition(
      (position) => finish({ lat: position.coords.latitude, lng: position.coords.longitude, accuracyM: Math.round(position.coords.accuracy || 0) }),
      () => finish(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
    setTimeout(() => finish(null), 8000);
  });
}

async function currentScanFix() {
  if (!scanFix) return null;
  if (scanFix.value) return scanFix.value;
  return Promise.race([scanFix.promise, new Promise((resolve) => setTimeout(() => resolve(null), 3000))]);
}

function stopScanCamera() {
  clearTimeout(scanTimer);
  scanTimer = 0;
  if (scanStream) scanStream.getTracks().forEach((track) => track.stop());
  scanStream = null;
}

function loadZxing() {
  if (zxingPromise) return zxingPromise;
  zxingPromise = new Promise((resolve, reject) => {
    if (window.ZXingWASM) {
      resolve(window.ZXingWASM);
      return;
    }
    const script = document.createElement("script");
    script.src = new URL("../public/vendor/zxing/zxing-reader.js", import.meta.url).href;
    script.onload = () => (window.ZXingWASM ? resolve(window.ZXingWASM) : reject(new Error("The barcode reader didn't load.")));
    script.onerror = () => reject(new Error("The barcode reader couldn't be loaded. Open the app once with signal so this phone can keep it for offline use."));
    document.head.appendChild(script);
  }).then((zxing) => {
    const wasmUrl = new URL("../public/vendor/zxing/zxing_reader.wasm", import.meta.url).href;
    // The library would fetch its .wasm from a CDN; point it at the vendored (precached) copy.
    zxing.prepareZXingModule({ overrides: { locateFile: (file, prefix) => (file.endsWith(".wasm") ? wasmUrl : prefix + file) }, fireImmediately: true });
    return zxing;
  });
  zxingPromise.catch(() => {
    zxingPromise = null;
  });
  return zxingPromise;
}

// A still photo of the back of the licence -> the barcode text. Read on the phone; never uploaded.
async function decodeLicencePhoto(file) {
  if (await liveScanSupported()) {
    try {
      const bitmap = await createImageBitmap(file);
      const found = await new window.BarcodeDetector({ formats: ["pdf417"] }).detect(bitmap);
      bitmap.close?.();
      const text = found.find((item) => item.rawValue)?.rawValue;
      if (text) return text;
    } catch {
      // fall through to zxing
    }
  }
  const zxing = await loadZxing();
  const options = { formats: ["PDF417"], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, textMode: "Plain", maxNumberOfSymbols: 1 };
  const read = async (input) => (await zxing.readBarcodes(input, options)).find((item) => item.isValid && item.text)?.text || "";
  const direct = await read(file);
  if (direct) return direct;
  // zxing's PDF417 reader gives up on a barcode tilted more than ~3 degrees (tested 2026-09-29), and a
  // hand-held photo is rarely square: straighten it in 3-degree steps, both ways, up to 15 degrees.
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return "";
  }
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  try {
    for (const degrees of [-3, 3, -6, 6, -9, 9, -12, 12, -15, 15]) {
      const radians = (degrees * Math.PI) / 180;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians)));
      canvas.height = Math.ceil(Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians)));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(radians);
      context.drawImage(bitmap, -width / 2, -height / 2, width, height);
      const text = await read(context.getImageData(0, 0, canvas.width, canvas.height));
      if (text) return text;
    }
  } finally {
    bitmap.close?.();
  }
  return "";
}

function licenceSummary(licence) {
  return {
    displayName: licence.displayName,
    idLast4: String(licence.licenceNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-4),
    idState: licence.state,
    idExpiry: licence.expiry,
    expired: Boolean(licence.expiry) && licence.expiry < new Date().toISOString().slice(0, 10),
  };
}

async function handleDecodedText(text) {
  const scan = scanState();
  if (!scan) return;
  const licence = parseAamva(text);
  if (!licence) {
    setScan({ stage: scan.live ? "camera" : "choose", error: "That barcode isn't a driver's licence. Scan the large barcode on the back of the licence." });
    return;
  }
  if (!licence.state) {
    setScan({ stage: "choose", error: "The licence's issuing state couldn't be read. Try again, or mark the person arrived by hand." });
    return;
  }
  pendingLicence = licence;
  const summary = licenceSummary(licence);
  setScan({ stage: "sending", error: "", licence: summary, warning: summary.expired ? `This licence expired on ${crm.formatDate(summary.idExpiry)}. Check them in, and follow up on a current licence.` : "" });
  const forKey = scan.forKey || null;
  // Offline, the phone can't ask the server who this is: the lead says who it is first, then the scan
  // is queued with that answer (a licence already linked to someone still matches them on replay).
  if (!fieldPackage.isOnline()) {
    if (forKey?.employeeId) {
      await sendScan({ employeeId: forKey.employeeId });
      return;
    }
    setScan({ stage: "confirm", offline: true, canLink: isLeadOfJob(scan.jobId), suggestions: localSuggestions(scan.jobId, licence) });
    return;
  }
  await sendScan({});
}

function isLeadOfJob(jobId) {
  const job = crm.findDispatchJob(jobId);
  const me = crm.state.frontlineSession?.employeeId || "";
  if (!job) return false;
  if (!me) return true; // an office preview
  return job.fieldLeadEmployeeId === me || crm.dispatchAssignmentsForJob(job.id).some((a) => a.employeeId === me && a.isFieldLead);
}

// Offline stand-in for the server's suggestions: this job's crew, then name-alike active employees.
function localSuggestions(jobId, licence) {
  const job = crm.findDispatchJob(jobId);
  const crewIds = new Set([job?.fieldLeadEmployeeId, ...crm.dispatchAssignmentsForJob(jobId).map((a) => a.employeeId)].filter(Boolean));
  const family = String(licence.familyName || "").toLowerCase();
  return crm
    .getEmployees()
    .filter((employee) => (employee.employmentStatus || "Active") === "Active")
    .map((employee) => {
      const last = String(employee.lastName || String(employee.displayName || "").split(" ").slice(-1)[0] || "").toLowerCase();
      const onCrew = crewIds.has(employee.id);
      return { employeeId: employee.id, displayName: employee.displayName || "", jobTitle: employee.jobTitle || "", onCrew, nameMatch: Boolean(family) && last === family };
    })
    .filter((item) => item.onCrew || item.nameMatch)
    .sort((a, b) => Number(b.onCrew) - Number(a.onCrew) || Number(b.nameMatch) - Number(a.nameMatch));
}

// The scan command. `decision`: {} (let the server match), {employeeId} (the lead confirms who it
// is -- links the licence), or {asVisitor: true, personType}.
async function sendScan(decision) {
  const scan = scanState();
  const licence = pendingLicence;
  if (!scan || !licence) return;
  const job = crm.findDispatchJob(scan.jobId);
  if (!job) return closeScan();
  const { date, briefing } = crm.briefingReadiness(job);
  const briefingId = briefing?.id || crm.makeId("job-safety-briefing");
  const fix = await currentScanFix();
  const body = {
    licenceNumber: licence.licenceNumber,
    idState: licence.state,
    idExpiry: licence.expiry,
    givenName: licence.givenName,
    familyName: licence.familyName,
    displayName: licence.displayName,
    operationalDate: date,
    briefingId,
    ...(fix ? { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM } : {}),
    ...decision,
  };
  const summary = scan.licence || licenceSummary(licence);
  const who = decision.employeeId ? crm.findEmployee(decision.employeeId)?.displayName || "Employee" : decision.asVisitor ? licence.displayName : "";
  // Offline: show the arrival now; the server re-checks everything when the outbox replays.
  const applyLocally = () => {
    const rows = crm.state.backend.jobSafetyBriefings || [];
    const index = rows.findIndex((item) => item.id === briefingId);
    const base = index >= 0 ? rows[index] : { id: briefingId, jobId: job.id, operationalDate: date, rollCall: [] };
    const rollCall = [...(base.rollCall || [])];
    const now = new Date().toISOString();
    const fields = { checkInMethod: "scan", checkInNote: "", idLast4: summary.idLast4, idState: summary.idState, idExpiry: summary.idExpiry, scannedAt: now, lat: fix?.lat ?? "", lng: fix?.lng ?? "", accuracyM: fix?.accuracyM ?? "" };
    const rowIndex = decision.employeeId ? rollCall.findIndex((item) => item.employeeId === decision.employeeId) : -1;
    if (rowIndex >= 0) {
      const current = rollCall[rowIndex];
      rollCall[rowIndex] = { ...current, ...fields, ...(!current.arrivedAt || current.leftAt ? { arrivedAt: now, leftAt: "" } : {}) };
    } else if (decision.employeeId || decision.asVisitor) {
      rollCall.push({
        id: crm.makeId("roll-call"),
        employeeId: decision.employeeId || "",
        personType: decision.employeeId ? "employee" : decision.personType === "subcontractor" ? "subcontractor" : "visitor",
        displayName: who,
        arrivedAt: now,
        leftAt: "",
        acknowledgedAt: "",
        signatureAttachmentId: "",
        ...fields,
      });
    }
    const next = { ...base, rollCall };
    if (index >= 0) rows[index] = next;
    else rows.push(next);
    crm.state.backend.jobSafetyBriefings = rows;
  };
  setScan({ stage: "sending", error: "" });
  let result = null;
  try {
    result = await fieldPackage.fieldRequest(`/api/field/jobs/${encodeURIComponent(job.id)}/roll-call/scan`, {
      method: "POST",
      kind: "roll-call-scan",
      label: `ID check-in — ${who || summary.displayName || "licence"} (••••${summary.idLast4})`,
      body,
      apply: applyLocally,
      redactOnDone: ["licenceNumber"],
    });
  } catch (error) {
    setScan({ stage: "confirm", error: error?.payload?.error || error.message || "The check-in could not be saved.", suggestions: scanState()?.suggestions || [], canLink: scanState()?.canLink ?? isLeadOfJob(job.id) });
    return;
  } finally {
    body.licenceNumber = "";
  }
  if (!result) {
    // Queued offline -- the licence number now sits only in the outbox row until it replays.
    pendingLicence = null;
    setScan({ stage: "done", offline: true, result: { name: who || summary.displayName, queued: true } });
    return;
  }
  if (!result.match && !result.visitor) {
    // Scanned from someone's roll-call row: offer that person first.
    let suggestions = result.suggestions || [];
    const forId = scan.forKey?.employeeId || "";
    if (forId && result.canLink) {
      const forPerson = suggestions.find((item) => item.employeeId === forId) || { employeeId: forId, displayName: crm.findEmployee(forId)?.displayName || "", onCrew: true };
      suggestions = [forPerson, ...suggestions.filter((item) => item.employeeId !== forId)];
    }
    setScan({ stage: "confirm", offline: false, licence: result.licence || summary, warning: result.warning || scanState()?.warning || "", suggestions, canLink: Boolean(result.canLink) });
    return;
  }
  pendingLicence = null;
  if (result.briefing) fieldPackage.mergeRow("jobSafetyBriefings", result.briefing);
  setScan({
    stage: "done",
    offline: false,
    warning: result.warning || "",
    result: { name: result.match?.displayName || result.visitor?.displayName || summary.displayName, linked: Boolean(result.linked), visitor: Boolean(result.visitor) },
  });
}

function renderIdScanPanel(job) {
  const scan = scanState();
  if (!scan || scan.jobId !== job.id) return "";
  const forName = scan.forKey?.employeeId ? crm.findEmployee(scan.forKey.employeeId)?.displayName || "" : "";
  const licence = scan.licence;
  const licenceLine = licence
    ? `<p class="field-id-licence"><strong>${crm.escapeHtml(licence.displayName || "Name not read")}</strong> · ${crm.escapeHtml(licence.idState || "")} licence ••••${crm.escapeHtml(licence.idLast4 || "")}${licence.idExpiry ? ` · expires ${crm.escapeHtml(crm.formatDate(licence.idExpiry))}` : ""}</p>`
    : "";
  const warning = scan.warning ? `<p class="field-gap" data-id-scan-warning>${crm.escapeHtml(scan.warning)}</p>` : "";
  const error = scan.error ? `<p class="field-gap" data-id-scan-error>${crm.escapeHtml(scan.error)}</p>` : "";
  const header = `<div class="field-card-row"><strong>Scan ID${forName ? ` — ${crm.escapeHtml(forName)}` : ""}</strong><button class="mini-button" type="button" data-field-action="field-id-scan-cancel">${scan.stage === "done" ? "Close" : "Cancel"}</button></div>`;
  const photoButton = `
    <label class="field-button field-button--secondary field-id-photo">Take a photo of the back of the licence
      <input type="file" id="fieldIdScanPhoto" class="field-visually-hidden" accept="image/*" capture="environment" />
    </label>`;
  let bodyHtml = "";
  if (scan.stage === "camera") {
    bodyHtml = `
      <video id="fieldIdScanVideo" class="field-id-video" playsinline muted autoplay></video>
      <small class="field-card-sub">Hold the barcode on the back of the licence flat inside the frame.</small>
      ${photoButton}`;
  } else if (scan.stage === "choose") {
    bodyHtml = `
      ${scan.live === false ? `<small class="field-card-sub">Live scanning isn't available on this phone. Take a clear, close photo of the barcode on the back instead.</small>` : ""}
      ${scan.live ? `<button class="field-button" type="button" data-field-action="field-id-scan-camera">Use the camera</button>` : ""}
      ${photoButton}`;
  } else if (scan.stage === "reading") {
    bodyHtml = `<p class="field-card-sub">Reading the barcode…</p>`;
  } else if (scan.stage === "sending") {
    bodyHtml = `${licenceLine}<p class="field-card-sub">Checking them in…</p>`;
  } else if (scan.stage === "confirm") {
    const suggestions = scan.suggestions || [];
    const others = crm
      .getEmployees()
      .filter((employee) => (employee.employmentStatus || "Active") === "Active" && !suggestions.some((item) => item.employeeId === employee.id))
      .sort((a, b) => String(a.displayName || "").localeCompare(String(b.displayName || "")));
    bodyHtml = scan.canLink
      ? `
        ${licenceLine}
        <p class="field-card-sub">${scan.offline ? "No signal: say who this is and the check-in is sent when the phone reconnects." : "This licence isn't linked to anyone yet. Who is it? Linking it means next time the scan knows them."}</p>
        <div class="field-card-list" data-id-scan-suggestions>
          ${suggestions
            .map(
              (item) => `<button class="field-button field-button--secondary" type="button" data-field-action="field-id-scan-link" data-employee-id="${crm.escapeAttribute(item.employeeId)}">This is ${crm.escapeHtml(item.displayName)}${item.onCrew ? " (on this job)" : item.jobTitle ? ` (${crm.escapeHtml(item.jobTitle)})` : ""}</button>`,
            )
            .join("")}
        </div>
        ${
          others.length
            ? `<form class="frontline-action-form" data-field-form="field-id-scan-link-other">
                <label>Someone else
                  <select name="employeeId">
                    <option value="">Choose an employee</option>
                    ${others.map((employee) => `<option value="${crm.escapeAttribute(employee.id)}">${crm.escapeHtml(employee.displayName || employee.id)}</option>`).join("")}
                  </select>
                </label>
                <button class="mini-button" type="submit">This is them</button>
              </form>`
            : ""
        }
        <div class="field-card-actions">
          <button class="mini-button" type="button" data-field-action="field-id-scan-visitor" data-person-type="visitor">Visitor</button>
          <button class="mini-button" type="button" data-field-action="field-id-scan-visitor" data-person-type="subcontractor">Subcontractor</button>
        </div>`
      : `
        ${licenceLine}
        <p class="field-card-sub">This licence isn't linked to your name yet. Ask the field lead to scan it once, or mark yourself on site without a scan.</p>`;
  } else if (scan.stage === "done") {
    const result = scan.result || {};
    bodyHtml = `
      <p class="field-ack-tag" data-id-scan-done>${crm.escapeHtml(result.name || "They")} ${result.queued ? "will be checked in when the phone reconnects" : "checked in"}.</p>
      ${result.linked ? `<small class="field-card-sub">Licence linked; next time the scan will know them.</small>` : ""}
      ${scan.forKey ? "" : `<button class="mini-button" type="button" data-field-action="field-id-scan-again">Scan another</button>`}`;
  }
  const stageLicence = scan.stage === "done" ? licenceLine : "";
  return `
    <section class="field-card field-id-scan ${scan.warning ? "field-card--alert" : ""}" data-id-scan data-stage="${crm.escapeAttribute(scan.stage || "")}">
      ${header}
      ${stageLicence}
      ${warning}
      ${error}
      ${bodyHtml}
      ${scan.stage === "choose" || scan.stage === "camera" ? `<small class="field-card-sub">Only the name, issuing state, last 4 digits and expiry are kept. The photo never leaves this phone.</small>` : ""}
    </section>
  `;
}

function afterIdScanRender() {
  const scan = scanState();
  if (!scan || scan.stage !== "camera") {
    if (scanStream) stopScanCamera();
    return;
  }
  const video = document.getElementById("fieldIdScanVideo");
  if (!video) return;
  if (scanStream) {
    if (video.srcObject !== scanStream) {
      video.srcObject = scanStream;
      video.play().catch(() => {});
    }
    return;
  }
  startScanCamera();
}

async function startScanCamera() {
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch {
    scanStream = null;
    setScan({ stage: "choose", live: false, error: "The camera couldn't be opened. Take a photo of the back of the licence instead." });
    return;
  }
  const detector = new window.BarcodeDetector({ formats: ["pdf417"] });
  const tick = async () => {
    if (!scanStream) return;
    const video = document.getElementById("fieldIdScanVideo");
    if (!video) {
      stopScanCamera();
      return;
    }
    if (video.srcObject !== scanStream) {
      video.srcObject = scanStream;
      video.play().catch(() => {});
    }
    try {
      if (video.readyState >= 2) {
        const found = await detector.detect(video);
        const text = found.find((item) => item.rawValue)?.rawValue;
        if (text) {
          stopScanCamera();
          await handleDecodedText(text);
          return;
        }
      }
    } catch {
      // a frame the detector couldn't read; keep going
    }
    scanTimer = setTimeout(tick, 250);
  };
  tick();
}

registerFieldAction("field-id-scan-start", async (button) => {
  stopScanCamera();
  pendingLicence = null;
  const live = await liveScanSupported();
  const forKey = button.dataset.employeeId ? { employeeId: button.dataset.employeeId } : null;
  crm.state.fieldIdScan = { jobId: button.dataset.jobId, forKey, stage: live ? "camera" : "choose", live, error: "", licence: null, warning: "", suggestions: [], canLink: false, result: null };
  startScanFix();
  crm.render();
  document.querySelector("[data-id-scan]")?.scrollIntoView({ block: "center" });
});
registerFieldAction("field-id-scan-camera", () => setScan({ stage: "camera", error: "" }));
registerFieldAction("field-id-scan-cancel", () => closeScan());
registerFieldAction("field-id-scan-again", () => {
  pendingLicence = null;
  startScanFix();
  setScan({ stage: scanState()?.live ? "camera" : "choose", error: "", licence: null, warning: "", suggestions: [], result: null, offline: false });
});
registerFieldAction("field-id-scan-link", async (button) => {
  await sendScan({ employeeId: button.dataset.employeeId });
});
registerFieldAction("field-id-scan-visitor", async (button) => {
  await sendScan({ asVisitor: true, personType: button.dataset.personType === "subcontractor" ? "subcontractor" : "visitor" });
});
registerFieldForm("field-id-scan-link-other", async (form) => {
  const employeeId = (new FormData(form).get("employeeId") || "").toString();
  if (!employeeId) {
    crm.showToast("Choose who this licence belongs to.");
    return;
  }
  await sendScan({ employeeId });
});

document.addEventListener("change", async (event) => {
  const input = event.target.closest?.("#fieldIdScanPhoto");
  if (!input || !input.files?.[0]) return;
  const file = input.files[0];
  input.value = "";
  stopScanCamera();
  setScan({ stage: "reading", error: "" });
  let text = "";
  try {
    text = await decodeLicencePhoto(file);
  } catch (error) {
    setScan({ stage: "choose", error: error?.message || "The photo couldn't be read." });
    return;
  }
  if (!text) {
    setScan({ stage: "choose", error: "No licence barcode found in that photo. Fill the frame with the barcode on the back, in good light, and try again." });
    return;
  }
  await handleDecodedText(text);
});

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

registerFieldAction("field-jsa-add-row", () => {
  const container = document.querySelector("[data-jsa-rows]");
  if (!container) return;
  const row = document.createElement("div");
  row.className = "field-jsa-row";
  row.innerHTML = `<input name="jsaStep" placeholder="Major job step" /><input name="jsaHazard" placeholder="Potential hazard" /><input name="jsaControl" placeholder="Control" />`;
  container.appendChild(row);
});

registerFieldAction("field-air-add-row", () => {
  const container = document.querySelector("[data-air-rows]");
  if (!container) return;
  const row = document.createElement("div");
  row.className = "field-jsa-row";
  row.innerHTML = `<input type="time" name="airTime" /><input name="airReading" placeholder="Reading (ppm/LEL/etc.)" /><input name="airNotes" placeholder="Notes" />`;
  container.appendChild(row);
});

function rollCallKeyFrom(element) {
  return element.dataset.rollCallId ? { rollCallId: element.dataset.rollCallId } : { employeeId: element.dataset.employeeId || "" };
}

// Phase 25 A.3b: "Mark arrived" / "I'm on site" without a scan opens the reason form; the arrival is
// saved from its submit.
registerFieldAction("field-roll-call-arrive", (button) => {
  crm.state.fieldManualArrival = { jobId: button.dataset.jobId, ...rollCallKeyFrom(button) };
  crm.render();
  document.querySelector(".field-manual-arrival select")?.focus();
});
registerFieldAction("field-roll-call-arrive-cancel", () => {
  crm.state.fieldManualArrival = null;
  crm.render();
});
registerFieldForm("field-roll-call-arrive-manual", async (form) => {
  const data = new FormData(form);
  const jobId = (data.get("jobId") || "").toString();
  const employeeId = (data.get("employeeId") || "").toString();
  const rollCallId = (data.get("rollCallId") || "").toString();
  const checkInNote = manualNoteFrom(data);
  if (!checkInNote) {
    crm.showToast("Pick a reason for marking them arrived without a scan.");
    return;
  }
  crm.state.fieldManualArrival = null;
  await updateRollCall(jobId, employeeId ? { employeeId } : { rollCallId }, { arrivedAt: new Date().toISOString(), leftAt: "", checkInMethod: "manual", checkInNote });
});
registerFieldAction("field-roll-call-leave", async (button) => {
  await updateRollCall(button.dataset.jobId, rollCallKeyFrom(button), { leftAt: new Date().toISOString() });
});

// Phase 25 A.2: only the changed row goes to the server, which merges it into the stored roll call
// per person -- so a stale copy on this phone can't overwrite someone else's arrival, and the server
// can check the change is this person's own (or that the lead made it). The server used to keep its
// stored roll call and drop every "Mark arrived", and this function then replaced the local copy with
// the server's row, so the tap vanished.
async function updateRollCall(jobId, key, patch, extra = {}) {
  const job = crm.findDispatchJob(jobId);
  if (!job) return;
  const { date, briefing: existing } = crm.briefingReadiness(job);
  const current = existing ? rollCallRowFor(existing, key) : null;
  const row = key.employeeId
    ? { employeeId: key.employeeId, ...(current ? {} : { personType: "employee" }), ...patch }
    : { id: key.rollCallId, employeeId: "", ...(current ? {} : extra), ...patch };
  const briefingId = existing?.id || crm.makeId("job-safety-briefing");
  const body = { id: briefingId, jobId, operationalDate: date, rollCall: [row] };
  const applyLocally = () => {
    const rows = crm.state.backend.jobSafetyBriefings || [];
    const index = rows.findIndex((item) => item.id === briefingId);
    const base = index >= 0 ? rows[index] : { id: briefingId, jobId, operationalDate: date, rollCall: [] };
    const rollCall = [...(base.rollCall || [])];
    const rowIndex = rollCall.findIndex((item) => (key.employeeId ? item.employeeId === key.employeeId : item.id === key.rollCallId));
    if (rowIndex >= 0) rollCall[rowIndex] = { ...rollCall[rowIndex], ...patch };
    else rollCall.push({ acknowledgedAt: "", signatureAttachmentId: "", arrivedAt: "", leftAt: "", ...row });
    const next = { ...base, rollCall };
    if (index >= 0) rows[index] = next;
    else rows.push(next);
    crm.state.backend.jobSafetyBriefings = rows;
  };
  await saveBriefing(jobId, body, { apply: applyLocally });
  crm.render();
}

async function saveBriefing(jobId, record, { apply } = {}) {
  const body = { ...record, jobId, updatedAt: new Date().toISOString(), updatedBy: crm.findEmployee(crm.state.frontlineSession?.employeeId)?.displayName || "Front Line" };
  try {
    // Item 1 (2026-09-28 IT report): after a successful online save, merge the server's row back into
    // state so crm.render() below doesn't redraw from what was there before the save.
    await fieldPackage.fieldRequest(`/api/field/jobs/${encodeURIComponent(jobId)}/briefing`, {
      method: "POST",
      kind: "briefing",
      label: "Safety briefing",
      body,
      mergeInto: "jobSafetyBriefings",
      apply,
    });
  } catch (error) {
    if (/does not have briefing yet/.test(error.message || "")) {
      await fieldPackage.saveFieldRecord("jobSafetyBriefings", body, { kind: "briefing", label: "Safety briefing" });
    } else {
      throw error;
    }
  }
}

registerFieldForm("field-roll-call-add", async (form) => {
  const data = new FormData(form);
  const jobId = (data.get("jobId") || "").toString();
  const employeeId = (data.get("employeeId") || "").toString();
  const displayName = (data.get("displayName") || "").toString().trim();
  const personType = (data.get("personType") || "").toString() === "subcontractor" ? "subcontractor" : "visitor";
  const checkInNote = manualNoteFrom(data);
  if (!employeeId && !displayName) {
    crm.showToast("Pick an employee or type the visitor's name.");
    return;
  }
  if (!checkInNote) {
    crm.showToast("Pick a reason for adding them without an ID scan, or use Scan ID.");
    return;
  }
  const patch = { arrivedAt: new Date().toISOString(), leftAt: "", checkInMethod: "manual", checkInNote };
  if (employeeId) {
    await updateRollCall(jobId, { employeeId }, patch);
  } else {
    await updateRollCall(jobId, { rollCallId: crm.makeId("roll-call") }, patch, { personType, displayName });
  }
  crm.showToast(`${employeeId ? crm.findEmployee(employeeId)?.displayName || "Employee" : displayName} added to the roll call.`);
});

registerFieldAction("field-briefing-sign-for", (button) => {
  crm.state.fieldBriefingSignFor = rollCallKeyFrom(button);
  crm.state.frontlineSignatureStrokes = [];
  crm.render();
  document.querySelector('[data-field-form="field-safety-acknowledge"]')?.scrollIntoView({ block: "center" });
});
registerFieldAction("field-briefing-sign-cancel", () => {
  crm.state.fieldBriefingSignFor = null;
  crm.state.frontlineSignatureStrokes = [];
  crm.render();
});

// Phase 25 A.3: "Complete briefing" -- the server refuses it (409) until someone is on site and
// everyone on site has signed; the button is disabled on the same rule here.
registerFieldAction("field-briefing-complete", async (button) => {
  const job = crm.findDispatchJob(button.dataset.jobId);
  if (!job) return;
  const readiness = crm.briefingReadiness(job);
  if (!readiness.ready || !readiness.briefing) {
    crm.showToast(readiness.reason || "The briefing isn't ready to complete.");
    return;
  }
  const briefing = readiness.briefing;
  const completedAt = new Date().toISOString();
  try {
    await saveBriefing(job.id, { id: briefing.id, jobId: job.id, operationalDate: briefing.operationalDate, complete: true }, {
      apply: () => fieldPackage.mergeRow("jobSafetyBriefings", { id: briefing.id, completedAt, completedBy: crm.findEmployee(crm.state.frontlineSession?.employeeId)?.displayName || "Front Line" }),
    });
    crm.showToast("Briefing complete.");
  } catch (error) {
    crm.showToast(error?.payload?.error || error.message || "The briefing could not be completed.");
  }
  crm.render();
});
registerFieldForm("field-safety-save", async (form) => {
  const data = new FormData(form);
  const jobId = data.get("jobId").toString();
  const job = crm.findDispatchJob(jobId);
  const operationalDate = data.get("operationalDate").toString();
  const existing = briefingForDay(job, operationalDate);
  const steps = [...form.querySelectorAll('[data-jsa-rows] .field-jsa-row')].map((row) => ({
    step: row.querySelector('[name="jsaStep"]')?.value.trim() || "",
    hazard: row.querySelector('[name="jsaHazard"]')?.value.trim() || "",
    control: row.querySelector('[name="jsaControl"]')?.value.trim() || "",
  }));
  const air = [...form.querySelectorAll('[data-air-rows] .field-jsa-row')].map((row) => ({
    time: row.querySelector('[name="airTime"]')?.value || "",
    reading: row.querySelector('[name="airReading"]')?.value.trim() || "",
    notes: row.querySelector('[name="airNotes"]')?.value.trim() || "",
  }));
  const reminders = {};
  REMINDER_KEYS.forEach(({ key }) => {
    reminders[key] = form.elements[`reminder-${key}`]?.checked || false;
  });
  // Phase 25 A.2: no rollCall here -- the roll call is merged per person by the server and changes
  // only through updateRollCall/acknowledge, so saving the form can't roll back someone's arrival.
  const record = {
    id: existing?.id || crm.makeId("job-safety-briefing"),
    jobId,
    operationalDate,
    ppeLevel: (data.get("ppeLevel") || "D").toString(),
    ppeRationale: (data.get("ppeRationale") || "").toString().trim(),
    musterPoint: (data.get("musterPoint") || "").toString().trim(),
    emergencyContact: (data.get("emergencyContact") || "").toString().trim(),
    nearestHospital: (data.get("nearestHospital") || "").toString().trim(),
    hazards: steps.filter((row) => row.step || row.hazard || row.control),
    airMonitoring: air.filter((row) => row.reading),
    reminders,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  await saveBriefing(jobId, record);
  crm.showToast("Safety briefing saved.");
  crm.render();
});

registerFieldForm("field-safety-acknowledge", async (form) => {
  const data = new FormData(form);
  const jobId = data.get("jobId").toString();
  const briefingId = data.get("briefingId").toString();
  const me = crm.findEmployee(crm.state.frontlineSession?.employeeId);
  // Phase 25 A.2: the signer is named on the form -- the person signed in, or someone on the roll
  // call the lead handed the phone to (an employee, or a visitor's roll-call row).
  const signerEmployeeId = (data.get("employeeId") || "").toString() || (data.get("rollCallId") ? "" : me?.id || "");
  const rollCallId = (data.get("rollCallId") || "").toString();
  const operationalDate = (data.get("operationalDate") || "").toString();
  if (!signerEmployeeId && !rollCallId) return;
  if (!crm.state.frontlineSignatureStrokes?.length) {
    crm.showToast("Capture a signature before submitting.");
    return;
  }
  const job = crm.findDispatchJob(jobId);
  const existing = (crm.state.backend.jobSafetyBriefings || []).find((row) => row.id === briefingId) || crm.briefingReadiness(job).briefing;
  const signerRow = existing ? rollCallRowFor(existing, rollCallId ? { rollCallId } : { employeeId: signerEmployeeId }) : null;
  const signerName = signerEmployeeId ? crm.findEmployee(signerEmployeeId)?.displayName || "" : signerRow?.displayName || "Visitor";
  let signatureAttachmentId = "";
  try {
    const blob = await crm.signatureToBlob();
    if (blob) {
      const file = new File([blob], `briefing-ack-${signerEmployeeId || rollCallId}.png`, { type: "image/png" });
      // Phase 25: "jobSafetyBriefing" is now a known document entity type -- every one of these
      // uploads used to be refused ("Unknown record type") and the signature silently dropped.
      const uploaded = await fieldPackage.uploadFieldFile(`/api/documents`, file, {
        "X-Entity-Type": "jobSafetyBriefing",
        "X-Entity-Id": briefingId,
        "X-Visibility": "internal",
        "X-Caption": encodeURIComponent(`Briefing signature — ${signerName}`),
      });
      signatureAttachmentId = uploaded?.id || "";
    }
  } catch (error) {
    // The identical image already on this briefing comes back 409 with its id -- use it. Any other
    // failure still lets the acknowledgement go through; the signature image just isn't attached.
    // (Offline, the upload is queued ahead of the acknowledgement and its id isn't known.)
    if (error?.payload?.duplicate && error.payload.documentId) signatureAttachmentId = error.payload.documentId;
  }
  // Item 1 (2026-09-28 IT report): acknowledgement lives on the roll-call row (matches what
  // POST .../briefing/acknowledge actually writes server-side), not a separate `acknowledgements` list.
  const acknowledgedAt = new Date().toISOString();
  const matches = (row) => (rollCallId ? row.id === rollCallId : row.employeeId === signerEmployeeId);
  const rollCall = [
    ...(existing?.rollCall || []).filter((row) => !matches(row)),
    { arrivedAt: acknowledgedAt, leftAt: "", ...((existing?.rollCall || []).find(matches) || { employeeId: signerEmployeeId, personType: "employee" }), acknowledgedAt, signatureAttachmentId },
  ];
  try {
    await fieldPackage.fieldRequest(`/api/field/jobs/${encodeURIComponent(jobId)}/briefing/acknowledge`, {
      method: "POST",
      kind: "briefing-acknowledge",
      label: `Sign briefing — ${signerName}`,
      body: { ...(rollCallId ? { rollCallId } : { employeeId: signerEmployeeId }), signatureAttachmentId, operationalDate: operationalDate || existing?.operationalDate || "" },
      mergeInto: "jobSafetyBriefings",
      apply: () => {
        const rows = crm.state.backend.jobSafetyBriefings || [];
        const index = rows.findIndex((row) => row.id === briefingId);
        if (index >= 0) rows[index] = { ...rows[index], rollCall };
      },
    });
  } catch (error) {
    if (/does not have briefing-acknowledge yet/.test(error.message || "")) {
      await saveBriefing(jobId, { ...existing, rollCall });
    } else {
      throw error;
    }
  }
  crm.state.frontlineSignatureStrokes = [];
  crm.state.fieldBriefingSignFor = null;
  crm.showToast(`Briefing signed${signerEmployeeId && signerEmployeeId === me?.id ? "" : ` for ${signerName}`}.`);
  crm.render();
});
