// Front Line 2 — forms on the phone (Phase 21 W2, 2026-09-25; rebuilt for Phase 25 Wave F, 2026-09-30).
//
// `formTemplates` rows (see docs/roadmap/phase-25-pilot-fixes-2026-09-29.md, "Wave F — detailed
// plan") are filled in a full-screen sheet (`dialog.field-form-sheet`) that lives outside the field
// shell, so nothing the app re-renders underneath can wipe a half-filled form. Three ways in:
//   - the Forms menu (More › Forms): active forms with availableOnFormsMenu that match the worker's
//     crew or role, filled as ad hoc submissions (jobId optional);
//   - timesheet actions: clock in / clock out / break start / break end on the worker's own phone
//     open the one form that holds that timesheetAction first (withTimesheetForm below; field/index.js
//     and field/job.js call it). "Not now" needs a reason and records a deferred row;
//   - job actions: openFormForAction() — the Work tab (Wave F part 3) opens a task's attached form.
// All 15 field types render here (renderFormFields); the pure parts (calculation parser, legacy
// mapping, cascading options) are in form-calc.js so a Node check can run them.
//
// Submissions: jobFormSubmissions { id, jobId, actionId, formTemplateId, formVersion, formName,
// repeatIndex, timesheetAction, timeEntryId, deferred, deferReason, standalone, status, submittedBy,
// submittedByEmployeeId, submittedAt, summary, payload{fieldRef: value} }. Pictures and signatures
// are `documents` (entityType "formSubmission") whose ids the phone chooses itself (X-Document-Id),
// so a form filled offline references its photos straight away and the outbox sends them later.
import * as crm from "../app.js";
import { registerFieldRoute, registerFieldAction, currentFieldEmployee } from "./index.js";
import * as fieldPackage from "./package.js";
import {
  normalizeFormTemplate,
  templateMatchesWorker,
  computeCalculations,
  cascadeOptions,
  numericValue,
  roundTo,
  formatFieldValueText,
  formatMoney,
  TIMESHEET_ACTIONS,
} from "./form-calc.js";

export { evaluateCalculation, validateCalculation, normalizeFormTemplate, TIMESHEET_ACTIONS, FORM_FIELD_TYPES, slugFieldRef } from "./form-calc.js";
// 2026-10-01: the "Driver's licence scan" field (idScan) -- see "Driver's licence scan" below.
import { formatIdScanText } from "./form-calc.js";
import { scanLicence } from "./idscan.js";

const FIELD_TYPE_CHECKLIST = "Checklist";

// ---------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------

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

function storedTemplates() {
  return (crm.state.backend.formTemplates || []).filter((row) => row && !row.deletedAt);
}

// Every template the phone may open (inactive ones too — an attached job-action form still opens).
function allTemplates() {
  const stored = storedTemplates();
  return (stored.length ? stored : legacyTemplatesAsFormTemplates()).map(normalizeFormTemplate);
}

export function findFormTemplate(id) {
  if (!id) return null;
  return allTemplates().find((template) => template.id === id) || null;
}

// The office side resolves a submission's template by id, else (Phase 21 standalone rows) by name.
function templateForSubmission(submission) {
  if (!submission) return null;
  const rows = (crm.state.backend.formTemplates || []).filter(Boolean);
  const byId = submission.formTemplateId ? rows.find((row) => row.id === submission.formTemplateId) : null;
  if (byId) return normalizeFormTemplate(byId);
  if (submission.formTemplateId || submission.standalone) {
    const byName = rows.find((row) => !row.deletedAt && (row.name === submission.formName || row.displayName === submission.formName));
    if (byName) return normalizeFormTemplate(byName);
  }
  return null;
}

// The worker's crews (home crew + extra memberships) and roles, for a template's `groups`.
function workerGroups() {
  const employee = currentFieldEmployee();
  const crewIds = new Set();
  if (employee?.crewId) crewIds.add(employee.crewId);
  (crm.state.backend.workforceTeamMemberships || []).forEach((row) => {
    if (row && !row.deletedAt && row.status !== "Removed" && employee && row.employeeId === employee.id && row.crewId) crewIds.add(row.crewId);
  });
  const roles = new Set(crm.currentRoles() || []);
  // The server treats a sign-on link session as a Field Lead (fieldSessionRoles); match it here.
  if (crm.state.session?.kind === "dispatch-link") roles.add("Field Lead");
  return { crewIds: [...crewIds], roles: [...roles] };
}

