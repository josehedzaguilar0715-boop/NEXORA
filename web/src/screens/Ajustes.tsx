import { useEffect, useState } from 'react'
import { api, cache, mxn, outbox, toCents, publicSlug, setPublicSlugCache } from '../api'
import { hasGiro, type Me } from '../App'
import { giroLabel, vocab } from '../giros'
import { WhatsAppShare } from './Descargar'

const MODULES: Record<string, string> = { membresias: 'Membresías y paquetes', promociones: 'Promociones', fidelidad: 'Puntos o sellos', asistencia: 'Asistencia con QR', reservas: 'Reservas y venta por link', recordatorios: 'Recordatorios (solo prepara el mensaje)' }

/** Ajustes del negocio (solo el dueño): datos del ticket, giro, módulos y opciones. Todo lo opcional viene apagado. */
export function Ajustes({ me }: { me: Me }) {
  const [biz, setBiz] = useState({ name: me.business.name, phone: me.business.phone ?? '', logoUrl: '', forcePasswordChange: true })
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
      <MiCuenta me={me} />
      <section className="card">
        <h2>Negocio y ticket</h2>
        <label>Nombre<input value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} /></label>
        <label>Teléfono en el ticket<input inputMode="tel" value={biz.phone} onChange={(e) => setBiz({ ...biz, phone: e.target.value })} /></label>
        <label>Logo (dirección de la imagen)<input value={biz.logoUrl} onChange={(e) => setBiz({ ...biz, logoUrl: e.target.value })} placeholder="https://…" /></label>
        <div className="info-row"><span className="muted">Tipo de negocio</span><b>{(me.business.giros ?? [me.business.giro]).map(giroLabel).join(' + ')}</b></div>
        <p className="muted small">Se eligió al crear la cuenta. Si necesitas cambiarlo, pídelo a soporte desde el Buzón.</p>
        <label style={{ fontWeight: 500 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0, marginRight: 8 }} checked={biz.forcePasswordChange} onChange={(e) => setBiz({ ...biz, forcePasswordChange: e.target.checked })} />Pedir cambio de contraseña en el primer ingreso</label>
        <p><button className="primary" onClick={run(() => api('PATCH', '/business', { name: biz.name, phone: biz.phone, logoUrl: biz.logoUrl || undefined, forcePasswordChange: biz.forcePasswordChange }), 'Guardado.')}>Guardar</button></p>
        <h2 style={{ marginTop: 16 }}>Módulos</h2>
        {Object.entries(MODULES).map(([k, v]) => {
          // El link de reservas se contrata con instalación: lo habilita soporte.
          const locked = k === 'reservas' && !addons.includes(k)
          return <label key={k} style={{ fontWeight: 500, opacity: locked ? 0.6 : 1 }}><input type="checkbox" disabled={locked} style={{ width: 'auto', minHeight: 0, marginRight: 8 }} checked={mods.includes(k)} onChange={() => toggle(k)} />{v}{locked ? ' — con costo de instalación; pídelo en el Buzón' : ''}</label>
        })}
        <p><button className="primary" onClick={run(() => api('PUT', '/modules', { active: mods }))}>Guardar módulos</button></p>
        {mods.includes('reservas') && <EnlacePublico me={me} />}
      </section>
      <section className="card">
        <h2>Opciones</h2>
        {vocab(me).tips && check('tipsEnabled', 'Propinas')}
        {hasGiro(me, 'restaurante', 'taqueria') && check('pickupScheduling', 'Reservar hora para pedidos para recoger')}
        {hasGiro(me, 'verduleria') && check('phoneOrdersPrepaid', 'Cobrar pedidos por teléfono antes de entregar')}
        {hasGiro(me, 'unas') && <label>Cargo por traslado a domicilio (vacío = apagado)<input inputMode="decimal" value={st.travelFee != null ? String(st.travelFee / 100) : ''} onChange={(e) => setSt({ ...st, travelFee: e.target.value.trim() ? toCents(e.target.value) : null })} /></label>}
        {hasGiro(me, 'banos') && <label>Minutos para volver a entrar con el mismo pase<input inputMode="numeric" value={st.passReentryMin ?? 30} onChange={(e) => setSt({ ...st, passReentryMin: Number(e.target.value) || 0 })} /></label>}
        <p><button className="primary" onClick={run(() => api('PUT', '/settings', st))}>Guardar opciones</button></p>
        {msg.err && <p className="error">{msg.err}</p>}
        {msg.ok && <p className="okmsg">{msg.ok}</p>}
        <h2 style={{ marginTop: 16 }}>Mis dispositivos</h2>
        <div className="table-wrap"><table className="list"><tbody>{sessions.map((s) => (
          <tr key={s.id}><td>{s.deviceName ?? 'Equipo'}<br /><small className="muted">última vez {new Date(s.lastSeenAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', hour12: true, timeZone: 'America/Mexico_City' })}</small></td>
            <td><button onClick={async () => { await api('DELETE', `/auth/sessions/${s.id}`); setSessions(sessions.filter((x) => x.id !== s.id)) }}>Cerrar sesión</button></td></tr>
        ))}</tbody></table></div>
        {trusted.length > 0 && <><h2 style={{ marginTop: 16 }}>Equipos de confianza</h2>
        <p className="muted">En estos equipos no se pide código por SMS al entrar (30 días).</p></>}
        <div className="table-wrap"><table className="list"><tbody>{trusted.map((t) => (
          <tr key={t.id}><td>{t.deviceName ?? 'Equipo'}<br /><small className="muted">vence {new Date(t.expiresAt).toLocaleDateString('es-MX')}</small></td>
            <td><button onClick={async () => { await api('DELETE', `/auth/trusted-devices/${t.id}`); setTrusted(trusted.filter((x) => x.id !== t.id)) }}>Quitar</button></td></tr>
        ))}</tbody></table></div>
        {st.travelFee != null && <p className="muted">Traslado: {mxn(st.travelFee)}</p>}
      </section>
      <section className="card">
        <h2>Instalar en otros equipos</h2>
        <p className="muted">NEXORA se instala como app desde el navegador en Android, iPhone y computadora, sin tiendas de apps. Manda el link a tus empleados por WhatsApp.</p>
        <WhatsAppShare />
        <p><a href="/descargar" target="_blank" rel="noreferrer">Ver la página de descarga</a></p>
      </section>
      <EmpezarDeCero me={me} />
    </div>
  )
}

