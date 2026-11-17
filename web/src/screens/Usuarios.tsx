import { useEffect, useState } from 'react'
import { api } from '../api'
import { hasGiro, type Me } from '../App'

const TEMPLATE_LABEL: Record<string, string> = { cajero: 'Cajero', encargado: 'Encargado', barbero: 'Barbero', empleado_piso: 'Empleado de piso' }

/** Personal: quién trabaja aquí, cómo entra y qué puede hacer. */
export function Usuarios({ me }: { me: Me }) {
  const [users, setUsers] = useState<any[]>([])
  const [catalog, setCatalog] = useState<{ permissions: { key: string; label: string }[]; templates: { key: string; label: string; permissions: string[] }[] }>({ permissions: [], templates: [] })
  const [sel, setSel] = useState<any>(null)
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => {
    setUsers((await api<any>('GET', '/users')).users)
    setCatalog(await api('GET', '/permissions'))
  }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [])
  const owner = me.user.role === 'owner'
  const roleOf = (u: any) => {
    if (u.role === 'owner') return 'Dueño'
    const t = catalog.templates.find((t) => t.permissions.length === u.permissions.length && t.permissions.every((p) => u.permissions.includes(p)))
    return t ? t.label : 'Permisos a la medida'
  }
  const ownerRow = users.find((u) => u.role === 'owner')
  return (
    <div className="page">
      <div className="toolbar">
        <p className="muted" style={{ margin: 0, flex: 1 }}>Tus empleados entran en <b>{location.host}</b> → «Empleado», con su usuario y contraseña.</p>
        <button className="primary" onClick={() => setAdding(true)}>+ Nuevo empleado</button>
      </div>
      {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
      <div className="grid2 config">
        <section className="card">
          <h2>Equipo</h2>
          <table className="list">
            <thead><tr><th>Nombre</th><th className="hide-sm">Usuario</th><th>Puesto</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.role === 'owner' ? '' : 'clickable'} onClick={() => u.role !== 'owner' && setSel({ ...u })}>
                  <td><b>{u.name}</b>{!u.active && <><br /><small className="neg">desactivado</small></>}</td>
                  <td className="hide-sm muted">{u.username ?? 'entra con su teléfono'}</td>
                  <td>{roleOf(u)}</td>
                  <td className="num">{u.role !== 'owner' && <button className="mini" onClick={(e) => { e.stopPropagation(); setSel({ ...u }) }}>Abrir</button>}</td>
                </tr>
              ))}
              {users.length <= 1 && <tr><td colSpan={4} className="empty">Todavía no hay empleados. Agrega al primero con «+ Nuevo empleado».</td></tr>}
            </tbody>
          </table>
        </section>
        <div className="stack">
          <Asistencia />
          {owner && ownerRow && (
            <section className="card">
              <h2>Tu código de autorización</h2>
              <p className="muted small">Es distinto a tu contraseña. Sirve para autorizar cancelaciones, descuentos y cambios de precio.</p>
              <p className="muted small">{ownerRow.hasAuthCode ? 'Ya tienes un código asignado.' : 'Todavía no tienes código.'}</p>
              <button className="primary" onClick={() => { const c = prompt('Tu código (mínimo 4 dígitos):'); if (c) void api('PUT', `/users/${me.user.id}/auth-code`, { code: c }).then(() => { setMsg({ ok: 'Código asignado.' }); void load() }).catch((e) => setMsg({ err: e.message })) }}>{ownerRow.hasAuthCode ? 'Cambiar mi código' : 'Asignar mi código'}</button>
            </section>
          )}
        </div>
      </div>
      {adding && <NuevoEmpleado templates={catalog.templates} onClose={() => setAdding(false)} onDone={(u) => { setAdding(false); setMsg({ ok: `Listo: ${u} ya puede entrar con su usuario y contraseña.` }); void load() }} />}
      {sel && <Empleado me={me} u={sel} catalog={catalog} onClose={() => setSel(null)} onChanged={() => void load()} />}
    </div>
  )
}

