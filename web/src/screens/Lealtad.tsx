import { useEffect, useState } from 'react'
import { ScanButton } from '../Scanner'
import { api, mxn, toCents } from '../api'
import { confirmAsk } from '../Dialog'
import { can, type Me } from '../App'
import { loyaltyText } from './Caja'
import { cardWhatsApp } from './MiTarjeta'

/** Escanear el QR del cliente: entrada (asistencia), usar membresía o consultar. El servidor valida cada escaneo. */
export function Escanear({ me }: { me: Me }) {
  const stamps = !!me.modules?.includes('fidelidad') && can(me, 'give_stamps')
  const tabs = [...(stamps ? [['sello', 'Dar sello']] : []), ...(me.modules?.includes('asistencia') ? [['entrada', 'Registrar entrada']] : []), ...(me.modules?.includes('membresias') ? [['membresia', 'Usar membresía']] : []), ['consulta', 'Solo consultar']] as [string, string][]
  const [code, setCode] = useState('')
  const [action, setAction] = useState(tabs[0]![0])
  const [res, setRes] = useState<any>(null)
  const [err, setErr] = useState('')
  const scan = async (c = code) => {
    try { setRes(await api('POST', '/scan', { code: c, action })); setErr('') } catch (e) { setRes(null); setErr((e as Error).message) }
    setCode('')
  }
  return (
    <div className="card login" style={{ maxWidth: 680 }}>
      <div className="tabs">{tabs.map(([k, v]) => <button key={k} className={action === k ? 'on' : ''} onClick={() => setAction(k)}>{v}</button>)}</div>
      {action === 'sello' && <p className="muted small">Cada escaneo le da sus sellos, hasta el máximo del día que puso el dueño.</p>}
      <label>Escanea el QR o código de barras del cliente</label>
      <div className="row"><input aria-label="Código del cliente" autoFocus value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && code && scan()} /><ScanButton onCode={(c) => scan(c)} /></div>
      {err && <h2 className="error">✘ {err}</h2>}
      {res && (
        <div style={{ marginTop: 12 }}>
          <h2 className="okmsg">✔ {res.customer.name}</h2>
          {res.membership && <p>Membresía: quedan <b>{res.membership.remaining}</b> de {res.membership.usesPerPeriod} en este periodo.</p>}
          {res.loyaltyEarned ? <p>Ganó {res.loyaltyEarned} puntos/sellos.</p> : null}
          {res.loyalty && <p className={res.loyalty.earned > 0 ? 'okmsg' : 'error'} style={{ fontSize: '1.15rem' }}>{loyaltyText(res.loyalty)}</p>}
          <p className="muted">Saldo de puntos: {res.loyaltyBalance}{res.lastVisit ? ` · última visita ${new Date(res.lastVisit).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', hour12: true, timeZone: 'America/Mexico_City' })}` : ''}</p>
          {res.memberships.map((m: any) => <p key={m.id} className="muted">{m.name}: vence {m.endsAt.slice(0, 10)}, quedan {m.remaining}</p>)}
        </div>
      )}
    </div>
  )
}

