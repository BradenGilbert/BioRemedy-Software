// Front Line 2 — media capture (Phase 21, W4, 2026-09-25).
//
// The shared image-markup tool (photo markup, satellite site sketches, the IT-messages screenshot
// annotator), video capture with a poster frame, "add a 3D scan", the measurements form (including a
// GPS-walked perimeter), and the ERG lookup. Everything here is DOM-independent of any one caller:
// job pages, walk pages, and the IT-messages dialog all open the same dialogs.
//
// Exposed to the rest of the app (and to app.js, which cannot import this module at the top level
// because the app.js <-> field/*.js graph is circular) on `window.fieldMedia`.
import * as crm from "../app.js";
import { fieldRequest, saveFieldRecord, uploadFieldFile } from "./package.js";
import { isPhoneSurface } from "./index.js";

const COLORS = { red: "#e11d48", orange: "#f97316", yellow: "#eab308", blue: "#2563eb" };
const MARKUP_TOOLS = ["pen", "box", "arrow", "circle", "text", "scale"];

// ================================================================================================
// Image markup
// ================================================================================================

const markupState = {
  wired: false,
  image: null,
  strokes: [],
  current: null,
  tool: "pen",
  color: "red",
  opts: null,
  resolve: null,
  sourceDocument: null,
};

function markupDialog() {
  return document.querySelector("#imageMarkupDialog");
}

// source: a File/Blob, a `documents` record (has `.id`/`.fileName`), an <img>/<canvas>, or an image URL.
// opts: { onSave, entityType, entityId, documentType (a documentTypes *code*, e.g. "job-photo"),
//         groupId, caption, title, upload (default true when entityType+entityId given) }
export function openImageMarkup(source, opts = {}) {
  return new Promise((resolve) => {
    wireMarkupDialog();
    const dialog = markupDialog();
    if (!dialog) {
      resolve(null);
      return;
    }
    markupState.opts = opts;
    markupState.resolve = resolve;
    markupState.sourceDocument = source && typeof source === "object" && source.id && "fileName" in source ? source : null;
    dialog.classList.toggle("field-markup", isPhoneSurface());
    dialog.querySelector("[data-markup-title]").textContent = opts.title || "Mark up this photo";
    dialog.querySelector("[data-markup-caption]").value = opts.caption || markupState.sourceDocument?.caption || "";
    resolveMarkupSource(source)
      .then(({ image, priorStrokes }) => {
        setMarkupImage(image, priorStrokes);
        dialog.showModal();
      })
      .catch((error) => {
        crm.showToast(error?.message || "Could not load that image.");
        resolve(null);
      });
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That file could not be read as an image."));
    image.src = src;
  });
}

function safeParseMarkup(json) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function resolveMarkupSource(source) {
  if (source instanceof HTMLImageElement) return { image: source, priorStrokes: null };
  if (source instanceof HTMLCanvasElement) return { image: await loadImage(source.toDataURL("image/png")), priorStrokes: null };
  if (typeof source === "string") return { image: await loadImage(source), priorStrokes: null };
  if (source instanceof Blob) return { image: await loadImage(URL.createObjectURL(source)), priorStrokes: null };
  if (source && typeof source === "object" && source.id && "fileName" in source) {
    const image = await loadImage(`/api/documents/${encodeURIComponent(source.id)}/view`);
    return { image, priorStrokes: safeParseMarkup(source.markup) };
  }
  throw new Error("Unrecognized image source.");
}

function setMarkupImage(image, priorStrokes) {
  const dialog = markupDialog();
  const canvas = dialog.querySelector("[data-markup-canvas]");
  markupState.image = image;
  markupState.strokes = priorStrokes ? structuredClone(priorStrokes) : [];
  markupState.current = null;
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, 1600 / Math.max(1, naturalWidth));
  canvas.width = Math.round(naturalWidth * scale);
  canvas.height = Math.round(naturalHeight * scale);
  setMarkupTool(markupState.tool);
  setMarkupColor(markupState.color);
  redrawMarkup();
}

function setMarkupTool(tool) {
  markupState.tool = MARKUP_TOOLS.includes(tool) ? tool : "pen";
  markupDialog()
    ?.querySelectorAll("[data-field-action='markup-tool']")
    .forEach((button) => button.classList.toggle("active", button.dataset.tool === markupState.tool));
}

function setMarkupColor(color) {
  markupState.color = COLORS[color] ? color : "red";
  markupDialog()
    ?.querySelectorAll("[data-field-action='markup-color']")
    .forEach((button) => button.classList.toggle("active", button.dataset.color === markupState.color));
}