function menuTemplates() {
  const groups = workerGroups();
  return allTemplates()
    .filter((template) => template.isActive && template.availableOnFormsMenu && templateMatchesWorker(template, groups))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// The one active form that holds this timesheet action for this worker (null = no form to fill).
export function timesheetFormFor(action) {
  if (!TIMESHEET_ACTIONS[action]) return null;
  const groups = workerGroups();
  return (
    storedTemplates()
      .map(normalizeFormTemplate)
      .filter((template) => template.isActive && template.timesheetAction === action && templateMatchesWorker(template, groups))
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null
  );
}

// ---------------------------------------------------------------------------------------------
// Fleet vehicles (odometer fields)
// ---------------------------------------------------------------------------------------------

function fleetVehicles() {
  return (crm.state.backend.equipmentAssets || [])
    .filter((asset) => asset && !asset.deletedAt && /vehicle|truck|trailer|fleet/i.test(asset.category || "") && !/retired|sold|disposed/i.test(asset.status || ""))
    .sort((a, b) => String(a.assetTag || "").localeCompare(String(b.assetTag || "")));
}

function vehicleLabel(asset) {
  if (!asset) return "";
  const name = asset.equipment || asset.name || "";
  return [asset.assetTag, name].filter(Boolean).join(" · ") || asset.id;
}

// The last odometer reading we know for a vehicle: the fleet record's mileage, or a higher reading
// from any odometer answer the phone can see.
function lastOdometerReading(vehicleId) {
  if (!vehicleId) return null;
  const asset = (crm.state.backend.equipmentAssets || []).find((row) => row.id === vehicleId);
  let best = numericValue(asset?.specs?.mileage ?? asset?.mileage ?? asset?.odometer ?? null);
  for (const submission of crm.state.backend.jobFormSubmissions || []) {
    if (!submission || submission.deletedAt || !submission.payload) continue;
    for (const value of Object.values(submission.payload)) {
      if (value && typeof value === "object" && value.vehicleId === vehicleId) {
        const reading = numericValue(value.reading);
        if (reading !== null && (best === null || reading > best)) best = reading;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Rendering (pure strings; renderFormFields is exported for the Work tab and the builder preview)
// ---------------------------------------------------------------------------------------------

const esc = (value) => crm.escapeHtml(value ?? "");
const attr = (value) => crm.escapeAttribute(value ?? "");

function localToday() {
  return crm.todayIso();
}

function localNowTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function fieldName(field) {
  return `ff-${field.fieldRef}`;
}

function requiredMark(field) {
  return field.required ? `<b class="field-form-req" aria-hidden="true">*</b>` : "";
}

function helpAndError(field) {
  return `${field.helpText ? `<small class="field-form-help">${esc(field.helpText)}</small>` : ""}<small class="field-form-error" data-error-for="${attr(field.fieldRef)}" role="alert"></small>`;
}

function stepFor(decimals, fallback = "any") {
  if (decimals === "" || decimals === null || decimals === undefined || !Number.isFinite(Number(decimals))) return fallback;
  const places = Math.max(0, Math.min(6, Number(decimals)));
  return places === 0 ? "1" : (1 / 10 ** places).toFixed(places);
}

// The starting value of a field: the stored value, else its default (dates/times fill "now").
function initialValue(field, values) {
  if (values && Object.prototype.hasOwnProperty.call(values, field.fieldRef)) return values[field.fieldRef];
  if (field.type === "date" && field.config.autoCapture) return localToday();
  if (field.type === "time" && field.config.autoCapture) return localNowTime();
  if (field.type === "checkbox") return Boolean(field.config.defaultChecked || field.defaultValue === true || field.defaultValue === "true");
  return field.defaultValue ?? "";
}

// Old Phase 21 payloads kept a checklist as {options, checked}; a multi-select is now a plain array.
function asSelections(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === "object" && Array.isArray(value.checked)) return value.checked.map(String);
  if (typeof value === "string" && value) return [value];
  return [];
}

function renderCascadeLevels(field, selections) {
  const levels = Array.isArray(field.config.levels) && field.config.levels.length ? field.config.levels : ["Choice"];
  const rows = field.config.rows || [];
  return levels
    .map((levelName, level) => {
      const options = cascadeOptions(rows, level, selections);
      const current = selections[level] || "";
      const disabled = level > 0 && !selections[level - 1];
      return `<label class="field-label"><span>${esc(levelName)}</span>
        <select data-cascade-level="${level}" ${disabled || !options.length ? "disabled" : ""}>
          <option value="">${disabled ? `Choose ${esc(levels[level - 1] || "above")} first` : `Select ${esc(levelName).toLowerCase()}`}</option>
          ${options.map((option) => `<option value="${attr(option)}" ${option === current ? "selected" : ""}>${esc(option)}</option>`).join("")}
        </select>
      </label>`;
    })
    .join("");
}

function renderPhotoThumbs(field, entries) {
  const max = Number(field.config.max) || 0;
  const min = Number(field.config.min) || (field.required ? 1 : 0);
  const count = entries.length;
  return `
    <div class="field-form-photo-grid">
      ${entries
        .map(
          (entry, index) => `<figure class="field-form-photo">
            <img src="${attr(entry.url || thumbUrlFor(entry.documentId))}" alt="Photo ${index + 1}" />
            <button type="button" class="field-form-photo-remove" data-photo-remove="${index}" aria-label="Remove photo ${index + 1}">×</button>
          </figure>`,
        )
        .join("")}
    </div>
    <small class="field-form-count">${count} photo${count === 1 ? "" : "s"}${min ? ` · at least ${min}` : ""}${max ? ` · up to ${max}` : ""}</small>
  `;
}

function thumbUrlFor(documentId) {
  if (!documentId) return "";
  return fieldPackage.pendingUploadUrl(documentId) || `/api/documents/${encodeURIComponent(documentId)}/view`;
}

function renderFieldEdit(field, value, { preview = false } = {}) {
  if (field.type === "idScan") return renderIdScanEdit(field, value, { preview });
  const name = fieldName(field);
  const ref = attr(field.fieldRef);
  const title = `<span>${esc(field.displayName)}${requiredMark(field)}</span>`;
  const wrap = (inner, extraClass = "") => `<div class="field-form-field ${extraClass}" data-ref="${ref}" data-type="${attr(field.type)}">${inner}${helpAndError(field)}</div>`;
  const config = field.config || {};
  switch (field.type) {
    case "label": {
      const style = ["heading", "note", "warning"].includes(config.style) ? config.style : "note";
      const text = config.text || (style === "heading" ? field.displayName : "");
      if (style === "heading") return `<div class="field-form-field field-form-label field-form-label--heading" data-ref="${ref}" data-type="label"><h3>${esc(text || field.displayName)}</h3></div>`;
      return `<div class="field-form-field field-form-label field-form-label--${style}" data-ref="${ref}" data-type="label">${style === "warning" ? `<strong>${esc(field.displayName)}</strong>` : ""}<p>${esc(text || field.displayName)}</p></div>`;
    }
    case "text": {
      const max = Number(config.maxLength) > 0 ? `maxlength="${Number(config.maxLength)}"` : "";
      const input = config.multiline
        ? `<textarea name="${name}" ${max} rows="3">${esc(value)}</textarea>`
        : `<input type="text" name="${name}" ${max} value="${attr(value)}" />`;
      return wrap(`<label class="field-label">${title}${input}</label>`);
    }
    case "url":
      return wrap(`<label class="field-label">${title}<input type="url" inputmode="url" name="${name}" placeholder="https://" value="${attr(value)}" /></label>`);
    case "number":
    case "money": {
      const decimals = field.type === "money" && (config.decimals === undefined || config.decimals === "") ? 2 : config.decimals;
      const min = config.min !== undefined && config.min !== "" ? `min="${attr(config.min)}"` : "";
      const max = config.max !== undefined && config.max !== "" ? `max="${attr(config.max)}"` : "";
      const affixBefore = field.type === "money" ? `<span class="field-form-affix">$</span>` : "";
      const affixAfter = config.unit ? `<span class="field-form-affix">${esc(config.unit)}</span>` : "";
      return wrap(`<label class="field-label">${title}<span class="field-form-affixed">${affixBefore}<input type="number" inputmode="decimal" name="${name}" step="${stepFor(decimals)}" ${min} ${max} value="${attr(value === null ? "" : value)}" />${affixAfter}</span></label>`);
    }
    case "date":
      return wrap(`<label class="field-label">${title}<input type="date" name="${name}" value="${attr(value)}" /></label>`);
    case "time":
      return wrap(`<label class="field-label">${title}<input type="time" name="${name}" value="${attr(value)}" /></label>`);
    case "checkbox":
      return wrap(`<label class="field-check-row field-form-checkbox"><input type="checkbox" name="${name}" ${value === true || value === "true" ? "checked" : ""} /><span>${esc(field.displayName)}${requiredMark(field)}</span></label>`);
    case "selectList": {
      const options = config.options || [];
      const current = typeof value === "string" ? value : "";
      if (options.length && options.length <= 4) {
        return wrap(`<fieldset class="field-form-choice"><legend>${esc(field.displayName)}${requiredMark(field)}</legend>
          <div class="field-form-choice-row">${options
            .map((option) => `<label class="field-form-chip"><input type="radio" name="${name}" value="${attr(option)}" ${option === current ? "checked" : ""} /><span>${esc(option)}</span></label>`)
            .join("")}</div></fieldset>`);
      }
      return wrap(`<label class="field-label">${title}<select name="${name}"><option value="">Select…</option>${options
        .map((option) => `<option value="${attr(option)}" ${option === current ? "selected" : ""}>${esc(option)}</option>`)
        .join("")}</select></label>`);
    }
    case "multiSelect": {
      const selections = asSelections(value);
      return wrap(`<fieldset class="field-form-choice"><legend>${esc(field.displayName)}${requiredMark(field)}</legend>${(config.options || [])
        .map((option) => `<label class="field-check-row"><input type="checkbox" name="${name}" value="${attr(option)}" ${selections.includes(String(option)) ? "checked" : ""} /><span>${esc(option)}</span></label>`)
        .join("")}</fieldset>`);
    }
    case "cascadingList":
      return wrap(`<fieldset class="field-form-choice"><legend>${esc(field.displayName)}${requiredMark(field)}</legend><div data-cascade>${renderCascadeLevels(field, asSelections(value))}</div></fieldset>`);
    case "calculation": {
      const shown = value === null || value === undefined || value === "" ? "—" : formatFieldValueText(field, value);
      return wrap(`<div class="field-label"><span>${esc(field.displayName)}</span><output class="field-form-calc" data-calc-output>${esc(shown)}</output></div>`);
    }
    case "odometer": {
      const vehicles = fleetVehicles();
      const current = value && typeof value === "object" ? value : {};
      const last = lastOdometerReading(current.vehicleId);
      return wrap(`<fieldset class="field-form-choice"><legend>${esc(field.displayName)}${requiredMark(field)}</legend>
        <label class="field-label"><span>Vehicle</span><select data-odo-vehicle name="${name}-vehicle"><option value="">Select a vehicle</option>${vehicles
          .map((asset) => `<option value="${attr(asset.id)}" ${asset.id === current.vehicleId ? "selected" : ""}>${esc(vehicleLabel(asset))}</option>`)
          .join("")}</select></label>
        <label class="field-label"><span>Odometer reading</span><span class="field-form-affixed"><input type="number" inputmode="numeric" min="0" step="any" data-odo-reading name="${name}-reading" value="${attr(current.reading ?? "")}" /><span class="field-form-affix">mi</span></span></label>
        <small class="field-form-help" data-odo-last>${last !== null ? `Last reading: ${esc(last.toLocaleString("en-US"))} mi` : ""}</small>
        <small class="field-form-warn" data-odo-warn></small>
      </fieldset>`);
    }
    case "picture": {
      const allowGallery = config.allowGallery !== false;
      const entries = (Array.isArray(value) ? value : value?.documentId ? [value.documentId] : []).filter(Boolean).map((documentId) => ({ documentId }));
      return wrap(`<fieldset class="field-form-choice"><legend>${esc(field.displayName)}${requiredMark(field)}</legend>
        <div data-photo-list>${renderPhotoThumbs(field, entries)}</div>
        <div class="field-form-photo-actions">
          <button type="button" class="field-button field-button--secondary" data-photo-camera ${preview ? "disabled" : ""}>Take photo</button>
          ${allowGallery ? `<button type="button" class="field-button field-button--ghost" data-photo-gallery ${preview ? "disabled" : ""}>Choose from gallery</button>` : ""}
        </div>
        <div class="field-form-photo-inputs" hidden>
          <input type="file" accept="image/*" data-photo-input data-photo-kind="camera" tabindex="-1" />
          ${allowGallery ? `<input type="file" accept="image/*" multiple data-photo-input data-photo-kind="gallery" data-camera-source="1" tabindex="-1" />` : ""}
        </div>
      </fieldset>`);
    }
    case "signature": {
      const current = value && typeof value === "object" ? value : {};
      return wrap(`<fieldset class="field-form-choice"><legend>${esc(field.displayName)}${requiredMark(field)}</legend>
        ${current.documentId ? `<img class="field-form-signature-saved" src="${attr(thumbUrlFor(current.documentId))}" alt="Saved signature" />` : ""}
        <canvas class="field-form-signature" data-signature width="600" height="200" aria-label="Sign here"></canvas>
        <div class="field-form-photo-actions"><button type="button" class="field-button field-button--ghost" data-signature-clear>Clear</button></div>
        ${config.signerNameRequired ? `<label class="field-label"><span>Signer name${requiredMark(field)}</span><input type="text" name="${name}-signer" autocomplete="name" value="${attr(current.signerName || "")}" /></label>` : ""}
      </fieldset>`);
    }
    default:
      return wrap(`<label class="field-label">${title}<input type="text" name="${name}" value="${attr(value)}" /></label>`);
  }
}

// One answer for reading (office job page, "My submissions", the "view" mode).
function renderAnswerHtml(field, value) {
  if (field.type === "idScan") return renderIdScanAnswer(field, value);
  if (field.type === "picture") {
    const ids = Array.isArray(value) ? value : value?.documentId ? [value.documentId] : [];
    if (!ids.length) return `<span class="muted-text">No photo</span>`;
    return `<span class="form-answer-photos">${ids
      .map((id) => `<a href="/api/documents/${encodeURIComponent(id)}/view" target="_blank" rel="noopener"><img src="${attr(thumbUrlFor(id))}" alt="${attr(field.displayName)}" loading="lazy" /></a>`)
      .join("")}</span>`;
  }
  if (field.type === "signature") {
    const current = value && typeof value === "object" ? value : {};
    if (!current.documentId) return esc(formatFieldValueText(field, value) || "Not signed");
    return `<span class="form-answer-signature"><img src="${attr(thumbUrlFor(current.documentId))}" alt="Signature" loading="lazy" />${current.signerName ? `<small>${esc(current.signerName)}</small>` : ""}</span>`;
  }
  if (field.type === "odometer" && value && typeof value === "object") {
    const asset = (crm.state.backend.equipmentAssets || []).find((row) => row.id === value.vehicleId);
    const label = vehicleLabel(asset) || value.vehicleLabel || "";
    const reading = numericValue(value.reading);
    return esc(`${reading !== null ? `${reading.toLocaleString("en-US")} mi` : "No reading"}${label ? ` · ${label}` : ""}`);
  }
  if (field.type === "url" && typeof value === "string" && /^https?:\/\//i.test(value)) {
    return `<a href="${attr(value)}" target="_blank" rel="noopener">${esc(value)}</a>`;
  }
  if (field.type === "multiSelect" && value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.options)) {
    const checked = new Set(asSelections(value));
    return `<ul class="submission-checklist">${value.options.map((option) => `<li class="${checked.has(option) ? "done" : ""}">${checked.has(option) ? "✓" : "○"} ${esc(option)}</li>`).join("")}</ul>`;
  }
  const text = formatFieldValueText(field, value);
  return text ? esc(text) : `<span class="muted-text">—</span>`;
}

function renderAnswerList(template, values) {
  const rows = template.fields
    .filter((field) => field.type !== "label")
    .filter((field) => Object.prototype.hasOwnProperty.call(values || {}, field.fieldRef))
    .map((field) => `<div class="form-answer-row"><dt>${esc(field.displayName)}</dt><dd>${renderAnswerHtml(field, values[field.fieldRef])}</dd></div>`);
  return rows.length ? `<dl class="form-answers">${rows.join("")}</dl>` : "";
}

// renderFormFields(template, values, { mode }) -> HTML. mode "edit" (default) and "preview" draw the
// inputs (preview leaves the file pickers disabled); "view" draws the answers read-only.
export function renderFormFields(template, values = {}, { mode = "edit" } = {}) {
  const normalized = normalizeFormTemplate(template);
  if (!normalized) return "";
  if (mode === "view") return renderAnswerList(normalized, values || {});
  const withCalcs = computeCalculations(normalized.fields, collectableDefaults(normalized, values || {}));
  return normalized.fields.map((field) => renderFieldEdit(field, field.type === "calculation" ? withCalcs[field.fieldRef] : initialValue(field, values || {}), { preview: mode === "preview" })).join("");
}

function collectableDefaults(template, values) {
  const out = {};
  template.fields.forEach((field) => {
    out[field.fieldRef] = initialValue(field, values);
  });
  return out;
}

// For the office: a submission's answers with the template's display names. Old submissions whose
// template can't be found (typed job-action captures) return "" and keep their existing rendering.
export function renderFormSubmissionAnswers(submission) {
  if (!submission) return "";
  const deferred = submission.deferred ? `<p class="submission-fact form-deferred"><strong>Not filled in</strong> — ${esc(submission.deferReason || "no reason given")}</p>` : "";
  const context = submission.timesheetAction ? `<p class="submission-fact">${esc(TIMESHEET_ACTIONS[submission.timesheetAction] || submission.timesheetAction)} form${submission.repeatIndex ? ` · entry ${Number(submission.repeatIndex) + 1}` : ""}</p>` : submission.repeatIndex ? `<p class="submission-fact">Entry ${Number(submission.repeatIndex) + 1}</p>` : "";
  const template = templateForSubmission(submission);
  if (!template) return deferred || context ? `${context}${deferred}` : "";
  return `${context}${deferred}${renderAnswerList(template, submission.payload || {})}`;
}

// A short plain-text line for the submission's `summary` (timelines, the day narrative draft).
function summarize(template, values) {
  const parts = [];
  for (const field of template.fields) {
    if (field.type === "label" || field.type === "picture" || field.type === "signature") continue;
    const text = formatFieldValueText(field, values[field.fieldRef]);
    if (!text) continue;
    parts.push(`${field.displayName}: ${text}`);
    if (parts.join("; ").length > 180) break;
  }
  const line = parts.join("; ");
  return line.length > 240 ? `${line.slice(0, 237)}…` : line;
}

// ---------------------------------------------------------------------------------------------
// The sheet: open, wire, validate, collect
// ---------------------------------------------------------------------------------------------

let sheetToken = 0;

function sheetElement() {
  let dialog = document.getElementById("fieldFormSheet");
  if (dialog?.isConnected) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "fieldFormSheet";
  dialog.className = "field-form-sheet";
  document.body.append(dialog);
  return dialog;
}

// Open a form. Resolves { action: "submit", values, jobId, session } | { action: "defer", reason, jobId } | null.
//   jobs:        job choices for a "Related job" picker (omit to hide it); requireJob: must pick one
//   allowDefer:  shows "Not now" (timesheet forms)
//   intro:       a line above the fields (e.g. "Fill this in before you clock out.")
function openFormSheet(template, { values = {}, jobs = null, requireJob = false, jobId = "", allowDefer = false, intro = "", submitLabel = "Submit" } = {}) {
  return new Promise((resolve) => {
    const dialog = sheetElement();
    const token = ++sheetToken;
    let settled = false;
    const session = { pictures: new Map(), signatures: new Map(), objectUrls: [] };
    const done = (result) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
      if (!result) session.objectUrls.forEach((url) => URL.revokeObjectURL(url));
      resolve(result);
    };
    const onCancel = (event) => {
      event.preventDefault();
      done(null);
    };
    const onClose = () => {
      if (token === sheetToken) done(null);
    };
    dialog.innerHTML = `
      <form class="field-form-sheet-form" novalidate>
        <header class="field-form-sheet-head">
          <button type="button" class="field-photo-sheet-close" data-form-close aria-label="Close">×</button>
          <strong>${esc(template.displayName)}</strong>
        </header>
        <div class="field-form-sheet-body">
          ${intro ? `<p class="field-form-intro">${esc(intro)}</p>` : ""}
          ${template.description ? `<p class="help-text">${esc(template.description)}</p>` : ""}
          <div class="field-form-summary" data-form-summary role="alert" hidden></div>
          ${
            jobs
              ? `<label class="field-label"><span>${requireJob ? `Job${`<b class="field-form-req">*</b>`}` : "Related job (optional)"}</span>
                  <select name="jobId">
                    <option value="">${requireJob ? "Select a job" : "Not tied to a specific job"}</option>
                    ${jobs.map((job) => `<option value="${attr(job.id)}" ${job.id === jobId ? "selected" : ""}>${esc(crm.frontlineJobOptionLabel(job))}</option>`).join("")}
                  </select>
                </label><small class="field-form-error" data-error-for="__job"></small>`
              : ""
          }
          <div class="field-form-fields">${renderFormFields(template, values, { mode: "edit" })}</div>
          ${
            allowDefer
              ? `<div class="field-form-defer" data-defer-panel hidden>
                  <label class="field-label"><span>Why not now?<b class="field-form-req">*</b></span><textarea name="deferReason" rows="2" placeholder="e.g. no signal at the yard, will fill in at lunch"></textarea></label>
                  <small class="field-form-error" data-error-for="__defer"></small>
                  <div class="field-form-sheet-actions">
                    <button type="button" class="field-button field-button--ghost" data-defer-back>Back to the form</button>
                    <button type="button" class="field-button field-button--secondary" data-defer-confirm>Skip the form</button>
                  </div>
                </div>`
              : ""
          }
        </div>
        <footer class="field-form-sheet-actions" data-form-actions>
          ${allowDefer ? `<button type="button" class="field-button field-button--ghost" data-form-defer>Not now</button>` : `<button type="button" class="field-button field-button--ghost" data-form-close>Cancel</button>`}
          <button type="submit" class="field-button" data-form-submit>${esc(submitLabel)}</button>
        </footer>
      </form>`;
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);
    const form = dialog.querySelector("form");
    dialog.querySelectorAll("[data-form-close]").forEach((button) => (button.onclick = () => done(null)));
    wireFormFields(form, template, session, values);

    if (allowDefer) {
      const panel = dialog.querySelector("[data-defer-panel]");
      const fields = dialog.querySelector(".field-form-fields");
      const actions = dialog.querySelector("[data-form-actions]");
      dialog.querySelector("[data-form-defer]").onclick = () => {
        panel.hidden = false;
        fields.hidden = true;
        actions.hidden = true;
        panel.querySelector("textarea").focus();
      };
      dialog.querySelector("[data-defer-back]").onclick = () => {
        panel.hidden = true;
        fields.hidden = false;
        actions.hidden = false;
      };
      dialog.querySelector("[data-defer-confirm]").onclick = () => {
        const reason = (form.elements.deferReason?.value || "").trim();
        const error = dialog.querySelector('[data-error-for="__defer"]');
        if (!reason) {
          error.textContent = "Say why you are not filling it in now — the office sees this.";
          return;
        }
        done({ action: "defer", reason, jobId: (form.elements.jobId?.value || "").toString() });
      };
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const collected = collectFormValues(form, template, session);
      const chosenJob = (form.elements.jobId?.value || "").toString();
      if (jobs && requireJob && !chosenJob) collected.errors.__job = "Pick the job this form is for.";
      showErrors(dialog, template, collected.errors);
      if (Object.keys(collected.errors).length) return;
      done({ action: "submit", values: collected.values, jobId: chosenJob, session });
    });

    if (!dialog.open) dialog.showModal();
    dialog.querySelector(".field-form-sheet-body").scrollTop = 0;
  });
}

