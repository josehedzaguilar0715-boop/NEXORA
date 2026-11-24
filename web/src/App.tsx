import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type ComponentType, type CSSProperties } from 'react'
import { api, auth, cache, flush, outbox, setPublicSlugCache, everyVisible } from './api'
import { AvisosPanel, BellButton, forgetPush, NoticeToast, useNotices } from './Avisos'
import { Caja } from './screens/Caja'
import { Inicio } from './screens/Inicio'
import { Intro, Logo } from './Brand'
import { Login } from './screens/Login'
import {
  Archive, Armchair, Boxes, CalendarDays, ChevronRight, ChartColumn, ChefHat, ClipboardCheck, Clock, ClipboardList, DoorOpen, FileText, Flame, Gift, Landmark, LayoutDashboard,
  LifeBuoy, LogOut, Menu, Package, Percent, QrCode, ScanLine, Settings, ShoppingCart, SlidersHorizontal, Tag, Ticket, Truck, Undo2, Upload, UserCog, Users, UtensilsCrossed,
} from 'lucide-react'

/**
 * Cada pantalla se descarga cuando se abre (la app arranca más rápido, sobre todo en celular).
 * Después de entrar, el resto se descarga en segundo plano para que todo funcione sin internet.
 */
const loaders: (() => Promise<unknown>)[] = []
function lazyNamed<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  loaders.push(load)
  return lazy(async () => ({ default: (await load())[name] as ComponentType<any> }))
}
export function preloadScreens() {
  const run = () => { for (const l of loaders) void l().catch(() => {}) }
  if ('requestIdleCallback' in window) (window as any).requestIdleCallback(run, { timeout: 4000 }); else setTimeout(run, 1500)
}
const Clientes = lazyNamed(() => import('./screens/Clientes'), 'Clientes')
const Compras = lazyNamed(() => import('./screens/Compras'), 'Compras')
const Cotizaciones = lazyNamed(() => import('./screens/Cotizaciones'), 'Cotizaciones')
const Devoluciones = lazyNamed(() => import('./screens/Devoluciones'), 'Devoluciones')
const Encargos = lazyNamed(() => import('./screens/Encargos'), 'Encargos')
const Agenda = lazyNamed(() => import('./screens/Agenda'), 'Agenda')
const Entradas = lazyNamed(() => import('./screens/Entradas'), 'Entradas')
const MiTarjeta = lazyNamed(() => import('./screens/MiTarjeta'), 'MiTarjeta')
const Descargar = lazyNamed(() => import('./screens/Descargar'), 'Descargar')
const Acceso = lazyNamed(() => import('./screens/Taquilla'), 'Acceso')
const MisBoletos = lazyNamed(() => import('./screens/Taquilla'), 'MisBoletos')
const Taquilla = lazyNamed(() => import('./screens/Taquilla'), 'Taquilla')
const TiendaBoletos = lazyNamed(() => import('./screens/Taquilla'), 'TiendaBoletos')
const Cocina = lazyNamed(() => import('./screens/Mesas'), 'Cocina')
const Mesas = lazyNamed(() => import('./screens/Mesas'), 'Mesas')
const Pedidos = lazyNamed(() => import('./screens/Mesas'), 'Pedidos')
const MenuDia = lazyNamed(() => import('./screens/MenuDia'), 'MenuDia')
const Trompo = lazyNamed(() => import('./screens/Trompo'), 'Trompo')
const CierreDia = lazyNamed(() => import('./screens/Verduleria'), 'CierreDia')
const PrecioDia = lazyNamed(() => import('./screens/Verduleria'), 'PrecioDia')
const Ajustes = lazyNamed(() => import('./screens/Ajustes'), 'Ajustes')
const Buzon = lazyNamed(() => import('./screens/Ajustes'), 'Buzon')
const Escanear = lazyNamed(() => import('./screens/Lealtad'), 'Escanear')
const Lealtad = lazyNamed(() => import('./screens/Lealtad'), 'Lealtad')
const SuperPanel = lazyNamed(() => import('./screens/SuperPanel'), 'SuperPanel')
const Privacidad = lazyNamed(() => import('./screens/Privacidad'), 'Privacidad')
const Comisiones = lazyNamed(() => import('./screens/Comisiones'), 'Comisiones')
const EstadoCita = lazyNamed(() => import('./screens/Reservar'), 'EstadoCita')
const Reservar = lazyNamed(() => import('./screens/Reservar'), 'Reservar')
const Productos = lazyNamed(() => import('./screens/Productos'), 'Productos')
const Reportes = lazyNamed(() => import('./screens/Reportes'), 'Reportes')
const MiAsistencia = lazyNamed(() => import('./screens/Usuarios'), 'MiAsistencia')
const Usuarios = lazyNamed(() => import('./screens/Usuarios'), 'Usuarios')
const Finanzas = lazyNamed(() => import('./screens/Finanzas'), 'Finanzas')
const Importar = lazyNamed(() => import('./screens/Importar'), 'Importar')
const Configurar = lazyNamed(() => import('./screens/Configurar'), 'Configurar')
const Apartados = lazyNamed(() => import('./screens/Apartados'), 'Apartados')