/** Borra las ventas y movimientos de prueba (después de enseñar el sistema) para que el negocio empiece limpio. */
function EmpezarDeCero({ me }: { me: Me }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ confirm: '', code: '' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const pending = outbox.pending()
  return (
    <section className="card">
      <h2>Empezar de cero</h2>
      <p className="muted">Para cuando ya terminaste de enseñar el sistema: borra <b>todos</b> los movimientos de prueba: {vocab(me).resetItems}. Lo vendido de prueba regresa al inventario y los folios vuelven a empezar en 1.</p>
      <p className="muted small">Se queda: productos, servicios, clientes, proveedores, compras, personal y configuración. Una venta suelta no se puede borrar; para eso está «Cancelar venta» con código.</p>
      {!open && <p><button className="danger" onClick={() => setOpen(true)}>Borrar datos de prueba…</button></p>}
      {open && (
        <div className="danger-zone">
          {pending > 0 && <p className="error">Hay {pending} movimiento(s) sin enviar en este equipo. Espera a que diga «Todo enviado».</p>}
          <label>Escribe BORRAR para confirmar<input value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoCapitalize="characters" /></label>
          <label>Tu código de autorización<input type="password" inputMode="numeric" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
          {msg.err && <p className="error">{msg.err}</p>}
          <p className="row">
            <button onClick={() => { setOpen(false); setF({ confirm: '', code: '' }); setMsg({}) }}>Cancelar</button>
            <button className="danger" disabled={pending > 0 || f.confirm.trim().toUpperCase() !== 'BORRAR' || !f.code} onClick={async () => {
              try {
                const r = await api<{ sales: number }>('POST', '/business/reset-demo', { confirm: f.confirm, authCode: f.code })
                cache.set('held', [])
                setOpen(false); setF({ confirm: '', code: '' })
                setMsg({ ok: `Listo: se borraron ${r.sales} venta(s) de prueba. El negocio empieza de cero.` })
              } catch (e) { setMsg({ err: (e as Error).message }) }
            }}>Borrar todo y empezar de cero</button>
          </p>
        </div>
      )}
      {msg.ok && <p className="okmsg">{msg.ok}</p>}
    </section>
  )
}

