// Front Line 2 — the driver's-licence scanner, shared (2026-10-01).
//
// Extracted from field/safety.js (Phase 25 A.3b, the roll call's "Scan ID") so job action forms can
// use the same reader for their "Driver's licence scan" field (field/forms.js, type `idScan`).
//
//   scanLicence({ mode, title, captureGps }) -> Promise<{ licence, summary, position } | null>
//     Opens a modal sheet over whatever is on screen (the roll call, or a form sheet -- a dialog opened
//     with showModal stacks on top of another one) with the live camera, or a photo of the back of the
//     licence, and resolves once a driver's licence has been read:
//       licence  -- field/aamva.js's parse, licence number included. In memory only: the caller sends
//                   the number to the server once (or not at all) and drops it.
//       summary  -- { displayName, idLast4, idState, idExpiry, expired } (safe to show and keep).
//       position -- () => Promise<{lat, lng, accuracyM} | null>; the GPS fix started when the sheet
//                   opened (captureGps), waited for at most 3 s more. Always null without captureGps.
//     Resolves null if the worker closes the sheet. A barcode that isn't a licence, or a licence
//     whose issuing state can't be read, shows an error in the sheet and scanning carries on.
//     mode: "auto" (live camera where the browser's BarcodeDetector reads pdf417, else a photo),
//           "camera" (the same), or "photo" (straight to the photo option).
//
// The PDF417 barcode is read by the browser's BarcodeDetector where it supports pdf417 (Android
// Chrome), else from a photo by the vendored zxing-wasm decoder (public/vendor/zxing/, loaded only
// when needed, precached for offline use). The photo is decoded here and never uploaded or stored.
//
// No app.js import on purpose: this module only touches the DOM and field/aamva.js.
import { parseAamva } from "./aamva.js";

let liveSupport = null;
let zxingPromise = null;

const escapeText = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export async function liveScanSupported() {
  if (liveSupport !== null) return liveSupport;
  try {
    liveSupport = Boolean(
      window.BarcodeDetector && navigator.mediaDevices?.getUserMedia && (await window.BarcodeDetector.getSupportedFormats()).includes("pdf417"),
    );
  } catch {
    liveSupport = false;
  }
  return liveSupport;
}

function loadZxing() {
  if (zxingPromise) return zxingPromise;
  zxingPromise = new Promise((resolve, reject) => {
    if (window.ZXingWASM) {
      resolve(window.ZXingWASM);
      return;
    }
    const script = document.createElement("script");
    script.src = new URL("../public/vendor/zxing/zxing-reader.js", import.meta.url).href;
    script.onload = () => (window.ZXingWASM ? resolve(window.ZXingWASM) : reject(new Error("The barcode reader didn't load.")));
    script.onerror = () => reject(new Error("The barcode reader couldn't be loaded. Open the app once with signal so this phone can keep it for offline use."));
    document.head.appendChild(script);
  }).then((zxing) => {
    const wasmUrl = new URL("../public/vendor/zxing/zxing_reader.wasm", import.meta.url).href;
    // The library would fetch its .wasm from a CDN; point it at the vendored (precached) copy.
    zxing.prepareZXingModule({ overrides: { locateFile: (file, prefix) => (file.endsWith(".wasm") ? wasmUrl : prefix + file) }, fireImmediately: true });
    return zxing;
  });
  zxingPromise.catch(() => {
    zxingPromise = null;
  });
  return zxingPromise;
}