export interface Me {
  user: { id: string; name: string; phone?: string | null; role: 'owner' | 'staff'; position?: 'dueno' | 'encargado' | 'empleado'; branchId: string | null; mustChangePassword: boolean }
  permissions: 'todos' | string[]
  business: { id: string; code: string; name: string; phone: string | null; status: string; giro: string; giros?: string[]; trialEndsAt?: string | null; paidUntil?: string | null; free?: number }
  settings?: Record<string, any>
  modules?: string[]
}
/** 'owner' = solo el dueño. Un permiso no marcado no aparece en pantalla. */
/** Giros que manejan fiado o cuenta de crédito (spec: abarrotes, ferretería, papelería, comedor y verdulería). */
import { FIADO_GIROS, vocab } from './giros'
import { applyProduct, productOf } from './products'
export { FIADO_GIROS }

/** ¿El negocio tiene alguno de estos giros? (negocio mixto: principal + adicionales) */
export const hasGiro = (me: Me, ...g: string[]) => (me.business.giros ?? [me.business.giro]).some((x) => g.includes(x))
/** Ver reportes lo tiene todo usuario (solo lectura), igual que en el servidor. */
/** Acepta varios permisos separados por «|» (basta uno). */
export const can = (me: Me, p: string): boolean => (p.includes('|') ? p.split('|').some((x) => can(me, x)) : p === 'owner' ? me.user.role === 'owner' : p === 'staff' || me.permissions === 'todos' || me.permissions.includes(p))

type Icon = import('lucide-react').LucideIcon
export type Screen = { key: string; label: string; perm: string; C: ComponentType<{ me: Me }>; giros?: string[]; group: string; icon: Icon; ownTitle?: boolean; desc?: string }
/** Portales del menú: cada uno abre un panel con sus opciones (lo de todos los días arriba, la administración al final). */
const PORTALS: { group: string; label: string; icon: Icon }[] = [
  { group: 'Operación', label: 'Vender', icon: ShoppingCart },
  { group: 'Inventario', label: 'Inventario', icon: Boxes },
  { group: 'Clientes', label: 'Clientes', icon: Users },
  { group: 'Finanzas', label: 'Dinero', icon: Landmark },
  { group: 'Administración', label: 'Mi negocio', icon: Settings },
]
/** Cada portal con su color de ícono, para ubicarse de un vistazo (lo demás es neutro). */
// Los colores reales viven en CSS (--tone-*), así cada producto tiene los suyos.
export const TONE: Record<string, string> = { '': 'var(--tone-main)', Operación: 'var(--tone-op)', Inventario: 'var(--tone-inv)', Clientes: 'var(--tone-cli)', Finanzas: 'var(--tone-fin)', Administración: 'var(--tone-adm)' }
export const toneStyle = (group: string) => ({ '--tone': TONE[group] ?? TONE[''] }) as CSSProperties
export const portalOf = (group: string) => PORTALS.find((p) => p.group === group)?.label ?? group