function redrawMarkup() {
  const dialog = markupDialog();
  const canvas = dialog?.querySelector("[data-markup-canvas]");
  if (!canvas || !markupState.image) return;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(markupState.image, 0, 0, canvas.width, canvas.height);
  const baseWidth = Math.max(3, Math.round(canvas.width / 280));
  for (const stroke of [...markupState.strokes, ...(markupState.current ? [markupState.current] : [])]) {
    drawStroke(context, stroke, baseWidth);
  }
}

function drawStroke(context, stroke, baseWidth) {
  const color = COLORS[stroke.color] || COLORS.red;
  context.lineWidth = baseWidth;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (stroke.tool === "pen") {
    context.beginPath();
    (stroke.points || []).forEach((p, index) => (index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)));
    context.stroke();
  } else if (stroke.tool === "box") {
    context.strokeRect(Math.min(stroke.start.x, stroke.end.x), Math.min(stroke.start.y, stroke.end.y), Math.abs(stroke.end.x - stroke.start.x), Math.abs(stroke.end.y - stroke.start.y));
  } else if (stroke.tool === "circle") {
    const radius = Math.hypot(stroke.end.x - stroke.start.x, stroke.end.y - stroke.start.y);
    context.beginPath();
    context.arc(stroke.start.x, stroke.start.y, radius, 0, Math.PI * 2);
    context.stroke();
  } else if (stroke.tool === "arrow") {
    const { start, end } = stroke;
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = baseWidth * 5;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
    context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();
  } else if (stroke.tool === "text" || stroke.tool === "scale") {
    const fontSize = Math.max(16, Math.round(context.canvas.width / 32));
    context.font = `${stroke.tool === "scale" ? "600" : "700"} ${fontSize}px sans-serif`;
    const label = stroke.tool === "scale" ? `≈ ${stroke.text}` : stroke.text;
    const maxWidth = Math.max(120, context.canvas.width - stroke.x - 16);
    const lines = wrapCanvasText(context, label, maxWidth);
    const lineHeight = fontSize + 6;
    const widest = Math.max(...lines.map((line) => context.measureText(line).width));
    context.fillStyle = "rgba(255,255,255,0.85)";
    context.fillRect(stroke.x - 4, stroke.y - fontSize, widest + 8, lineHeight * lines.length + 4);
    context.fillStyle = color;
    context.textBaseline = "alphabetic";
    lines.forEach((line, index) => context.fillText(line, stroke.x, stroke.y + index * lineHeight));
  }
}

// Breaks `text` into lines no wider than `maxWidth` at this canvas's current font, breaking on
// spaces. A single word wider than maxWidth is kept whole rather than broken mid-word.
function wrapCanvasText(context, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function wireMarkupDialog() {
  if (markupState.wired) return;
  const dialog = markupDialog();
  if (!dialog) return;
  markupState.wired = true;
  const canvas = dialog.querySelector("[data-markup-canvas]");
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) * canvas.width) / rect.width, y: ((event.clientY - rect.top) * canvas.height) / rect.height };
  };
  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (event) => {
    if (!markupState.image) return;
    event.preventDefault();
    const p = point(event);
    if (markupState.tool === "text" || markupState.tool === "scale") {
      const text = window.prompt(markupState.tool === "scale" ? "Distance (e.g. 3 ft)" : "Label text");
      if (text && text.trim()) {
        markupState.strokes.push({ tool: markupState.tool, color: markupState.color, x: p.x, y: p.y, text: text.trim().slice(0, 200) });
        redrawMarkup();
      }
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    markupState.current = { tool: markupState.tool, color: markupState.color, points: [p], start: p, end: p };
    redrawMarkup();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!markupState.current) return;
    event.preventDefault();
    const p = point(event);
    if (markupState.current.tool === "pen") markupState.current.points.push(p);
    markupState.current.end = p;
    redrawMarkup();
  });
  const finish = (event) => {
    if (!markupState.current) return;
    event.preventDefault();
    const stroke = markupState.current;
    markupState.current = null;
    const moved = Math.hypot(stroke.end.x - stroke.start.x, stroke.end.y - stroke.start.y) > 2 || stroke.points.length > 2;
    if (moved) markupState.strokes.push(stroke);
    redrawMarkup();
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);

  dialog.querySelectorAll("[data-field-action='markup-tool']").forEach((button) => button.addEventListener("click", () => setMarkupTool(button.dataset.tool)));
  dialog.querySelectorAll("[data-field-action='markup-color']").forEach((button) => button.addEventListener("click", () => setMarkupColor(button.dataset.color)));
  dialog.querySelector("[data-field-action='markup-undo']").addEventListener("click", () => {
    markupState.strokes.pop();
    redrawMarkup();
  });
  dialog.querySelector("[data-field-action='markup-clear']").addEventListener("click", () => {
    markupState.strokes = [];
    redrawMarkup();
  });
  dialog.querySelector("[data-field-action='markup-cancel']").addEventListener("click", () => {
    dialog.close();
    const resolve = markupState.resolve;
    markupState.resolve = null;
    resolve?.(null);
  });
  dialog.querySelector("[data-field-action='markup-save']").addEventListener("click", () => saveMarkup());
}

