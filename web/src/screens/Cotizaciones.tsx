import { useEffect, useState } from 'react'
import { ScanButton } from '../Scanner'
import { api, mxn } from '../api'
import type { Me } from '../App'
import type { Product } from './Caja'

interface Row { productId?: string; presentationId?: string; name: string; quantity: string; unitPrice?: number }

/** Cotizaciones: no apartan existencia; al convertirse en venta descuentan con el precio cotizado. */
export function Cotizaciones(_: { me: Me }) {
  const [catalog, setCatalog] = useState<Product[]>([])
  const [quotes, setQuotes] = useState<any[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [customer, setCustomer] = useState('')
  const [find, setFind] = useState('')
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => {
    setCatalog((await api<{ products: Product[] }>('GET', '/products')).products)
    setQuotes((await api<{ quotes: any[] }>('GET', '/quotes')).quotes)
  }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [])
  const matches = find ? catalog.filter((p) => p.name.toLowerCase().includes(find.toLowerCase()) || p.barcode === find).slice(0, 8) : []
  // Lector o cámara: si el código es de un producto o presentación, se agrega directo.
  const byCode = (c: string) => {
    for (const p of catalog) {
      if (p.barcode === c) { setRows((r) => [...r, { productId: p.id, name: p.name, quantity: '1' }]); setFind(''); return }
      const pr = p.presentations.find((x) => x.barcode === c)
      if (pr) { setRows((r) => [...r, { productId: p.id, presentationId: pr.id, name: `${p.name} ${pr.name}`, quantity: '1' }]); setFind(''); return }
    }
    setFind(c)
  }
  const save = async () => {
    try {
      const r = await api<any>('POST', '/quotes', { customerName: customer || undefined, items: rows.map((r) => ({ productId: r.productId, presentationId: r.presentationId, quantity: Number(r.quantity) })) })
      setMsg({ ok: `Cotización #${r.quote.folio} por ${mxn(r.quote.total)}, válida hasta ${r.quote.validUntil}.` })
      setRows([]); setCustomer('')
      void load()
    } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const convert = async (q: any) => {
    const method = prompt('Forma de pago (efectivo, transferencia, tarjeta, fiado):', 'efectivo')
    if (!method) return
    try {
      const r = await api<any>('POST', `/quotes/${q.id}/convert`, { paymentMethod: method.trim().toLowerCase(), customerId: q.customerId ?? undefined })
      setMsg({ ok: `Vendida: folio ${r.sale.folio} por ${mxn(r.sale.total)}.` })
      void load()
    } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  return (
    <div className="grid2">
      <section className="card">
        <h2>Nueva cotización</h2>
        <label>Cliente<input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Nombre o empresa" /></label>
        <label>Agregar producto</label>
        <div className="row"><input aria-label="Agregar producto" value={find} onChange={(e) => setFind(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') byCode(find.trim()) }} placeholder="Busca o escanea…" /><ScanButton onCode={byCode} /></div>
        <div className="results">
          {matches.map((p) => <button key={p.id} onClick={() => { setRows([...rows, { productId: p.id, name: p.name, quantity: '1' }]); setFind('') }}>{p.name}<small>{mxn(p.price)}</small></button>)}
          {matches.flatMap((p) => p.presentations.map((pr) => <button key={pr.id} onClick={() => { setRows([...rows, { productId: p.id, presentationId: pr.id, name: `${p.name} ${pr.name}`, quantity: '1' }]); setFind('') }}>{p.name} {pr.name}<small>{mxn(pr.price)}</small></button>))}
        </div>
        <div className="table-wrap"><table className="list"><tbody>{rows.map((r, i) => (
          <tr key={i}><td>{r.name}</td><td style={{ width: 120 }}><input aria-label={`Cantidad de ${r.name}`} inputMode="decimal" value={r.quantity} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} /></td><td><button onClick={() => setRows(rows.filter((_, j) => j !== i))}>Quitar</button></td></tr>
        ))}</tbody></table></div>
        {msg.err && <p className="error">{msg.err}</p>}
        {msg.ok && <p className="okmsg">{msg.ok}</p>}
        <p><button className="primary big" style={{ width: '100%' }} disabled={!rows.length || rows.some((r) => !(Number(r.quantity) > 0))} onClick={save}>Guardar cotización</button></p>
      </section>
      <section className="card">
        <h2>Cotizaciones abiertas</h2>
        <div className="table-wrap"><table className="list"><tbody>{quotes.map((q) => (
          <tr key={q.id}><td>#{q.folio} {q.customerName ?? ''}<br /><small className="muted">vence {q.validUntil} · {q.items.length} renglones</small></td><td className="num">{mxn(q.total)}</td><td><button className="primary" onClick={() => convert(q)}>Vender</button></td></tr>
        ))}</tbody></table></div>
      </section>
    </div>
  )
}
