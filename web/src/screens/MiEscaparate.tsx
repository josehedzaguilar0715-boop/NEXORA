import { useEffect, useState } from 'react'
import { api, publicSlug } from '../api'
import { hasGiro, type Me } from '../App'
import { Foto } from '../ilustraciones'

const PERFIL_VACIO = { descripcion: '', direccion: '', horario: '', instagram: '', facebook: '', portadaUrl: '', publicarCarta: false }

/** Ajustes → «Mi escaparate»: cómo te ve el público (portada, datos del negocio) y, si aplica, tu menú o lista de precios para compartir. */
export function MiEscaparate({ me }: { me: Me }) {
  const [f, setF] = useState(PERFIL_VACIO)
  const [slug, setSlug] = useState('')
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const [listo, setListo] = useState(false)
  const reservas = !!me.modules?.includes('reservas') && hasGiro(me, 'barberia', 'unas')
  const boletos = hasGiro(me, 'turistico')
  // La carta (menú, precios o catálogo) aplica a todo lo que no sea solo citas o boletos.
  const carta = !(hasGiro(me, 'barberia', 'unas', 'turistico') && !hasGiro(me, 'abarrotes', 'ferreteria', 'papeleria', 'perfumeria', 'banos', 'palapa', 'restaurante', 'comedor', 'taqueria', 'verduleria'))
  const nombreCarta = hasGiro(me, 'palapa', 'restaurante', 'comedor', 'taqueria') ? 'menú digital' : hasGiro(me, 'verduleria') ? 'lista de precios del día' : 'catálogo'
  useEffect(() => {
    api<any>('GET', '/escaparate').then((r) => { setF({ ...PERFIL_VACIO, ...r.perfil }); setListo(true) }).catch((e) => setMsg({ err: e.message }))
    void publicSlug().then(setSlug).catch(() => {})
  }, [])
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const guardar = async () => {
    setMsg({})
    try { await api('PUT', '/escaparate', f); setMsg({ ok: 'Guardado.' }) } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const enlace = slug ? `${location.origin}/carta/${slug}` : ''
  const copiar = async () => { try { await navigator.clipboard.writeText(enlace); setMsg({ ok: 'Enlace copiado.' }) } catch { setMsg({ ok: enlace }) } }
  return (
    <section className="card" aria-label="Mi escaparate">
      <h2>Mi escaparate</h2>
      <p className="muted">Lo que ve tu cliente en {[reservas && 'tu página de reservas', boletos && 'tu tienda de boletos', carta && `tu ${nombreCarta}`].filter(Boolean).join(' y ') || 'tus páginas públicas'}. Las fotos se agregan con su dirección https; si no pones ninguna se muestra una ilustración.</p>
      <Foto url={f.portadaUrl.startsWith('https://') ? f.portadaUrl : null} giro={me.business.giro} alto={120} radio={14} />
      <label>Foto de portada (dirección https)<input value={f.portadaUrl} onChange={set('portadaUrl')} placeholder="https://…" /></label>
      <label>Descripción corta<textarea rows={2} maxLength={400} value={f.descripcion} onChange={set('descripcion')} placeholder="Qué haces y qué te distingue" /></label>
      <label>Dirección<input value={f.direccion} onChange={set('direccion')} maxLength={200} /></label>
      <label>Horario<input value={f.horario} onChange={set('horario')} maxLength={200} placeholder="Lun a Sáb 9:00–20:00" /></label>
      <div className="row"><label>Instagram (sin @)<input value={f.instagram} onChange={set('instagram')} maxLength={60} /></label><label>Facebook (enlace https)<input value={f.facebook} onChange={set('facebook')} maxLength={120} placeholder="https://facebook.com/…" /></label></div>
      {carta && (
        <>
          <label style={{ fontWeight: 500 }}><input type="checkbox" style={{ width: 'auto', minHeight: 0, marginRight: 8 }} checked={f.publicarCarta} onChange={(e) => setF({ ...f, publicarCarta: e.target.checked })} />Publicar mi {nombreCarta} con un enlace para compartir</label>
          <p className="muted small">Solo se muestran nombre, precio y foto de tus artículos activos. Nunca costos ni existencias. Puedes apagarlo cuando quieras.</p>
          {f.publicarCarta && enlace && <p className="muted">Enlace: <b>{enlace}</b> <button type="button" className="mini" onClick={() => void copiar()}>Copiar</button> <a className="button mini-link" href={enlace} target="_blank" rel="noopener noreferrer">Ver</a></p>}
        </>
      )}
      {reservas && slug && <p className="muted">Reservas: <b>{location.origin}/reservar/{slug}</b></p>}
      {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
      <p><button className="primary" disabled={!listo} onClick={() => void guardar()}>Guardar escaparate</button></p>
    </section>
  )
}