async function exportMarkupBlob() {
  const canvas = markupDialog().querySelector("[data-markup-canvas]");
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not export the image."))), "image/png"));
}

async function saveMarkup() {
  const dialog = markupDialog();
  const saveButton = dialog.querySelector("[data-field-action='markup-save']");
  if (saveButton.disabled) return;
  saveButton.disabled = true;
  try {
    const blob = await exportMarkupBlob();
    const caption = dialog.querySelector("[data-markup-caption]").value.trim();
    const opts = markupState.opts || {};
    let result;
    if (opts.upload !== false && opts.entityType && opts.entityId) {
      const type = crm.documentTypeByCode(opts.documentType || "job-photo");
      const file = new File([blob], `markup-${Date.now()}.png`, { type: "image/png" });
      const headers = {
        "X-Entity-Type": opts.entityType,
        "X-Entity-Id": opts.entityId,
        "X-Document-Type": type?.id || "",
        "X-Group-Id": opts.groupId || markupState.sourceDocument?.groupId || markupState.sourceDocument?.id || "",
        "X-Visibility": markupState.sourceDocument?.visibility || "internal",
        "X-Caption": encodeURIComponent(caption || markupState.sourceDocument?.caption || ""),
      };
      result = await uploadFieldFile("/api/documents", file, headers);
      try {
        // Keeps the strokes so re-opening this version loads them back. The generic metadata route
        // (server.mjs) only whitelists visibility/caption/tags/documentTypeId/retainUntil today; W1
        // is extending it to also keep `markup` (see phase-21-frontline-2.md corrections). Until that
        // ships this call is a harmless no-op for the markup field specifically.
        await saveFieldRecord("documents", { ...result, markup: JSON.stringify(markupState.strokes) });
      } catch {
        // best effort
      }
    } else {
      result = { blob, dataUrl: canvas_toDataUrlSafe(dialog), strokes: structuredClone(markupState.strokes), caption };
    }
    dialog.close();
    const resolve = markupState.resolve;
    markupState.resolve = null;
    if (typeof opts.onSave === "function") opts.onSave(result);
    resolve?.(result);
  } catch (error) {
    crm.showToast(error?.message || "Could not save the markup.");
  } finally {
    saveButton.disabled = false;
  }
}

function canvas_toDataUrlSafe(dialog) {
  try {
    return dialog.querySelector("[data-markup-canvas]").toDataURL("image/png");
  } catch {
    return "";
  }
}

// ---- Site sketch: markup over a satellite snapshot (or a blank grid offline) ------------------
export async function openSiteSketch({ opportunityId = "", dispatchJobId = "", facilityId = "" } = {}) {
  const facility = facilityId ? crm.findFacility(facilityId) : null;
  const lat = Number(facility?.latitude);
  const lng = Number(facility?.longitude);
  let canvas;
  if (Number.isFinite(lat) && Number.isFinite(lng) && (crm.state.online !== false)) {
    try {
      canvas = await renderSatelliteSnapshot(lat, lng, 18);
    } catch {
      canvas = renderBlankGrid();
    }
  } else {
    canvas = renderBlankGrid();
  }
  const entityType = dispatchJobId ? "dispatchJob" : opportunityId ? "opportunity" : "siteWalk";
  const entityId = dispatchJobId || opportunityId || "";
  return openImageMarkup(canvas, { entityType, entityId, documentType: "site-sketch", title: "Site sketch" });
}

function tileXY(lat, lng, zoom) {
  const n = 2 ** zoom;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

async function renderSatelliteSnapshot(lat, lng, zoom) {
  const { x, y } = tileXY(lat, lng, zoom);
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size * 3;
  canvas.height = size * 3;
  const context = canvas.getContext("2d");
  const loads = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const tx = cx + dx;
      const ty = cy + dy;
      const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
      loads.push(
        fetch(url)
          .then((response) => (response.ok ? response.blob() : null))
          .then((blob) => (blob ? createImageBitmap(blob) : null))
          .then((bitmap) => {
            if (bitmap) context.drawImage(bitmap, (dx + 1) * size, (dy + 1) * size, size, size);
          })
          .catch(() => {}),
      );
    }
  }
  await Promise.all(loads);
  // A rough scale bar: meters per pixel at this latitude/zoom (Web Mercator).
  const metersPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  drawScaleBar(context, canvas.width, canvas.height, metersPerPixel);
  return canvas;
}

