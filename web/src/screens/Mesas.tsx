import { useEffect, useState } from 'react'
import { api, mxn, toCents } from '../api'
import { can, type Me } from '../App'
import type { Product } from './Caja'

const COLORS: Record<string, string> = { libre: 'var(--ok)', ocupada: 'var(--accent)', reservada: '#2563eb', por_cobrar: 'var(--danger)', limpieza: 'var(--muted)' }
const LABEL: Record<string, string> = { libre: 'Libre', ocupada: 'Ocupada', reservada: 'Reservada', por_cobrar: 'Por cobrar', limpieza: 'En limpieza' }
type P = Product & { attrs?: any; sellable?: boolean }

/** Mapa de mesas en vivo y cuenta de cada mesa. */
export function Mesas({ me }: { me: Me }) {
  const [tables, setTables] = useState<any[]>([])
  const [tab, setTab] = useState<any>(null)
  const [msg, setMsg] = useState('')
  const load = async () => setTables((await api<any>('GET', '/tables')).tables)
  useEffect(() => { void load(); const t = setInterval(load, 15_000); return () => clearInterval(t) }, [])
  const openTable = async (t: any) => {
    try {
      if (t.status === 'limpieza') { await api('POST', `/tables/${t.id}/free`); return void load() }
      if (t.tabId) return setTab((await api<any>('GET', `/tabs/${t.tabId}`)).tab)
      const people = Number(prompt(`¿Cuántas personas en la mesa ${t.name}?`, '2'))
      if (!people) return
      setTab((await api<any>('POST', '/tabs', { id: crypto.randomUUID(), kind: 'mesa', tableId: t.id, people })).tab)
      void load()
    } catch (e) { setMsg((e as Error).message) }
  }
  if (tab) return <Cuenta me={me} tab={tab} onClose={() => { setTab(null); void load() }} />
  const areas = [...new Set(tables.map((t) => t.area))]
  return (
    <div>
      {msg && <p className="error">{msg}</p>}
      {areas.map((a) => (
        <section key={a} className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ textTransform: 'capitalize' }}>{a}</h2>
          <div className="results">{tables.filter((t) => t.area === a).map((t) => (
            <button key={t.id} onClick={() => openTable(t)} style={{ borderColor: COLORS[t.status], borderWidth: 4, minHeight: 110 }}>
              Mesa {t.name} · {t.seats} lugares
              <small style={{ color: COLORS[t.status], fontWeight: 700 }}>{LABEL[t.status]}{t.status === 'limpieza' ? ' (toca para liberar)' : ''}</small>
              {t.tabId && <small>{t.people} personas · {mxn(t.total)}</small>}
              {t.reservation && <small>Reserva: {t.reservation.name} ({t.reservation.people})</small>}
            </button>
          ))}</div>
        </section>
      ))}
      {tables.length === 0 && <p className="card">No hay mesas. El dueño las da de alta.</p>}
    </div>
  )
}