/** Una línea de qué hace cada opción, con las palabras de cada giro. */
function descFor(me: Me, key: string): string | undefined {
  const v = vocab(me)
  const mods = me.modules ?? []
  switch (key) {
    case 'agenda': return `Citas del día y por ${v.staff}`
    case 'mesas': return hasGiro(me, 'palapa') ? 'Cuentas por mesa, reservas y rentas' : 'Cuentas por mesa y reservas'
    case 'clientes': return [v.fiado ? 'Lista y saldo de fiado' : 'Lista de clientes', mods.includes('fidelidad') ? 'sellos y su QR' : mods.includes('membresias') ? 'membresías' : ''].filter(Boolean).join(', ')
    case 'comisiones': if (!hasGiro(me, 'barberia', 'unas', 'perfumeria')) return 'Propinas por mesero: por pagar y pagadas'
      return v.tips ? 'Comisiones y propinas del personal' : 'Comisiones del personal'
    case 'configurar': return v.food ? 'Mesas, estaciones de cocina y catálogo' : v.agenda ? 'Servicios, horarios y catálogo' : hasGiro(me, 'banos', 'turistico') ? 'Tarifas, servicios y catálogo' : 'Catálogo, categorías y opciones'
    case 'escanear': { const s = [mods.includes('fidelidad') && 'dar sello', mods.includes('asistencia') && 'registrar entrada', mods.includes('membresias') && 'usar membresía'].filter(Boolean).join(', '); return s ? s[0]!.toUpperCase() + s.slice(1) : DESC[key] }
    case 'lealtad': return mods.includes('fidelidad') ? 'Tarjeta de sellos, premios y promociones' : 'Membresías y promociones'
    default: return DESC[key]
  }
}
const DESC: Record<string, string> = {
  caja: 'Cobrar, abrir y cerrar caja, cortes', agenda: 'Citas del día y por barbero o técnica', entradas: 'Cobrar la entrada y ver aforo',
  taquilla: 'Vender boletos y cortes de taquilla', acceso: 'Validar boletos con QR', mesas: 'Cuentas por mesa, reservas y rentas',
  pedidos: 'Para llevar, para recoger y por teléfono', cocina: 'Comandas por estación', menu: 'Publicar lo de hoy y marcar agotados',
  carne: 'Trompo o asada: lo que se pone y el sobrante', apartados: 'Apartados con anticipo y abonos', cotizaciones: 'Cotizar y convertir en venta',
  encargos: 'Trabajos con anticipo', devoluciones: 'Con ticket y código', escanear: 'Dar sello, registrar entrada o usar membresía',
  productos: 'Altas, precios, existencias y mayoreo', precios: 'Actualizar el precio de hoy', compras: 'Lo que compras a proveedores',
  cierre: 'Merma y conteo al cerrar', clientes: 'Lista, saldo, sellos y su QR', lealtad: 'Tarjeta de sellos, premios, rifa y promociones',
  finanzas: 'Estado de resultados, gastos y contabilidad', reportes: 'Ventas del periodo y retiro sugerido', comisiones: 'Comisiones y propinas del personal',
  configurar: 'Servicios, mesas, horarios y catálogo', asistencia: 'Mi entrada y salida', usuarios: 'Empleados, permisos y horarios',
  buzon: 'Dudas y solicitudes a soporte', importar: 'Traer datos de Excel u otro sistema', ajustes: 'Datos del negocio, módulos e instalar en otros equipos',
}
const SCREENS: Screen[] = [
  { key: 'inicio', label: 'Inicio', perm: 'staff', C: Inicio, group: '', icon: LayoutDashboard, ownTitle: true },
  { key: 'caja', label: 'Caja', perm: 'sell', C: Caja, group: 'Operación', icon: ShoppingCart },
  { key: 'agenda', label: 'Agenda', perm: 'sell', C: Agenda, giros: ['barberia', 'unas'], group: 'Operación', icon: CalendarDays },
  { key: 'entradas', label: 'Entradas', perm: 'sell', C: Entradas, giros: ['banos'], group: 'Operación', icon: DoorOpen },
  { key: 'taquilla', label: 'Taquilla', perm: 'sell', C: Taquilla, giros: ['turistico'], group: 'Operación', icon: Ticket },
  { key: 'acceso', label: 'Acceso', perm: 'sell', C: Acceso, giros: ['turistico'], group: 'Operación', icon: ScanLine, ownTitle: true },
  { key: 'mesas', label: 'Mesas', perm: 'sell', C: Mesas, giros: ['palapa', 'restaurante', 'taqueria', 'comedor'], group: 'Operación', icon: Armchair },
  { key: 'pedidos', label: 'Pedidos', perm: 'sell', C: Pedidos, giros: ['restaurante', 'taqueria', 'comedor', 'verduleria'], group: 'Operación', icon: ClipboardList },
  { key: 'cocina', label: 'Cocina', perm: 'sell|kitchen', C: Cocina, giros: ['palapa', 'restaurante', 'taqueria', 'comedor'], group: 'Operación', icon: ChefHat },
  { key: 'menu', label: 'Menú del día', perm: 'sell', C: MenuDia, giros: ['comedor', 'taqueria', 'restaurante'], group: 'Operación', icon: UtensilsCrossed },
  { key: 'carne', label: 'Carne', perm: 'sell', C: Trompo, giros: ['taqueria'], group: 'Operación', icon: Flame },
  { key: 'apartados', label: 'Apartados', perm: 'sell', C: Apartados, giros: ['abarrotes'], group: 'Operación', icon: Archive },
  { key: 'cotizaciones', label: 'Cotizaciones', perm: 'sell', C: Cotizaciones, giros: ['ferreteria'], group: 'Operación', icon: FileText },
  { key: 'encargos', label: 'Encargos', perm: 'sell', C: Encargos, giros: ['papeleria'], group: 'Operación', icon: Package },
  { key: 'devoluciones', label: 'Devoluciones', perm: 'cancel_discount', C: Devoluciones, giros: ['ferreteria', 'perfumeria'], group: 'Operación', icon: Undo2 },
  { key: 'escanear', label: 'Escanear QR', perm: 'sell', C: Escanear, group: 'Clientes', icon: QrCode },
  { key: 'productos', label: 'Productos', perm: 'view_inventory', C: Productos, group: 'Inventario', icon: Boxes },
  { key: 'precios', label: 'Precio del día', perm: 'change_prices', C: PrecioDia, giros: ['verduleria', 'palapa', 'taqueria'], group: 'Inventario', icon: Tag },
  { key: 'compras', label: 'Compras', perm: 'edit_inventory', C: Compras, group: 'Inventario', icon: Truck },
  { key: 'cierre', label: 'Cierre del día', perm: 'edit_inventory', C: CierreDia, giros: ['verduleria', 'abarrotes'], group: 'Inventario', icon: ClipboardCheck },
  { key: 'clientes', label: 'Clientes y fiado', perm: 'customers_credit', C: Clientes, group: 'Clientes', icon: Users },
  { key: 'lealtad', label: 'Membresías y promos', perm: 'owner', C: Lealtad, group: 'Clientes', icon: Gift },
  { key: 'finanzas', label: 'Finanzas', perm: 'view_reports', C: Finanzas, group: 'Finanzas', icon: Landmark, ownTitle: true },
  { key: 'reportes', label: 'Ventas y retiro', perm: 'view_reports', C: Reportes, group: 'Finanzas', icon: ChartColumn },
  { key: 'comisiones', label: 'Comisiones', perm: 'view_commissions|cancel_discount', C: Comisiones, giros: ['barberia', 'unas', 'perfumeria', 'palapa', 'restaurante'], group: 'Finanzas', icon: Percent },
  { key: 'configurar', label: 'Configurar negocio', perm: 'configure_catalog', C: Configurar, group: 'Administración', icon: SlidersHorizontal },
  { key: 'asistencia', label: 'Mi asistencia', perm: 'attendance', C: MiAsistencia, group: 'Administración', icon: Clock },
  { key: 'usuarios', label: 'Personal', perm: 'create_employees', C: Usuarios, group: 'Administración', icon: UserCog },
  { key: 'buzon', label: 'Soporte', perm: 'owner', C: Buzon, group: 'Administración', icon: LifeBuoy },
  { key: 'importar', label: 'Importar datos', perm: 'owner', C: Importar, group: 'Administración', icon: Upload },
  { key: 'ajustes', label: 'Ajustes', perm: 'owner', C: Ajustes, group: 'Administración', icon: Settings },
]