function drawScaleBar(context, width, height, metersPerPixel) {
  const barPixels = 150;
  const meters = Math.round(barPixels * metersPerPixel);
  const feet = Math.round(meters * 3.28084);
  context.strokeStyle = "#ffffff";
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(20, height - 20);
  context.lineTo(20 + barPixels, height - 20);
  context.stroke();
  context.fillStyle = "#ffffff";
  context.font = "bold 16px sans-serif";
  context.fillText(`≈ ${feet} ft`, 20, height - 28);
}

function renderBlankGrid() {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1200;
  const context = canvas.getContext("2d");
  context.fillStyle = "#f4f4f0";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#d8d8d0";
  context.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += 60) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 60) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }
  context.fillStyle = "#8a8a80";
  context.font = "16px sans-serif";
  context.fillText("No satellite imagery available offline — sketch to scale using the grid (each square ≈ 10 ft).", 20, 30);
  return canvas;
}

// ================================================================================================
// IT-messages screenshot: capture/choose, then the same markup tool, local-only (no upload here —
// sendItMessage in app.js does the upload when the message is actually sent).
// ================================================================================================

export async function markupItScreenshot(image) {
  return openImageMarkup(image, { upload: false, title: "Mark up the screenshot" });
}

export async function captureScreenForMarkup() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Screen capture is not available in this browser. Use Choose image instead.");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "browser" }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    if (video.readyState < 2) await new Promise((resolve) => video.addEventListener("loadeddata", resolve, { once: true }));
    await waitForVideoFrames(video, 2);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    return canvas;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

function waitForVideoFrames(video, count) {
  return new Promise((resolve) => {
    let seen = 0;
    const step = () => {
      seen += 1;
      if (seen >= count) resolve();
      else video.requestVideoFrameCallback ? video.requestVideoFrameCallback(step) : requestAnimationFrame(step);
    };
    video.requestVideoFrameCallback ? video.requestVideoFrameCallback(step) : requestAnimationFrame(step);
  });
}

// ================================================================================================
// Video capture
// ================================================================================================

const VIDEO_CHUNK_SIZE = 5 * 1024 * 1024;
const VIDEO_SINGLE_POST_LIMIT = 25 * 1024 * 1024;
const VIDEO_MAX_SIZE = 500 * 1024 * 1024;

function videoDialog() {
  return document.querySelector("#videoCaptureDialog");
}

let videoWired = false;
function wireVideoDialog() {
  if (videoWired) return;
  const dialog = videoDialog();
  if (!dialog) return;
  videoWired = true;
  dialog.querySelector("[data-field-action='video-cancel']").addEventListener("click", () => dialog.close());
  dialog.querySelector("input[name='videoFile']").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) await handleVideoFile(file);
  });
}

export function openVideoCapture(opts = {}) {
  wireVideoDialog();
  const dialog = videoDialog();
  if (!dialog) return;
  dialog.dataset.entityType = opts.entityType || "";
  dialog.dataset.entityId = opts.entityId || "";
  dialog.dataset.documentType = opts.documentType || "site-video";
  dialog.querySelector("[data-video-status]").textContent = "Choose or record a clip (up to 500 MB).";
  dialog.querySelector("[data-video-progress]").hidden = true;
  dialog.showModal();
}

async function handleVideoFile(file) {
  const dialog = videoDialog();
  const status = dialog.querySelector("[data-video-status]");
  const progress = dialog.querySelector("[data-video-progress]");
  if (file.size > VIDEO_MAX_SIZE) {
    status.textContent = `That clip is ${crm.formatFileSize(file.size)} — the limit per clip is 500 MB.`;
    return;
  }
  status.textContent = "Reading a poster frame…";
  let posterDataUrl = "";
  try {
    posterDataUrl = await capturePosterFrame(file);
  } catch {
    // poster is best-effort
  }
  const entityType = dialog.dataset.entityType;
  const entityId = dialog.dataset.entityId;
  const documentTypeCode = dialog.dataset.documentType || "site-video";
  const type = crm.documentTypeByCode(documentTypeCode);
  progress.hidden = false;
  progress.value = 0;
  status.textContent = "Uploading…";
  try {
    let saved;
    if (file.size > VIDEO_SINGLE_POST_LIMIT) {
      saved = await uploadVideoChunked(file, { entityType, entityId, documentTypeId: type?.id || "", posterDataUrl, onProgress: (percent) => (progress.value = percent) });
      if (!saved) {
        if (file.size > VIDEO_SINGLE_POST_LIMIT) throw new Error("This clip needs chunked upload, which the server does not support yet. Try a shorter clip (under 25 MB) for now.");
      }
    }
    if (!saved) {
      saved = await uploadFieldFile("/api/documents", file, {
        "X-Entity-Type": entityType,
        "X-Entity-Id": entityId,
        "X-Document-Type": type?.id || "",
        "X-Visibility": "internal",
      });
      progress.value = 100;
    }
    if (posterDataUrl) {
      try {
        await saveFieldRecord("documents", { ...saved, posterDataUrl });
      } catch {
        // best effort; poster storage depends on the server keeping the field
      }
    }
    status.textContent = "Uploaded.";
    crm.showToast("Video uploaded.");
    videoDialog().close();
    videoDialog()._lastSaved = saved;
  } catch (error) {
    status.textContent = error?.message || "Upload failed.";
  }
}

