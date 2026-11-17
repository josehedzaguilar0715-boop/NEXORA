import { useEffect, useState } from 'react'
import { api, mxn, toCents } from '../api'
import type { Me } from '../App'

/** Precio del día: se actualiza al abrir, en una sola lista, con código. */
export function PrecioDia(_: { me: Me }) {
  const [products, setProducts] = useState<any[]>([])
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => setProducts((await api<any>('GET', '/products')).products.filter((p: any) => p.active && p.sellable !== false))
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [])
  const save = async () => {
    const list = Object.entries(prices).filter(([, v]) => v.trim() !== '').map(([productId, v]) => ({ productId, price: toCents(v) }))
    const code = prompt('Código de autorización:')
    if (!code) return
    try { const r = await api<any>('POST', '/daily-prices', { prices: list, authCode: code }); setMsg({ ok: `Precios actualizados: ${r.changed.length}.` }); setPrices({}); void load() } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  return (
    <div className="card" style={{ maxWidth: 820 }}>
      <h2>Precio del día</h2>
      <div className="table-wrap"><table className="list"><thead><tr><th>Producto</th><th className="num">Ayer</th><th>Hoy</th></tr></thead>
        <tbody>{products.map((p) => (
          <tr key={p.id}><td>{p.name}<br /><small className="muted">por {p.unit}</small></td><td className="num">{mxn(p.price)}</td>
            <td style={{ width: 180 }}><input aria-label={`Precio de hoy ${p.name}`} inputMode="decimal" placeholder={(p.price / 100).toFixed(2)} value={prices[p.id] ?? ''} onChange={(e) => setPrices({ ...prices, [p.id]: e.target.value })} /></td></tr>
        ))}</tbody></table></div>
      {msg.err && <p className="error">{msg.err}</p>}
      {msg.ok && <p className="okmsg">{msg.ok}</p>}
      <p><button className="primary big" style={{ width: '100%' }} disabled={!Object.values(prices).some((v) => v.trim())} onClick={save}>Guardar precios</button></p>
    </div>
  )
}

/** Cierre del día: merma con motivo (con código) y conteo rápido para cuadrar. */
export function CierreDia(_: { me: Me }) {
  const [products, setProducts] = useState<any[]>([])
  const [waste, setWaste] = useState<Record<string, { q: string; r: string }>>({})
  const [count, setCount] = useState<Record<string, string>>({})
  const [result, setResult] = useState<any[] | null>(null)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => setProducts((await api<any>('GET', '/products')).products.filter((p: any) => p.active && p.sellable !== false))
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [])
  const saveWaste = async () => {
    const items = Object.entries(waste).filter(([, v]) => Number(v.q) > 0).map(([productId, v]) => ({ productId, quantity: Number(v.q), reason: v.r || 'Merma del día' }))
    const code = prompt('Código de autorización:')
    if (!code) return
    try { const r = await api<any>('POST', '/inventory/waste-batch', { items, authCode: code }); setMsg({ ok: `Merma registrada: ${mxn(r.cost)}.` }); setWaste({}); void load() } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const saveCount = async () => {
    try {
      const r = await api<any>('POST', '/inventory/count-batch', { reason: 'Conteo de cierre', items: Object.entries(count).filter(([, v]) => v.trim() !== '').map(([productId, v]) => ({ productId, counted: Number(v) })) })
      setResult(r.items); setCount({}); void load()
    } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  return (
    <div className="grid2">
      <section className="card">
        <h2>Merma del día</h2>
        <div className="table-wrap"><table className="list"><tbody>{products.map((p) => (
          <tr key={p.id}><td>{p.name}</td>
            <td style={{ width: 110 }}><input aria-label={`Merma ${p.name}`} inputMode="decimal" placeholder={p.unit} value={waste[p.id]?.q ?? ''} onChange={(e) => setWaste({ ...waste, [p.id]: { q: e.target.value, r: waste[p.id]?.r ?? '' } })} /></td>
            <td><input aria-label={`Motivo ${p.name}`} placeholder="Motivo" value={waste[p.id]?.r ?? ''} onChange={(e) => setWaste({ ...waste, [p.id]: { q: waste[p.id]?.q ?? '', r: e.target.value } })} /></td></tr>
        ))}</tbody></table></div>
        <p><button className="primary" disabled={!Object.values(waste).some((v) => Number(v.q) > 0)} onClick={saveWaste}>Registrar merma</button></p>
      </section>
      <section className="card">
        <h2>Conteo rápido</h2>
        <div className="table-wrap"><table className="list"><tbody>{products.map((p) => (
          <tr key={p.id}><td>{p.name}<br /><small className="muted">debe haber {p.stock} {p.unit}</small></td>
            <td style={{ width: 140 }}><input aria-label={`Contado ${p.name}`} inputMode="decimal" value={count[p.id] ?? ''} onChange={(e) => setCount({ ...count, [p.id]: e.target.value })} /></td></tr>
        ))}</tbody></table></div>
        <p><button className="primary" disabled={!Object.values(count).some((v) => v.trim())} onClick={saveCount}>Guardar conteo</button></p>
        {result && <div className="table-wrap"><table className="list"><tbody>{result.map((r) => <tr key={r.productId}><td>{r.name}</td><td className="num" style={{ color: r.difference ? 'var(--danger)' : 'var(--ok)' }}>{r.difference > 0 ? '+' : ''}{r.difference}</td><td className="num">{mxn(r.cost)}</td></tr>)}</tbody></table></div>}
        {msg.err && <p className="error">{msg.err}</p>}
        {msg.ok && <p className="okmsg">{msg.ok}</p>}
      </section>
    </div>
  )
}
