// Front Line 2 — the field app shell (Phase 21, foundation, 2026-09-25; My Day/outbox wiring, W2).
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
import * as fieldPackage from "./package.js";
// Side-effect imports: these register their own field-* routes at import time.
import "./job.js";
import "./forms.js";

// The route table. scripts/smoke-browser.py parses the keys out of this file, so keep one route per
// line in the form `"field-xxx": {`.
//
// This — and fieldActions/fieldForms below — are declared with `var` and built lazily rather than as
// a plain `const` object literal, on purpose: index.js's own top-level imports (job.js, forms.js)
// import index.js right back (the circular import the module header describes), and those sibling
// modules call registerFieldRoute/registerFieldAction/registerFieldForm at THEIR OWN module top
// level. Because of import evaluation order, that happens before index.js's body reaches a `const`
// initializer, which throws "Cannot access before initialization" (TDZ) — `var` has no TDZ, so the
// lazy accessors below are what let the circular import work at all.
export var FIELD_ROUTES;
function ensureFieldRoutes() {
  if (!FIELD_ROUTES) {
    FIELD_ROUTES = {
      "field-home": { title: "My Day", render: renderMyDay },
      "field-more": { title: "More", render: renderMore },
      "field-outbox": { title: "Sync", render: renderOutbox, after: afterOutbox },
    };
  }
  return FIELD_ROUTES;
}

// Screens registered by sibling modules (W2–W4 add theirs at import time via registerFieldRoute).
export function registerFieldRoute(view, route) {
  ensureFieldRoutes()[view] = route;
}

var fieldActions;
var fieldForms;

export function registerFieldAction(name, handler) {
  (fieldActions || (fieldActions = new Map())).set(name, handler);
}

export function registerFieldForm(name, handler) {
  (fieldForms || (fieldForms = new Map())).set(name, handler);
}

let eventsWired = false;
function wireFieldEvents() {
  if (eventsWired) return;
  eventsWired = true;
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-field-action]");
    if (!button || button.disabled) return;
    const handler = fieldActions?.get(button.dataset.fieldAction);
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
    const handler = fieldForms?.get(form.dataset.fieldForm);
    if (!handler) return;
    event.preventDefault();
    try {
      await handler(form, event);
    } catch (error) {
      crm.showToast(error?.message || String(error));
    }
  });
  document.addEventListener("field:sync", () => {
    // Re-paint just the sync pill(s) rather than a full re-render, so a background drain never
    // interrupts someone mid-form.
    document.querySelectorAll(".field-sync-pill").forEach((el) => el.outerHTML = renderSyncPill());
    if (document.querySelector('[data-field-view="field-outbox"]')) crm.render();
  });
  window.addEventListener("online", () => fieldPackage.refreshFieldPackage());
  fieldPackage.refreshFieldPackage();
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
  const route = ensureFieldRoutes()[view] || ensureFieldRoutes()["field-home"];
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

// The sync pill. Reflects the real outbox: Synced / n queued / Offline / n failed.
export function renderSyncPill() {
  const summary = fieldPackage.outboxSummary();
  let label = "Synced";
  let cls = "is-online";
  if (!summary.online) {
    label = "Offline";
    cls = "is-offline";
  } else if (summary.failed) {
    label = `${summary.failed} failed`;
    cls = "is-failed";
  } else if (summary.queued) {
    label = `${summary.queued} queued`;
    cls = "is-queued";
  }
  return `<button class="field-sync-pill ${cls}" type="button" data-view="field-outbox" aria-label="Sync status: ${label}"><span class="field-sync-dot"></span>${crm.escapeHtml(label)}</button>`;
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

function myStandbyToday(employeeId) {
  const today = todayKey();
  return crm.getStandbyAssignments().filter((assignment) => {
    if (assignment.employeeId !== employeeId) return false;
    const starts = String(assignment.startsAt || "").slice(0, 10);
    const ends = String(assignment.endsAt || "").slice(0, 10);
    return starts <= today && today <= (ends || starts);
  });
}

// Apple Maps on an Apple device, Google Maps everywhere else (a plain https URL works on desktop
// too, where a `geo:` URI would just fail to resolve).
function navigateUrl(address) {
  if (!address) return "";
  const query = encodeURIComponent(address);
  const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent || "");
  return isApple ? `https://maps.apple.com/?q=${query}` : `https://www.google.com/maps/search/?api=1&query=${query}`;
}

