// Front Line 2 — the field app shell (Phase 21, foundation, 2026-09-25).
//
// Every `field-*` view is rendered here. app.js delegates to `mountField(view)` from render() and
// exports the helpers this module (and its siblings: package.js, job.js, walk.js, map.js, media.js,
// library.js, forms.js, safety.js, capture.js, layers.js) import. The import is circular on purpose:
// NEVER read a `crm.*` binding at module top level — only inside functions, after app.js has run.
//
// Two surfaces, one set of screens: on a phone (viewport <= 720 px, or `?surface=phone`) the screen
// fills the window; on the desktop the same screen is wrapped in the simulator frame
// (`.frontline-shell > .frontline-device`, styles in styles.css) so office users can preview it.
//
// Field screens use their own delegated events so nothing new lands in app.js's action chain:
//   <button data-field-action="name">  → registerFieldAction("name", (button, event) => …)
//   <form data-field-form="name">      → registerFieldForm("name", (form, event) => …)
// Navigation between field views uses app.js's own `data-view` buttons (it sets state.view and
// re-renders), and opening a job uses the existing `data-action="frontline-open-job"`.
import * as crm from "../app.js";

// The route table. scripts/smoke-browser.py parses the keys out of this file, so keep one route per
// line in the form `"field-xxx": {`.
export const FIELD_ROUTES = {
  "field-home": { title: "My Day", render: renderMyDay },
  "field-more": { title: "More", render: renderMore },
  "field-outbox": { title: "Sync", render: renderOutbox },
};

// Screens registered by sibling modules (W2–W4 add theirs at import time via registerFieldRoute).
export function registerFieldRoute(view, route) {
  FIELD_ROUTES[view] = route;
}

const fieldActions = new Map();
const fieldForms = new Map();

export function registerFieldAction(name, handler) {
  fieldActions.set(name, handler);
}

export function registerFieldForm(name, handler) {
  fieldForms.set(name, handler);
}

