import { useEffect, useState } from 'react'
import { ApiError, mxn, toCents } from '../api'
import { downloadUrl, WhatsAppShare } from './Descargar'
import { Logo } from '../Brand'
import { GIROS, giroLabel } from '../giros'

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
const COLOR: Record<string, string> = { prueba: '#2563eb', activo: 'var(--ok)', vencido: 'var(--accent)', suspendido: 'var(--danger)' }
const PLANS: Record<string, string> = { inicial: 'Inicial ($500, 3 usuarios)', crecimiento: 'Crecimiento ($700, 5)', profesional: 'Profesional ($900, 10)' }

export function SuperPanel() {
  const [logged, setLogged] = useState(!!localStorage.getItem(TOKEN))
  const [tab, setTab] = useState<'negocios' | 'buzon' | 'alta' | 'ajustes'>('negocios')
  if (!logged) return <AdminLogin onLogin={() => setLogged(true)} />
  return (
    <div className="admin-app">
      <header className="adminbar">
        <span className="brand" style={{ padding: 0 }}><Logo size={28} /><span className="word">NEXORA</span><span className="muted" style={{ letterSpacing: 0, fontWeight: 600 }}>Super panel</span></span>
        <nav>{(['negocios', 'buzon', 'alta', 'ajustes'] as const).map((k) => <a key={k} href="#" className={tab === k ? 'on' : ''} onClick={(e) => { e.preventDefault(); setTab(k) }}>{{ negocios: 'Negocios', buzon: 'Buzón', alta: 'Alta asistida', ajustes: 'Ajustes' }[k]}</a>)}</nav>
        <button onClick={() => { localStorage.removeItem(TOKEN); setLogged(false) }}>Salir</button>
      </header>
      <main>{tab === 'negocios' ? <Negocios /> : tab === 'buzon' ? <BuzonAdmin /> : tab === 'alta' ? <Alta onDone={() => setTab('negocios')} /> : <AjustesAdmin />}</main>
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
  const [sel, setSel] = useState<any>(null)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => { const r = await adm('GET', `/admin/businesses${filter ? `?status=${filter}` : ''}`); setList(r.businesses); if (sel) setSel(r.businesses.find((b: any) => b.id === sel.id) ?? null) }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [filter])
  const run = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); setMsg({ ok }); await load() } catch (e) { setMsg({ err: (e as Error).message }) } }
  return (
    <div className="grid2">
      <section className="card">
        <div className="tabs">{['', 'prueba', 'activo', 'vencido', 'suspendido', 'gratis'].map((s) => <button key={s} className={filter === s ? 'on' : ''} onClick={() => setFilter(s)}>{s === 'gratis' ? 'Gratis' : s ? STATUS[s] : 'Todos'}</button>)}</div>
        <div className="table-wrap"><table className="list"><tbody>{list.map((b) => (
          <tr key={b.id} onClick={() => setSel(b)} style={{ cursor: 'pointer' }}>
            <td><b>{b.name}</b> <small className="muted">{b.code} · {(b.giros ?? [b.giro]).map(giroLabel).join(' + ')}</small><br /><small className="muted">{b.owner?.name} · {b.owner?.phone}{b.unreadTickets ? ` · ✉ ${b.unreadTickets}` : ''}</small></td>
            <td style={{ color: b.free ? 'var(--cyan)' : COLOR[b.status], fontWeight: 700 }}>{b.free ? 'Gratis' : STATUS[b.status]}{!b.free && b.overdueDays != null ? ` (${b.overdueDays} d)` : ''}</td>
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
      <h2 style={{ marginTop: 16 }}>Cambiar mi contraseña</h2>
      <CambiarClave />
      <h2 style={{ marginTop: 16 }}>Respaldos</h2>
      <Respaldos />
      <p className="muted">Precios de planes: {mxn(50000)} / {mxn(70000)} / {mxn(90000)}; sucursal extra {mxn(30000)}; paquete de 5 usuarios {mxn(toCents('200'))}.</p>
    </div>
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

/** Respaldos automáticos (cada noche, 30 días) y descarga completa al momento. */
function Respaldos() {
  const [list, setList] = useState<{ name: string; size: number }[]>([])
  const [enabled, setEnabled] = useState(true)
  const [msg, setMsg] = useState('')
  const load = () => adm('GET', '/admin/backups').then((r) => { setList(r.backups); setEnabled(r.enabled) }).catch((e) => setMsg(e.message))
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
