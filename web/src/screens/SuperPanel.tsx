import { useEffect, useState } from 'react'
import { ApiError, mxn, toCents } from '../api'
import { downloadUrl, WhatsAppShare } from './Descargar'
import { Logo } from '../Brand'
import { GIROS, giroLabel } from '../giros'
import { Estado, type TipoEstado } from '../Estado'
import { ModoBoton } from '../ModoBoton'
import { Activity, AlertTriangle, FlaskConical, Inbox, Landmark, LayoutDashboard, LogOut, Menu, Settings, Store, UserPlus, X } from 'lucide-react'
import type { CSSProperties } from 'react'

// El super panel tiene su propio acceso, separado del de los negocios.
const TOKEN = 'nx_admin_token'
async function adm<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const t = localStorage.getItem(TOKEN)
  const res = await fetch(`/api${path}`, { method, headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (res.status === 401 && path !== '/admin/login') localStorage.removeItem(TOKEN)
  if (!res.ok) throw new ApiError(res.status, json?.error?.code ?? 'error', json?.error?.message ?? `Error ${res.status}`)
  return json as T
}

const STATUS: Record<string, string> = { prueba: 'Prueba', activo: 'Activo', vencido: 'Vencido', suspendido: 'Suspendido' }
const PLANS: Record<string, string> = { inicial: 'Inicial ($500, 3 usuarios)', crecimiento: 'Crecimiento ($700, 5)', profesional: 'Profesional ($900, 10)' }

type Pestana = 'resumen' | 'negocios' | 'buzon' | 'alta' | 'demos' | 'ajustes'
/** Módulos del panel: mismo color e icono en el menú, la barra inferior y los encabezados. */
const PESTANAS: { k: Pestana; label: string; icon: typeof Store; mod: string }[] = [
  { k: 'resumen', label: 'Resumen', icon: LayoutDashboard, mod: 'reportes' },
  { k: 'negocios', label: 'Negocios', icon: Store, mod: 'clientes' },
  { k: 'buzon', label: 'Buzón', icon: Inbox, mod: 'ventas' },
  { k: 'alta', label: 'Alta asistida', icon: UserPlus, mod: 'agenda' },
  { k: 'demos', label: 'Demos', icon: FlaskConical, mod: 'inventario' },
  { k: 'ajustes', label: 'Ajustes', icon: Settings, mod: 'admin' },
]

export function SuperPanel() {
  const [logged, setLogged] = useState(!!localStorage.getItem(TOKEN))
  const [tab, setTab] = useState<Pestana>('resumen')
  const [mas, setMas] = useState(false)
  useEffect(() => { document.documentElement.dataset.product = document.documentElement.dataset.product ?? 'nexora' }, [])
  if (!logged) return <AdminLogin onLogin={() => setLogged(true)} />
  const salir = () => { localStorage.removeItem(TOKEN); setLogged(false) }
  const ir = (k: Pestana) => { setTab(k); setMas(false); window.scrollTo({ top: 0 }) }
  const actual = PESTANAS.find((p) => p.k === tab)!
  const item = (p: (typeof PESTANAS)[number]) => (
    <button key={p.k} type="button" className={`rail-item ${tab === p.k ? 'on' : ''}`} style={{ '--mc': `var(--m-${p.mod})` } as CSSProperties} aria-current={tab === p.k ? 'page' : undefined} onClick={() => ir(p.k)}>
      <span className={`mod-ico mod-${p.mod}`}><p.icon size={20} strokeWidth={2} aria-hidden /></span><span className="rail-nombre">{p.label}</span>
    </button>
  )
  const baja = PESTANAS.slice(0, 3)
  return (
    <div className="app2 admin2">
      <header className="topbar">
        <div className="topbar-in">
          <span className="brand2"><Logo size={34} /><span className="brand2-txt"><b>NEXORA</b><small>Super panel · soporte</small></span></span>
          <div className="topbar-actions solo-compu"><span style={{ width: 190 }}><ModoBoton /></span><button type="button" className="logout" onClick={salir}><LogOut size={18} aria-hidden />Salir</button></div>
        </div>
      </header>
      <div className="shell2">
        <aside className="rail" aria-label="Módulos del panel"><nav className="rail-nav">{PESTANAS.map(item)}</nav></aside>
        <main>
          <header className="page-head"><div><span className={`screen-chip mod-${actual.mod}`}><actual.icon size={16} aria-hidden />{actual.label}</span><h1>{actual.label}</h1></div></header>
          {tab === 'resumen' ? <Resumen /> : tab === 'negocios' ? <Negocios /> : tab === 'buzon' ? <BuzonAdmin /> : tab === 'alta' ? <Alta onDone={() => setTab('negocios')} /> : tab === 'demos' ? <Demos /> : <AjustesAdmin />}
        </main>
      </div>
      <nav className="bottom" aria-label="Navegación del panel">
        <ul>
          {baja.map((p) => (
            <li key={p.k}><button type="button" className={`bottom-btn ${tab === p.k ? 'on' : ''}`} style={{ '--mc': `var(--m-${p.mod})` } as CSSProperties} aria-current={tab === p.k ? 'page' : undefined} onClick={() => ir(p.k)}><span className="bottom-ico"><p.icon size={22} strokeWidth={2} aria-hidden /></span>{p.label}</button></li>
          ))}
          <li><button type="button" className={`bottom-btn ${!baja.some((p) => p.k === tab) ? 'on' : ''}`} style={{ '--mc': 'var(--m-admin)' } as CSSProperties} onClick={() => setMas(true)}><span className="bottom-ico"><Menu size={22} strokeWidth={2} aria-hidden /></span>Más</button></li>
        </ul>
      </nav>
      {mas && (
        <div className="hoja-fondo" onClick={() => setMas(false)}>
          <div className="hoja" role="dialog" aria-label="Todos los módulos" onClick={(e) => e.stopPropagation()}>
            <div className="hoja-cab"><b>Todos los módulos</b><button type="button" className="icon-btn2" aria-label="Cerrar" onClick={() => setMas(false)}><X size={22} aria-hidden /></button></div>
            <nav className="rail-nav">{PESTANAS.map(item)}</nav>
            <div className="hoja-pie"><ModoBoton /><button type="button" className="logout" onClick={salir}><LogOut size={18} aria-hidden />Salir</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Resumen para operar muchos negocios: ingreso mensual, estados, por vencer, vencidos y quién no está usando el sistema. */
function Resumen() {
  const [m, setM] = useState<any>(null)
  const [err, setErr] = useState('')
  useEffect(() => { adm('GET', '/admin/metrics').then(setM).catch((e) => setErr(e.message)) }, [])
  if (err) return <p className="error">{err}</p>
  if (!m) return <p className="muted">Cargando…</p>
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'America/Mexico_City' }) : '—')
  const list = (title: string, rows: any[], what: (r: any) => string) => rows.length > 0 && (
    <section className="card"><h2>{title} · {rows.length}</h2>
      <div className="table-wrap"><table className="list"><tbody>{rows.map((r) => <tr key={r.id}><td>{r.name}<br /><small className="muted">{r.giro}{r.usedLast7Days ? '' : ' · sin ventas en 7 días'}</small></td><td className="num">{what(r)}</td></tr>)}</tbody></table></div>
    </section>
  )
  return (
    <div className="stack">
      <div className="dash-kpis">
        <div className="card dkpi"><div className="dkpi-top"><span className="kpi-ic mod-dinero"><Landmark size={18} aria-hidden /></span><span className="dkpi-label">Ingreso mensual (pagando)</span></div><div className="dkpi-value pos">{mxn(m.mrr)}</div></div>
        <div className="card dkpi"><div className="dkpi-top"><span className="kpi-ic mod-clientes"><Store size={18} aria-hidden /></span><span className="dkpi-label">Negocios</span></div><div className="dkpi-value">{m.total}</div><div className="dkpi-sub">{m.byStatus.activo} activos · {m.byStatus.prueba} en prueba · {m.byStatus.gratis} gratis</div></div>
        <div className="card dkpi"><div className="dkpi-top"><span className="kpi-ic mod-ventas"><Activity size={18} aria-hidden /></span><span className="dkpi-label">Usaron el sistema (7 días)</span></div><div className="dkpi-value">{m.usedLast7Days}</div><div className="dkpi-sub">nuevos este mes: {m.newThisMonth}</div></div>
        <div className="card dkpi"><div className="dkpi-top"><span className="kpi-ic mod-reportes"><AlertTriangle size={18} aria-hidden /></span><span className="dkpi-label">Vencidos</span></div><div className={`dkpi-value ${m.byStatus.vencido ? 'neg' : ''}`}>{m.byStatus.vencido}</div><div className="dkpi-sub">suspendidos: {m.byStatus.suspendido}</div></div>
      </div>
      {list('Pruebas que terminan en 7 días', m.trialsEnding, (r) => day(r.trialEndsAt))}
      {list('Mensualidades por vencer (7 días)', m.renewalsDue, (r) => `${day(r.paidUntil)} · ${mxn(r.monthlyFee)}`)}
      {list('Vencidos', m.overdue, (r) => `${r.overdueDays ?? 0} días`)}
      {list('En prueba o pagando, pero sin ventas en 7 días', m.inactive, (r) => STATUS[r.status] ?? r.status)}
      <section className="card"><h2>Por giro</h2><p className="muted">{Object.entries(m.byGiro).sort((a: any, b: any) => b[1] - a[1]).map(([g, n]) => `${g}: ${n}`).join(' · ')}</p></section>
    </div>
  )
}

function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [f, setF] = useState({ username: '', password: '', code: '' })
  const [ch, setCh] = useState<{ challengeId: string; sentTo: string[] } | null>(null)
  const [err, setErr] = useState('')
  // Segundo paso: el código llega por SMS y por correo.
  if (ch) return (
    <form className="card login" onSubmit={async (e) => { e.preventDefault(); try { const r = await adm('POST', '/admin/verify', { challengeId: ch.challengeId, code: f.code }); localStorage.setItem(TOKEN, r.token); onLogin() } catch (er) { setErr((er as Error).message) } }}>
      <h1>Super panel</h1>
      {ch.sentTo.length ? <p>Te enviamos un código por {ch.sentTo.join(' y ')}.</p> : <p className="error">Todavía no hay SMS ni correo configurados, así que el código no se pudo enviar. Está en Cloudflare: Workers &amp; Pages → {location.hostname.split('.')[0]} → Logs (línea «código del super panel»).</p>}
      <label>Código de 6 dígitos<input inputMode="numeric" autoFocus maxLength={6} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
      {err && <p className="error">{err}</p>}
      <p><button className="primary big" style={{ width: '100%' }}>Verificar</button></p>
    </form>
  )
  return (
    <form className="card login" onSubmit={async (e) => { e.preventDefault(); try { const r = await adm('POST', '/admin/login', { username: f.username, password: f.password }); if (r.token) { localStorage.setItem(TOKEN, r.token); onLogin() } else { setErr(''); setCh(r) } } catch (er) { setErr((er as Error).message) } }}>
      <h1>Super panel</h1>
      <label>Usuario<input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoCapitalize="none" /></label>
      <label>Contraseña<input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
      {err && <p className="error">{err}</p>}
      <p><button className="primary big" style={{ width: '100%' }}>Entrar</button></p>
    </form>
  )
}

function Negocios() {
  const [list, setList] = useState<any[]>([])
  const [filter, setFilter] = useState('')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<any>(null)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => { const r = await adm('GET', `/admin/businesses${filter ? `?status=${filter}` : ''}`); setList(r.businesses); if (sel) setSel(r.businesses.find((b: any) => b.id === sel.id) ?? null) }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [filter])
  const run = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); setMsg({ ok }); await load() } catch (e) { setMsg({ err: (e as Error).message }) } }
  return (
    <div className="grid2">
      <section className="card">
        <label className="sr-only" htmlFor="buscar-negocio">Buscar negocio</label>
        <input id="buscar-negocio" type="search" placeholder="Buscar negocio, código o dueño…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
        <div className="periodo filtros" role="group" aria-label="Estado">{['', 'prueba', 'activo', 'vencido', 'suspendido', 'gratis'].map((s) => <button key={s} type="button" aria-pressed={filter === s} className={filter === s ? 'on' : ''} onClick={() => setFilter(s)}>{s === 'gratis' ? 'Gratis' : s ? STATUS[s] : 'Todos'}</button>)}</div>
        <div className="table-wrap"><table className="list"><tbody>{list.filter((b) => !q.trim() || `${b.name} ${b.code} ${b.owner?.name ?? ''} ${b.owner?.phone ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())).map((b) => (
          <tr key={b.id} onClick={() => setSel(b)} style={{ cursor: 'pointer' }}>
            <td><b>{b.name}</b> <small className="muted">{b.code} · {(b.giros ?? [b.giro]).map(giroLabel).join(' + ')}</small><br /><small className="muted">{b.owner?.name} · {b.owner?.phone}{b.unreadTickets ? ` · ✉ ${b.unreadTickets}` : ''}</small></td>
            <td>{(() => { const tp: TipoEstado = b.free ? 'info' : b.status === 'activo' ? 'ok' : b.status === 'suspendido' ? 'danger' : b.status === 'vencido' ? 'warn' : 'info'; return <Estado tipo={tp}>{b.free ? 'Gratis' : STATUS[b.status]}{!b.free && b.overdueDays != null ? ` (${b.overdueDays} d)` : ''}</Estado> })()}</td>
            <td className="num">{b.free ? '—' : mxn(b.monthlyFee)}</td>
          </tr>
        ))}</tbody></table></div>
      </section>
      {sel && (
        <section className="card">
          <h2>{sel.name}</h2>
          <p className="muted">{sel.free ? 'Gratis: no paga mensualidad y no vence' : `${STATUS[sel.status]} · ${sel.status === 'prueba' ? `prueba hasta ${sel.trialEndsAt?.slice(0, 10)}` : sel.paidUntil ? `pagado hasta ${sel.paidUntil.slice(0, 10)}` : ''}`}</p>
          <p>Plan {sel.plan.plan} · {sel.plan.extraBranches} sucursales extra · {sel.plan.extraUserPacks} paquetes de usuarios · <b>{sel.free ? 'Gratis' : `${mxn(sel.monthlyFee)}/mes`}</b></p>
          <p className="muted">Uso: {sel.usage.users}/{sel.limits.users} usuarios · {sel.usage.branches}/{sel.limits.branches} sucursales{sel.pendingPlan ? ` · cambio pendiente: ${sel.pendingPlan.plan}` : ''}</p>
          {msg.err && <p className="error">{msg.err}</p>}
          {msg.ok && <p className="okmsg">{msg.ok}</p>}
          <div className="pay">
            {!sel.free && <button className="primary big" onClick={() => { const m = Number(prompt('¿Cuántos meses pagó?', '1')); if (m) void run(() => adm('POST', `/admin/businesses/${sel.id}/payments`, { months: m }), 'Pago registrado: el negocio queda activo.')() }}>Registrar pago</button>}
            {sel.free
              ? <button className="big" onClick={() => { const g = prompt('Desde hoy pagará mensualidad. ¿Cuántos días le das para su primer pago?', '30'); if (g === null) return; const r = prompt('Motivo:', 'Termina la cortesía'); if (r) void run(() => adm('POST', `/admin/businesses/${sel.id}/free`, { free: false, reason: r, graceDays: Number(g) || 0 }), 'Listo: ahora paga mensualidad.')() }}>Cobrar mensualidad</button>
              : <button className="big" onClick={() => { const r = prompt(`${sel.name} usará el sistema gratis, sin mensualidad ni vencimiento. Motivo:`, 'Cortesía'); if (r) void run(() => adm('POST', `/admin/businesses/${sel.id}/free`, { free: true, reason: r }), 'Listo: este negocio usa el sistema gratis.')() }}>Hacer gratis</button>}
            {['prueba', 'vencido'].includes(sel.status) && !sel.paidUntil && <button className="big" onClick={() => { const d = Number(prompt('Días de prueba (desde el alta):', String(sel.trialDays ?? 14))); if (d >= 0) void run(() => adm('PATCH', `/admin/businesses/${sel.id}`, { trialDays: d }), 'Días de prueba cambiados.')() }}>Días de prueba</button>}
            <button className="danger" onClick={() => { if (prompt(`Esto borra TODAS las ventas y movimientos de ${sel.name}. Escribe BORRAR para confirmar:`)?.trim().toUpperCase() !== 'BORRAR') return; const r = prompt('Motivo (ej. terminó la demostración):'); if (r) void run(async () => { const x = await adm('POST', `/admin/businesses/${sel.id}/reset-demo`, { confirm: 'BORRAR', reason: r }); return x }, 'Listo: datos de prueba borrados. El negocio empieza de cero.')() }}>Borrar datos de prueba</button>
            {sel.status === 'vencido' && <button className="danger big" onClick={() => { const r = prompt('Motivo de la suspensión:'); if (r) void run(() => adm('POST', `/admin/businesses/${sel.id}/suspend`, { reason: r }), 'Suspendido. Sus datos quedan intactos.')() }}>Suspender</button>}
          </div>
          <h3 style={{ marginTop: 14 }}>Instalar NEXORA</h3>
          <p className="muted small">Manda al dueño el link para instalar la app en su celular o computadora.</p>
          <WhatsAppShare phone={sel.owner?.phone} who={sel.owner?.name?.split(' ')[0]} />
          <h3 style={{ marginTop: 14 }}>Tipo de negocio</h3>
          <Giros b={sel} onSave={(body) => run(() => adm('PATCH', `/admin/businesses/${sel.id}`, body), 'Tipo de negocio guardado. El cliente lo verá al volver a entrar.')()} />
          <h3 style={{ marginTop: 14 }}>Extras</h3>
          {sel.addons.includes('reservas')
            ? <p className="muted">Link de reservas habilitado.</p>
            : <button onClick={() => { const fee = prompt('Cobro de instalación del link de reservas ($):'); if (fee !== null) void run(() => adm('POST', `/admin/businesses/${sel.id}/addons`, { addon: 'reservas', installationFee: toCents(fee || '0') }), 'Link de reservas habilitado.')() }}>Habilitar link de reservas (con instalación)</button>}
          {sel.oneTimeCharges.length > 0 && <p className="muted">{sel.oneTimeCharges.map((x: any) => `${x.concept}: ${mxn(x.amount)}`).join(' · ')}</p>}
          <h3 style={{ marginTop: 14 }}>Plan</h3>
          <Plan b={sel} onSave={(body) => run(() => adm('PATCH', `/admin/businesses/${sel.id}`, body), 'Plan guardado.')()} />
          <h3 style={{ marginTop: 14 }}>Teléfono del dueño</h3>
          <p className="muted">Con este número entra el dueño: {sel.owner.phone}</p>
          <button onClick={async () => {
            const phone = prompt('Número nuevo del dueño (10 dígitos):')
            if (!phone) return
            const reason = prompt('¿Por qué se cambia? (p. ej. "cambió de número, confirmado por llamada")')
            if (!reason) return
            run(() => adm('POST', `/admin/businesses/${sel.id}/owner-phone`, { phone, reason }), 'Teléfono cambiado. Ya entra con el número nuevo.')()
          }}>Cambiar teléfono</button>
          <h3 style={{ marginTop: 14 }}>Restablecer acceso del dueño</h3>
          <p className="muted">Antes confirma que es el dueño: llámale a su número registrado ({sel.owner.phone}). Le das una contraseña temporal, entra con su teléfono y la cambia.</p>
          <button onClick={async () => {
            try {
              const url = `/admin/businesses/${sel.id}/users/${sel.owner.id}/reset-password`
              const temp = 'Nx-' + Math.random().toString(36).slice(2, 8) + Math.floor(Math.random() * 90 + 10)
              let identity: { identityChallengeId?: string; identityCode?: string } = {}
              let reason = 'Identidad confirmada por llamada a su número registrado'
              try {
                // Con SMS configurado, además le llega un código que te dicta.
                const v = await adm('POST', `/admin/businesses/${sel.id}/verify-owner`)
                const code = prompt(`Código enviado (${v.sentTo}). ¿Qué código te dictó el dueño?`)
                if (!code) return
                identity = { identityChallengeId: v.challengeId, identityCode: code }
                reason = 'Identidad verificada con código a su número'
              } catch (e) {
                if ((e as { code?: string }).code !== 'sin_sms') throw e
                if (!confirm(`¿Ya confirmaste por llamada al ${sel.owner.phone} que es el dueño de ${sel.name}?`)) return
              }
              const p = prompt('Contraseña temporal (mínimo 8). Díctasela al dueño:', temp)
              if (!p) return
              await adm('POST', url, { newPassword: p, reason, ...identity })
              setMsg({ ok: `Listo. Contraseña temporal: ${p} — al entrar le pedirá cambiarla.` })
            } catch (e) { setMsg({ err: (e as Error).message }) }
          }}>Dar contraseña temporal</button>
        </section>
      )}
    </div>
  )
}

function Plan({ b, onSave }: { b: any; onSave: (body: any) => void }) {
  const [f, setF] = useState({ plan: b.plan.plan, extraBranches: String(b.plan.extraBranches), extraUserPacks: String(b.plan.extraUserPacks), applyNow: false })
  useEffect(() => setF({ plan: b.plan.plan, extraBranches: String(b.plan.extraBranches), extraUserPacks: String(b.plan.extraUserPacks), applyNow: false }), [b.id])
  return (
    <>
      <label>Plan<select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>{Object.entries(PLANS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <div className="row"><label>Sucursales extra ($300)<input inputMode="numeric" value={f.extraBranches} onChange={(e) => setF({ ...f, extraBranches: e.target.value })} /></label><label>Paquetes de 5 usuarios ($200)<input inputMode="numeric" value={f.extraUserPacks} onChange={(e) => setF({ ...f, extraUserPacks: e.target.value })} /></label></div>
      <label style={{ fontWeight: 500 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0, marginRight: 8 }} checked={f.applyNow} onChange={(e) => setF({ ...f, applyNow: e.target.checked })} />Aplicar ya (si no, en el siguiente pago)</label>
      <p><button onClick={() => onSave({ plan: f.plan, extraBranches: Number(f.extraBranches) || 0, extraUserPacks: Number(f.extraUserPacks) || 0, applyNow: f.applyNow })}>Guardar plan</button></p>
    </>
  )
}

const GIRO_KEYS = Object.keys(GIROS)

/** Cambiar el giro principal y los adicionales de un negocio (solo soporte). */
function Giros({ b, onSave }: { b: any; onSave: (body: { giro: string; extraGiros: string[] }) => void }) {
  const [giro, setGiro] = useState<string>(b.giro)
  const [extra, setExtra] = useState<string[]>((b.giros ?? [b.giro]).slice(1))
  useEffect(() => { setGiro(b.giro); setExtra((b.giros ?? [b.giro]).slice(1)) }, [b.id])
  return (
    <div>
      <label>Giro principal<select value={giro} onChange={(e) => { setGiro(e.target.value); setExtra(extra.filter((g) => g !== e.target.value)) }}>{GIRO_KEYS.map((g) => <option key={g} value={g}>{giroLabel(g)}</option>)}</select></label>
      <p className="muted small" style={{ margin: '6px 0' }}>Giros adicionales (negocio mixto)</p>
      <div className="checks">{GIRO_KEYS.filter((g) => g !== giro).map((g) => <label key={g} className="check"><input type="checkbox" checked={extra.includes(g)} onChange={() => setExtra(extra.includes(g) ? extra.filter((x) => x !== g) : [...extra, g])} />{giroLabel(g)}</label>)}</div>
      <button onClick={() => onSave({ giro, extraGiros: extra })}>Guardar tipo de negocio</button>
    </div>
  )
}

function Alta({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ businessName: '', ownerName: '', phone: '', tempPassword: '', trialDays: '', giro: 'abarrotes', extraGiros: [] as string[], free: false })
  const [err, setErr] = useState('')
  const [done, setDone] = useState<any>(null)
  if (done) {
    const text = `Hola ${f.ownerName.split(' ')[0]}, ya está lista tu cuenta de NEXORA para ${f.businessName}.\n\n1. Instala la app desde aquí (Android, iPhone o computadora): ${downloadUrl()}\n2. Entra con tu teléfono ${f.phone} y la contraseña temporal ${f.tempPassword}. Te pedirá cambiarla.`
    return (
      <div className="card login">
        <h2>Negocio creado</h2>
        <p>Entrégale al dueño: teléfono <b>{f.phone}</b>, contraseña temporal <b>{f.tempPassword}</b>. Sus empleados entrarán con el usuario y la contraseña que el dueño les cree.</p>
        <p className="row">
          <a className="button primary" href={`https://wa.me/52${f.phone.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Enviar acceso por WhatsApp</a>
          <button onClick={onDone}>Listo</button>
        </p>
      </div>
    )
  }
  return (
    <div className="card login">
      <h2>Alta asistida</h2>
      <label>Nombre del negocio<input value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} /></label>
      <label>Giro principal<select value={f.giro} onChange={(e) => setF({ ...f, giro: e.target.value, extraGiros: f.extraGiros.filter((g) => g !== e.target.value) })}>{GIRO_KEYS.map((g) => <option key={g} value={g}>{giroLabel(g)}</option>)}</select></label>
      <p style={{ marginBottom: 4 }}><b>Negocio mixto</b> <span className="muted">— otros giros que también maneja (opcional)</span></p>
      <div className="checks">{GIRO_KEYS.filter((g) => g !== f.giro).map((g) => <label key={g} style={{ fontWeight: 500 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0, marginRight: 8 }} checked={f.extraGiros.includes(g)} onChange={() => setF({ ...f, extraGiros: f.extraGiros.includes(g) ? f.extraGiros.filter((x) => x !== g) : [...f.extraGiros, g] })} />{giroLabel(g)}</label>)}</div>
      <label>Nombre del dueño<input value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></label>
      <label>Teléfono del dueño<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
      <label>Contraseña temporal<input value={f.tempPassword} onChange={(e) => setF({ ...f, tempPassword: e.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={f.free} onChange={(e) => setF({ ...f, free: e.target.checked })} />Gratis (sin mensualidad ni vencimiento)</label>
      {!f.free && <label>Días de prueba (vacío = el valor por defecto)<input inputMode="numeric" value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: e.target.value })} /></label>}
      {err && <p className="error">{err}</p>}
      <p><button className="primary big" style={{ width: '100%' }} onClick={async () => { try { const r = await adm('POST', '/admin/businesses', { ...f, trialDays: f.trialDays ? Number(f.trialDays) : undefined }); setDone(r.business) } catch (e) { setErr((e as Error).message) } }}>Crear negocio</button></p>
    </div>
  )
}

