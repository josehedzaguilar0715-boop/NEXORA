import { useEffect, useState } from 'react'
import { api, mxn, toCents } from '../api'
import { can, FIADO_GIROS, hasGiro, type Me } from '../App'
import { cardWhatsApp } from './MiTarjeta'
import { Sheet } from '../Sheet'

const KIND: Record<string, string> = { cargo: 'Compra fiada', abono: 'Abono', cancelacion: 'Cancelación' }
const METHOD: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', fiado: 'Fiado' }

/** Clientes: lista con búsqueda y, por cliente, su cuenta (fiado), membresías, puntos y compras según el negocio. */
export function Clientes({ me }: { me: Me }) {
  const fiado = hasGiro(me, ...FIADO_GIROS)
  const [list, setList] = useState<any[]>([])
  const [rec, setRec] = useState<{ customers: any[]; total: number }>({ customers: [], total: 0 })
  const [sel, setSel] = useState<any>(null)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState('')
  const load = async () => {
    setList((await api<any>('GET', `/customers?q=${encodeURIComponent(q)}`)).customers)
    if (fiado) setRec(await api('GET', '/receivables'))
  }
  useEffect(() => { const t = setTimeout(() => void load().catch((e) => setMsg(e.message)), 200); return () => clearTimeout(t) }, [q])
  const balance = (id: string) => rec.customers.find((x) => x.id === id)?.balance as number | undefined

  return (
    <div className="page">
      <div className="toolbar">
        <div className="row search"><input aria-label="Buscar cliente" placeholder="Buscar por nombre o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="primary" onClick={() => setAdding(true)}>+ Nuevo cliente</button>
      </div>
      {fiado && <div className="kpis mini"><div><span className="muted">Te deben en total</span><b>{mxn(rec.total)}</b></div><div><span className="muted">Clientes con saldo</span><b>{rec.customers.length}</b></div></div>}
      {msg && <p className="error">{msg}</p>}
      <div>
        <section className="card">
          <div className="table-wrap"><table className="list">
            <thead><tr><th>Cliente</th>{fiado && <th className="num">Debe</th>}</tr></thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={`clickable ${sel?.id === c.id ? 'sel' : ''}`} onClick={() => setSel(c)}>
                  <td><b>{c.name}</b><br /><small className="muted">{c.phone ?? 'sin teléfono'}</small></td>
                  {fiado && <td className="num">{balance(c.id) ? <span className="pill bad">{mxn(balance(c.id)!)}</span> : <span className="muted">—</span>}</td>}
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={2} className="empty">{q ? 'Nadie coincide con la búsqueda.' : 'Todavía no hay clientes.'}</td></tr>}
            </tbody>
          </table></div>
        </section>
        {sel && <Sheet onClose={() => setSel(null)}><Cliente me={me} c={sel} fiado={fiado} onChanged={() => void load()} onClose={() => setSel(null)} /></Sheet>}
      </div>
      {adding && <NuevoCliente onClose={() => setAdding(false)} onDone={(c) => { setAdding(false); setSel(c); void load() }} />}
    </div>
  )
}

function NuevoCliente({ onClose, onDone }: { onClose: () => void; onDone: (c: any) => void }) {
  const [f, setF] = useState({ name: '', phone: '' })
  const [err, setErr] = useState('')
  return (
    <div className="modal" onClick={onClose}>
      <form className="card" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => { e.preventDefault(); try { onDone((await api<any>('POST', '/customers', { name: f.name, phone: f.phone || undefined })).customer) } catch (x) { setErr((x as Error).message) } }}>
        <h2>Nuevo cliente</h2>
        <label>Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
        <label>Teléfono (opcional)<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        {err && <p className="error">{err}</p>}
        <p className="row"><button type="button" onClick={onClose}>Cancelar</button><button className="primary" disabled={f.name.trim().length < 2}>Agregar cliente</button></p>
      </form>
    </div>
  )
}