function capturePosterFrame(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    video.src = url;
    const cleanup = () => URL.revokeObjectURL(url);
    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(1, (video.duration || 2) / 2);
    });
    video.addEventListener("seeked", () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 320;
        canvas.height = video.videoHeight || 180;
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        cleanup();
        resolve(canvas.toDataURL("image/png"));
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
    video.addEventListener("error", () => {
      cleanup();
      reject(new Error("Could not read the video."));
    });
  });
}

async function uploadVideoChunked(file, { entityType, entityId, documentTypeId, posterDataUrl, onProgress }) {
  let session;
  try {
    session = await fieldRequest("/api/documents/upload-session", {
      method: "POST",
      body: { fileName: file.name, mimeType: file.type || "video/mp4", sizeBytes: file.size, entityType, entityId, documentType: documentTypeId },
      kind: "video upload session",
    });
  } catch {
    return null; // server not ready — caller falls back
  }
  const chunkSize = session.chunkSize || VIDEO_CHUNK_SIZE;
  const total = Math.ceil(file.size / chunkSize);
  for (let index = 0; index < total; index++) {
    const chunk = file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize));
    await fieldRequest(`/api/documents/upload-session/${encodeURIComponent(session.sessionId)}/chunks/${index}`, {
      method: "PUT",
      body: chunk,
      headers: { "Content-Type": "application/octet-stream" },
      kind: "video chunk",
    });
    onProgress?.(Math.round(((index + 1) / total) * 100));
  }
  const headers = posterDataUrl ? { "X-Poster": posterDataUrl.split(",")[1] || "" } : {};
  return fieldRequest(`/api/documents/upload-session/${encodeURIComponent(session.sessionId)}/complete`, { method: "POST", body: {}, headers, kind: "video complete" });
}

export function renderVideoTile(document) {
  const viewUrl = `/api/documents/${encodeURIComponent(document.id)}/view`;
  const poster = document.posterDataUrl || "";
  return `
    <figure class="field-video-tile">
      <video controls preload="none" ${poster ? `poster="${crm.escapeAttribute(poster)}"` : ""} src="${viewUrl}"></video>
      <figcaption>${crm.escapeHtml(document.caption || document.fileName)}${document.durationSeconds ? ` · ${Math.round(document.durationSeconds)}s` : ""}</figcaption>
    </figure>
  `;
}

export function renderVideoPrintBlock(document) {
  const viewUrl = `/api/documents/${encodeURIComponent(document.id)}/view`;
  const poster = document.posterDataUrl || "";
  return `
    <div class="print-video-block">
      ${poster ? `<img src="${crm.escapeAttribute(poster)}" alt="${crm.escapeAttribute(document.caption || document.fileName)}" style="max-width:320px" />` : ""}
      <p><strong>${crm.escapeHtml(document.caption || document.fileName)}</strong> — video, view online: ${viewUrl}</p>
    </div>
  `;
}

// ================================================================================================
// Add scan
// ================================================================================================

const SCAN_EXTENSIONS = ["glb", "usdz", "ply", "obj", "e57", "zip", "pdf", "csv"];

function scanDialog() {
  return document.querySelector("#addScanDialog");
}

let scanWired = false;
function wireScanDialog() {
  if (scanWired) return;
  const dialog = scanDialog();
  if (!dialog) return;
  scanWired = true;
  dialog.querySelector("[data-field-action='scan-cancel']").addEventListener("click", () => dialog.close());
  dialog.querySelector("input[name='scanFile']").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) await handleScanFile(file);
  });
}

export function openAddScan(opts = {}) {
  wireScanDialog();
  const dialog = scanDialog();
  if (!dialog) return;
  dialog._opts = opts;
  dialog.querySelector("[data-scan-status]").textContent = `Share a .glb, .usdz, .ply, .obj, .e57, .zip, .pdf or .csv from your scanning app.`;
  dialog.showModal();
}

