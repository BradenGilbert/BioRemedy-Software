// Front Line 2 — standalone forms (Phase 21, W2, 2026-09-25).
//
// `formTemplates` ({id, name, category, fields[{key,label,type,options[],required}], requiresJob,
// isActive}) is the data-driven replacement for app.js's hard-coded FRONTLINE_STANDALONE_FORMS. Until
// the office seeds real templates (Job Templates screen, office-side, out of this workstream's
// scope) the collection is empty, so this falls back to the four legacy forms converted on the fly.
// Submissions keep the same shape either way: jobFormSubmissions {standalone:true, formName, payload}.
import * as crm from "../app.js";
import { registerFieldRoute, registerFieldAction, registerFieldForm, currentFieldEmployee } from "./index.js";
import * as fieldPackage from "./package.js";

const FIELD_TYPE_CHECKLIST = "Checklist";

function legacyTemplatesAsFormTemplates() {
  return crm.FRONTLINE_STANDALONE_FORMS.map((form) => ({
    id: `legacy-${form.key}`,
    name: form.name,
    category: "General",
    requiresJob: false,
    isActive: true,
    fields:
      form.type === FIELD_TYPE_CHECKLIST
        ? [{ key: "checklist", label: form.name, type: "checklist", options: form.options, required: false }, { key: "summary", label: "Notes", type: "text", required: false }]
        : [{ key: "summary", label: "Details", type: "text", required: true }],
  }));
}

function activeTemplates() {
  const stored = (crm.state.backend.formTemplates || []).filter((row) => row.isActive !== false && !row.deletedAt);
  return stored.length ? stored : legacyTemplatesAsFormTemplates();
}

function findTemplate(id) {
  return activeTemplates().find((template) => template.id === id) || null;
}

