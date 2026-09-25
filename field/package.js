// Front Line 2 — package cache + outbox (Phase 21). FOUNDATION STUB (2026-09-25).
//
// W2 replaces the bodies below with the real thing: IndexedDB stores `fieldPackages`, `fieldOutbox`,
// `fieldTiles`, `fieldAreas`; `enqueueFieldCommand()` queues every field write and a drain loop
// replays them in order when the phone is back online; `renderSyncPill()` in index.js shows the
// queued count. The function names and signatures here are the contract the other field modules
// (job, walk, media, library) code against, so W2 must keep them.
//
// Until then every call goes straight to the server, which is exactly what the legacy screens do.
import * as crm from "../app.js";

// A client-side command id. Sent as `X-Client-Command-Id`; the server dedupes replays on it (W1).
export function newCommandId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// A field API call. `kind` is a short label for the outbox screen ("clock", "advance", "walk-complete",
// "upload", …). Returns the parsed JSON response.
export async function fieldRequest(url, { method = "POST", body, headers = {}, kind = "request" } = {}) {
  const commandId = headers["X-Client-Command-Id"] || newCommandId();
  const options = {
    method,
    headers: { "X-Client-Command-Id": commandId, ...headers },
  };
  if (body !== undefined) {
    options.headers["Content-Type"] = options.headers["Content-Type"] || "application/json";
    options.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  try {
    return await crm.apiRequest(url, options);
  } catch (error) {
    if (error?.status === 404) {
      throw new Error(`The server does not have ${kind} yet (${url}).`);
    }
    throw error;
  }
}

// A plain record write from the field. Same semantics as saveBackendRecord; W2 routes it through
// the outbox. `refresh: false` keeps the screen from re-rendering twice.
export async function saveFieldRecord(collection, record, options = {}) {
  return crm.saveBackendRecord(collection, record, { refresh: false, ...options });
}

// Upload a photo/file from the field (jobTaskAttachments or documents). W2 queues the blob.
export async function uploadFieldFile(url, file, headers = {}) {
  return crm.uploadRawFile(url, file, { "X-Client-Command-Id": newCommandId(), ...headers });
}

// Sync state for the pill and the outbox screen. W2 fills these from the stores.
export function outboxSummary() {
  return { online: crm.state.online !== false, queued: 0, failed: 0, items: [] };
}

export async function drainOutbox() {
  return { drained: 0 };
}

export async function refreshFieldPackage() {
  // W2: GET /api/field/package → fieldPackages. Until then the app state is the package.
  await crm.refreshBackendState();
}
