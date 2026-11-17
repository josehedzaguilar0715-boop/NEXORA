import { useEffect, useState } from 'react'
import { api } from '../api'
import type { Me } from '../App'

export function Usuarios({ me }: { me: Me }) {
  const [users, setUsers] = useState<any[]>([])
  const [catalog, setCatalog] = useState<{ permissions: { key: string; label: string }[]; templates: { key: string; label: string; permissions: string[] }[] }>({ permissions: [], templates: [] })
  const [f, setF] = useState({ name: '', username: '', password: '', template: 'cajero' })
  const [sel, setSel] = useState<any>(null)
  const [msg, setMsg] = useState('')
  const load = async () => {
    setUsers((await api<any>('GET', '/users')).users)
    setCatalog(await api('GET', '/permissions'))
  }
  useEffect(() => { void load().catch((e) => setMsg(e.message)) }, [])
  const run = (fn: () => Promise<unknown>, ok = 'Guardado.') => async () => { try { await fn(); setMsg(ok); await load() } catch (e) { setMsg((e as Error).message) } }
  const toggle = (k: string) => setSel({ ...sel, permissions: sel.permissions.includes(k) ? sel.permissions.filter((x: string) => x !== k) : [...sel.permissions, k] })

  return (
    <div className="grid2">
      <section className="card">
        <h2>Personal</h2>
        <p className="muted">Código del negocio para entrar: <b>{me.business.code}</b></p>
        <table className="list"><tbody>
          {users.map((u) => <tr key={u.id} onClick={() => u.role !== 'owner' && setSel({ ...u })} style={{ cursor: 'pointer' }}><td>{u.name}<br /><small className="muted">{u.username ?? 'dueño'}{u.active ? '' : ' · desactivado'}</small></td></tr>)}
        </tbody></table>
        <h3 style={{ marginTop: 14 }}>Nuevo usuario</h3>
        <label>Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <div className="row"><div><label>Usuario<input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoCapitalize="none" /></label></div><div><label>Contraseña inicial<input value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label></div></div>
        <label>Puesto (plantilla)<select value={f.template} onChange={(e) => setF({ ...f, template: e.target.value })}>{catalog.templates.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
        {msg && <p className={msg === 'Guardado.' ? 'okmsg' : 'error'}>{msg}</p>}
        <p><button className="primary" onClick={run(async () => { await api('POST', '/users', f); setF({ name: '', username: '', password: '', template: 'cajero' }) })}>Crear usuario</button></p>
      </section>
      {sel && (
        <section className="card">
          <h2>{sel.name}</h2>
          <h3>Qué puede hacer</h3>
          {catalog.permissions.map((p) => (
            <label key={p.key} style={{ fontWeight: 500 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0, marginRight: 8 }} checked={sel.permissions.includes(p.key)} onChange={() => toggle(p.key)} />{p.label}</label>
          ))}
          <p className="row">
            <button className="primary" onClick={run(() => api('PATCH', `/users/${sel.id}`, { permissions: sel.permissions }))}>Guardar permisos</button>
            <button onClick={run(() => api('PATCH', `/users/${sel.id}`, { active: !sel.active }).then(() => setSel({ ...sel, active: !sel.active })))}>{sel.active ? 'Desactivar' : 'Activar'}</button>
          </p>
          <p className="row">
            <button onClick={() => { const p = prompt('Contraseña nueva (mínimo 8):'); if (p) void run(() => api('POST', `/users/${sel.id}/reset-password`, { newPassword: p }), 'Contraseña restablecida.')() }}>Restablecer contraseña</button>
            {me.user.role === 'owner' && <button onClick={() => { const c = prompt('Código de autorización para esta persona (mínimo 4):'); if (c) void run(() => api('PUT', `/users/${sel.id}/auth-code`, { code: c }), 'Código asignado.')() }}>Asignar código</button>}
          </p>
        </section>
      )}
      {!sel && me.user.role === 'owner' && (
        <section className="card">
          <h2>Tu código de autorización</h2>
          <p className="muted">Es distinto a tu contraseña. Sirve para autorizar cancelaciones, descuentos y cambios de precio.</p>
          <button className="primary" onClick={() => { const c = prompt('Tu código (mínimo 4):'); if (c) void run(() => api('PUT', `/users/${me.user.id}/auth-code`, { code: c }), 'Código asignado.')() }}>Asignar mi código</button>
          {msg && <p>{msg}</p>}
        </section>
      )}
    </div>
  )
}
