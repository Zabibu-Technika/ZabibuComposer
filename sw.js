// Offline-first service worker.
// Bump CACHE whenever the app shell or any precached file changes.
const CACHE = "zabibu-composer-v7";
const APP_SHELL = "index.html";

const ASSETS = [
  "./",
  "index.html",
  "css/app.css",
  "js/app.js",
  "js/config.js",
  "js/state.js",
  "js/audio.js",
  "js/render.js",
  "js/samples.js",
  "js/arpeggios.js",
  "js/export.js",
  "vendor/lame.min.js",
  "vendor/mp4-muxer.mjs",
  "vendor/LICENSES.md",
  "assets/composer-mark.svg",
  "assets/favicon.svg",
  "assets/icon-32.png",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/apple-touch-icon.png",
  "assets/og-composer.png",
  "favicon.ico",
  "manifest.webmanifest",
  "robots.txt",
  "sitemap.xml",
  "llms.txt",
];

const OFFLINE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zabibu Composer — offline</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#faf8f3;color:#1a1815;font:16px/1.6 ui-sans-serif,system-ui,sans-serif;text-align:center;padding:24px}strong{color:#b42313}</style>
</head><body><div><h1>Zabibu Composer</h1><p><strong>You are offline.</strong> Open this page once with a connection to install the full instrument, then it works anywhere.</p></div></body></html>`;

// Hosting providers (Vercel included) compress HTML with brotli/gzip. A cached
// response keeps the Content-Encoding header even though the body handed to the
// service worker is already decoded, which makes replays fail with
// net::ERR_FAILED. Strip the transport headers before storing or serving.
async function cleanResponse(response) {
  if (!response) return response;
  const headers = new Headers(response.headers);
  const encoded = headers.has("content-encoding") || headers.has("transfer-encoding");
  if (!encoded) return response;
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function store(cache, request, response) {
  try {
    await cache.put(request, await cleanResponse(response));
  } catch (err) {
    /* a failed cache write must never break the response */
  }
}

async function precache() {
  const cache = await caches.open(CACHE);
  await Promise.all(
    ASSETS.map(async (url) => {
      try {
        const response = await fetch(new Request(url, { cache: "reload" }));
        if (response && response.ok) await store(cache, url, response);
      } catch (err) {
        /* keep going: one missing asset should not block install */
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function offlinePage() {
  return new Response(OFFLINE_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function refreshShell(request, cache) {
  try {
    const response = await fetch(request);
    if (response && response.ok) await store(cache, APP_SHELL, response.clone());
  } catch (err) {
    /* offline: the cached shell is already on screen */
  }
}

async function handleNavigation(event, url) {
  const isShell = url.pathname === "/" || url.pathname === "/index.html";
  try {
    const cache = await caches.open(CACHE);
    if (!isShell) {
      // Deep links and plain text files: try the network, fall back to cache.
      const cached = await cache.match(event.request, { ignoreSearch: true });
      try {
        const response = await fetch(event.request);
        if (response && response.ok) return response;
      } catch (err) {
        /* offline */
      }
      return cached ? await cleanResponse(cached) : offlinePage();
    }

    const cached = (await cache.match(APP_SHELL)) || (await cache.match("./"));
    if (cached) {
      event.waitUntil(refreshShell(event.request, cache));
      return await cleanResponse(cached);
    }
    const response = await fetch(event.request);
    if (response && response.ok) await store(cache, APP_SHELL, response.clone());
    return response;
  } catch (err) {
    return offlinePage();
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(handleNavigation(event, url));
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(event.request, { ignoreSearch: true });
        if (cached) return await cleanResponse(cached);
        const response = await fetch(event.request);
        if (response && response.ok) await store(cache, event.request, response.clone());
        return response;
      } catch (err) {
        return new Response("", { status: 504, statusText: "Offline" });
      }
    })()
  );
});
