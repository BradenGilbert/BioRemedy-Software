// Front Line 2 — the Work tab (Phase 21, W2, 2026-09-25).
//
// Reuses the legacy Job Book work-plan renderer wholesale (crm.renderFrontlineWorkPlanStep, which
// nests crm.renderFrontlineTaskCapture and a <form data-form="frontline-complete-action">) so every
// task-type capture — Checklist/Photo/Signature/Material/Timer/Sample/Odometer — keeps the exact
// payload shape renderSubmissionPayload/the report/the invoice already read. Those data-form/
// data-action attributes are wired globally in app.js (document-level listeners), so they work
// unmodified inside a field-* screen.
//
// One deliberate departure: frontlineCompleteAction's Timer branch also writes
// employees.hoursWorked, which 403s for a real (non-admin) field session and — because that write
// shares frontlineCompleteAction's one try/catch — blocks the whole submission from saving. See
// CLAUDE.md build notes: "DO NOT carry that write into the new app." Rather than fork the entire
// ~170-line function, this module rewrites just the Timer forms' data-form attribute after render
// (see wireCaptureAfter) so they submit through fieldCompleteTimer() here instead, which is the same
// payload/step-advance logic minus that write, and goes through the outbox for offline support.
//
// New task types (Equipment usage, Waste) are NOT modeled as jobActions/jobSteps — adding a new task
// type to the template engine is app.js/job-template territory this workstream doesn't own. They are
// quick actions instead: a button on the Work tab opens a small form that saves straight to
// jobEquipmentUsage / wasteRecords through the outbox. See phase-21-frontline-2.md's corrections
// section for this scope call.
import * as crm from "../app.js";
import { registerFieldAction, registerFieldForm } from "./index.js";
import * as fieldPackage from "./package.js";

export function renderWorkTab(job, employee, isLead) {
  const allSteps = crm.stepsForDispatchJob(job.id).filter((step) => !step.adHoc);
  const submissions = crm.submissionsForDispatchJob(job.id);
  const adHocSubmissions = submissions.filter((submission) => submission.adHoc);
  const steps = isLead ? allSteps : allSteps.map((step) => ({ ...step, __crewView: true }));

  return `
    <div class="field-work-tab">
      <div class="work-plan-list">
        ${steps.map((step) => renderStepForRole(step, allSteps, job, isLead)).join("") || `<div class="empty-state">No execution plan instantiated.</div>`}
      </div>

      <h3 class="field-section-title">Quick capture</h3>
      <div class="field-quick-actions">
        <button class="field-button field-button--secondary" type="button" data-field-action="field-equipment-usage-open">Equipment usage</button>
        <button class="field-button field-button--secondary" type="button" data-field-action="field-waste-open">Waste / containers</button>
      </div>
      ${crm.state.fieldEquipmentUsageOpen ? renderEquipmentUsageForm(job) : ""}
      ${crm.state.fieldWasteOpen ? renderWasteForm(job) : ""}

      <h3 class="field-section-title">Additional activity</h3>
      <p class="help-text">Not on the template? Add a note, extra sample, signature, photo, or travel leg without waiting on a work-plan step.</p>
      <div class="inline-actions">
        ${["Note", "Photo", "Signature", "Sample", "Odometer"]
          .map(
            (type) =>
              `<button class="mini-button ${crm.state.frontlineAdHocType === type ? "active" : ""}" type="button" data-action="frontline-adhoc-pick-type" data-type="${crm.escapeAttribute(type)}">+ ${crm.escapeHtml(type)}</button>`,
          )
          .join("")}
      </div>
      ${crm.state.frontlineAdHocType ? crm.renderFrontlineAdHocCaptureForm(crm.state.frontlineAdHocType, job) : ""}
      <div class="form-submission-list">
        ${adHocSubmissions.map(crm.renderJobFormSubmission).join("") || `<div class="empty-state compact">No ad hoc activity yet.</div>`}
      </div>

      <h3 class="field-section-title">Forms and submissions</h3>
      <div class="form-submission-list">
        ${submissions.filter((s) => !s.adHoc).map(crm.renderJobFormSubmission).join("") || `<div class="empty-state">No forms submitted yet.</div>`}
      </div>
    </div>
  `;
}

