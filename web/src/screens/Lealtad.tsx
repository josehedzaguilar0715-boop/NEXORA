import { useEffect, useState } from 'react'
import { ScanButton } from '../Scanner'
import { api, mxn, toCents } from '../api'
import type { Me } from '../App'

/** Escanear el QR del cliente: entrada (asistencia), usar membresía o consultar. El servidor valida cada escaneo. */
export function Escanear(_: { me: Me }) {
  const [code, setCode] = useState('')
  const [action, setAction] = useState('entrada')
  const [res, setRes] = useState<any>(null)
  const [err, setErr] = useState('')
  const scan = async (c = code) => {
    try { setRes(await api('POST', '/scan', { code: c, action })); setErr('') } catch (e) { setRes(null); setErr((e as Error).message) }
    setCode('')
  }
  return (
    <div className="card login" style={{ maxWidth: 680 }}>
      <div className="tabs">{[['entrada', 'Registrar entrada'], ['membresia', 'Usar membresía'], ['consulta', 'Solo consultar']].map(([k, v]) => <button key={k} className={action === k ? 'on' : ''} onClick={() => setAction(k!)}>{v}</button>)}</div>
      <label>Escanea el QR o código de barras del cliente</label>
      <div className="row"><input aria-label="Código del cliente" autoFocus value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && code && scan()} /><ScanButton onCode={(c) => scan(c)} /></div>
      {err && <h2 className="error">✘ {err}</h2>}
      {res && (
        <div style={{ marginTop: 12 }}>
          <h2 className="okmsg">✔ {res.customer.name}</h2>
          {res.membership && <p>Membresía: quedan <b>{res.membership.remaining}</b> de {res.membership.usesPerPeriod} en este periodo.</p>}
          {res.loyaltyEarned ? <p>Ganó {res.loyaltyEarned} puntos/sellos.</p> : null}
          <p className="muted">Saldo de puntos: {res.loyaltyBalance}{res.lastVisit ? ` · última visita ${new Date(res.lastVisit).toLocaleString('es-MX')}` : ''}</p>
          {res.memberships.map((m: any) => <p key={m.id} className="muted">{m.name}: vence {m.endsAt.slice(0, 10)}, quedan {m.remaining}</p>)}
        </div>
      )}
    </div>
  )
}

/** Configuración del dueño: membresías y paquetes, promociones y programa de puntos o sellos. */
export function Lealtad(_: { me: Me }) {
  const [mods, setMods] = useState<string[]>([])
  const [plans, setPlans] = useState<any[]>([])
  const [promos, setPromos] = useState<any[]>([])
  const [loyal, setLoyal] = useState<any>(null)
  const [p, setP] = useState({ name: '', kind: 'periodo', usesPerPeriod: '4', period: 'mes', validityDays: '90', price: '' })
  const [pr, setPr] = useState({ name: '', kind: 'porcentaje', value: '', from: '', to: '', minQuantity: '', combinable: false })
  const [lp, setLp] = useState({ unit: 'puntos', earnBy: 'monto', earnAmount: '10', earnPoints: '1', scope: 'todos', reward: '', cost: '' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => {
    const m = (await api<any>('GET', '/modules')).active as string[]
    setMods(m)
    if (m.includes('membresias')) setPlans((await api<any>('GET', '/membership-plans')).plans)
    if (m.includes('promociones')) setPromos((await api<any>('GET', '/promotions')).promotions)
    if (m.includes('fidelidad')) setLoyal(await api('GET', '/loyalty'))
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
      {mods.includes('fidelidad') && (
        <section className="card">
          <h2>Puntos o sellos</h2>
          <div className="row"><label>Se acumulan<select value={lp.unit} onChange={(e) => setLp({ ...lp, unit: e.target.value })}><option value="puntos">Puntos</option><option value="sellos">Sellos</option></select></label>
            <label>Por<select value={lp.earnBy} onChange={(e) => setLp({ ...lp, earnBy: e.target.value })}><option value="monto">Monto de compra</option><option value="visita">Visita</option></select></label></div>
          <div className="row">{lp.earnBy === 'monto' && <label>Cada $<input inputMode="decimal" value={lp.earnAmount} onChange={(e) => setLp({ ...lp, earnAmount: e.target.value })} /></label>}<label>Da<input inputMode="numeric" value={lp.earnPoints} onChange={(e) => setLp({ ...lp, earnPoints: e.target.value })} /></label>
            <label>Para<select value={lp.scope} onChange={(e) => setLp({ ...lp, scope: e.target.value })}><option value="todos">Todos los clientes</option><option value="por_persona">Solo inscritos</option></select></label></div>
          <p><button className="primary" onClick={run(() => api('PUT', '/loyalty', { unit: lp.unit, earnBy: lp.earnBy, earnAmount: lp.earnBy === 'monto' ? toCents(lp.earnAmount) : undefined, earnPoints: Number(lp.earnPoints) || 1, scope: lp.scope }))}>Guardar programa</button></p>
          <h3>Premios</h3>
          <div className="table-wrap"><table className="list"><tbody>{loyal?.rewards.map((r: any) => <tr key={r.id}><td>{r.name}</td><td className="num">{r.cost}</td></tr>)}</tbody></table></div>
          <div className="row"><input aria-label="Premio" placeholder="Premio" value={lp.reward} onChange={(e) => setLp({ ...lp, reward: e.target.value })} /><input aria-label="Cuesta" placeholder="Cuesta" inputMode="numeric" value={lp.cost} onChange={(e) => setLp({ ...lp, cost: e.target.value })} /><button onClick={run(() => api('POST', '/loyalty/rewards', { name: lp.reward, cost: Number(lp.cost) }))}>Agregar</button></div>
        </section>
      )}
      {(msg.err || msg.ok) && <p className={msg.err ? 'error' : 'okmsg'}>{msg.err ?? msg.ok}</p>}
    </div>
  )
}
