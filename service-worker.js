const CACHE_NAME = "environmental-crm-shell-v41";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./public/favicon.svg",
  "./public/brand/bioremedy-logo-primary.png",
  "./public/brand/bioremedy-logo-primary-reversed.png",
  "./public/brand/bioremedy-leaf-icon.png",
  "./public/vendor/leaflet/leaflet.css",
  "./public/vendor/leaflet/leaflet.js",
  "./public/vendor/three/three.module.js",
  "./public/vendor/three/addons/loaders/GLTFLoader.js",
  "./public/vendor/three/addons/controls/OrbitControls.js",
  "./public/vendor/three/addons/utils/BufferGeometryUtils.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