function showErrors(dialog, template, errors) {
  dialog.querySelectorAll("[data-error-for]").forEach((el) => {
    const message = errors[el.dataset.errorFor] || "";
    el.textContent = message;
    el.closest(".field-form-field")?.classList.toggle("has-error", Boolean(message));
  });
  const summary = dialog.querySelector("[data-form-summary]");
  const keys = Object.keys(errors);
  if (!keys.length) {
    summary.hidden = true;
    summary.textContent = "";
    return;
  }
  summary.hidden = false;
  summary.textContent = `${keys.length === 1 ? "One answer needs" : `${keys.length} answers need`} attention: ${keys
    .map((key) => (key === "__job" ? "Job" : template.fields.find((field) => field.fieldRef === key)?.displayName || key))
    .join(", ")}.`;
  const first = dialog.querySelector(".field-form-field.has-error") || summary;
  first.scrollIntoView?.({ block: "center", behavior: "smooth" });
}

function fieldRoot(form, field) {
  return form.querySelector(`.field-form-field[data-ref="${CSS.escape(field.fieldRef)}"]`);
}

// Live behaviour: calculations, cascading selects, odometer warnings, photos, signatures.
function wireFormFields(form, template, session, values = {}) {
  wireIdScanFields(form, template, session, values);
  const recalc = () => {
    const calcs = template.fields.filter((field) => field.type === "calculation");
    if (!calcs.length) return;
    const values = computeCalculations(template.fields, readRawValues(form, template, session));
    for (const field of calcs) {
      const output = fieldRoot(form, field)?.querySelector("[data-calc-output]");
      if (output) output.textContent = values[field.fieldRef] === null || values[field.fieldRef] === undefined ? "—" : formatFieldValueText(field, values[field.fieldRef]);
    }
  };
  const odometerCheck = (root) => {
    const vehicleId = root.querySelector("[data-odo-vehicle]")?.value || "";
    const reading = numericValue(root.querySelector("[data-odo-reading]")?.value);
    const last = lastOdometerReading(vehicleId);
    const lastEl = root.querySelector("[data-odo-last]");
    const warnEl = root.querySelector("[data-odo-warn]");
    if (lastEl) lastEl.textContent = last !== null ? `Last reading: ${last.toLocaleString("en-US")} mi` : vehicleId ? "No earlier reading on file." : "";
    if (warnEl) warnEl.textContent = last !== null && reading !== null && reading < last ? `Lower than the last reading (${last.toLocaleString("en-US")} mi) — check the number.` : "";
  };

  // An answer being changed clears that question's error from the last submit attempt.
  const clearError = (root) => {
    if (!root?.classList.contains("has-error")) return;
    root.classList.remove("has-error");
    const error = root.querySelector("[data-error-for]");
    if (error) error.textContent = "";
  };
  form.addEventListener("input", (event) => {
    clearError(event.target.closest(".field-form-field"));
    recalc();
  });
  form.addEventListener("change", (event) => {
    const root = event.target.closest(".field-form-field");
    if (!root) return;
    clearError(root);
    const field = template.fields.find((item) => item.fieldRef === root.dataset.ref);
    if (!field) return;
    if (field.type === "cascadingList" && event.target.matches("[data-cascade-level]")) {
      const level = Number(event.target.dataset.cascadeLevel);
      const selections = [...root.querySelectorAll("[data-cascade-level]")].map((select) => select.value);
      const kept = selections.slice(0, level + 1);
      root.querySelector("[data-cascade]").innerHTML = renderCascadeLevels(field, kept);
    }
    if (field.type === "odometer") odometerCheck(root);
    if (field.type === "picture" && event.target.matches("[data-photo-input]")) {
      addPhotos(root, field, session, [...(event.target.files || [])]);
      event.target.value = "";
    }
    recalc();
  });
  form.querySelectorAll('.field-form-field[data-type="odometer"]').forEach((root) => {
    root.querySelector("[data-odo-reading]")?.addEventListener("input", () => odometerCheck(root));
  });

  for (const field of template.fields) {
    const root = fieldRoot(form, field);
    if (!root) continue;
    if (field.type === "picture") {
      const start = values?.[field.fieldRef];
      const ids = (Array.isArray(start) ? start : start?.documentId ? [start.documentId] : []).filter((id) => typeof id === "string" && id);
      session.pictures.set(field.fieldRef, ids.map((documentId) => ({ documentId, url: thumbUrlFor(documentId) })));
      root.addEventListener("click", (event) => {
        // "Take photo" goes through the app-wide camera button app.js adds after every image file
        // input (native camera on a phone, the webcam dialog on a desktop); "Choose from gallery" is
        // a plain multi-file picker.
        if (event.target.closest("[data-photo-camera]")) {
          const input = root.querySelector('[data-photo-kind="camera"]');
          const camera = input?.nextElementSibling?.classList.contains("camera-capture-button") ? input.nextElementSibling : null;
          (camera || input)?.click();
          return;
        }
        if (event.target.closest("[data-photo-gallery]")) {
          root.querySelector('[data-photo-kind="gallery"]')?.click();
          return;
        }
        const remove = event.target.closest("[data-photo-remove]");
        if (!remove) return;
        const entries = session.pictures.get(field.fieldRef) || [];
        entries.splice(Number(remove.dataset.photoRemove), 1);
        session.pictures.set(field.fieldRef, entries);
        drawPhotos(root, field, session);
      });
    }
    if (field.type === "signature") wireSignature(root, field, session);
  }
}