// A crew member (assigned, not field lead) only sees tasks scoped to "Each worker" / "Any assigned
// worker" / "All assigned workers" — enforced here for the first time (assigneeScope was display-only
// before this pass).
const CREW_VISIBLE_SCOPES = ["Each worker", "Any assigned worker", "All assigned workers"];

function renderStepForRole(step, allSteps, job, isLead) {
  if (isLead) return crm.renderFrontlineWorkPlanStep(step, allSteps, job);
  const unlocked = crm.frontlineStepUnlocked(step, allSteps);
  const allActions = crm.actionsForDispatchStep(step.id);
  const visibleActions = allActions.filter((action) => CREW_VISIBLE_SCOPES.includes(action.assigneeScope));
  if (!visibleActions.length) return "";
  const openAttr = unlocked && step.status !== "Complete" ? "open" : "";
  return `
    <details class="frontline-step ${unlocked ? "" : "locked"}" ${openAttr}>
      <summary>
        <span class="step-sequence">${Number(step.sequence)}</span>
        <span><strong>${crm.escapeHtml(step.name)}</strong><small>${visibleActions.filter((a) => a.status === "Complete").length} of ${visibleActions.length} actions complete</small></span>
        ${crm.renderDispatchStatusBadge(step.status)}
      </summary>
      <div class="job-action-list">
        ${
          unlocked
            ? visibleActions.map((action) => crm.renderFrontlineWorkPlanAction?.(action, job, step, allActions) || renderCrewAction(action, job, step, allActions)).join("")
            : `<div class="empty-state compact">Locked until the previous step is complete.</div>`
        }
      </div>
    </details>
  `;
}

// Fallback only: app.js exports renderFrontlineWorkPlanAction since Phase 25 Wave F (it draws the task
// options -- Fill form, Add another, timer chips -- for crew too). Originally: renderFrontlineWorkPlanAction isn't exported (an internal building block of
// renderFrontlineWorkPlanStep) — this is the same shape, scoped to what a crew member is allowed to
// act on.
function renderCrewAction(action, job, step, stepActions) {
  const done = action.status === "Complete";
  const actionable = crm.frontlineActionUnlocked(action, stepActions);
  const open = crm.state.frontlineOpenActionId === action.id;
  let control = "";
  if (actionable && action.type !== "Status transition") {
    control = `<button class="mini-button" type="button" data-action="frontline-toggle-action" data-id="${action.id}">${open ? "Cancel" : "Complete"}</button>`;
  } else if (!done && actionable && action.type === "Status transition") {
    control = `<button class="mini-button" type="button" data-action="frontline-complete-status-action" data-id="${action.id}">${crm.escapeHtml(action.name)}</button>`;
  }
  return `
    <article class="frontline-action-row ${actionable || done ? "" : "locked"}">
      <div><strong>${crm.escapeHtml(action.name)}</strong><span>${crm.escapeHtml(action.type)}</span></div>
      ${crm.renderDispatchStatusBadge(action.status)}
      ${control}
    </article>
    ${
      open && actionable && action.type !== "Status transition"
        ? `<form class="frontline-action-form" data-form="frontline-complete-action">
             <input type="hidden" name="jobId" value="${crm.escapeAttribute(job.id)}" />
             <input type="hidden" name="stepId" value="${crm.escapeAttribute(step.id)}" />
             <input type="hidden" name="actionId" value="${crm.escapeAttribute(action.id)}" />
             ${crm.renderFrontlineTaskCapture(action, job)}
             <button class="primary-button" type="submit">Submit</button>
           </form>`
        : ""
    }
  `;
}

