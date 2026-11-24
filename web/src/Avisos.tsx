import { Bell } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, auth, everyVisible, fechaHora } from './api'

/**
 * Avisos del negocio: campana con contador, panel con la lista y opción de recibirlos en el celular (Web Push).
 * El service worker no puede leer la sesión del navegador, así que se le deja en Cache Storage.
 */

export interface Notice { id: string; kind: string; title: string; body: string | null; link: string | null; createdAt: string; unread: boolean }
export interface Notices { items: Notice[]; unread: number; push: boolean }

const AUTH_CACHE = 'nx-auth'
const TOKEN_URL = '/__nx_token'

async function shareTokenWithWorker() {
  if (!('caches' in window) || !auth.token) return
  try { await (await caches.open(AUTH_CACHE)).put(TOKEN_URL, new Response(auth.token)) } catch { /* sin Cache Storage */ }
}

/**
 * Al salir: el celular deja de recibir los avisos de ESTA cuenta (el servidor la desliga del celular).
 * El permiso y la suscripción del navegador se conservan: al volver a entrar, los avisos se reactivan solos.
 */
export async function forgetPush() {
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    const sub = await reg?.pushManager?.getSubscription()
    if (sub) await api('POST', '/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {})
    if ('caches' in window) await caches.delete(AUTH_CACHE)
  } catch { /* nada que limpiar */ }
}

export const pushSupport = (): 'ok' | 'instalar' | 'no' => {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) {
    // iPhone: solo funciona con NEXORA agregada a la pantalla de inicio.
    return /iphone|ipad/i.test(navigator.userAgent) ? 'instalar' : 'no'
  }
  return 'PushManager' in window ? 'ok' : /iphone|ipad/i.test(navigator.userAgent) ? 'instalar' : 'no'
}

const toKey = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

/**
 * Si este celular ya dio permiso alguna vez, se vuelve a suscribir solo (sin preguntar) al entrar o abrir la app.
 * Así nadie tiene que «activar» las notificaciones cada vez: cerrar sesión, una suscripción vencida o renovada
 * por el navegador se arreglan solas.
 */
export async function syncPush(): Promise<boolean> {
  try {
    if (pushSupport() !== 'ok' || Notification.permission !== 'granted' || !auth.token) return false
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'))
    await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      const { publicKey } = await api<{ publicKey: string }>('GET', '/push/key')
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) })
    }
    await shareTokenWithWorker()
    await api('POST', '/push/subscribe', { endpoint: sub.endpoint })
    return true
  } catch { return false }
}

export async function enablePush() {
  if (pushSupport() !== 'ok') throw new Error('Este navegador no puede recibir avisos.')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Permite las notificaciones de NEXORA en los ajustes del navegador para recibir avisos.')
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'))
  await navigator.serviceWorker.ready
  const { publicKey } = await api<{ publicKey: string }>('GET', '/push/key')
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }))
  await shareTokenWithWorker()
  await api('POST', '/push/subscribe', { endpoint: sub.endpoint })
  await api('POST', '/notifications/test')
}

/** Revisa los avisos cada 30 s; si llega uno nuevo con la app abierta, lo muestra un momento. */
export function useNotices(userId: string | undefined) {
  const [data, setData] = useState<Notices | null>(null)
  const [toast, setToast] = useState<Notice | null>(null)
  const lastSeen = useRef<string | null>(null)
  const load = async () => {
    const r = await api<Notices>('GET', '/notifications')
    const newest = r.items[0]
    if (newest && newest.unread && lastSeen.current !== null && newest.createdAt > lastSeen.current) {
      setToast(newest)
      setTimeout(() => setToast((t) => (t?.id === newest.id ? null : t)), 7000)
    }
    lastSeen.current = newest?.createdAt ?? ''
    setData(r)
    if (r.push) void shareTokenWithWorker()
  }
  useEffect(() => {
    if (!userId) return
    lastSeen.current = null
    // Avisos al celular: si ya hay permiso, se reactivan solos antes de la primera consulta.
    void syncPush().finally(() => void load().catch(() => {}))
    return everyVisible(() => load().catch(() => {}), 30_000)
  }, [userId])
  return { data, reload: load, toast, closeToast: () => setToast(null) }
}

export function BellButton({ unread, onClick }: { unread: number; onClick: () => void }) {
  return (
    <button type="button" className="bell-btn" onClick={(e) => { e.stopPropagation(); onClick() }} aria-label={unread ? `Avisos: ${unread} sin leer` : 'Avisos'} data-testid="campana">
      <Bell size={20} aria-hidden />
      {unread > 0 && <span className="bell-count">{unread > 9 ? '9+' : unread}</span>}
    </button>
  )
}

const ICON: Record<string, string> = { comanda: '🍽️', listo: '✅', cita: '📅', stock: '📦', cancelacion: '↩️', corte: '💵', prueba: '🔔' }

export function AvisosPanel({ data, onClose, reload }: { data: Notices | null; onClose: () => void; reload: () => Promise<void> }) {
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const [busy, setBusy] = useState(false)
  const support = pushSupport()
  useEffect(() => { void api('POST', '/notifications/seen').catch(() => {}) }, [])
  const activate = async () => {
    setBusy(true); setMsg({})
    try { await enablePush(); setMsg({ ok: 'Listo: los avisos llegarán a este celular aunque NEXORA esté cerrada.' }); await reload() } catch (e) { setMsg({ err: (e as Error).message }) } finally { setBusy(false) }
  }
  const go = (n: Notice) => { if (n.link) location.hash = n.link; onClose() }
  return (
    <div className="modal sheet" onClick={onClose}>
      <div className="card avisos" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h2>Avisos</h2><button className="mini" onClick={onClose}>Cerrar</button></div>
        {data && !data.push && support !== 'no' && (
          <div className="push-cta">
            <div><b>Recibe los avisos en tu celular</b><small className="muted">{support === 'instalar' ? 'En iPhone: toca Compartir → «Agregar a inicio», abre NEXORA desde ahí y activa los avisos.' : 'Pedidos, citas, stock bajo y cortes, aunque NEXORA esté cerrada.'}</small></div>
            {support === 'ok' && <button className="primary" disabled={busy} onClick={() => void activate()}>{busy ? 'Activando…' : 'Activar'}</button>}
          </div>
        )}
        {data?.push && <p className="muted small">Este usuario recibe los avisos en su celular.</p>}
        {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
        <ul className="notice-list">
          {data?.items.map((n) => (
            <li key={n.id} className={n.unread ? 'unread' : ''}>
              <button type="button" onClick={() => go(n)}>
                <span className="n-icon" aria-hidden>{ICON[n.kind] ?? '🔔'}</span>
                <span className="n-text"><b>{n.title}</b>{n.body && <small>{n.body}</small>}<small className="muted">{fechaHora(n.createdAt)}</small></span>
              </button>
            </li>
          ))}
        </ul>
        {data && data.items.length === 0 && <p className="muted">Sin avisos por ahora. Aquí verás pedidos, citas, stock bajo y cortes de caja.</p>}
      </div>
    </div>
  )
}

export function NoticeToast({ n, onOpen, onClose }: { n: Notice; onOpen: () => void; onClose: () => void }) {
  return (
    <div className="notice-toast" role="status">
      <button type="button" className="nt-body" onClick={onOpen}><span aria-hidden>{ICON[n.kind] ?? '🔔'}</span><span><b>{n.title}</b>{n.body && <small>{n.body}</small>}</span></button>
      <button type="button" className="mini" aria-label="Cerrar aviso" onClick={onClose}>✕</button>
    </div>
  )
}
