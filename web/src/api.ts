// Cliente de la API y cola local para trabajar sin internet.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

const TOKEN = 'nx_token'
export const auth = {
  get token() {
    return localStorage.getItem(TOKEN)
  },
  set(t: string | null) {
    if (t) localStorage.setItem(TOKEN, t)
    else localStorage.removeItem(TOKEN)
  },
}

export function deviceId(): string {
  let id = localStorage.getItem('nx_device')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('nx_device', id)
  }
  return id
}

export async function api<T = any>(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'sin_red', 'Sin conexión a internet.')
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? `Error ${res.status}`)
  return json as T
}

// ---------- Cola local ----------

export interface OutboxItem {
  id: string; method: string; path: string; body: unknown; createdAt: string; label: string
  status: 'pendiente' | 'enviado' | 'rechazado'; error?: string; result?: any
}
const OUTBOX = 'nx_outbox'
const listeners = new Set<() => void>()
function read(): OutboxItem[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX) ?? '[]')
  } catch {
    return []
  }
}
function write(items: OutboxItem[]) {
  // Lo enviado se conserva un tiempo para consulta; lo pendiente o rechazado nunca se descarta.
  const sent = items.filter((i) => i.status === 'enviado').slice(-200)
  localStorage.setItem(OUTBOX, JSON.stringify(items.filter((i) => i.status !== 'enviado').concat(sent)))
  listeners.forEach((l) => l())
}

export const outbox = {
  items: read,
  pending: () => read().filter((i) => i.status === 'pendiente').length,
  rejected: () => read().filter((i) => i.status === 'rechazado'),
  get: (id: string) => read().find((i) => i.id === id),
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => void listeners.delete(fn)
  },
  enqueue(method: string, path: string, body: unknown, label: string, id: string = crypto.randomUUID()): string {
    write([...read(), { id, method, path, body, label, createdAt: new Date().toISOString(), status: 'pendiente' }])
    return id
  },
  /** Marcar un rechazo como revisado (se conserva en el historial). */
  dismiss(id: string) {
    write(read().map((i) => (i.id === id ? { ...i, status: 'enviado' as const, error: `${i.error ?? ''} (revisado)` } : i)))
  },
}

let flushing: Promise<void> | null = null
/** Envía en orden. Sin red, error del servidor, sesión o cuenta vencida: se detiene y todo queda pendiente. */
export function flush(): Promise<void> {
  if (flushing) return flushing
  flushing = (async () => {
    for (const item of read().filter((i) => i.status === 'pendiente')) {
      try {
        const result = await api(item.method, item.path, item.body, { 'idempotency-key': item.id })
        write(read().map((i) => (i.id === item.id ? { ...i, status: 'enviado', result } : i)))
      } catch (e) {
        const err = e as ApiError
        if (err.status === 0 || err.status >= 500 || [401, 402, 423].includes(err.status)) break
        write(read().map((i) => (i.id === item.id ? { ...i, status: 'rechazado', error: err.message } : i)))
      }
    }
  })().finally(() => {
    flushing = null
  })
  return flushing
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flush())
  setInterval(() => void flush(), 15_000)
}

// ---------- Utilidades ----------

export const mxn = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** "12.50" → 1250 centavos. */
export const toCents = (s: string) => Math.round(Number(String(s).replace(/[$,\s]/g, '')) * 100)
export const cache = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(`nx_c_${k}`)
      return v ? (JSON.parse(v) as T) : d
    } catch {
      return d
    }
  },
  set(k: string, v: unknown) {
    localStorage.setItem(`nx_c_${k}`, JSON.stringify(v))
  },
}

/** Horas siempre en formato de 12 horas («2:30 p.m.»), con la hora de México. */
const MX = 'America/Mexico_City'
export const hora = (d: string | Date) => new Date(d).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: MX })
export const fechaHora = (d: string | Date) => new Date(d).toLocaleString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: MX })
/** «14:00» → «2:00 p.m.» (el valor guardado sigue siendo de 24 horas). */
export function h12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '')
  if (!m) return hhmm
  const h = Number(m[1]) % 24
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'a.m.' : 'p.m.'}`
}

/** Identificador público del negocio para los enlaces de reservas y boletos (no es el código interno). */
let slugCache: string | null = null
export async function publicSlug(): Promise<string> {
  if (!slugCache) slugCache = (await api<{ slug: string }>('GET', '/business/public-link')).slug
  return slugCache
}
export const setPublicSlugCache = (s: string | null) => { slugCache = s }

/**
 * Antes de contar inventario o cerrar la carne: lo vendido en este equipo que no se ha enviado debe llegar primero.
 * Si no, el conteo compararía contra una existencia sin esas ventas, anotaría diferencias falsas y al enviarse
 * las ventas la existencia quedaría descontada dos veces.
 */
export async function ensureSynced(what = 'contar el inventario') {
  if (outbox.pending() === 0) return
  await flush()
  const n = outbox.pending()
  if (n > 0) throw new Error(`Hay ${n} ${n === 1 ? 'movimiento' : 'movimientos'} de este equipo sin enviar (ventas sin internet). Conéctate y espera a que diga «Todo enviado» antes de ${what}; si no, el conteo quedaría con diferencias falsas.`)
}