// ---------------------------------------------------------------------------------------------
// Timer completion, ported without the employees.hoursWorked write (see header note).
// ---------------------------------------------------------------------------------------------

export function afterCaptureRender() {
  // Rewrite Timer forms to submit through our own handler instead of crm.frontlineCompleteAction.
  document.querySelectorAll('form[data-form="frontline-complete-action"]').forEach((form) => {
    const actionId = form.elements.actionId?.value;
    const action = actionId && crm.findJobAction(actionId);
    if (action?.type === "Timer") {
      form.removeAttribute("data-form");
      form.dataset.fieldForm = "field-complete-timer";
    }
  });
  // The "+ Activity" ad hoc form (crm.renderFrontlineAdHocCaptureForm) submits through
  // crm.frontlineSubmitAdHocActivity by default, which calls saveBackendRecord directly and throws
  // outright when offline instead of queuing — rewire it to go through the outbox instead.
  document.querySelectorAll('form[data-form="frontline-adhoc-activity"]').forEach((form) => {
    form.removeAttribute("data-form");
    form.dataset.fieldForm = "field-adhoc-activity";
  });
}

registerFieldForm("field-complete-timer", async (form) => {
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton?.disabled) return;
  if (submitButton) submitButton.disabled = true;
  const data = new FormData(form);
  const jobId = data.get("jobId").toString();
  const actionId = data.get("actionId").toString();
  const summary = (data.get("summary") || "").toString().trim();
  const action = crm.findJobAction(actionId);
  if (!action) return;
  if (!crm.confirmJobActionRemoval(action)) {
    if (submitButton) submitButton.disabled = false;
    return;
  }
  const fieldLead = crm.findEmployee(crm.state.frontlineSession?.employeeId);
  const submittedBy = fieldLead?.displayName || "Front Line";
  const payload = {
    hours: Number(data.get("hours") || 0),
    computedHours: Number(data.get("computedHours") || 0),
    anchor: (data.get("timerAnchor") || "").toString(),
  };
  try {
    await fieldPackage.saveFieldRecord(
      "jobFormSubmissions",
      {
        id: crm.makeId("form-sub"),
        jobId,
        actionId,
        formName: action.formName || action.name,
        status: "Submitted",
        submittedBy,
        submittedAt: new Date().toISOString(),
        summary: summary || `${payload.hours} hours logged.`,
        payload,
        ...(action.repeatable ? { repeatIndex: crm.submissionsForJobAction(actionId).length } : {}),
      },
      { kind: "timer-submission", label: `${action.name} — hours` },
    );
    // Phase 25 Wave F: marks it done, opens the next task, runs its Timer option / Delete on device /
    // Delete on server, refreshes, and lets the status follow the plan (app.js).
    await crm.frontlineFinishPerformedAction(actionId, { toast: "Hours logged." });
  } catch (error) {
    if (submitButton) submitButton.disabled = false;
    crm.showToast(error.message || "Could not submit.");
  }
});

// ---------------------------------------------------------------------------------------------
// Equipment usage (new quick action → jobEquipmentUsage)
// ---------------------------------------------------------------------------------------------

function renderEquipmentUsageForm(job) {
  const equipment = crm.resourcesForDispatchJob(job.id).filter((resource) => resource.type === "Equipment");
  return `
    <form class="frontline-action-form" data-field-form="field-equipment-usage-save">
      <input type="hidden" name="jobId" value="${crm.escapeAttribute(job.id)}" />
      <label>Asset
        <select name="assetTag" required>
          <option value="">Select equipment on this job</option>
          ${equipment.map((item) => `<option value="${crm.escapeAttribute(item.assetTag || item.name)}">${crm.escapeHtml(item.name)}${item.assetTag ? ` (${crm.escapeHtml(item.assetTag)})` : ""}</option>`).join("")}
        </select>
      </label>
      <div class="form-grid">
        <label>Hours <input type="number" name="hours" min="0" step="0.25" /></label>
        <label>Days <input type="number" name="days" min="0" step="1" /></label>
      </div>
      <label>Condition
        <select name="condition">
          <option>Good</option>
          <option>Needs service</option>
          <option>Damaged</option>
        </select>
      </label>
      <label>Notes <textarea name="note" placeholder="Anything about how it was used"></textarea></label>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-field-action="field-equipment-usage-close">Cancel</button>
        <button class="primary-button" type="submit">Save</button>
      </div>
    </form>
  `;
}

