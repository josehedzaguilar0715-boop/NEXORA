import { useEffect, useState } from 'react'
import { api, mxn, toCents } from '../api'
import type { Me } from '../App'

const GIROS: Record<string, string> = { abarrotes: 'Abarrotes', ferreteria: 'Ferretería', papeleria: 'Papelería', barberia: 'Barbería', unas: 'Estudio de uñas', perfumeria: 'Perfumería', banos: 'Baños públicos', turistico: 'Lugar turístico', palapa: 'Palapa', restaurante: 'Restaurante', comedor: 'Comedor', taqueria: 'Taquería', verduleria: 'Verdulería' }
const MODULES: Record<string, string> = { membresias: 'Membresías y paquetes', promociones: 'Promociones', fidelidad: 'Puntos o sellos', asistencia: 'Asistencia con QR', reservas: 'Reservas y venta por link', recordatorios: 'Recordatorios (solo prepara el mensaje)' }

/** Ajustes del negocio (solo el dueño): datos del ticket, giro, módulos y opciones. Todo lo opcional viene apagado. */
export function Ajustes({ me }: { me: Me }) {
  const [biz, setBiz] = useState({ name: me.business.name, phone: me.business.phone ?? '', logoUrl: '', giro: me.business.giro, forcePasswordChange: true })
  const [mods, setMods] = useState<string[]>([])
  const [addons, setAddons] = useState<string[]>([])
  const [st, setSt] = useState<Record<string, any>>({})
  const [sessions, setSessions] = useState<any[]>([])
  const [trusted, setTrusted] = useState<any[]>([])
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  useEffect(() => {
    api<any>('GET', '/modules').then((r) => { setMods(r.active); setAddons(r.addons ?? []) }).catch(() => {})
    api<any>('GET', '/settings').then((r) => setSt(r.settings)).catch(() => {})
    api<any>('GET', '/auth/sessions').then((r) => setSessions(r.sessions)).catch(() => {})
    api<any>('GET', '/auth/trusted-devices').then((r) => setTrusted(r.devices)).catch(() => {})
  }, [])
  const run = (fn: () => Promise<unknown>, ok = 'Guardado.') => async () => { try { await fn(); setMsg({ ok }) } catch (e) { setMsg({ err: (e as Error).message }) } }
  const toggle = (k: string) => setMods(mods.includes(k) ? mods.filter((x) => x !== k) : [...mods, k])
  const check = (k: string, label: string) => <label style={{ fontWeight: 500 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0, marginRight: 8 }} checked={!!st[k]} onChange={(e) => setSt({ ...st, [k]: e.target.checked })} />{label}</label>
  return (
    <div className="grid2">
      <section className="card">
        <h2>Negocio y ticket</h2>
        <label>Nombre<input value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} /></label>
        <label>Teléfono en el ticket<input inputMode="tel" value={biz.phone} onChange={(e) => setBiz({ ...biz, phone: e.target.value })} /></label>
        <label>Logo (dirección de la imagen)<input value={biz.logoUrl} onChange={(e) => setBiz({ ...biz, logoUrl: e.target.value })} placeholder="https://…" /></label>
        <label>Giro<select value={biz.giro} onChange={(e) => setBiz({ ...biz, giro: e.target.value })}>{Object.entries(GIROS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label style={{ fontWeight: 500 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0, marginRight: 8 }} checked={biz.forcePasswordChange} onChange={(e) => setBiz({ ...biz, forcePasswordChange: e.target.checked })} />Pedir cambio de contraseña en el primer ingreso</label>
        <p><button className="primary" onClick={run(() => api('PATCH', '/business', { name: biz.name, phone: biz.phone, logoUrl: biz.logoUrl || undefined, giro: biz.giro, forcePasswordChange: biz.forcePasswordChange }), 'Guardado. Vuelve a entrar para ver las pantallas del giro.')}>Guardar</button></p>
        <h2 style={{ marginTop: 16 }}>Módulos</h2>
        {Object.entries(MODULES).map(([k, v]) => {
          // El link de reservas se contrata con instalación: lo habilita soporte.
          const locked = k === 'reservas' && !addons.includes(k)
          return <label key={k} style={{ fontWeight: 500, opacity: locked ? 0.6 : 1 }}><input type="checkbox" disabled={locked} style={{ width: 'auto', minHeight: 0, marginRight: 8 }} checked={mods.includes(k)} onChange={() => toggle(k)} />{v}{locked ? ' — con costo de instalación; pídelo en el Buzón' : ''}</label>
        })}
        <p><button className="primary" onClick={run(() => api('PUT', '/modules', { active: mods }))}>Guardar módulos</button></p>
        {mods.includes('reservas') && <p className="muted">Link de reservas: {location.origin}/{me.business.giro === 'turistico' ? 'boletos' : 'reservar'}/{me.business.code}</p>}
      </section>
      <section className="card">
        <h2>Opciones</h2>
        {check('tipsEnabled', 'Propinas')}
        {me.business.giro === 'comedor' && check('tablesEnabled', 'Mapa de mesas')}
        {['restaurante', 'taqueria'].includes(me.business.giro) && check('pickupScheduling', 'Reservar hora para pedidos para recoger')}
        {me.business.giro === 'verduleria' && check('phoneOrdersPrepaid', 'Cobrar pedidos por teléfono antes de entregar')}
        {me.business.giro === 'unas' && <label>Cargo por traslado a domicilio (vacío = apagado)<input inputMode="decimal" value={st.travelFee != null ? String(st.travelFee / 100) : ''} onChange={(e) => setSt({ ...st, travelFee: e.target.value.trim() ? toCents(e.target.value) : null })} /></label>}
        {me.business.giro === 'banos' && <label>Minutos para volver a entrar con el mismo pase<input inputMode="numeric" value={st.passReentryMin ?? 30} onChange={(e) => setSt({ ...st, passReentryMin: Number(e.target.value) || 0 })} /></label>}
        <p><button className="primary" onClick={run(() => api('PUT', '/settings', st))}>Guardar opciones</button></p>
        {msg.err && <p className="error">{msg.err}</p>}
        {msg.ok && <p className="okmsg">{msg.ok}</p>}
        <h2 style={{ marginTop: 16 }}>Mis dispositivos</h2>
        <table className="list"><tbody>{sessions.map((s) => (
          <tr key={s.id}><td>{s.deviceName ?? 'Equipo'}<br /><small className="muted">última vez {new Date(s.lastSeenAt).toLocaleString('es-MX')}</small></td>
            <td><button onClick={async () => { await api('DELETE', `/auth/sessions/${s.id}`); setSessions(sessions.filter((x) => x.id !== s.id)) }}>Cerrar sesión</button></td></tr>
        ))}</tbody></table>
        <h2 style={{ marginTop: 16 }}>Equipos de confianza</h2>
        <p className="muted">En estos equipos no se pide código por SMS al entrar (30 días).</p>
        <table className="list"><tbody>{trusted.map((t) => (
          <tr key={t.id}><td>{t.deviceName ?? 'Equipo'}<br /><small className="muted">vence {new Date(t.expiresAt).toLocaleDateString('es-MX')}</small></td>
            <td><button onClick={async () => { await api('DELETE', `/auth/trusted-devices/${t.id}`); setTrusted(trusted.filter((x) => x.id !== t.id)) }}>Quitar</button></td></tr>
        ))}</tbody></table>
        {st.travelFee != null && <p className="muted">Traslado: {mxn(st.travelFee)}</p>}
      </section>
    </div>
  )
}

/** Buzón: dudas de soporte y solicitudes de cambio (privado del negocio). */
export function Buzon(_: { me: Me }) {
  const [list, setList] = useState<any[]>([])
  const [sel, setSel] = useState<any>(null)
  const [f, setF] = useState({ type: 'soporte', subject: '', module: '', message: '', reply: '' })
  const [msg, setMsg] = useState('')
  const load = async () => setList((await api<any>('GET', '/support/tickets')).tickets)
  useEffect(() => { void load().catch((e) => setMsg(e.message)) }, [])
  const open = async (t: any) => { setSel((await api<any>('GET', `/support/tickets/${t.id}`)).ticket); void load() }
  const STATUS: Record<string, string> = { abierto: 'Abierto', respondido: 'Respondido', cerrado: 'Cerrado', enviada: 'Enviada', en_revision: 'En revisión', aceptada: 'Aceptada', rechazada: 'Rechazada' }
  return (
    <div className="grid2">
      <section className="card">
        <h2>Escribir a soporte</h2>
        <div className="tabs"><button className={f.type === 'soporte' ? 'on' : ''} onClick={() => setF({ ...f, type: 'soporte' })}>Duda o problema</button><button className={f.type === 'cambio' ? 'on' : ''} onClick={() => setF({ ...f, type: 'cambio' })}>Pedir un cambio</button></div>
        <label>Asunto<input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></label>
        {f.type === 'cambio' && <label>¿A qué giro o módulo afecta?<input value={f.module} onChange={(e) => setF({ ...f, module: e.target.value })} /></label>}
        <label>Mensaje<textarea rows={4} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
        {msg && <p className="error">{msg}</p>}
        <p><button className="primary" onClick={async () => { try { await api('POST', '/support/tickets', { type: f.type, subject: f.subject, module: f.type === 'cambio' ? f.module : undefined, message: f.message }); setF({ ...f, subject: '', module: '', message: '' }); void load() } catch (e) { setMsg((e as Error).message) } }}>Enviar</button></p>
        <h2 style={{ marginTop: 16 }}>Mis mensajes</h2>
        <table className="list"><tbody>{list.map((t) => <tr key={t.id} onClick={() => open(t)} style={{ cursor: 'pointer', fontWeight: t.unread ? 700 : 400 }}><td>{t.subject}<br /><small className="muted">{t.type === 'cambio' ? `Cambio · ${t.module}` : 'Soporte'}</small></td><td>{STATUS[t.status] ?? t.status}</td></tr>)}</tbody></table>
      </section>
      {sel && (
        <section className="card">
          <h2>{sel.subject}</h2>
          <p className="muted">{STATUS[sel.status] ?? sel.status}</p>
          {sel.messages.map((m: any, i: number) => <div key={i} className="card" style={{ marginBottom: 8, background: m.author === 'soporte' ? 'var(--bg)' : undefined }}><small className="muted">{m.author === 'soporte' ? 'Soporte' : 'Tú'} · {new Date(m.createdAt).toLocaleString('es-MX')}</small><p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{m.body}</p></div>)}
          <label>Responder<textarea rows={3} value={f.reply} onChange={(e) => setF({ ...f, reply: e.target.value })} /></label>
          <p><button className="primary" disabled={!f.reply.trim()} onClick={async () => { const r = await api<any>('POST', `/support/tickets/${sel.id}/messages`, { message: f.reply }); setSel(r.ticket); setF({ ...f, reply: '' }) }}>Enviar</button></p>
        </section>
      )}
    </div>
  )
}