function Cliente({ me, c, fiado, onChanged, onClose }: { me: Me; c: any; fiado: boolean; onChanged: () => void; onClose: () => void }) {
  const membresias = me.modules?.includes('membresias')
  const puntos = me.modules?.includes('fidelidad')
  const tabs = [
    ...(fiado ? [['cuenta', 'Fiado']] : []),
    ...(membresias ? [['membresias', 'Membresías']] : []),
    ...(puntos ? [['puntos', 'Puntos']] : []),
    ['compras', 'Compras'],
    ['datos', 'Datos'],
    ['qr', 'Su QR'],
  ] as [string, string][]
  const [tab, setTab] = useState(tabs[0]![0])
  useEffect(() => { setTab(tabs[0]![0]) }, [c.id])
  return (
    <section className="card">
      <div className="card-head"><h2>{c.name}</h2><button className="mini" onClick={onClose} aria-label="Cerrar">Cerrar</button></div>
      <p className="muted small" style={{ marginTop: -6 }}>{c.phone ?? 'sin teléfono'}</p>
      <nav className="subtabs">{tabs.map(([k, v]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{v}</button>)}</nav>
      {tab === 'cuenta' && <Cuenta me={me} c={c} onChanged={onChanged} />}
      {tab === 'membresias' && <Membresias c={c} />}
      {tab === 'puntos' && <Puntos me={me} c={c} />}
      {tab === 'compras' && <Compras c={c} />}
      {tab === 'datos' && <Datos me={me} c={c} onChanged={onChanged} />}
      {tab === 'qr' && (
        <div className="row" style={{ alignItems: 'center' }}>
          <img alt={`QR de ${c.name}`} src={`/api/public/qr/${c.code}.svg`} width={150} height={150} style={{ flex: '0 0 auto', background: '#fff', borderRadius: 12, padding: 6 }} />
          <p className="muted" style={{ flex: 1 }}>Su código: <b style={{ color: 'var(--ink)' }}>{c.code}</b><br />Se escanea en «Escanear QR» para registrar su visita, usar su membresía o sumar puntos.<br /><a href={`/api/public/qr/${c.code}.svg`} download={`qr-${c.name}.svg`}>Descargar QR</a></p>
        </div>
      )}
      {tab === 'qr' && (
        <div className="danger-zone">
          <b>Su tarjeta de sellos en su teléfono</b>
          <p className="muted small">Mándale este link: ahí ve sus sellos, cuántos le faltan y sus premios. Solo puede verlos, no cambiarlos.</p>
          <p className="row">
            <a className="button" href={`/tarjeta/${c.code}`} target="_blank" rel="noreferrer">Abrir tarjeta</a>
            <a className="button primary" href={cardWhatsApp(c, me.business.name)} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>
          </p>
        </div>
      )}
    </section>
  )
}

function Cuenta({ me, c, onChanged }: { me: Me; c: any; onChanged: () => void }) {
  const [credit, setCredit] = useState<any>(null)
  const [f, setF] = useState({ abono: '', method: 'efectivo', limit: '', debt: '', debtNote: '', code: '' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => setCredit(await api('GET', `/customers/${c.id}/credit`))
  useEffect(() => { void load().catch(() => {}) }, [c.id])
  const run = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); setMsg({ ok }); await load(); onChanged() } catch (e) { setMsg({ err: (e as Error).message }) } }
  if (!credit) return <p className="muted">Cargando…</p>
  return (
    <div>
      <div className="kpis mini">
        <div><span className="muted">Debe</span><b className={credit.balance ? 'neg' : ''}>{mxn(credit.balance)}</b></div>
        <div><span className="muted">Límite</span><b>{credit.limit ? mxn(credit.limit) : 'sin crédito'}</b></div>
        <div><span className="muted">Disponible</span><b>{mxn(credit.available)}</b></div>
      </div>
      {credit.balance > 0 && (<>
        <h3>Recibir abono</h3>
        <div className="row">
          <input aria-label="Abono" inputMode="decimal" placeholder="$0.00" value={f.abono} onChange={(e) => setF({ ...f, abono: e.target.value })} />
          <select aria-label="Forma de pago" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></select>
          <button className="primary" style={{ flex: '0 0 auto' }} disabled={!(toCents(f.abono) > 0)} onClick={run(async () => { await api('POST', `/customers/${c.id}/credit-payments`, { id: crypto.randomUUID(), amount: toCents(f.abono), method: f.method }); setF({ ...f, abono: '' }) }, 'Abono registrado.')}>Abonar</button>
        </div>
      </>)}
      <details className="danger-zone">
        <summary><b>Agregar deuda anterior</b> <span className="muted small">— lo que ya debía antes de usar NEXORA</span></summary>
        <p className="muted small">No es una venta: no cuenta como ingreso ni descuenta inventario. Queda en sus movimientos y en la bitácora.</p>
        <div className="row">
          <label>Cuánto debe<input inputMode="decimal" placeholder="$0.00" value={f.debt} onChange={(e) => setF({ ...f, debt: e.target.value })} /></label>
          <label>Motivo<input value={f.debtNote} onChange={(e) => setF({ ...f, debtNote: e.target.value })} placeholder="Deuda de la libreta" /></label>
        </div>
        {me.user.role !== 'owner' && <label>Código del dueño<input type="password" inputMode="numeric" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>}
        <p><button className="primary" disabled={!(toCents(f.debt) > 0) || f.debtNote.trim().length < 3 || (me.user.role !== 'owner' && !f.code)} onClick={run(async () => { await api('POST', `/customers/${c.id}/credit-charges`, { id: crypto.randomUUID(), amount: toCents(f.debt), note: f.debtNote, ...(me.user.role !== 'owner' ? { authCode: f.code } : {}) }); setF({ ...f, debt: '', debtNote: '', code: '' }) }, 'Deuda agregada a su cuenta.')}>Agregar a su cuenta</button></p>
      </details>
      {me.user.role === 'owner' && (<>
        <h3 style={{ marginTop: 14 }}>Límite de crédito</h3>
        <div className="row"><input aria-label="Límite de crédito" inputMode="decimal" placeholder={credit.limit ? String(credit.limit / 100) : '$0.00'} value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} /><button style={{ flex: '0 0 auto' }} disabled={f.limit.trim() === ''} onClick={run(async () => { await api('PUT', `/customers/${c.id}/credit-limit`, { limit: toCents(f.limit) }); setF({ ...f, limit: '' }) }, 'Límite guardado.')}>Guardar límite</button></div>
      </>)}
      {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
      <h3 style={{ marginTop: 14 }}>Movimientos</h3>
      <div className="table-wrap"><table className="list"><tbody>
        {credit.ledger.map((l: any, i: number) => <tr key={i}><td>{KIND[l.kind] ?? l.kind}{l.method ? ` · ${METHOD[l.method] ?? l.method}` : ''}{l.note ? <><br /><small className="muted">{l.note}</small></> : null}<br /><small className="muted">{new Date(l.createdAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', hour12: true, timeZone: 'America/Mexico_City' })}</small></td><td className={`num ${l.delta > 0 ? 'neg' : 'pos'}`}>{mxn(l.delta)}</td></tr>)}
        {credit.ledger.length === 0 && <tr><td className="muted">Sin movimientos.</td></tr>}
      </tbody></table></div>
    </div>
  )
}

/** Vender una membresía o paquete: se cobra como venta en la caja abierta y queda activa para el cliente. */
function Membresias({ c }: { c: any }) {
  const [status, setStatus] = useState<any>(null)
  const [plans, setPlans] = useState<any[]>([])
  const [f, setF] = useState({ planId: '', method: 'efectivo' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => {
    setStatus(await api('GET', `/customers/${c.id}`))
    const p = (await api<any>('GET', '/membership-plans')).plans.filter((x: any) => x.active !== 0)
    setPlans(p); setF((v) => ({ ...v, planId: v.planId || p[0]?.id || '' }))
  }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [c.id])
  const plan = plans.find((p) => p.id === f.planId)
  const sell = async () => {
    try {
      const sale = (await api<any>('POST', '/sales', { id: crypto.randomUUID(), paymentMethod: f.method, customerId: c.id, createdAt: new Date().toISOString(), items: [{ description: `Membresía: ${plan.name}`, quantity: 1, unitPrice: plan.price }] })).sale
      await api('POST', `/customers/${c.id}/memberships`, { planId: plan.id, saleId: sale.id })
      setMsg({ ok: `Listo: ${plan.name} activa. Cobrado ${mxn(plan.price)}.` }); await load()
    } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  return (
    <div>
      {status?.memberships.length ? (
        <div className="table-wrap"><table className="list"><tbody>{status.memberships.map((m: any) => <tr key={m.id}><td><b>{m.name}</b><br /><small className="muted">vence {new Date(m.endsAt).toLocaleDateString('es-MX')}</small></td><td className="num">quedan {m.remaining} de {m.usesPerPeriod}</td></tr>)}</tbody></table></div>
      ) : <p className="muted">No tiene membresías activas.</p>}
      <h3 style={{ marginTop: 14 }}>Vender membresía o paquete</h3>
      {plans.length === 0 ? <p className="muted small">Primero crea tus membresías en «Sellos y promociones» (o «Membresías y promos»).</p> : (<>
        <div className="row">
          <label>Membresía<select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {mxn(p.price)}</option>)}</select></label>
          <label>Pago<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option></select></label>
        </div>
        <p className="muted small">Se cobra en tu caja abierta.</p>
        <p><button className="primary" disabled={!plan} onClick={sell}>Cobrar {plan ? mxn(plan.price) : ''} y activar</button></p>
      </>)}
      {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
    </div>
  )
}

const LREASON: Record<string, string> = { venta: 'Compra', visita: 'Visita', escaneo: 'Sello (QR)', manual: 'Sello a mano', ajuste: 'Ajuste', importado: 'Sellos anteriores', canje: 'Canje', rifa: 'Premio de rifa', cancelacion: 'Compra cancelada' }

function Puntos({ me, c }: { me: Me; c: any }) {
  const canGive = can(me, 'give_stamps')
  const owner = me.user.role === 'owner'
  const [adj, setAdj] = useState({ qty: '1', reason: '', code: '' })
  const [data, setData] = useState<any>(null)
  const [rewards, setRewards] = useState<any[]>([])
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => { setData(await api('GET', `/customers/${c.id}/loyalty`)); setRewards((await api<any>('GET', '/loyalty')).rewards.filter((r: any) => r.active !== 0)) }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [c.id])
  if (!data) return <p className="muted">Cargando…</p>
  const qty = Math.floor(Number(adj.qty))
  const ready = qty > 0 && adj.reason.trim().length >= 3 && (owner || adj.code.length > 0)
  const adjust = async (sign: 1 | -1) => {
    try {
      const r = await api<any>('POST', `/customers/${c.id}/stamps/adjust`, { delta: sign * qty, reason: adj.reason, ...(owner ? {} : { authCode: adj.code }) })
      setMsg({ ok: `${sign > 0 ? 'Se agregaron' : 'Se quitaron'} ${qty}. Ahora tiene ${r.balance}.` })
      setAdj({ qty: '1', reason: '', code: '' })
      await load()
    } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  return (
    <div>
      <div className="kpis mini"><div><span className="muted">Sellos o puntos</span><b>{data.balance}</b></div></div>
      {canGive && (
        <div className="danger-zone">
          <h3>Agregar o quitar sellos</h3>
          <p className="muted small">Para corregir: sumar los que no se registraron o quitar los que se dieron de más. No cuenta para el máximo del día y queda en la bitácora.</p>
          <div className="row" style={{ alignItems: 'end' }}>
            <label>Cuántos<span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <button type="button" aria-label="Uno menos" onClick={() => setAdj({ ...adj, qty: String(Math.max(1, qty - 1 || 1)) })}>−</button>
              <input inputMode="numeric" aria-label="Cuántos sellos" style={{ textAlign: 'center', minWidth: 0 }} value={adj.qty} onChange={(e) => setAdj({ ...adj, qty: e.target.value.replace(/\D/g, '') })} />
              <button type="button" aria-label="Uno más" onClick={() => setAdj({ ...adj, qty: String((qty || 0) + 1) })}>+</button>
            </span></label>
            <label>Motivo<input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="Sellos que no se registraron" /></label>
          </div>
          {!owner && <label>Código del dueño<input type="password" inputMode="numeric" value={adj.code} onChange={(e) => setAdj({ ...adj, code: e.target.value })} /></label>}
          <p className="row">
            <button className="primary" disabled={!ready} onClick={() => adjust(1)}>+ Agregar {qty > 0 ? qty : ''}</button>
            <button className="danger" disabled={!ready || qty > data.balance} onClick={() => { if (confirm(`¿Quitarle ${qty} a ${c.name}?`)) void adjust(-1) }}>− Quitar {qty > 0 ? qty : ''}</button>
          </p>
        </div>
      )}
      {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
      <h3>Canjear</h3>
      <div className="chips">{rewards.map((r) => <button key={r.id} className="chip" disabled={data.balance < r.cost} onClick={async () => { try { const x = await api<any>('POST', `/customers/${c.id}/redeem`, { rewardId: r.id }); setMsg({ ok: `Canjeado: ${x.reward}.` }); await load() } catch (e) { setMsg({ err: (e as Error).message }) } }}>{r.name} · {r.cost}</button>)}</div>
      {rewards.length === 0 && <p className="muted small">Crea premios en «Sellos y promociones» (o «Membresías y promos»).</p>}
      <h3>Movimientos</h3>
      <div className="table-wrap"><table className="list"><tbody>
        {data.ledger.map((l: any, i: number) => (
          <tr key={i}>
            <td>{LREASON[l.reason] ?? l.reason}{l.note ? <>: <span className="muted">{l.note}</span></> : null}<br /><small className="muted">{new Date(l.createdAt).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Mexico_City' })}{l.byName ? ` · ${l.byName}` : ''}</small></td>
            <td className="num"><b className={l.delta > 0 ? 'pos' : 'neg'}>{l.delta > 0 ? '+' : ''}{l.delta}</b></td>
          </tr>
        ))}
        {data.ledger.length === 0 && <tr><td className="muted">Todavía no tiene sellos.</td></tr>}
      </tbody></table></div>
    </div>
  )
}

/** Datos del cliente; notas (solo el dueño) y, en uñas, su dirección para servicios a domicilio. */
function Datos({ me, c, onChanged }: { me: Me; c: any; onChanged: () => void }) {
  const owner = me.user.role === 'owner'
  const home = hasGiro(me, 'unas')
  const [f, setF] = useState<{ name: string; phone: string; notes: string; address: string; homeAll: boolean } | null>(null)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  useEffect(() => { api<any>('GET', `/customers/${c.id}`).then((r) => setF({ name: r.customer.name, phone: r.customer.phone ?? '', notes: r.customer.notes ?? '', address: r.customer.address ?? '', homeAll: !!r.customer.home_all })).catch((e) => setMsg({ err: e.message })) }, [c.id])
  if (!f) return <p className="muted">Cargando…</p>
  return (
    <div>
      <div className="row">
        <label>Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Teléfono<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
      </div>
      {home && (<>
        <label>Dirección (solo la ve el negocio)<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={f.homeAll} onChange={(e) => setF({ ...f, homeAll: e.target.checked })} />Todos sus servicios son a domicilio</label>
      </>)}
      {owner && <label>Notas (solo las ve el dueño; no escribas datos de salud)<textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>}
      {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
      <p><button className="primary" disabled={f.name.trim().length < 2} onClick={async () => {
        try {
          await api('PATCH', `/customers/${c.id}`, { name: f.name, phone: f.phone || null, ...(home ? { address: f.address || null, homeAll: f.homeAll } : {}), ...(owner ? { notes: f.notes || null } : {}) })
          setMsg({ ok: 'Datos guardados.' }); onChanged()
        } catch (e) { setMsg({ err: (e as Error).message }) }
      }}>Guardar datos</button></p>
    </div>
  )
}

function Compras({ c }: { c: any }) {
  const [sales, setSales] = useState<any[] | null>(null)
  useEffect(() => { api<any>('GET', `/customers/${c.id}/sales`).then((r) => setSales(r.sales)).catch(() => setSales([])) }, [c.id])
  if (!sales) return <p className="muted">Cargando…</p>
  return (
    <div className="table-wrap"><table className="list"><tbody>
      {sales.map((s) => <tr key={s.id}><td>Ticket #{s.folio}<br /><small className="muted">{new Date(s.createdAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', hour12: true, timeZone: 'America/Mexico_City' })} · {METHOD[s.paymentMethod] ?? s.paymentMethod}{s.status === 'cancelada' ? ' · cancelada' : ''}</small></td><td className="num">{mxn(s.total)}</td></tr>)}
      {sales.length === 0 && <tr><td className="muted">Sin compras registradas a su nombre.</td></tr>}
    </tbody></table></div>
  )
}
