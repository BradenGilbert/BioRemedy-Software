// Front Line 2 — Manuals & Training library (Phase 21, W4, 2026-09-25).
//
// Five shelves (manuals, safety, sds, tutorials, resources) built from `libraryItems`. "Required for
// you" reads the signed-in employee's role against `requiredForRoles` and offers Acknowledge, which
// writes a `libraryAcknowledgements` row. Items with `pinnedOffline` are prefetched into the Cache
// API so they open without a network round trip.
import * as crm from "../app.js";
import { registerFieldRoute, registerFieldAction, currentFieldEmployee } from "./index.js";
import { saveFieldRecord } from "./package.js";

registerFieldRoute("field-library", { title: "Manuals & Training", render: renderLibrary, after: afterLibraryRender });

const SHELVES = [
  { key: "manuals", label: "Manuals" },
  { key: "safety", label: "Safety" },
  { key: "sds", label: "SDS" },
  { key: "tutorials", label: "Tutorials" },
  { key: "resources", label: "Resources" },
];

function libraryItems() {
  return crm.liveRows(crm.state.backend.libraryItems).filter((item) => item.isActive !== false);
}

function acknowledgements() {
  return crm.liveRows(crm.state.backend.libraryAcknowledgements);
}

function itemsForShelf(shelf) {
  return libraryItems().filter((item) => item.shelf === shelf);
}

function employeeRoles(employee) {
  if (!employee) return [];
  const user = crm.liveRows(crm.state.backend.systemUsers).find((item) => item.employeeId === employee.id);
  if (!user) return [];
  return (Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role]).filter(Boolean);
}

function isRequiredFor(item, employee) {
  const roles = employeeRoles(employee);
  return (item.requiredForRoles || []).some((role) => roles.includes(role));
}

function ackFor(itemId, employeeId) {
  return acknowledgements()
    .filter((ack) => ack.libraryItemId === itemId && ack.employeeId === employeeId)
    .sort((a, b) => String(b.acknowledgedAt).localeCompare(String(a.acknowledgedAt)))[0] || null;
}

function isAcknowledgedCurrent(item, employeeId) {
  const ack = ackFor(item.id, employeeId);
  if (!ack) return false;
  if (Number(ack.itemVersion || 1) < Number(item.version || 1)) return false;
  if (item.renewalMonths) {
    const due = new Date(ack.acknowledgedAt);
    due.setMonth(due.getMonth() + Number(item.renewalMonths));
    if (due < new Date()) return false;
  }
  return true;
}

function renderLibrary() {
  const employee = currentFieldEmployee();
  const shelf = crm.state.fieldLibraryShelf || "manuals";
  const required = employee ? libraryItems().filter((item) => isRequiredFor(item, employee) && !isAcknowledgedCurrent(item, employee.id)) : [];
  const shelfItems = itemsForShelf(shelf);
  return `
    ${required.length ? `
      <h2 class="field-section-title">Required for you</h2>
      <div class="field-card-list">${required.map((item) => renderLibraryCard(item, employee, true)).join("")}</div>
    ` : ""}
    <h2 class="field-section-title">Shelves</h2>
    <div class="field-tabs field-tabs--dense" role="tablist">
      ${SHELVES.map((entry) => `<button class="field-tab ${entry.key === shelf ? "is-active" : ""}" type="button" role="tab" aria-selected="${entry.key === shelf}" data-field-action="library-shelf" data-shelf="${crm.escapeAttribute(entry.key)}">${crm.escapeHtml(entry.label)}</button>`).join("")}
    </div>
    ${shelf === "sds" ? `
      <label class="field-search">
        <input type="search" placeholder="Search safety data sheets" data-library-search />
      </label>
    ` : ""}
    ${shelf === "safety" ? `<button class="field-button field-button--secondary" type="button" data-field-action="library-erg">Emergency Response Guidebook lookup</button>` : ""}
    <div class="field-card-list" data-library-list>
      ${shelfItems.map((item) => renderLibraryCard(item, employee, false)).join("") || `<section class="field-card field-card--empty"><p>Nothing on this shelf yet.</p></section>`}
    </div>
  `;
}

function renderLibraryCard(item, employee, requiredCard) {
  const current = employee ? isAcknowledgedCurrent(item, employee.id) : false;
  const openHref = item.documentId ? `/api/documents/${encodeURIComponent(item.documentId)}/view` : item.url || "#";
  return `
    <section class="field-card ${requiredCard && !current ? "field-card--alert" : ""}">
      <div class="field-card-row"><strong>${crm.escapeHtml(item.title)}</strong>${item.category ? `<small>${crm.escapeHtml(item.category)}</small>` : ""}</div>
      <div class="field-card-row">
        <a class="field-button field-button--small" href="${crm.escapeAttribute(openHref)}" target="_blank" rel="noopener">Open</a>
        ${employee && requiredCard ? `<button class="field-button field-button--small ${current ? "field-button--ghost" : ""}" type="button" data-field-action="library-ack" data-id="${crm.escapeAttribute(item.id)}">${current ? "Acknowledged" : "Acknowledge"}</button>` : ""}
        ${item.pinnedOffline ? `<small class="field-card-sub">Pinned offline</small>` : ""}
      </div>
    </section>
  `;
}

registerFieldAction("library-shelf", (button) => {
  crm.state.fieldLibraryShelf = button.dataset.shelf;
  crm.render();
});

registerFieldAction("library-ack", async (button) => {
  const employee = currentFieldEmployee();
  if (!employee) return;
  const item = libraryItems().find((entry) => entry.id === button.dataset.id);
  if (!item) return;
  await saveFieldRecord("libraryAcknowledgements", {
    employeeId: employee.id,
    libraryItemId: item.id,
    itemVersion: Number(item.version || 1),
    acknowledgedAt: new Date().toISOString(),
  });
  await crm.refreshBackendState();
  crm.render();
  crm.showToast(`${item.title} acknowledged.`);
});

registerFieldAction("library-erg", () => {
  window.fieldMedia?.openErgLookup?.({});
});

function afterLibraryRender() {
  const search = document.querySelector("[data-library-search]");
  if (search) {
    search.addEventListener("input", () => {
      const query = search.value.trim().toLowerCase();
      const list = document.querySelector("[data-library-list]");
      if (!list) return;
      const employee = currentFieldEmployee();
      list.innerHTML =
        itemsForShelf("sds")
          .filter((item) => !query || item.title.toLowerCase().includes(query) || (item.category || "").toLowerCase().includes(query))
          .map((item) => renderLibraryCard(item, employee, false))
          .join("") || `<section class="field-card field-card--empty"><p>No matches.</p></section>`;
    });
  }
  prefetchPinnedItems();
}

let prefetchStarted = false;
async function prefetchPinnedItems() {
  if (prefetchStarted || !("caches" in window)) return;
  prefetchStarted = true;
  try {
    const cache = await caches.open("field-library");
    const pinned = libraryItems().filter((item) => item.pinnedOffline && item.documentId);
    await Promise.all(
      pinned.map((item) =>
        cache.add(`/api/documents/${encodeURIComponent(item.documentId)}/view`).catch(() => {
          // best effort — offline or the document may not exist yet
        }),
      ),
    );
  } catch {
    // Cache API unavailable (private browsing, etc.) — the shelf still works online.
  }
}