registerFieldAction("field-equipment-usage-open", () => {
  crm.state.fieldEquipmentUsageOpen = true;
  crm.render();
});
registerFieldAction("field-equipment-usage-close", () => {
  crm.state.fieldEquipmentUsageOpen = false;
  crm.render();
});
registerFieldForm("field-equipment-usage-save", async (form) => {
  const data = new FormData(form);
  const jobId = data.get("jobId").toString();
  const employee = crm.findEmployee(crm.state.frontlineSession?.employeeId);
  const record = {
    id: crm.makeId("equip-usage"),
    jobId,
    assetTag: (data.get("assetTag") || "").toString(),
    operationalDate: crm.dispatchJobOperationalDate(crm.findDispatchJob(jobId)) || crm.todayIso(),
    hours: crm.numberOrNull(data.get("hours")),
    days: crm.numberOrNull(data.get("days")),
    condition: (data.get("condition") || "Good").toString(),
    note: (data.get("note") || "").toString().trim(),
    by: employee?.displayName || "Front Line",
    capturedAt: new Date().toISOString(),
  };
  await fieldPackage.saveFieldRecord("jobEquipmentUsage", record, { kind: "equipment-usage", label: `Equipment usage — ${record.assetTag}` });
  crm.state.fieldEquipmentUsageOpen = false;
  crm.showToast("Equipment usage logged.");
  crm.render();
});

// ---------------------------------------------------------------------------------------------
// Waste / containers (new quick action → wasteRecords, reusing the field names saveWasteRecord
// already uses so the office-side waste panel and disposal reporting read these the same way).
// ---------------------------------------------------------------------------------------------

function renderWasteForm(job) {
  return `
    <form class="frontline-action-form" data-field-form="field-waste-save">
      <input type="hidden" name="jobId" value="${crm.escapeAttribute(job.id)}" />
      <label>Container type
        <select name="containerType">
          ${crm.WASTE_CONTAINER_TYPES.map((type) => `<option>${crm.escapeHtml(type)}</option>`).join("")}
        </select>
      </label>
      <div class="form-grid">
        <label>Count <input type="number" name="containerCount" min="0" step="1" /></label>
        <label>Quantity <input type="number" name="quantity" min="0" step="0.1" /></label>
        <label>Unit
          <select name="unit">${crm.WASTE_UNITS.map((unit) => `<option>${crm.escapeHtml(unit)}</option>`).join("")}</select>
        </label>
      </div>
      <label>Contents / description <input name="description" maxlength="120" placeholder="What's in it" /></label>
      <label>Manifest number <input name="manifestNumber" maxlength="60" /></label>
      <label>Container photo <input type="file" name="containerPhoto" accept="image/png,image/jpeg" /></label>
      <div class="inline-actions">
        <button class="mini-button" type="button" data-field-action="field-waste-close">Cancel</button>
        <button class="primary-button" type="submit">Save</button>
      </div>
    </form>
  `;
}

