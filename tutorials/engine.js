// Guided tours (Phase 24, 2026-09-28): the overlay that walks a person through the real screens.
//
// Content lives in tutorials/registry.js; this file only knows how to show a step. The host (app.js)
// hands in the few things a tour needs from the app through initTours(): the current view, how to
// open a view or a tab, whether this person may open a view, how to read records, where to save
// progress, and the link a finished hands-on tutorial ends on.
//
// A step is { view?, roles?, tab?, target?, title, do, why?, chain?, waitFor?, until?, auto?, finish? }:
//   view     -- the view to open first (the step is skipped when this person cannot open it)
//   roles    -- show the step only to these roles (Admin always sees it)
//   tab      -- { action, tab }: the detail-page tab button to press first
//   target   -- what to highlight (the first visible match of a list wins); none: a centred card.
//               "name"                  [data-tour="name"]           (markup added for tours)
//               "action:open-account"   [data-action="open-account"] (the app's own click hooks)
//               "tab:switch-x-tab:plan" [data-action=...][data-tab=...]
//               "field:field-open-job"  [data-field-action=...]      (the field app's hooks)
//               "view:accounts"         [data-view=...]              (nav buttons)
//               "dialog:accountDialog"  the open dialog's panel
//               "sel:<css>"             escape hatch for a dialog field by id/name; avoid otherwise
//   chain    -- the business chain shown as chips, the names in `highlight` emphasised
//   waitFor  -- hands-on steps keep Next disabled until the person has done it:
//               "click" (pressed the target), "route:<view>", "dialog:<id>" (that dialog is open),
//               "created:<collection>" (a new record appeared; its id is remembered for `until`),
//               "until" (step.until(ctx) returns true; ctx.record("opportunities") is the record
//               this tour created there, ctx.view the current view)
//   auto     -- what a script does to complete a hands-on step (smoke test, printed guide):
//               [{ click: target } | { fill: [target, value] } | { select: [target, value] } | { wait: ms }]
//   finish   -- the last card of a hands-on tutorial: shows the host's "acknowledge on live" link
//
// The shade is four panels around the target, so a click can only land on the target or the card.
// When a dialog is open the whole layer moves inside it: a modal dialog makes everything outside it
// inert, and inside it the layer paints above the dialog and stays clickable.

const TARGET_WAIT_MS = 1500;
const PAD = 6;

let host = null;
let active = null;
let layer = null;
let repositionFrame = 0;
let observer = null;

export function initTours(hostApi) {
  host = hostApi;
}

export function isTourActive() {
  return Boolean(active);
}

export function activeTourId() {
  return active?.tour.id || "";
}