function submissionsForEmployee(employeeId) {
  return (crm.state.backend.jobFormSubmissions || [])
    .filter((submission) => submission.standalone && submission.submittedByEmployeeId === employeeId)
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

function renderForms() {
  const employee = currentFieldEmployee();
  const myJobs = employee ? crm.frontlineMyDispatchJobs(employee.id) : [];
  const openId = crm.state.fieldOpenFormTemplateId;
  const templates = activeTemplates();
  const recent = employee ? submissionsForEmployee(employee.id) : [];

  return `
    <p class="help-text">Standalone forms not tied to a specific job step — safety checklists, incident reports, inspections.</p>
    <div class="field-card-list">
      ${templates
        .map(
          (template) => `
        <button class="field-card field-card--tap" type="button" data-field-action="field-form-open" data-id="${crm.escapeAttribute(template.id)}">
          <div class="field-card-row"><strong>${crm.escapeHtml(template.name)}</strong></div>
          <small class="field-card-sub">${crm.escapeHtml(template.category || "General")} · ${template.fields.length} field${template.fields.length === 1 ? "" : "s"}</small>
        </button>
      `,
        )
        .join("")}
    </div>

    ${openId && findTemplate(openId) ? renderTemplateCapture(findTemplate(openId), myJobs) : ""}

    <h2 class="field-section-title">Recently submitted</h2>
    <div class="form-submission-list">
      ${recent.map(crm.renderJobFormSubmission).join("") || `<div class="empty-state compact">No standalone forms submitted yet.</div>`}
    </div>
  `;
}

function renderField(field) {
  const name = `field-${crm.escapeAttribute(field.key)}`;
  if (field.type === "checklist") {
    return `
      <fieldset class="frontline-checklist">
        <legend>${crm.escapeHtml(field.label)}</legend>
        ${(field.options || [])
          .map((option) => `<label class="check-row"><input type="checkbox" name="${name}" value="${crm.escapeAttribute(option)}" /><span>${crm.escapeHtml(option)}</span></label>`)
          .join("")}
      </fieldset>
    `;
  }
  if (field.type === "yesno") {
    return `
      <div class="review-question">
        <span>${crm.escapeHtml(field.label)}</span>
        <span class="review-answers">
          <label class="check-row"><input type="radio" name="${name}" value="Yes" ${field.required ? "required" : ""} /> Yes</label>
          <label class="check-row"><input type="radio" name="${name}" value="No" /> No</label>
        </span>
      </div>
    `;
  }
  if (field.type === "number") {
    return `<label>${crm.escapeHtml(field.label)}<input type="number" name="${name}" ${field.required ? "required" : ""} /></label>`;
  }
  if (field.type === "photo") {
    return `<label>${crm.escapeHtml(field.label)}<input type="file" name="${name}" accept="image/png,image/jpeg" ${field.required ? "required" : ""} /></label>`;
  }
  if (field.type === "signature") {
    return `<label>${crm.escapeHtml(field.label)}<canvas id="frontlineSignaturePad" class="frontline-signature-pad" width="360" height="150"></canvas></label>
      <div class="inline-actions"><button class="mini-button" type="button" data-action="frontline-clear-signature">Clear</button></div>`;
  }
  return `<label>${crm.escapeHtml(field.label)}<textarea name="${name}" ${field.required ? "required" : ""}></textarea></label>`;
}

function renderTemplateCapture(template, myJobs) {
  return `
    <h3>${crm.escapeHtml(template.name)}</h3>
    <form class="frontline-action-form" data-field-form="field-form-submit">
      <input type="hidden" name="templateId" value="${crm.escapeAttribute(template.id)}" />
      ${
        template.requiresJob
          ? `<label>Job
              <select name="jobId" required>
                <option value="">Select a job</option>
                ${myJobs.map((job) => `<option value="${crm.escapeAttribute(job.id)}">${crm.escapeHtml(crm.frontlineJobOptionLabel(job))}</option>`).join("")}
              </select>
            </label>`
          : `<label>Related job (optional)
              <select name="jobId">
                <option value="">Not tied to a specific job</option>
                ${myJobs.map((job) => `<option value="${crm.escapeAttribute(job.id)}">${crm.escapeHtml(crm.frontlineJobOptionLabel(job))}</option>`).join("")}
              </select>
            </label>`
      }
      ${template.fields.map(renderField).join("")}
      <div class="inline-actions">
        <button class="mini-button" type="button" data-field-action="field-form-close">Cancel</button>
        <button class="primary-button" type="submit">Submit</button>
      </div>
    </form>
  `;
}

registerFieldRoute("field-forms", { title: "Forms", render: renderForms, after: afterForms });

function afterForms() {
  if (document.getElementById("frontlineSignaturePad")) crm.initializeSignaturePad();
}

registerFieldAction("field-form-open", (button) => {
  crm.state.fieldOpenFormTemplateId = button.dataset.id;
  crm.render();
});
registerFieldAction("field-form-close", () => {
  crm.state.fieldOpenFormTemplateId = "";
  crm.render();
});

registerFieldForm("field-form-submit", async (form) => {
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton?.disabled) return;
  if (submitButton) submitButton.disabled = true;
  const template = findTemplate(new FormData(form).get("templateId")?.toString());
  if (!template) return;
  const data = new FormData(form);
  const jobId = (data.get("jobId") || "").toString();
  const employee = currentFieldEmployee();
  const payload = {};
  let summaryParts = [];
  // Phase 25 A.4: photo and signature fields used to upload against a made-up id (the photo's id was
  // then thrown away) or not upload at all ({signed:true} only). Now the files are collected here,
  // uploaded against the saved submission (entityType "formSubmission") once it exists, and their
  // document ids written back into the payload.
  const attachments = [];
  for (const field of template.fields) {
    const name = `field-${field.key}`;
    if (field.type === "checklist") {
      const checked = data.getAll(name).map((v) => v.toString());
      payload[field.key] = { options: field.options || [], checked, unchecked: (field.options || []).filter((o) => !checked.includes(o)) };
      summaryParts.push(`${checked.length} of ${(field.options || []).length} checked`);
    } else if (field.type === "photo") {
      const file = form.elements[name]?.files?.[0];
      payload[field.key] = file ? { fileName: file.name || "photo", documentId: "", pendingUpload: true } : null;
      if (file) attachments.push({ key: field.key, file, kind: "photo" });
    } else if (field.type === "signature") {
      const blob = crm.state.frontlineSignatureStrokes?.length ? await crm.signatureToBlob().catch(() => null) : null;
      payload[field.key] = { signed: Boolean(blob), documentId: "", pendingUpload: Boolean(blob) };
      if (blob) attachments.push({ key: field.key, file: new File([blob], `form-signature-${field.key}.png`, { type: "image/png" }), kind: "signature" });
    } else {
      payload[field.key] = (data.get(name) || "").toString().trim();
      if (field.key === "summary") summaryParts.push(payload[field.key]);
    }
  }
  const submission = {
    id: crm.makeId("form-sub"),
    jobId,
    actionId: "",
    formName: template.name,
    status: "Submitted",
    submittedBy: employee?.displayName || "Front Line",
    submittedByEmployeeId: employee?.id || "",
    submittedAt: new Date().toISOString(),
    summary: summaryParts.join("; ") || "Submitted in Front Line.",
    payload,
    standalone: true,
  };
  let attachmentNote = "";
  try {
    await fieldPackage.saveFieldRecord("jobFormSubmissions", submission, { kind: "form-submission", label: template.name });
    if (attachments.length) {
      // Queued in order behind the submission when offline, so the record exists when they replay;
      // offline the ids aren't known yet, but each document still points at the submission.
      const nextPayload = { ...payload };
      let uploadedAny = false;
      let failed = 0;
      for (const attachment of attachments) {
        try {
          const uploaded = await fieldPackage.uploadFieldFile(`/api/documents`, attachment.file, {
            "X-Entity-Type": "formSubmission",
            "X-Entity-Id": submission.id,
            "X-Visibility": "internal",
            "X-Caption": encodeURIComponent(`${template.name} — ${attachment.kind}`),
          });
          if (uploaded?.id) {
            nextPayload[attachment.key] = { ...(nextPayload[attachment.key] || {}), documentId: uploaded.id, pendingUpload: false };
            uploadedAny = true;
          }
        } catch (error) {
          // The same file already on this submission comes back 409 with its document id -- use it.
          const existingId = error?.payload?.duplicate ? error.payload.documentId : "";
          if (!existingId) failed += 1;
          nextPayload[attachment.key] = existingId
            ? { ...(nextPayload[attachment.key] || {}), documentId: existingId, pendingUpload: false }
            : { ...(nextPayload[attachment.key] || {}), pendingUpload: false, uploadError: error.message || "Upload failed" };
          uploadedAny = true;
        }
      }
      if (uploadedAny) {
        await fieldPackage.saveFieldRecord("jobFormSubmissions", { ...submission, payload: nextPayload }, { kind: "form-submission", label: `${template.name} — attachments` });
      }
      attachmentNote = failed ? ` ${failed} attachment${failed === 1 ? "" : "s"} could not be uploaded.` : "";
    }
    crm.state.fieldOpenFormTemplateId = "";
    crm.state.frontlineSignatureStrokes = [];
    crm.showToast(`${template.name} submitted.${attachmentNote}`);
    crm.render();
  } catch (error) {
    if (submitButton) submitButton.disabled = false;
    crm.showToast(error.message || "Could not submit that form.");
  }
});