// A still photo of the back of the licence -> the barcode text. Read on the phone; never uploaded.
export async function decodeLicencePhoto(file) {
  if (await liveScanSupported()) {
    try {
      const bitmap = await createImageBitmap(file);
      const found = await new window.BarcodeDetector({ formats: ["pdf417"] }).detect(bitmap);
      bitmap.close?.();
      const text = found.find((item) => item.rawValue)?.rawValue;
      if (text) return text;
    } catch {
      // fall through to zxing
    }
  }
  const zxing = await loadZxing();
  const options = { formats: ["PDF417"], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, textMode: "Plain", maxNumberOfSymbols: 1 };
  const read = async (input) => (await zxing.readBarcodes(input, options)).find((item) => item.isValid && item.text)?.text || "";
  const direct = await read(file);
  if (direct) return direct;
  // zxing's PDF417 reader gives up on a barcode tilted more than ~3 degrees (tested 2026-09-29), and a
  // hand-held photo is rarely square: straighten it in 3-degree steps, both ways, up to 15 degrees.
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return "";
  }
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  try {
    for (const degrees of [-3, 3, -6, 6, -9, 9, -12, 12, -15, 15]) {
      const radians = (degrees * Math.PI) / 180;
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians)));
      canvas.height = Math.ceil(Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians)));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(radians);
      context.drawImage(bitmap, -width / 2, -height / 2, width, height);
      const text = await read(context.getImageData(0, 0, canvas.width, canvas.height));
      if (text) return text;
    }
  } finally {
    bitmap.close?.();
  }
  return "";
}

// What may be shown and kept of a licence: never the full number.
export function licenceSummary(licence) {
  return {
    displayName: licence.displayName,
    idLast4: String(licence.licenceNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-4),
    idState: licence.state,
    idExpiry: licence.expiry,
    expired: Boolean(licence.expiry) && licence.expiry < localIsoDate(),
  };
}

function localIsoDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// barcode text -> { licence } | { error }
export function readLicenceText(text) {
  const licence = parseAamva(text);
  if (!licence) return { error: "That barcode isn't a driver's licence. Scan the large barcode on the back of the licence." };
  if (!licence.state) return { error: "The licence's issuing state couldn't be read. Try again, or carry on without a scan." };
  return { licence };
}

// A GPS fix for the scan: started when the sheet opens, so it is usually ready by the time the
// barcode is read. A denied permission or a timeout just means no position.
function startFix() {
  const holder = { value: null, promise: Promise.resolve(null) };
  if (!navigator.geolocation) return holder;
  holder.promise = new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      holder.value = value;
      resolve(value);
    };
    navigator.geolocation.getCurrentPosition(
      (position) => finish({ lat: position.coords.latitude, lng: position.coords.longitude, accuracyM: Math.round(position.coords.accuracy || 0) }),
      () => finish(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
    setTimeout(() => finish(null), 8000);
  });
  return holder;
}

function fixReader(holder) {
  if (!holder) return () => Promise.resolve(null);
  return () => (holder.value ? Promise.resolve(holder.value) : Promise.race([holder.promise, new Promise((resolve) => setTimeout(() => resolve(null), 3000))]));
}

// ---------------------------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------------------------

let closeOpenSheet = null;

