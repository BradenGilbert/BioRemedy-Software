// Front Line 2 — package cache + offline outbox (Phase 21, W2, 2026-09-25).
//
// Device-scoped state only (per CLAUDE.md): a second IndexedDB, `environmental-crm-field`, separate
// from app.js's `environmental-crm-foundation` (syncQueue/settings). Stores:
//   fieldPackages  (key)              — the last GET /api/field/package response, for offline startup
//   fieldOutbox    (clientCommandId)  — queued/sending/failed/rejected/done writes, replayed in order
//   fieldTiles     (key)              — empty here; W3 (maps) owns writes to it
//   fieldAreas     (id)               — empty here; W3 (maps) owns writes to it
//
// Every other field module goes through fieldRequest/saveFieldRecord/uploadFieldFile so a save made
// with the phone offline is queued instead of thrown away, and replays automatically once the phone
// is back online. `outboxSummary()` + the `field:sync` CustomEvent on `document` drive the sync pill
// (field/index.js) and the field-outbox screen (below).
import * as crm from "../app.js";

const DB_NAME = "environmental-crm-field";
const DB_VERSION = 1;
const MAX_ATTEMPTS = 8;
const DONE_RETENTION_MS = 24 * 60 * 60 * 1000;

let dbPromise = null;
function openFieldDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("fieldPackages")) db.createObjectStore("fieldPackages");
      if (!db.objectStoreNames.contains("fieldOutbox")) db.createObjectStore("fieldOutbox", { keyPath: "clientCommandId" });
      if (!db.objectStoreNames.contains("fieldTiles")) db.createObjectStore("fieldTiles");
      if (!db.objectStoreNames.contains("fieldAreas")) db.createObjectStore("fieldAreas", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function fieldTransaction(storeName, mode, run) {
  const db = await openFieldDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    Promise.resolve(run(store))
      .then((value) => {
        result = value;
      })
      .catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function outboxGetAll() {
  return fieldTransaction("fieldOutbox", "readonly", (store) => requestToPromise(store.getAll()));
}

async function outboxPut(row) {
  return fieldTransaction("fieldOutbox", "readwrite", (store) => requestToPromise(store.put(row)));
}

async function outboxDelete(clientCommandId) {
  return fieldTransaction("fieldOutbox", "readwrite", (store) => requestToPromise(store.delete(clientCommandId)));
}

// ---------------------------------------------------------------------------------------------
// Command ids
// ---------------------------------------------------------------------------------------------

export function newCommandId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------------------------
// Sync state + the field:sync event
// ---------------------------------------------------------------------------------------------

let lastSummary = { online: true, queued: 0, failed: 0, items: [] };

function isOnline() {
  return crm.state.online !== false && navigator.onLine !== false;
}

async function computeSummary() {
  const rows = (await outboxGetAll()).sort((a, b) => a.createdAt - b.createdAt);
  const items = rows.map((row) => ({
    clientCommandId: row.clientCommandId,
    kind: row.kind,
    label: row.label,
    status: row.status,
    createdAt: row.createdAt,
    lastError: row.lastError || "",
    hasBlob: Boolean(row.blob),
  }));
  lastSummary = {
    online: isOnline(),
    queued: rows.filter((row) => row.status === "queued" || row.status === "sending").length,
    failed: rows.filter((row) => row.status === "failed" || row.status === "rejected").length,
    items,
  };
  return lastSummary;
}

async function notifySync() {
  await computeSummary();
  document.dispatchEvent(new CustomEvent("field:sync", { detail: lastSummary }));
}

export function outboxSummary() {
  return lastSummary;
}

// ---------------------------------------------------------------------------------------------
// The blob → data URL round trip. IndexedDB structured-clones Blobs fine in every modern browser,
// so blobs are stored as-is; this helper only exists for callers that want an object URL to render
// a thumbnail from a queued row.
// ---------------------------------------------------------------------------------------------

export function outboxBlobUrl(row) {
  if (!row?.blob) return "";
  return URL.createObjectURL(row.blob);
}

export async function outboxItem(clientCommandId) {
  const rows = await outboxGetAll();
  return rows.find((row) => row.clientCommandId === clientCommandId) || null;
}

// ---------------------------------------------------------------------------------------------
// Enqueue + drain
// ---------------------------------------------------------------------------------------------

// `apply` (optional) is called once, synchronously, so a queued write can be reflected in
// crm.state.backend immediately (optimistic UI) even though the network call hasn't happened yet.
async function enqueueFieldCommand({ kind, url, method = "POST", headers = {}, body, blob, label, apply }) {
  const clientCommandId = newCommandId();
  const row = {
    clientCommandId,
    kind: kind || "request",
    label: label || kind || "Field update",
    url,
    method,
    headers,
    body: body === undefined ? undefined : body,
    blob: blob || undefined,
    createdAt: Date.now(),
    attempts: 0,
    lastError: "",
    status: "queued",
  };
  await outboxPut(row);
  if (typeof apply === "function") {
    try {
      apply();
    } catch (error) {
      // Optimistic apply failures never block queuing the write itself.
      console.error("field outbox optimistic apply failed", error);
    }
  }
  await notifySync();
  if (isOnline()) drainOutbox();
  return clientCommandId;
}

async function sendRow(row) {
  const headers = { "X-Client-Command-Id": row.clientCommandId, ...(row.headers || {}) };
  let body = row.body;
  if (row.blob) {
    body = row.blob;
  } else if (body !== undefined && typeof body !== "string") {
    body = JSON.stringify(body);
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }
  return crm.apiRequest(row.url, { method: row.method || "POST", headers, body });
}

let draining = false;
export async function drainOutbox() {
  if (draining) return { drained: 0 };
  draining = true;
  let drained = 0;
  try {
    if (!isOnline()) return { drained: 0 };
    const rows = (await outboxGetAll()).sort((a, b) => a.createdAt - b.createdAt);
    for (const row of rows) {
      if (row.status === "rejected") continue; // kept visible until the user discards/retries it
      if (!isOnline()) break;
      row.status = "sending";
      await outboxPut(row);
      try {
        await sendRow(row);
        row.status = "done";
        row.doneAt = Date.now();
        await outboxPut(row);
        drained += 1;
      } catch (error) {
        const status = error?.status;
        if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          row.status = "rejected";
          row.lastError = status === 409 ? "Conflict — this record changed elsewhere." : error?.payload?.error || error?.message || `Rejected (${status})`;
        } else {
          row.attempts = (row.attempts || 0) + 1;
          row.lastError = error?.message || "Network error";
          row.status = row.attempts >= MAX_ATTEMPTS ? "failed" : "queued";
        }
        await outboxPut(row);
      }
      await notifySync();
    }
    // Sweep done rows older than 24h.
    const cutoff = Date.now() - DONE_RETENTION_MS;
    const all = await outboxGetAll();
    for (const row of all) {
      if (row.status === "done" && row.doneAt && row.doneAt < cutoff) await outboxDelete(row.clientCommandId);
    }
  } finally {
    draining = false;
    await notifySync();
  }
  return { drained };
}

export async function retryOutboxItem(clientCommandId) {
  const row = await outboxItem(clientCommandId);
  if (!row) return;
  row.status = "queued";
  row.lastError = "";
  await outboxPut(row);
  await notifySync();
  if (isOnline()) drainOutbox();
}

export async function discardOutboxItem(clientCommandId) {
  await outboxDelete(clientCommandId);
  await notifySync();
}

// ---------------------------------------------------------------------------------------------
// The three functions every other field module writes through
// ---------------------------------------------------------------------------------------------

// A field API call (JSON body). Offline (or on a network failure while "online"), queues it and
// returns null instead of a response — callers that need the server's echo (ids, computed fields)
// should not depend on the return value when offline; they should read from the optimistic apply.
export async function fieldRequest(url, { method = "POST", body, headers = {}, kind = "request", label, apply } = {}) {
  const commandId = headers["X-Client-Command-Id"] || newCommandId();
  const finalHeaders = { "X-Client-Command-Id": commandId, ...headers };
  if (isOnline()) {
    try {
      const options = { method, headers: finalHeaders };
      if (body !== undefined) {
        options.headers["Content-Type"] = options.headers["Content-Type"] || "application/json";
        options.body = typeof body === "string" ? body : JSON.stringify(body);
      }
      return await crm.apiRequest(url, options);
    } catch (error) {
      if (error?.status === 404) throw new Error(`The server does not have ${kind} yet (${url}).`);
      if (error?.status >= 400 && error?.status < 500) throw error; // a real rejection, not offline
      // A network-shaped failure while nominally online: fall through to queuing.
    }
  }
  await enqueueFieldCommand({ kind, url, method, headers: finalHeaders, body, label, apply });
  return null;
}

// A plain record write from the field (goes through the outbox exactly like fieldRequest, applied
// optimistically to crm.state.backend so the screen shows it immediately).
export async function saveFieldRecord(collection, record, options = {}) {
  const { refresh = false, kind = "save", label } = options;
  if (isOnline()) {
    try {
      return await crm.saveBackendRecord(collection, record, { refresh });
    } catch (error) {
      if (!(error?.status >= 500 || error?.status === undefined)) throw error; // real rejection (409, validation)
    }
  }
  const current = (crm.state.backend[collection] || []).find((row) => row.id === record.id);
  const body = current && current.version !== undefined ? { ...record, version: current.version } : record;
  await enqueueFieldCommand({
    kind,
    url: `/api/backend/${encodeURIComponent(collection)}`,
    method: "POST",
    body,
    label: label || `${collection} save`,
    apply: () => {
      const rows = crm.state.backend[collection] || [];
      const existingIndex = rows.findIndex((row) => row.id === record.id);
      const merged = { ...(existingIndex >= 0 ? rows[existingIndex] : {}), ...record };
      if (existingIndex >= 0) rows[existingIndex] = merged;
      else rows.push(merged);
      crm.state.backend[collection] = rows;
    },
  });
  return record;
}

// Upload a photo/file from the field. Offline, the blob itself is queued in the outbox row and sent
// (in order, after any writes that reference it) once the phone is back online.
export async function uploadFieldFile(url, file, headers = {}) {
  const commandId = headers["X-Client-Command-Id"] || newCommandId();
  const finalHeaders = { "X-Client-Command-Id": commandId, ...headers };
  if (isOnline()) {
    try {
      return await crm.uploadRawFile(url, file, finalHeaders);
    } catch (error) {
      if (error?.status >= 400 && error?.status < 500) throw error;
    }
  }
  await enqueueFieldCommand({
    kind: "upload",
    url,
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name || "upload.png"),
      ...finalHeaders,
    },
    blob: file,
    label: `Upload ${file.name || "file"}`,
  });
  return null;
}