function useHash() {
  const [h, setH] = useState(location.hash.slice(2))
  useEffect(() => {
    const on = () => setH(location.hash.slice(2))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return h
}

function PendingBadge({ main = false }: { main?: boolean }) {
  const pending = useSyncExternalStore(outbox.subscribe, outbox.pending)
  const rejected = useSyncExternalStore(outbox.subscribe, () => outbox.rejected().length)
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(navigator.onLine)
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on) }
  }, [])
  // Contador visible de lo que falta sincronizar.
  return (
    <button className={`pending ${pending || rejected ? '' : 'ok'}`} onClick={() => void flush()} title="Toca para enviar ahora" data-testid={main ? 'pendientes' : undefined}>
      {!online ? 'Sin internet · ' : ''}
      {pending ? `${pending} por enviar` : 'Todo enviado'}
      {rejected ? ` · ${rejected} con problema` : ''}
    </button>
  )
}

export function App() {
  // Páginas públicas (sin iniciar sesión): reservar y ver el estado de la cita.
  const path = location.pathname
  if (path.startsWith('/privacidad')) return <Privacidad />
  if (path.startsWith('/admin')) return <SuperPanel />
  if (path.startsWith('/reservar/')) return <Reservar code={path.split('/')[2] ?? ''} />
  if (path.startsWith('/cita/')) return <EstadoCita token={path.split('/')[2] ?? ''} />
  if (path.startsWith('/boletos/')) return <TiendaBoletos code={path.split('/')[2] ?? ''} />
  if (path.startsWith('/descargar')) return <Descargar />
  if (path.startsWith('/tarjeta/')) return <MiTarjeta code={path.split('/')[2] ?? ''} />
  if (path.startsWith('/mis-boletos/')) return <MisBoletos token={path.split('/')[2] ?? ''} />
  return (
    <>
      <Intro />
      <Privada />
    </>
  )
}

