import { useEffect, useState, useSyncExternalStore } from 'react'
import { api, auth, cache, flush, outbox } from './api'
import { Caja } from './screens/Caja'
import { Clientes } from './screens/Clientes'
import { Compras } from './screens/Compras'
import { Cotizaciones } from './screens/Cotizaciones'
import { Devoluciones } from './screens/Devoluciones'
import { Encargos } from './screens/Encargos'
import { Agenda } from './screens/Agenda'
import { Entradas } from './screens/Entradas'
import { Acceso, MisBoletos, Taquilla, TiendaBoletos } from './screens/Taquilla'
import { Cocina, Mesas, Pedidos } from './screens/Mesas'
import { MenuDia } from './screens/MenuDia'
import { Trompo } from './screens/Trompo'
import { CierreDia, PrecioDia } from './screens/Verduleria'
import { Ajustes, Buzon } from './screens/Ajustes'
import { Escanear, Lealtad } from './screens/Lealtad'
import { SuperPanel } from './screens/SuperPanel'
import { Inicio } from './screens/Inicio'
import { Privacidad } from './screens/Privacidad'
import { Intro, Logo } from './Brand'
import { Comisiones } from './screens/Comisiones'
import { EstadoCita, Reservar } from './screens/Reservar'
import { Login } from './screens/Login'
import { Productos } from './screens/Productos'
import { Reportes } from './screens/Reportes'
import { MiAsistencia, Usuarios } from './screens/Usuarios'
import { Finanzas } from './screens/Finanzas'
import { Importar } from './screens/Importar'
import { Configurar } from './screens/Configurar'
import { Apartados } from './screens/Apartados'
import {
  Archive, Armchair, Boxes, CalendarDays, ChartColumn, ChefHat, ClipboardCheck, Clock, ClipboardList, DoorOpen, FileText, Flame, Gift, Landmark, LayoutDashboard,
  LifeBuoy, LogOut, Menu, Package, Percent, QrCode, ScanLine, Settings, ShoppingCart, SlidersHorizontal, Tag, Ticket, Truck, Undo2, Upload, UserCog, Users, UtensilsCrossed,
} from 'lucide-react'

export interface Me {
  user: { id: string; name: string; phone?: string | null; role: 'owner' | 'staff'; branchId: string | null; mustChangePassword: boolean }
  permissions: 'todos' | string[]
  business: { id: string; code: string; name: string; phone: string | null; status: string; giro: string; giros?: string[] }
  settings?: Record<string, any>
  modules?: string[]
}
/** 'owner' = solo el dueño. Un permiso no marcado no aparece en pantalla. */
/** Giros que manejan fiado o cuenta de crédito (spec: abarrotes, ferretería, papelería, comedor y verdulería). */
export const FIADO_GIROS = ['abarrotes', 'ferreteria', 'papeleria', 'comedor', 'verduleria']

/** ¿El negocio tiene alguno de estos giros? (negocio mixto: principal + adicionales) */
export const hasGiro = (me: Me, ...g: string[]) => (me.business.giros ?? [me.business.giro]).some((x) => g.includes(x))
/** Ver reportes lo tiene todo usuario (solo lectura), igual que en el servidor. */
export const can = (me: Me, p: string) => (p === 'owner' ? me.user.role === 'owner' : p === 'view_reports' || me.permissions === 'todos' || me.permissions.includes(p))