registerFieldAction("field-waste-open", () => {
  crm.state.fieldWasteOpen = true;
  crm.render();
});
registerFieldAction("field-waste-close", () => {
  crm.state.fieldWasteOpen = false;
  crm.render();
});
registerFieldForm("field-waste-save", async (form) => {
  const data = new FormData(form);
  const jobId = data.get("jobId").toString();
  const job = crm.findDispatchJob(jobId);
  const id = crm.makeId("waste");
  const record = {
    id,
    projectId: job?.projectId || "",
    dispatchJobId: jobId,
    description: (data.get("description") || "").toString().trim(),
    containerType: (data.get("containerType") || "").toString(),
    containerCount: crm.numberOrNull(data.get("containerCount")),
    quantity: crm.numberOrNull(data.get("quantity")),
    unit: (data.get("unit") || "").toString(),
    manifestNumber: (data.get("manifestNumber") || "").toString().trim(),
    status: "Accumulating",
    accumulationStartedOn: crm.todayIso(),
    createdAt: new Date().toISOString(),
    createdBy: crm.currentActorName ? crm.currentActorName() : "Front Line",
  };
  const file = form.elements.containerPhoto?.files?.[0];
  if (file) {
    try {
      const uploaded = await fieldPackage.uploadFieldFile(`/api/documents`, file, {
        "X-Entity-Type": "wasteRecord",
        "X-Entity-Id": id,
        "X-Visibility": "internal",
      });
      if (uploaded?.id) record.containerPhotoAttachmentId = uploaded.id;
    } catch (error) {
      crm.showToast("Container photo could not be uploaded, but the record was saved.");
    }
  }
  await fieldPackage.saveFieldRecord("wasteRecords", record, { kind: "waste", label: `Waste — ${record.containerType || "container"}` });
  crm.state.fieldWasteOpen = false;
  crm.showToast("Waste record saved.");
  crm.render();
});

// ---------------------------------------------------------------------------------------------
// "+ Activity" ad hoc capture, ported from app.js's ensureFrontlineAdHocStep/
// frontlineSubmitAdHocActivity/saveSampleFromTask so every write goes through the outbox (offline
// support) instead of crm.saveBackendRecord/crm.uploadRawFile, which throw outright when offline.
// Field names and the ad-hoc jobActions/jobFormSubmissions shape are kept identical to the legacy
// version so the dispatch dashboard and reports read them the same way.
// ---------------------------------------------------------------------------------------------

async function fieldEnsureAdHocStep(jobId) {
  const existing = (crm.state.backend.jobSteps || []).find((step) => step.jobId === jobId && step.adHoc);
  if (existing) return existing;
  const allSteps = crm.stepsForDispatchJob(jobId);
  const step = {
    id: crm.makeId("job-step"),
    jobId,
    name: "Additional field activity",
    sequence: (allSteps[allSteps.length - 1]?.sequence || 0) + 1000,
    status: "Complete",
    adHoc: true,
  };
  await fieldPackage.saveFieldRecord("jobSteps", step, {
    kind: "ad-hoc-step",
    label: "Additional field activity step",
    apply: () => {
      crm.state.backend.jobSteps = [...(crm.state.backend.jobSteps || []), step];
    },
  });
  return step;
}

function buildAdHocPayload(type, config, data) {
  if (type === "Signature") return { signerRole: config.signerRole, signedBy: (data.get("signedBy") || "").toString().trim() };
  if (type === "Odometer") {
    const startOdometer = Number(data.get("startOdometer") || 0);
    const arrivalOdometer = Number(data.get("arrivalOdometer") || 0);
    return { siteLabel: (data.get("siteLabel") || "").toString().trim(), startOdometer, arrivalOdometer, calculatedDistance: Math.max(0, arrivalOdometer - startOdometer) };
  }
  if (type === "Sample") return { sampleId: (data.get("sampleId") || "").toString().trim() };
  return {};
}

function describeAdHocPayload(type, payload) {
  if (type === "Signature") return `Signed by ${payload.signedBy}.`;
  if (type === "Odometer") return `${payload.siteLabel || "Leg"}: ${payload.calculatedDistance} mi (${payload.startOdometer} to ${payload.arrivalOdometer}).`;
  return "Added in Front Line.";
}

