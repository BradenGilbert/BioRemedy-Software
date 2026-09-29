// Front Line 2 — the sales field mode (Phase 21 W3, 2026-09-25).
//
// Screens: `field-walk` (Brief / Walk / Map / Finish for one scheduled site walk),
// `field-spill-intake` (the Phase 16 spill-call dialog as a stepped phone form, same
// submitEmergencyIntake, same guards) and `field-quick-lead` (account + contact + opportunity in
// one screen). The sales section of My Day (today's and upcoming walks, the "New" row) is
// registered through registerSalesHomeSection() in index.js.
//
// Data: one `siteWalkReports` row per walk event (upserted as sections change), one
// `siteWalkObservations` row per pin/shape (written by the map's onChange), photos and plans as
// `documents` on the opportunity/facility, needs written straight onto the opportunity's
// equipmentNeeds / vendorNeeds / resourceNeeds as { name, note }. Every write goes through
// saveFieldRecord / fieldRequest / uploadFieldFile so W2's outbox can queue it.
import * as crm from "../app.js";
import { registerFieldRoute, registerFieldAction, registerFieldForm, registerSalesHomeSection, currentFieldEmployee } from "./index.js";
import { fieldRequest, saveFieldRecord } from "./package.js";
import { createSiteMap, walkReportForEvent, observationsForWalk, photoUrl, uploadSiteDocument, backgroundsForReport, facilityCenter, renderObservationLine } from "./map.js";
import { snapshotReferenceLayers, bboxAround } from "./layers.js";
import { PIN_KINDS, SHAPE_KINDS, SHAPE_COLORS } from "./map-core.js";

const esc = (value) => crm.escapeHtml(value ?? "");
const attr = (value) => crm.escapeAttribute(value ?? "");

// ---------------------------------------------------------------------------------------------
// The guided checklist
// ---------------------------------------------------------------------------------------------

export const WALK_SECTIONS = [
  {
    key: "access",
    title: "Access & staging",
    shots: ["Entrance / access", "Staging area"],
    fields: [
      { key: "accessNotes", label: "Access: gates, hours, check-in with", type: "textarea" },
      { key: "stagingNotes", label: "Where crews stage and park", type: "textarea" },
      { key: "truckAccess", label: "Vacuum truck / roll-off can reach the area", type: "yesno" },
    ],
  },
  {
    key: "hazards",
    title: "Hazards & PPE",
    shots: ["Hazards"],
    fields: [
      { key: "hazards", label: "Hazards seen (traffic, overhead lines, confined space, chemicals)", type: "textarea" },
      { key: "ppeLevel", label: "PPE level expected", type: "select", options: ["D", "C", "B", "A"] },
      { key: "sdsAvailable", label: "Customer has an SDS for the material", type: "yesno" },
    ],
  },
  {
    key: "area",
    title: "Area of concern",
    shots: ["Wide", "Close", "Before"],
    fields: [
      { key: "surface", label: "Surface", type: "select", options: ["Pavement / asphalt", "Concrete", "Soil", "Gravel", "Water", "Mixed"] },
      { key: "estimatedAreaSqFt", label: "Estimated area (sq ft)", type: "number" },
      { key: "estimatedDepthIn", label: "Estimated depth (in)", type: "number" },
      { key: "drainsNearby", label: "Storm drains / inlets nearby", type: "yesno" },
      { key: "waterwaysNearby", label: "Creek, pond or ditch nearby", type: "yesno" },
      { key: "wellsNearby", label: "Water wells nearby", type: "yesno" },
      { key: "description", label: "What is there", type: "textarea" },
    ],
  },
  {
    key: "waste",
    title: "Waste streams expected",
    shots: [],
    fields: [
      { key: "streams", label: "Streams", type: "checklist", options: ["Contaminated soil", "Free liquid", "Absorbents / PPE", "Debris", "Drums / containers", "Wastewater", "Sludge"] },
      { key: "disposalNotes", label: "Disposal notes (profile on file, generator ID, manifests)", type: "textarea" },
    ],
  },
  { key: "needs", title: "Needs", shots: [], fields: [], custom: "needs" },
  { key: "contacts", title: "Contacts met", shots: [], fields: [], custom: "contacts" },
  { key: "notes", title: "Notes", shots: [], fields: [{ key: "notes", label: "Anything else the estimator should know", type: "textarea" }] },
];

const MEASUREMENT_METHODS = [
  ["scan", "Scan (LiDAR / photogrammetry)"],
  ["tape", "Tape / wheel"],
  ["gps-walk", "GPS walk"],
  ["estimate", "Estimate"],
];

let saveTimer = 0;
let walkMapApi = null;
let walkClockTimer = 0;

// ---------------------------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------------------------

export function currentWalk() {
  const id = crm.state.fieldWalkEventId || "";
  return id ? crm.siteWalkEvents().find((event) => event.id === id) || (crm.getScheduleEvents().find((event) => event.id === id) ?? null) : null;
}

export function myWalks(employeeId) {
  const today = crm.todayIso();
  return crm
    .siteWalkEvents()
    .filter((event) => (event.participantEmployeeIds || []).includes(employeeId) && event.status !== "Completed")
    .sort((a, b) => `${a.date} ${a.startTime || ""}`.localeCompare(`${b.date} ${b.startTime || ""}`))
    .map((event) => ({ event, isToday: String(event.date).slice(0, 10) === today, isPast: String(event.date).slice(0, 10) < today }));
}

function blankReport(walk) {
  const now = new Date().toISOString();
  return {
    id: crm.makeId("walk-report"),
    walkEventId: walk.id,
    opportunityId: walk.opportunityId || "",
    facilityId: walk.facilityId || "",
    status: "In progress",
    checkIn: null,
    sections: {},
    needs: { samplingNeeded: false },
    contactsMet: [],
    measurements: [],
    backgrounds: [],
    referenceSnapshot: null,
    shares: [],
    summary: "",
    completedAt: "",
    completedBy: "",
    startedAt: now,
    createdBy: currentFieldEmployee()?.displayName || crm.state.currentUser?.name || "",
    createdAt: now,
    updatedAt: now,
  };
}

// Item 11 (found, 2026-09-28 IT report): reportFor used to hand back a brand-new blankReport(walk)
// -- with its own random id -- on every call until a row existed on the server. Two edits made before
// the first save landed (e.g. typing a summary, then toggling a chip) each got their own throwaway
// object; only the last one ever reached queuePersist's single debounce timer, so the other was
// silently dropped. One object per walk id, created once and reused for the life of the page, fixes
// that: every edit mutates the same report, so a debounced save always carries everything so far.
const reportCache = new Map();
function reportFor(walk) {
  const cached = reportCache.get(walk.id);
  if (cached) return cached;
  const report = walkReportForEvent(walk.id) || blankReport(walk);
  reportCache.set(walk.id, report);
  return report;
}

function sectionState(report, key) {
  const sections = report.sections || (report.sections = {});
  return sections[key] || (sections[key] = { done: false, fields: {}, photoDocumentIds: [], shots: {} });
}

// Item 11 (found, 2026-09-28 IT report): the fields a save is allowed to pull back from the server
// onto the in-memory report. Never `sections` (or any other content field) -- Object.assign-ing the
// whole server row back over `report` used to wipe out an edit made while the save was in flight
// (the save that completes later, chained on persistChain, would otherwise overwrite it with the
// pre-edit copy it saved).
const SERVER_OWNED_REPORT_FIELDS = ["id", "version", "updatedAt", "createdAt", "shares", "completedAt", "completedBy"];
function applyServerOwnedFields(report, saved) {
  if (!saved || typeof saved !== "object") return;
  for (const key of SERVER_OWNED_REPORT_FIELDS) if (saved[key] !== undefined) report[key] = saved[key];
}

// Report saves are serialised: the check-in save and the debounced autosave otherwise overlap and
// the second one carries a version the server has already moved past (409).
let persistChain = Promise.resolve();
function persistReport(report, { rerender = false } = {}) {
  const run = persistChain.then(async () => {
    report.updatedAt = new Date().toISOString();
    const stored = (crm.state.backend.siteWalkReports || []).find((row) => row.id === report.id);
    if (stored && stored.version !== undefined) report.version = stored.version;
    let saved;
    try {
      saved = await saveFieldRecord("siteWalkReports", report);
    } catch (error) {
      // A server command (share, complete) moved the row on while we held an older copy: take the
      // server's row, lay the walker's own fields over it and save once more.
      const current = error?.conflict ? error.payload?.current : null;
      if (!current) throw error;
      const ours = ["sections", "needs", "contactsMet", "measurements", "summary", "checkIn", "backgrounds", "referenceSnapshot", "status"];
      const merged = { ...current };
      for (const key of ours) if (report[key] !== undefined) merged[key] = report[key];
      Object.assign(report, merged);
      saved = await saveFieldRecord("siteWalkReports", report);
    }
    applyServerOwnedFields(report, saved);
    if (rerender) crm.render();
    return saved;
  });
  persistChain = run.catch(() => {});
  return run;
}

function queuePersist(report) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistReport(report).catch((error) => crm.showToast(error.message || "Could not save the walk."));
  }, 600);
}

function walkContact(walk, opportunity) {
  const fromOpportunity = opportunity ? crm.contactsForOpportunity(opportunity.id)[0] : null;
  if (fromOpportunity) return fromOpportunity;
  const links = walk.facilityId ? crm.facilityContactsForFacility(walk.facilityId) : [];
  const primary = links.find((link) => link.isPrimary) || links[0];
  return primary ? crm.findContact(primary.contactId) : crm.contactsForAccount(walk.accountId || opportunity?.accountId || "")[0] || null;
}

