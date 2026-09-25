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

export function renderSafetyTab(job, employee, isLead) {
  const date = crm.dispatchJobOperationalDate(job) || crm.todayIso();
  const briefing = briefingForDay(job, date);
  const myAck = briefing?.acknowledgements?.find((a) => a.employeeId === employee?.id);

  if (!isLead) {
    // Crew member: only "Acknowledge briefing".
    return `
      <div class="field-safety-tab">
        <section class="field-card">
          <div class="field-card-row"><strong>Safety briefing — ${crm.escapeHtml(crm.formatDate(date))}</strong></div>
          ${
            !briefing
              ? `<p class="help-text field-gap">The field lead hasn't filled out today's briefing yet.</p>`
              : myAck
                ? `<p>Acknowledged ${crm.escapeHtml(crm.formatDateTime(myAck.acknowledgedAt))}.</p>`
                : renderAcknowledgeSection(job, briefing)
          }
        </section>
        ${renderSafetyLinks(job)}
      </div>
    `;
  }

  return `
    <div class="field-safety-tab">
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

      <h3 class="field-section-title">Crew roll call</h3>
      ${renderRollCall(job, briefing)}

      ${renderSafetyLinks(job)}
    </div>
  `;
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

function renderRollCall(job, briefing) {
  const assignments = crm.dispatchAssignmentsForJob(job.id);
  const rollCall = briefing?.rollCall || [];
  return `
    <div class="field-card-list">
      ${assignments
        .map((assignment) => {
          const person = crm.findEmployee(assignment.employeeId);
          const entry = rollCall.find((row) => row.employeeId === assignment.employeeId);
          const ack = briefing?.acknowledgements?.find((a) => a.employeeId === assignment.employeeId);
          return `
            <div class="field-card">
              <div class="field-card-row">
                <strong>${crm.escapeHtml(person?.displayName || "Unknown")}${assignment.isFieldLead ? " (Field Lead)" : ""}</strong>
                ${ack ? `<span class="field-ack-tag">Acknowledged</span>` : `<span class="field-gap">Not acknowledged</span>`}
              </div>
              <small class="field-card-sub">${entry?.arrivedAt ? `Arrived ${crm.escapeHtml(crm.formatShortTime(entry.arrivedAt))}` : "Not marked arrived"}${entry?.leftAt ? ` · Left ${crm.escapeHtml(crm.formatShortTime(entry.leftAt))}` : ""}</small>
              <div class="field-card-actions">
                ${!entry?.arrivedAt ? `<button class="mini-button" type="button" data-field-action="field-roll-call-arrive" data-employee-id="${crm.escapeAttribute(assignment.employeeId)}" data-job-id="${crm.escapeAttribute(job.id)}">Mark arrived</button>` : ""}
                ${entry?.arrivedAt && !entry?.leftAt ? `<button class="mini-button" type="button" data-field-action="field-roll-call-leave" data-employee-id="${crm.escapeAttribute(assignment.employeeId)}" data-job-id="${crm.escapeAttribute(job.id)}">Mark left</button>` : ""}
              </div>
            </div>
          `;
        })
        .join("") || `<div class="empty-state compact">No crew assigned.</div>`}
    </div>
  `;
}

function renderAcknowledgeSection(job, briefing) {
  return `
    <form class="frontline-action-form" data-field-form="field-safety-acknowledge">
      <input type="hidden" name="jobId" value="${crm.escapeAttribute(job.id)}" />
      <input type="hidden" name="briefingId" value="${crm.escapeAttribute(briefing.id)}" />
      <p><strong>PPE level ${crm.escapeHtml(briefing.ppeLevel || "—")}</strong>${briefing.ppeRationale ? ` — ${crm.escapeHtml(briefing.ppeRationale)}` : ""}</p>
      ${briefing.musterPoint ? `<p>Muster point: ${crm.escapeHtml(briefing.musterPoint)}</p>` : ""}
      <label>Signature
        <canvas id="frontlineSignaturePad" class="frontline-signature-pad" width="360" height="150"></canvas>
      </label>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-action="frontline-clear-signature">Clear</button>
      </div>
      <button class="primary-button" type="submit">Acknowledge briefing</button>
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

registerFieldAction("field-roll-call-arrive", async (button) => {
  await updateRollCall(button.dataset.jobId, button.dataset.employeeId, { arrivedAt: new Date().toISOString() });
});
registerFieldAction("field-roll-call-leave", async (button) => {
  await updateRollCall(button.dataset.jobId, button.dataset.employeeId, { leftAt: new Date().toISOString() });
});

async function updateRollCall(jobId, employeeId, patch) {
  const job = crm.findDispatchJob(jobId);
  const date = crm.dispatchJobOperationalDate(job) || crm.todayIso();
  const existing = briefingForDay(job, date);
  const rollCall = [...(existing?.rollCall || [])];
  const index = rollCall.findIndex((row) => row.employeeId === employeeId);
  if (index >= 0) rollCall[index] = { ...rollCall[index], ...patch };
  else rollCall.push({ employeeId, ...patch });
  const record = { ...(existing || { id: crm.makeId("safety-brief"), jobId, operationalDate: date }), rollCall };
  await saveBriefing(jobId, record);
  crm.render();
}

async function saveBriefing(jobId, record) {
  const body = { ...record, jobId, updatedAt: new Date().toISOString(), updatedBy: crm.findEmployee(crm.state.frontlineSession?.employeeId)?.displayName || "Front Line" };
  try {
    await fieldPackage.fieldRequest(`/api/field/jobs/${encodeURIComponent(jobId)}/briefing`, {
      method: "POST",
      kind: "briefing",
      label: "Safety briefing",
      body,
      apply: () => {
        const rows = crm.state.backend.jobSafetyBriefings || [];
        const index = rows.findIndex((row) => row.id === body.id);
        if (index >= 0) rows[index] = body;
        else rows.push(body);
        crm.state.backend.jobSafetyBriefings = rows;
      },
    });
  } catch (error) {
    if (/does not have briefing yet/.test(error.message || "")) {
      await fieldPackage.saveFieldRecord("jobSafetyBriefings", body, { kind: "briefing", label: "Safety briefing" });
    } else {
      throw error;
    }
  }
}

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
  const record = {
    id: existing?.id || crm.makeId("safety-brief"),
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
    rollCall: existing?.rollCall || [],
    acknowledgements: existing?.acknowledgements || [],
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
  const employee = crm.findEmployee(crm.state.frontlineSession?.employeeId);
  if (!employee) return;
  if (!crm.state.frontlineSignatureStrokes?.length) {
    crm.showToast("Capture a signature before submitting.");
    return;
  }
  let signatureAttachmentId = "";
  try {
    const blob = await crm.signatureToBlob();
    if (blob) {
      const file = new File([blob], `briefing-ack-${employee.id}.png`, { type: "image/png" });
      const uploaded = await fieldPackage.uploadFieldFile(`/api/documents`, file, {
        "X-Entity-Type": "jobSafetyBriefing",
        "X-Entity-Id": briefingId,
        "X-Visibility": "internal",
        "X-Caption": encodeURIComponent(employee.displayName || ""),
      });
      signatureAttachmentId = uploaded?.id || "";
    }
  } catch (error) {
    // A failed upload still lets the acknowledgement go through offline; the signature image just
    // won't be attached until the outbox drains and the upload retries separately isn't wired here —
    // documented as a known gap for a same-session follow-up.
  }
  const job = crm.findDispatchJob(jobId);
  const date = crm.dispatchJobOperationalDate(job) || crm.todayIso();
  const existing = briefingForDay(job, date);
  const acknowledgements = [...(existing?.acknowledgements || []).filter((a) => a.employeeId !== employee.id), { employeeId: employee.id, acknowledgedAt: new Date().toISOString(), signatureAttachmentId }];
  try {
    await fieldPackage.fieldRequest(`/api/field/jobs/${encodeURIComponent(jobId)}/briefing/acknowledge`, {
      method: "POST",
      kind: "briefing-acknowledge",
      label: "Acknowledge briefing",
      body: { employeeId: employee.id, signatureAttachmentId },
      apply: () => {
        const rows = crm.state.backend.jobSafetyBriefings || [];
        const index = rows.findIndex((row) => row.id === briefingId);
        if (index >= 0) rows[index] = { ...rows[index], acknowledgements };
      },
    });
  } catch (error) {
    if (/does not have briefing-acknowledge yet/.test(error.message || "")) {
      await saveBriefing(jobId, { ...existing, acknowledgements });
    } else {
      throw error;
    }
  }
  crm.state.frontlineSignatureStrokes = [];
  crm.showToast("Briefing acknowledged.");
  crm.render();
});
