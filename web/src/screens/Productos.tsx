import { useEffect, useState } from 'react'
import { api, mxn, toCents } from '../api'
import { can, type Me } from '../App'
import type { Product } from './Caja'

type P = Product & { attrs?: Record<string, any>; sellable?: boolean; minStock: number; lastCost: number; suggestedPrice: number | null; categoryId: string | null; version: number }

export function Productos({ me }: { me: Me }) {
  const [list, setList] = useState<P[]>([])
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<P | 'nuevo' | null>(null)
  const [alerts, setAlerts] = useState<{ low: any[]; expiring: any[] }>({ low: [], expiring: [] })
  const [err, setErr] = useState('')
  const load = async () => {
    try {
      setList((await api<{ products: P[] }>('GET', `/products${q ? `?q=${encodeURIComponent(q)}` : ''}`)).products)
      const [low, exp] = await Promise.all([api('GET', '/inventory/low-stock'), api('GET', '/inventory/expiring?days=7')])
      setAlerts({ low: (low as any).products, expiring: (exp as any).lots })
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  useEffect(() => { void load() }, [q])

  return (
    <div className="grid2">
      <section className="card">
        <div className="row">
          <input placeholder="Buscar producto o código…" value={q} onChange={(e) => setQ(e.target.value)} />
          {can(me, 'configure_catalog') && <button className="primary" style={{ flex: '0 0 auto' }} onClick={() => setEdit('nuevo')}>Nuevo producto</button>}
        </div>
        {err && <p className="error">{err}</p>}
        <table className="list">
          <thead><tr><th>Producto</th><th className="num">Precio</th><th className="num">Hay</th><th className="num">Costo</th></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} onClick={() => can(me, 'configure_catalog') && setEdit(p)} style={{ cursor: 'pointer' }}>
                <td>{p.name}<br /><small className="muted">{p.barcode ?? 'sin código'} · {p.unit}</small></td>
                <td className="num">{mxn(p.price)}</td>
                <td className="num" style={{ color: (p.stock ?? 0) < p.minStock ? 'var(--danger)' : undefined }}>{p.stock}</td>
                <td className="num">{p.lastCost ? mxn(Math.round(p.lastCost)) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <div className="card">
          <h2>Por surtir</h2>
          {alerts.low.length === 0 ? <p className="muted">Nada por debajo del mínimo.</p> : (
            <table className="list"><tbody>{alerts.low.map((a) => <tr key={a.id}><td>{a.name}</td><td className="num">hay {a.stock} / mín. {a.minStock}</td><td className="num">{mxn(a.restockCost)}</td></tr>)}</tbody></table>
          )}
        </div>
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Por caducar (7 días)</h2>
          {alerts.expiring.length === 0 ? <p className="muted">Nada por caducar.</p> : (
            <table className="list"><tbody>{alerts.expiring.map((a) => <tr key={a.lotId}><td>{a.name}</td><td>{a.expiresAt.slice(0, 10)}{a.expired ? ' (vencido)' : ''}</td><td className="num">{a.remaining}</td></tr>)}</tbody></table>
          )}
        </div>
      </section>
      {edit && <Editor me={me} p={edit === 'nuevo' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load() }} />}
    </div>
  )
}

function Editor({ me, p, onClose, onSaved }: { me: Me; p: P | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: p?.name ?? '', barcode: p?.barcode ?? '', unit: p?.unit ?? 'pieza', price: p ? String(p.price / 100) : '', minStock: String(p?.minStock ?? 0), authCode: '', waste: '', wasteReason: '', brand: p?.attrs?.brand ?? '', fragrance: p?.attrs?.fragrance ?? '', sizeMl: p?.attrs?.sizeMl ? String(p.attrs.sizeMl) : '', presentation: p?.attrs?.presentation ?? 'regular' })
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const perfume = me.business.giro === 'perfumeria'
  const attrs = perfume ? { brand: f.brand || undefined, fragrance: f.fragrance || undefined, sizeMl: Number(f.sizeMl) || undefined, presentation: f.presentation } : undefined
  const priceChanged = p && toCents(f.price) !== p.price
  const save = async () => {
    try {
      if (!p) await api('POST', '/products', { name: f.name, barcode: f.barcode || null, unit: f.unit, price: toCents(f.price), minStock: Number(f.minStock) || 0, ...(attrs ? { attrs, sellable: !['tester', 'muestra', 'envase'].includes(f.presentation) } : {}) })
      else await api('PATCH', `/products/${p.id}`, { name: f.name, barcode: f.barcode || null, price: toCents(f.price), minStock: Number(f.minStock) || 0, ...(attrs ? { attrs } : {}), ...(priceChanged ? { authCode: f.authCode } : {}), baseVersion: p.version, updatedAt: new Date().toISOString() })
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const waste = async () => {
    try {
      await api('POST', '/inventory/waste', { productId: p!.id, quantity: Number(f.waste), reason: f.wasteReason })
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <div className="modal" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2>{p ? p.name : 'Nuevo producto'}</h2>
        <label>Nombre<input value={f.name} onChange={set('name')} autoFocus /></label>
        <label>Código de barras<input value={f.barcode} onChange={set('barcode')} placeholder="Escanéalo aquí" /></label>
        {perfume && (<>
          <div className="row"><label>Marca<input value={f.brand} onChange={set('brand')} /></label><label>Fragancia<input value={f.fragrance} onChange={set('fragrance')} /></label></div>
          <div className="row"><label>Mililitros<input inputMode="numeric" value={f.sizeMl} onChange={set('sizeMl')} /></label>
            <label>Presentación<select value={f.presentation} onChange={set('presentation')}><option value="regular">Regular</option><option value="decant">Decant</option><option value="set">Set</option><option value="tester">Tester (uso interno)</option><option value="muestra">Muestra (uso interno)</option><option value="envase">Envase (uso interno)</option></select></label></div>
        </>)}
        {!p && (<><label>Se vende por<select value={f.unit} onChange={set('unit')}><option value="pieza">Pieza</option><option value="kg">Kilo (granel)</option><option value="litro">Litro</option><option value="metro">Metro</option></select></label></>)}
        <div className="row">
          <div><label>Precio de venta<input inputMode="decimal" value={f.price} onChange={set('price')} /></label></div>
          <div><label>Mínimo en existencia<input inputMode="decimal" value={f.minStock} onChange={set('minStock')} /></label></div>
        </div>
        {p?.suggestedPrice != null && <p className="muted">Precio sugerido por margen: {mxn(p.suggestedPrice)}</p>}
        {priceChanged && (<><label>Código de autorización (cambio de precio)<input type="password" value={f.authCode} onChange={set('authCode')} /></label></>)}
        {err && <p className="error">{err}</p>}
        <p className="row"><button onClick={onClose}>Cancelar</button><button className="primary" onClick={save}>Guardar</button></p>
        {p && ['ferreteria', 'papeleria'].includes(me.business.giro) && <Escalas p={p} />}
        {p && perfume && p.attrs?.sizeMl >= 30 && <Decants p={p} onDone={onSaved} />}
        {p && can(me, 'edit_inventory') && (
          <div style={{ borderTop: '2px solid var(--line)', marginTop: 12 }}>
            <h3 style={{ marginTop: 12 }}>Registrar merma</h3>
            <div className="row">
              <input inputMode="decimal" placeholder="Cantidad" value={f.waste} onChange={set('waste')} />
              <input placeholder="Motivo" value={f.wasteReason} onChange={set('wasteReason')} />
            </div>
            <p><button disabled={!(Number(f.waste) > 0 && f.wasteReason.trim().length >= 3)} onClick={waste}>Registrar merma</button></p>
          </div>
        )}
      </div>
    </div>
  )
}

/** Escalas de precio por volumen (la caja las aplica sola). */
function Escalas({ p }: { p: P }) {
  const [tiers, setTiers] = useState<{ minQuantity: string; price: string }[]>([])
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api<any>('GET', `/products/${p.id}/price-tiers`).then((r) => setTiers(r.tiers.map((t: any) => ({ minQuantity: String(t.minQuantity), price: String(t.price / 100) })))).catch(() => {})
  }, [p.id])
  const save = async () => {
    try {
      await api('PUT', `/products/${p.id}/price-tiers`, { tiers: tiers.filter((t) => Number(t.minQuantity) > 0).map((t) => ({ minQuantity: Number(t.minQuantity), price: toCents(t.price) })) })
      setMsg('Escalas guardadas.')
    } catch (e) { setMsg((e as Error).message) }
  }
  return (
    <div style={{ borderTop: '2px solid var(--line)', marginTop: 12 }}>
      <h3 style={{ marginTop: 12 }}>Precio por volumen</h3>
      {tiers.map((t, i) => (
        <div className="row" key={i}>
          <input aria-label="Desde cantidad" inputMode="decimal" placeholder="Desde (cantidad)" value={t.minQuantity} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, minQuantity: e.target.value } : x)))} />
          <input aria-label="Precio por unidad" inputMode="decimal" placeholder="Precio c/u" value={t.price} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
        </div>
      ))}
      <p className="row"><button onClick={() => setTiers([...tiers, { minQuantity: '', price: '' }])}>+ Escala</button><button className="primary" onClick={save}>Guardar escalas</button></p>
      {msg && <p className="muted">{msg}</p>}
    </div>
  )
}

