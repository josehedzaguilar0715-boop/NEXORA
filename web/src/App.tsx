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
import { Intro, Logo } from './Brand'
import { Comisiones } from './screens/Comisiones'
import { EstadoCita, Reservar } from './screens/Reservar'
import { Login } from './screens/Login'
import { Productos } from './screens/Productos'
import { Reportes } from './screens/Reportes'
import { Usuarios } from './screens/Usuarios'

export interface Me {
  user: { id: string; name: string; role: 'owner' | 'staff'; branchId: string | null; mustChangePassword: boolean }
  permissions: 'todos' | string[]
  business: { id: string; code: string; name: string; phone: string | null; status: string; giro: string }
  settings?: Record<string, any>
  modules?: string[]
}
/** 'owner' = solo el dueño. Un permiso no marcado no aparece en pantalla. */
export const can = (me: Me, p: string) => (p === 'owner' ? me.user.role === 'owner' : me.permissions === 'todos' || me.permissions.includes(p))

type Screen = { key: string; label: string; perm: string; C: (p: { me: Me }) => JSX.Element; giros?: string[] }
const SCREENS: Screen[] = [
  { key: 'inicio', label: 'Inicio', perm: 'view_reports', C: Inicio },
  { key: 'agenda', label: 'Agenda', perm: 'sell', C: Agenda, giros: ['barberia', 'unas'] },
  { key: 'entradas', label: 'Entradas', perm: 'sell', C: Entradas, giros: ['banos'] },
  { key: 'taquilla', label: 'Taquilla', perm: 'sell', C: Taquilla, giros: ['turistico'] },
  { key: 'acceso', label: 'Acceso', perm: 'sell', C: Acceso, giros: ['turistico'] },
  { key: 'mesas', label: 'Mesas', perm: 'sell', C: Mesas, giros: ['palapa', 'restaurante', 'taqueria'] },
  { key: 'menu', label: 'Menú del día', perm: 'sell', C: MenuDia, giros: ['comedor', 'taqueria'] },
  { key: 'carne', label: 'Carne', perm: 'sell', C: Trompo, giros: ['taqueria'] },
  { key: 'precios', label: 'Precio del día', perm: 'change_prices', C: PrecioDia, giros: ['verduleria', 'palapa'] },
  { key: 'pedidos', label: 'Pedidos', perm: 'sell', C: Pedidos, giros: ['restaurante', 'taqueria', 'comedor', 'verduleria'] },
  { key: 'cocina', label: 'Cocina', perm: 'sell', C: Cocina, giros: ['palapa', 'restaurante', 'taqueria'] },
  { key: 'caja', label: 'Caja', perm: 'sell', C: Caja },
  { key: 'comisiones', label: 'Comisiones', perm: 'view_commissions', C: Comisiones, giros: ['barberia', 'unas', 'perfumeria'] },
  { key: 'cotizaciones', label: 'Cotizaciones', perm: 'sell', C: Cotizaciones, giros: ['ferreteria', 'papeleria'] },
  { key: 'encargos', label: 'Encargos', perm: 'sell', C: Encargos, giros: ['papeleria'] },
  { key: 'devoluciones', label: 'Devoluciones', perm: 'cancel_discount', C: Devoluciones, giros: ['ferreteria', 'perfumeria', 'papeleria'] },
  { key: 'productos', label: 'Productos', perm: 'view_inventory', C: Productos },
  { key: 'cierre', label: 'Cierre del día', perm: 'edit_inventory', C: CierreDia, giros: ['verduleria', 'abarrotes'] },
  { key: 'compras', label: 'Compras', perm: 'edit_inventory', C: Compras },
  { key: 'clientes', label: 'Clientes y fiado', perm: 'customers_credit', C: Clientes },
  { key: 'reportes', label: 'Reportes', perm: 'view_reports', C: Reportes },
  { key: 'usuarios', label: 'Personal', perm: 'create_employees', C: Usuarios },
  { key: 'escanear', label: 'Escanear QR', perm: 'sell', C: Escanear },
  { key: 'lealtad', label: 'Membresías y promos', perm: 'owner', C: Lealtad },
  { key: 'buzon', label: 'Buzón', perm: 'owner', C: Buzon },
  { key: 'ajustes', label: 'Ajustes', perm: 'owner', C: Ajustes },
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
  const giroOk = (s: Screen) => !s.giros || s.giros.includes(me.business.giro) || (s.key === 'mesas' && me.business.giro === 'comedor' && !!me.settings?.tablesEnabled)
  const needsModule: Record<string, string[]> = { escanear: ['membresias', 'asistencia', 'fidelidad'] }
  const moduleOk = (s: Screen) => !needsModule[s.key] || needsModule[s.key]!.some((m) => me.modules?.includes(m))
  const allowed = SCREENS.filter((s) => can(me, s.perm) && giroOk(s) && moduleOk(s))
  const current = allowed.find((s) => s.key === hash) ?? allowed[0]
  const blocked = me.business.status === 'vencido' || me.business.status === 'suspendido'
  return (
    <div className="app">
      <header className="top">
        <button className="menu-btn" aria-label="Abrir menú" onClick={() => setMenu(true)}>☰</button>
        <Logo size={26} />
        <span style={{ flex: 1 }} />
        <PendingBadge />
      </header>
      <aside className={`side ${menu ? 'open' : ''}`} onClick={() => setMenu(false)}>
        <div className="brand"><Logo size={30} /><span className="word">NEXORA</span></div>
        <div className="biz">{me.business.name}</div>
        {/* Un permiso no marcado no aparece en pantalla. */}
        <nav>
          {allowed.map((s) => (
            <a key={s.key} href={`#/${s.key}`} className={current?.key === s.key ? 'on' : ''}>{s.label}</a>
          ))}
        </nav>
        <div className="foot">
          <PendingBadge main />
          <span className="muted" style={{ padding: '0 6px' }}>{me.user.name}</span>
          <button onClick={logout}>Salir</button>
        </div>
      </aside>
      <main>
        {blocked && <div className="card error">Tu cuenta está {me.business.status}. Tus datos están intactos; habla con soporte para reactivarla.</div>}
        {current ? <current.C me={me} /> : <p>No tienes pantallas asignadas. Pide al dueño que te dé permisos.</p>}
      </main>
    </div>
  )
}
