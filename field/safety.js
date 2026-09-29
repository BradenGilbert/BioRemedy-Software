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
import * as crm from "../app.js";
import { registerFieldAction, registerFieldForm } from "./index.js";
import * as fieldPackage from "./package.js";

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

      <h3 class="field-section-title">Roll call — who's on site</h3>
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
  if (!myRow?.arrivedAt) {
    return `<div class="field-card-row"><span class="field-card-sub">You're not marked on site.</span><button class="mini-button" type="button" data-field-action="field-roll-call-arrive" data-employee-id="${crm.escapeAttribute(employee.id)}" data-job-id="${crm.escapeAttribute(job.id)}">I'm on site</button></div>`;
  }
  return `<div class="field-card-row"><span class="field-card-sub">On site since ${crm.escapeHtml(crm.formatShortTime(myRow.arrivedAt))}${myRow.leftAt ? ` · left ${crm.escapeHtml(crm.formatShortTime(myRow.leftAt))}` : ""}</span>${
    myRow.leftAt ? "" : `<button class="mini-button" type="button" data-field-action="field-roll-call-leave" data-employee-id="${crm.escapeAttribute(employee.id)}" data-job-id="${crm.escapeAttribute(job.id)}">I've left</button>`
  }</div>`;
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
              <div class="field-card-actions">
                ${!entry?.arrivedAt ? `<button class="mini-button" type="button" data-field-action="field-roll-call-arrive" ${keyAttrs(key)} data-job-id="${crm.escapeAttribute(job.id)}">Mark arrived</button>` : ""}
                ${entry?.arrivedAt && !entry?.leftAt ? `<button class="mini-button" type="button" data-field-action="field-roll-call-leave" ${keyAttrs(key)} data-job-id="${crm.escapeAttribute(job.id)}">Mark left</button>` : ""}
                ${onSite && !signed && briefing?.ppeLevel ? `<button class="mini-button" type="button" data-field-action="field-briefing-sign-for" ${keyAttrs(key)}>Sign briefing</button>` : ""}
              </div>
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
}

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

registerFieldAction("field-roll-call-arrive", async (button) => {
  await updateRollCall(button.dataset.jobId, rollCallKeyFrom(button), { arrivedAt: new Date().toISOString() });
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
  const arrivedAt = new Date().toISOString();
  if (employeeId) {
    await updateRollCall(jobId, { employeeId }, { arrivedAt });
  } else if (displayName) {
    await updateRollCall(jobId, { rollCallId: crm.makeId("roll-call") }, { arrivedAt }, { personType, displayName });
  } else {
    crm.showToast("Pick an employee or type the visitor's name.");
    return;
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
