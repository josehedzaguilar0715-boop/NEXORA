import { useEffect, useState } from 'react'
import { ScanButton } from '../Scanner'
import { api, mxn, toCents } from '../api'
import type { Me } from '../App'
import type { Product } from './Caja'

interface Row { productId: string; name: string; quantity: string; cost: string; newPrice: string; expiresAt: string }

/** Captura de una compra desde su ticket: cada renglón es un lote; los fletes se reparten solos. */
export function Compras(_: { me: Me }) {
  const [catalog, setCatalog] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([])
  const [payables, setPayables] = useState<{ payables: any[]; total: number }>({ payables: [], total: 0 })
  const [rows, setRows] = useState<Row[]>([])
  const [freight, setFreight] = useState<{ concept: string; amount: string }[]>([])
  const [head, setHead] = useState({ supplierId: '', ticketRef: '', payment: 'contado', paidFromCash: false, dueDate: '' })
  const [find, setFind] = useState('')
  const [msg, setMsg] = useState<{ ok?: string; err?: string; result?: any }>({})
  const load = async () => {
    setCatalog((await api<{ products: Product[] }>('GET', '/products')).products)
    setSuppliers((await api<{ suppliers: any[] }>('GET', '/suppliers')).suppliers)
    setPayables(await api('GET', '/payables'))
  }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [])

  const add = (p: Product) => { setRows([...rows, { productId: p.id, name: p.name, quantity: '', cost: '', newPrice: '', expiresAt: '' }]); setFind('') }
  const upd = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  const total = rows.reduce((a, r) => a + (toCents(r.cost) || 0), 0) + freight.reduce((a, f) => a + (toCents(f.amount) || 0), 0)

  const save = async () => {
    try {
      const r = await api('POST', '/purchases', {
        id: crypto.randomUUID(), supplierId: head.supplierId || undefined, ticketRef: head.ticketRef || undefined, payment: head.payment,
        paidFromCash: head.payment === 'contado' && head.paidFromCash, dueDate: head.payment === 'credito' && head.dueDate ? head.dueDate : undefined,
        freight: freight.filter((f) => toCents(f.amount) > 0).map((f) => ({ concept: f.concept || 'Flete', amount: toCents(f.amount) })),
        items: rows.map((r) => ({ productId: r.productId, quantity: Number(r.quantity), cost: toCents(r.cost), ...(r.newPrice ? { newPrice: toCents(r.newPrice) } : {}), ...(r.expiresAt ? { expiresAt: r.expiresAt } : {}) })),
      })
      setMsg({ ok: 'Compra guardada.', result: r })
      setRows([]); setFreight([])
      void load()
    } catch (e) {
      setMsg({ err: (e as Error).message })
    }
  }
  const newSupplier = async () => {
    const name = prompt('Nombre del proveedor:')
    if (!name) return
    const r = await api<{ id: string }>('POST', '/suppliers', { name })
    await load()
    setHead({ ...head, supplierId: r.id })
  }
  const pay = async (id: string, balance: number) => {
    const a = prompt(`Abono (saldo ${mxn(balance)}):`)
    if (!a) return
    try {
      await api('POST', `/purchases/${id}/payments`, { amount: toCents(a), method: 'transferencia' })
      void load()
    } catch (e) { setMsg({ err: (e as Error).message }) }
  }

  const matches = find ? catalog.filter((p) => p.name.toLowerCase().includes(find.toLowerCase()) || p.barcode === find).slice(0, 8) : []
  return (
    <div className="grid2">
      <section className="card">
        <h2>Nueva compra</h2>
        <div className="row">
          <div><label>Proveedor<select value={head.supplierId} onChange={(e) => setHead({ ...head, supplierId: e.target.value })}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
          <button style={{ flex: '0 0 auto', alignSelf: 'end' }} onClick={newSupplier}>+ Proveedor</button>
        </div>
        <label>Folio del ticket<input value={head.ticketRef} onChange={(e) => setHead({ ...head, ticketRef: e.target.value })} /></label>
        <label>Agregar producto</label>
        <div className="row"><input aria-label="Agregar producto" value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { const p = catalog.find((x) => x.barcode === find.trim()); if (p) add(p) } }} placeholder="Busca o escanea…" /><ScanButton onCode={(c) => { const p = catalog.find((x) => x.barcode === c); if (p) add(p); else setFind(c) }} /></div>
        <div className="results">{matches.map((p) => <button key={p.id} onClick={() => add(p)}>{p.name}</button>)}</div>
        {rows.map((r, i) => (
          <div key={i} className="card" style={{ marginTop: 10 }}>
            <b>{r.name}</b>
            <div className="row">
              <div><label>Cantidad<input inputMode="decimal" value={r.quantity} onChange={(e) => upd(i, 'quantity', e.target.value)} /></label></div>
              <div><label>Costo total<input inputMode="decimal" value={r.cost} onChange={(e) => upd(i, 'cost', e.target.value)} /></label></div>
            </div>
            <div className="row">
              <div><label>Precio nuevo (opcional)<input inputMode="decimal" value={r.newPrice} onChange={(e) => upd(i, 'newPrice', e.target.value)} /></label></div>
              <div><label>Caduca (opcional)<input type="date" value={r.expiresAt} onChange={(e) => upd(i, 'expiresAt', e.target.value)} /></label></div>
            </div>
            <button onClick={() => setRows(rows.filter((_, j) => j !== i))}>Quitar</button>
          </div>
        ))}
        <h3 style={{ marginTop: 14 }}>Fletes y gastos de traslado</h3>
        {freight.map((f, i) => (
          <div key={i} className="row">
            <input placeholder="Gasolina, casetas…" value={f.concept} onChange={(e) => setFreight(freight.map((x, j) => (j === i ? { ...x, concept: e.target.value } : x)))} />
            <input inputMode="decimal" placeholder="$0.00" value={f.amount} onChange={(e) => setFreight(freight.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
          </div>
        ))}
        <button onClick={() => setFreight([...freight, { concept: '', amount: '' }])}>+ Flete</button>
        <div className="row" style={{ marginTop: 12 }}>
          <div><label>Pago<select value={head.payment} onChange={(e) => setHead({ ...head, payment: e.target.value })}><option value="contado">Contado</option><option value="credito">Crédito</option></select></label></div>
          {head.payment === 'contado' ? <label style={{ alignSelf: 'end' }}><input type="checkbox" style={{ width: 'auto', minHeight: 0 }} checked={head.paidFromCash} onChange={(e) => setHead({ ...head, paidFromCash: e.target.checked })} /> Sale de la caja</label>
            : <div><label>Vence<input type="date" value={head.dueDate} onChange={(e) => setHead({ ...head, dueDate: e.target.value })} /></label></div>}
        </div>
        <div className="total">{mxn(total)}</div>
        {msg.err && <p className="error">{msg.err}</p>}
        {msg.ok && <p className="okmsg">{msg.ok}</p>}
        <button className="primary big" style={{ width: '100%' }} disabled={!rows.length || rows.some((r) => !(Number(r.quantity) > 0) || r.cost === '')} onClick={save}>Guardar compra</button>
      </section>
      <section>
        {msg.result && (
          <div className="card">
            <h2>Costo real por producto</h2>
            <div className="table-wrap"><table className="list"><thead><tr><th>Producto</th><th className="num">Flete</th><th className="num">Costo c/u</th><th className="num">Sugerido</th></tr></thead>
              <tbody>{msg.result.items.map((i: any) => <tr key={i.lotId}><td>{i.name}</td><td className="num">{mxn(i.freightShare)}</td><td className="num">{mxn(Math.round(i.unitCost))}</td><td className="num">{i.suggestedPrice != null ? mxn(i.suggestedPrice) : '—'}</td></tr>)}</tbody></table></div>
          </div>
        )}
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Cuentas por pagar · {mxn(payables.total)}</h2>
          <div className="table-wrap"><table className="list"><tbody>{payables.payables.map((p) => <tr key={p.id}><td>{p.supplier ?? 'Sin proveedor'}<br /><small className="muted">{p.ticketRef ?? ''} {p.dueDate ? `vence ${p.dueDate}` : ''}</small></td><td className="num">{mxn(p.balance)}</td><td><button onClick={() => pay(p.id, p.balance)}>Abonar</button></td></tr>)}</tbody></table></div>
        </div>
      </section>
    </div>
  )
}