function BuzonAdmin() {
  const [list, setList] = useState<any[]>([])
  const [sel, setSel] = useState<any>(null)
  const [reply, setReply] = useState('')
  const load = async () => setList((await adm('GET', '/admin/tickets')).tickets)
  useEffect(() => { void load() }, [])
  const open = async (t: any) => { setSel({ ...(await adm('GET', `/admin/tickets/${t.id}`)).ticket, type: t.type, business: t.business_name }); void load() }
  const status = async (s: string) => { const r = await adm('PATCH', `/admin/tickets/${sel.id}`, { status: s }); setSel({ ...sel, ...r.ticket }); void load() }
  return (
    <div className="grid2">
      <section className="card">
        <h2>Buzón</h2>
        <div className="table-wrap"><table className="list"><tbody>{list.map((t) => (
          <tr key={t.id} onClick={() => open(t)} style={{ cursor: 'pointer', fontWeight: t.unread_by_support ? 700 : 400 }}><td>{t.business_name}<br /><small className="muted">{t.type === 'cambio' ? `Cambio · ${t.module}` : 'Soporte'} · {t.subject}</small></td><td>{t.status}</td></tr>
        ))}</tbody></table></div>
      </section>
      {sel && (
        <section className="card">
          <h2>{sel.subject}</h2>
          <p className="muted">{sel.business} · {sel.status}</p>
          {sel.messages.map((m: any, i: number) => <div key={i} className="card" style={{ marginBottom: 8 }}><small className="muted">{m.author} · {new Date(m.createdAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', hour12: true, timeZone: 'America/Mexico_City' })}</small><p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{m.body}</p></div>)}
          <label>Responder<textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} /></label>
          <p className="row"><button className="primary" disabled={!reply.trim()} onClick={async () => { const r = await adm('POST', `/admin/tickets/${sel.id}/messages`, { message: reply }); setSel({ ...sel, ...r.ticket }); setReply('') }}>Enviar</button>
            {sel.type === 'cambio' ? ['en_revision', 'aceptada', 'rechazada'].map((s) => <button key={s} onClick={() => status(s)}>{s.replace('_', ' ')}</button>) : <button onClick={() => status('cerrado')}>Cerrar</button>}</p>
        </section>
      )}
    </div>
  )
}

function AjustesAdmin() {
  const [s, setS] = useState<any>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => { adm('GET', '/admin/settings').then((r) => setS(r.settings)).catch((e) => setMsg(e.message)) }, [])
  if (!s) return <p className="muted">{msg || 'Cargando…'}</p>
  return (
    <div className="card login">
      <h2>Valores por defecto</h2>
      <label>Días de prueba para negocios nuevos<input inputMode="numeric" value={s.default_trial_days} onChange={(e) => setS({ ...s, default_trial_days: Number(e.target.value) || 0 })} /></label>
      <label>Días vencido antes de poder suspender<input inputMode="numeric" value={s.suspend_after_days} onChange={(e) => setS({ ...s, suspend_after_days: Number(e.target.value) || 0 })} /></label>
      <p><button className="primary" onClick={async () => { await adm('PUT', '/admin/settings', s); setMsg('Guardado.') }}>Guardar</button></p>
      {msg && <p className="muted">{msg}</p>}
      <h2 style={{ marginTop: 16 }}>Contacto del aviso de privacidad</h2>
      <CorreoPrivacidad />
      <h2 style={{ marginTop: 16 }}>Cambiar mi contraseña</h2>
      <CambiarClave />
      <h2 style={{ marginTop: 16 }}>Salud del sistema</h2>
      <Salud />
      <h2 style={{ marginTop: 16 }}>Espacio de la base</h2>
      <Espacio />
      <h2 style={{ marginTop: 16 }}>Respaldos</h2>
      <Respaldos />
      <p className="muted">Precios de planes: {mxn(50000)} / {mxn(70000)} / {mxn(90000)}; sucursal extra {mxn(30000)}; paquete de 5 usuarios {mxn(toCents('200'))}.</p>
    </div>
  )
}

function Salud() {
  const [h, setH] = useState<any>(null)
  const [msg, setMsg] = useState('')
  const load = () => adm('GET', '/admin/salud').then(setH).catch((e) => setMsg(e.message))
  useEffect(() => { void load() }, [])
  if (!h) return <p className="muted">{msg || 'Revisando…'}</p>
  const ico = h.status === 'ok' ? '🟢' : h.status === 'atencion' ? '🟡' : '🔴'
  return (
    <>
      <p><b>{ico} {h.status === 'ok' ? 'Todo en orden' : h.status === 'atencion' ? 'Atención' : 'Problema crítico'}</b> <small className="muted">· revisado {new Date(h.checkedAt).toLocaleTimeString('es-MX')}</small> <button className="mini" onClick={load}>Actualizar</button></p>
      {h.issues.map((x: string, i: number) => <p key={i} className="error">{x}</p>)}
      {h.warnings.map((x: string, i: number) => <p key={i} className="muted">⚠ {x}</p>)}
      <p className="muted small">Esquema {h.schema.database}/{h.schema.code} · ventas 24 h: {h.sales.last24h} · respaldos de negocio: {h.backups.businessesOk} bien, {h.backups.businessesFailed} fallidos · último completo: {h.backups.lastFull ? `${new Date(h.backups.lastFull.created_at).toLocaleString('es-MX')} (${h.backups.lastFull.status})` : 'nunca'}</p>
      {h.errors24h.length > 0 && <div className="table-wrap"><table className="list"><tbody>{h.errors24h.map((e: any, i: number) => <tr key={i}><td>{e.route ?? e.source}<br /><small className="muted">{e.message}</small></td><td className="num">×{e.count}</td></tr>)}</tbody></table></div>}
    </>
  )
}

function CambiarClave() {
  const [f, setF] = useState({ a: '', b: '', c: '' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  return (
    <>
      <label>Contraseña actual<input type="password" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })} /></label>
      <label>Contraseña nueva (mínimo 8)<input type="password" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })} /></label>
      <label>Repite la nueva<input type="password" value={f.c} onChange={(e) => setF({ ...f, c: e.target.value })} /></label>
      {msg.err && <p className="error">{msg.err}</p>}
      {msg.ok && <p className="okmsg">{msg.ok}</p>}
      <p><button className="primary" disabled={!f.a || f.b.length < 8} onClick={async () => {
        if (f.b !== f.c) return setMsg({ err: 'Las contraseñas nuevas no coinciden.' })
        try { await adm('POST', '/admin/password', { currentPassword: f.a, newPassword: f.b }); setF({ a: '', b: '', c: '' }); setMsg({ ok: 'Contraseña cambiada.' }) } catch (e) { setMsg({ err: (e as Error).message }) }
      }}>Cambiar contraseña</button></p>
    </>
  )
}