/** Cuenta de una mesa o pedido: agregar, mandar a cocina, pedir cuenta y cobrar (completo o dividido). */
export function Cuenta({ me, tab: initial, onClose }: { me: Me; tab: any; onClose: () => void }) {
  const [tab, setTab] = useState(initial)
  const [menu, setMenu] = useState<P[]>([])
  const [q, setQ] = useState('')
  const [person, setPerson] = useState<number | ''>('')
  const [pay, setPay] = useState<null | { person?: number }>(null)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  useEffect(() => { api<any>('GET', '/products').then((r) => setMenu(r.products.filter((p: P) => p.sellable !== false))).catch(() => {}) }, [])
  const run = async (fn: () => Promise<any>, ok?: string) => {
    try { const r = await fn(); if (r?.tab) setTab(r.tab); else setTab((await api<any>('GET', `/tabs/${tab.id}`)).tab); setMsg(ok ? { ok } : {}) } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const add = (p: P, modifiers: string[] = []) => {
    const qty = p.unit === 'pieza' ? 1 : Number(prompt(`¿Cuántos kilos de ${p.name}?`, '1'))
    if (!qty) return
    void run(() => api('POST', `/tabs/${tab.id}/items`, { items: [{ id: crypto.randomUUID(), productId: p.id, quantity: qty, modifiers, ...(person ? { person } : {}) }] }))
  }
  const list = menu.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 40)
  const persons = [...new Set(tab.items.filter((i: any) => i.person).map((i: any) => i.person))] as number[]
  return (
    <div className="sell">
      <section className="card">
        <div className="row"><button style={{ flex: '0 0 auto' }} onClick={onClose}>← Volver</button><h2 style={{ margin: 0 }}>{tab.table ? `Mesa ${tab.table}` : `Pedido #${tab.orderNumber}`}</h2></div>
        <div className="row" style={{ marginTop: 8 }}>
          <input placeholder="Buscar en el menú…" value={q} onChange={(e) => setQ(e.target.value)} />
          {tab.kind === 'mesa' && <label style={{ flex: '0 0 160px' }}>Persona<select value={person} onChange={(e) => setPerson(e.target.value ? Number(e.target.value) : '')}><option value="">—</option>{Array.from({ length: tab.people }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>}
        </div>
        <div className="results">{list.map((p) => (
          <div key={p.id} style={{ display: 'grid', gap: 4 }}>
            <button onClick={() => add(p)}>{p.name}<small>{mxn(p.price)}{p.unit !== 'pieza' ? ' / kg' : ''}</small></button>
            {(p.attrs?.modifiers ?? []).map((m: any) => <button key={m.name} style={{ minHeight: 44 }} onClick={() => add(p, [m.name])}>+ {m.name} ({mxn(m.price)})</button>)}
          </div>
        ))}</div>
      </section>
      <section className="card cart">
        <h2>Cuenta</h2>
        <table><tbody>{tab.items.map((i: any) => (
          <tr key={i.id} style={{ opacity: ['cancelado', 'pagado'].includes(i.status) ? 0.5 : 1 }}>
            <td>{i.quantity} {i.description}{i.person ? ` · P${i.person}` : ''}<br /><small className="muted">{i.status}{i.courtesy ? ' · cortesía' : ''}</small></td>
            <td className="num">{mxn(i.total)}</td>
            <td>{!['cancelado', 'pagado'].includes(i.status) && (
              <>
                <button onClick={() => { const r = prompt('Motivo de la cancelación:'); const c = r && prompt('Código del dueño:'); if (c) void run(() => api('POST', `/tab-items/${i.id}/cancel`, { reason: r, authCode: c })) }}>✕</button>
                <button onClick={() => { const r = prompt('Motivo de la cortesía:'); const c = r && prompt('Código del dueño:'); if (c) void run(() => api('POST', `/tab-items/${i.id}/courtesy`, { reason: r, authCode: c })) }}>🎁</button>
              </>
            )}</td>
          </tr>
        ))}</tbody></table>
        <div className="total">{mxn(tab.pending)}</div>
        {tab.minConsumption ? <p className="muted">Consumo mínimo de la mesa: {mxn(tab.minConsumption)}</p> : null}
        {msg.err && <p className="error">{msg.err}</p>}
        {msg.ok && <p className="okmsg">{msg.ok}</p>}
        <div className="pay">
          {tab.kind === 'mesa' && <button className="primary big" disabled={!tab.items.some((i: any) => i.status === 'pendiente')} onClick={() => run(() => api('POST', `/tabs/${tab.id}/send`), 'Comandas enviadas.')}>Mandar a cocina</button>}
          {tab.kind === 'mesa' && <button className="big" onClick={() => run(() => api('POST', `/tabs/${tab.id}/request-bill`), 'Cuenta pedida.')}>Pedir cuenta</button>}
          {can(me, 'sell') && <button className="primary big" disabled={!tab.pending} onClick={() => setPay({})}>Cobrar todo</button>}
          {persons.map((n) => <button key={n} className="big" onClick={() => setPay({ person: n })}>Cobrar persona {n}</button>)}
          {tab.kind !== 'mesa' && <button className="big" disabled={tab.pending > 0} onClick={() => run(() => api('POST', `/tabs/${tab.id}/send`), 'Enviado a cocina.')}>Mandar a cocina</button>}
        </div>
      </section>
      {pay && <Cobrar tab={tab} person={pay.person} onClose={() => setPay(null)} onDone={async (t) => { setPay(null); setMsg({ ok: `Cobrado ${mxn(t)}` }); const r = await api<any>('GET', `/tabs/${tab.id}`); setTab(r.tab); if (r.tab.status === 'cerrada') onClose() }} />}
    </div>
  )
}

function Cobrar({ tab, person, onClose, onDone }: { tab: any; person?: number; onClose: () => void; onDone: (total: number) => void }) {
  const [method, setMethod] = useState('efectivo')
  const [tip, setTip] = useState('')
  const [err, setErr] = useState('')
  const amount = person ? tab.byPerson[person] ?? 0 : tab.pending
  const go = async () => {
    try {
      const r = await api<any>('POST', `/tabs/${tab.id}/checkout`, { parts: [{ id: crypto.randomUUID(), paymentMethod: method, ...(person ? { person } : {}), ...(toCents(tip) > 0 ? { tip: toCents(tip), tipMethod: method === 'fiado' ? 'efectivo' : method } : {}) }] })
      onDone(r.parts[0].sale.total)
    } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="modal" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2>{person ? `Cobrar persona ${person}` : 'Cobrar la cuenta'}</h2>
        <div className="total">{mxn(amount)}</div>
        <div className="tabs">{['efectivo', 'transferencia', 'tarjeta'].map((m) => <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{m}</button>)}</div>
        <label>Propina para el mesero (aparte)<input inputMode="decimal" value={tip} onChange={(e) => setTip(e.target.value)} placeholder="$0.00" /></label>
        {err && <p className="error">{err}</p>}
        <p className="row"><button onClick={onClose}>Volver</button><button className="primary big" onClick={go}>Cobrar</button></p>
      </div>
    </div>
  )
}

/** Pantalla de cocina por estación: cada una ve solo lo suyo. */
export function Cocina(_: { me: Me }) {
  const [station, setStation] = useState(localStorage.getItem('nx_station') ?? '')
  const [list, setList] = useState<any[]>([])
  const load = () => api<any>('GET', `/kitchen${station ? `?station=${encodeURIComponent(station)}` : ''}`).then((r) => setList(r.comandas)).catch(() => {})
  useEffect(() => { void load(); const t = setInterval(load, 8_000); return () => clearInterval(t) }, [station])
  const stations = ['', 'cocina', 'cocina_caliente', 'cocina_fria', 'barra', 'postres']
  return (
    <div>
      <div className="tabs">{stations.map((s) => <button key={s} className={station === s ? 'on' : ''} onClick={() => { setStation(s); localStorage.setItem('nx_station', s) }}>{s ? s.replace('_', ' ') : 'Todas'}</button>)}</div>
      <div className="results" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>{list.map((k) => (
        <div key={k.id} className="card" style={{ borderColor: k.minutes >= 20 ? 'var(--danger)' : k.minutes >= 10 ? 'var(--accent)' : 'var(--line)', borderWidth: 3 }}>
          <h2>{k.where}</h2>
          <p className="muted">{k.station} · hace {k.minutes} min</p>
          <ul style={{ fontSize: '1.2rem' }}>{k.items.map((i: any, n: number) => <li key={n}><b>{i.quantity}</b> {i.description}{i.notes ? ` — ${i.notes}` : ''}</li>)}</ul>
          <button className="primary big" style={{ width: '100%' }} onClick={async () => { await api('POST', `/comandas/${k.id}/ready`); void load() }}>Lista</button>
        </div>
      ))}</div>
      {list.length === 0 && <p className="card muted">Sin comandas pendientes.</p>}
    </div>
  )
}

/** Pedidos para llevar y para recoger: número de pedido y estados. Se cobran al hacerlos. */
export function Pedidos({ me }: { me: Me }) {
  const [tabs, setTabs] = useState<any[]>([])
  const [tab, setTab] = useState<any>(null)
  const [f, setF] = useState({ kind: 'llevar', name: '', phone: '' })
  const [err, setErr] = useState('')
  const load = async () => setTabs((await api<any>('GET', '/tabs')).tabs.filter((t: any) => t.kind !== 'mesa'))
  useEffect(() => { void load(); const t = setInterval(load, 10_000); return () => clearInterval(t) }, [])
  if (tab) return <Cuenta me={me} tab={tab} onClose={() => { setTab(null); void load() }} />
  const create = async () => {
    try { setTab((await api<any>('POST', '/tabs', { id: crypto.randomUUID(), kind: f.kind, customerName: f.name || undefined, phone: f.phone || undefined })).tab) } catch (e) { setErr((e as Error).message) }
  }
  const notice = async (t: any) => { const r = await api<any>('GET', `/tabs/${t.id}/notice`); if (r.whatsapp) window.open(r.whatsapp, '_blank'); else alert(r.message) }
  const STATE: Record<string, string> = { recibido: 'Recibido', en_cocina: 'En cocina', listo: 'Listo', entregado: 'Entregado' }
  return (
    <div className="grid2">
      <section className="card">
        <h2>Nuevo pedido</h2>
        <div className="tabs"><button className={f.kind === 'llevar' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'llevar' })}>Para llevar</button><button className={f.kind === 'recoger' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'recoger' })}>Para recoger</button></div>
        <div className="row"><label>Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label><label>Teléfono<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label></div>
        {err && <p className="error">{err}</p>}
        <p><button className="primary big" style={{ width: '100%' }} onClick={create}>Tomar pedido</button></p>
      </section>
      <section className="card">
        <h2>Pedidos</h2>
        <table className="list"><tbody>{tabs.map((t) => (
          <tr key={t.id}>
            <td><b>#{t.orderNumber}</b> {t.customerName ?? ''}<br /><small className="muted">{STATE[t.orderStatus] ?? t.orderStatus} · {t.kind}{t.pending ? ` · por cobrar ${mxn(t.pending)}` : ''}</small></td>
            <td>
              <button onClick={() => setTab(t)}>Abrir</button>
              {t.orderStatus === 'listo' && <button onClick={() => notice(t)}>Avisar</button>}
              {t.orderStatus === 'listo' && <button className="primary" onClick={async () => { await api('POST', `/tabs/${t.id}/deliver`); void load() }}>Entregado</button>}
            </td>
          </tr>
        ))}</tbody></table>
      </section>
    </div>
  )
}