/** Configuración del dueño: membresías y paquetes, promociones y programa de puntos o sellos. */
export function Lealtad({ me }: { me: Me }) {
  const [mods, setMods] = useState<string[]>([])
  const [plans, setPlans] = useState<any[]>([])
  const [promos, setPromos] = useState<any[]>([])
  const [p, setP] = useState({ name: '', kind: 'periodo', usesPerPeriod: '4', period: 'mes', validityDays: '90', price: '' })
  const [pr, setPr] = useState({ name: '', kind: 'porcentaje', value: '', from: '', to: '', minQuantity: '', combinable: false })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => {
    const m = (await api<any>('GET', '/modules')).active as string[]
    setMods(m)
    if (m.includes('membresias')) setPlans((await api<any>('GET', '/membership-plans')).plans)
    if (m.includes('promociones')) setPromos((await api<any>('GET', '/promotions')).promotions)
  }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [])
  const run = (fn: () => Promise<unknown>, ok = 'Guardado.') => async () => { try { await fn(); setMsg({ ok }); await load() } catch (e) { setMsg({ err: (e as Error).message }) } }
  if (!mods.some((m) => ['membresias', 'promociones', 'fidelidad'].includes(m))) return <p className="card">Activa membresías, promociones o puntos en Ajustes → Módulos.</p>
  return (
    <div className="grid2">
      {mods.includes('membresias') && (
        <section className="card">
          <h2>Membresías y paquetes</h2>
          <div className="table-wrap"><table className="list"><tbody>{plans.map((x) => <tr key={x.id}><td>{x.name}<br /><small className="muted">{x.kind === 'paquete' ? `${x.uses_per_period} sesiones en ${x.validity_days} días` : x.kind === 'pase' ? `pase por ${x.period}` : `${x.uses_per_period} usos por ${x.period}`}</small></td><td className="num">{mxn(x.price)}</td></tr>)}</tbody></table></div>
          <label>Nombre<input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="4 cortes al mes" /></label>
          <div className="row">
            <label>Tipo<select value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value })}><option value="periodo">Usos por periodo</option><option value="paquete">Paquete de sesiones</option><option value="pase">Pase (entradas libres)</option></select></label>
            {p.kind !== 'pase' && <label>Usos<input inputMode="numeric" value={p.usesPerPeriod} onChange={(e) => setP({ ...p, usesPerPeriod: e.target.value })} /></label>}
            {p.kind === 'paquete' ? <label>Vigencia (días)<input inputMode="numeric" value={p.validityDays} onChange={(e) => setP({ ...p, validityDays: e.target.value })} /></label>
              : <label>Periodo<select value={p.period} onChange={(e) => setP({ ...p, period: e.target.value })}><option value="dia">Día</option><option value="semana">Semana</option><option value="mes">Mes</option></select></label>}
          </div>
          <label>Precio<input inputMode="decimal" value={p.price} onChange={(e) => setP({ ...p, price: e.target.value })} /></label>
          <p><button className="primary" disabled={p.name.trim().length < 2} onClick={run(() => api('POST', '/membership-plans', { name: p.name, kind: p.kind, usesPerPeriod: p.kind === 'pase' ? 1 : Number(p.usesPerPeriod), period: p.period, validityDays: p.kind === 'paquete' ? Number(p.validityDays) : undefined, price: toCents(p.price || '0') }))}>Agregar</button></p>
        </section>
      )}
      {mods.includes('promociones') && (
        <section className="card">
          <h2>Promociones</h2>
          <div className="table-wrap"><table className="list"><tbody>{promos.map((x) => <tr key={x.id}><td>{x.name}<br /><small className="muted">{x.kind === 'porcentaje' ? `${x.value / 100}%` : mxn(x.value)} · {x.starts_at.slice(0, 10)} a {x.ends_at.slice(0, 10)}{x.min_quantity ? ` · desde ${x.min_quantity}` : ''}{x.combinable ? ' · combinable' : ''}</small></td></tr>)}</tbody></table></div>
          <label>Nombre<input value={pr.name} onChange={(e) => setPr({ ...pr, name: e.target.value })} /></label>
          <div className="row"><label>Tipo<select value={pr.kind} onChange={(e) => setPr({ ...pr, kind: e.target.value })}><option value="porcentaje">Porcentaje</option><option value="monto">Monto</option></select></label><label>{pr.kind === 'porcentaje' ? '%' : '$'}<input inputMode="decimal" value={pr.value} onChange={(e) => setPr({ ...pr, value: e.target.value })} /></label></div>
          <div className="row"><label>Desde<input type="date" value={pr.from} onChange={(e) => setPr({ ...pr, from: e.target.value })} /></label><label>Hasta<input type="date" value={pr.to} onChange={(e) => setPr({ ...pr, to: e.target.value })} /></label></div>
          <div className="row"><label>Cantidad mínima<input inputMode="numeric" value={pr.minQuantity} onChange={(e) => setPr({ ...pr, minQuantity: e.target.value })} /></label><label style={{ fontWeight: 500, alignSelf: 'end' }}><input type="checkbox" style={{ width: 'auto', minHeight: 0, marginRight: 8 }} checked={pr.combinable} onChange={(e) => setPr({ ...pr, combinable: e.target.checked })} />Se combina con otras</label></div>
          <p className="muted">Aplica a toda la tienda. Para productos o categorías específicas, pídelo desde el buzón.</p>
          <p><button className="primary" disabled={!pr.name || !pr.value || !pr.from || !pr.to} onClick={run(() => api('POST', '/promotions', { name: pr.name, kind: pr.kind, value: pr.kind === 'porcentaje' ? Math.round(Number(pr.value) * 100) : toCents(pr.value), startsAt: new Date(`${pr.from}T00:00:00-06:00`).toISOString(), endsAt: new Date(`${pr.to}T23:59:59-06:00`).toISOString(), appliesTo: { all: true }, minQuantity: Number(pr.minQuantity) || 0, combinable: pr.combinable }))}>Agregar</button></p>
        </section>
      )}
      {mods.includes('fidelidad') && <Fidelidad me={me} />}
      {mods.includes('fidelidad') && <Rifa />}
      {(msg.err || msg.ok) && <p className={msg.err ? 'error' : 'okmsg'}>{msg.err ?? msg.ok}</p>}
    </div>
  )
}