/** Pantallas que ve este usuario: según permisos, giro y módulos; con el nombre que corresponde a su negocio. */
export function screensFor(me: Me): Screen[] {
  const giroOk = (s: Screen) => !s.giros || hasGiro(me, ...s.giros)
  const needsModule: Record<string, string[]> = { escanear: ['membresias', 'asistencia', 'fidelidad'] }
  const moduleOk = (s: Screen) => !needsModule[s.key] || needsModule[s.key]!.some((m) => me.modules?.includes(m))
  // Algunos nombres cambian según el giro, para que cada sistema hable de su negocio.
  const fiado = hasGiro(me, ...FIADO_GIROS)
  const rename = (s: Screen): Screen =>
    s.key === 'clientes' ? { ...s, label: fiado ? 'Clientes y fiado' : 'Clientes' }
    : s.key === 'menu' ? { ...s, label: hasGiro(me, 'comedor', 'restaurante') ? 'Menú del día' : 'Guisados del día' }
    : s.key === 'comisiones' && !hasGiro(me, 'barberia', 'unas', 'perfumeria') ? { ...s, label: 'Propinas' }
    : s.key === 'precios' ? { ...s, label: hasGiro(me, 'verduleria') ? 'Precio del día' : 'Precio por kilo' }
    : s.key === 'lealtad' ? { ...s, label: me.modules?.includes('fidelidad') ? 'Sellos y promociones' : 'Membresías y promos' }
    : s
  const hidden = productOf(me.business.giro).hide
  return SCREENS.filter((s) => can(me, s.perm) && giroOk(s) && moduleOk(s) && !hidden.includes(s.key) && !(s.key === 'asistencia' && can(me, 'create_employees'))).map((s) => ({ ...rename(s), desc: descFor(me, s.key) }))
}