function NuevoEmpleado({ templates, onClose, onDone }: { templates: { key: string; label: string }[]; onClose: () => void; onDone: (name: string) => void }) {
  const [f, setF] = useState({ name: '', username: '', password: '', template: 'cajero' })
  const [err, setErr] = useState('')
  const suggest = (name: string) => name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '')
  return (
    <div className="modal" onClick={onClose}>
      <form className="card" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => { e.preventDefault(); try { await api('POST', '/users', f); onDone(f.name) } catch (x) { setErr((x as Error).message) } }}>
        <h2>Nuevo empleado</h2>
        <label>Nombre completo<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, username: f.username && f.username !== suggest(f.name) ? f.username : suggest(e.target.value) })} autoFocus /></label>
        <div className="row">
          <label>Usuario para entrar<input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoCapitalize="none" /></label>
          <label>Contraseña inicial<input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="mínimo 8" /></label>
        </div>
        <p className="muted small">El usuario no se puede repetir con otro negocio. En su primer ingreso le pedirá cambiar la contraseña.</p>
        <label>Puesto<select value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })}>{templates.map((t) => <option key={t.key} value={t.key}>{TEMPLATE_LABEL[t.key] ?? t.label}</option>)}</select></label>
        <p className="muted small">El puesto pone permisos de inicio; después puedes ajustarlos uno por uno.</p>
        {err && <p className="error">{err}</p>}
        <p className="row"><button type="button" onClick={onClose}>Cancelar</button><button className="primary" disabled={f.name.trim().length < 2 || f.username.trim().length < 3 || f.password.length < 8}>Crear empleado</button></p>
      </form>
    </div>
  )
}

function Empleado({ me, u, catalog, onClose, onChanged }: { me: Me; u: any; catalog: { permissions: { key: string; label: string }[] }; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<'permisos' | 'acceso' | 'horario'>('permisos')
  const [perms, setPerms] = useState<string[]>(u.permissions)
  const [active, setActive] = useState<boolean>(u.active)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const run = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); setMsg({ ok }); onChanged() } catch (e) { setMsg({ err: (e as Error).message }) } }
  const owner = me.user.role === 'owner'
  const agenda = owner && hasGiro(me, 'barberia', 'unas')
  return (
    <div className="modal" onClick={onClose}>
      <div className="card wide" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h2>{u.name}</h2><button className="mini" onClick={onClose}>Cerrar</button></div>
        <p className="muted small" style={{ marginTop: -4 }}>Usuario: <b>{u.username}</b>{!active && ' · desactivado'}</p>
        <nav className="subtabs">
          <button className={tab === 'permisos' ? 'on' : ''} onClick={() => setTab('permisos')}>Qué puede hacer</button>
          <button className={tab === 'acceso' ? 'on' : ''} onClick={() => setTab('acceso')}>Acceso</button>
          {agenda && <button className={tab === 'horario' ? 'on' : ''} onClick={() => setTab('horario')}>Horario de agenda</button>}
        </nav>
        {tab === 'permisos' && (<>
          <div className="checks perms">
            {catalog.permissions.map((p) => (
              <label key={p.key} className="check"><input type="checkbox" disabled={p.key === 'view_reports'} checked={p.key === 'view_reports' || perms.includes(p.key)} onChange={() => setPerms(perms.includes(p.key) ? perms.filter((x) => x !== p.key) : [...perms, p.key])} />{p.label}</label>
            ))}
          </div>
          <p className="muted small">Lo que no esté marcado no le aparece en pantalla.</p>
          <p><button className="primary" onClick={run(() => api('PATCH', `/users/${u.id}`, { permissions: perms }), 'Permisos guardados.')}>Guardar permisos</button></p>
        </>)}
        {tab === 'acceso' && (
          <div className="stack">
            <div className="info-row"><span>Contraseña olvidada</span><button className="mini" onClick={() => { const p = prompt('Contraseña nueva (mínimo 8). Díctasela a la persona:'); if (p) void run(() => api('POST', `/users/${u.id}/reset-password`, { newPassword: p }), 'Contraseña restablecida. Le pedirá cambiarla al entrar.')() }}>Restablecer</button></div>
            {owner && <div className="info-row"><span>Código de autorización {u.hasAuthCode ? '(asignado)' : '(sin código)'}</span><button className="mini" onClick={() => { const c = prompt('Código de autorización para esta persona (mínimo 4):'); if (c) void run(() => api('PUT', `/users/${u.id}/auth-code`, { code: c }), 'Código asignado.')() }}>{u.hasAuthCode ? 'Cambiar' : 'Asignar'}</button></div>}
            <div className="info-row"><span>{active ? 'Puede entrar al sistema' : 'Desactivado: no puede entrar'}</span><button className={active ? 'mini danger' : 'mini'} onClick={run(async () => { await api('PATCH', `/users/${u.id}`, { active: !active }); setActive(!active) }, active ? 'Desactivado. Su historial se conserva.' : 'Activado.')}>{active ? 'Desactivar' : 'Activar'}</button></div>
          </div>
        )}
        {tab === 'horario' && <Horario userId={u.id} />}
        {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
      </div>
    </div>
  )
}