/** Perfumería: fraccionar este frasco en decants. */
function Decants({ p, onDone }: { p: P; onDone: () => void }) {
  const [targets, setTargets] = useState<P[]>([])
  const [f, setF] = useState({ targetId: '', quantity: '1' })
  const [msg, setMsg] = useState('')
  useEffect(() => {
    api<{ products: P[] }>('GET', `/products?q=${encodeURIComponent(p.attrs?.fragrance ?? '')}`).then((r) => {
      const t = r.products.filter((x) => x.id !== p.id && x.attrs?.presentation === 'decant')
      setTargets(t)
      setF((v) => ({ ...v, targetId: t[0]?.id ?? '' }))
    }).catch(() => {})
  }, [p.id])
  const run = async () => {
    try {
      const r = await api<any>('POST', '/decants', { sourceProductId: p.id, targetProductId: f.targetId, quantity: Number(f.quantity) })
      setMsg(`Listo: ${r.quantity} decants (${r.ml} ml), costo ${mxn(r.unitCost)} c/u.`)
      onDone()
    } catch (e) { setMsg((e as Error).message) }
  }
  return (
    <div style={{ borderTop: '2px solid var(--line)', marginTop: 12 }}>
      <h3 style={{ marginTop: 12 }}>Hacer decants</h3>
      {targets.length === 0 ? <p className="muted">Da de alta el decant (misma fragancia, presentación "Decant" y sus ml).</p> : (
        <div className="row">
          <label>Decant<select value={f.targetId} onChange={(e) => setF({ ...f, targetId: e.target.value })}>{targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label style={{ flex: '0 0 140px' }}>Cuántos<input inputMode="numeric" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></label>
        </div>
      )}
      <p><button disabled={!f.targetId || !(Number(f.quantity) > 0)} onClick={run}>Fraccionar</button></p>
      {msg && <p className="muted">{msg}</p>}
    </div>
  )
}
