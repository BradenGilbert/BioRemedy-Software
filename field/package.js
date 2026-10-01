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

export function isOnline() {
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
// `redactOnDone` (Phase 25 A.3b): body keys wiped from the stored row once the server has answered --
// the licence number of a queued ID scan sits in IndexedDB only until it replays, not for the 24 h a
// done row is kept for the outbox screen.
async function enqueueFieldCommand({ kind, url, method = "POST", headers = {}, body, blob, label, apply, redactOnDone }) {
  const clientCommandId = newCommandId();
  const row = {
    clientCommandId,
    kind: kind || "request",
    label: label || kind || "Field update",
    url,
    method,
    headers,
    body: body === undefined ? undefined : body,
    redactOnDone: Array.isArray(redactOnDone) && redactOnDone.length ? redactOnDone : undefined,
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
      // 2026-10-01: a done row is kept 24 h for the Sync screen, not to be sent again. Every drain used
      // to re-send it (harmless only where the server answers a repeated command id from its receipt;
      // the licence lookup keeps no receipt, so its redacted replay came back 400 "rejected").
      if (row.status === "done") continue;
      if (!isOnline()) break;
      row.status = "sending";
      await outboxPut(row);
      let sentResult;
      try {
        sentResult = await sendRow(row);
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
      // A done or rejected row is never sent again as it stands: drop what it must not keep.
      if (row.redactOnDone && (row.status === "done" || row.status === "rejected") && row.body && typeof row.body === "object") {
        const body = { ...row.body };
        row.redactOnDone.forEach((key) => delete body[key]);
        row.body = body;
        await outboxPut(row);
      }
      // 2026-10-01: a replayed command's answer, for the module that queued it (the forms' licence
      // lookup patches its submission with it). The body is the redacted one.
      if (row.status === "done") document.dispatchEvent(new CustomEvent("field:command-done", { detail: { kind: row.kind, clientCommandId: row.clientCommandId, body: row.body, result: sentResult } }));
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

// Upsert a server row into crm.state.backend[collection] by id -- what a successful online
// fieldRequest/enqueueFieldCommand's optimistic `apply` should both do, so a save doesn't leave
// crm.render() drawing from stale state until the next full refresh (item 1, 2026-09-28 IT report:
// a briefing saved online looked unsaved until a manual reload for exactly this reason).
export function mergeRow(collection, row) {
  if (!row || !row.id) return;
  const rows = crm.state.backend[collection] || [];
  const index = rows.findIndex((item) => item.id === row.id);
  if (index >= 0) rows[index] = { ...rows[index], ...row };
  else rows.push(row);
  crm.state.backend[collection] = rows;
}

// A field API call (JSON body). Offline (or on a network failure while "online"), queues it and
// returns null instead of a response — callers that need the server's echo (ids, computed fields)
// should not depend on the return value when offline; they should read from the optimistic apply.
// `mergeInto`: a collection name — the response row (online) or the request body (queued, unless
// `apply` is given explicitly) is upserted into crm.state.backend[mergeInto] by id.
export async function fieldRequest(url, { method = "POST", body, headers = {}, kind = "request", label, apply, mergeInto, redactOnDone } = {}) {
  const commandId = headers["X-Client-Command-Id"] || newCommandId();
  const finalHeaders = { "X-Client-Command-Id": commandId, ...headers };
  if (isOnline()) {
    try {
      const options = { method, headers: finalHeaders };
      if (body !== undefined) {
        options.headers["Content-Type"] = options.headers["Content-Type"] || "application/json";
        options.body = typeof body === "string" ? body : JSON.stringify(body);
      }
      const result = await crm.apiRequest(url, options);
      if (mergeInto && result) mergeRow(mergeInto, result);
      return result;
    } catch (error) {
      if (error?.status === 404) throw new Error(`The server does not have ${kind} yet (${url}).`);
      if (error?.status >= 400 && error?.status < 500) throw error; // a real rejection, not offline
      // A network-shaped failure while nominally online: fall through to queuing.
    }
  }
  const finalApply = apply || (mergeInto && body && typeof body === "object" ? () => mergeRow(mergeInto, body) : undefined);
  await enqueueFieldCommand({ kind, url, method, headers: finalHeaders, body, label, apply: finalApply, redactOnDone });
  return null;
}

// A plain record write from the field (goes through the outbox exactly like fieldRequest, applied
// optimistically to crm.state.backend so the screen shows it immediately).
// `queuedLastWriteWins` (Phase 25, 2026-09-29): a write queued offline is replayed without a version, so
// a server-side bump made meanwhile (a share link opened, say) cannot reject it. Only for records whose
// server-owned fields the server protects itself -- siteWalkReports (shares, completion) does.
export async function saveFieldRecord(collection, record, options = {}) {
  const { refresh = false, kind = "save", label, queuedLastWriteWins = false } = options;
  if (isOnline()) {
    try {
      return await crm.saveBackendRecord(collection, record, { refresh });
    } catch (error) {
      if (!(error?.status >= 500 || error?.status === undefined)) throw error; // real rejection (409, validation)
    }
  }
  const current = (crm.state.backend[collection] || []).find((row) => row.id === record.id);
  let body = current && current.version !== undefined ? { ...record, version: current.version } : record;
  if (queuedLastWriteWins) {
    const { version, ...rest } = body;
    body = rest;
  }
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
      // Phase 25 item 5 (2026-09-29): tells the server this upload was queued offline, so a record may
      // already reference the X-Document-Id it carries (see handleDocumentUpload).
      "X-Offline-Queued": "1",
    },
    blob: file,
    label: `Upload ${file.name || "file"}`,
  });
  const documentId = finalHeaders["X-Document-Id"];
  if (!documentId) return null;
  // With a client-chosen id the caller gets a stand-in `documents` row back (and so does the screen),
  // shaped like the server's; the outbox sends the real upload once the phone is online.
  rememberPendingUpload(documentId, file);
  const placeholder = pendingDocumentRow(documentId, file, finalHeaders);
  mergeRow("documents", placeholder);
  return placeholder;
}

function pendingDocumentRow(id, file, headers) {
  let caption = "";
  try {
    caption = decodeURIComponent(headers["X-Caption"] || "");
  } catch {
    caption = headers["X-Caption"] || "";
  }
  const groupId = headers["X-Group-Id"] || "";
  const previous = groupId ? (crm.state.backend.documents || []).filter((row) => (row.groupId || row.id) === groupId).sort((a, b) => Number(b.versionNumber || 1) - Number(a.versionNumber || 1))[0] : null;
  const now = new Date().toISOString();
  return {
    id,
    entityType: headers["X-Entity-Type"] || "",
    entityId: headers["X-Entity-Id"] || "",
    documentTypeId: headers["X-Document-Type"] || previous?.documentTypeId || "",
    fileName: file.name || "upload.png",
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size || 0,
    groupId: previous ? previous.groupId || previous.id : id,
    versionNumber: previous ? Number(previous.versionNumber || 1) + 1 : 1,
    visibility: headers["X-Visibility"] === "customer" ? "customer" : "internal",
    caption: caption || previous?.caption || "",
    uploadedAt: now,
    uploadedBy: crm.currentActorName ? crm.currentActorName() : "",
    deletedAt: "",
    pendingUpload: true,
  };
}

// Phase 25 item 5 (2026-09-29): a photo queued offline has a client-chosen document id (the
// X-Document-Id header) so a walk can reference it straight away; until the outbox sends it, the
// screens draw it from this in-memory object URL instead of /api/documents/<id>/view.
const pendingUploads = new Map();
export function rememberPendingUpload(documentId, blob) {
  if (!documentId || !blob || pendingUploads.has(documentId)) return;
  try {
    pendingUploads.set(documentId, URL.createObjectURL(blob));
  } catch {
    // no object URLs in this environment: the thumbnail just waits for the upload
  }
}
export function pendingUploadUrl(documentId) {
  return pendingUploads.get(documentId) || "";
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
      await applyRemovedJobs();
      return pkg;
    } catch (error) {
      if (error?.status !== 404) console.warn("field package fetch failed, falling back", error);
      // 404 (server not ready yet) or any other failure: fall back to the general refresh below.
    }
  }
  if (isOnline()) {
    try {
      await crm.refreshBackendState();
      await applyRemovedJobs();
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
  await applyRemovedJobs();
  return cached || null;
}

// ---------------------------------------------------------------------------------------------
// Phase 25 Wave F (2026-09-30): "Delete on device" -- a performed task removes its job from this phone
// ---------------------------------------------------------------------------------------------
//
// The server leaves such a job out of every field package once the task's save reaches it
// (server.mjs deviceRemovedJobIds). Until then -- offline, or a refresh racing the outbox -- the phone
// keeps its own list (in the fieldPackages store, key "removedJobIds") and applies it to the cached
// package, crm.state.backend and every refresh below. Office screens never read this list.
const REMOVED_JOBS_KEY = "removedJobIds";
let removedJobIds = null;

async function loadRemovedJobIds() {
  if (removedJobIds) return removedJobIds;
  try {
    const stored = await fieldTransaction("fieldPackages", "readonly", (store) => requestToPromise(store.get(REMOVED_JOBS_KEY)));
    removedJobIds = new Set(Array.isArray(stored) ? stored : []);
  } catch {
    removedJobIds = new Set();
  }
  return removedJobIds;
}

// Collections whose rows belong to one dispatch job (by jobId or dispatchJobId).
const JOB_CHILD_COLLECTIONS = ["jobSteps", "jobActions", "jobAssignments", "jobResources", "jobStatusEvents", "jobTaskAttachments", "jobFormSubmissions", "jobSafetyBriefings", "jobEquipmentUsage", "jobMileageEntries", "messages", "sampleRecords", "weatherSnapshots", "wasteRecords"];

function withoutJobs(backend, ids) {
  if (!backend || !ids?.size) return backend;
  if (Array.isArray(backend.dispatchJobs)) backend.dispatchJobs = backend.dispatchJobs.filter((row) => !ids.has(row.id));
  for (const collection of JOB_CHILD_COLLECTIONS) {
    if (Array.isArray(backend[collection])) backend[collection] = backend[collection].filter((row) => !ids.has(row.jobId) && !ids.has(row.dispatchJobId));
  }
  return backend;
}

export function isJobRemovedFromDevice(jobId) {
  return Boolean(removedJobIds && removedJobIds.has(jobId));
}

// A real field login (a sign-on link, or someone whose every role is Field Lead/Crew) -- not an office
// user previewing Front Line in the desktop simulator, whose state.backend is the office's own.
function isFieldLogin() {
  if (crm.state.session?.kind === "dispatch-link") return true;
  const roles = crm.currentRoles();
  return roles.length > 0 && roles.every((role) => role === "Field Lead" || role === "Crew");
}

export async function dropJobFromDevice(jobId) {
  if (!jobId) return;
  if (crm.state.frontlineSelectedJobId === jobId) {
    crm.state.frontlineSelectedJobId = "";
    if (String(crm.state.view || "").startsWith("field-")) crm.state.view = "field-home";
  }
  if (!isFieldLogin()) return;
  const ids = await loadRemovedJobIds();
  ids.add(jobId);
  try {
    await fieldTransaction("fieldPackages", "readwrite", (store) => requestToPromise(store.put([...ids], REMOVED_JOBS_KEY)));
    const cached = await fieldTransaction("fieldPackages", "readonly", (store) => requestToPromise(store.get("package")));
    if (cached) {
      withoutJobs(cached.backend || cached, new Set([jobId]));
      await fieldTransaction("fieldPackages", "readwrite", (store) => requestToPromise(store.put(cached, "package")));
    }
  } catch (error) {
    console.warn("could not update the cached package", error);
  }
  withoutJobs(crm.state.backend, new Set([jobId]));
}

// Applied after every package refresh (online or from the cache).
export async function applyRemovedJobs() {
  if (!isFieldLogin()) return;
  const ids = await loadRemovedJobIds();
  withoutJobs(crm.state.backend, ids);
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