function addPhotos(root, field, session, files) {
  const entries = session.pictures.get(field.fieldRef) || [];
  const max = Number(field.config.max) || 0;
  let skipped = 0;
  for (const file of files) {
    if (!/^image\//.test(file.type || "image/")) continue;
    if (max && entries.length >= max) {
      skipped += 1;
      continue;
    }
    const url = URL.createObjectURL(file);
    session.objectUrls.push(url);
    entries.push({ file, url, documentId: "" });
  }
  session.pictures.set(field.fieldRef, entries);
  drawPhotos(root, field, session);
  if (skipped) crm.showToast(`${field.displayName} takes up to ${max} photo${max === 1 ? "" : "s"}; ${skipped} left out.`);
}

function drawPhotos(root, field, session) {
  const list = root.querySelector("[data-photo-list]");
  if (list) list.innerHTML = renderPhotoThumbs(field, session.pictures.get(field.fieldRef) || []);
  const max = Number(field.config.max) || 0;
  const full = max && (session.pictures.get(field.fieldRef) || []).length >= max;
  root.querySelectorAll("[data-photo-camera], [data-photo-gallery]").forEach((button) => {
    button.disabled = Boolean(full);
  });
}

function wireSignature(root, field, session) {
  const canvas = root.querySelector("[data-signature]");
  if (!canvas) return;
  const pad = { strokes: [], canvas };
  session.signatures.set(field.fieldRef, pad);
  const context = canvas.getContext("2d");
  const paint = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#13241b";
    for (const stroke of pad.strokes) {
      if (stroke.length < 2) {
        if (stroke.length === 1) {
          context.beginPath();
          context.arc(stroke[0].x, stroke[0].y, 1.5, 0, Math.PI * 2);
          context.fillStyle = "#13241b";
          context.fill();
        }
        continue;
      }
      context.beginPath();
      context.moveTo(stroke[0].x, stroke[0].y);
      for (const point of stroke.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
  };
  const positionOf = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * canvas.width, y: ((event.clientY - rect.top) / rect.height) * canvas.height };
  };
  let active = null;
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    root.classList.remove("has-error");
    const error = root.querySelector("[data-error-for]");
    if (error) error.textContent = "";
    active = [positionOf(event)];
    pad.strokes.push(active);
    canvas.setPointerCapture?.(event.pointerId);
    paint();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!active) return;
    event.preventDefault();
    active.push(positionOf(event));
    paint();
  });
  const end = () => {
    active = null;
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", end);
  root.querySelector("[data-signature-clear]")?.addEventListener("click", () => {
    pad.strokes = [];
    paint();
  });
  paint();
}

