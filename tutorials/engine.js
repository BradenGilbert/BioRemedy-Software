// Guided tours (Phase 24, 2026-09-28): the overlay that walks a person through the real screens.
//
// Content lives in tutorials/registry.js; this file only knows how to show a step. The host (app.js)
// hands in the few things a tour needs from the app -- the current view, how to open a view or a tab,
// whether this person may open a view, and where to save progress -- through initTours().
//
// A step is { view?, tab?, target?, title, do, why?, chain?, waitFor? }:
//   view     -- the view to open first (skipped, with the step, when this person cannot open it)
//   tab      -- { action, tab }: the detail-page tab button to press first
//   target   -- a data-tour name, or a list of them (the first visible one wins). None: a centred card.
//   chain    -- the business chain shown as chips, the names in `highlight` emphasised
//   waitFor  -- "click" (the person must press the highlighted element) or "route:<view>"
//
// The shade is four panels around the target, so a click can only land on the target or the card.

const TARGET_WAIT_MS = 1500;
const PAD = 6;

let host = null;
let active = null; // { tour, index, element, waiting, onClick }
let layer = null;
let repositionFrame = 0;

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
  active = { tour, index: -1, element: null, waiting: false, onClick: null };
  layer.hidden = false;
  document.body.classList.add("tour-running");
  window.addEventListener("resize", scheduleReposition);
  window.addEventListener("scroll", scheduleReposition, true);
  document.addEventListener("keydown", onKeydown, true);
  host.saveProgress?.(tour.id, { status: "in-progress", lastStep: startAt });
  goTo(startAt, 1);
}

export function stopTour(reason = "exit") {
  if (!active) return;
  const { tour, index } = active;
  detachClickWait();
  active = null;
  if (layer) layer.hidden = true;
  document.body.classList.remove("tour-running");
  window.removeEventListener("resize", scheduleReposition);
  window.removeEventListener("scroll", scheduleReposition, true);
  document.removeEventListener("keydown", onKeydown, true);
  if (reason === "done") host.saveProgress?.(tour.id, { status: "done", lastStep: tour.steps.length - 1 });
  else if (reason === "exit") host.saveProgress?.(tour.id, { status: "exited", lastStep: Math.max(0, index) });
  host.onTourEnd?.(tour, reason);
}

// app.js calls this after every render(): innerHTML replaced the old target, so find it again.
export function notifyRender() {
  if (!active || active.navigating) return;
  const step = active.tour.steps[active.index];
  if (!step) return;
  if (active.waiting && typeof step.waitFor === "string" && step.waitFor.startsWith("route:")) {
    if (host.currentView() === step.waitFor.slice(6)) {
      goTo(active.index + 1, 1);
      return;
    }
  }
  // Something other than the tour changed the page (browser back, a hash link): put the step back.
  if (step.view && host.currentView() !== step.view && !active.waiting) {
    showStep(active.index);
    return;
  }
  locateAndPlace(step);
}

// ---- stepping -------------------------------------------------------------------------------

function goTo(index, direction) {
  if (!active) return;
  const steps = active.tour.steps;
  let next = index;
  // Skip steps whose view this person cannot open (a Sales tour step on the Rate Card, for a role
  // that has no Rate Card), in the direction of travel.
  while (next >= 0 && next < steps.length && steps[next].view && !host.canView(steps[next].view)) next += direction;
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
  locateAndPlace(step);
}

function next() {
  if (!active) return;
  if (active.waiting) return;
  goTo(active.index + 1, 1);
}

function back() {
  if (!active || active.index <= 0) return;
  goTo(active.index - 1, -1);
}

// ---- finding the target ---------------------------------------------------------------------

function findTarget(step) {
  const names = Array.isArray(step.target) ? step.target : step.target ? [step.target] : [];
  for (const name of names) {
    const candidates = document.querySelectorAll(`[data-tour="${cssEscape(name)}"]`);
    for (const element of candidates) if (isVisible(element)) return element;
  }
  return null;
}

function isVisible(element) {
  if (!element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  const style = getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

function locateAndPlace(step) {
  const token = {};
  active.locateToken = token;
  if (!step.target) {
    layer.dataset.tourStatus = "card";
    place(null);
    return;
  }
  const started = performance.now();
  const attempt = () => {
    if (!active || active.locateToken !== token) return;
    const element = findTarget(step);
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
      active.waiting = false;
      updateWaitState(step);
      place(null);
      return;
    }
    setTimeout(attempt, 50);
  };
  attempt();
}

// Desktop: centre the target. Phone: the card is a sheet over the bottom half, so put the top of the
// target just under the (sticky) app header instead, where the sheet cannot cover it.
function bringIntoView(element) {
  const rect = element.getBoundingClientRect();
  const vh = window.innerHeight;
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
      <div class="tour-actions">
        <button type="button" class="text-button" data-tour-act="exit">Exit tour</button>
        <span class="tour-actions-spacer"></span>
        <button type="button" class="secondary-button" data-tour-act="back">Back</button>
        <button type="button" class="primary-button" data-tour-act="next">Next</button>
      </div>
    </section>
  `;
  layer.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tour-act]");
    if (!button) return;
    event.stopPropagation();
    const act = button.dataset.tourAct;
    if (act === "exit") stopTour("exit");
    if (act === "back") back();
    if (act === "next") next();
  });
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
  const isLast = index >= total - 1;
  card.querySelector('[data-tour-act="back"]').hidden = index === 0;
  card.querySelector('[data-tour-act="next"]').textContent = isLast ? "Finish" : "Next";
  updateWaitState(step);
  requestAnimationFrame(() => card.querySelector('[data-tour-act="next"]')?.focus({ preventScroll: true }));
}

function updateWaitState(step) {
  const card = layer.querySelector(".tour-card");
  const wait = card.querySelector(".tour-wait");
  const waiting = Boolean(active?.waiting);
  wait.hidden = !waiting;
  wait.textContent = waiting ? (step.waitFor === "click" ? "Press the highlighted control to carry on." : "Open the highlighted page to carry on.") : "";
  card.querySelector('[data-tour-act="next"]').disabled = waiting;
}

function scheduleReposition() {
  if (!active || repositionFrame) return;
  repositionFrame = requestAnimationFrame(() => {
    repositionFrame = 0;
    if (!active) return;
    if (active.element && !active.element.isConnected) {
      locateAndPlace(active.tour.steps[active.index]);
      return;
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
    card.classList.remove("is-sheet");
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

  card.classList.remove("is-centred");
  // Phone width: the card docks to the bottom edge as a sheet; the target was scrolled to centre.
  if (vw < 640) {
    card.classList.add("is-sheet");
    card.style.left = "";
    card.style.top = "";
    return;
  }
  card.classList.remove("is-sheet");
  const cardRect = card.getBoundingClientRect();
  const gap = 14;
  let cardTop;
  if (bottom + gap + cardRect.height <= vh - 8) cardTop = bottom + gap;
  else if (top - gap - cardRect.height >= 8) cardTop = top - gap - cardRect.height;
  else cardTop = Math.max(8, vh - cardRect.height - 8);
  let cardLeft = Math.min(Math.max(8, rect.left), vw - cardRect.width - 8);
  // Neither above nor below fits: sit beside the target instead of on top of it.
  if (cardTop < bottom && cardTop + cardRect.height > top) {
    if (right + gap + cardRect.width <= vw - 8) cardLeft = right + gap;
    else if (left - gap - cardRect.width >= 8) cardLeft = left - gap - cardRect.width;
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
  if (document.querySelector("dialog[open]")) return;
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

function cssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/"/g, '\\"');
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