/** Mi cuenta (dueño): teléfono con el que entra y contraseña. */
function MiCuenta({ me }: { me: Me }) {
  const [phone, setPhone] = useState({ phone: me.user.phone ?? '', password: '' })
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', again: '' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const go = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); setMsg({ ok }) } catch (e) { setMsg({ err: (e as Error).message }) } }
  return (
    <section className="card">
      <h2>Mi cuenta</h2>
      <p className="muted">Entras con tu teléfono y tu contraseña.</p>
      <label>Teléfono para entrar (10 dígitos)<input inputMode="tel" value={phone.phone} onChange={(e) => setPhone({ ...phone, phone: e.target.value })} /></label>
      <label>Tu contraseña (para confirmar)<input type="password" value={phone.password} onChange={(e) => setPhone({ ...phone, password: e.target.value })} /></label>
      <p><button className="primary" disabled={!phone.phone || !phone.password} onClick={go(async () => { await api('POST', '/auth/owner/phone', phone); setPhone({ ...phone, password: '' }) }, 'Teléfono cambiado. La próxima vez entra con el número nuevo.')}>Cambiar teléfono</button></p>
      <h2 style={{ marginTop: 16 }}>Cambiar mi contraseña</h2>
      <label>Contraseña actual<input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></label>
      <label>Contraseña nueva (mínimo 8)<input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></label>
      <label>Repite la nueva<input type="password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></label>
      <p><button className="primary" disabled={!pw.currentPassword || !pw.newPassword} onClick={go(async () => {
        if (pw.newPassword !== pw.again) throw new Error('Las contraseñas nuevas no coinciden.')
        await api('POST', '/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword })
        setPw({ currentPassword: '', newPassword: '', again: '' })
      }, 'Contraseña cambiada.')}>Cambiar contraseña</button></p>
      {msg.err && <p className="error">{msg.err}</p>}
      {msg.ok && <p className="okmsg">{msg.ok}</p>}
    </section>
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
        <div className="table-wrap"><table className="list"><tbody>{list.map((t) => <tr key={t.id} onClick={() => open(t)} style={{ cursor: 'pointer', fontWeight: t.unread ? 700 : 400 }}><td>{t.subject}<br /><small className="muted">{t.type === 'cambio' ? `Cambio · ${t.module}` : 'Soporte'}</small></td><td>{STATUS[t.status] ?? t.status}</td></tr>)}</tbody></table></div>
      </section>
      {sel && (
        <section className="card">
          <h2>{sel.subject}</h2>
          <p className="muted">{STATUS[sel.status] ?? sel.status}</p>
          {sel.messages.map((m: any, i: number) => <div key={i} className="card" style={{ marginBottom: 8, background: m.author === 'soporte' ? 'var(--bg)' : undefined }}><small className="muted">{m.author === 'soporte' ? 'Soporte' : 'Tú'} · {new Date(m.createdAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', hour12: true, timeZone: 'America/Mexico_City' })}</small><p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{m.body}</p></div>)}
          <label>Responder<textarea rows={3} value={f.reply} onChange={(e) => setF({ ...f, reply: e.target.value })} /></label>
          <p><button className="primary" disabled={!f.reply.trim()} onClick={async () => { const r = await api<any>('POST', `/support/tickets/${sel.id}/messages`, { message: f.reply }); setSel(r.ticket); setF({ ...f, reply: '' }) }}>Enviar</button></p>
        </section>
      )}
    </div>
  )
}

/** Enlace público de reservas o boletos: el dueño puede elegir uno fácil de recordar. No usa el código interno. */
function EnlacePublico({ me }: { me: Me }) {
  const [slug, setSlug] = useState('')
  const [edit, setEdit] = useState('')
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  useEffect(() => { void publicSlug().then((s) => { setSlug(s); setEdit(s) }).catch((e) => setMsg({ err: e.message })) }, [])
  const tickets = hasGiro(me, 'turistico')
  const both = tickets && (me.business.giros ?? []).length > 1
  const save = async () => {
    try { const r = await api<{ slug: string }>('PUT', '/business/public-link', { slug: edit }); setSlug(r.slug); setPublicSlugCache(r.slug); setMsg({ ok: 'Enlace actualizado. El anterior deja de funcionar.' }) } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  if (!slug) return null
  return (
    <div className="public-link">
      {(!tickets || both) && <p className="muted">Link de reservas: <b>{location.origin}/reservar/{slug}</b></p>}
      {tickets && <p className="muted">Link de boletos: <b>{location.origin}/boletos/{slug}</b></p>}
      {me.user.role === 'owner' && (<>
        <label>Nombre del enlace<input value={edit} onChange={(e) => setEdit(e.target.value.toLowerCase())} placeholder="ej. fenix-barberia" /></label>
        <p className="muted small">Solo letras sin acentos, números y guiones. No incluye datos personales ni el código con el que entran tus empleados.</p>
        {edit !== slug && <p><button className="primary" onClick={() => void save()}>Guardar enlace</button></p>}
      </>)}
      {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
    </div>
  )
}