async function handleScanFile(file) {
  const dialog = scanDialog();
  const status = dialog.querySelector("[data-scan-status]");
  const extension = (file.name.split(".").pop() || "").toLowerCase();
  if (!SCAN_EXTENSIONS.includes(extension)) {
    status.textContent = `Unrecognized file type ".${extension}". Expected one of: ${SCAN_EXTENSIONS.join(", ")}.`;
    return;
  }
  const opts = dialog._opts || {};
  const entityType = opts.dispatchJobId ? "dispatchJob" : opts.projectId ? "project" : opts.opportunityId ? "opportunity" : "siteWalk";
  const entityId = opts.dispatchJobId || opts.projectId || opts.opportunityId || "";
  const type = crm.documentTypeByCode("site-scan");
  status.textContent = "Uploading…";
  try {
    const saved =
      file.size > VIDEO_SINGLE_POST_LIMIT
        ? (await uploadVideoChunked(file, { entityType, entityId, documentTypeId: type?.id || "" })) ||
          (await uploadFieldFile("/api/documents", file, { "X-Entity-Type": entityType, "X-Entity-Id": entityId, "X-Document-Type": type?.id || "", "X-Visibility": "internal" }))
        : await uploadFieldFile("/api/documents", file, { "X-Entity-Type": entityType, "X-Entity-Id": entityId, "X-Document-Type": type?.id || "", "X-Visibility": "internal" });
    const project = opts.projectId ? crm.findProject(opts.projectId) : null;
    const accountId = project?.accountId || opts.accountId || "";
    await saveFieldRecord("spatialData", {
      projectId: opts.projectId || "",
      accountId,
      documentId: saved.id,
      format: extension,
      fileType: extension,
      scanDate: crm.todayIso(),
      uploadedBy: crm.currentActorName(),
      scanQuality: "",
      pointCount: null,
      coverage: "",
      measurements: [],
    });
    status.textContent = "Scan uploaded.";
    crm.showToast("Scan added.");
    scanDialog().close();
  } catch (error) {
    status.textContent = error?.message || "Upload failed.";
  }
}

// ================================================================================================
// Measurements (including GPS-walked perimeter)
// ================================================================================================

function measurementsDialog() {
  return document.querySelector("#measurementsDialog");
}

let measurementsWired = false;
let gpsWatchId = null;
let gpsPoints = [];

function wireMeasurementsDialog() {
  if (measurementsWired) return;
  const dialog = measurementsDialog();
  if (!dialog) return;
  measurementsWired = true;
  dialog.querySelector("[data-field-action='measurements-cancel']").addEventListener("click", () => {
    stopGpsWalk();
    dialog.close();
  });
  dialog.querySelector("[data-field-form='measurements']").addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveMeasurementRow(new FormData(event.target));
  });
  dialog.querySelector("[data-field-action='gps-walk-start']").addEventListener("click", () => startGpsWalk());
  dialog.querySelector("[data-field-action='gps-walk-stop']").addEventListener("click", () => finishGpsWalk());
}

export function openMeasurementsForm(opts = {}) {
  wireMeasurementsDialog();
  const dialog = measurementsDialog();
  if (!dialog) return;
  dialog._opts = opts;
  renderMeasurementsList();
  dialog.showModal();
}

function measurementsTargetCollection(target) {
  return target === "walk" ? "siteWalkReports" : "dispatchJobs";
}

function findMeasurementsTarget(opts) {
  if (opts.target === "walk") return (crm.state.backend.siteWalkReports || []).find((row) => row.id === opts.id) || null;
  return crm.findDispatchJob(opts.id);
}

function renderMeasurementsList() {
  const dialog = measurementsDialog();
  const opts = dialog._opts || {};
  const target = findMeasurementsTarget(opts);
  const rows = target?.measurements || [];
  dialog.querySelector("[data-measurements-list]").innerHTML =
    rows
      .map(
        (row) => `
    <div class="field-card">
      <div class="field-card-row"><strong>${crm.escapeHtml(row.label || "Measurement")}</strong><span>${crm.escapeHtml(row.method || "")}</span></div>
      <div class="field-card-row"><span>${row.area ? `${row.area} ${crm.escapeHtml(row.areaUnit || "sq ft")}` : ""}</span><span>${row.length ? `${row.length} ft` : ""}</span></div>
    </div>`,
      )
      .join("") || `<p class="field-muted">No measurements yet.</p>`;
}