export function scanLicence({ mode = "auto", title = "Scan ID", captureGps = false } = {}) {
  if (closeOpenSheet) closeOpenSheet();
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "field-id-capture";
    dialog.setAttribute("data-id-capture", "");
    dialog.innerHTML = `
      <div class="field-id-capture-body">
        <div class="field-card-row"><strong>${escapeText(title)}</strong><button class="mini-button" type="button" data-id-capture-cancel>Cancel</button></div>
        <p class="field-gap" data-id-capture-error hidden></p>
        <div data-id-capture-camera hidden>
          <video id="fieldIdScanVideo" class="field-id-video" playsinline muted autoplay></video>
          <small class="field-card-sub">Hold the barcode on the back of the licence flat inside the frame.</small>
        </div>
        <div data-id-capture-choose hidden>
          <small class="field-card-sub" data-id-capture-no-live hidden>Live scanning isn't available on this phone. Take a clear, close photo of the barcode on the back instead.</small>
          <button class="field-button" type="button" data-id-capture-use-camera hidden>Use the camera</button>
        </div>
        <p class="field-card-sub" data-id-capture-reading hidden>Reading the barcode…</p>
        <label class="field-button field-button--secondary field-id-photo" data-id-capture-photo>Take a photo of the back of the licence
          <input type="file" id="fieldIdScanPhoto" class="field-visually-hidden" accept="image/*" capture="environment" />
        </label>
        <small class="field-card-sub">Only the name, issuing state, last 4 digits and expiry are kept. The photo never leaves this phone.</small>
      </div>`;
    document.body.append(dialog);

    const fix = captureGps ? startFix() : null;
    let live = false;
    let stream = null;
    let timer = 0;
    let settled = false;

    const part = (name) => dialog.querySelector(`[data-id-capture-${name}]`);
    const stopCamera = () => {
      clearTimeout(timer);
      timer = 0;
      if (stream) stream.getTracks().forEach((track) => track.stop());
      stream = null;
    };
    const showError = (message) => {
      const box = part("error");
      box.textContent = message || "";
      box.hidden = !message;
    };
    const setStage = (stage) => {
      dialog.dataset.stage = stage;
      part("camera").hidden = stage !== "camera";
      part("choose").hidden = stage !== "choose";
      part("reading").hidden = stage !== "reading";
      part("photo").hidden = stage === "reading";
      part("no-live").hidden = !(stage === "choose" && !live);
      part("use-camera").hidden = !(stage === "choose" && live);
      if (stage === "camera") startCamera();
      else stopCamera();
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      stopCamera();
      closeOpenSheet = null;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(result);
    };
    // A decoded barcode: a licence ends the scan; anything else is an error and scanning goes on.
    const handleText = (text) => {
      const read = readLicenceText(text);
      if (read.error) {
        showError(read.error);
        return false;
      }
      finish({ licence: read.licence, summary: licenceSummary(read.licence), position: fixReader(fix) });
      return true;
    };

    async function startCamera() {
      if (stream) return;
      const video = part("camera").querySelector("video");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      } catch {
        stream = null;
        live = false;
        showError("The camera couldn't be opened. Take a photo of the back of the licence instead.");
        setStage("choose");
        return;
      }
      if (settled || dialog.dataset.stage !== "camera") {
        stopCamera();
        return;
      }
      video.srcObject = stream;
      video.play().catch(() => {});
      const detector = new window.BarcodeDetector({ formats: ["pdf417"] });
      let lastText = "";
      const tick = async () => {
        if (!stream || settled) return;
        try {
          if (video.readyState >= 2) {
            const found = await detector.detect(video);
            const text = found.find((item) => item.rawValue)?.rawValue;
            // The same non-licence barcode in frame again: keep looking without redrawing.
            if (text && text !== lastText) {
              lastText = text;
              if (handleText(text)) return;
            }
          }
        } catch {
          // a frame the detector couldn't read; keep going
        }
        if (stream) timer = setTimeout(tick, 250);
      };
      tick();
    }

    closeOpenSheet = () => finish(null);
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      finish(null);
    });
    part("cancel").addEventListener("click", () => finish(null));
    part("use-camera").addEventListener("click", () => {
      showError("");
      setStage("camera");
    });
    dialog.querySelector("#fieldIdScanPhoto").addEventListener("change", async (event) => {
      const input = event.target;
      const file = input.files?.[0];
      if (!file) return;
      input.value = "";
      stopCamera();
      showError("");
      setStage("reading");
      let text = "";
      try {
        text = await decodeLicencePhoto(file);
      } catch (error) {
        if (settled) return;
        showError(error?.message || "The photo couldn't be read.");
        setStage("choose");
        return;
      }
      if (settled) return;
      if (!text) {
        showError("No licence barcode found in that photo. Fill the frame with the barcode on the back, in good light, and try again.");
        setStage("choose");
        return;
      }
      if (!handleText(text)) setStage("choose");
    });

    dialog.dataset.stage = "starting";
    part("photo").hidden = true;
    dialog.showModal();
    liveScanSupported().then((supported) => {
      if (settled) return;
      live = supported;
      setStage(live && mode !== "photo" ? "camera" : "choose");
    });
  });
}
