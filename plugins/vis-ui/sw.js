/* The portamp console, installable.
 *
 * The shell is cached so the console opens instantly; the run itself is never
 * served stale on purpose: run.json and everything under /shots and /source is
 * network first, cache as the fallback, because a report that silently shows
 * yesterday's run is worse than one that says it cannot reach the server. */
const SHELL = "portamp-shell-v1";
const SHELL_PATHS = ["/", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_PATHS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  if (SHELL_PATHS.includes(url.pathname) || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(event.request).then((hit) => hit ?? fetch(event.request).then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((cache) => cache.put(event.request, copy));
        return res;
      }))
    );
    return;
  }

  // Data: the network's answer or the last one it gave, clearly in that order.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