function telHref(phone) {
  const digits = String(phone || "").replace(/[^0-9+]/g, "");
  return digits ? `tel:${digits}` : "";
}

// No dedicated "office phone" field exists on pricingSettings today, so this falls back to the
// mobile number of whoever's job title reads as dispatch/scheduling. Documented here and in
// docs/roadmap/phase-21-frontline-2.md's corrections section — a real settings field is a follow-up.
function dispatchPhone() {
  const settings = (crm.state.backend.pricingSettings || []).find((item) => !item.deletedAt);
  if (settings?.officePhone) return settings.officePhone;
  const scheduler = crm.getEmployees().find((employee) => /scheduler|dispatch/i.test(employee.jobTitle || "") && employee.mobilePhone);
  return scheduler?.mobilePhone || "";
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
  const todaysJobs = myJobs.filter((job) => jobDayKey(job) === today || ["dispatched", "acknowledged", "en_route", "on_site", "in_progress", "on_hold"].includes(job.status));
  const laterJobs = myJobs.filter((job) => !todaysJobs.includes(job));
  const standby = myStandbyToday(employee.id);
  const open = openTimeEntry(employee.id);
  const unread = crm.frontlineUnreadTotal(employee.id);
  const emergencyPhone = dispatchPhone();
  const clockLine = open
    ? `Clocked in since ${crm.escapeHtml(crm.formatShortTime(open.startedAt))}${open.entryType ? ` · ${crm.escapeHtml(open.entryType)}` : ""}`
    : "Not clocked in";

  return `
    <section class="field-clock ${open ? "is-open" : ""}">
      <div>
        <strong>${clockLine}</strong>
        <small>${crm.escapeHtml(crm.formatDate(today))}</small>
      </div>
      ${
        open
          ? `<button class="field-button field-button--secondary" type="button" data-field-action="field-clock-out" data-entry-id="${crm.escapeAttribute(open.id)}">Clock out</button>`
          : `<div class="field-clock-actions">
              <button class="field-button field-button--secondary" type="button" data-field-action="field-clock-in" data-entry-type="work">Clock in</button>
              <button class="field-button field-button--ghost" type="button" data-field-action="field-clock-in" data-entry-type="travel">Travel</button>
            </div>`
      }
    </section>

    ${
      emergencyPhone
        ? `<a class="field-emergency-bar" href="${telHref(emergencyPhone)}">Emergency — Call dispatch</a>`
        : `<div class="field-emergency-bar is-disabled">Call dispatch — no dispatch number on file</div>`
    }

    <h2 class="field-section-title">Today</h2>
    ${
      todaysJobs.length || standby.length
        ? `<div class="field-card-list">
            ${standby.map(renderStandbyCard).join("")}
            ${todaysJobs.map(renderJobCard).join("")}
          </div>`
        : `<section class="field-card field-card--empty"><p>Nothing scheduled for you today.</p></section>`
    }

    ${
      laterJobs.length
        ? `<h2 class="field-section-title">Coming up</h2><div class="field-card-list">${laterJobs.slice(0, 6).map(renderJobCard).join("")}</div>`
        : ""
    }

    ${renderSalesHomeSections(employee)}

    <h2 class="field-section-title">More</h2>
    <div class="field-more-grid">
      ${renderMoreTile("field-messages", "Messages", unread)}
      ${renderMoreTile("field-time", "Time")}
      ${renderMoreTile("field-trips", "Trips")}
      ${renderMoreTile("field-receipts", "Receipts")}
      ${renderMoreTile("field-forms", "Forms")}
      ${renderMoreTile("field-jobs", "All jobs")}
      ${renderMoreTile("field-library", "Manuals & Training")}
      ${renderMoreTile("field-outbox", "Sync")}
      ${renderMoreTile("field-settings", "Settings")}
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

function jobSiteContact(job) {
  if (!job.onsiteContactName && !job.onsiteContactPhone) return "";
  return `${job.onsiteContactName || "Site contact"}${job.onsiteContactPhone ? ` · ${crm.formatPhoneNumber(job.onsiteContactPhone)}` : ""}`;
}

function renderJobCard(job) {
  const project = job.projectId ? crm.findProject(job.projectId) : null;
  const account = project?.accountId ? crm.findAccount(project.accountId) : null;
  const when = job.scheduledStart ? crm.formatShortTime(job.scheduledStart) : "";
  const address = job.addressText || job.locationName || "";
  return `
    <div class="field-card field-card--job">
      <button class="field-card-tap" type="button" data-field-action="field-open-job" data-id="${crm.escapeAttribute(job.id)}">
        <div class="field-card-row">
          <strong>${crm.escapeHtml(job.jobNumber || job.jobName || "Job")}</strong>
          ${crm.renderDispatchStatusBadge(job.status)}
        </div>
        <div class="field-card-row">
          <span>${crm.escapeHtml(account?.name || project?.name || job.jobName || "")}</span>
          ${when ? `<small>${crm.escapeHtml(when)}</small>` : ""}
        </div>
        ${address ? `<small class="field-card-sub">${crm.escapeHtml(address)}</small>` : ""}
        ${jobSiteContact(job) ? `<small class="field-card-sub">${crm.escapeHtml(jobSiteContact(job))}</small>` : ""}
      </button>
      <div class="field-card-actions">
        ${address ? `<a class="field-icon-button" href="${navigateUrl(address)}" target="_blank" rel="noopener">Navigate</a>` : ""}
        ${job.onsiteContactPhone ? `<a class="field-icon-button" href="${telHref(job.onsiteContactPhone)}">Call</a>` : ""}
      </div>
    </div>
  `;
}

function renderWalkCard(event) {
  const opportunity = event.opportunityId ? crm.findOpportunity(event.opportunityId) : null;
  const facility = event.facilityId ? crm.findFacility(event.facilityId) : null;
  const hasWalkScreen = Boolean(ensureFieldRoutes()["field-walk"]);
  const body = `
    <div class="field-card-row">
      <strong>Site walk</strong>
      <small>${crm.escapeHtml(event.startTime || "")}</small>
    </div>
    <span>${crm.escapeHtml(opportunity?.name || event.title || "Site walk")}</span>
    ${facility ? `<small class="field-card-sub">${crm.escapeHtml(facility.name || "")}</small>` : ""}
  `;
  if (!hasWalkScreen) return `<div class="field-card field-card--walk">${body}</div>`;
  return `
    <button class="field-card field-card--walk field-card--tap" type="button" data-field-action="field-open-walk" data-id="${crm.escapeAttribute(event.id)}">
      ${body}
    </button>
  `;
}

function renderStandbyCard(assignment) {
  return `
    <div class="field-card field-card--standby">
      <div class="field-card-row"><strong>Standby</strong></div>
      <span>${crm.escapeHtml(crm.formatShortTime(assignment.startsAt))} – ${crm.escapeHtml(crm.formatShortTime(assignment.endsAt))}</span>
      ${assignment.notes ? `<small class="field-card-sub">${crm.escapeHtml(assignment.notes)}</small>` : ""}
    </div>
  `;
}

registerFieldAction("field-open-job", (button) => {
  crm.state.frontlineSelectedJobId = button.dataset.id;
  crm.state.fieldJobTab = "brief";
  crm.state.view = "field-job";
  crm.render();
});

registerFieldAction("field-open-walk", (button) => {
  crm.state.fieldWalkEventId = button.dataset.id;
  crm.state.view = "field-walk";
  crm.render();
});

registerFieldAction("field-clock-in", async (button) => {
  const employee = currentFieldEmployee();
  if (!employee) return;
  const entryType = button.dataset.entryType || "work";
  const now = new Date().toISOString();
  const record = {
    id: crm.makeId("time-entry"),
    employeeId: employee.id,
    dispatchJobId: crm.state.frontlineSelectedJobId || null,
    entryType,
    startedAt: now,
    endedAt: null,
    durationMinutes: null,
    notes: "",
    source: "field-app",
  };
  await fieldPackage.fieldRequest("/api/field/clock", {
    method: "POST",
    kind: "clock",
    label: `Clock in (${entryType})`,
    body: { employeeId: employee.id, dispatchJobId: record.dispatchJobId, entryType, action: "in" },
    apply: () => {
      crm.state.backend.timeEntries = [...(crm.state.backend.timeEntries || []), record];
    },
  }).catch(async (error) => {
    if (/does not have clock yet/.test(error.message || "")) {
      await fieldPackage.saveFieldRecord("timeEntries", record, { kind: "clock", label: `Clock in (${entryType})` });
    } else {
      throw error;
    }
  });
  // The command created the row server-side; pull it before drawing the clock strip.
  await crm.refreshBackendState().catch(() => {});
  crm.showToast("Clocked in.");
  crm.render();
});

registerFieldAction("field-clock-out", async (button) => {
  const entryId = button.dataset.entryId;
  const entry = crm.getTimeEntries().find((item) => item.id === entryId);
  if (!entry) return;
  const endedAt = new Date().toISOString();
  const durationMinutes = Math.max(0, Math.round((new Date(endedAt) - new Date(entry.startedAt)) / 60000));
  const updated = { ...entry, endedAt, durationMinutes };
  await fieldPackage
    .fieldRequest("/api/field/clock", {
      method: "POST",
      kind: "clock",
      label: "Clock out",
      body: { employeeId: entry.employeeId, dispatchJobId: entry.dispatchJobId, entryType: entry.entryType, action: "out", at: endedAt },
      apply: () => {
        crm.state.backend.timeEntries = (crm.state.backend.timeEntries || []).map((item) => (item.id === entryId ? updated : item));
      },
    })
    .catch(async (error) => {
      if (/does not have clock yet/.test(error.message || "")) {
        await fieldPackage.saveFieldRecord("timeEntries", updated, { kind: "clock", label: "Clock out" });
      } else {
        throw error;
      }
    });
  await crm.refreshBackendState().catch(() => {});
  crm.showToast(`Clocked out — ${crm.formatDuration(durationMinutes)} logged.`);
  crm.render();
});

// ---------------------------------------------------------------------------------------------
// More / Sync
// ---------------------------------------------------------------------------------------------

function renderMore() {
  const unread = crm.frontlineUnreadTotal(currentFieldEmployee()?.id);
  return `<div class="field-more-grid">
    ${renderMoreTile("field-messages", "Messages", unread)}
    ${renderMoreTile("field-time", "Time")}
    ${renderMoreTile("field-trips", "Trips")}
    ${renderMoreTile("field-receipts", "Receipts")}
    ${renderMoreTile("field-forms", "Forms")}
    ${renderMoreTile("field-library", "Manuals & Training")}
    ${renderMoreTile("field-outbox", "Sync")}
    ${renderMoreTile("field-settings", "Settings")}
  </div>`;
}

function statusLabel(status) {
  return { queued: "Queued", sending: "Sending…", done: "Sent", failed: "Failed", rejected: "Rejected" }[status] || status;
}

function renderOutbox() {
  const summary = fieldPackage.outboxSummary();
  const items = summary.items.filter((item) => item.status !== "done");
  return `
    <section class="field-card">
      <div class="field-card-row"><strong>Connection</strong><span>${summary.online ? "Online" : "Offline"}</span></div>
      <div class="field-card-row"><strong>Queued</strong><span>${summary.queued}</span></div>
      <div class="field-card-row"><strong>Failed / rejected</strong><span>${summary.failed}</span></div>
      <button class="field-button field-button--secondary" type="button" data-field-action="field-sync-now">Sync now</button>
    </section>
    <h2 class="field-section-title">Pending</h2>
    <div class="field-card-list">
      ${
        items
          .map(
            (item) => `
          <article class="field-card field-outbox-item field-outbox-item--${crm.escapeAttribute(item.status)}">
            <div class="field-card-row"><strong>${crm.escapeHtml(item.label)}</strong><span>${statusLabel(item.status)}</span></div>
            <small class="field-card-sub">${crm.escapeHtml(new Date(item.createdAt).toLocaleString())}</small>
            ${item.lastError ? `<small class="field-card-sub field-gap">${crm.escapeHtml(item.lastError)}</small>` : ""}
            ${item.hasBlob ? `<div class="field-outbox-thumb" data-outbox-thumb="${crm.escapeAttribute(item.clientCommandId)}"></div>` : ""}
            <div class="field-card-actions">
              ${item.status === "failed" || item.status === "rejected" ? `<button class="field-button field-button--secondary" type="button" data-field-action="field-outbox-retry" data-id="${crm.escapeAttribute(item.clientCommandId)}">Retry</button>` : ""}
              <button class="field-button field-button--ghost" type="button" data-field-action="field-outbox-discard" data-id="${crm.escapeAttribute(item.clientCommandId)}">Discard</button>
            </div>
          </article>
        `,
          )
          .join("") || `<section class="field-card field-card--empty"><p>Nothing queued. Everything is synced.</p></section>`
      }
    </div>
  `;
}

async function afterOutbox() {
  const summary = fieldPackage.outboxSummary();
  for (const item of summary.items) {
    if (!item.hasBlob) continue;
    const el = document.querySelector(`[data-outbox-thumb="${CSS.escape(item.clientCommandId)}"]`);
    if (!el) continue;
    const row = await fieldPackage.outboxItem(item.clientCommandId);
    if (row?.blob) {
      const img = document.createElement("img");
      img.src = fieldPackage.outboxBlobUrl(row);
      img.alt = item.label;
      el.appendChild(img);
    }
  }
}

registerFieldAction("field-sync-now", async () => {
  await fieldPackage.drainOutbox();
  crm.render();
});

registerFieldAction("field-outbox-retry", async (button) => {
  await fieldPackage.retryOutboxItem(button.dataset.id);
  crm.render();
});

registerFieldAction("field-outbox-discard", async (button) => {
  await fieldPackage.discardOutboxItem(button.dataset.id);
  crm.render();
});

// ---------------------------------------------------------------------------------------------
// Sales home sections (W3). walk.js registers the site-walk cards and the "New" row; the My Day
// renderer calls renderSalesHomeSections(employee) where the sales part of the home belongs.
// ---------------------------------------------------------------------------------------------

const salesHomeSections = [];

export function registerSalesHomeSection(renderSection) {
  if (typeof renderSection === "function") salesHomeSections.push(renderSection);
}

export function renderSalesHomeSections(employee) {
  if (!employee) return "";
  return salesHomeSections
    .map((renderSection) => {
      try {
        return renderSection(employee) || "";
      } catch (error) {
        return `<section class="field-card"><p class="field-muted">${crm.escapeHtml(error?.message || "A home section failed to render.")}</p></section>`;
      }
    })
    .join("");
}

// ---------------------------------------------------------------------------------------------
// Utility screens still drawn by the legacy renderers (Job Book, Time, Trips, Receipts, Messages,
// Location, Settings). Each legacy renderer writes the whole simulator frame into #app; we let it,
// lift its `.frontline-body` out, and mountField() then redraws #app as the field shell around that
// body. Delegated data-action / data-form handlers in app.js keep working because the markup is the
// same; post-render hooks that look elements up by id (the location map) find them in the copy.
// Rebuilding these as native field-* screens is the follow-up recorded in the phase doc.
// ---------------------------------------------------------------------------------------------

function legacyScreen(title, renderLegacy) {
  return {
    title,
    render() {
      renderLegacy();
      const body = document.querySelector("#app .frontline-body");
      return body ? `<div class="field-legacy">${body.innerHTML}</div>` : `<section class="field-card field-card--empty"><p>Nothing to show.</p></section>`;
    },
  };
}

registerFieldRoute("field-jobs", legacyScreen("All jobs", () => crm.renderFrontlineJobBook()));
registerFieldRoute("field-time", legacyScreen("Time", () => crm.renderFrontlineTimesheet()));
registerFieldRoute("field-trips", legacyScreen("Trips", () => crm.renderFrontlineTrips()));
registerFieldRoute("field-receipts", legacyScreen("Receipts", () => crm.renderFrontlineReceipts()));
registerFieldRoute("field-messages", legacyScreen("Messages", () => crm.renderFrontlineMessaging()));
registerFieldRoute("field-location", legacyScreen("Location", () => crm.renderFrontlineLocation()));
registerFieldRoute("field-settings", legacyScreen("Settings", () => crm.renderFrontlineSettings()));