async function saveMeasurementRow(data) {
  const dialog = measurementsDialog();
  const opts = dialog._opts || {};
  const row = {
    label: (data.get("label") || "").toString().trim() || "Measurement",
    area: Number(data.get("area")) || null,
    areaUnit: (data.get("areaUnit") || "sq ft").toString(),
    length: Number(data.get("length")) || null,
    depth: Number(data.get("depth")) || null,
    volume: Number(data.get("volume")) || null,
    method: (data.get("method") || "tape").toString(),
    at: new Date().toISOString(),
    by: crm.currentActorName(),
  };
  await addMeasurement(opts, row);
  dialog.querySelector("[data-field-form='measurements']").reset();
  renderMeasurementsList();
  crm.showToast("Measurement added.");
}

async function addMeasurement(opts, row) {
  try {
    await fieldRequest("/api/field/measurements", { method: "POST", body: { target: opts.target, id: opts.id, measurement: row }, kind: "measurement" });
    return;
  } catch {
    // fall back to a plain upsert of the parent record's measurements[] array
  }
  const collection = measurementsTargetCollection(opts.target);
  const target = findMeasurementsTarget(opts);
  if (!target) throw new Error("Could not find the record to save this measurement on.");
  const measurements = [...(target.measurements || []), row];
  await saveFieldRecord(collection, { ...target, measurements });
}

function startGpsWalk() {
  if (!navigator.geolocation) {
    crm.showToast("GPS is not available in this browser.");
    return;
  }
  gpsPoints = [];
  const dialog = measurementsDialog();
  dialog.querySelector("[data-gps-status]").textContent = "Walking the perimeter — 0 points.";
  dialog.querySelector("[data-field-action='gps-walk-start']").hidden = true;
  dialog.querySelector("[data-field-action='gps-walk-stop']").hidden = false;
  gpsWatchId = navigator.geolocation.watchPosition(
    (position) => {
      gpsPoints.push({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, at: Date.now() });
      dialog.querySelector("[data-gps-status]").textContent = `Walking the perimeter — ${gpsPoints.length} points.`;
    },
    () => crm.showToast("Could not read GPS."),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
  );
}

function stopGpsWalk() {
  if (gpsWatchId != null) navigator.geolocation.clearWatch(gpsWatchId);
  gpsWatchId = null;
}

function polygonAreaSqFt(points) {
  if (points.length < 3) return 0;
  const originLat = points[0].lat;
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((originLat * Math.PI) / 180);
  const xy = points.map((p) => [(p.lng - points[0].lng) * metersPerDegLng, (p.lat - points[0].lat) * metersPerDegLat]);
  let area = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    area += x1 * y2 - x2 * y1;
  }
  const sqMeters = Math.abs(area) / 2;
  return Math.round(sqMeters * 10.7639);
}

async function finishGpsWalk() {
  stopGpsWalk();
  const dialog = measurementsDialog();
  dialog.querySelector("[data-field-action='gps-walk-start']").hidden = false;
  dialog.querySelector("[data-field-action='gps-walk-stop']").hidden = true;
  if (gpsPoints.length < 3) {
    crm.showToast("Not enough points recorded for a perimeter.");
    return;
  }
  const areaSqFt = polygonAreaSqFt(gpsPoints);
  const opts = dialog._opts || {};
  await addMeasurement(opts, {
    label: "GPS-walked perimeter",
    area: areaSqFt,
    areaUnit: "sq ft",
    method: "gps-walk",
    at: new Date().toISOString(),
    by: crm.currentActorName(),
    geometry: { type: "Polygon", coordinates: [gpsPoints.map((p) => [p.lng, p.lat])] },
  });
  dialog.querySelector("[data-gps-status]").textContent = `Perimeter saved: ${areaSqFt} sq ft from ${gpsPoints.length} points.`;
  renderMeasurementsList();
}

// ================================================================================================
// ERG lookup
// ================================================================================================

function ergDialog() {
  return document.querySelector("#ergLookupDialog");
}

let ergWired = false;
function wireErgDialog() {
  if (ergWired) return;
  const dialog = ergDialog();
  if (!dialog) return;
  ergWired = true;
  dialog.querySelector("[data-field-action='erg-cancel']").addEventListener("click", () => dialog.close());
  dialog.querySelector("[data-field-form='erg-search']").addEventListener("submit", (event) => {
    event.preventDefault();
    renderErgResult(new FormData(event.target).get("query"));
  });
  dialog.querySelector("[data-field-action='erg-apply']").addEventListener("click", () => applyErgToJob());
}

export function openErgLookup(opts = {}) {
  wireErgDialog();
  const dialog = ergDialog();
  if (!dialog) return;
  dialog._job = opts.job || null;
  dialog.querySelector("[data-erg-result]").innerHTML = "";
  dialog.querySelector("[data-field-action='erg-apply']").hidden = !opts.job;
  const initial = opts.job?.spillMaterial || "";
  dialog.querySelector("input[name='query']").value = initial;
  dialog.showModal();
  if (initial) renderErgResult(initial);
}

