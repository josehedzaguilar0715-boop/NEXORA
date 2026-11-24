import { useEffect, useRef, useState } from 'react'
import { api, auth, fechaHora } from '../api'
import { ask } from '../Dialog'
import type { Me } from '../App'

const NOMBRES: Record<string, string> = {
  businesses: 'Negocio', branches: 'Sucursales', users: 'Personal', customers: 'Clientes', suppliers: 'Proveedores', products: 'Productos', lots: 'Lotes de inventario',
  stock_movements: 'Movimientos de inventario', sales: 'Ventas', sale_items: 'Renglones de venta', sale_payments: 'Pagos de ventas', shifts: 'Cajas (turnos)', cash_movements: 'Retiros y depósitos',
  expenses: 'Gastos', purchases: 'Compras', credit_ledger: 'Fiado (cargos y abonos)', audit_log: 'Bitácora', appointments: 'Citas', staff_payouts: 'Pagos al personal',
}

interface Report { ok: boolean; errors: string[]; warnings: string[]; sha256: string | null; tables: Record<string, { insert: number; same: number; differs: number; skipped: number }>; totals: { insert: number; same: number; differs: number; skipped: number } }

/** Configurar → «Respaldo y exportación de datos»: llevarse todo, ver qué contiene y recuperarlo sin riesgo (simulación + confirmación). */
export function DatosNegocio({ me }: { me: Me }) {
  const [info, setInfo] = useState<any>(null)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const [file, setFile] = useState<{ name: string; data: any } | null>(null)
  const [source, setSource] = useState<{ file?: unknown; backupId?: string } | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const load = () => api<any>('GET', '/data/info').then(setInfo).catch((e) => setMsg({ err: e.message }))
  useEffect(() => { void load() }, [])
  if (me.user.role !== 'owner') return <p className="muted">Solo el dueño puede exportar o restaurar los datos del negocio.</p>

  const download = async () => {
    setBusy(true); setMsg({})
    try {
      const res = await fetch('/api/data/export', { headers: { authorization: `Bearer ${auth.token}` } })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message ?? 'No se pudo generar el archivo.')
      const blob = await res.blob()
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'nexora-datos.json'
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
      setMsg({ ok: `Archivo descargado (${name}). Guárdalo en un lugar seguro: contiene toda la información de tu negocio.` }); void load()
    } catch (e) { setMsg({ err: (e as Error).message }) } finally { setBusy(false) }
  }
  const simulate = async (src: { file?: unknown; backupId?: string }) => {
    setBusy(true); setMsg({}); setReport(null); setSource(src)
    try { setReport((await api<{ report: Report }>('POST', '/data/import/preview', src)).report) } catch (e) { setMsg({ err: (e as Error).message }) } finally { setBusy(false) }
  }
  const pick = async (f: File | undefined) => {
    if (!f) return
    try { const data = JSON.parse(await f.text()); setFile({ name: f.name, data }); await simulate({ file: data }) } catch { setMsg({ err: 'Ese archivo no se pudo leer: debe ser el .json que descargaste de NEXORA.' }) }
  }
  const confirm = async () => {
    if (!report?.ok || !source) return
    const word = await ask({ title: 'Restaurar datos', hint: `Se agregarán ${report.totals.insert} registros que faltan. Lo que ya existe no se cambia. Escribe RESTAURAR para confirmar.`, label: 'Palabra de confirmación', confirmLabel: 'Restaurar' })
    if (word === null) return
    setBusy(true)
    try {
      const r = await api<{ report: Report }>('POST', '/data/import/confirm', { ...source, sha256: report.sha256, confirm: word.trim().toUpperCase() })
      setMsg({ ok: `Listo: se agregaron ${r.report.totals.insert} registros. ${r.report.totals.differs ? `${r.report.totals.differs} ya existían con cambios más recientes y se conservaron.` : ''}` })
      setReport(null); setFile(null); setSource(null); void load()
    } catch (e) { setMsg({ err: (e as Error).message }) } finally { setBusy(false) }
  }
  const verify = async (id: string) => {
    try { const r = await api<any>('POST', `/data/backups/${id}/verify`); setMsg(r.valid ? { ok: `Respaldo íntegro (generado ${fechaHora(r.exportedAt)}).` } : { err: 'El respaldo no pasó la verificación.' }) } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const backupNow = async () => { try { await api('POST', '/data/backups'); setMsg({ ok: 'Respaldo creado.' }); void load() } catch (e) { setMsg({ err: (e as Error).message }) } }
  const contains: Record<string, number> = info?.contains ?? {}

  return (
    <div className="stack">
      <section className="card">
        <h2>Respaldo y exportación de datos</h2>
        <p className="muted">Tu información es tuya. Descarga una copia completa cuando quieras. El archivo <b>no incluye contraseñas ni códigos de acceso</b>.</p>
        <p><button className="primary" disabled={busy} onClick={download}>Descargar mi información</button></p>
        <p className="muted small">{info?.lastExport ? `Última descarga: ${fechaHora(info.lastExport.at)}.` : 'Todavía no has descargado tu información.'} Formato: JSON documentado (versión {info?.formatVersion ?? 1}).</p>
        <h3>Qué contiene hoy</h3>
        <div className="table-wrap"><table className="list"><tbody>
          {Object.entries(contains).filter(([k]) => NOMBRES[k]).map(([k, n]) => <tr key={k}><td>{NOMBRES[k]}</td><td className="num">{n}</td></tr>)}
          <tr><td className="muted">Otras tablas de apoyo</td><td className="num muted">{Object.entries(contains).filter(([k]) => !NOMBRES[k]).reduce((a, [, n]) => a + n, 0)}</td></tr>
        </tbody></table></div>
      </section>

      <section className="card">
        <h2>Respaldos automáticos</h2>
        <p className="muted small">Cada noche se guarda una copia de tu negocio (30 días){info?.encrypted ? ', cifrada' : ''}. Puedes verificar que un respaldo está íntegro y recuperarlo.</p>
        {info && !info.backupsEnabled && <p className="muted">Los respaldos automáticos no están activos en este servidor.</p>}
        <div className="table-wrap"><table className="list"><tbody>
          {(info?.backups ?? []).map((b: any) => (
            <tr key={b.id}><td>{fechaHora(b.createdAt)}<br /><small className="muted">{b.kind === 'manual' ? 'Manual' : 'Automático'} · {b.status === 'ok' ? `${Math.round((b.bytes ?? 0) / 1024)} KB` : `Falló: ${b.error ?? ''}`}</small></td>
              <td className="num">{b.status === 'ok' && <><button className="mini" onClick={() => verify(b.id)}>Verificar</button> <button className="mini" disabled={busy || !info?.importEnabled} onClick={() => simulate({ backupId: b.id })}>Recuperar…</button></>}</td></tr>
          ))}
          {!(info?.backups ?? []).length && <tr><td className="muted">Aún no hay respaldos de tu negocio.</td><td /></tr>}
        </tbody></table></div>
        <p><button disabled={busy} onClick={backupNow}>Hacer un respaldo ahora</button></p>
      </section>

      <section className="card">
        <h2>Recuperar desde un archivo</h2>
        <p className="muted small">Primero se <b>simula</b>: ves qué se agregaría sin cambiar nada. Solo se agrega lo que falta; <b>nunca se sobrescribe</b> lo que ya existe ni se mezcla con otro negocio.</p>
        {info?.importEnabled === false ? <p className="muted">La restauración está desactivada temporalmente.</p> : (
          <p><input ref={input} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} /><button disabled={busy} onClick={() => input.current?.click()}>Elegir archivo…</button> {file && <span className="muted small">{file.name}</span>}</p>
        )}
        {report && (
          <div>
            <h3>{report.ok ? 'Simulación correcta (no se cambió nada)' : 'No se puede restaurar'}</h3>
            {report.errors.map((e, i) => <p key={i} className="error">{e}</p>)}
            {report.warnings.map((e, i) => <p key={i} className="muted small">{e}</p>)}
            {report.ok && (<>
              <p>Se agregarían <b>{report.totals.insert}</b> registros que faltan; <b>{report.totals.same}</b> ya están; <b>{report.totals.differs}</b> existen con cambios posteriores (se conservan los actuales){report.totals.skipped ? `; ${report.totals.skipped} no se pueden agregar` : ''}.</p>
              <div className="table-wrap"><table className="list"><tbody>{Object.entries(report.tables).filter(([, v]) => v.insert || v.differs).map(([k, v]) => <tr key={k}><td>{NOMBRES[k] ?? k}</td><td className="num">+{v.insert}{v.differs ? ` · ${v.differs} distintos` : ''}</td></tr>)}</tbody></table></div>
              <p className="muted small">Las personas que se restauren tendrán que recibir una contraseña nueva (las contraseñas no viajan en el archivo).</p>
              <p><button className="primary" disabled={busy || report.totals.insert === 0} onClick={confirm}>{report.totals.insert === 0 ? 'No hay nada que restaurar' : 'Restaurar…'}</button> <button onClick={() => { setReport(null); setFile(null) }}>Cancelar</button></p>
            </>)}
          </div>
        )}
      </section>
      {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
    </div>
  )
}