/** Correo que aparece en el aviso de privacidad (/privacidad). Debe ser del negocio, no personal. */
function CorreoPrivacidad() {
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => { adm('GET', '/admin/privacy-contact').then((r) => setEmail(r.email ?? '')).catch(() => {}) }, [])
  return (
    <>
      <p className="muted small">Aparece en el aviso de privacidad. Sin correo, el aviso pide escribir por el buzón de Soporte de la app.</p>
      <label>Correo para temas de privacidad<input type="email" value={email} placeholder="privacidad@tunegocio.mx" onChange={(e) => setEmail(e.target.value)} /></label>
      <p><button className="primary" onClick={async () => { try { await adm('PUT', '/admin/privacy-contact', { email: email.trim() || null }); setMsg('Guardado. Revísalo en /privacidad.') } catch (e) { setMsg((e as Error).message) } }}>Guardar correo</button></p>
      {msg && <p className="muted">{msg}</p>}
    </>
  )
}

/** Cuánto ocupa la base contra el tope de Cloudflare y cuántos meses quedan al ritmo actual. */
function Espacio() {
  const [s, setS] = useState<any>(null)
  useEffect(() => { adm('GET', '/admin/storage').then(setS).catch(() => setS(null)) }, [])
  if (!s) return <p className="muted">Cargando…</p>
  const mb = (b: number) => `${(b / 1048576).toFixed(b < 10485760 ? 1 : 0)} MB`
  return (
    <div className="card">
      <p><b>{mb(s.bytes)}</b> de {mb(s.limit)} ({s.pct}%)</p>
      <div className="goal-bar" style={{ height: 10, borderRadius: 6, background: 'var(--surface-sunken)', overflow: 'hidden' }}><div style={{ width: `${Math.min(100, s.pct)}%`, height: '100%', background: s.level === 'ok' ? 'var(--ok, #2e9d5b)' : s.level === 'aviso' ? 'var(--warn, #d9a400)' : 'var(--danger)' }} /></div>
      <p className="muted small">Ventas últimos 30 días: {s.sales30} · crece ~{mb(s.perMonth)} al mes{s.monthsLeft != null ? ` · alcanza para ~${s.monthsLeft} meses` : ''}.</p>
      {s.level !== 'ok' && <p className="error">Hay que separar la base por negocio o pasar al plan de pago antes de llegar al tope (ver docs/modernizacion/08-seguridad.md §5).</p>}
    </div>
  )
}