type Icon = import('lucide-react').LucideIcon
type Screen = { key: string; label: string; perm: string; C: (p: { me: Me }) => JSX.Element; giros?: string[]; group: string; icon: Icon; ownTitle?: boolean }
/** Menú por secciones: lo de todos los días arriba y la administración al final. */
const GROUPS = ['', 'Operación', 'Inventario', 'Clientes', 'Finanzas', 'Administración']
const SCREENS: Screen[] = [
  { key: 'inicio', label: 'Inicio', perm: 'view_reports', C: Inicio, group: '', icon: LayoutDashboard, ownTitle: true },
  { key: 'caja', label: 'Caja', perm: 'sell', C: Caja, group: 'Operación', icon: ShoppingCart },
  { key: 'agenda', label: 'Agenda', perm: 'sell', C: Agenda, giros: ['barberia', 'unas'], group: 'Operación', icon: CalendarDays },
  { key: 'entradas', label: 'Entradas', perm: 'sell', C: Entradas, giros: ['banos'], group: 'Operación', icon: DoorOpen },
  { key: 'taquilla', label: 'Taquilla', perm: 'sell', C: Taquilla, giros: ['turistico'], group: 'Operación', icon: Ticket },
  { key: 'acceso', label: 'Acceso', perm: 'sell', C: Acceso, giros: ['turistico'], group: 'Operación', icon: ScanLine, ownTitle: true },
  { key: 'mesas', label: 'Mesas', perm: 'sell', C: Mesas, giros: ['palapa', 'restaurante', 'taqueria'], group: 'Operación', icon: Armchair },
  { key: 'pedidos', label: 'Pedidos', perm: 'sell', C: Pedidos, giros: ['restaurante', 'taqueria', 'verduleria'], group: 'Operación', icon: ClipboardList },
  { key: 'cocina', label: 'Cocina', perm: 'sell', C: Cocina, giros: ['palapa', 'restaurante', 'taqueria'], group: 'Operación', icon: ChefHat },
  { key: 'menu', label: 'Menú del día', perm: 'sell', C: MenuDia, giros: ['comedor', 'taqueria'], group: 'Operación', icon: UtensilsCrossed },
  { key: 'carne', label: 'Carne', perm: 'sell', C: Trompo, giros: ['taqueria'], group: 'Operación', icon: Flame },
  { key: 'apartados', label: 'Apartados', perm: 'sell', C: Apartados, giros: ['abarrotes'], group: 'Operación', icon: Archive },
  { key: 'cotizaciones', label: 'Cotizaciones', perm: 'sell', C: Cotizaciones, giros: ['ferreteria'], group: 'Operación', icon: FileText },
  { key: 'encargos', label: 'Encargos', perm: 'sell', C: Encargos, giros: ['papeleria'], group: 'Operación', icon: Package },
  { key: 'devoluciones', label: 'Devoluciones', perm: 'cancel_discount', C: Devoluciones, giros: ['ferreteria', 'perfumeria'], group: 'Operación', icon: Undo2 },
  { key: 'escanear', label: 'Escanear QR', perm: 'sell', C: Escanear, group: 'Operación', icon: QrCode },
  { key: 'productos', label: 'Productos', perm: 'view_inventory', C: Productos, group: 'Inventario', icon: Boxes },
  { key: 'precios', label: 'Precio del día', perm: 'change_prices', C: PrecioDia, giros: ['verduleria', 'palapa', 'taqueria'], group: 'Inventario', icon: Tag },
  { key: 'compras', label: 'Compras', perm: 'edit_inventory', C: Compras, group: 'Inventario', icon: Truck },
  { key: 'cierre', label: 'Cierre del día', perm: 'edit_inventory', C: CierreDia, giros: ['verduleria', 'abarrotes'], group: 'Inventario', icon: ClipboardCheck },
  { key: 'clientes', label: 'Clientes y fiado', perm: 'customers_credit', C: Clientes, group: 'Clientes', icon: Users },
  { key: 'lealtad', label: 'Membresías y promos', perm: 'owner', C: Lealtad, group: 'Clientes', icon: Gift },
  { key: 'finanzas', label: 'Finanzas', perm: 'view_reports', C: Finanzas, group: 'Finanzas', icon: Landmark, ownTitle: true },
  { key: 'reportes', label: 'Ventas y retiro', perm: 'view_reports', C: Reportes, group: 'Finanzas', icon: ChartColumn },
  { key: 'comisiones', label: 'Comisiones', perm: 'view_commissions', C: Comisiones, giros: ['barberia', 'unas', 'perfumeria'], group: 'Finanzas', icon: Percent },
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
  if (path.startsWith('/mis-boletos/')) return <MisBoletos token={path.split('/')[2] ?? ''} />
  return (
    <>
      <Intro />
      <Privada />
    </>
  )
}