const EARN: Record<string, string> = { venta: 'Cada cobro', visita: 'Cada visita (QR)', monto: 'Por monto' }

/** Tarjeta de sellos o puntos: cómo se ganan, tope por día y premios. El cliente la ve en su teléfono. */
function Fidelidad({ me }: { me: Me }) {
  const [sending, setSending] = useState(false)
  const [lp, setLp] = useState({ unit: 'sellos', earnBy: 'venta', earnAmount: '100', earnPoints: '1', scope: 'todos', dailyCap: '' })
  const [rewards, setRewards] = useState<any[]>([])
  const [nr, setNr] = useState({ id: '', name: '', cost: '' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => {
    const r = await api<any>('GET', '/loyalty')
    setRewards(r.rewards)
    const p = r.program
    if (p) setLp({ unit: p.unit, earnBy: p.earn_by, earnAmount: p.earn_amount ? String(p.earn_amount / 100) : '100', earnPoints: String(p.earn_points), scope: p.scope, dailyCap: p.daily_cap ? String(p.daily_cap) : '' })
  }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [])
  const run = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); setMsg({ ok }); await load() } catch (e) { setMsg({ err: (e as Error).message }) } }
  const word = lp.unit === 'sellos' ? 'sellos' : 'puntos'
  const Word = lp.unit === 'sellos' ? 'Sellos' : 'Puntos'
  return (
    <section className="card">
      <h2>Tarjeta de {word}</h2>
      <p className="muted small">Se suman solos al cobrar con el cliente seleccionado. El cliente ve su tarjeta en su teléfono (Clientes → su ficha → «Su QR»).</p>
      <div className="row">
        <label>Se juntan<select value={lp.unit} onChange={(e) => setLp({ ...lp, unit: e.target.value })}><option value="sellos">Sellos</option><option value="puntos">Puntos</option></select></label>
        <label>Se ganan<select value={lp.earnBy} onChange={(e) => setLp({ ...lp, earnBy: e.target.value })}>{Object.entries(EARN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <div className="row">
        {lp.earnBy === 'monto' && <label>Cada $<input inputMode="decimal" value={lp.earnAmount} onChange={(e) => setLp({ ...lp, earnAmount: e.target.value })} /></label>}
        <label>{lp.earnBy === 'venta' ? `${Word} por cobro` : lp.earnBy === 'visita' ? `${Word} por visita` : `${Word} que da`}<input inputMode="numeric" value={lp.earnPoints} onChange={(e) => setLp({ ...lp, earnPoints: e.target.value })} /></label>
        <label>Máximo al día por cliente<input inputMode="numeric" value={lp.dailyCap} onChange={(e) => setLp({ ...lp, dailyCap: e.target.value })} placeholder="Sin límite" /></label>
      </div>
      <label>Para<select value={lp.scope} onChange={(e) => setLp({ ...lp, scope: e.target.value })}><option value="todos">Todos los clientes</option><option value="por_persona">Solo los inscritos</option></select></label>
      <p><button className="primary" onClick={run(() => api('PUT', '/loyalty', { unit: lp.unit, earnBy: lp.earnBy, earnAmount: lp.earnBy === 'monto' ? toCents(lp.earnAmount) : undefined, earnPoints: Number(lp.earnPoints) || 1, scope: lp.scope, dailyCap: Number(lp.dailyCap) > 0 ? Number(lp.dailyCap) : null }), 'Tarjeta guardada.')}>Guardar tarjeta</button></p>
      <h3>Mandar la tarjeta a tus clientes</h3>
      <p className="muted small">Cada cliente recibe por WhatsApp el link de su tarjeta. Ahí ve sus sellos y su código QR; en caja se lo escanean en «Escanear QR → Dar sello».</p>
      <p><button onClick={() => setSending(true)}>Mandar tarjetas por WhatsApp</button></p>
      {sending && <MandarTarjetas me={me} onClose={() => setSending(false)} />}
      <h3>Premios</h3>
      <p className="muted small">Tú decides cuántos {word} debe juntar el cliente para cada premio. Toca uno para cambiarlo.</p>
      <div className="table-wrap"><table className="list"><tbody>
        {rewards.map((r) => (
          <tr key={r.id} className="clickable" style={{ opacity: r.active ? 1 : 0.5 }} onClick={() => setNr({ id: r.id, name: r.name, cost: String(r.cost) })}>
            <td>{r.name}{!r.active && <small className="muted"> · quitado</small>}</td><td className="num"><b>{r.cost}</b> {word}</td>
          </tr>
        ))}
        {rewards.length === 0 && <tr><td className="muted">Ej. «Corte gratis» con 10 {word}.</td></tr>}
      </tbody></table></div>
      <div className="row">
        <label>Premio<input value={nr.name} onChange={(e) => setNr({ ...nr, name: e.target.value })} placeholder="Corte gratis" /></label>
        <label>{Word} que debe juntar<input inputMode="numeric" value={nr.cost} onChange={(e) => setNr({ ...nr, cost: e.target.value })} placeholder="10" /></label>
      </div>
      <p className="row">
        {nr.id && <button onClick={() => setNr({ id: '', name: '', cost: '' })}>Cancelar</button>}
        {nr.id && <button onClick={run(async () => { const r = rewards.find((x) => x.id === nr.id); await api('PATCH', `/loyalty/rewards/${nr.id}`, { active: !r?.active }); setNr({ id: '', name: '', cost: '' }) }, 'Listo.')}>{rewards.find((x) => x.id === nr.id)?.active ? 'Quitar premio' : 'Volver a activar'}</button>}
        <button className="primary" disabled={nr.name.trim().length < 2 || !(Number(nr.cost) > 0)} onClick={run(async () => {
          if (nr.id) await api('PATCH', `/loyalty/rewards/${nr.id}`, { name: nr.name, cost: Number(nr.cost) }); else await api('POST', '/loyalty/rewards', { name: nr.name, cost: Number(nr.cost) })
          setNr({ id: '', name: '', cost: '' })
        }, nr.id ? 'Premio guardado.' : 'Premio agregado.')}>{nr.id ? 'Guardar premio' : 'Agregar premio'}</button>
      </p>
      {(msg.err || msg.ok) && <p className={msg.err ? 'error' : 'okmsg'}>{msg.err ?? msg.ok}</p>}
    </section>
  )
}

/** «13 de febrero de 2027» (el cierre se guarda como el inicio del día siguiente, hora de México). */
export const closeDay = (endsAt: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }) => new Date(Date.parse(endsAt) - 1).toLocaleDateString('es-MX', { ...opts, timeZone: 'America/Mexico_City' })
const closeInput = (endsAt: string | null) => (endsAt ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(Date.parse(endsAt) - 1)) : '')