function signatureBlob(pad) {
  if (!pad?.strokes?.length) return Promise.resolve(null);
  const out = document.createElement("canvas");
  out.width = pad.canvas.width;
  out.height = pad.canvas.height;
  const context = out.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, out.width, out.height);
  context.drawImage(pad.canvas, 0, 0);
  return new Promise((resolve) => out.toBlob(resolve, "image/png"));
}

// What the inputs hold right now, before validation (calculations read this).
function readRawValues(form, template, session) {
  const values = {};
  for (const field of template.fields) {
    const root = fieldRoot(form, field);
    if (!root) continue;
    if (field.type === "idScan") {
      values[field.fieldRef] = idScanEntries(session).get(field.fieldRef)?.value || null;
      continue;
    }
    const name = fieldName(field);
    switch (field.type) {
      case "label":
      case "calculation":
        break;
      case "checkbox":
        values[field.fieldRef] = Boolean(root.querySelector(`input[name="${CSS.escape(name)}"]`)?.checked);
        break;
      case "selectList": {
        const checked = root.querySelector(`input[name="${CSS.escape(name)}"]:checked`);
        const select = root.querySelector(`select[name="${CSS.escape(name)}"]`);
        values[field.fieldRef] = (checked?.value ?? select?.value ?? "").toString();
        break;
      }
      case "multiSelect":
        values[field.fieldRef] = [...root.querySelectorAll(`input[name="${CSS.escape(name)}"]:checked`)].map((input) => input.value);
        break;
      case "cascadingList":
        values[field.fieldRef] = [...root.querySelectorAll("[data-cascade-level]")].map((select) => select.value).filter(Boolean);
        break;
      case "odometer": {
        const vehicleId = root.querySelector("[data-odo-vehicle]")?.value || "";
        const reading = numericValue(root.querySelector("[data-odo-reading]")?.value);
        values[field.fieldRef] = { vehicleId, reading };
        break;
      }
      case "picture":
        values[field.fieldRef] = session.pictures.get(field.fieldRef) || [];
        break;
      case "signature":
        values[field.fieldRef] = session.signatures.get(field.fieldRef) || null;
        break;
      default: {
        const input = root.querySelector(`[name="${CSS.escape(name)}"]`);
        values[field.fieldRef] = (input?.value ?? "").toString().trim();
      }
    }
  }
  return values;
}

// Validate and shape every answer. Returns { values, errors: {fieldRef: message} }. Picture and
// signature values come back as placeholders the save step replaces with document ids.
function collectFormValues(form, template, session) {
  const raw = readRawValues(form, template, session);
  const values = {};
  const errors = {};
  const need = (field, message) => {
    errors[field.fieldRef] = message || `${field.displayName} is required.`;
  };
  for (const field of template.fields) {
    const ref = field.fieldRef;
    const config = field.config || {};
    const value = raw[ref];
    if (field.type === "idScan") {
      collectIdScan(field, idScanEntries(session).get(ref), values, need);
      continue;
    }
    switch (field.type) {
      case "label":
      case "calculation":
        break;
      case "text":
        if (field.required && !value) need(field);
        if (value && Number(config.maxLength) > 0 && value.length > Number(config.maxLength)) need(field, `${field.displayName} is limited to ${config.maxLength} characters.`);
        values[ref] = value;
        break;
      case "url": {
        let url = value;
        if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
        if (url) {
          try {
            const parsed = new URL(url);
            if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes(".")) throw new Error("bad");
          } catch {
            need(field, `${field.displayName} is not a web address.`);
          }
        } else if (field.required) need(field);
        values[ref] = url;
        break;
      }
      case "number":
      case "money": {
        const decimals = field.type === "money" && (config.decimals === undefined || config.decimals === "") ? 2 : config.decimals;
        const number = numericValue(value);
        if (value !== "" && number === null) need(field, `${field.displayName} must be a number.`);
        else if (number === null && field.required) need(field);
        else if (number !== null) {
          if (config.min !== undefined && config.min !== "" && number < Number(config.min)) need(field, `${field.displayName} must be at least ${config.min}.`);
          if (config.max !== undefined && config.max !== "" && number > Number(config.max)) need(field, `${field.displayName} must be at most ${config.max}.`);
        }
        values[ref] = number === null ? null : decimals !== undefined && decimals !== "" ? roundTo(number, decimals) : number;
        break;
      }
      case "date":
      case "time":
        if (field.required && !value) need(field);
        values[ref] = value;
        break;
      case "checkbox":
        if (field.required && !value) need(field, `Tick "${field.displayName}" to continue.`);
        values[ref] = Boolean(value);
        break;
      case "selectList":
        if (field.required && !value) need(field, `Choose an answer for ${field.displayName}.`);
        values[ref] = value;
        break;
      case "multiSelect":
        if (field.required && !value.length) need(field, `Tick at least one for ${field.displayName}.`);
        values[ref] = value;
        break;
      case "cascadingList": {
        const levels = Array.isArray(config.levels) && config.levels.length ? config.levels : ["Choice"];
        const complete = levels.every((_, level) => value[level] || !cascadeOptions(config.rows, level, value).length);
        if (field.required && (!value.length || !complete)) need(field, `Choose every level of ${field.displayName}.`);
        values[ref] = value;
        break;
      }
      case "odometer": {
        const hasAny = value.vehicleId || value.reading !== null;
        if (field.required && (!value.vehicleId || value.reading === null)) need(field, `Pick the vehicle and enter the reading for ${field.displayName}.`);
        else if (hasAny && !value.vehicleId) need(field, `Pick the vehicle for ${field.displayName}.`);
        else if (hasAny && value.reading === null) need(field, `Enter the reading for ${field.displayName}.`);
        else if (value.reading !== null && value.reading < 0) need(field, `${field.displayName} cannot be negative.`);
        const asset = (crm.state.backend.equipmentAssets || []).find((row) => row.id === value.vehicleId);
        values[ref] = hasAny ? { vehicleId: value.vehicleId, reading: value.reading, vehicleLabel: vehicleLabel(asset) } : null;
        break;
      }
      case "picture": {
        const min = Number(config.min) || (field.required ? 1 : 0);
        const max = Number(config.max) || 0;
        if (value.length < min) need(field, min === 1 ? `Add a photo for ${field.displayName}.` : `${field.displayName} needs at least ${min} photos.`);
        if (max && value.length > max) need(field, `${field.displayName} takes up to ${max} photos.`);
        values[ref] = value;
        break;
      }
      case "signature": {
        const signed = Boolean(value?.strokes?.length);
        const signerName = (form.querySelector(`[name="${CSS.escape(fieldName(field))}-signer"]`)?.value || "").trim();
        if (field.required && !signed) need(field, `${field.displayName} needs a signature.`);
        else if (signed && config.signerNameRequired && !signerName) need(field, `Type the signer's name for ${field.displayName}.`);
        values[ref] = { pad: value, signerName };
        break;
      }
      default:
        if (field.required && !value) need(field);
        values[ref] = value;
    }
  }
  return { values: computeCalculations(template.fields, values), errors };
}

