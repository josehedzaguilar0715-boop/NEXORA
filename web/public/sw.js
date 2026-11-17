// Guarda la app para abrirla sin internet. Las llamadas a la API no se guardan aquí (las maneja la cola local).
const CACHE = 'nexora-v1'
const SHELL = (p) => p === '/' || p === '/index.html' || p.startsWith('/assets/')
self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/'])))
})
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || !SHELL(url.pathname)) return
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone()
        caches.open(CACHE).then((c) => c.put(e.request, copy))
        return r
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/'))),
  )
})