let eventsWired = false;
function wireFieldEvents() {
  if (eventsWired) return;
  eventsWired = true;
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-field-action]");
    if (!button || button.disabled) return;
    const handler = fieldActions.get(button.dataset.fieldAction);
    if (!handler) return;
    event.preventDefault();
    try {
      await handler(button, event);
    } catch (error) {
      crm.showToast(error?.message || String(error));
    }
  });
  document.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-field-form]");
    if (!form) return;
    const handler = fieldForms.get(form.dataset.fieldForm);
    if (!handler) return;
    event.preventDefault();
    try {
      await handler(form, event);
    } catch (error) {
      crm.showToast(error?.message || String(error));
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------------------------

export function isPhoneSurface() {
  const surface = new URLSearchParams(location.search).get("surface");
  if (surface === "phone") return true;
  if (surface === "desktop") return false;
  return Boolean(window.matchMedia && window.matchMedia("(max-width: 720px)").matches);
}

export function currentFieldEmployee() {
  const employeeId = crm.state.frontlineSession?.employeeId;
  return employeeId ? crm.findEmployee(employeeId) : null;
}

export function mountField(view) {
  wireFieldEvents();
  const route = FIELD_ROUTES[view] || FIELD_ROUTES["field-home"];
  const root = document.querySelector("#app");
  const phone = isPhoneSurface();
  const screen = `
    <div class="field-app${phone ? " field-app--phone" : ""}" data-field-view="${crm.escapeAttribute(view)}">
      ${renderFieldHeader(route, view)}
      <div class="field-body">${route.render(view)}</div>
    </div>
  `;
  root.innerHTML = phone ? screen : `<div class="frontline-shell"><div class="frontline-device field-device">${screen}</div></div>`;
  if (typeof route.after === "function") route.after(view);
}

function renderFieldHeader(route, view) {
  const employee = currentFieldEmployee();
  const isHome = view === "field-home";
  return `
    <header class="field-header">
      ${
        isHome
          ? `<img class="field-header-logo" src="./public/brand/bioremedy-logo-primary-reversed.png" alt="BioRemedy" />`
          : `<button class="field-header-button" type="button" data-view="field-home" aria-label="My Day">‹ My Day</button>`
      }
      <div class="field-header-title">
        <strong>${crm.escapeHtml(route.title)}</strong>
        ${employee ? `<small>${crm.escapeHtml(employee.displayName || "")}</small>` : ""}
      </div>
      ${renderSyncPill()}
    </header>
  `;
}

// The sync pill. W2 (package + outbox) replaces the body of this with the real queued count; the
// element and its class names are the contract.
export function renderSyncPill() {
  const online = crm.state.online !== false;
  const label = online ? "Online" : "Offline";
  return `<button class="field-sync-pill ${online ? "is-online" : "is-offline"}" type="button" data-view="field-outbox" aria-label="Sync status: ${label}"><span class="field-sync-dot"></span>${label}</button>`;
}

// ---------------------------------------------------------------------------------------------
// My Day
// ---------------------------------------------------------------------------------------------

function todayKey() {
  return crm.todayIso();
}

function jobDayKey(job) {
  const raw = job.scheduledStart || job.operationalDate || job.scheduledDate || "";
  return String(raw).slice(0, 10);
}

function openTimeEntry(employeeId) {
  return crm.getTimeEntries().find((entry) => entry.employeeId === employeeId && !entry.endedAt && !entry.deletedAt) || null;
}

function myWalksToday(employeeId) {
  const today = todayKey();
  return crm
    .siteWalkEvents()
    .filter((event) => (event.participantEmployeeIds || []).includes(employeeId) && String(event.date || "").slice(0, 10) === today)
    .sort((a, b) => String(a.startTime || "").localeCompare(String(b.startTime || "")));
}

function renderMyDay() {
  const employee = currentFieldEmployee();
  if (!employee) {
    return `<section class="field-card"><p>No field employee on this session. Sign in through the Front Line picker or a sign-on link.</p></section>`;
  }
  const today = todayKey();
  const myJobs = crm
    .frontlineMyDispatchJobs(employee.id)
    .filter((job) => !["closed", "cancelled"].includes(job.status))
    .sort((a, b) => String(a.scheduledStart || "").localeCompare(String(b.scheduledStart || "")));
  const todaysJobs = myJobs.filter((job) => jobDayKey(job) === today || ["dispatched", "acknowledged", "en_route", "on_site", "in_progress"].includes(job.status));
  const laterJobs = myJobs.filter((job) => !todaysJobs.includes(job));
  const walks = myWalksToday(employee.id);
  const open = openTimeEntry(employee.id);
  const unread = crm.frontlineUnreadTotal(employee.id);
  const clockLine = open
    ? `Clocked in since ${crm.escapeHtml(crm.formatShortTime(open.startedAt))}${open.entryType ? ` · ${crm.escapeHtml(open.entryType)}` : ""}`
    : "Not clocked in";
  return `
    <section class="field-clock ${open ? "is-open" : ""}">
      <div>
        <strong>${clockLine}</strong>
        <small>${crm.escapeHtml(crm.formatDate(today))}</small>
      </div>
      <button class="field-button field-button--secondary" type="button" data-view="frontline-timesheet">Time</button>
    </section>

    <h2 class="field-section-title">Today</h2>
    ${
      todaysJobs.length || walks.length
        ? `<div class="field-card-list">
            ${walks.map(renderWalkCard).join("")}
            ${todaysJobs.map(renderJobCard).join("")}
          </div>`
        : `<section class="field-card field-card--empty"><p>Nothing scheduled for you today.</p></section>`
    }

    ${
      laterJobs.length
        ? `<h2 class="field-section-title">Coming up</h2><div class="field-card-list">${laterJobs.slice(0, 6).map(renderJobCard).join("")}</div>`
        : ""
    }

    <h2 class="field-section-title">More</h2>
    <div class="field-more-grid">
      ${renderMoreTile("frontline-messaging", "Messages", unread)}
      ${renderMoreTile("frontline-timesheet", "Time")}
      ${renderMoreTile("frontline-trips", "Trips")}
      ${renderMoreTile("frontline-receipts", "Receipts")}
      ${renderMoreTile("frontline-forms", "Forms")}
      ${renderMoreTile("frontline-jobbook", "All jobs")}
      ${renderMoreTile("field-library", "Manuals & Training")}
      ${renderMoreTile("field-outbox", "Sync")}
      ${renderMoreTile("frontline-settings", "Settings")}
    </div>
    <div class="field-exit-row">
      <button class="field-button field-button--ghost" type="button" data-action="frontline-exit">Exit Front Line</button>
    </div>
  `;
}

function renderMoreTile(view, label, badge = 0) {
  return `
    <button class="field-more-tile" type="button" data-view="${crm.escapeAttribute(view)}">
      <span>${crm.escapeHtml(label)}</span>
      ${badge ? `<b class="field-badge">${badge}</b>` : ""}
    </button>
  `;
}

function renderJobCard(job) {
  const project = job.projectId ? crm.findProject(job.projectId) : null;
  const account = project?.accountId ? crm.findAccount(project.accountId) : null;
  const when = job.scheduledStart ? crm.formatShortTime(job.scheduledStart) : "";
  return `
    <button class="field-card field-card--tap" type="button" data-action="frontline-open-job" data-id="${crm.escapeAttribute(job.id)}">
      <div class="field-card-row">
        <strong>${crm.escapeHtml(job.jobNumber || job.jobName || "Job")}</strong>
        ${crm.renderDispatchStatusBadge(job.status)}
      </div>
      <div class="field-card-row">
        <span>${crm.escapeHtml(account?.name || project?.name || job.jobName || "")}</span>
        ${when ? `<small>${crm.escapeHtml(when)}</small>` : ""}
      </div>
      ${job.addressText ? `<small class="field-card-sub">${crm.escapeHtml(job.addressText)}</small>` : ""}
    </button>
  `;
}

function renderWalkCard(event) {
  const opportunity = event.opportunityId ? crm.findOpportunity(event.opportunityId) : null;
  const facility = event.facilityId ? crm.findFacility(event.facilityId) : null;
  return `
    <div class="field-card field-card--walk">
      <div class="field-card-row">
        <strong>Site walk</strong>
        <small>${crm.escapeHtml(event.startTime || "")}</small>
      </div>
      <span>${crm.escapeHtml(opportunity?.name || event.title || "Site walk")}</span>
      ${facility ? `<small class="field-card-sub">${crm.escapeHtml(facility.name || "")}</small>` : ""}
    </div>
  `;
}

// ---------------------------------------------------------------------------------------------
// More / Sync placeholders (W2 fills the outbox screen)
// ---------------------------------------------------------------------------------------------

function renderMore() {
  return `<div class="field-more-grid">
    ${renderMoreTile("frontline-messaging", "Messages")}
    ${renderMoreTile("frontline-timesheet", "Time")}
    ${renderMoreTile("frontline-trips", "Trips")}
    ${renderMoreTile("frontline-receipts", "Receipts")}
    ${renderMoreTile("frontline-forms", "Forms")}
    ${renderMoreTile("frontline-location", "Location")}
    ${renderMoreTile("field-library", "Manuals & Training")}
    ${renderMoreTile("field-outbox", "Sync")}
    ${renderMoreTile("frontline-settings", "Settings")}
  </div>`;
}

function renderOutbox() {
  const online = crm.state.online !== false;
  return `
    <section class="field-card">
      <div class="field-card-row"><strong>Connection</strong><span>${online ? "Online" : "Offline"}</span></div>
      <div class="field-card-row"><strong>Queued</strong><span>0</span></div>
      <p class="field-muted">Offline capture and the outbox arrive with the package and outbox build. Until then every save goes straight to the server.</p>
    </section>
  `;
}