function Privada() {
  const [me, setMe] = useState<Me | null>(cache.get<Me | null>('me', null))
  const [checking, setChecking] = useState(!!auth.token)
  const hash = useHash()
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    if (!auth.token) return
    api<Me>('GET', '/auth/me')
      .then((m) => { setMe(m); cache.set('me', m) })
      .catch((e) => { if (e.status === 401) { auth.set(null); setMe(null) } })
      .finally(() => setChecking(false))
  }, [])

  const logout = async () => {
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

  // Comedor: el mapa de mesas es opcional (apagado por defecto).
  const giroOk = (s: Screen) => !s.giros || hasGiro(me, ...s.giros) || (s.key === 'mesas' && hasGiro(me, 'comedor') && !!me.settings?.tablesEnabled)
  const needsModule: Record<string, string[]> = { escanear: ['membresias', 'asistencia', 'fidelidad'] }
  const moduleOk = (s: Screen) => !needsModule[s.key] || needsModule[s.key]!.some((m) => me.modules?.includes(m))
  // Algunos nombres cambian según el giro, para que cada sistema hable de su negocio.
  const fiado = hasGiro(me, ...FIADO_GIROS)
  const rename = (s: Screen): Screen =>
    s.key === 'clientes' ? { ...s, label: fiado ? 'Clientes y fiado' : 'Clientes' }
    : s.key === 'menu' ? { ...s, label: hasGiro(me, 'comedor') ? 'Menú del día' : 'Guisados del día' }
    : s.key === 'precios' ? { ...s, label: hasGiro(me, 'verduleria') ? 'Precio del día' : 'Precio por kilo' }
    : s
  const allowed = SCREENS.filter((s) => can(me, s.perm) && giroOk(s) && moduleOk(s) && !(s.key === 'asistencia' && can(me, 'create_employees'))).map(rename)
  // El personal que cobra entra directo a la caja; el dueño, al inicio.
  const current = allowed.find((s) => s.key === hash) ?? (me.user.role === 'staff' ? allowed.find((s) => s.key === 'caja') : undefined) ?? allowed[0]
  const blocked = me.business.status === 'vencido' || me.business.status === 'suspendido'
  return (
    <div className="app">
      <header className="top">
        <button className="menu-btn" aria-label="Abrir menú" onClick={() => setMenu(true)}><Menu size={22} aria-hidden /></button>
        <Logo size={26} />
        <span style={{ flex: 1 }} />
        <PendingBadge />
      </header>
      <aside className={`side ${menu ? 'open' : ''}`} onClick={() => setMenu(false)}>
        <div className="brand"><Logo size={36} /><span className="word">NEXORA</span></div>
        <div className="biz">{me.business.name}</div>
        {/* Un permiso no marcado no aparece en pantalla. */}
        <nav>
          {GROUPS.map((g) => {
            const items = allowed.filter((s) => s.group === g)
            if (!items.length) return null
            return (
              <div key={g || 'top'} className="nav-group">
                {g && <div className="nav-title">{g}</div>}
                {items.map((s) => (
                  <a key={s.key} href={`#/${s.key}`} className={current?.key === s.key ? 'on' : ''} aria-current={current?.key === s.key ? 'page' : undefined}>
                    <s.icon size={20} strokeWidth={1.9} aria-hidden />{s.label}
                  </a>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="foot">
          <PendingBadge main />
          <div className="who"><span className="avatar" aria-hidden>{me.user.name.trim().charAt(0).toUpperCase()}</span><span><b>{me.user.name}</b><small className="muted">{me.user.role === 'owner' ? 'Dueño' : 'Personal'}</small></span></div>
          <button className="logout" onClick={logout}><LogOut size={18} aria-hidden />Salir</button>
        </div>
      </aside>
      <main>
        {blocked && <div className="card error">Tu cuenta está {me.business.status}. Tus datos están intactos; habla con soporte para reactivarla.</div>}
        {current && !current.ownTitle && <header className="page-head"><div><h1>{current.label}</h1>{current.group && <p className="muted">{current.group}</p>}</div></header>}
        {current ? <current.C me={me} /> : <p>No tienes pantallas asignadas. Pide al dueño que te dé permisos.</p>}
      </main>
    </div>
  )
}