/** Respaldos automáticos (cada noche, 30 días) y descarga completa al momento. */
function Respaldos() {
  const [list, setList] = useState<{ name: string; size: number }[]>([])
  const [enabled, setEnabled] = useState(true)
  const [crypt, setCrypt] = useState<{ encrypted: boolean; keyFingerprint: string | null } | null>(null)
  const [msg, setMsg] = useState('')
  const load = () => adm('GET', '/admin/backups').then((r) => { setList(r.backups); setEnabled(r.enabled); setCrypt({ encrypted: !!r.encrypted, keyFingerprint: r.keyFingerprint ?? null }) }).catch((e) => setMsg(e.message))
  useEffect(() => { void load() }, [])
  const download = async (name: string) => {
    const res = await fetch(`/api/admin/backups/${name}`, { headers: { authorization: `Bearer ${localStorage.getItem(TOKEN)}` } })
    if (!res.ok) return setMsg('No se pudo descargar.')
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
  }
  return (
    <>
      <p className="muted">Se hace uno solo cada noche (3:17 a. m.) y se guardan 30 días. Si hay correo configurado, también te llega a tu correo.</p>
      {crypt && (crypt.encrypted
        ? <p className="okmsg">🔒 Cifrados. Huella de la llave activa: <b>{crypt.keyFingerprint}</b>. Debe coincidir con la de la llave que guardaste (<code>npm run backup:key -- --huella</code>).</p>
        : <p className="error">Sin cifrar: los respaldos tienen teléfonos y ventas en claro. Para activarlo, ver docs/modernizacion/12-respaldos-y-recuperacion.md.</p>)}
      {enabled && <p><button className="primary" onClick={async () => { try { const r = await adm('POST', '/admin/backups'); setMsg(`Respaldo listo: ${r.name}${r.emailed ? ' (enviado a tu correo)' : ''}`); void load() } catch (e) { setMsg((e as Error).message) } }}>Respaldar ahora</button></p>}
      {msg && <p className="muted">{msg}</p>}
      <div className="table-wrap"><table className="list"><tbody>{list.map((b) => (
        <tr key={b.name}><td>{b.name.slice(7, 17)} {b.name.slice(18, 23).replace('-', ':')} UTC<br /><small className="muted">{(b.size / 1024).toFixed(0)} KB</small></td><td><button onClick={() => download(b.name)}>Descargar</button></td></tr>
      ))}</tbody></table></div>
      {enabled && list.length === 0 && <p className="muted">Todavía no hay respaldos.</p>}
      <p><button onClick={async () => { const d = await adm('GET', '/admin/export'); const url = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `nexora-${d.exportedAt.slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url) }}>Descargar todo ahora (sin comprimir)</button></p>
    </>
  )
}

/** Demos: un negocio de prueba por giro, con datos ficticios, para conocer el sistema y capacitar. */
function Demos() {
  const [list, setList] = useState<any[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => setList((await adm('GET', '/admin/demos')).demos)
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [])
  const create = async (giros: string[]) => {
    setMsg({})
    for (const g of giros) {
      setBusy(g)
      try { await adm('POST', `/admin/demos/${g}`) } catch (e) { setMsg({ err: (e as Error).message }); break }
      await load()
    }
    setBusy(null)
    setMsg((m) => (m.err ? m : { ok: 'Listo. Ya puedes entrar a cada demo con sus accesos.' }))
  }
  const missing = list.filter((d) => !d.created).map((d) => d.giro)
  const text = list.filter((d) => d.created).map((d) => `${d.label}: dueño ${d.phone} / ${d.password} · empleado ${d.staffUser} / ${d.staffPassword} · código ${d.code}`).join('\n')
  return (
    <section className="card">
      <div className="card-head"><h2>Negocios de demostración</h2>
        {missing.length > 0 && <button className="primary" disabled={!!busy} onClick={() => void create(missing)}>{busy ? `Creando ${list.find((d) => d.giro === busy)?.label}…` : `Crear ${missing.length === list.length ? 'todas las demos' : `las ${missing.length} que faltan`}`}</button>}
      </div>
      <p className="muted small">Un negocio por giro con inventario, proveedores, clientes, fiados, ventas de la semana y lo propio de cada giro (agenda, mesas, boletos, recetas…), todo ficticio. Son gratis y no se cobran. Entra en {location.origin}: el dueño con «Dueño» (teléfono y contraseña) y el empleado con «Empleado» (usuario y contraseña). El código de autorización es <b>1234</b>. Si algo se ensucia, usa «Borrar datos de prueba» en ese negocio.</p>
      {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
      <div className="table-wrap"><table className="list">
        <thead><tr><th>Giro</th><th>Dueño (teléfono / contraseña)</th><th>Empleado (usuario / contraseña)</th><th /></tr></thead>
        <tbody>{list.map((d) => (
          <tr key={d.giro}>
            <td><b>{d.label}</b>{!d.created && <><br /><small className="muted">sin crear</small></>}</td>
            <td><code>{d.phone}</code> / <code>{d.password}</code></td>
            <td><code>{d.staffUser}</code> / <code>{d.staffPassword}</code></td>
            <td className="num">{!d.created && <button className="mini" disabled={!!busy} onClick={() => void create([d.giro])}>{busy === d.giro ? 'Creando…' : 'Crear'}</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {text && <p><button onClick={async () => { try { await navigator.clipboard.writeText(text); setMsg({ ok: 'Accesos copiados.' }) } catch { prompt('Copia los accesos:', text) } }}>Copiar todos los accesos</button></p>}
    </section>
  )
}