// ---------------------------------------------------------------------------------------------
// Driver's licence scan (type idScan; owner request 2026-10-01)
// ---------------------------------------------------------------------------------------------
//
// "Scan licence" reads the PDF417 barcode on the back of a driver's licence with field/idscan.js
// (the roll call's reader). The answer keeps the same minimum as the roll call (Phase 25 A.3b):
//   { displayName, idState, idLast4, idExpiry, scannedAt, employeeId?, lat?, lng?, accuracyM? }
// -- never the licence number, DOB, address or the photo (decoded on the phone, never uploaded).
// config: { matchEmployee, expiredPolicy: "warn" | "block", captureGps }.
// matchEmployee asks POST /api/field/id-lookup who the licence belongs to: the server hashes state +
// number the way the roll call does and answers, storing nothing and linking no one. With no signal
// the number waits in memory (session.idScans) until the form is submitted; the lookup is then queued
// in the outbox behind the submission (its number redacted once sent) and the answer patches the
// submission's employeeId when it comes back (field:command-done, from field/package.js).

const ID_SCAN_ANSWER_KEYS = ["displayName", "idState", "idLast4", "idExpiry", "scannedAt", "employeeId", "lat", "lng", "accuracyM"];

// fieldRef -> { value, expired, match: ""|"checking"|"matched"|"none"|"pending"|"error", matchName,
//               message, pending: {idState, licenceNumber} | null, seq }
function idScanEntries(session) {
  if (!session.idScans) session.idScans = new Map();
  return session.idScans;
}

function idScanAnswer(value) {
  if (!value || typeof value !== "object") return null;
  const out = {};
  for (const key of ID_SCAN_ANSWER_KEYS) if (value[key] !== undefined && value[key] !== "" && value[key] !== null) out[key] = value[key];
  return out.idLast4 || out.displayName ? out : null;
}

function idScanEntryFromValue(field, value) {
  const answer = idScanAnswer(value);
  if (!answer) return null;
  const employee = answer.employeeId ? crm.findEmployee(answer.employeeId) : null;
  return {
    value: answer,
    expired: Boolean(answer.idExpiry) && answer.idExpiry < localToday(),
    match: answer.employeeId ? "matched" : field.config?.matchEmployee ? "none" : "",
    matchName: employee?.displayName || "",
    message: "",
    pending: null,
    seq: 0,
  };
}

function idScanBlocked(field, entry) {
  return Boolean(entry?.expired) && field.config?.expiredPolicy === "block";
}

function renderIdScanCard(field, entry) {
  if (!entry?.value) return `<p class="field-card-sub" data-idscan-empty>No licence scanned yet.</p>`;
  const value = entry.value;
  const blocked = idScanBlocked(field, entry);
  const expiryDate = value.idExpiry ? crm.formatDate(value.idExpiry) : "";
  const expiredLine = entry.expired
    ? `<p class="field-form-idscan-alert" data-idscan-expired>${
        blocked ? `This licence expired on ${esc(expiryDate)}. A current licence is needed — scan another one.` : `This licence expired on ${esc(expiryDate)}. Follow up on a current licence.`
      }</p>`
    : "";
  const matchText = {
    checking: "Looking them up…",
    matched: `Matched: ${entry.matchName || "employee on file"}`,
    none: "Not on file",
    pending: "No signal — checked against employees when the phone reconnects.",
    error: `Couldn't check who this is${entry.message ? `: ${entry.message}` : "."}`,
  }[entry.match];
  const matchLine = field.config?.matchEmployee && matchText ? `<p data-idscan-match="${attr(entry.match)}">${entry.match === "matched" ? `<strong>${esc(matchText)}</strong>` : esc(matchText)}</p>` : "";
  return `
    <div class="field-form-idscan-card ${blocked ? "is-blocked" : ""}" data-idscan-card>
      <p><strong data-idscan-name>${esc(value.displayName || "Name not read")}</strong></p>
      <p class="field-card-sub">${esc(value.idState || "")} licence ••••${esc(value.idLast4 || "")}${expiryDate ? ` · expires ${esc(expiryDate)}` : ""}</p>
      ${expiredLine}
      ${matchLine}
    </div>`;
}

function renderIdScanEdit(field, value, { preview = false } = {}) {
  const entry = idScanEntryFromValue(field, value);
  return `<div class="field-form-field field-form-idscan" data-ref="${attr(field.fieldRef)}" data-type="idScan">
      <fieldset class="field-form-choice"><legend>${esc(field.displayName)}${requiredMark(field)}</legend>
        <div data-idscan-slot>${renderIdScanCard(field, entry)}</div>
        <div class="field-form-photo-actions">
          <button type="button" class="field-button field-button--secondary" data-idscan-start ${preview ? "disabled" : ""}>${entry ? "Scan again" : "Scan licence"}</button>
          <button type="button" class="field-button field-button--ghost" data-idscan-clear ${entry ? "" : "hidden"}>Clear</button>
        </div>
        <small class="field-form-help">Camera, or a photo of the back of the licence. Only the name, state, last 4 digits and expiry are kept.</small>
      </fieldset>
      ${helpAndError(field)}
    </div>`;
}

function renderIdScanAnswer(field, value) {
  const answer = idScanAnswer(value);
  if (!answer) return `<span class="muted-text">No licence scanned</span>`;
  const employee = answer.employeeId ? crm.findEmployee(answer.employeeId) : null;
  const text = formatIdScanText(answer, { formatDate: (date) => crm.formatDate(date), employeeName: employee?.displayName || "", matchEmployee: Boolean(field.config?.matchEmployee), today: localToday() });
  return `<span data-idscan-answer>${esc(text)}</span>`;
}

// Who the licence belongs to: { status: "matched", employeeId, displayName } | { status: "none" } |
// { status: "offline" } | { status: "error", message }.
async function lookupLicence(idState, licenceNumber) {
  if (!fieldPackage.isOnline()) return { status: "offline" };
  try {
    const result = await crm.apiRequest("/api/field/id-lookup", { method: "POST", body: JSON.stringify({ idState, licenceNumber }) });
    return result?.employeeId ? { status: "matched", employeeId: result.employeeId, displayName: result.displayName || "" } : { status: "none" };
  } catch (error) {
    if (!error?.status || error.status >= 500 || error.status === 408) return { status: "offline" };
    return { status: "error", message: error?.payload?.error || error.message || "" };
  }
}

function wireIdScanFields(form, template, session, values = {}) {
  const entries = idScanEntries(session);
  for (const field of template.fields) {
    if (field.type !== "idScan") continue;
    const root = fieldRoot(form, field);
    if (!root) continue;
    const start = idScanEntryFromValue(field, values?.[field.fieldRef]);
    if (start) entries.set(field.fieldRef, start);
    const draw = () => {
      const entry = entries.get(field.fieldRef) || null;
      root.querySelector("[data-idscan-slot]").innerHTML = renderIdScanCard(field, entry);
      root.querySelector("[data-idscan-start]").textContent = entry ? "Scan again" : "Scan licence";
      root.querySelector("[data-idscan-clear]").hidden = !entry;
      root.classList.remove("has-error");
      const error = root.querySelector("[data-error-for]");
      if (error) error.textContent = "";
    };
    root.querySelector("[data-idscan-clear]")?.addEventListener("click", () => {
      entries.delete(field.fieldRef);
      draw();
    });
    root.querySelector("[data-idscan-start]")?.addEventListener("click", async () => {
      const scanned = await scanLicence({ title: field.displayName || "Scan licence", captureGps: Boolean(field.config?.captureGps) });
      if (!scanned || !form.isConnected) return;
      const { licence, summary } = scanned;
      const previous = entries.get(field.fieldRef);
      const entry = {
        value: { displayName: summary.displayName || "", idState: summary.idState, idLast4: summary.idLast4, idExpiry: summary.idExpiry || "", scannedAt: new Date().toISOString() },
        expired: Boolean(summary.expired),
        match: field.config?.matchEmployee ? "checking" : "",
        matchName: "",
        message: "",
        // The number stays in memory only while the match is still to be checked.
        pending: field.config?.matchEmployee ? { idState: licence.state, licenceNumber: licence.licenceNumber } : null,
        seq: (previous?.seq || 0) + 1,
      };
      entries.set(field.fieldRef, entry);
      draw();
      const seq = entry.seq;
      const located = field.config?.captureGps
        ? scanned.position().then((fix) => {
            if (fix && entries.get(field.fieldRef)?.seq === seq) Object.assign(entry.value, { lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM });
          })
        : Promise.resolve();
      if (entry.pending) {
        const found = await lookupLicence(entry.pending.idState, entry.pending.licenceNumber);
        if (entries.get(field.fieldRef)?.seq !== seq) return;
        if (found.status === "offline") {
          entry.match = "pending";
        } else {
          entry.pending = null;
          entry.match = found.status === "matched" ? "matched" : found.status === "none" ? "none" : "error";
          entry.message = found.message || "";
          if (found.status === "matched") {
            entry.value.employeeId = found.employeeId;
            entry.matchName = found.displayName || crm.findEmployee(found.employeeId)?.displayName || "";
          }
        }
        if (form.isConnected) draw();
      }
      await located;
    });
  }
}

