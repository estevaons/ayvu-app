// Modo offline: guarda as telas do app para ele abrir sem internet e tocar os livros baixados.
// Registrado também no APK, que carrega o site publicado (ver components/Providers.tsx).
const CACHE = "ayvu-v1";

// Caminhos estáveis, sem hash no nome. Uma falha aqui não pode derrubar a instalação.
const ROUTES = ["/", "/library/", "/book/", "/add/", "/settings/", "/login/", "/offline.html", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(ROUTES.map((route) => cache.add(route)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // "ayvu-audio-*" é o cache dos áudios baixados no navegador: nunca apagar aqui.
    await Promise.all(keys.filter((k) => k.startsWith("ayvu-v") && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Arquivos com hash no nome: servir do cache é sempre seguro.
const immutable = (url) => url.pathname.startsWith("/_next/static/");

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Supabase e Modal são de outra origem; arquivos locais do Capacitor e pedidos com Range
  // (áudio) passam direto.
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/_capacitor") ||
    url.pathname.startsWith("/offline-audio/") ||
    request.headers.has("range")
  ) return;

  if (immutable(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) void cache.put(request, response.clone());
      return response;
    })());
    return;
  }

  // Páginas vão à rede primeiro, para um deploy novo aparecer na hora.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok && request.mode === "navigate") void cache.put(url.pathname, response.clone());
      return response;
    } catch {
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
      return request.mode === "navigate"
        ? (await cache.match("/offline.html")) || Response.error()
        : Response.error();
    }
  })());
});
