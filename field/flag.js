// Front Line 2 -- flag a job (Pass 2 D, 2026-10-01).
//
// The quick bar's Flag button opens a bottom sheet: what is wrong (the office's field alert types plus
// "Needs office attention"), severity, a note and an optional photo. It posts to
// POST /api/field/jobs/:id/flag through the outbox, which writes a projectAlerts row carrying the
// dispatch job (the office sees it on the project's Live tab, Office -> Alerts and the red dot on the
// job) and notifies the office roles. The Brief lists the job's flags read-only (renderFlagsCard).
import * as crm from "../app.js";
import { registerFieldAction, currentFieldEmployee } from "./index.js";
import * as fieldPackage from "./package.js";

export const FLAG_TYPES = ["Needs office attention", "Safety Hazard", "Scope Exception", "Equipment Down", "Access Issue", "Weather Delay", "Material Shortage", "Customer Approval Needed", "Regulatory Concern"];
const FLAG_SEVERITIES = ["High", "Medium", "Low"];

// A job's flags as the phone sees them (the server only sends flags on the worker's own jobs).
export function jobFlags(jobId) {
  return (crm.state.backend.projectAlerts || [])
    .filter((alert) => !alert.deletedAt && alert.dispatchJobId === jobId)
    .sort((a, b) => String(b.reportedAt || "").localeCompare(String(a.reportedAt || "")));
}

export function renderFlagsCard(job) {
  const flags = job?.id ? jobFlags(job.id) : [];
  if (!flags.length) return "";
  const open = flags.filter((flag) => flag.status !== "Resolved").length;
  return `
    <section class="field-card ${open ? "field-card--alert" : ""}" data-job-flags>
      <div class="field-card-row"><strong>Flags on this job</strong><small>${open} open</small></div>
      ${flags
        .map(
          (flag) => `
        <div class="field-card-row" data-flag-id="${crm.escapeAttribute(flag.id)}">
          <span>${crm.escapeHtml(flag.alertType || "Flag")} <small>(${crm.escapeHtml(flag.severity || "")})</small><br /><small class="field-card-sub">${crm.escapeHtml(flag.description || "")}</small></span>
          <span class="tag">${crm.escapeHtml(flag.status || "Open")}</span>
        </div>`,
        )
        .join("")}
    </section>`;
}

function closeSheet(dialog) {
  try {
    dialog.close();
  } catch {
    /* already closed */
  }
  dialog.remove();
}

registerFieldAction("field-flag-open", () => {
  const job = crm.findDispatchJob(crm.state.frontlineSelectedJobId);
  const employee = currentFieldEmployee();
  if (!job || !employee) return;
  document.querySelector("dialog.field-flag-sheet")?.remove();
  const dialog = document.createElement("dialog");
  dialog.className = "field-photo-sheet field-flag-sheet";
  dialog.innerHTML = `
    <form class="field-flag-form" method="dialog">
      <div class="field-photo-sheet-head"><strong>Flag ${crm.escapeHtml(job.jobNumber || "this job")}</strong><button class="field-photo-sheet-close" type="button" data-flag-cancel aria-label="Close">&times;</button></div>
      <div class="field-photo-sheet-actions">
        <label class="field-label"><span>What is wrong?</span>
          <select name="alertType">${FLAG_TYPES.map((type) => `<option>${crm.escapeHtml(type)}</option>`).join("")}</select></label>
        <label class="field-label"><span>Severity</span>
          <select name="severity">${FLAG_SEVERITIES.map((severity) => `<option ${severity === "Medium" ? "selected" : ""}>${severity}</option>`).join("")}</select></label>
        <label class="field-label"><span>Note</span>
          <textarea name="description" rows="3" required placeholder="What happened, and what do you need from the office?"></textarea></label>
        <label class="field-label"><span>Photo (optional)</span>
          <input type="file" name="photo" accept="image/png,image/jpeg" capture="environment" /></label>
        <p class="help-text" data-flag-error hidden></p>
        <button class="field-button" type="submit" data-flag-send>Send flag to the office</button>
        <button class="field-button field-button--ghost" type="button" data-flag-cancel>Cancel</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelectorAll("[data-flag-cancel]").forEach((button) => button.addEventListener("click", () => closeSheet(dialog)));
  const form = dialog.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const send = form.querySelector("[data-flag-send]");
    const errorLine = form.querySelector("[data-flag-error]");
    const data = new FormData(form);
    const description = String(data.get("description") || "").trim();
    if (!description) {
      errorLine.textContent = "Add a note saying what is wrong.";
      errorLine.hidden = false;
      return;
    }
    send.disabled = true;
    send.textContent = "Sending…";
    errorLine.hidden = true;
    const alertType = String(data.get("alertType") || FLAG_TYPES[0]);
    const severity = String(data.get("severity") || "Medium");
    const file = form.elements.photo?.files?.[0] || null;
    const alertId = crm.makeId("alert");
    const raisedAt = new Date().toISOString();
    try {
      // The photo goes first, under an id the phone chooses, so the flag can name it even when both
      // wait in the outbox (the outbox sends in order).
      let photoDocumentId = "";
      if (file) {
        const documentId = crm.makeId("document");
        // The same file already on the job (a re-send after a failure) is not an error: point at it.
        const uploaded = await fieldPackage
          .uploadFieldFile("/api/documents", file, {
          "X-Entity-Type": "dispatchJob",
          "X-Entity-Id": job.id,
          "X-Document-Type": crm.documentTypeByCode("job-photo")?.id || "",
          "X-Visibility": "internal",
          "X-Document-Id": documentId,
          "X-Caption": encodeURIComponent(`Flag: ${alertType}`),
          })
          .catch((error) => {
            if (error?.payload?.duplicate && error.payload.documentId) return { id: error.payload.documentId };
            throw error;
          });
        photoDocumentId = uploaded?.id || documentId;
      }
      const optimistic = {
        id: alertId,
        projectId: job.projectId || "",
        dispatchJobId: job.id,
        alertType,
        severity,
        description,
        reportedBy: employee.displayName || "",
        reportedByEmployeeId: employee.id,
        reportedAt: raisedAt,
        status: "Open",
        source: "field",
        photoDocumentId,
      };
      await fieldPackage.fieldRequest(`/api/field/jobs/${encodeURIComponent(job.id)}/flag`, {
        method: "POST",
        kind: "flag",
        label: `Flag ${job.jobNumber || "job"}: ${alertType}`,
        body: { id: alertId, alertType, severity, description, photoDocumentId, at: raisedAt },
        mergeInto: "projectAlerts",
        apply: () => fieldPackage.mergeRow("projectAlerts", optimistic),
      });
      closeSheet(dialog);
      if (fieldPackage.isOnline()) await crm.refreshBackendState().catch(() => {});
      crm.showToast(fieldPackage.isOnline() ? "Flag sent to the office." : "Flag saved; it sends when you are back online.");
      crm.render();
    } catch (error) {
      send.disabled = false;
      send.textContent = "Send flag to the office";
      errorLine.textContent = error?.message || "The flag could not be sent.";
      errorLine.hidden = false;
    }
  });
  dialog.showModal();
});