/** Aviso al dueño unos días antes de que termine su prueba o su mensualidad (así no lo sorprende el bloqueo). */
export function daysToRenew(b: Me['business'], now = Date.now()): { days: number; kind: 'prueba' | 'mensualidad' } | null {
  if (b.free) return null
  const end = b.status === 'prueba' ? b.trialEndsAt : b.status === 'activo' ? b.paidUntil : null
  if (!end) return null
  // Días de calendario en hora de México (vence mañana = 1 aunque falten 30 horas).
  const day = (ms: number) => Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(ms)))
  const days = Math.round((day(Date.parse(end)) - day(now)) / 86_400_000)
  return days <= 5 && days >= 0 ? { days, kind: b.status === 'prueba' ? 'prueba' : 'mensualidad' } : null
}
function RenewNotice({ b }: { b: Me['business'] }) {
  const r = daysToRenew(b)
  if (!r) return null
  const when = r.days === 0 ? 'hoy' : r.days === 1 ? 'mañana' : `en ${r.days} días`
  return (
    <div className="card renew-notice" role="status">
      <b>{r.kind === 'prueba' ? `Tu prueba gratis termina ${when}.` : `Tu mensualidad vence ${when}.`}</b>{' '}
      <span className="muted">Para seguir vendiendo sin interrupción, {r.kind === 'prueba' ? 'elige tu plan' : 'renueva'} con soporte. Tus datos no se borran.</span>{' '}
      <a href="#/buzon">Escribir a soporte</a>
    </div>
  )
}

