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
}
export const can = (me: Me, p: string) => me.permissions === 'todos' || me.permissions.includes(p)

type Screen = { key: string; label: string; perm: string; C: (p: { me: Me }) => JSX.Element; giros?: string[] }
const SCREENS: Screen[] = [
  { key: 'agenda', label: 'Agenda', perm: 'sell', C: Agenda, giros: ['barberia', 'unas'] },
  { key: 'entradas', label: 'Entradas', perm: 'sell', C: Entradas, giros: ['banos'] },
  { key: 'taquilla', label: 'Taquilla', perm: 'sell', C: Taquilla, giros: ['turistico'] },
  { key: 'acceso', label: 'Acceso', perm: 'sell', C: Acceso, giros: ['turistico'] },
  { key: 'mesas', label: 'Mesas', perm: 'sell', C: Mesas, giros: ['palapa', 'restaurante', 'taqueria'] },
  { key: 'pedidos', label: 'Para llevar', perm: 'sell', C: Pedidos, giros: ['restaurante', 'taqueria', 'comedor'] },
  { key: 'cocina', label: 'Cocina', perm: 'sell', C: Cocina, giros: ['palapa', 'restaurante', 'taqueria'] },
  { key: 'caja', label: 'Caja', perm: 'sell', C: Caja },
  { key: 'comisiones', label: 'Comisiones', perm: 'view_commissions', C: Comisiones, giros: ['barberia', 'unas', 'perfumeria'] },
  { key: 'cotizaciones', label: 'Cotizaciones', perm: 'sell', C: Cotizaciones, giros: ['ferreteria', 'papeleria'] },
  { key: 'encargos', label: 'Encargos', perm: 'sell', C: Encargos, giros: ['papeleria'] },
  { key: 'devoluciones', label: 'Devoluciones', perm: 'cancel_discount', C: Devoluciones, giros: ['ferreteria', 'perfumeria', 'papeleria'] },
  { key: 'productos', label: 'Productos', perm: 'view_inventory', C: Productos },
  { key: 'compras', label: 'Compras', perm: 'edit_inventory', C: Compras },
  { key: 'clientes', label: 'Clientes y fiado', perm: 'customers_credit', C: Clientes },
  { key: 'reportes', label: 'Reportes', perm: 'view_reports', C: Reportes },
  { key: 'usuarios', label: 'Personal', perm: 'create_employees', C: Usuarios },
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

function PendingBadge() {
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
    <button className={`pending ${pending || rejected ? '' : 'ok'}`} onClick={() => void flush()} title="Toca para enviar ahora" data-testid="pendientes">
      {!online ? 'Sin internet · ' : ''}
      {pending ? `${pending} por enviar` : 'Todo enviado'}
      {rejected ? ` · ${rejected} con problema` : ''}
    </button>
  )
}

export function App() {
  // Páginas públicas (sin iniciar sesión): reservar y ver el estado de la cita.
  const path = location.pathname
  if (path.startsWith('/reservar/')) return <Reservar code={path.split('/')[2] ?? ''} />
  if (path.startsWith('/cita/')) return <EstadoCita token={path.split('/')[2] ?? ''} />
  if (path.startsWith('/boletos/')) return <TiendaBoletos code={path.split('/')[2] ?? ''} />
  if (path.startsWith('/mis-boletos/')) return <MisBoletos token={path.split('/')[2] ?? ''} />
  return <Privada />
}

function Privada() {
  const [me, setMe] = useState<Me | null>(cache.get<Me | null>('me', null))
  const [checking, setChecking] = useState(!!auth.token)
  const hash = useHash()

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

  const allowed = SCREENS.filter((s) => can(me, s.perm) && (!s.giros || s.giros.includes(me.business.giro)))
  const current = allowed.find((s) => s.key === hash) ?? allowed[0]
  const blocked = me.business.status === 'vencido' || me.business.status === 'suspendido'
  return (
    <div className="app">
      <header className="top">
        <span className="name">{me.business.name}</span>
        {/* Un permiso no marcado no aparece en pantalla. */}
        <nav>
          {allowed.map((s) => (
            <a key={s.key} href={`#/${s.key}`} className={current?.key === s.key ? 'on' : ''}>{s.label}</a>
          ))}
        </nav>
        <PendingBadge />
        <span className="muted">{me.user.name}</span>
        <button onClick={logout}>Salir</button>
      </header>
      <main>
        {blocked && <div className="card error">Tu cuenta está {me.business.status}. Tus datos están intactos; habla con soporte para reactivarla.</div>}
        {current ? <current.C me={me} /> : <p>No tienes pantallas asignadas. Pide al dueño que te dé permisos.</p>}
      </main>
    </div>
  )
}