function facilityAddress(facility) {
  return facility ? [facility.street1 || facility.address, [facility.city, facility.stateOrProvince, facility.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
}

function navigateUrl(facility) {
  const point = facility ? crm.facilityCoordinates(facility) : null;
  const target = point ? `${point.lat},${point.lng}` : facilityAddress(facility);
  return target ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(target)}` : "";
}

function elapsed(fromIso) {
  if (!fromIso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(fromIso).getTime()) / 60000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

// ---------------------------------------------------------------------------------------------
// field-walk
// ---------------------------------------------------------------------------------------------

registerFieldRoute("field-walk", {
  title: "Site walk",
  render: renderWalkPage,
  after: afterWalkRender,
});

function renderWalkPage() {
  const walk = currentWalk();
  if (!walk) {
    return `<section class="field-card field-card--empty"><p>No site walk selected.</p><button class="field-button field-button--secondary" type="button" data-view="field-home">Back to My Day</button></section>`;
  }
  const opportunity = crm.findOpportunity(walk.opportunityId);
  const facility = crm.findFacility(walk.facilityId);
  const report = reportFor(walk);
  const tab = crm.state.fieldWalkTab || "brief";
  const completed = Boolean(report.completedAt) || walk.status === "Completed";
  const tabs = [
    ["brief", "Brief"],
    ["walk", "Walk"],
    ["map", "Map"],
    ["finish", "Finish"],
  ];
  return `
    <div class="field-walk ${tab === "map" ? "field-walk--map" : ""}">
      <section class="field-walk-head">
        <div>
          <strong>${esc(opportunity?.name || walk.title || "Site walk")}</strong>
          <small>${esc([facility?.name, crm.formatDate(walk.date), walk.startTime].filter(Boolean).join(" · "))}</small>
        </div>
        <span class="field-pill ${completed ? "is-done" : report.checkIn ? "is-live" : ""}">${completed ? "Completed" : report.checkIn ? `On site · ${elapsed(report.checkIn.at)}` : "Scheduled"}</span>
      </section>
      <nav class="field-tabs" role="tablist">
        ${tabs.map(([key, label]) => `<button class="field-tab ${tab === key ? "is-active" : ""}" type="button" role="tab" aria-selected="${tab === key}" data-field-action="walk-tab" data-tab="${key}">${label}</button>`).join("")}
      </nav>
      <div class="field-walk-body">
        ${tab === "brief" ? renderBriefTab(walk, opportunity, facility, report) : tab === "walk" ? renderWalkTab(walk, opportunity, facility, report) : tab === "map" ? renderMapTab(walk, report) : renderFinishTab(walk, opportunity, facility, report)}
      </div>
    </div>`;
}

function afterWalkRender() {
  if (walkMapApi) {
    walkMapApi.destroy();
    walkMapApi = null;
  }
  clearInterval(walkClockTimer);
  const walk = currentWalk();
  if (!walk) return;
  const report = reportFor(walk);
  if (report.checkIn && !report.completedAt) {
    walkClockTimer = setInterval(() => {
      const pill = document.querySelector(".field-walk-head .field-pill.is-live");
      if (pill) pill.textContent = `On site · ${elapsed(report.checkIn.at)}`;
    }, 30000);
  }
  const mapElement = document.querySelector("#fieldWalkMap");
  if (mapElement) mountWalkMap(mapElement, walk, report);
}

// ---- Brief ----
function renderBriefTab(walk, opportunity, facility, report) {
  const account = crm.findAccount(walk.accountId || opportunity?.accountId || "");
  const contact = walkContact(walk, opportunity);
  const needs = Object.values(crm.OPPORTUNITY_NEEDS_LIST_CONFIG).map((config) => ({ title: config.title, items: opportunity?.[config.field] || [] }));
  const documents = opportunity ? crm.latestDocumentsForEntity("opportunity", opportunity.id) : [];
  const photos = documents.filter((document) => /^image\//.test(document.mimeType || ""));
  const files = documents.filter((document) => !/^image\//.test(document.mimeType || ""));
  const priorProjects = walk.facilityId ? crm.projectsForFacility(walk.facilityId) : [];
  const navigate = navigateUrl(facility);
  const phone = contact?.mobilePhone || contact?.phone || contact?.businessPhone || "";
  return `
    <section class="field-card">
      <div class="field-card-row"><strong>${esc(account?.name || "Account")}</strong><span class="tag">${esc(opportunity?.stage || "")}</span></div>
      <span>${esc(opportunity?.name || walk.title || "")}</span>
      ${facility ? `<small class="field-card-sub">${esc(facility.name)}${facilityAddress(facility) ? ` · ${esc(facilityAddress(facility))}` : ""}</small>` : `<small class="field-card-sub">No facility named on this walk.</small>`}
      <div class="field-actions-row">
        ${navigate ? `<a class="field-button" href="${attr(navigate)}" target="_blank" rel="noopener">Navigate</a>` : ""}
        ${phone ? `<a class="field-button field-button--secondary" href="tel:${attr(phone.replace(/[^\d+]/g, ""))}">Call ${esc(contact?.name?.split(" ")[0] || "")}</a>` : ""}
      </div>
      ${contact ? `<small class="field-card-sub">${esc(contact.name)}${contact.title ? `, ${esc(contact.title)}` : ""}${phone ? ` · ${esc(phone)}` : ""}</small>` : ""}
      ${walk.notes ? `<p class="field-note">${esc(walk.notes)}</p>` : ""}
    </section>

    <h2 class="field-section-title">Customer need</h2>
    <section class="field-card">
      <p>${esc(opportunity?.customerNeed || "Not captured yet.")}</p>
      ${opportunity?.currentSituation ? `<small class="field-card-sub"><strong>Current situation.</strong> ${esc(opportunity.currentSituation)}</small>` : ""}
      ${opportunity?.contaminationNotes ? `<small class="field-card-sub"><strong>Contamination notes.</strong> ${esc(opportunity.contaminationNotes)}</small>` : ""}
      ${facility?.access ? `<small class="field-card-sub"><strong>Site access.</strong> ${esc(facility.access)}</small>` : ""}
    </section>

    <h2 class="field-section-title">Needs so far</h2>
    <section class="field-card">
      ${
        needs.some((group) => group.items.length)
          ? needs
              .filter((group) => group.items.length)
              .map((group) => `<div><small class="field-card-sub">${esc(group.title)}</small><div class="chip-list">${group.items.map((item) => `<span class="tag">${esc(item.name)}${item.note ? ` — ${esc(item.note)}` : ""}</span>`).join("")}</div></div>`)
              .join("")
          : `<p class="field-muted">Nothing listed yet — the Walk tab's Needs section writes here.</p>`
      }
    </section>

    <h2 class="field-section-title">Documents ${files.length ? `(${files.length})` : ""}</h2>
    <section class="field-card">
      ${files.length ? files.map((document) => `<a class="field-doc-row" href="${attr(photoUrl(document.id))}" target="_blank" rel="noopener"><span>${esc(document.caption || document.fileName)}</span><small>${esc(crm.formatDate(document.uploadedAt))}</small></a>`).join("") : `<p class="field-muted">No documents on this opportunity.</p>`}
    </section>

    <h2 class="field-section-title">Prior site photos ${photos.length ? `(${photos.length})` : ""}</h2>
    ${photos.length ? `<div class="field-photo-grid">${photos.slice(0, 12).map((document) => `<a class="field-photo" href="${attr(photoUrl(document.id))}" target="_blank" rel="noopener"><img src="${attr(photoUrl(document.id))}" alt="${attr(document.caption || "")}" loading="lazy" /><span>${esc(document.caption || "")}</span></a>`).join("")}</div>` : `<section class="field-card"><p class="field-muted">No photos yet.</p></section>`}

    <h2 class="field-section-title">Prior work at this site</h2>
    <section class="field-card">
      ${priorProjects.length ? priorProjects.map((project) => `<div class="field-card-row"><span>${esc(project.name)}</span><small>${esc(project.status || "")}${project.startDate ? ` · ${esc(crm.formatDate(project.startDate))}` : ""}</small></div>`).join("") : `<p class="field-muted">${facility ? "No projects recorded at this facility." : "No facility on this walk."}</p>`}
    </section>

    ${report.checkIn ? "" : `<button class="field-button field-button--primary-bar" type="button" data-field-action="walk-check-in">Check in — I'm on site</button>`}
  `;
}

// ---- Walk (guided checklist) ----
function renderWalkTab(walk, opportunity, facility, report) {
  const checkIn = report.checkIn;
  return `
    <section class="field-card ${checkIn ? "field-card--ok" : ""}">
      ${
        checkIn
          ? `<div class="field-card-row"><strong>Checked in ${esc(crm.formatShortTime(checkIn.at))}</strong><small>${checkIn.accuracyM ? `GPS ±${Math.round(checkIn.accuracyM)} m` : "no GPS fix"}</small></div><small class="field-card-sub">Walk clock: ${esc(elapsed(checkIn.at))}</small>`
          : `<div class="field-card-row"><strong>Not checked in</strong><small>GPS + time, starts the walk clock</small></div><button class="field-button" type="button" data-field-action="walk-check-in">Check in</button>`
      }
    </section>

    <div class="field-tools-row">
      <button class="field-tool" type="button" data-field-action="walk-video">Video</button>
      <button class="field-tool" type="button" data-field-action="walk-sketch">Sketch</button>
      <button class="field-tool" type="button" data-field-action="walk-scan">Add scan</button>
      <button class="field-tool" type="button" data-field-action="walk-measure">Measure</button>
    </div>

    ${WALK_SECTIONS.map((section) => renderSection(section, walk, opportunity, report, defaultOpenSection(report))).join("")}

    ${renderMeasurementsSection(report)}

    <button class="field-button field-button--primary-bar" type="button" data-field-action="walk-tab" data-tab="map">Open the map</button>
  `;
}

// One section open at a time: the one last touched, else the first that is not done yet.
function defaultOpenSection(report) {
  if (crm.state.fieldWalkOpenSection) return crm.state.fieldWalkOpenSection;
  return WALK_SECTIONS.find((section) => !report.sections?.[section.key]?.done)?.key || "";
}

function renderSection(section, walk, opportunity, report, openKey) {
  const stateOf = sectionState(report, section.key);
  const photos = stateOf.photoDocumentIds || [];
  const open = openKey === section.key;
  const missingShots = section.shots.filter((shot) => !stateOf.shots?.[shot]);
  return `
    <details class="field-walk-section ${stateOf.done ? "is-done" : ""}" data-section="${attr(section.key)}" ${open ? "open" : ""}>
      <summary>
        <span class="field-walk-section-check" aria-hidden="true">${stateOf.done ? "✓" : ""}</span>
        <span class="field-walk-section-title">${esc(section.title)}</span>
        <small>${photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"}` : ""}${missingShots.length ? `${photos.length ? " · " : ""}${missingShots.length} shot${missingShots.length === 1 ? "" : "s"} needed` : ""}</small>
      </summary>
      <div class="field-walk-section-body">
        ${section.custom === "needs" ? renderNeedsSection(opportunity, report) : section.custom === "contacts" ? renderContactsSection(walk, opportunity, report) : section.fields.map((field) => renderField(section.key, field, stateOf.fields?.[field.key])).join("")}
        ${section.shots.length || section.custom !== "needs" ? renderPhotoTray(section, stateOf) : ""}
        <label class="field-check-row field-walk-done">
          <input type="checkbox" data-walk-done="${attr(section.key)}" ${stateOf.done ? "checked" : ""} />
          <span>Section complete</span>
        </label>
      </div>
    </details>`;
}

function renderField(sectionKey, field, value) {
  const name = `data-walk-field="${attr(sectionKey)}" data-walk-key="${attr(field.key)}"`;
  if (field.type === "textarea") return `<label class="field-label"><span>${esc(field.label)}</span><textarea ${name} rows="2" placeholder="Tap the mic on the keyboard to dictate">${esc(value || "")}</textarea></label>`;
  if (field.type === "number") return `<label class="field-label"><span>${esc(field.label)}</span><input ${name} type="number" inputmode="decimal" step="any" value="${attr(value ?? "")}" /></label>`;
  if (field.type === "select") return `<label class="field-label"><span>${esc(field.label)}</span><select ${name}><option value="">—</option>${field.options.map((option) => `<option ${value === option ? "selected" : ""}>${esc(option)}</option>`).join("")}</select></label>`;
  if (field.type === "yesno") {
    return `<div class="field-label"><span>${esc(field.label)}</span><div class="field-segment" role="radiogroup">${["Yes", "No", "Unknown"].map((option) => `<button type="button" class="field-segment-button ${value === option ? "is-active" : ""}" data-walk-yesno="${attr(sectionKey)}" data-walk-key="${attr(field.key)}" data-value="${option}">${option}</button>`).join("")}</div></div>`;
  }
  if (field.type === "checklist") {
    const picked = new Set(Array.isArray(value) ? value : []);
    return `<div class="field-label"><span>${esc(field.label)}</span><div class="field-chip-toggle">${field.options.map((option) => `<button type="button" class="field-chip ${picked.has(option) ? "is-active" : ""}" data-walk-toggle="${attr(sectionKey)}" data-walk-key="${attr(field.key)}" data-value="${attr(option)}">${esc(option)}</button>`).join("")}</div></div>`;
  }
  return "";
}

function renderPhotoTray(section, stateOf) {
  const photos = stateOf.photoDocumentIds || [];
  return `
    <div class="field-photo-tray">
      ${section.shots
        .map((shot) => {
          const id = stateOf.shots?.[shot];
          return id
            ? `<a class="field-shot is-filled" href="${attr(photoUrl(id))}" target="_blank" rel="noopener"><img src="${attr(photoUrl(id))}" alt="${attr(shot)}" loading="lazy" /><span>${esc(shot)}</span></a>`
            : `<label class="field-shot"><input type="file" accept="image/*" data-walk-photo="${attr(section.key)}" data-slot="${attr(shot)}" /><b>+</b><span>${esc(shot)}</span></label>`;
        })
        .join("")}
      ${photos
        .filter((id) => !Object.values(stateOf.shots || {}).includes(id))
        .map((id) => `<a class="field-shot is-filled" href="${attr(photoUrl(id))}" target="_blank" rel="noopener"><img src="${attr(photoUrl(id))}" alt="" loading="lazy" /><span>Photo</span></a>`)
        .join("")}
      <label class="field-shot field-shot--add"><input type="file" accept="image/*" multiple data-walk-photo="${attr(section.key)}" data-slot="" /><b>+</b><span>Add photo</span></label>
    </div>`;
}

function renderNeedsSection(opportunity, report) {
  if (!opportunity) return `<p class="field-muted">No opportunity on this walk, so needs cannot be written.</p>`;
  return `
    ${Object.entries(crm.OPPORTUNITY_NEEDS_LIST_CONFIG)
      .map(
        ([kind, config]) => `
        <div class="field-needs-group">
          <small class="field-card-sub">${esc(config.title)}</small>
          <div class="chip-list">${(opportunity[config.field] || []).map((item, index) => `<span class="tag tag--removable">${esc(item.name)}${item.note ? ` — ${esc(item.note)}` : ""}<button type="button" data-field-action="walk-need-remove" data-kind="${kind}" data-index="${index}" aria-label="Remove ${attr(item.name)}">×</button></span>`).join("") || `<span class="field-muted">Nothing listed</span>`}</div>
          <form class="field-inline-form" data-field-form="walk-need-add">
            <input type="hidden" name="kind" value="${kind}" />
            <input name="name" placeholder="${kind === "equipment" ? "e.g. Vac truck" : kind === "vendor" ? "e.g. Roll-off hauler" : "e.g. 2 techs, 3 days"}" maxlength="80" required />
            <input name="note" placeholder="note" maxlength="120" />
            <button class="field-button field-button--secondary" type="submit">Add</button>
          </form>
        </div>`,
      )
      .join("")}
    <label class="field-check-row">
      <input type="checkbox" data-walk-sampling ${report.needs?.samplingNeeded ? "checked" : ""} />
      <span>Sampling needed (adds "Sampling" to Resources needed)</span>
    </label>`;
}

function renderContactsSection(walk, opportunity, report) {
  const accountId = walk.accountId || opportunity?.accountId || "";
  const contacts = crm.contactsForAccount(accountId);
  const met = new Set(report.contactsMet || []);
  return `
    ${contacts.length ? contacts.map((contact) => `<label class="field-check-row"><input type="checkbox" data-walk-contact="${attr(contact.id)}" ${met.has(contact.id) ? "checked" : ""} /><span>${esc(contact.name)}${contact.title ? ` <small>${esc(contact.title)}</small>` : ""}</span></label>`).join("") : `<p class="field-muted">No contacts on this account yet.</p>`}
    <form class="field-inline-form field-inline-form--stack" data-field-form="walk-contact-add">
      <input name="name" placeholder="Name of someone new you met" maxlength="80" required />
      <div class="field-inline-form">
        <input name="title" placeholder="Title" maxlength="80" />
        <input name="phone" type="tel" placeholder="Phone" maxlength="40" />
        <button class="field-button field-button--secondary" type="submit">Add</button>
      </div>
    </form>`;
}

function renderMeasurementsSection(report) {
  const measurements = report.measurements || [];
  return `
    <details class="field-walk-section" id="fieldWalkMeasurements" ${crm.state.fieldWalkOpenSection === "measurements" ? "open" : ""}>
      <summary><span class="field-walk-section-check" aria-hidden="true">${measurements.length ? "✓" : ""}</span><span class="field-walk-section-title">Measurements</span><small>${measurements.length ? `${measurements.length} recorded` : ""}</small></summary>
      <div class="field-walk-section-body">
        ${measurements.length ? `<ul class="field-list">${measurements.map((item, index) => `<li><span>${esc(item.label || item.kind)}: <strong>${esc(item.value)} ${esc(item.unit)}</strong> <small>${esc(MEASUREMENT_METHODS.find(([key]) => key === item.method)?.[1] || item.method || "")}</small>${item.note ? `<br><small>${esc(item.note)}</small>` : ""}</span><button type="button" class="field-mini" data-field-action="walk-measurement-remove" data-index="${index}" aria-label="Remove">×</button></li>`).join("")}</ul>` : ""}
        <form class="field-inline-form field-inline-form--stack" data-field-form="walk-measurement">
          <div class="field-inline-form">
            <select name="kind" aria-label="What"><option value="area">Area</option><option value="length">Length</option><option value="depth">Depth</option><option value="volume">Volume</option><option value="other">Other</option></select>
            <input name="value" type="number" inputmode="decimal" step="any" placeholder="value" required />
            <select name="unit" aria-label="Unit"><option>sq ft</option><option>ft</option><option>in</option><option>cu yd</option><option>gal</option><option>m</option></select>
          </div>
          <div class="field-inline-form">
            <select name="method" aria-label="Method">${MEASUREMENT_METHODS.map(([key, label]) => `<option value="${key}">${esc(label)}</option>`).join("")}</select>
            <input name="note" placeholder="what was measured" maxlength="120" />
            <button class="field-button field-button--secondary" type="submit">Add</button>
          </div>
        </form>
      </div>
    </details>`;
}

// ---- Map ----
function renderMapTab(walk, report) {
  const observations = observationsForWalk(walk.id);
  return `
    <div class="field-walk-map-wrap">
      <div id="fieldWalkMap" class="field-walk-map" data-walk-event-id="${attr(walk.id)}"></div>
    </div>
    <p class="field-walk-map-foot"><span>${observations.length} pin${observations.length === 1 ? "" : "s"} / shape${observations.length === 1 ? "" : "s"}</span><span>Imagery may be months to years old. GPS is ±3–10 m outdoors.</span></p>`;
}

function mountWalkMap(element, walk, report) {
  walkMapApi = createSiteMap(element, {
    walk,
    report,
    mode: report.completedAt ? "view" : "edit",
    onChange: (change) => persistObservationChange(walk, change),
    onShare: () => shareWalk(walk),
    onPlanAdded: async (background) => {
      const current = reportFor(walk);
      current.backgrounds = [...(current.backgrounds || []), { id: background.id, kind: "plan", label: background.label, documentId: background.documentId, widthPx: background.widthPx, heightPx: background.heightPx }];
      await persistReport(current);
    },
  });
}

async function persistObservationChange(walk, change) {
  const row = change.observation;
  const base = { walkEventId: walk.id, opportunityId: walk.opportunityId || "", facilityId: walk.facilityId || "" };
  try {
    if (change.type === "remove") {
      await fieldRequest(`/api/backend/siteWalkObservations/${encodeURIComponent(row.id)}`, { method: "DELETE", kind: "walk-observation-delete" });
      crm.state.backend.siteWalkObservations = (crm.state.backend.siteWalkObservations || []).filter((item) => item.id !== row.id);
      return;
    }
    const stored = (crm.state.backend.siteWalkObservations || []).find((item) => item.id === row.id);
    await saveFieldRecord("siteWalkObservations", { ...(stored || {}), ...row, ...base, deletedAt: "" });
    updateMapFoot(walk);
  } catch (error) {
    crm.showToast(error.message || "Could not save the pin.");
    // A refused save must not linger on the map as if it were kept: redraw from what the server has.
    crm.render();
  }
}

function updateMapFoot(walk) {
  const foot = document.querySelector(".field-walk-map-foot span");
  if (!foot) return;
  const count = observationsForWalk(walk.id).length;
  foot.textContent = `${count} pin${count === 1 ? "" : "s"} / shape${count === 1 ? "" : "s"}`;
}

// ---- Finish ----
function renderFinishTab(walk, opportunity, facility, report) {
  const observations = observationsForWalk(walk.id);
  const sectionsDone = WALK_SECTIONS.filter((section) => report.sections?.[section.key]?.done).length;
  const photoCount = new Set([...WALK_SECTIONS.flatMap((section) => report.sections?.[section.key]?.photoDocumentIds || []), ...observations.flatMap((row) => row.photoDocumentIds || [])]).size;
  const needsCount = opportunity ? Object.values(crm.OPPORTUNITY_NEEDS_LIST_CONFIG).reduce((sum, config) => sum + (opportunity[config.field] || []).length, 0) : 0;
  const completed = Boolean(report.completedAt);
  const missingShots = WALK_SECTIONS.flatMap((section) => section.shots.filter((shot) => !report.sections?.[section.key]?.shots?.[shot]).map((shot) => `${section.title}: ${shot}`));
  return `
    ${completed ? `<section class="field-card field-card--ok"><strong>Walk completed ${esc(crm.formatDateTime(report.completedAt))}</strong><small class="field-card-sub">by ${esc(report.completedBy || "")}. The report, map and photos are on the opportunity's Develop &amp; Planning tab.</small></section>` : ""}
    <section class="field-card">
      <div class="field-stat-grid">
        <div><strong>${sectionsDone}/${WALK_SECTIONS.length}</strong><small>sections done</small></div>
        <div><strong>${observations.length}</strong><small>pins &amp; shapes</small></div>
        <div><strong>${photoCount}</strong><small>photos</small></div>
        <div><strong>${(report.measurements || []).length}</strong><small>measurements</small></div>
        <div><strong>${needsCount}</strong><small>needs written</small></div>
        <div><strong>${(report.contactsMet || []).length}</strong><small>contacts met</small></div>
      </div>
      ${missingShots.length ? `<small class="field-card-sub">Still missing: ${esc(missingShots.join(", "))}</small>` : `<small class="field-card-sub">Every required shot is in.</small>`}
      ${report.checkIn ? "" : `<small class="field-card-sub field-warn">No check-in recorded — the Walk tab's Check in stamps GPS and time.</small>`}
    </section>

    <label class="field-label"><span>Summary for the estimator</span><textarea data-walk-summary rows="4" placeholder="Two or three sentences: what is there, how big, what it will take" ${completed ? "readonly" : ""}>${esc(report.summary || "")}</textarea></label>

    ${observations.length ? `<h2 class="field-section-title">Observations</h2><ol class="sitemap-summary-list field-card">${observations.map(renderObservationLine).join("")}</ol>` : ""}

    <div class="field-actions-row field-actions-row--stack">
      ${completed ? "" : `<button class="field-button" type="button" data-field-action="walk-complete">Complete walk</button>`}
      <button class="field-button field-button--secondary" type="button" data-field-action="walk-share">Share link</button>
      <button class="field-button field-button--secondary" type="button" data-field-action="walk-export-pdf">Export PDF</button>
      <button class="field-button field-button--ghost" type="button" data-field-action="walk-export-zip">Export site package (zip)</button>
    </div>`;
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

registerFieldAction("walk-tab", (button) => {
  crm.state.fieldWalkTab = button.dataset.tab || "brief";
  crm.render();
});

registerFieldAction("walk-open", (button) => {
  crm.state.fieldWalkEventId = button.dataset.id || "";
  crm.state.fieldWalkTab = "brief";
  crm.state.view = "field-walk";
  crm.render();
});

registerFieldAction("walk-check-in", async (button) => {
  const walk = currentWalk();
  if (!walk) return;
  button.disabled = true;
  button.textContent = "Getting a GPS fix…";
  const fix = await new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracyM: Math.round(position.coords.accuracy || 0) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
  const report = reportFor(walk);
  const now = new Date().toISOString();
  let locationId = "";
  try {
    if (fix) {
      const employee = currentFieldEmployee();
      const location = await saveFieldRecord("locations", {
        id: crm.makeId("location"),
        projectId: "",
        scheduleEventId: walk.id,
        label: `Site walk check-in — ${crm.findFacility(walk.facilityId)?.name || walk.title || "site"}`,
        latitude: fix.lat,
        longitude: fix.lng,
        assetTags: [],
        status: "Field ping",
        source: "Site walk check-in",
        locationType: "Check-in",
        reportedByEmployeeId: employee?.id || "",
        lastPingAt: now,
      });
      locationId = location?.id || "";
      if (walk.opportunityId && locationId) {
        await saveFieldRecord("opportunityLocations", { id: crm.makeId("opp-location"), opportunityId: walk.opportunityId, type: "Location", facilityId: "", locationId, role: "Site walk check-in", note: `Checked in ${crm.formatDateTime(now)}`, createdAt: now });
      }
    }
    report.checkIn = { at: now, lat: fix?.lat ?? null, lng: fix?.lng ?? null, accuracyM: fix?.accuracyM ?? null, locationId };
    report.startedAt = report.startedAt || now;
    await persistReport(report);
    crm.state.fieldWalkTab = "walk";
    crm.render();
    crm.showToast(fix ? `Checked in (GPS ±${fix.accuracyM} m).` : "Checked in without a GPS fix.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Check in";
    crm.showToast(error.message || "Check-in failed.");
  }
});

registerFieldAction("walk-need-remove", async (button) => {
  const walk = currentWalk();
  const opportunity = walk ? crm.findOpportunity(walk.opportunityId) : null;
  const config = crm.OPPORTUNITY_NEEDS_LIST_CONFIG[button.dataset.kind];
  if (!opportunity || !config) return;
  const items = [...(opportunity[config.field] || [])];
  items.splice(Number(button.dataset.index), 1);
  await writeNeeds(opportunity, { [config.field]: items });
  rememberSection("needs");
  crm.render();
});

async function writeNeeds(opportunity, updates) {
  const updated = crm.buildCoreOpportunityRecord({ ...opportunity, ...updates, updatedAt: new Date().toISOString() });
  await saveFieldRecord("opportunities", updated);
}

registerFieldForm("walk-need-add", async (form) => {
  const walk = currentWalk();
  const opportunity = walk ? crm.findOpportunity(walk.opportunityId) : null;
  const data = new FormData(form);
  const config = crm.OPPORTUNITY_NEEDS_LIST_CONFIG[(data.get("kind") || "").toString()];
  const name = (data.get("name") || "").toString().trim();
  if (!opportunity || !config || !name) return;
  const note = (data.get("note") || "").toString().trim();
  await writeNeeds(opportunity, { [config.field]: [...(opportunity[config.field] || []), { name, note }] });
  rememberSection("needs");
  crm.render();
  crm.showToast(`${name} added to ${config.title}.`);
});

registerFieldForm("walk-contact-add", async (form) => {
  const walk = currentWalk();
  if (!walk) return;
  const opportunity = crm.findOpportunity(walk.opportunityId);
  const data = new FormData(form);
  const name = (data.get("name") || "").toString().trim();
  if (!name) return;
  const contact = crm.buildCoreContactRecord({
    id: crm.makeId("cont"),
    accountId: walk.accountId || opportunity?.accountId || "",
    name,
    fullName: name,
    title: (data.get("title") || "").toString().trim(),
    jobTitle: (data.get("title") || "").toString().trim(),
    phone: (data.get("phone") || "").toString().trim(),
    businessPhone: (data.get("phone") || "").toString().trim(),
    opportunityIds: opportunity ? [opportunity.id] : [],
    notes: `Met on the site walk ${crm.formatDate(walk.date)}.`,
    owner: currentFieldEmployee()?.displayName || "Unassigned",
  });
  await saveFieldRecord("contacts", contact);
  const report = reportFor(walk);
  report.contactsMet = [...new Set([...(report.contactsMet || []), contact.id])];
  await persistReport(report);
  rememberSection("contacts");
  crm.render();
  crm.showToast(`${name} added and marked as met.`);
});

registerFieldForm("walk-measurement", async (form) => {
  const walk = currentWalk();
  if (!walk) return;
  const data = new FormData(form);
  const value = Number(data.get("value"));
  if (!Number.isFinite(value)) return;
  const kind = (data.get("kind") || "other").toString();
  const measurement = {
    id: crm.makeId("measure"),
    kind,
    label: { area: "Area", length: "Length", depth: "Depth", volume: "Volume", other: "Measurement" }[kind] || "Measurement",
    value,
    unit: (data.get("unit") || "").toString(),
    method: (data.get("method") || "estimate").toString(),
    note: (data.get("note") || "").toString().trim(),
    at: new Date().toISOString(),
    by: currentFieldEmployee()?.displayName || "",
  };
  const report = reportFor(walk);
  report.measurements = [...(report.measurements || []), measurement];
  // The report row is the record; W1's POST /api/field/measurements mirror is not called from here so
  // an environment without it does not log a 404 on every measurement.
  await persistReport(report);
  rememberSection("measurements");
  crm.render();
});

registerFieldAction("walk-measurement-remove", async (button) => {
  const walk = currentWalk();
  if (!walk) return;
  const report = reportFor(walk);
  report.measurements = (report.measurements || []).filter((item, index) => index !== Number(button.dataset.index));
  await persistReport(report);
  rememberSection("measurements");
  crm.render();
});

registerFieldAction("walk-measure", () => {
  rememberSection("measurements");
  const details = document.querySelector("#fieldWalkMeasurements");
  if (details) {
    details.open = true;
    details.scrollIntoView({ behavior: "smooth", block: "start" });
    details.querySelector("input[name='value']")?.focus();
  }
});

registerFieldAction("walk-video", async () => {
  const walk = currentWalk();
  if (window.fieldMedia?.openVideoCapture) return window.fieldMedia.openVideoCapture({ entityType: "opportunity", entityId: walk?.opportunityId || "", walkEventId: walk?.id || "" });
  crm.showToast("Video capture arrives with the media module (W4). Use the phone's camera app for now and Add scan / Add photo to file it.");
});

registerFieldAction("walk-scan", async () => {
  const walk = currentWalk();
  if (window.fieldMedia?.openAddScan) return window.fieldMedia.openAddScan({ entityType: "opportunity", entityId: walk?.opportunityId || "", walkEventId: walk?.id || "" });
  crm.showToast("Add scan arrives with the media module (W4): share a GLB/USDZ from your scanning app into the walk.");
});

registerFieldAction("walk-sketch", async () => {
  const walk = currentWalk();
  if (!walk) return;
  // The markup tool needs an image to draw on; openSiteSketch renders the facility's satellite
  // snapshot (or a blank grid offline) and opens the tool over it, saving a site-sketch document.
  // (2026-09-28: this used to call openImageMarkup with no image and toasted "Unrecognized image source".)
  if (window.fieldMedia?.openSiteSketch) {
    return window.fieldMedia.openSiteSketch({ opportunityId: walk.opportunityId || "", facilityId: walk.facilityId || "" });
  }
  openSimpleSketch(walk);
});

// Fallback sketch: a plain canvas with pen + colours, saved as a site-sketch document.
function openSimpleSketch(walk) {
  const dialog = document.querySelector("#fieldSketchDialog");
  if (!dialog) return crm.showToast("Sketch dialog is missing from index.html.");
  const canvas = dialog.querySelector("canvas");
  const context = canvas.getContext("2d");
  canvas.width = Math.min(window.innerWidth - 40, 720);
  canvas.height = Math.round(canvas.width * 0.75);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#e5e7eb";
  context.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 40) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  for (let y = 0; y < canvas.height; y += 40) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }
  let drawing = false;
  let color = "#c92a2a";
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * canvas.width, y: ((event.clientY - rect.top) / rect.height) * canvas.height };
  };
  canvas.onpointerdown = (event) => {
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    const p = point(event);
    context.strokeStyle = color;
    context.lineWidth = 4;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(p.x, p.y);
  };
  canvas.onpointermove = (event) => {
    if (!drawing) return;
    const p = point(event);
    context.lineTo(p.x, p.y);
    context.stroke();
  };
  canvas.onpointerup = () => {
    drawing = false;
  };
  dialog.querySelectorAll("[data-sketch-color]").forEach((button) => {
    button.onclick = () => {
      color = button.dataset.sketchColor;
      dialog.querySelectorAll("[data-sketch-color]").forEach((item) => item.classList.toggle("is-active", item === button));
    };
  });
  dialog.querySelector("[data-sketch-save]").onclick = async () => {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    try {
      const file = new File([blob], `site-sketch-${Date.now()}.png`, { type: "image/png" });
      const saved = await uploadSiteDocument({ entityType: "opportunity", entityId: walk.opportunityId, file, typeCode: "site-sketch", caption: dialog.querySelector("[data-sketch-caption]").value || "Site sketch" });
      const report = reportFor(walk);
      const notes = sectionState(report, "notes");
      notes.photoDocumentIds = [...(notes.photoDocumentIds || []), saved.id];
      await persistReport(report);
      dialog.close();
      crm.render();
      crm.showToast("Sketch saved to the opportunity.");
    } catch (error) {
      crm.showToast(error.message || "Sketch could not be saved.");
    }
  };
  dialog.querySelector("[data-sketch-cancel]").onclick = () => dialog.close();
  dialog.showModal();
}

registerFieldAction("walk-complete", async (button) => {
  const walk = currentWalk();
  if (!walk) return;
  const report = reportFor(walk);
  const summaryField = document.querySelector("[data-walk-summary]");
  if (summaryField) report.summary = summaryField.value.trim();
  const opportunity = crm.findOpportunity(walk.opportunityId);
  const sectionsDone = WALK_SECTIONS.filter((section) => report.sections?.[section.key]?.done).length;
  if (!report.summary && !window.confirm("No summary written. Complete the walk anyway?")) return;
  if (sectionsDone < 3 && !window.confirm(`Only ${sectionsDone} of ${WALK_SECTIONS.length} sections are marked complete. Complete the walk anyway?`)) return;
  button.disabled = true;
  button.textContent = "Completing…";
  const now = new Date().toISOString();
  const by = currentFieldEmployee()?.displayName || crm.state.currentUser?.name || "";
  try {
    // Freeze the reference layers that were on the map into the report.
    try {
      const center = facilityCenter(walk.facilityId);
      report.referenceSnapshot = await snapshotReferenceLayers(walk, center ? bboxAround(center, 400) : null);
    } catch {
      report.referenceSnapshot = report.referenceSnapshot || null;
    }
    const needs = opportunity ? Object.fromEntries(Object.values(crm.OPPORTUNITY_NEEDS_LIST_CONFIG).map((config) => [config.field, opportunity[config.field] || []])) : {};
    const payload = { reportId: report.id, summary: report.summary, sections: report.sections, needs: { ...needs, samplingNeeded: Boolean(report.needs?.samplingNeeded) }, contactsMet: report.contactsMet || [], measurements: report.measurements || [], checkIn: report.checkIn, referenceSnapshot: report.referenceSnapshot, backgrounds: report.backgrounds || [], completedAt: now, completedBy: by };
    let serverDidIt = false;
    try {
      // reportFor now hands back one cached object for the life of the page (item 11), so the
      // completedAt/completedBy/shares the server just wrote have to be copied onto it explicitly --
      // a plain refreshBackendState() no longer reaches this report the way it used to.
      const saved = await fieldRequest(`/api/field/site-walk/${encodeURIComponent(walk.id)}/complete`, { body: payload, kind: "walk-complete" });
      applyServerOwnedFields(report, saved);
      serverDidIt = true;
    } catch (error) {
      if (!/does not have|404/.test(error?.message || "") && error?.status !== 404) throw error;
    }
    if (!serverDidIt) {
      // Fallback until W1's command exists: the same writes, client-side.
      report.completedAt = now;
      report.completedBy = by;
      report.status = "Complete";
      await persistReport(report);
      const event = crm.getScheduleEvents().find((item) => item.id === walk.id);
      if (event) await saveFieldRecord("scheduleEvents", { ...event, status: "Completed" });
      const activity = walk.activityId ? (crm.state.backend.activities || []).find((item) => item.id === walk.activityId) : null;
      if (activity) await saveFieldRecord("activities", { ...activity, status: "Completed", body: [activity.body, report.summary ? `Site walk summary: ${report.summary}` : ""].filter(Boolean).join("\n\n"), updatedAt: now });
      if (opportunity) await saveFieldRecord("opportunities", crm.buildCoreOpportunityRecord({ ...opportunity, siteWalkStatus: "Complete", updatedAt: now }));
    } else {
      await crm.refreshBackendState();
    }
    crm.render();
    crm.showToast(serverDidIt ? "Walk completed." : "Walk completed (recorded by the app; the server command is not deployed yet).");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Complete walk";
    crm.showToast(error.message || "Could not complete the walk.");
  }
});

registerFieldAction("walk-share", async () => {
  const walk = currentWalk();
  if (walk) await shareWalk(walk);
});

export async function shareWalk(walk) {
  const report = reportFor(walk);
  if (!walkReportForEvent(walk.id)) await persistReport(report);
  try {
    const result = await fieldRequest(`/api/field/walks/${encodeURIComponent(report.id)}/share`, { body: { expiresInDays: 14 }, kind: "walk-share" });
    const url = result?.url?.startsWith("http") ? result.url : `${location.origin}${result?.url || ""}`;
    const title = `Site walk — ${crm.findOpportunity(walk.opportunityId)?.name || walk.title || ""}`;
    // The share route only echoes {id, url, expiresAt, audience}, not the whole report row, so (with
    // reportFor now caching one object per walk, item 11) the cached report's own `shares` list needs
    // a manual refresh rather than the refreshBackendState() below reaching it automatically.
    if (result?.id) report.shares = [...(report.shares || []), { id: result.id, audience: result.audience || "staff", expiresAt: result.expiresAt || "", createdAt: new Date().toISOString(), revokedAt: "" }];
    if (navigator.share) {
      try {
        await navigator.share({ title, text: `${title}. Live map and photos:`, url });
        await crm.refreshBackendState().catch(() => {});
        return;
      } catch {
        // fall through to the clipboard
      }
    }
    await navigator.clipboard?.writeText(url);
    crm.showToast(`Share link copied. Expires ${crm.formatDate(result?.expiresAt || "")}.`);
    await crm.refreshBackendState();
  } catch (error) {
    crm.showToast(/does not have/.test(error?.message || "") ? "Share links need the server update (the /api/field/walks share route is not deployed yet)." : error.message || "Could not create a share link.");
  }
}

registerFieldAction("walk-export-pdf", () => {
  const walk = currentWalk();
  if (walk) exportWalkPdf(walk.id);
});

registerFieldAction("walk-export-zip", async () => {
  const walk = currentWalk();
  if (walk) await exportWalkZip(walk.id);
});

// ---- typed fields (delegated once) ----
let walkInputsWired = false;
function wireWalkInputs() {
  if (walkInputsWired) return;
  walkInputsWired = true;
  document.addEventListener("input", (event) => {
    const field = event.target.closest("[data-walk-field]");
    const summary = event.target.closest("[data-walk-summary]");
    const walk = currentWalk();
    if (!walk || crm.state.view !== "field-walk") return;
    const report = reportFor(walk);
    if (field) {
      const section = sectionState(report, field.dataset.walkField);
      section.fields = section.fields || {};
      section.fields[field.dataset.walkKey] = field.type === "number" ? (field.value === "" ? "" : Number(field.value)) : field.value;
      rememberSection(field.dataset.walkField);
      queuePersist(report);
    } else if (summary) {
      report.summary = summary.value;
      queuePersist(report);
    }
  });
  document.addEventListener("change", async (event) => {
    const walk = currentWalk();
    if (!walk || crm.state.view !== "field-walk") return;
    const report = reportFor(walk);
    const done = event.target.closest("[data-walk-done]");
    const contact = event.target.closest("[data-walk-contact]");
    const sampling = event.target.closest("[data-walk-sampling]");
    const photo = event.target.closest("[data-walk-photo]");
    if (done) {
      sectionState(report, done.dataset.walkDone).done = done.checked;
      rememberSection(done.dataset.walkDone);
      await persistReport(report);
      done.closest(".field-walk-section")?.classList.toggle("is-done", done.checked);
      const check = done.closest(".field-walk-section")?.querySelector(".field-walk-section-check");
      if (check) check.textContent = done.checked ? "✓" : "";
      return;
    }
    if (contact) {
      const set = new Set(report.contactsMet || []);
      if (contact.checked) set.add(contact.dataset.walkContact);
      else set.delete(contact.dataset.walkContact);
      report.contactsMet = [...set];
      rememberSection("contacts");
      await persistReport(report);
      return;
    }
    if (sampling) {
      report.needs = { ...(report.needs || {}), samplingNeeded: sampling.checked };
      rememberSection("needs");
      await persistReport(report);
      const opportunity = crm.findOpportunity(walk.opportunityId);
      if (opportunity) {
        const items = (opportunity.resourceNeeds || []).filter((item) => item.name.toLowerCase() !== "sampling");
        if (sampling.checked) items.push({ name: "Sampling", note: "Flagged on the site walk" });
        await writeNeeds(opportunity, { resourceNeeds: items });
      }
      crm.render();
      return;
    }
    if (photo) {
      const files = [...(photo.files || [])];
      if (!files.length) return;
      const sectionKey = photo.dataset.walkPhoto;
      const slot = photo.dataset.slot || "";
      const section = WALK_SECTIONS.find((item) => item.key === sectionKey);
      const stateOf = sectionState(report, sectionKey);
      crm.showToast(`Uploading ${files.length} photo${files.length === 1 ? "" : "s"}…`);
      try {
        for (const [index, file] of files.entries()) {
          const caption = slot ? `${section?.title || sectionKey} — ${slot}` : `${section?.title || sectionKey}${files.length > 1 ? ` (${index + 1})` : ""}`;
          const saved = await uploadSiteDocument({ entityType: "opportunity", entityId: walk.opportunityId, file, typeCode: "site-photo", caption });
          stateOf.photoDocumentIds = [...(stateOf.photoDocumentIds || []), saved.id];
          if (slot && index === 0) stateOf.shots = { ...(stateOf.shots || {}), [slot]: saved.id };
        }
        rememberSection(sectionKey);
        await persistReport(report);
        crm.render();
        crm.showToast(`${files.length} photo${files.length === 1 ? "" : "s"} filed on the opportunity.`);
      } catch (error) {
        crm.showToast(error.message || "Photo upload failed.");
      }
    }
  });
  document.addEventListener("click", async (event) => {
    const yesno = event.target.closest("[data-walk-yesno]");
    const toggle = event.target.closest("[data-walk-toggle]");
    if (!yesno && !toggle) return;
    const walk = currentWalk();
    if (!walk || crm.state.view !== "field-walk") return;
    const report = reportFor(walk);
    if (yesno) {
      const section = sectionState(report, yesno.dataset.walkYesno);
      section.fields = section.fields || {};
      section.fields[yesno.dataset.walkKey] = yesno.dataset.value;
      yesno.parentElement.querySelectorAll(".field-segment-button").forEach((item) => item.classList.toggle("is-active", item === yesno));
      rememberSection(yesno.dataset.walkYesno);
      queuePersist(report);
    } else if (toggle) {
      const section = sectionState(report, toggle.dataset.walkToggle);
      section.fields = section.fields || {};
      const current = new Set(Array.isArray(section.fields[toggle.dataset.walkKey]) ? section.fields[toggle.dataset.walkKey] : []);
      if (current.has(toggle.dataset.value)) current.delete(toggle.dataset.value);
      else current.add(toggle.dataset.value);
      section.fields[toggle.dataset.walkKey] = [...current];
      toggle.classList.toggle("is-active", current.has(toggle.dataset.value));
      rememberSection(toggle.dataset.walkToggle);
      queuePersist(report);
    }
  });
}
wireWalkInputs();

function rememberSection(key) {
  crm.state.fieldWalkOpenSection = key;
}

// ---------------------------------------------------------------------------------------------
// Export: print page (PDF) and site package (zip)
// ---------------------------------------------------------------------------------------------

function walkBundle(walkEventId) {
  const walk = crm.getScheduleEvents().find((event) => event.id === walkEventId);
  if (!walk) throw new Error("Walk not found.");
  const report = walkReportForEvent(walk.id) || blankReport(walk);
  const observations = observationsForWalk(walk.id);
  const opportunity = crm.findOpportunity(walk.opportunityId);
  const facility = crm.findFacility(walk.facilityId);
  const account = crm.findAccount(walk.accountId || opportunity?.accountId || "");
  const documentIds = new Set([...observations.flatMap((row) => row.photoDocumentIds || []), ...WALK_SECTIONS.flatMap((section) => report.sections?.[section.key]?.photoDocumentIds || [])]);
  const documents = (crm.state.backend.documents || []).filter((document) => documentIds.has(document.id) && !document.deletedAt);
  return { walk, report, observations, opportunity, facility, account, documents };
}

export function buildWalkExportHtml(bundle, { origin = location.origin } = {}) {
  const { walk, report, observations, opportunity, facility, account, documents } = bundle;
  const center = facilityCenter(walk.facilityId);
  const docById = new Map(documents.map((document) => [document.id, document]));
  const data = {
    center,
    observations,
    backgrounds: backgroundsForReport(report).map((background) => ({ ...background, imageUrl: background.imageUrl ? `${origin}${background.imageUrl}` : "" })),
    layers: (report.referenceSnapshot?.layers || []).map((layer) => ({ id: layer.layerId, label: layer.label, kind: layer.kind, geojson: layer.geojson, source: layer.source, sourceDate: layer.sourceDate, visible: true })),
  };
  const legend = Object.entries(PIN_KINDS).map(([key, kind]) => `<span class="legend-item"><i style="background:${kind.color}">${esc(kind.glyph)}</i>${esc(kind.label)}</span>`).join("");
  const sectionBlocks = WALK_SECTIONS.filter((section) => !section.custom && report.sections?.[section.key]).map((section) => {
    const stateOf = report.sections[section.key];
    const fields = section.fields.filter((field) => stateOf.fields?.[field.key] !== undefined && stateOf.fields?.[field.key] !== "" && !(Array.isArray(stateOf.fields?.[field.key]) && !stateOf.fields[field.key].length));
    if (!fields.length && !(stateOf.photoDocumentIds || []).length) return "";
    return `<section class="walk-section"><h3>${esc(section.title)}${stateOf.done ? " ✓" : ""}</h3>
      ${fields.length ? `<dl>${fields.map((field) => `<div><dt>${esc(field.label)}</dt><dd>${esc(Array.isArray(stateOf.fields[field.key]) ? stateOf.fields[field.key].join(", ") : stateOf.fields[field.key])}</dd></div>`).join("")}</dl>` : ""}
      ${(stateOf.photoDocumentIds || []).length ? `<div class="photos">${stateOf.photoDocumentIds.map((id) => `<figure><img src="${origin}${photoUrl(id)}" alt="" /><figcaption>${esc(docById.get(id)?.caption || "")}</figcaption></figure>`).join("")}</div>` : ""}
    </section>`;
  });
  const needs = opportunity ? Object.values(crm.OPPORTUNITY_NEEDS_LIST_CONFIG).map((config) => ({ title: config.title, items: opportunity[config.field] || [] })).filter((group) => group.items.length) : [];
  const body = `
    <link rel="stylesheet" href="${origin}/public/vendor/leaflet/leaflet.css" />
    <link rel="stylesheet" href="${origin}/field/styles.css" />
    <div class="print-doc-header">
      <div><h1>Site walk — ${esc(opportunity?.name || walk.title || "")}</h1><div>${esc(account?.name || "")}${facility ? ` · ${esc(facility.name)}` : ""}</div><div>${esc(facilityAddress(facility))}</div></div>
      <div class="print-doc-meta"><div>${esc(crm.formatDate(walk.date))} ${esc(walk.startTime || "")}</div><div>${report.completedAt ? `Completed ${esc(crm.formatDateTime(report.completedAt))} by ${esc(report.completedBy || "")}` : "In progress"}</div><div>${report.checkIn ? `Checked in ${esc(crm.formatShortTime(report.checkIn.at))}${report.checkIn.accuracyM ? ` (GPS ±${Math.round(report.checkIn.accuracyM)} m)` : ""}` : "No check-in"}</div></div>
    </div>
    ${report.summary ? `<section class="walk-section"><h3>Summary</h3><p>${esc(report.summary)}</p></section>` : ""}
    <section class="walk-section"><h3>Site map</h3>
      <div id="walkPrintMap" class="walk-print-map"></div>
      <div class="legend">${legend}</div>
      <p class="walk-fineprint">Imagery: Esri World Imagery; capture date varies by area and may be months to years old. Pins placed by GPS show their accuracy; others were placed by hand. Reference layers are dashed grey with their source and date; parcel lines are tax-map accuracy, not a survey. No public data shows underground lines — a locate is still required before digging.</p>
      ${data.layers.length ? `<p class="walk-fineprint">Reference layers on this map: ${data.layers.map((layer) => esc(`${layer.label} (${[layer.source, layer.sourceDate].filter(Boolean).join(", ")})`)).join("; ")}.</p>` : ""}
    </section>
    ${observations.length ? `<section class="walk-section"><h3>Observations (${observations.length})</h3>${observations
      .map((row) => {
        const kind = PIN_KINDS[row.kind] || PIN_KINDS.custom;
        const color = row.geometry ? SHAPE_COLORS[row.color] || SHAPE_COLORS.blue : kind.color;
        const title = row.label || (row.geometry ? SHAPE_KINDS[row.shapeKind]?.label || "Shape" : kind.label);
        const facts = [row.geometry ? SHAPE_KINDS[row.shapeKind]?.label || "Shape" : kind.label, row.areaSqFt ? `${Math.round(row.areaSqFt).toLocaleString()} sq ft` : "", row.lengthFt ? `${Math.round(row.lengthFt).toLocaleString()} ft` : "", row.lat ? `${Number(row.lat).toFixed(6)}, ${Number(row.lng).toFixed(6)}` : row.backgroundId && row.backgroundId !== "aerial" ? `on plan ${esc(data.backgrounds.find((background) => background.id === row.backgroundId)?.label || "")}` : "", row.accuracyM ? `GPS ±${Math.round(row.accuracyM)} m` : row.lat ? "placed manually" : "", row.createdAt ? crm.formatDateTime(row.createdAt) : ""].filter(Boolean);
        return `<article class="walk-observation"><div class="walk-observation-head"><span class="seq" style="background:${color}">${esc(row.seq)}</span><div><strong>${esc(title)}</strong><small>${esc(facts.join(" · "))}</small></div></div>${row.note ? `<p>${esc(row.note)}</p>` : ""}${(row.photoDocumentIds || []).length ? `<div class="photos">${row.photoDocumentIds.map((id) => `<figure><img src="${origin}${photoUrl(id)}" alt="" /><figcaption>${esc(docById.get(id)?.caption || "")}</figcaption></figure>`).join("")}</div>` : ""}</article>`;
      })
      .join("")}</section>` : ""}
    ${sectionBlocks.join("")}
    ${(report.measurements || []).length ? `<section class="walk-section"><h3>Measurements</h3><table><thead><tr><th>What</th><th class="num">Value</th><th>Method</th><th>Note</th></tr></thead><tbody>${report.measurements.map((item) => `<tr><td>${esc(item.label || item.kind)}</td><td class="num">${esc(item.value)} ${esc(item.unit)}</td><td>${esc(MEASUREMENT_METHODS.find(([key]) => key === item.method)?.[1] || item.method || "")}</td><td>${esc(item.note || "")}</td></tr>`).join("")}</tbody></table></section>` : ""}
    ${needs.length ? `<section class="walk-section"><h3>Needs</h3>${needs.map((group) => `<p><strong>${esc(group.title)}:</strong> ${group.items.map((item) => esc(item.note ? `${item.name} (${item.note})` : item.name)).join(", ")}</p>`).join("")}</section>` : ""}
    ${(report.contactsMet || []).length ? `<section class="walk-section"><h3>Contacts met</h3><p>${report.contactsMet.map((id) => esc(crm.findContact(id)?.name || id)).join(", ")}</p></section>` : ""}
    <script src="${origin}/public/vendor/leaflet/leaflet.js"></script>
    <script type="module">
      import { createSiteMap } from "${origin}/field/map-core.js";
      const data = ${JSON.stringify(data).replace(/</g, "\\u003c")};
      let printed = false;
      const print = () => { if (printed) return; printed = true; setTimeout(() => window.print(), 400); };
      createSiteMap(document.getElementById("walkPrintMap"), { mode: "view", printing: true, center: data.center, observations: data.observations, backgrounds: data.backgrounds, layers: data.layers, photoUrl: (id) => "${origin}/api/documents/" + encodeURIComponent(id) + "/view", onTilesLoaded: print });
      setTimeout(print, 6000);
    </script>`;
  const extraStyles = `
    .print-doc { max-width: 900px; }
    .walk-section { margin: 18px 0; page-break-inside: avoid; }
    .walk-print-map { height: 520px; border: 1px solid #d8dee6; border-radius: 6px; overflow: hidden; }
    .legend { display: flex; flex-wrap: wrap; gap: 10px 16px; margin: 8px 0; font-size: 0.8rem; }
    .legend-item i { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; color: #fff; font-style: normal; font-size: 0.7rem; margin-right: 5px; vertical-align: middle; }
    .walk-fineprint { font-size: 0.72rem; color: #666; margin: 4px 0; }
    .walk-observation { border-top: 1px solid #e3e8ee; padding: 10px 0; page-break-inside: avoid; }
    .walk-observation-head { display: flex; gap: 10px; align-items: center; }
    .walk-observation-head .seq { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; color: #fff; font-weight: 700; flex: none; }
    .walk-observation-head small { display: block; color: #666; font-size: 0.78rem; }
    .walk-observation p { margin: 6px 0; white-space: pre-wrap; }
    .photos { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; margin-top: 8px; }
    .photos figure { margin: 0; }
    .photos img { width: 100%; height: 130px; object-fit: cover; border-radius: 4px; border: 1px solid #d8dee6; }
    .photos figcaption { font-size: 0.72rem; color: #666; }
    dl { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; margin: 0; }
    dl div { display: flex; flex-direction: column; }
    dt { font-size: 0.72rem; color: #666; text-transform: uppercase; letter-spacing: 0.04em; }
    dd { margin: 0; }
    .sitemap-imagery-tag { font-size: 0.65rem; }
    @media print { .walk-print-map { height: 460px; } .leaflet-control { display: none !important; } }`;
  return crm.renderPrintShell({ title: `Site walk — ${opportunity?.name || walk.title || ""}`, body, extraStyles });
}

export function exportWalkPdf(walkEventId) {
  try {
    const bundle = walkBundle(walkEventId);
    crm.openPrintWindow(buildWalkExportHtml(bundle), "site walk report");
    crm.showToast("The print page is the PDF: it prints itself once the map tiles have loaded (Save as PDF in the print dialog). A file could not be produced in the browser without a PDF library, so nothing is filed automatically.");
  } catch (error) {
    crm.showToast(error.message || "Could not export the walk.");
  }
}

// ---- zip (a real ZIP container, deflate via CompressionStream; no library) ----
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function dosDateTime(date) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() >> 1) & 31);
  const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

export async function buildZip(files) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const now = dosDateTime(new Date());
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const raw = file.data instanceof Uint8Array ? file.data : new Uint8Array(await new Blob([file.data]).arrayBuffer());
    const crc = crc32(raw);
    const compressed = await deflateRaw(raw);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 8, true);
    local.setUint16(10, now.time, true);
    local.setUint16(12, now.day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, compressed.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, compressed);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 8, true);
    entry.setUint16(12, now.time, true);
    entry.setUint16(14, now.day, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, compressed.length, true);
    entry.setUint32(24, raw.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + compressed.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}

export async function exportWalkZip(walkEventId) {
  if (typeof CompressionStream === "undefined") {
    crm.showToast("This browser cannot build a zip (no CompressionStream). Use Export PDF instead.");
    return;
  }
  try {
    const bundle = walkBundle(walkEventId);
    const { walk, report, observations, opportunity, facility, documents } = bundle;
    crm.showToast("Building the site package…");
    const geojson = {
      type: "FeatureCollection",
      features: observations
        .filter((row) => row.geometry || Number.isFinite(Number(row.lat)))
        .map((row) => ({
          type: "Feature",
          geometry: row.geometry || { type: "Point", coordinates: [Number(row.lng), Number(row.lat)] },
          properties: { id: row.id, seq: row.seq, kind: row.kind, shapeKind: row.shapeKind || "", label: row.label, note: row.note, backgroundId: row.backgroundId || "aerial", accuracyM: row.accuracyM, areaSqFt: row.areaSqFt, lengthFt: row.lengthFt, color: row.color, photos: (row.photoDocumentIds || []).map((id) => `photos/${id}${extensionFor(documents.find((document) => document.id === id))}`), createdAt: row.createdAt, createdBy: row.createdBy },
        })),
    };
    const files = [
      { name: "observations.geojson", data: JSON.stringify(geojson, null, 2) },
      { name: "report.json", data: JSON.stringify({ walk, report, opportunity: opportunity ? { id: opportunity.id, name: opportunity.name, customerNeed: opportunity.customerNeed } : null, facility: facility ? { id: facility.id, name: facility.name, address: facilityAddress(facility), latitude: facility.latitude, longitude: facility.longitude } : null, observationsOnPlans: observations.filter((row) => row.backgroundId && row.backgroundId !== "aerial"), exportedAt: new Date().toISOString() }, null, 2) },
      { name: "README.txt", data: `Site walk package\n\nobservations.geojson — pins and shapes with WGS84 coordinates (pins on uploaded plans are in report.json with pixel x/y).\nreport.json — the walk report: check-in, sections, needs, measurements, backgrounds, reference-layer snapshot.\nphotos/ — every photo referenced by a pin or section, named by document id.\n\nOpen observations.geojson in QGIS or any GIS; the photo paths in each feature's properties are relative to this package.\n` },
    ];
    for (const document of documents) {
      try {
        const response = await fetch(photoUrl(document.id), { credentials: "same-origin" });
        if (response.ok) files.push({ name: `photos/${document.id}${extensionFor(document)}`, data: new Uint8Array(await response.arrayBuffer()) });
      } catch {
        // skip a photo that cannot be fetched
      }
    }
    for (const background of report.backgrounds || []) {
      if (!background.documentId) continue;
      try {
        const response = await fetch(photoUrl(background.documentId), { credentials: "same-origin" });
        if (response.ok) files.push({ name: `plans/${background.documentId}${extensionFor(documents.find((document) => document.id === background.documentId) || { mimeType: "image/jpeg" })}`, data: new Uint8Array(await response.arrayBuffer()) });
      } catch {
        // skip
      }
    }
    const blob = await buildZip(files);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `site-walk-${(opportunity?.name || walk.title || walk.id).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.zip`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(link.href);
      link.remove();
    }, 2000);
    crm.showToast(`Site package built: ${files.length} files.`);
  } catch (error) {
    crm.showToast(error.message || "Could not build the site package.");
  }
}

function extensionFor(document) {
  const map = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf" };
  return map[document?.mimeType] || (document?.fileName ? document.fileName.slice(document.fileName.lastIndexOf(".")) : ".jpg");
}

// ---------------------------------------------------------------------------------------------
// Office bridge (app.js reaches these without importing the module)
// ---------------------------------------------------------------------------------------------

// audience: "staff" (every photo and plan on the walk) or "customer" (customer-visible photos only).
export async function mintShareLink(reportId, { expiresInDays = 14, audience = "staff" } = {}) {
  return fieldRequest(`/api/field/walks/${encodeURIComponent(reportId)}/share`, { body: { expiresInDays, audience }, kind: "walk-share" });
}

export async function revokeShareLink(reportId, shareId) {
  return fieldRequest(`/api/field/walks/${encodeURIComponent(reportId)}/share/${encodeURIComponent(shareId)}`, { method: "DELETE", kind: "walk-share-revoke" });
}

window.fieldWalk = {
  exportWalkPdf,
  exportWalkZip,
  mintShareLink,
  revokeShareLink,
  buildWalkExportHtml: (walkEventId) => buildWalkExportHtml(walkBundle(walkEventId)),
  openWalk(walkEventId, tab = "brief") {
    crm.state.fieldWalkEventId = walkEventId;
    crm.state.fieldWalkTab = tab;
    crm.state.view = "field-walk";
    crm.render();
  },
  WALK_SECTIONS,
};

// ---------------------------------------------------------------------------------------------
// My Day (sales section)
// ---------------------------------------------------------------------------------------------

// The employee's sales role, resolved through the linked system user (employees carry no role).
function employeeHasSalesRole(employee) {
  const user = (crm.state.backend.systemUsers || []).find((row) => row.employeeId === employee.id && !row.deletedAt);
  const roles = [...(user?.roles || []), user?.role].filter(Boolean);
  return roles.some((role) => /sales|account manager/i.test(String(role)));
}

registerSalesHomeSection((employee) => {
  const walks = myWalks(employee.id);
  // Crew with no walks and no sales role get no sales section at all.
  if (!walks.length && !employeeHasSalesRole(employee)) return "";
  const today = walks.filter((item) => item.isToday || item.isPast);
  const upcoming = walks.filter((item) => !item.isToday && !item.isPast).slice(0, 6);
  const card = ({ event, isPast }) => {
    const opportunity = crm.findOpportunity(event.opportunityId);
    const facility = crm.findFacility(event.facilityId);
    const report = walkReportForEvent(event.id);
    return `
      <button class="field-card field-card--tap field-card--walk" type="button" data-field-action="walk-open" data-id="${attr(event.id)}">
        <div class="field-card-row"><strong>Site walk</strong><small>${esc(isPast ? crm.formatDate(event.date) : `${crm.formatDate(event.date)} ${event.startTime || ""}`)}</small></div>
        <span>${esc(opportunity?.name || event.title || "Site walk")}</span>
        ${facility ? `<small class="field-card-sub">${esc(facility.name)}${facilityAddress(facility) ? ` · ${esc(facilityAddress(facility))}` : ""}</small>` : ""}
        ${report?.checkIn && !report.completedAt ? `<small class="field-card-sub field-live">On site since ${esc(crm.formatShortTime(report.checkIn.at))}</small>` : isPast ? `<small class="field-card-sub field-warn">Not completed</small>` : ""}
      </button>`;
  };
  return `
    <h2 class="field-section-title">Site walks</h2>
    ${today.length ? `<div class="field-card-list">${today.map(card).join("")}</div>` : `<section class="field-card field-card--empty"><p>No site walk today.</p></section>`}
    ${upcoming.length ? `<h2 class="field-section-title">Upcoming walks</h2><div class="field-card-list">${upcoming.map(card).join("")}</div>` : ""}
    <h2 class="field-section-title">New</h2>
    <div class="field-new-row">
      <button class="field-card field-card--tap field-card--new" type="button" data-view="field-spill-intake"><strong>Spill call</strong><small>Project + dispatch job in one screen</small></button>
      <button class="field-card field-card--tap field-card--new" type="button" data-view="field-quick-lead"><strong>Quick lead</strong><small>Account, contact, opportunity</small></button>
    </div>`;
});

// ---------------------------------------------------------------------------------------------
// field-spill-intake — the Phase 16 dialog as a stepped phone form (same submit, same guards)
// ---------------------------------------------------------------------------------------------

const SPILL_STEPS = ["Caller", "Location", "Spill", "Agencies", "Mobilize"];

registerFieldRoute("field-spill-intake", {
  title: "Spill call",
  render: renderSpillIntake,
  after: afterSpillIntake,
});

function options(list, selected = "") {
  return list.map((option) => `<option ${option === selected ? "selected" : ""}>${esc(option)}</option>`).join("");
}

function renderSpillIntake() {
  const step = Number(crm.state.fieldSpillStep || 0);
  const templates = crm
    .getJobTypeTemplates()
    .filter((template) => template.isActive !== false)
    .sort((a, b) => (a.serviceCategory === "ER" ? 0 : 1) - (b.serviceCategory === "ER" ? 0 : 1) || String(a.name).localeCompare(String(b.name)));
  const defaultTemplate = templates.find((template) => template.serviceCategory === "ER")?.id || "";
  const accounts = crm.state.accounts || [];
  return `
    <form class="field-stepper" data-field-form="spill-intake" novalidate>
      <ol class="field-steps" aria-label="Steps">${SPILL_STEPS.map((label, index) => `<li class="${index === step ? "is-active" : index < step ? "is-done" : ""}"><button type="button" data-field-action="spill-step" data-step="${index}">${index + 1}</button><span>${esc(label)}</span></li>`).join("")}</ol>

      <section class="field-step" data-step="0" ${step === 0 ? "" : "hidden"}>
        <label class="field-label"><span>Caller name</span><input name="callerName" required maxlength="80" autocomplete="off" /></label>
        <label class="field-label"><span>Callback number</span><input name="callerPhone" type="tel" required maxlength="40" /></label>
        <label class="field-label"><span>Relationship to the site</span><select name="callerRelationship">${options(["Driver", "Facility contact", "Carrier dispatcher", "Agency", "Other"])}</select></label>
        <label class="field-label"><span>Existing account (leave blank if unknown)</span><select name="accountId"><option value="">No existing account — create one</option>${accounts.map((account) => `<option value="${attr(account.id)}">${esc(account.name)}</option>`).join("")}</select></label>
        <label class="field-label"><span>New account name (if none)</span><input name="newAccountName" maxlength="120" placeholder="Caller's company / carrier" /></label>
      </section>

      <section class="field-step" data-step="1" ${step === 1 ? "" : "hidden"}>
        <label class="field-label"><span>Site address</span><input name="addressText" required maxlength="160" placeholder="Street, city — or highway + mile marker" /></label>
        <label class="field-label"><span>GPS pin</span><input name="gpsPin" maxlength="120" placeholder="30.59, -97.59" inputmode="decimal" /></label>
        <button class="field-button field-button--secondary" type="button" data-field-action="spill-gps">Use my GPS</button>
        <small class="field-muted" data-spill-gps-hint>Standing at the spill? Tap to fill the pin from this phone.</small>
      </section>

      <section class="field-step" data-step="2" ${step === 2 ? "" : "hidden"}>
        <label class="field-label"><span>Material</span><input name="spillMaterial" maxlength="120" placeholder="Diesel, hydraulic oil, unknown…" /></label>
        <label class="field-label"><span>Estimated quantity</span><input name="spillQuantity" maxlength="60" placeholder="~50 gallons" /></label>
        <label class="field-label"><span>Surface</span><select name="spillSurface">${options(["Road", "Soil", "Both", "Water"])}</select></label>
        <label class="field-label"><span>Storm drain involvement</span><select name="stormDrainInvolved">${options(["Unknown", "No", "Yes"])}</select></label>
        <label class="field-label"><span>Off-road discharge</span><select name="offRoadDischarge">${options(["Unknown", "No", "Yes"])}</select></label>
        <label class="field-label"><span>Absorbent already deployed?</span><select name="absorbentDeployed">${options(["No", "Yes"])}</select></label>
        <label class="field-label"><span>Deployed by</span><input name="absorbentDeployedBy" maxlength="80" /></label>
      </section>

      <section class="field-step" data-step="3" ${step === 3 ? "" : "hidden"}>
        <label class="field-label"><span>Law enforcement</span><select name="lawEnforcementStatus">${options(["Not involved", "En route", "Involved", "On scene"])}</select></label>
        <label class="field-label"><span>Fire department</span><select name="fireDepartmentStatus">${options(["Not involved", "En route", "Involved", "On scene"])}</select></label>
        <label class="field-label"><span>Other emergency services</span><select name="otherEmergencyServicesStatus">${options(["Not involved", "En route", "Involved", "On scene"])}</select></label>
        <label class="field-label"><span>Agency / incident number</span><input name="agencyIncidentNumber" maxlength="80" /></label>
      </section>

      <section class="field-step" data-step="4" ${step === 4 ? "" : "hidden"}>
        <label class="field-label"><span>Has insurance?</span><select name="hasInsurance">${options(["No", "Yes"])}</select></label>
        <label class="field-label"><span>Filing an insurance claim?</span><select name="isInsuranceClaim">${options(["No", "Yes"])}</select></label>
        <label class="field-label"><span>Carrier</span><input name="insuranceCarrier" maxlength="80" /></label>
        <label class="field-label"><span>Policy number</span><input name="insurancePolicyNumber" maxlength="60" /></label>
        <label class="field-label"><span>Claim number</span><input name="insuranceClaimNumber" maxlength="60" /></label>
        <label class="field-check-row"><input type="checkbox" name="policyCopyOnFile" /><span>Copy of policy / declarations page captured</span></label>
        <label class="field-label"><span>Down payment amount ($)</span><input name="downPaymentAmount" type="number" min="0" step="0.01" inputmode="decimal" /></label>
        <label class="field-label"><span>Taken by</span><input name="downPaymentBy" maxlength="80" /></label>
        <label class="field-label"><span>Reference number</span><input name="downPaymentReference" maxlength="80" /></label>
        <p class="field-muted">No insurance claim needs a $15,000 down payment to mobilize, unless the Director of Sales overrides it.</p>
        <label class="field-check-row"><input type="checkbox" name="overrideMobilization" /><span>Override the mobilization block</span></label>
        <label class="field-label"><span>Overridden by</span><input name="overrideBy" maxlength="80" /></label>
        <label class="field-label"><span>Reason</span><input name="overrideReason" maxlength="160" /></label>
        <label class="field-label"><span>Work plan (job template)</span><select name="jobTypeTemplateId">${templates.map((template) => `<option value="${attr(template.id)}" ${template.id === defaultTemplate ? "selected" : ""}>${esc(template.name)} · ${esc(template.serviceCategory)}</option>`).join("")}<option value="">No template — generic four-step plan</option></select></label>
      </section>

      <div class="field-actions-row field-stepper-actions">
        ${step > 0 ? `<button class="field-button field-button--secondary" type="button" data-field-action="spill-step" data-step="${step - 1}">Back</button>` : `<button class="field-button field-button--ghost" type="button" data-view="field-home">Cancel</button>`}
        ${step < SPILL_STEPS.length - 1 ? `<button class="field-button" type="button" data-field-action="spill-step" data-step="${step + 1}">Next</button>` : `<button class="field-button" type="submit">Create project and dispatch job</button>`}
      </div>
    </form>`;
}

// The stepper keeps every field in the DOM (hidden steps), so typed values survive step changes
// without a re-render: step buttons toggle `hidden` in place.
function afterSpillIntake() {
  const form = document.querySelector('form[data-field-form="spill-intake"]');
  if (!form) return;
  const saved = crm.state.fieldSpillDraft || {};
  Object.entries(saved).forEach(([name, value]) => {
    const field = form.elements[name];
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value;
  });
}

function showSpillStep(step) {
  const form = document.querySelector('form[data-field-form="spill-intake"]');
  if (!form) return;
  const current = Number(crm.state.fieldSpillStep || 0);
  if (step > current) {
    const section = form.querySelector(`.field-step[data-step="${current}"]`);
    const invalid = [...section.querySelectorAll("input, select")].find((field) => !field.checkValidity());
    if (invalid) {
      invalid.reportValidity();
      return;
    }
  }
  crm.state.fieldSpillStep = step;
  form.querySelectorAll(".field-step").forEach((section) => {
    section.hidden = Number(section.dataset.step) !== step;
  });
  form.querySelectorAll(".field-steps li").forEach((item, index) => {
    item.classList.toggle("is-active", index === step);
    item.classList.toggle("is-done", index < step);
  });
  const actions = form.querySelector(".field-stepper-actions");
  actions.innerHTML = `
    ${step > 0 ? `<button class="field-button field-button--secondary" type="button" data-field-action="spill-step" data-step="${step - 1}">Back</button>` : `<button class="field-button field-button--ghost" type="button" data-view="field-home">Cancel</button>`}
    ${step < SPILL_STEPS.length - 1 ? `<button class="field-button" type="button" data-field-action="spill-step" data-step="${step + 1}">Next</button>` : `<button class="field-button" type="submit">Create project and dispatch job</button>`}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

registerFieldAction("spill-step", (button) => showSpillStep(Number(button.dataset.step || 0)));

registerFieldAction("spill-gps", (button) => {
  const form = button.closest("form");
  const hint = form.querySelector("[data-spill-gps-hint]");
  if (!navigator.geolocation) {
    hint.textContent = "This device has no GPS.";
    return;
  }
  hint.textContent = "Getting a fix…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      form.elements.gpsPin.value = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
      hint.textContent = `Pinned from this phone (±${Math.round(position.coords.accuracy || 0)} m).`;
    },
    (error) => {
      hint.textContent = error?.code === 1 ? "Location permission denied — type the pin instead." : "GPS unavailable — type the pin instead.";
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
  );
});

registerFieldForm("spill-intake", async (form) => {
  const required = [...form.querySelectorAll("input[required]")].find((field) => !field.value.trim());
  if (required) {
    const step = Number(required.closest(".field-step")?.dataset.step || 0);
    showSpillStep(step);
    required.reportValidity();
    return;
  }
  crm.state.fieldSpillStep = 0;
  crm.state.fieldSpillDraft = null;
  // submitEmergencyIntake owns the guards, the records and the navigation to the new project.
  await crm.submitEmergencyIntake(form);
});

// ---------------------------------------------------------------------------------------------
// field-quick-lead — account (lookup or new), contact, opportunity, GPS or address
// ---------------------------------------------------------------------------------------------

registerFieldRoute("field-quick-lead", {
  title: "Quick lead",
  render: renderQuickLead,
});

function renderQuickLead() {
  const accounts = crm.state.accounts || [];
  return `
    <form class="field-stepper" data-field-form="quick-lead">
      <h2 class="field-section-title">Who</h2>
      <label class="field-label"><span>Account</span><select name="accountId"><option value="">New account…</option>${accounts.map((account) => `<option value="${attr(account.id)}">${esc(account.name)}</option>`).join("")}</select></label>
      <label class="field-label"><span>New account name</span><input name="newAccountName" maxlength="120" placeholder="Company name" /></label>
      <label class="field-label"><span>Contact name</span><input name="contactName" maxlength="80" placeholder="Who you spoke with" /></label>
      <div class="field-inline-form">
        <input name="contactTitle" maxlength="80" placeholder="Title" />
        <input name="contactPhone" type="tel" maxlength="40" placeholder="Phone" />
      </div>
      <label class="field-label"><span>Email</span><input name="contactEmail" type="email" maxlength="120" /></label>

      <h2 class="field-section-title">What</h2>
      <label class="field-label"><span>Opportunity name</span><input name="name" required maxlength="140" placeholder="e.g. Fuel island stain — Round Rock yard" /></label>
      <label class="field-label"><span>Customer need</span><textarea name="customerNeed" rows="3" placeholder="What they told you, in their words (mic on the keyboard dictates)"></textarea></label>
      <label class="field-label"><span>Service type</span><select name="serviceType"><option value="">—</option>${options(["Emergency Response", "Remediation", "Sampling / Assessment", "Waste Disposal", "Industrial Cleaning", "Other"])}</select></label>
      <label class="field-label"><span>Rough value ($)</span><input name="value" type="number" min="0" step="100" inputmode="numeric" /></label>

      <h2 class="field-section-title">Where</h2>
      <label class="field-label"><span>Site address</span><input name="addressText" maxlength="160" placeholder="Creates a facility on the account" /></label>
      <label class="field-label"><span>GPS pin</span><input name="gpsPin" maxlength="120" placeholder="30.59, -97.59" inputmode="decimal" /></label>
      <button class="field-button field-button--secondary" type="button" data-field-action="lead-gps">Use my GPS</button>
      <small class="field-muted" data-lead-gps-hint></small>

      <div class="field-actions-row field-stepper-actions">
        <button class="field-button field-button--ghost" type="button" data-view="field-home">Cancel</button>
        <button class="field-button" type="submit">Save lead</button>
      </div>
    </form>`;
}

registerFieldAction("lead-gps", (button) => {
  const form = button.closest("form");
  const hint = form.querySelector("[data-lead-gps-hint]");
  if (!navigator.geolocation) {
    hint.textContent = "This device has no GPS.";
    return;
  }
  hint.textContent = "Getting a fix…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      form.elements.gpsPin.value = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
      hint.textContent = `Pinned from this phone (±${Math.round(position.coords.accuracy || 0)} m).`;
    },
    () => {
      hint.textContent = "GPS unavailable — type the pin or an address.";
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
  );
});

registerFieldForm("quick-lead", async (form) => {
  const data = new FormData(form);
  const get = (name) => (data.get(name) || "").toString().trim();
  const name = get("name");
  if (!name) {
    form.elements.name.reportValidity();
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  const now = new Date().toISOString();
  const employee = currentFieldEmployee();
  try {
    let account = get("accountId") ? crm.findAccount(get("accountId")) : null;
    if (!account) {
      const accountName = get("newAccountName") || (get("contactName") ? `${get("contactName")} (lead)` : name);
      account = crm.buildCoreAccountRecord({ id: crm.makeId("acct"), name: accountName, phone: get("contactPhone"), contact: get("contactName"), classification: "Prospect", accountType: "Prospect", owner: employee?.displayName || "Unassigned", isProvisional: true, createdAt: now, updatedAt: now });
      await saveFieldRecord("accounts", account);
    }
    let facilityId = "";
    const gps = crm.parseGpsPin(get("gpsPin"));
    if (get("addressText") || gps) {
      const facility = { id: crm.makeId("loc"), accountId: account.id, name: get("addressText") ? `Site — ${get("addressText")}` : `Site near ${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)}`, street1: get("addressText"), city: "", category: "Job Site / Field Location", badge: "Prospect", latitude: gps?.latitude ?? "", longitude: gps?.longitude ?? "", createdAt: now, updatedAt: now };
      await saveFieldRecord("facilities", facility);
      facilityId = facility.id;
    }
    const opportunityId = crm.makeId("opp");
    let contact = null;
    if (get("contactName")) {
      contact = crm.buildCoreContactRecord({ id: crm.makeId("cont"), accountId: account.id, name: get("contactName"), fullName: get("contactName"), title: get("contactTitle"), jobTitle: get("contactTitle"), phone: get("contactPhone"), businessPhone: get("contactPhone"), email: get("contactEmail"), opportunityIds: [opportunityId], notes: "Captured as a quick lead in the field.", owner: employee?.displayName || "Unassigned" });
      await saveFieldRecord("contacts", contact);
    }
    const opportunity = crm.buildCoreOpportunityRecord({
      id: opportunityId,
      accountId: account.id,
      facilityId,
      name,
      opportunityName: name,
      customerNeed: get("customerNeed"),
      serviceType: get("serviceType"),
      value: Number(get("value") || 0),
      amount: Number(get("value") || 0),
      stage: "Lead",
      dealStage: "Lead",
      status: "Open",
      owner: employee?.displayName || account.owner || "Unassigned",
      primaryContact: contact?.name || "",
      siteWalkStatus: "Incomplete",
      leadSource: "Field (quick lead)",
      createdAt: now,
      updatedAt: now,
    });
    await saveFieldRecord("opportunities", opportunity);
    if (facilityId) await saveFieldRecord("opportunityLocations", { id: crm.makeId("opp-location"), opportunityId, type: "Facility", facilityId, locationId: "", role: "Primary site", note: "", createdAt: now });
    if (gps) {
      const location = await saveFieldRecord("locations", { id: crm.makeId("location"), projectId: "", label: `Lead — ${name}`, latitude: gps.latitude, longitude: gps.longitude, assetTags: [], status: "Field ping", source: "Quick lead", locationType: "Lead", reportedByEmployeeId: employee?.id || "", lastPingAt: now });
      await saveFieldRecord("opportunityLocations", { id: crm.makeId("opp-location"), opportunityId, type: "Location", facilityId: "", locationId: location.id, role: "Where the lead was taken", note: "", createdAt: now });
    }
    await crm.refreshBackendState();
    crm.state.view = "field-home";
    crm.render();
    crm.showToast(`Lead saved: ${name} on ${account.name}.`);
  } catch (error) {
    submit.disabled = false;
    crm.showToast(error.message || "Lead could not be saved.");
  }
});