function renderErgResult(query) {
  const dialog = ergDialog();
  const result = crm.ergLookup(query);
  const box = dialog.querySelector("[data-erg-result]");
  const applyButton = dialog.querySelector("[data-field-action='erg-apply']");
  if (!result) {
    box.innerHTML = `<p class="field-muted">No match for "${crm.escapeHtml(String(query || ""))}". Try a UN number (e.g. 1203) or the start of a material name.</p>`;
    applyButton.disabled = true;
    return;
  }
  applyButton.disabled = false;
  dialog._result = result;
  const { material, guide, distances } = result;
  const small = distances?.small;
  const large = distances?.large;
  box.innerHTML = `
    <div class="field-card erg-card">
      <div class="field-card-row"><strong>UN${crm.escapeHtml(String(material.unNumber))} — ${crm.escapeHtml(material.name)}</strong>${material.tihFlag ? `<span class="erg-tih">TIH</span>` : ""}</div>
      <div class="field-card-row"><span>Guide ${crm.escapeHtml(String(material.guide))}${guide?.title ? `: ${crm.escapeHtml(guide.title)}` : ""}</span></div>
      ${guide?.sections ? `
        <p class="erg-section"><strong>Potential hazards</strong> ${crm.escapeHtml(guide.sections.potentialHazards || "")}</p>
        <p class="erg-section"><strong>Public safety</strong> ${crm.escapeHtml(guide.sections.publicSafety || "")}</p>
        <p class="erg-section"><strong>Emergency response</strong> ${crm.escapeHtml(guide.sections.emergencyResponse || "")}</p>
      ` : ""}
      ${small || large ? `
        <table class="erg-distance-table">
          <thead><tr><th></th><th>Isolate</th><th>Day</th><th>Night</th></tr></thead>
          <tbody>
            ${small ? `<tr><td>Small spill</td><td>${small.isolateMeters ?? "—"} m</td><td>${small.dayMeters ?? "—"} m</td><td>${small.nightMeters ?? "—"} m</td></tr>` : ""}
            ${large ? `<tr><td>Large spill</td><td>${large.isolateMeters ?? "—"} m</td><td>${large.dayMeters ?? "—"} m</td><td>${large.nightMeters ?? "—"} m</td></tr>` : ""}
          </tbody>
        </table>
      ` : ""}
    </div>
  `;
}

async function applyErgToJob() {
  const dialog = ergDialog();
  const job = dialog._job;
  const result = dialog._result;
  if (!job || !result) return;
  const spillSize = dialog.querySelector("select[name='spillSize']")?.value || "small";
  const dayNight = dialog.querySelector("select[name='dayNight']")?.value || "day";
  const isolation = crm.ergIsolationFor(result.material.unNumber, { spillSize, dayNight });
  try {
    await saveFieldRecord("dispatchJobs", {
      ...job,
      ergGuideNumber: result.material.guide,
      ergSpillSize: spillSize,
      ergDayNight: dayNight,
      ergIsolationMeters: isolation?.isolationMeters ?? job.ergIsolationMeters ?? null,
      ergProtectiveMeters: isolation?.protectiveMeters ?? job.ergProtectiveMeters ?? null,
    });
    crm.showToast("ERG guide applied to the job.");
    dialog.close();
    crm.render?.();
  } catch (error) {
    crm.showToast(error?.message || "Could not apply the ERG guide.");
  }
}

// A live ERG hint under the ER intake dialog's material field.
document.addEventListener("input", (event) => {
  if (!event.target.matches("[data-erg-material-hint]")) return;
  const hint = document.querySelector("#emergencyIntakeDialog [data-erg-hint]");
  if (!hint) return;
  const result = crm.ergLookup(event.target.value);
  hint.textContent = result ? `ERG: UN${result.material.unNumber} — Guide ${result.material.guide}${result.guide?.title ? `: ${result.guide.title}` : ""}` : "";
});

// A red isolation/protective-distance circle on a Leaflet map. `map` is an initialized Leaflet map,
// `latLng` an [lat, lng] pair or {lat, lng}, `meters` the radius.
export function renderErgCircle(map, latLng, meters) {
  if (!window.L || !map || !Number.isFinite(meters)) return null;
  return window.L.circle(latLng, { radius: meters, color: "#e11d48", weight: 2, fillColor: "#e11d48", fillOpacity: 0.08 }).addTo(map);
}

// ================================================================================================
// window.fieldMedia — the entry points other workstreams call, guarded with `?.`.
// ================================================================================================
window.fieldMedia = { openImageMarkup, openVideoCapture, openAddScan, openMeasurementsForm, openErgLookup, openSiteSketch, renderVideoTile, renderVideoPrintBlock, renderErgCircle };