function collectIdScan(field, entry, values, need) {
  const ref = field.fieldRef;
  if (!entry?.value) {
    if (field.required) need(field, `Scan a driver's licence for ${field.displayName}.`);
    values[ref] = null;
    return;
  }
  if (idScanBlocked(field, entry)) need(field, `${field.displayName}: this licence expired on ${crm.formatDate(entry.value.idExpiry)}. Scan a current licence.`);
  values[ref] = idScanAnswer(entry.value);
}

// At submit, online: check any scan whose match is still open before the submission is saved.
async function resolvePendingIdLookups(template, filled) {
  const entries = filled?.session?.idScans;
  if (!entries || !fieldPackage.isOnline()) return;
  for (const field of template.fields) {
    const entry = field.type === "idScan" ? entries.get(field.fieldRef) : null;
    if (!entry?.pending || !filled.values[field.fieldRef]) continue;
    const found = await lookupLicence(entry.pending.idState, entry.pending.licenceNumber);
    if (found.status === "offline") continue;
    entry.pending = null;
    if (found.status === "matched") filled.values[field.fieldRef] = { ...filled.values[field.fieldRef], employeeId: found.employeeId };
  }
}

// After the submission is saved (or queued): a scan still waiting for its match goes into the outbox
// behind it. The number leaves memory here; the outbox drops it once the server has answered.
async function queuePendingIdLookups(template, filled, submissionId) {
  const entries = filled?.session?.idScans;
  if (!entries) return;
  for (const field of template.fields) {
    const entry = field.type === "idScan" ? entries.get(field.fieldRef) : null;
    if (!entry?.pending) continue;
    const pending = entry.pending;
    entry.pending = null;
    const answer = filled.values[field.fieldRef];
    if (!answer) continue;
    const body = { idState: pending.idState, licenceNumber: pending.licenceNumber, submissionId, fieldRef: field.fieldRef };
    try {
      const result = await fieldPackage.fieldRequest("/api/field/id-lookup", {
        method: "POST",
        kind: "id-lookup",
        label: `Licence check — ${template.displayName} (••••${answer.idLast4 || ""})`,
        body,
        redactOnDone: ["licenceNumber"],
      });
      if (result) await applyIdLookupResult(submissionId, field.fieldRef, result);
    } catch {
      // Refused (e.g. too many lookups): the scan stays on the submission, unmatched.
    } finally {
      body.licenceNumber = "";
    }
  }
}

// A lookup answered after the submission was saved: put the matched employee on the stored answer.
async function applyIdLookupResult(submissionId, fieldRef, result) {
  if (!submissionId || !fieldRef || !result?.employeeId) return;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = (crm.state.backend.jobFormSubmissions || []).find((item) => item.id === submissionId);
    const answer = idScanAnswer(row?.payload?.[fieldRef]);
    if (!row || !answer || answer.employeeId) return;
    const next = { ...row, payload: { ...row.payload, [fieldRef]: { ...answer, employeeId: result.employeeId } } };
    try {
      await fieldPackage.saveFieldRecord("jobFormSubmissions", next, { kind: "form-submission", label: `${row.formName || "Form"} — licence match` });
      return;
    } catch (error) {
      if (!error?.conflict) return; // the stale copy was replaced with the server's; try once more
    }
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("field:command-done", (event) => {
    const detail = event.detail || {};
    if (detail.kind !== "id-lookup") return;
    applyIdLookupResult(detail.body?.submissionId, detail.body?.fieldRef, detail.result).catch(() => {});
  });
}

// ---------------------------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------------------------

// Build and save a jobFormSubmissions row from a filled sheet, then upload its pictures and
// signatures as documents with ids chosen here. Online or offline, resolves to the stored row.
async function saveSubmission(template, filled, context = {}) {
  await resolvePendingIdLookups(template, filled);
  const employee = currentFieldEmployee();
  const id = crm.makeId("form-sub");
  const payload = {};
  const uploads = [];
  for (const field of template.fields) {
    const ref = field.fieldRef;
    if (!Object.prototype.hasOwnProperty.call(filled.values, ref)) continue;
    const value = filled.values[ref];
    if (field.type === "picture") {
      payload[ref] = (value || []).map((entry, index) => {
        if (entry.documentId && !entry.file) return entry.documentId;
        const documentId = crm.makeId("document");
        uploads.push({ ref, documentId, file: namedImageFile(entry.file, `${ref}-${index + 1}`), caption: `${template.displayName} — ${field.displayName}` });
        return documentId;
      });
    } else if (field.type === "signature") {
      const blob = await signatureBlob(value?.pad);
      if (blob) {
        const documentId = crm.makeId("document");
        uploads.push({ ref, documentId, file: new File([blob], `signature-${ref}.png`, { type: "image/png" }), caption: `${template.displayName} — ${field.displayName}${value.signerName ? ` (${value.signerName})` : ""}` });
        payload[ref] = { documentId, signerName: value.signerName || "" };
      } else {
        payload[ref] = null;
      }
    } else {
      payload[ref] = value;
    }
  }
  const submission = {
    id,
    jobId: context.jobId || "",
    actionId: context.actionId || "",
    formTemplateId: template.id,
    formVersion: Number(template.version) || 1,
    formName: template.displayName,
    repeatIndex: Number(context.repeatIndex) || 0,
    timesheetAction: context.timesheetAction || "",
    timeEntryId: context.timeEntryId || "",
    deferred: false,
    deferReason: "",
    standalone: !context.actionId,
    status: "Submitted",
    submittedBy: employee?.displayName || crm.currentActorName?.() || "Front Line",
    submittedByEmployeeId: employee?.id || "",
    submittedAt: new Date().toISOString(),
    summary: summarize(template, filled.values) || `${template.displayName} submitted.`,
    payload,
  };
  await fieldPackage.saveFieldRecord("jobFormSubmissions", submission, { kind: "form-submission", label: template.displayName });
  await queuePendingIdLookups(template, filled, id);

  // The row exists (or is queued ahead of these), so the documents can point at it.
  let changed = false;
  let failed = 0;
  for (const upload of uploads) {
    let finalId = upload.documentId;
    try {
      const saved = await fieldPackage.uploadFieldFile("/api/documents", upload.file, {
        "X-Entity-Type": "formSubmission",
        "X-Entity-Id": id,
        "X-Visibility": "internal",
        "X-Caption": encodeURIComponent(upload.caption.slice(0, 200)),
        "X-Document-Id": upload.documentId,
      });
      if (saved?.id) {
        finalId = saved.id;
        if (!saved.pendingUpload) fieldPackage.mergeRow("documents", saved);
      }
    } catch (error) {
      // The same file already on this submission (two fields, one photo) comes back 409 with its id.
      finalId = error?.status === 409 && error?.payload?.documentId ? error.payload.documentId : "";
      if (!finalId) failed += 1;
    }
    if (finalId !== upload.documentId) {
      changed = true;
      const current = payload[upload.ref];
      if (Array.isArray(current)) payload[upload.ref] = current.map((item) => (item === upload.documentId ? finalId : item)).filter(Boolean);
      else if (current && typeof current === "object") payload[upload.ref] = finalId ? { ...current, documentId: finalId } : null;
    }
  }
  let stored = submission;
  if (changed) {
    stored = { ...submission, payload: { ...payload } };
    await fieldPackage.saveFieldRecord("jobFormSubmissions", stored, { kind: "form-submission", label: `${template.displayName} — attachments` });
  }
  if (failed) crm.showToast(`${failed} attachment${failed === 1 ? "" : "s"} could not be uploaded.`);
  filled.session?.objectUrls?.forEach((url) => setTimeout(() => URL.revokeObjectURL(url), 60000));
  return (crm.state.backend.jobFormSubmissions || []).find((row) => row.id === id) || stored;
}

function namedImageFile(file, base) {
  if (!file) return file;
  if (/\.[a-z0-9]+$/i.test(file.name || "")) return file;
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" }[file.type] || "jpg";
  return new File([file], `${base}.${extension}`, { type: file.type || "image/jpeg" });
}

async function saveDeferred(template, reason, context = {}) {
  const employee = currentFieldEmployee();
  const submission = {
    id: crm.makeId("form-sub"),
    jobId: context.jobId || "",
    actionId: context.actionId || "",
    formTemplateId: template.id,
    formVersion: Number(template.version) || 1,
    formName: template.displayName,
    repeatIndex: Number(context.repeatIndex) || 0,
    timesheetAction: context.timesheetAction || "",
    timeEntryId: context.timeEntryId || "",
    deferred: true,
    deferReason: reason,
    standalone: !context.actionId,
    status: "Deferred",
    submittedBy: employee?.displayName || "Front Line",
    submittedByEmployeeId: employee?.id || "",
    submittedAt: new Date().toISOString(),
    summary: `Not filled in: ${reason}`,
    payload: {},
  };
  await fieldPackage.saveFieldRecord("jobFormSubmissions", submission, { kind: "form-submission", label: `${template.displayName} (deferred)` });
  return (crm.state.backend.jobFormSubmissions || []).find((row) => row.id === submission.id) || submission;
}