/** Para quien solo registra su asistencia (p. ej. empleado de piso). */
export function MiAsistencia(_: { me: Me }) {
  return <div style={{ maxWidth: 640 }}><Asistencia /></div>
}

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

/** Horario de agenda: días que trabaja (los demás son de descanso) y horas. */
function Horario({ userId }: { userId: string }) {
  const [inAgenda, setInAgenda] = useState(false)
  const [days, setDays] = useState(DAYS.map(() => ({ on: false, start: '10:00', end: '19:00' })))
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api<any>('GET', '/agenda/staff').then((r) => {
      const me = r.staff.find((s: any) => s.id === userId)
      setInAgenda(!!me)
      if (me) setDays(DAYS.map((_, i) => { const w = me.schedule.find((x: any) => x.weekday === i); return w ? { on: true, start: w.start, end: w.end } : { on: false, start: '10:00', end: '19:00' } }))
    }).catch(() => {})
  }, [userId])
  const save = async () => {
    try {
      await api('PUT', `/staff/${userId}/agenda`, { inAgenda, schedule: days.map((d, weekday) => ({ ...d, weekday })).filter((d) => d.on).map(({ weekday, start, end }) => ({ weekday, start, end })) })
      setMsg('Horario guardado.')
    } catch (e) { setMsg((e as Error).message) }
  }
  return (
    <div>
      <label className="check"><input type="checkbox" checked={inAgenda} onChange={(e) => setInAgenda(e.target.checked)} />Atiende citas (aparece en la agenda)</label>
      {days.map((d, i) => (
        <div className="row day" key={i}>
          <label className="check" style={{ flex: '0 0 150px' }}><input type="checkbox" checked={d.on} onChange={(e) => setDays(days.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />{DAYS[i]}</label>
          <input aria-label={`Entrada ${DAYS[i]}`} type="time" disabled={!d.on} value={d.start} onChange={(e) => setDays(days.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
          <input aria-label={`Salida ${DAYS[i]}`} type="time" disabled={!d.on} value={d.end} onChange={(e) => setDays(days.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
        </div>
      ))}
      <p><button className="primary" onClick={save}>Guardar horario</button></p>
      {msg && <p className="muted">{msg}</p>}
    </div>
  )
}

/** Asistencia del personal de hoy, y registrar la propia entrada o salida. */
function Asistencia() {
  const [rows, setRows] = useState<any[]>([])
  const [msg, setMsg] = useState('')
  const from = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
  const load = () => api<any>('GET', `/attendance?from=${from}`).then((r) => setRows(r.attendance)).catch(() => {})
  useEffect(() => { void load() }, [])
  const clock = async (type: string) => { try { await api('POST', '/attendance/clock', { type }); setMsg(''); void load() } catch (e) { setMsg((e as Error).message) } }
  return (
    <section className="card">
      <h2>Asistencia de hoy</h2>
      <div className="pay"><button className="big" onClick={() => clock('entrada')}>Registrar mi entrada</button><button className="big" onClick={() => clock('salida')}>Registrar mi salida</button></div>
      {msg && <p className="error">{msg}</p>}
      <table className="list"><tbody>{rows.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.type === 'entrada' ? 'Entrada' : 'Salida'}</td><td className="num">{new Date(r.at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</td></tr>)}</tbody></table>
      {rows.length === 0 && <p className="muted">Nadie ha registrado hoy.</p>}
    </section>
  )
}