export function startTour(tour, { startAt = 0 } = {}) {
  if (!host || !tour?.steps?.length) return;
  if (active) stopTour("replaced");
  ensureLayer();
  active = { tour, index: -1, element: null, waiting: false, onClick: null, created: {}, baseline: null };
  layer.hidden = false;
  document.body.classList.add("tour-running");
  window.addEventListener("resize", scheduleReposition);
  window.addEventListener("scroll", scheduleReposition, true);
  document.addEventListener("keydown", onKeydown, true);
  observer = new MutationObserver((mutations) => {
    if (mutations.every((mutation) => layer.contains(mutation.target))) return;
    scheduleReposition();
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  host.saveProgress?.(tour.id, { status: "in-progress", lastStep: startAt });
  goTo(startAt, 1);
}

export function stopTour(reason = "exit") {
  if (!active) return;
  const { tour, index } = active;
  detachClickWait();
  active = null;
  observer?.disconnect();
  observer = null;
  if (layer) {
    layer.hidden = true;
    if (layer.parentElement !== document.body) document.body.appendChild(layer);
  }
  document.body.classList.remove("tour-running");
  window.removeEventListener("resize", scheduleReposition);
  window.removeEventListener("scroll", scheduleReposition, true);
  document.removeEventListener("keydown", onKeydown, true);
  if (reason === "done") host.saveProgress?.(tour.id, { status: "done", lastStep: tour.steps.length - 1 });
  else if (reason === "exit") host.saveProgress?.(tour.id, { status: "exited", lastStep: Math.max(0, index) });
  host.onTourEnd?.(tour, reason);
}

// app.js calls this after every render(): innerHTML replaced the old target, so find it again, and
// a saved record or a changed view may have finished the step.
export function notifyRender() {
  if (!active || active.navigating) return;
  const step = active.tour.steps[active.index];
  if (!step) return;
  if (checkWait(step)) return;
  // Something other than the tour changed the page (browser back, a hash link): put the step back.
  if (step.view && host.currentView() !== step.view && !active.waiting) {
    showStep(active.index);
    return;
  }
  locateAndPlace(step);
}

// Resolve a target spec to its first visible element (exported for scripts driving `auto`).
export function resolveTarget(spec) {
  const specs = Array.isArray(spec) ? spec : spec ? [spec] : [];
  for (const item of specs) {
    for (const element of candidatesFor(item)) if (isVisible(element)) return element;
  }
  return null;
}

// Perform a hands-on step's `auto` actions (the smoke test and the printed-guide builder call this;
// a person never does). Returns false when a target is missing.
export async function runAuto(step = active?.tour.steps[active.index]) {
  for (const action of step?.auto || []) {
    if (action.wait) {
      await sleep(action.wait);
      continue;
    }
    const [spec, value] = action.fill || action.select || [action.click];
    // `optional: true`: a click that only applies sometimes (e.g. clearing a default filter).
    const element = await waitForElement(spec, action.optional ? 800 : 3000);
    if (!element) {
      if (action.optional) continue;
      return false;
    }
    if (action.click) {
      element.scrollIntoView({ block: "center" });
      element.click();
    } else {
      // "@first": the first real option of a select (ids differ per run); "@today": today's date.
      if (value === "@first" && element.options) {
        const option = [...element.options].find((item) => item.value && !item.disabled);
        element.value = option ? option.value : "";
      } else if (String(value).startsWith("label:") && element.options) {
        // "label:Logan": the first option whose text contains it (sample roster names are stable).
        const wanted = String(value).slice(6).toLowerCase();
        const option = [...element.options].find((item) => item.value && item.textContent.toLowerCase().includes(wanted));
        element.value = option ? option.value : element.value;
      } else if (String(value).startsWith("@today")) {
        // "@today" is a date; "@todayT08:00" a datetime-local value.
        const now = new Date();
        element.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}${String(value).slice(6)}`;
      } else {
        element.value = value;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await sleep(250);
  }
  return true;
}

// ---- stepping -------------------------------------------------------------------------------

function goTo(index, direction) {
  if (!active) return;
  const steps = active.tour.steps;
  let next = index;
  // Skip steps this person cannot see -- a view their role cannot open, or a step marked for other
  // roles (an Admin-only panel) -- in the direction of travel.
  const hidden = (step) => (step.view && !host.canView(step.view)) || (step.roles && !host.hasAnyRole?.(step.roles));
  while (next >= 0 && next < steps.length && hidden(steps[next])) next += direction;
  if (next >= steps.length) {
    stopTour("done");
    return;
  }
  if (next < 0) next = 0;
  showStep(next);
}

function showStep(index) {
  const step = active.tour.steps[index];
  detachClickWait();
  active.index = index;
  active.waiting = Boolean(step.waitFor);
  active.element = null;
  const createdCollection = typeof step.waitFor === "string" && step.waitFor.startsWith("created:") ? step.waitFor.slice(8) : "";
  active.baseline = createdCollection ? new Set(host.recordIds?.(createdCollection) || []) : null;
  host.saveProgress?.(active.tour.id, { status: "in-progress", lastStep: index });
  if (step.view && host.currentView() !== step.view) {
    active.navigating = true;
    try {
      host.openView(step.view);
    } finally {
      active.navigating = false;
    }
  }
  if (step.tab) host.openTab?.(step.tab);
  fillCard(step, index);
  if (checkWait(step)) return;
  locateAndPlace(step);
}

function next() {
  if (!active || active.waiting) return;
  goTo(active.index + 1, 1);
}

function back() {
  if (!active || active.index <= 0) return;
  goTo(active.index - 1, -1);
}

function skip() {
  if (!active) return;
  active.waiting = false;
  goTo(active.index + 1, 1);
}

// A waiting step whose condition now holds moves on by itself. Returns true when it did.
function checkWait(step) {
  if (!active?.waiting || !step.waitFor) return false;
  const kind = step.waitFor;
  let done = false;
  if (kind.startsWith("route:")) done = host.currentView() === kind.slice(6);
  else if (kind.startsWith("dialog:")) done = Boolean(document.getElementById(kind.slice(7))?.open);
  else if (kind.startsWith("created:")) {
    const collection = kind.slice(8);
    const fresh = (host.recordIds?.(collection) || []).filter((id) => !active.baseline?.has(id));
    if (fresh.length) {
      active.created[collection] = fresh[fresh.length - 1];
      done = true;
    }
  } else if (kind === "until" && typeof step.until === "function") {
    try {
      done = Boolean(step.until(context()));
    } catch {
      done = false;
    }
  }
  if (!done) return false;
  active.waiting = false;
  // Let the app finish what it is doing (close the dialog, render the new page) before moving on.
  setTimeout(() => active && active.tour.steps[active.index] === step && goTo(active.index + 1, 1), 150);
  return true;
}

function context() {
  return {
    view: host.currentView(),
    created: { ...active.created },
    record: (collection) => (active.created[collection] ? host.getRecord?.(collection, active.created[collection]) || null : null),
  };
}

// ---- finding the target ---------------------------------------------------------------------

function candidatesFor(spec) {
  const [kind, ...rest] = String(spec).split(":");
  const value = rest.join(":");
  if (!rest.length) return document.querySelectorAll(`[data-tour="${cssEscape(spec)}"]`);
  if (kind === "action") return document.querySelectorAll(`[data-action="${cssEscape(value)}"]`);
  if (kind === "field") return document.querySelectorAll(`[data-field-action="${cssEscape(value)}"]`);
  if (kind === "view") return document.querySelectorAll(`[data-view="${cssEscape(value)}"]`);
  if (kind === "tab") {
    const [action, tab] = value.split(":");
    return document.querySelectorAll(`[data-action="${cssEscape(action)}"][data-tab="${cssEscape(tab)}"], [data-field-action="${cssEscape(action)}"][data-tab="${cssEscape(tab)}"]`);
  }
  if (kind === "dialog") {
    const dialog = document.getElementById(value);
    return dialog?.open ? [dialog.querySelector(".modal-panel") || dialog] : [];
  }
  if (kind === "sel") return document.querySelectorAll(value);
  return [];
}

function isVisible(element) {
  if (!element?.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

function locateAndPlace(step) {
  const token = {};
  active.locateToken = token;
  seatLayer();
  if (!step.target) {
    layer.dataset.tourStatus = "card";
    place(null);
    return;
  }
  const started = performance.now();
  const attempt = () => {
    if (!active || active.locateToken !== token) return;
    const element = resolveTarget(step.target);
    if (element) {
      active.element = element;
      layer.dataset.tourStatus = "found";
      bringIntoView(element);
      if (step.waitFor === "click") attachClickWait(element);
      place(element);
      return;
    }
    if (performance.now() - started > TARGET_WAIT_MS) {
      // The screen changed and the anchor is gone: show the text anyway, centred, and say so in the
      // layer's status (the smoke test fails on "missing") rather than break the tour.
      layer.dataset.tourStatus = "missing";
      place(null);
      return;
    }
    setTimeout(attempt, 50);
  };
  attempt();
}

// Inside the topmost open modal dialog, or in <body> when none is open.
function seatLayer() {
  const dialogs = [...document.querySelectorAll("dialog[open]")].filter((dialog) => !layer.contains(dialog));
  const home = dialogs[dialogs.length - 1] || document.body;
  if (layer.parentElement !== home) home.appendChild(layer);
}

// Desktop: centre the target. Phone: the card is a sheet over the bottom half, so put the top of the
// target just under the (sticky) app header instead, where the sheet cannot cover it.
function bringIntoView(element) {
  const rect = element.getBoundingClientRect();
  const vh = window.innerHeight;
  if (element.closest("dialog")) {
    if (rect.top < 8 || rect.bottom > vh - 8) element.scrollIntoView({ block: "nearest" });
    return;
  }
  if (window.innerWidth < 640) {
    const header = document.querySelector(".topbar");
    const headerBottom = header && getComputedStyle(header).position !== "static" ? header.getBoundingClientRect().bottom : 0;
    const wantTop = Math.max(12, headerBottom + 12);
    if (Math.abs(rect.top - wantTop) > 8 && (rect.top < wantTop || rect.bottom > vh * 0.45)) window.scrollBy({ top: rect.top - wantTop, behavior: "instant" });
    return;
  }
  if (rect.top < 64 || rect.bottom > vh - 24) element.scrollIntoView({ block: "center", inline: "nearest" });
}

function attachClickWait(element) {
  detachClickWait();
  const handler = (event) => {
    if (!active || !element.contains(event.target)) return;
    detachClickWait();
    // Let the app handle the click (and render) first.
    setTimeout(() => {
      if (!active) return;
      active.waiting = false;
      goTo(active.index + 1, 1);
    }, 0);
  };
  document.addEventListener("click", handler, true);
  active.onClick = handler;
}

function detachClickWait() {
  if (active?.onClick) document.removeEventListener("click", active.onClick, true);
  if (active) active.onClick = null;
}

// ---- drawing --------------------------------------------------------------------------------

function ensureLayer() {
  if (layer) return;
  layer = document.createElement("div");
  layer.className = "tour-layer";
  layer.hidden = true;
  layer.innerHTML = `
    <div class="tour-shade" data-edge="top"></div>
    <div class="tour-shade" data-edge="bottom"></div>
    <div class="tour-shade" data-edge="left"></div>
    <div class="tour-shade" data-edge="right"></div>
    <div class="tour-ring" aria-hidden="true"></div>
    <section class="tour-card" role="dialog" aria-modal="false" aria-labelledby="tourCardTitle" aria-describedby="tourCardDo">
      <p class="tour-progress"></p>
      <h3 id="tourCardTitle"></h3>
      <ol class="tour-chain" hidden></ol>
      <p class="tour-do" id="tourCardDo"></p>
      <p class="tour-why" hidden></p>
      <p class="tour-wait" hidden></p>
      <p class="tour-finish" hidden></p>
      <div class="tour-actions">
        <button type="button" class="text-button" data-tour-act="exit">Exit tour</button>
        <button type="button" class="text-button" data-tour-act="skip" hidden>Skip this step</button>
        <span class="tour-actions-spacer"></span>
        <button type="button" class="secondary-button" data-tour-act="back">Back</button>
        <button type="button" class="primary-button" data-tour-act="next">Next</button>
      </div>
    </section>
  `;
  layer.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tour-act]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const act = button.dataset.tourAct;
    if (act === "exit") stopTour("exit");
    if (act === "back") back();
    if (act === "next") next();
    if (act === "skip") skip();
  });
  // Clicks inside a dialog's form must not submit or close it by accident.
  layer.addEventListener("submit", (event) => event.stopPropagation());
  document.body.appendChild(layer);
}

function fillCard(step, index) {
  const card = layer.querySelector(".tour-card");
  const total = active.tour.steps.length;
  card.querySelector(".tour-progress").textContent = `${active.tour.title} · ${index + 1} of ${total}`;
  card.querySelector("h3").textContent = step.title || "";
  card.querySelector(".tour-do").textContent = step.do || "";
  const why = card.querySelector(".tour-why");
  why.hidden = !step.why;
  why.innerHTML = step.why ? `<strong>Why:</strong> ${escapeHtml(step.why)}` : "";
  const chain = card.querySelector(".tour-chain");
  chain.hidden = !step.chain;
  chain.innerHTML = step.chain
    ? step.chain.links.map((link) => `<li class="${step.chain.highlight.includes(link) ? "is-here" : ""}">${escapeHtml(link)}</li>`).join("")
    : "";
  const finish = card.querySelector(".tour-finish");
  const finishLink = step.finish ? host.finishLink?.(active.tour) : null;
  finish.hidden = !finishLink;
  finish.innerHTML = finishLink ? `<a class="primary-button" href="${escapeHtml(finishLink.href)}" target="_blank" rel="noopener">${escapeHtml(finishLink.label)}</a>` : "";
  const isLast = index >= total - 1;
  card.querySelector('[data-tour-act="back"]').hidden = index === 0;
  card.querySelector('[data-tour-act="next"]').textContent = isLast ? "Finish" : "Next";
  updateWaitState(step);
  // Do not pull focus out of a form the person is about to type in.
  if (!active.waiting) requestAnimationFrame(() => card.querySelector('[data-tour-act="next"]')?.focus({ preventScroll: true }));
}

const WAIT_TEXT = {
  click: "Press the highlighted control to carry on.",
  route: "Open the highlighted page to carry on.",
  dialog: "Press the highlighted control to open the form.",
  created: "Fill it in and save to carry on.",
  until: "Carry on in the app; this moves on by itself when it's done.",
};

function updateWaitState(step) {
  const card = layer.querySelector(".tour-card");
  const wait = card.querySelector(".tour-wait");
  const waiting = Boolean(active?.waiting);
  const kind = String(step.waitFor || "").split(":")[0];
  wait.hidden = !waiting;
  wait.textContent = waiting ? step.waitText || WAIT_TEXT[kind] || WAIT_TEXT.until : "";
  card.querySelector('[data-tour-act="next"]').disabled = waiting;
  // A hands-on step can always be skipped: a gate the person cannot clear must not trap them.
  card.querySelector('[data-tour-act="skip"]').hidden = !waiting;
}

function scheduleReposition() {
  if (!active || repositionFrame) return;
  repositionFrame = requestAnimationFrame(() => {
    repositionFrame = 0;
    if (!active) return;
    const step = active.tour.steps[active.index];
    if (step && checkWait(step)) return;
    seatLayer();
    if (!active.element || !active.element.isConnected || !isVisible(active.element)) {
      if (step?.target) {
        locateAndPlace(step);
        return;
      }
    }
    place(active.element);
  });
}

function place(element) {
  const shades = Object.fromEntries([...layer.querySelectorAll(".tour-shade")].map((shade) => [shade.dataset.edge, shade]));
  const ring = layer.querySelector(".tour-ring");
  const card = layer.querySelector(".tour-card");
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!element) {
    setBox(shades.top, 0, 0, vw, vh);
    for (const edge of ["bottom", "left", "right"]) setBox(shades[edge], 0, 0, 0, 0);
    ring.hidden = true;
    card.classList.add("is-centred");
    card.classList.remove("is-sheet", "is-top", "is-compact");
    card.style.width = "";
    card.style.left = "";
    card.style.top = "";
    return;
  }
  const rect = element.getBoundingClientRect();
  const top = Math.max(0, rect.top - PAD);
  const left = Math.max(0, rect.left - PAD);
  const right = Math.min(vw, rect.right + PAD);
  const bottom = Math.min(vh, rect.bottom + PAD);
  setBox(shades.top, 0, 0, vw, top);
  setBox(shades.bottom, 0, bottom, vw, Math.max(0, vh - bottom));
  setBox(shades.left, 0, top, left, Math.max(0, bottom - top));
  setBox(shades.right, right, top, Math.max(0, vw - right), Math.max(0, bottom - top));
  ring.hidden = false;
  setBox(ring, left, top, right - left, bottom - top);

  card.classList.remove("is-centred", "is-compact");
  // Phone width: the card docks to an edge as a sheet -- the bottom, unless the target is down there
  // (the job's status bar), then the top.
  if (vw < 640) {
    card.classList.add("is-sheet");
    card.classList.toggle("is-top", (rect.top + rect.bottom) / 2 > vh / 2);
    card.style.width = "";
    card.style.left = "";
    card.style.top = "";
    return;
  }
  card.classList.remove("is-sheet", "is-top");
  card.style.width = "";
  let cardRect = card.getBoundingClientRect();
  const gap = 14;
  let cardTop;
  if (bottom + gap + cardRect.height <= vh - 8) cardTop = bottom + gap;
  else if (top - gap - cardRect.height >= 8) cardTop = top - gap - cardRect.height;
  else cardTop = Math.max(8, vh - cardRect.height - 8);
  let cardLeft = Math.min(Math.max(8, rect.left), vw - cardRect.width - 8);
  // Neither above nor below fits (a tall target, like a whole dialog): sit beside it, narrowing the
  // card to the room there is, rather than covering the fields the person has to fill in.
  if (cardTop < bottom && cardTop + cardRect.height > top) {
    const spaceRight = vw - right - gap - 8;
    const spaceLeft = left - gap - 8;
    const space = Math.max(spaceRight, spaceLeft);
    if (space >= 240) {
      const width = Math.min(cardRect.width, space);
      card.style.width = `${Math.round(width)}px`;
      cardRect = card.getBoundingClientRect();
      cardLeft = spaceRight >= spaceLeft ? right + gap : left - gap - width;
      cardTop = Math.min(Math.max(8, rect.top), vh - cardRect.height - 8);
    } else {
      // No room anywhere (a wide dialog): a compact card in the bottom-right corner covers least.
      card.classList.add("is-compact");
      card.style.width = "300px";
      cardRect = card.getBoundingClientRect();
      cardLeft = vw - cardRect.width - 8;
      cardTop = vh - cardRect.height - 8;
    }
  }
  card.style.left = `${Math.round(cardLeft)}px`;
  card.style.top = `${Math.round(cardTop)}px`;
}

function setBox(node, left, top, width, height) {
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
  node.style.width = `${Math.max(0, width)}px`;
  node.style.height = `${Math.max(0, height)}px`;
}

function onKeydown(event) {
  if (!active) return;
  // Inside a form or a dialog the keys belong to the app (Esc closes the dialog, arrows move a cursor).
  if (document.querySelector("dialog[open]") || event.target.closest?.("input, textarea, select")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    stopTour("exit");
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    next();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    back();
  }
}

async function waitForElement(spec, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const element = resolveTarget(spec);
    if (element) return element;
    await sleep(100);
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/"/g, '\\"');
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