// ---------------------------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------------------------

// Wave F part 3 (the Work tab) opens a job action's attached form through this. Resolves the saved
// submission, or null when the worker closes the form. Completing the action is the caller's job.
export async function openFormForAction({ jobId = "", actionId = "", formTemplateId = "", repeatIndex = 0 } = {}) {
  const template = findFormTemplate(formTemplateId);
  if (!template) {
    crm.showToast("That form is not on this phone yet — sync and try again.");
    return null;
  }
  const result = await openFormSheet(template, { intro: Number(repeatIndex) > 0 ? `Entry ${Number(repeatIndex) + 1}` : "" });
  if (!result || result.action !== "submit") return null;
  try {
    const saved = await saveSubmission(template, result, { jobId, actionId, repeatIndex });
    crm.showToast(`${template.displayName} submitted.`);
    return saved;
  } catch (error) {
    crm.showToast(error?.message || "Could not submit that form.");
    return null;
  }
}

// Run a clock action behind its timesheet form (if one applies to this worker).
//   action:   "shift_start" | "shift_end" | "break_start" | "break_end"
//   perform:  async () => the clock command(s); the form's answers are saved after it runs
//   timeEntryId: the entry the action opens or closes (a string, or a function called after perform)
//   jobId:    the job the entry belongs to, if any (so the office sees the form on the job page)
// Resolves true when the clock action ran, false when the worker closed the form (nothing clocked).
export async function withTimesheetForm(action, { perform, timeEntryId = "", jobId = "" } = {}) {
  const template = timesheetFormFor(action);
  if (!template) {
    await perform();
    return true;
  }
  const label = TIMESHEET_ACTIONS[action] || "this";
  const result = await openFormSheet(template, {
    allowDefer: true,
    intro: `Fill this in to ${{ shift_start: "clock in", shift_end: "clock out", break_start: "start your break", break_end: "end your break" }[action] || "continue"}.`,
    submitLabel: { shift_start: "Submit and clock in", shift_end: "Submit and clock out", break_start: "Submit and start break", break_end: "Submit and end break" }[action] || "Submit",
  });
  if (!result) {
    crm.showToast(`${label} cancelled — the form was closed.`);
    return false;
  }
  let clockError = null;
  try {
    await perform();
  } catch (error) {
    clockError = error;
  }
  const entryId = clockError ? "" : typeof timeEntryId === "function" ? timeEntryId() || "" : timeEntryId || "";
  const context = { timesheetAction: action, timeEntryId: entryId, jobId: jobId || "" };
  try {
    if (result.action === "defer") await saveDeferred(template, result.reason, context);
    else await saveSubmission(template, result, context);
  } catch (error) {
    crm.showToast(error?.message || "The form could not be saved.");
  }
  if (clockError) throw clockError;
  return true;
}

async function openAdHocForm(templateId) {
  const template = findFormTemplate(templateId);
  if (!template) return;
  const employee = currentFieldEmployee();
  const jobs = employee ? crm.frontlineMyDispatchJobs(employee.id).filter((job) => !["closed", "cancelled"].includes(job.status)) : [];
  const result = await openFormSheet(template, { jobs, requireJob: Boolean(template.requiresJob), jobId: crm.state.frontlineSelectedJobId && jobs.some((job) => job.id === crm.state.frontlineSelectedJobId) ? crm.state.frontlineSelectedJobId : "" });
  if (!result || result.action !== "submit") return;
  try {
    await saveSubmission(template, result, { jobId: result.jobId });
    crm.showToast(`${template.displayName} submitted.`);
  } catch (error) {
    crm.showToast(error?.message || "Could not submit that form.");
  }
  crm.render();
}

// ---------------------------------------------------------------------------------------------
// The Forms menu (More › Forms)
// ---------------------------------------------------------------------------------------------

function mySubmissionsToday(employeeId) {
  const today = localToday();
  return (crm.state.backend.jobFormSubmissions || [])
    .filter((submission) => submission && !submission.deletedAt && submission.submittedByEmployeeId === employeeId && (submission.standalone || submission.timesheetAction || submission.formTemplateId))
    .filter((submission) => crm.localIsoDate(new Date(submission.submittedAt)) === today)
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

function renderMySubmission(submission) {
  const answers = renderFormSubmissionAnswers(submission);
  const job = submission.jobId ? crm.findDispatchJob(submission.jobId) : null;
  return `
    <details class="field-card field-form-submission ${submission.deferred ? "is-deferred" : ""}">
      <summary>
        <div class="field-card-row"><strong>${esc(submission.formName || "Form")}</strong><small>${esc(crm.formatShortTime(submission.submittedAt))}</small></div>
        <small class="field-card-sub">${submission.deferred ? `Skipped — ${esc(submission.deferReason || "")}` : esc(submission.timesheetAction ? `${TIMESHEET_ACTIONS[submission.timesheetAction] || ""} form` : job ? crm.frontlineJobOptionLabel(job) : "Ad hoc")}</small>
      </summary>
      ${answers || (submission.summary ? `<p class="help-text">${esc(submission.summary)}</p>` : "")}
    </details>
  `;
}

function renderForms() {
  const employee = currentFieldEmployee();
  const templates = menuTemplates();
  const recent = employee ? mySubmissionsToday(employee.id) : [];
  return `
    <p class="help-text">Forms you can fill in any time, with or without a job — daily safety checklists, incident reports, vehicle inspections.</p>
    <div class="field-card-list">
      ${
        templates
          .map((template) => {
            const count = template.fields.filter((field) => field.type !== "label").length;
            return `
        <button class="field-card field-card--tap" type="button" data-field-action="field-form-open" data-id="${attr(template.id)}">
          <div class="field-card-row"><strong>${esc(template.displayName)}</strong>${template.timesheetAction ? `<small class="field-form-tag">${esc(TIMESHEET_ACTIONS[template.timesheetAction])}</small>` : ""}</div>
          <small class="field-card-sub">${esc(template.description || template.category || "General")} · ${count} question${count === 1 ? "" : "s"}</small>
        </button>`;
          })
          .join("") || `<section class="field-card field-card--empty"><p>No forms are available to you yet.</p></section>`
      }
    </div>

    <h2 class="field-section-title">My submissions today</h2>
    <div class="field-card-list">
      ${recent.map(renderMySubmission).join("") || `<section class="field-card field-card--empty"><p>Nothing submitted today.</p></section>`}
    </div>
  `;
}

registerFieldRoute("field-forms", { title: "Forms", render: renderForms });

registerFieldAction("field-form-open", async (button) => {
  await openAdHocForm(button.dataset.id);
});

// ---------------------------------------------------------------------------------------------
// The legacy Time tile (More › Time, drawn by app.js's renderFrontlineTimesheet inside the field
// shell) clocks through its own forms; run the same timesheet forms in front of them.
// ---------------------------------------------------------------------------------------------

let legacyTimeHooked = false;
function hookLegacyTimeTile() {
  if (legacyTimeHooked || typeof document === "undefined") return;
  legacyTimeHooked = true;
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.closest(".field-app")) return;
      const kind = form.dataset.form;
      if (kind !== "frontline-clock-in" && kind !== "frontline-clock-out") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const employeeId = crm.state.frontlineSession?.employeeId || "";
      if (kind === "frontline-clock-in") {
        const entryType = (form.elements.entryType?.value || "work").toString().toLowerCase();
        const jobId = (form.elements.dispatchJobId?.value || "").toString();
        withTimesheetForm(entryType === "break" ? "break_start" : "shift_start", {
          jobId,
          perform: () => crm.frontlineClockIn(form),
          timeEntryId: () => crm.getTimeEntries().find((entry) => entry.employeeId === employeeId && !entry.endedAt)?.id || "",
        }).catch((error) => crm.showToast(error?.message || String(error)));
      } else {
        const entryId = (form.elements.entryId?.value || "").toString();
        const entry = crm.getTimeEntries().find((item) => item.id === entryId);
        withTimesheetForm(String(entry?.entryType || "").toLowerCase() === "break" ? "break_end" : "shift_end", {
          jobId: entry?.dispatchJobId || "",
          perform: () => crm.frontlineClockOut(form),
          timeEntryId: entryId,
        }).catch((error) => crm.showToast(error?.message || String(error)));
      }
    },
    true,
  );
}
hookLegacyTimeTile();