registerFieldForm("field-adhoc-activity", async (form) => {
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton?.disabled) return;
  if (submitButton) submitButton.disabled = true;

  const data = new FormData(form);
  const jobId = data.get("jobId").toString();
  const type = data.get("activityType").toString();
  const job = crm.findDispatchJob(jobId);
  if (!job) return;
  const summary = (data.get("summary") || "").toString().trim();
  const fieldLead = crm.findEmployee(crm.state.frontlineSession?.employeeId);
  const submittedBy = fieldLead?.displayName || "Front Line";
  const files = [...(form.elements.photos?.files || [])];

  if (type === "Photo" && !files.length) {
    crm.showToast("Attach at least one photo.");
    if (submitButton) submitButton.disabled = false;
    return;
  }
  if (type === "Signature" && !crm.state.frontlineSignatureStrokes?.length) {
    crm.showToast("Capture a signature before submitting.");
    if (submitButton) submitButton.disabled = false;
    return;
  }
  if (type === "Sample") {
    const hasAll = form.elements.northViewPhoto?.files?.[0] && form.elements.intervalPhoto?.files?.[0] && form.elements.containerLabelPhoto?.files?.[0];
    if (!hasAll) {
      crm.showToast("North view, sample interval, and container label photos are all required.");
      if (submitButton) submitButton.disabled = false;
      return;
    }
  }
  if (type === "Odometer") {
    const startOdometer = Number(data.get("startOdometer") || 0);
    const arrivalOdometer = Number(data.get("arrivalOdometer") || 0);
    if (arrivalOdometer < startOdometer) {
      crm.showToast("Arrival odometer can't be less than the start odometer.");
      if (submitButton) submitButton.disabled = false;
      return;
    }
  }

  try {
    const adHocStep = await fieldEnsureAdHocStep(job.id);
    const existingAdHocActions = crm.actionsForDispatchStep(adHocStep.id);
    const action = {
      id: crm.makeId("job-action"),
      jobId: job.id,
      stepId: adHocStep.id,
      sequence: existingAdHocActions.length + 1,
      name: `Ad hoc: ${type}`,
      formName: `Ad hoc: ${type}`,
      type,
      assigneeScope: "Any assigned worker",
      status: "Complete",
      adHoc: true,
      config: {},
    };
    await fieldPackage.saveFieldRecord("jobActions", action, {
      kind: "ad-hoc-action",
      label: `Ad hoc: ${type}`,
      apply: () => {
        crm.state.backend.jobActions = [...(crm.state.backend.jobActions || []), action];
      },
    });

    const config = crm.normalizeTaskConfig(type, {});
    const payload = buildAdHocPayload(type, config, data);

    for (const file of files) {
      await fieldPackage.uploadFieldFile(`/api/job-actions/${encodeURIComponent(action.id)}/attachments`, file, {
        "X-Attachment-Kind": "photo",
        "X-Caption": encodeURIComponent(summary.slice(0, 120)),
      });
    }
    if (type === "Signature") {
      const blob = await crm.signatureToBlob();
      if (blob) {
        const file = new File([blob], `signature-${action.id}.png`, { type: "image/png" });
        await fieldPackage.uploadFieldFile(`/api/job-actions/${encodeURIComponent(action.id)}/attachments`, file, {
          "X-Attachment-Kind": "signature",
          "X-Caption": encodeURIComponent(payload.signedBy || ""),
        });
      }
    }
    if (type === "Sample") {
      const namedPhotos = [
        { file: form.elements.northViewPhoto?.files?.[0], caption: "North view" },
        { file: form.elements.intervalPhoto?.files?.[0], caption: "Sample interval" },
        { file: form.elements.containerLabelPhoto?.files?.[0], caption: "Container label" },
      ];
      for (const { file, caption } of namedPhotos) {
        if (!file) continue;
        await fieldPackage.uploadFieldFile(`/api/job-actions/${encodeURIComponent(action.id)}/attachments`, file, { "X-Attachment-Kind": "photo", "X-Caption": encodeURIComponent(caption) });
      }
      const analyses = (data.get("requestedAnalyses") || "").toString().split("\n").map((line) => line.trim()).filter(Boolean);
      const collectionTime = (data.get("collectionTime") || "").toString();
      await fieldPackage.saveFieldRecord(
        "sampleRecords",
        {
          id: crm.makeId("sample"),
          sampleId: (data.get("sampleId") || "").toString().trim(),
          samplingSessionId: "",
          samplingSessionName: job.jobName || "",
          projectId: job.projectId || "",
          dispatchJobId: job.id,
          actionId: action.id,
          accountId: job.accountId || "",
          facilityId: (job.projectId ? crm.findProject(job.projectId)?.facilityId : "") || "",
          sampleLocation: (data.get("sampleLocation") || "").toString().trim(),
          sampleType: (data.get("sampleType") || "").toString().trim() || "Field sample",
          sampleMatrix: (data.get("sampleMatrix") || "").toString().trim(),
          collectionMethod: (data.get("collectionMethod") || "").toString().trim(),
          depthInterval: (data.get("depthInterval") || "").toString().trim(),
          collectionTime: collectionTime ? new Date(collectionTime).toISOString() : new Date().toISOString(),
          collector: (data.get("collector") || "").toString().trim() || submittedBy,
          gpsAccuracyMeters: crm.state.frontlineGps?.accuracy || 0,
          latitude: crm.state.frontlineGps?.latitude || 0,
          longitude: crm.state.frontlineGps?.longitude || 0,
          containerSummary: (data.get("containerSummary") || "").toString().trim(),
          preservation: (data.get("preservation") || "").toString().trim(),
          requestedAnalyses: analyses,
          fieldNotes: summary,
          chainOfCustody: (data.get("chainOfCustody") || "").toString().trim(),
          labName: "",
          labStatus: "Logged in field",
          labResults: "",
          photos: [],
        },
        { kind: "ad-hoc-sample", label: "Ad hoc sample" },
      );
    }
    if (type === "Odometer") {
      await fieldPackage.saveFieldRecord(
        "jobMileageEntries",
        {
          id: crm.makeId("mileage"),
          employeeId: fieldLead?.id || "",
          dispatchJobId: job.id,
          mileageType: "job",
          beginningOdometer: payload.startOdometer,
          endingOdometer: payload.arrivalOdometer,
          calculatedDistance: payload.calculatedDistance,
          capturedAt: new Date().toISOString(),
          notes: `${payload.siteLabel}${summary ? ` — ${summary}` : ""}`,
        },
        { kind: "ad-hoc-mileage", label: "Ad hoc mileage" },
      );
    }

    const submission = {
      id: crm.makeId("form-sub"),
      jobId: job.id,
      actionId: action.id,
      formName: `Ad hoc: ${type}`,
      status: "Submitted",
      submittedBy,
      submittedAt: new Date().toISOString(),
      summary: summary || describeAdHocPayload(type, payload),
      payload,
      adHoc: true,
    };
    await fieldPackage.saveFieldRecord("jobFormSubmissions", submission, {
      kind: "ad-hoc-submission",
      label: `Ad hoc: ${type}`,
      apply: () => {
        crm.state.backend.jobFormSubmissions = [...(crm.state.backend.jobFormSubmissions || []), submission];
      },
    });

    crm.state.frontlineAdHocType = "";
    crm.state.frontlineSignatureStrokes = [];
    crm.state.frontlineGps = null;
    crm.render();
    crm.showToast("Added to the job.");
  } catch (error) {
    if (submitButton) submitButton.disabled = false;
    crm.showToast(error.message || "Could not add that activity.");
  }
});