function Privada() {
  const [me, setMe] = useState<Me | null>(cache.get<Me | null>('me', null))
  const [checking, setChecking] = useState(!!auth.token)
  const hash = useHash()
  const [menu, setMenu] = useState(false)
  const [portal, setPortal] = useState<{ group: string; top: number } | null>(null)
  // Cuántos pendientes hay hoy (se ve junto a «Inicio» desde cualquier pantalla).
  const [pending, setPending] = useState(0)
  const notices = useNotices(me?.user.id)
  const [avisos, setAvisos] = useState(false)
  useEffect(() => {
    if (!me) return
    const load = () => api<{ tasks: { tone: string }[] }>('GET', '/today').then((r) => setPending(r.tasks.filter((t) => t.tone !== 'info').length)).catch(() => {})
    void load(); return everyVisible(load, 120_000)
  }, [me?.user.id, hash])
  useEffect(() => { setPortal(null) }, [hash])
  // Identidad visual del producto de este negocio.
  useEffect(() => { if (me) applyProduct(productOf(me.business.giro)) }, [me?.business.giro])
  // Con la sesión abierta, el resto de las pantallas se descarga en segundo plano (para trabajar sin internet).
  useEffect(() => { if (me) preloadScreens() }, [me?.user.id])
  // Esc cierra el panel lateral que esté abierto (el de más arriba).
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const sheets = document.querySelectorAll<HTMLElement>('.modal.sheet')
      sheets[sheets.length - 1]?.click()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])
  useEffect(() => {
    if (!portal) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPortal(null)
    const out = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.portal-pop, .portal-btn, .portal-inline')) setPortal(null) }
    window.addEventListener('keydown', esc); window.addEventListener('mousedown', out)
    return () => { window.removeEventListener('keydown', esc); window.removeEventListener('mousedown', out) }
  }, [portal])

  useEffect(() => {
    if (!auth.token) return
    api<Me>('GET', '/auth/me')
      .then((m) => { setMe(m); cache.set('me', m) })
      .catch((e) => { if (e.status === 401) { auth.set(null); setMe(null) } })
      .finally(() => setChecking(false))
  }, [])

  const logout = async () => {
    await forgetPush()
    setPublicSlugCache(null)
    await api('POST', '/auth/logout').catch(() => {})
    auth.set(null)
    cache.set('me', null)
    setMe(null)
  }

  if (!auth.token || !me) {
    if (checking) return <main className="muted">Cargando…</main>
    return <Login onLogin={(m) => { setMe(m); cache.set('me', m) }} />
  }
  if (me.user.mustChangePassword) return <Login forceChange onLogin={(m) => { setMe(m); cache.set('me', m) }} />

  const allowed = screensFor(me)
  const product = productOf(me.business.giro)
  // El personal que cobra entra directo a la caja; el dueño, al inicio.
  // El personal entra directo a su lugar de trabajo: la caja, la cocina o la agenda.
  const current = allowed.find((s) => s.key === hash) ?? (me.user.role === 'staff' ? ['caja', 'cocina', 'agenda'].map((k) => allowed.find((s) => s.key === k)).find(Boolean) : undefined) ?? allowed[0]
  const blocked = me.business.status === 'vencido' || me.business.status === 'suspendido'
  return (
    <div className="app">
      <header className="top">
        <button className="menu-btn" aria-label="Abrir menú" onClick={() => setMenu(true)}><Menu size={22} aria-hidden /></button>
        <Logo size={26} />
        <span style={{ flex: 1 }} />
        <BellButton unread={notices.data?.unread ?? 0} onClick={() => setAvisos(true)} />
        <PendingBadge />
      </header>
      <aside className={`side ${menu ? 'open' : ''}`} onClick={() => setMenu(false)}>
        <div className="brand"><Logo size={36} /><span className="word-wrap"><span className="word">NEXORA</span>{product.short && <span className="product-name">{product.short}</span>}</span><span style={{ flex: 1 }} /><BellButton unread={notices.data?.unread ?? 0} onClick={() => setAvisos(true)} /></div>
        <div className="biz">{me.business.name}</div>
        {/* Un permiso no marcado no aparece en pantalla. */}
        <nav>
          {allowed.filter((s) => s.group === '').map((s) => (
            <a key={s.key} href={`#/${s.key}`} style={toneStyle('')} className={current?.key === s.key ? 'on' : ''} aria-current={current?.key === s.key ? 'page' : undefined}>
              <s.icon size={20} strokeWidth={1.9} aria-hidden />{s.label}{s.key === 'inicio' && pending > 0 && <span className="nav-badge" aria-label={`${pending} pendientes`}>{pending}</span>}
            </a>
          ))}
          {PORTALS.map((p) => {
            const items = allowed.filter((s) => s.group === p.group)
            if (!items.length) return null
            const on = current?.group === p.group
            const open = portal?.group === p.group
            // Un portal con una sola opción lleva directo a ella.
            if (items.length === 1) return (
              <a key={p.group} href={`#/${items[0]!.key}`} style={toneStyle(p.group)} className={`portal-btn ${on ? 'on' : ''}`}><p.icon size={20} strokeWidth={1.9} aria-hidden />{p.label}</a>
            )
            return (
              <div key={p.group} className="nav-group" style={toneStyle(p.group)}>
                <button type="button" className={`portal-btn ${on ? 'on' : ''} ${open ? 'open' : ''}`} aria-expanded={open}
                  onClick={(e) => { e.stopPropagation(); setPortal(open ? null : { group: p.group, top: e.currentTarget.getBoundingClientRect().top }) }}>
                  <p.icon size={20} strokeWidth={1.9} aria-hidden /><span>{p.label}</span><ChevronRight size={16} aria-hidden className="chev" />
                </button>
                {/* En celular el panel se abre debajo del portal, dentro del menú. */}
                {open && <div className="portal-inline">{items.map((s) => <PortalItem key={s.key} s={s} on={current?.key === s.key} />)}</div>}
              </div>
            )
          })}
        </nav>
        <div className="foot">
          <PendingBadge main />
          <div className="who"><span className="avatar" aria-hidden>{me.user.name.trim().charAt(0).toUpperCase()}</span><span><b>{me.user.name}</b><small className="muted">{me.user.role === 'owner' ? 'Dueño' : me.user.position === 'encargado' ? 'Encargado' : 'Empleado'}</small></span></div>
          <button className="logout" onClick={logout}><LogOut size={18} aria-hidden />Salir</button>
        </div>
      </aside>
      {portal && (() => {
        const p = PORTALS.find((x) => x.group === portal.group)!
        const items = allowed.filter((s) => s.group === portal.group)
        return (
          <div className="portal-pop" role="menu" style={{ ...toneStyle(portal.group), top: Math.max(12, Math.min(portal.top - 12, window.innerHeight - 80 - items.length * 64)) }}>
            <div className="portal-head"><p.icon size={18} aria-hidden />{p.label}</div>
            {items.map((s) => <PortalItem key={s.key} s={s} on={current?.key === s.key} />)}
          </div>
        )
      })()}
      {avisos && <AvisosPanel data={notices.data} reload={notices.reload} onClose={() => { setAvisos(false); void notices.reload().catch(() => {}) }} />}
      {notices.toast && !avisos && <NoticeToast n={notices.toast} onClose={notices.closeToast} onOpen={() => { const l = notices.toast?.link; notices.closeToast(); if (l) location.hash = l }} />}
      <main>
        {blocked && <div className="card error">Tu cuenta está {me.business.status}. Tus datos están intactos; habla con soporte para reactivarla.</div>}
        {me.user.role === 'owner' && !blocked && <RenewNotice b={me.business} />}
        {/* Pantallas del mismo portal a un toque, sin abrir el menú. */}
        {current && current.group && (() => {
          const sib = allowed.filter((s) => s.group === current.group)
          if (sib.length < 2) return null
          return (
            <nav className="portal-tabs" aria-label={portalOf(current.group)} style={toneStyle(current.group)}>
              {sib.map((s) => <a key={s.key} href={`#/${s.key}`} className={s.key === current.key ? 'on' : ''} aria-current={s.key === current.key ? 'page' : undefined}><s.icon size={16} strokeWidth={2} aria-hidden />{s.label}</a>)}
            </nav>
          )
        })()}
        {current && !current.ownTitle && <header className="page-head"><div><h1>{current.label}</h1>{current.group && <p className="muted">{portalOf(current.group)}</p>}</div></header>}
        <Suspense fallback={<ScreenLoading />}>{current ? <div key={current.key} className="screen-in"><current.C me={me} /></div> : <p>No tienes pantallas asignadas. Pide al dueño que te dé permisos.</p>}</Suspense>
      </main>
    </div>
  )
}

/** Opción dentro de un portal: ícono, nombre y qué hace. */
function PortalItem({ s, on }: { s: Screen; on: boolean }) {
  return (
    <a href={`#/${s.key}`} className={`portal-item ${on ? 'on' : ''}`} role="menuitem" aria-current={on ? 'page' : undefined}>
      <s.icon size={20} strokeWidth={1.9} aria-hidden />
      <span><b>{s.label}</b>{s.desc && <small>{s.desc}</small>}</span>
    </a>
  )
}

/** Mientras llega una pantalla: un esqueleto discreto en lugar de una pantalla en blanco. */
function ScreenLoading() {
  return <div className="screen-loading" aria-busy="true" aria-label="Cargando"><div className="sk sk-title" /><div className="sk sk-row" /><div className="sk sk-card" /></div>
}