const TIE: Record<string, string> = { faciales: 'Más faciales pagados', productos: 'Más productos comprados', ninguno: 'Solo quien llegó primero' }
const STATUS_R: Record<string, string> = { ganador: 'Gana', entregado: 'Entregado', en_espera: 'En espera' }

/** Rifa de sellos: premios con cupo para los primeros que lleguen a la meta; el mismo día desempata faciales o compras. */
function Rifa() {
  const [list, setList] = useState<any[]>([])
  const [f, setF] = useState({ name: '', endDate: '', prizes: [{ name: '', goal: '', quantity: '1', tiebreak: 'ninguno' }] })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const [close, setClose] = useState('')
  const load = async () => { const r = (await api<any>('GET', '/campaigns')).campaigns; setList(r); setClose(closeInput(r.find((c: any) => c.active)?.endsAt ?? null)) }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [])
  const run = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); setMsg({ ok }); await load() } catch (e) { setMsg({ err: (e as Error).message }) } }
  const active = list.find((c) => c.active)
  const setP = (i: number, k: string, v: string) => setF({ ...f, prizes: f.prizes.map((p, j) => (j === i ? { ...p, [k]: v } : p)) })
  const ok = f.name.trim().length >= 2 && f.prizes.every((p) => p.name.trim().length >= 2 && Number(p.goal) > 0 && Number(p.quantity) > 0)
  return (
    <section className="card">
      <h2>Rifa de sellos</h2>
      <p className="muted small">Premios para los primeros que junten cierta cantidad de sellos. Si varios llegan el mismo día, gana quien tenga más faciales o más compras, según el premio. Cada cliente gana un solo premio y al entregárselo se le descuentan los sellos.</p>
      {active ? (
        <>
          <div className="card-head"><h3>{active.name}</h3><button className="mini" onClick={async () => { if (await confirmAsk('¿Terminar la rifa?', 'Ya no aparecerá en las tarjetas de los clientes.', true)) void run(() => api('POST', `/campaigns/${active.id}/end`), 'Rifa terminada.')() }}>Terminar rifa</button></div>
          <p className="muted small">Desde {new Date(active.startsAt).toLocaleDateString('es-MX')}{active.endsAt ? ` · ${Date.now() >= Date.parse(active.endsAt) ? 'cerró' : 'cierra'} el ${closeDay(active.endsAt)}` : ' · sin fecha de cierre'}</p>
          <div className="row" style={{ alignItems: 'end' }}>
            <label>Cierra el (último día que cuenta)<input type="date" value={close} onChange={(e) => setClose(e.target.value)} /></label>
            <button disabled={close === closeInput(active.endsAt)} onClick={run(() => api('PATCH', `/campaigns/${active.id}`, { endDate: close || null }), 'Fecha de cierre guardada.')}>Guardar fecha</button>
          </div>
          {active.prizes.map((p: any) => (
            <div key={p.id} style={{ marginBottom: 14 }}>
              <div className="info-row"><b>{p.name}</b><span>{p.goal} sellos · quedan {p.remaining} de {p.quantity}</span></div>
              <p className="muted small">Desempate el mismo día: {TIE[p.tiebreak]}</p>
              <div className="table-wrap"><table className="list"><tbody>
                {p.standings.map((x: any, i: number) => (
                  <tr key={x.customerId}>
                    <td>{i + 1}. <b>{x.name}</b><br /><small className="muted">llegó {new Date(x.reachedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}{x.score != null ? ` · ${x.score} ${p.tiebreak === 'faciales' ? 'faciales' : 'productos'}` : ''}</small></td>
                    <td className="num"><span className={x.status === 'ganador' ? 'pill' : 'muted'}>{STATUS_R[x.status]}</span>{' '}
                      {x.status === 'ganador' && <button className="mini primary" onClick={async () => { if (await confirmAsk(`¿Entregar «${p.name}» a ${x.name}?`, `Se le descuentan ${p.goal} sellos.`)) void run(() => api('POST', `/campaigns/${active.id}/prizes/${p.id}/deliver`, { customerId: x.customerId }), 'Premio entregado.')() }}>Entregar</button>}
                    </td>
                  </tr>
                ))}
                {p.standings.length === 0 && <tr><td className="muted">Nadie ha llegado a {p.goal} sellos todavía.</td></tr>}
              </tbody></table></div>
            </div>
          ))}
        </>
      ) : (
        <>
          <div className="row">
            <label>Nombre de la rifa<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Rifa de diciembre" /></label>
            <label>Cierra el (último día que cuenta)<input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
          </div>
          {f.prizes.map((p, i) => (
            <div key={i} className="danger-zone">
              <div className="row">
                <label>Premio<input value={p.name} onChange={(e) => setP(i, 'name', e.target.value)} placeholder="Perfume" /></label>
                <label>Sellos<input inputMode="numeric" value={p.goal} onChange={(e) => setP(i, 'goal', e.target.value)} placeholder="10" /></label>
                <label>Cuántos hay<input inputMode="numeric" value={p.quantity} onChange={(e) => setP(i, 'quantity', e.target.value)} /></label>
              </div>
              <div className="row" style={{ alignItems: 'end' }}>
                <label>Si llegan el mismo día, gana<select value={p.tiebreak} onChange={(e) => setP(i, 'tiebreak', e.target.value)}>{Object.entries(TIE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                {f.prizes.length > 1 && <button onClick={() => setF({ ...f, prizes: f.prizes.filter((_, j) => j !== i) })}>Quitar</button>}
              </div>
            </div>
          ))}
          <p className="row">
            <button onClick={() => setF({ ...f, prizes: [...f.prizes, { name: '', goal: '', quantity: '1', tiebreak: 'ninguno' }] })}>+ Otro premio</button>
            <button className="primary" disabled={!ok} onClick={run(async () => { await api('POST', '/campaigns', { name: f.name, ...(f.endDate ? { endDate: f.endDate } : {}), prizes: f.prizes.map((p) => ({ name: p.name, goal: Number(p.goal), quantity: Number(p.quantity), tiebreak: p.tiebreak })) }); setF({ name: '', endDate: '', prizes: [{ name: '', goal: '', quantity: '1', tiebreak: 'ninguno' }] }) }, 'Rifa iniciada. Los clientes la ven en su tarjeta.')}>Empezar rifa</button>
          </p>
        </>
      )}
      {(msg.err || msg.ok) && <p className={msg.err ? 'error' : 'okmsg'}>{msg.err ?? msg.ok}</p>}
    </section>
  )
}

/** Lista de clientes para mandarle a cada uno su tarjeta (con su QR) por WhatsApp; recuerda en este equipo a quién ya se le mandó. */
function MandarTarjetas({ me, onClose }: { me: Me; onClose: () => void }) {
  const [list, setList] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const KEY = 'nx_tarjetas_enviadas'
  const [sent, setSent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { return [] } })
  useEffect(() => { api<any>('GET', '/customers').then((r) => setList(r.customers.filter((c: any) => c.active !== 0 && c.code))).catch((e) => setErr(e.message)) }, [])
  const mark = (code: string) => { const next = [...new Set([...sent, code])]; setSent(next); try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* sin almacenamiento */ } }
  const shown = list.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="modal sheet" onClick={onClose}>
      <div className="card wide" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h2>Mandar tarjetas</h2><button className="mini" onClick={onClose}>Cerrar</button></div>
        <p className="muted small">Toca «WhatsApp» en cada cliente: se abre su chat con el mensaje listo y solo das enviar. Enviadas: {list.filter((c) => sent.includes(c.code)).length} de {list.length}.</p>
        <input aria-label="Buscar cliente" placeholder="Buscar cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
        {err && <p className="error">{err}</p>}
        <div className="table-wrap"><table className="list"><tbody>
          {shown.map((c) => (
            <tr key={c.id}>
              <td><b>{c.name}</b><br /><small className="muted">{c.phone ?? 'sin teléfono: elige el contacto en WhatsApp'}</small></td>
              <td className="num">
                <a className={`button ${sent.includes(c.code) ? '' : 'primary'}`} style={{ minHeight: 44 }} href={cardWhatsApp(c, me.business.name)} target="_blank" rel="noreferrer" onClick={() => mark(c.code)}>{sent.includes(c.code) ? '✓ Enviada' : 'WhatsApp'}</a>
              </td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td className="muted">Sin clientes.</td></tr>}
        </tbody></table></div>
      </div>
    </div>
  )
}
