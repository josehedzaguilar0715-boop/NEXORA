// Guarda la app para abrirla sin internet. Las llamadas a la API no se guardan aquí (las maneja la cola local).
const CACHE = 'nexora-v3'
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

// Avisos del negocio (Web Push sin contenido): se pide el aviso más reciente con la sesión guardada.
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let n = null
    try {
      const r = await (await caches.open('nx-auth')).match('/__nx_token')
      const token = r && (await r.text())
      if (token) {
        const res = await fetch('/api/notifications/latest', { headers: { authorization: 'Bearer ' + token } })
        if (res.ok) n = (await res.json()).notice
      }
    } catch (_) { /* sin red: aviso genérico */ }
    await self.registration.showNotification(n ? n.title : 'NEXORA', {
      body: n ? n.body || '' : 'Tienes un aviso nuevo de tu negocio.',
      icon: '/icon-192.png', badge: '/favicon-32.png', tag: n ? n.id : 'nexora', data: { link: n && n.link ? n.link : '' },
    })
  })())
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = '/' + ((e.notification.data && e.notification.data.link) || '')
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { if ('navigate' in c) c.navigate(url).catch(() => {}); return c.focus() }
    return self.clients.openWindow(url)
  }))
})

// El navegador renueva la suscripción de vez en cuando: se vuelve a registrar sola, sin que nadie tenga que activar nada.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const r = await (await caches.open('nx-auth')).match('/__nx_token')
      const token = r && (await r.text())
      if (!token) return
      const auth = { authorization: 'Bearer ' + token }
      let key = e.oldSubscription && e.oldSubscription.options && e.oldSubscription.options.applicationServerKey
      if (!key) {
        const k = await (await fetch('/api/push/key', { headers: auth })).json()
        const b64 = k.publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (k.publicKey.length % 4)) % 4)
        key = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      }
      const sub = e.newSubscription || (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }))
      await fetch('/api/push/subscribe', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) })
    } catch (_) { /* se reintenta la próxima vez que se abra la app */ }
  })())
})