// ---------------------------------------------------------------------------------------------
// Package refresh + offline startup
// ---------------------------------------------------------------------------------------------

// Roles whose sessions may preview a field package as a chosen employee (the desktop simulator).
const PACKAGE_PREVIEW_ROLES = ["Admin", "Office Manager", "Operations Manager", "Scheduler", "Field Lead", "Crew"];

export async function refreshFieldPackage() {
  const employeeId = crm.state.frontlineSession?.employeeId || "";
  const isLinkSession = crm.state.session?.kind === "dispatch-link";
  const canFetchPackage = isLinkSession || crm.currentRoles().some((role) => PACKAGE_PREVIEW_ROLES.includes(role));
  if (isOnline() && canFetchPackage) {
    try {
      // An office session previewing the simulator passes the picked employee; a real field
      // session is projected as itself and the server ignores the parameter.
      const query = employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : "";
      const pkg = await crm.apiRequest(`/api/field/package${query}`, { method: "GET" });
      await fieldTransaction("fieldPackages", "readwrite", (store) => requestToPromise(store.put({ ...pkg, fetchedAt: Date.now() }, "package")));
      if (pkg?.backend) Object.assign(crm.state.backend, pkg.backend);
      return pkg;
    } catch (error) {
      if (error?.status !== 404) console.warn("field package fetch failed, falling back", error);
      // 404 (server not ready yet) or any other failure: fall back to the general refresh below.
    }
  }
  if (isOnline()) {
    try {
      await crm.refreshBackendState();
      await fieldTransaction("fieldPackages", "readwrite", (store) =>
        requestToPromise(store.put({ backend: crm.state.backend, fetchedAt: Date.now() }, "package")),
      );
      return null;
    } catch (error) {
      console.warn("field package refresh failed", error);
    }
  }
  // Offline: load whatever was cached last time into state.backend so screens render.
  const cached = await fieldTransaction("fieldPackages", "readonly", (store) => requestToPromise(store.get("package")));
  if (cached?.backend) Object.assign(crm.state.backend, cached.backend);
  return cached || null;
}

// ---------------------------------------------------------------------------------------------
// Wiring: online/offline events + a periodic drain
// ---------------------------------------------------------------------------------------------

let wired = false;
export function wireFieldSync() {
  if (wired) return;
  wired = true;
  window.addEventListener("online", () => {
    drainOutbox();
  });
  window.addEventListener("offline", () => {
    notifySync();
  });
  setInterval(() => {
    if (isOnline()) drainOutbox();
  }, 30000);
  notifySync();
  // Test hook (see scripts/smoke-browser.py's offline capture check).
  window.fieldPackage = { outboxSummary, drainOutbox, refreshFieldPackage, retryOutboxItem, discardOutboxItem };
}

wireFieldSync();
