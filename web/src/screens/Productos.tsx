import { useEffect, useState } from 'react'
import { ScanButton } from '../Scanner'
import { api, mxn, toCents } from '../api'
import { can, type Me, hasGiro } from '../App'
import type { Product } from './Caja'

type P = Product & { tiers?: { minQuantity: number; price: number }[]; attrs?: Record<string, any>; sellable?: boolean; minStock: number; lastCost: number; suggestedPrice: number | null; categoryId: string | null; version: number; active?: boolean; trackStock?: boolean; trackExpiry?: boolean }

const UNIT: Record<string, string> = { pieza: 'pieza', kg: 'kg', litro: 'litro', metro: 'metro' }
const FOOD = ['palapa', 'restaurante', 'taqueria', 'comedor']
type Filter = 'todos' | 'surtir' | 'caducar' | 'eliminados'

/** Inventario: lista con filtros y editor por secciones (datos, existencia, presentaciones, receta…). */
export function Productos({ me }: { me: Me }) {
  const [list, setList] = useState<P[]>([])
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('todos')
  const [edit, setEdit] = useState<{ p: P | null; tab?: string } | null>(null)
  const [alerts, setAlerts] = useState<{ low: any[]; expiring: any[] }>({ low: [], expiring: [] })
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [err, setErr] = useState('')
  const load = async () => {
    try {
      setList((await api<{ products: P[] }>('GET', `/products${q ? `?q=${encodeURIComponent(q)}` : ''}`)).products)
      const [low, exp, cats] = await Promise.all([api('GET', '/inventory/low-stock'), api('GET', '/inventory/expiring?days=7'), api('GET', '/categories')])
      setAlerts({ low: (low as any).products, expiring: (exp as any).lots })
      setCategories((cats as any).categories)
      setErr('')
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  useEffect(() => { const t = setTimeout(() => void load(), 200); return () => clearTimeout(t) }, [q])
  const lowIds = new Set(alerts.low.map((a) => a.id))
  const expIds = new Set(alerts.expiring.map((a) => a.productId))
  const shown = list.filter((p) => (filter === 'eliminados' ? p.active === false : p.active !== false) && (filter === 'surtir' ? lowIds.has(p.id) : filter === 'caducar' ? expIds.has(p.id) : true))
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name
  const canEdit = can(me, 'configure_catalog')
  const canStock = can(me, 'edit_inventory')
  const counts: Record<Filter, number> = { todos: list.filter((p) => p.active !== false).length, surtir: alerts.low.length, caducar: expIds.size, eliminados: list.filter((p) => p.active === false).length }
  const LABEL: Record<Filter, string> = { todos: 'Todos', surtir: 'Por surtir', caducar: 'Por caducar', eliminados: 'Eliminados' }

  return (
    <div className="page">
      <div className="toolbar">
        <div className="row search"><input aria-label="Buscar producto" placeholder="Buscar por nombre o código…" value={q} onChange={(e) => setQ(e.target.value)} /><ScanButton onCode={(c) => setQ(c)} /></div>
        {canEdit && <button className="primary" onClick={() => setEdit({ p: null })}>+ Nuevo producto</button>}
      </div>
      <div className="seg wrap" role="tablist" style={{ marginBottom: 14 }}>
        {(Object.keys(LABEL) as Filter[]).filter((k) => k !== 'eliminados' || counts.eliminados > 0).map((k) => (
          <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{LABEL[k]}{counts[k] ? ` · ${counts[k]}` : ''}</button>
        ))}
      </div>
      {err && <p className="error">{err}</p>}
      <section className="card">
        <div className="table-wrap" style={{ border: 0, margin: 0 }}>
          <table className="list products">
            <thead><tr><th>Producto</th><th className="num">Precio</th><th className="num">Existencia</th><th className="num hide-sm">Costo</th><th /></tr></thead>
            <tbody>
              {shown.map((p) => {
                const low = lowIds.has(p.id)
                return (
                  <tr key={p.id} className="clickable" onClick={() => setEdit({ p })}>
                    <td><b>{p.name}</b><br /><small className="muted">{[catName(p.categoryId), p.barcode ?? 'sin código', UNIT[p.unit] ?? p.unit].filter(Boolean).join(' · ')}{p.sellable === false ? ' · uso interno' : ''}</small></td>
                    <td className="num">{mxn(p.price)}{p.tiers?.length ? <><br /><small className="muted">mayoreo {mxn(p.tiers[0]!.price)} desde {p.tiers[0]!.minQuantity}</small></> : null}</td>
                    <td className="num">{p.trackStock === false ? <span className="muted">receta</span> : <span className={low ? 'pill bad' : 'pill'}>{p.stock ?? 0}</span>}{(p as P & { reserved?: number }).reserved ? <><br /><small className="muted">{(p as P & { reserved?: number }).reserved} apartados</small></> : null}{expIds.has(p.id) && <><br /><small className="neg">por caducar</small></>}</td>
                    <td className="num hide-sm">{p.lastCost ? mxn(Math.round(p.lastCost)) : '—'}</td>
                    <td className="num">{canStock && p.active !== false && p.trackStock !== false && <button className="mini" onClick={(e) => { e.stopPropagation(); setEdit({ p, tab: 'existencia' }) }}>+ Agregar</button>}</td>
                  </tr>
                )
              })}
              {shown.length === 0 && <tr><td colSpan={5} className="empty">{q ? 'Ningún producto coincide con la búsqueda.' : filter === 'todos' ? 'Todavía no hay productos. Agrega el primero o tráelos de Excel en «Importar datos».' : 'Nada en esta lista.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {edit && <Editor me={me} p={edit.p} tab={edit.tab} categories={categories} onClose={() => setEdit(null)} onSaved={(close = true) => { if (close) setEdit(null); void load() }} />}
    </div>
  )
}

function Editor({ me, p, tab: initialTab, categories, onClose, onSaved }: { me: Me; p: P | null; tab?: string; categories: { id: string; name: string }[]; onClose: () => void; onSaved: (close?: boolean) => void }) {
  const perfume = hasGiro(me, 'perfumeria')
  const food = hasGiro(me, ...FOOD)
  const canEdit = can(me, 'configure_catalog')
  const canStock = can(me, 'edit_inventory')
  const tabs = [
    { key: 'datos', label: 'Datos', show: true },
    { key: 'existencia', label: 'Existencia', show: !!p && canStock && p.trackStock !== false && p.active !== false },
    { key: 'presentaciones', label: 'Presentaciones', show: !!p && canEdit && hasGiro(me, 'abarrotes', 'ferreteria', 'papeleria', 'verduleria', 'perfumeria') },
    { key: 'receta', label: 'Receta', show: !!p && canEdit && food },
    { key: 'escalas', label: 'Precio por volumen', show: !!p && canEdit && hasGiro(me, 'ferreteria', 'papeleria') },
    { key: 'decants', label: 'Decants', show: !!p && canStock && perfume && p.attrs?.sizeMl >= 30 },
  ].filter((t) => t.show)
  const [tab, setTab] = useState(initialTab && tabs.some((t) => t.key === initialTab) ? initialTab : 'datos')
  return (
    <div className="modal" onClick={onClose}>
      <div className="card wide" onClick={(e) => e.stopPropagation()}>
        <div className="card-head"><h2>{p ? p.name : 'Nuevo producto'}</h2><button className="mini" onClick={onClose} aria-label="Cerrar">Cerrar</button></div>
        {tabs.length > 1 && <nav className="subtabs">{tabs.map((t) => <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>{t.label}</button>)}</nav>}
        {tab === 'datos' && <Datos me={me} p={p} categories={categories} onSaved={onSaved} />}
        {tab === 'existencia' && p && <Existencia p={p} onSaved={() => onSaved(false)} />}
        {tab === 'presentaciones' && p && <Presentaciones p={p} onSaved={() => onSaved(false)} />}
        {tab === 'receta' && p && <Receta ownerId={p.id} />}
        {tab === 'escalas' && p && <Escalas p={p} />}
        {tab === 'decants' && p && <Decants p={p} onDone={() => onSaved(false)} />}
      </div>
    </div>
  )
}

function Datos({ me, p, categories, onSaved }: { me: Me; p: P | null; categories: { id: string; name: string }[]; onSaved: (close?: boolean) => void }) {
  const perfume = hasGiro(me, 'perfumeria')
  const food = hasGiro(me, ...FOOD)
  const canEdit = can(me, 'configure_catalog')
  const [f, setF] = useState({
    name: p?.name ?? '', barcode: p?.barcode ?? '', unit: p?.unit ?? 'pieza', price: p ? String(p.price / 100) : '', minStock: String(p?.minStock ?? 0), categoryId: p?.categoryId ?? '',
    authCode: '', brand: p?.attrs?.brand ?? '', fragrance: p?.attrs?.fragrance ?? '', sizeMl: p?.attrs?.sizeMl ? String(p.attrs.sizeMl) : '', presentation: p?.attrs?.presentation ?? 'regular',
    trackStock: p ? p.trackStock !== false : true, trackExpiry: !!p?.trackExpiry, stock: '', cost: '',
    wholesale: p?.tiers?.length === 1 ? String(p.tiers[0]!.price / 100) : '', wholesaleMin: p?.tiers?.length === 1 ? String(p.tiers[0]!.minQuantity) : '',
  })
  const multiTier = (p?.tiers?.length ?? 0) > 1
  const [err, setErr] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const attrs = perfume ? { ...(p?.attrs ?? {}), brand: f.brand || undefined, fragrance: f.fragrance || undefined, sizeMl: Number(f.sizeMl) || undefined, presentation: f.presentation } : undefined
  const priceChanged = !!p && toCents(f.price) !== p.price
  const save = async () => {
    try {
      if (!f.name.trim()) throw new Error('Escribe el nombre del producto.')
      if (f.price.trim() === '' || Number.isNaN(toCents(f.price))) throw new Error('Escribe el precio de venta.')
      const common = { name: f.name, barcode: f.barcode || null, price: toCents(f.price), minStock: Number(f.minStock) || 0, categoryId: f.categoryId || null, trackExpiry: f.trackExpiry, ...(attrs ? { attrs } : {}) }
      const wantTier = f.wholesale.trim() !== '' || f.wholesaleMin.trim() !== ''
      if (wantTier && (!(toCents(f.wholesale) > 0) || !(Number(f.wholesaleMin) > 1))) throw new Error('Para el mayoreo escribe el precio y desde cuántas piezas aplica (2 o más).')
      if (wantTier && toCents(f.wholesale) >= toCents(f.price)) throw new Error('El precio de mayoreo debe ser menor que el de menudeo.')
      const tiersBody = { tiers: wantTier ? [{ minQuantity: Number(f.wholesaleMin), price: toCents(f.wholesale) }] : [] }
      const tiersChanged = !multiTier && JSON.stringify(tiersBody.tiers) !== JSON.stringify((p?.tiers ?? []).map((t) => ({ minQuantity: t.minQuantity, price: t.price })))
      if (!p) {
        const r = await api<{ product: P }>('POST', '/products', { ...common, unit: f.unit, ...(food ? { trackStock: f.trackStock } : {}), ...(attrs ? { sellable: !['tester', 'muestra', 'envase'].includes(f.presentation) } : {}) })
        // Existencia inicial opcional: entra como inventario inicial (sin gasto).
        if (f.trackStock && Number(f.stock) > 0) await api('POST', '/inventory/count', { productId: r.product.id, counted: Number(f.stock), reason: 'Inventario inicial', ...(f.cost.trim() ? { unitCost: toCents(f.cost) } : {}) })
        if (wantTier) await api('PUT', `/products/${r.product.id}/price-tiers`, tiersBody)
      } else {
        await api('PATCH', `/products/${p.id}`, { ...common, ...(priceChanged ? { authCode: f.authCode } : {}), baseVersion: p.version, updatedAt: new Date().toISOString() })
        if (tiersChanged) await api('PUT', `/products/${p.id}/price-tiers`, tiersBody)
      }
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const setActive = async (active: boolean) => {
    try { await api('PATCH', `/products/${p!.id}`, { active, baseVersion: p!.version, updatedAt: new Date().toISOString() }); onSaved() } catch (e) { setErr((e as Error).message) }
  }
  if (p && p.active === false) {
    return (
      <div>
        <p className="muted">Este producto está eliminado: no aparece en la caja ni en la lista. Sus ventas y movimientos se conservan.</p>
        {err && <p className="error">{err}</p>}
        {canEdit && <p><button className="primary" onClick={() => setActive(true)}>Restaurar producto</button></p>}
      </div>
    )
  }
  return (
    <div>
      <label>Nombre<input value={f.name} onChange={set('name')} autoFocus={!p} disabled={!canEdit} /></label>
      <label>Código de barras</label>
      <div className="row"><input aria-label="Código de barras" value={f.barcode} onChange={set('barcode')} onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()} placeholder="Escanéalo o escríbelo" disabled={!canEdit} />{canEdit && <ScanButton onCode={(c) => setF((x) => ({ ...x, barcode: c }))} />}</div>
      {perfume && (<>
        <div className="row"><label>Marca<input value={f.brand} onChange={set('brand')} /></label><label>Fragancia<input value={f.fragrance} onChange={set('fragrance')} /></label></div>
        <div className="row"><label>Mililitros<input inputMode="numeric" value={f.sizeMl} onChange={set('sizeMl')} /></label>
          <label>Presentación<select value={f.presentation} onChange={set('presentation')}><option value="regular">Regular</option><option value="decant">Decant</option><option value="set">Set</option><option value="tester">Tester (uso interno)</option><option value="muestra">Muestra (uso interno)</option><option value="envase">Envase (uso interno)</option></select></label></div>
      </>)}
      <div className="row">
        <label>Precio de venta<input inputMode="decimal" value={f.price} onChange={set('price')} placeholder="$0.00" disabled={!canEdit} /></label>
        {!p ? <label>Se vende por<select value={f.unit} onChange={set('unit')}><option value="pieza">Pieza</option><option value="kg">Kilo (granel)</option><option value="litro">Litro</option><option value="metro">Metro</option></select></label>
          : <label>Categoría<select value={f.categoryId} onChange={set('categoryId')} disabled={!canEdit}><option value="">Sin categoría</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      </div>
      {!p && <label>Categoría<select value={f.categoryId} onChange={set('categoryId')}><option value="">Sin categoría</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      {p?.suggestedPrice != null && <p className="muted small">Precio sugerido por margen: {mxn(p.suggestedPrice)}</p>}
      {multiTier ? <p className="muted small">Tiene {p!.tiers!.length} precios por volumen; se editan en «Precio por volumen».</p> : (
        <div className="row">
          <label>Precio de mayoreo (opcional)<input inputMode="decimal" value={f.wholesale} onChange={set('wholesale')} placeholder="$0.00" disabled={!canEdit} /></label>
          <label>A partir de cuántas{f.unit !== 'pieza' ? ` (${UNIT[f.unit]})` : ''}<input inputMode="decimal" value={f.wholesaleMin} onChange={set('wholesaleMin')} placeholder="Ej. 12" disabled={!canEdit} /></label>
        </div>
      )}
      {priceChanged && <label>Código de autorización (cambio de precio)<input type="password" value={f.authCode} onChange={set('authCode')} /></label>}
      {!p && food && <label className="check"><input type="checkbox" checked={!f.trackStock} onChange={(e) => setF({ ...f, trackStock: !e.target.checked })} />Es un platillo o bebida preparada (no lleva existencia; descuenta su receta)</label>}
      {f.trackStock && (
        <div className="row">
          <label>Avisar cuando queden menos de<input inputMode="decimal" value={f.minStock} onChange={set('minStock')} disabled={!canEdit} /></label>
          {!p && <label>Existencia inicial (opcional)<input inputMode="decimal" value={f.stock} onChange={set('stock')} placeholder="0" /></label>}
        </div>
      )}
      {!p && f.trackStock && Number(f.stock) > 0 && <label>Costo por unidad (opcional)<input inputMode="decimal" value={f.cost} onChange={set('cost')} placeholder="$0.00" /></label>}
      {f.trackStock && <label className="check"><input type="checkbox" checked={f.trackExpiry} onChange={(e) => setF({ ...f, trackExpiry: e.target.checked })} disabled={!canEdit} />Tiene caducidad (se pide la fecha al comprar)</label>}
      {err && <p className="error">{err}</p>}
      {canEdit && <p className="row"><button className="primary" onClick={save}>{p ? 'Guardar cambios' : 'Agregar producto'}</button></p>}
      {p && canEdit && (
        <div className="danger-zone">
          {!confirmDel ? <button className="link-danger" onClick={() => setConfirmDel(true)}>Eliminar producto</button> : (
            <div>
              <p><b>¿Eliminar «{p.name}»?</b> Ya no aparecerá en la caja ni en la lista. Sus ventas y movimientos se conservan, y puedes restaurarlo desde «Eliminados».</p>
              <p className="row"><button onClick={() => setConfirmDel(false)}>No, regresar</button><button className="danger" onClick={() => setActive(false)}>Sí, eliminar</button></p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Existencia: agregar mercancía (compra o inventario que ya tenía), ajustar al conteo físico y mermas. */
function Existencia({ p, onSaved }: { p: P; onSaved: () => void }) {
  const [mode, setMode] = useState<'agregar' | 'ajustar' | 'merma'>('agregar')
  const [f, setF] = useState({ qty: '', bought: true, unitCost: p.lastCost ? String(Math.round(p.lastCost) / 100) : '', fromCash: false, expiresAt: '', counted: '', reason: '' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const [stock, setStock] = useState<number>(p.stock ?? 0)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const refresh = async () => setStock((await api<{ product: P }>('GET', `/products/${p.id}`)).product.stock ?? 0)
  const go = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); await refresh(); setF({ ...f, qty: '', counted: '', reason: '' }); setMsg({ ok }); onSaved() } catch (e) { setMsg({ err: (e as Error).message }) } }
  const qty = Number(f.qty)
  return (
    <div>
      <div className="info-row" style={{ marginTop: 0 }}><span className="muted">Hay ahora</span><b>{stock} {UNIT[p.unit] ?? p.unit}{stock === 1 || p.unit !== 'pieza' ? '' : 's'}</b></div>
      <div className="tabs" style={{ marginTop: 12 }}>
        <button className={mode === 'agregar' ? 'on' : ''} onClick={() => setMode('agregar')}>Agregar</button>
        <button className={mode === 'ajustar' ? 'on' : ''} onClick={() => setMode('ajustar')}>Ajustar al conteo</button>
        <button className={mode === 'merma' ? 'on' : ''} onClick={() => setMode('merma')}>Merma</button>
      </div>
      {mode === 'agregar' && (<>
        <label>¿Cuánto agregas?<input inputMode="decimal" value={f.qty} onChange={set('qty')} autoFocus placeholder="Ej. 24" /></label>
        <div className="tabs">
          <button className={f.bought ? 'on' : ''} onClick={() => setF({ ...f, bought: true })}>La compré ahora</button>
          <button className={!f.bought ? 'on' : ''} onClick={() => setF({ ...f, bought: false })}>Ya la tenía</button>
        </div>
        {f.bought ? (<>
          <div className="row">
            <label>Costo por {UNIT[p.unit] ?? 'unidad'}<input inputMode="decimal" value={f.unitCost} onChange={set('unitCost')} placeholder="$0.00" /></label>
            {p.trackExpiry && <label>Caduca el<input type="date" value={f.expiresAt} onChange={set('expiresAt')} /></label>}
          </div>
          {qty > 0 && toCents(f.unitCost) > 0 && <p className="muted small">Total de la compra: <b>{mxn(Math.round(qty * toCents(f.unitCost)))}</b>. Se registra como compra pagada.</p>}
          <label className="check"><input type="checkbox" checked={f.fromCash} onChange={(e) => setF({ ...f, fromCash: e.target.checked })} />La pagué con dinero de la caja abierta</label>
        </>) : (<>
          <p className="muted small">Se suma a la existencia sin registrar gasto (por ejemplo, el inventario con el que empiezas).</p>
          <label>Costo por {UNIT[p.unit] ?? 'unidad'} (opcional, para valuar el inventario)<input inputMode="decimal" value={f.unitCost} onChange={set('unitCost')} placeholder="$0.00" /></label>
        </>)}
        {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
        <p><button className="primary" disabled={!(qty > 0) || (f.bought && !(toCents(f.unitCost) >= 0 && f.unitCost.trim()))} onClick={() => go(() => f.bought
          ? api('POST', '/purchases', { payment: 'contado', paidFromCash: f.fromCash, items: [{ productId: p.id, quantity: qty, cost: Math.round(qty * toCents(f.unitCost)), ...(f.expiresAt ? { expiresAt: f.expiresAt } : {}) }] })
          : api('POST', '/inventory/count', { productId: p.id, counted: stock + qty, reason: 'Mercancía agregada (ya la tenía)', ...(f.unitCost.trim() ? { unitCost: toCents(f.unitCost) } : {}) }), `Listo: se agregaron ${qty}.`)}>Agregar a la existencia</button></p>
      </>)}
      {mode === 'ajustar' && (<>
        <p className="muted small">Cuenta lo que hay físicamente y escríbelo. La diferencia queda en la bitácora con el motivo.</p>
        <div className="row">
          <label>Conté<input inputMode="decimal" value={f.counted} onChange={set('counted')} placeholder={String(stock)} /></label>
          <label>Motivo<input value={f.reason} onChange={set('reason')} placeholder="Ej. conteo de fin de mes" /></label>
        </div>
        {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
        <p><button className="primary" disabled={f.counted.trim() === '' || f.reason.trim().length < 3} onClick={() => go(() => api('POST', '/inventory/count', { productId: p.id, counted: Number(f.counted), reason: f.reason }), 'Existencia ajustada.')}>Ajustar existencia</button></p>
      </>)}
      {mode === 'merma' && (<>
        <p className="muted small">Lo que se echó a perder, se rompió o caducó.</p>
        <div className="row">
          <label>Cantidad<input inputMode="decimal" value={f.qty} onChange={set('qty')} /></label>
          <label>Motivo<input value={f.reason} onChange={set('reason')} placeholder="Ej. caducó" /></label>
        </div>
        {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
        <p><button className="primary" disabled={!(qty > 0) || f.reason.trim().length < 3} onClick={() => go(() => api('POST', '/inventory/waste', { productId: p.id, quantity: qty, reason: f.reason }), 'Merma registrada.')}>Registrar merma</button></p>
      </>)}
    </div>
  )
}

/** Presentaciones: paquete, caja, six… cada una con su equivalencia, precio y código. */
function Presentaciones({ p, onSaved }: { p: P; onSaved: () => void }) {
  const [list, setList] = useState(p.presentations)
  const [f, setF] = useState({ name: '', factor: '', price: '', barcode: '' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const reload = async () => setList((await api<{ product: P }>('GET', `/products/${p.id}`)).product.presentations)
  const go = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); await reload(); setMsg({ ok }); onSaved() } catch (e) { setMsg({ err: (e as Error).message }) } }
  return (
    <div>
      <p className="muted small">Ej. «Paquete de 6» equivale a 6 {UNIT[p.unit] ?? 'piezas'}: al venderlo descuenta 6 de la existencia.</p>
      <table className="list"><tbody>
        {list.map((x) => <tr key={x.id}><td>{x.name}<br /><small className="muted">= {x.factorMilli / 1000} {UNIT[p.unit] ?? ''}{x.barcode ? ` · ${x.barcode}` : ''}</small></td><td className="num">{mxn(x.price)}</td><td className="num"><button className="mini" onClick={() => go(() => api('DELETE', `/products/${p.id}/presentations/${x.id}`), 'Presentación quitada.')}>Quitar</button></td></tr>)}
        {list.length === 0 && <tr><td className="muted">Sin presentaciones.</td></tr>}
      </tbody></table>
      <div className="row" style={{ marginTop: 10 }}>
        <label>Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Paquete de 6" /></label>
        <label>Equivale a<input inputMode="decimal" value={f.factor} onChange={(e) => setF({ ...f, factor: e.target.value })} placeholder="6" /></label>
      </div>
      <div className="row">
        <label>Precio<input inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="$0.00" /></label>
        <label>Código (opcional)<input value={f.barcode} onChange={(e) => setF({ ...f, barcode: e.target.value })} /></label>
      </div>
      {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
      <p><button className="primary" disabled={!f.name.trim() || !(Number(f.factor) > 0) || f.price.trim() === ''} onClick={() => go(async () => { await api('POST', `/products/${p.id}/presentations`, { name: f.name, factor: Number(f.factor), price: toCents(f.price), ...(f.barcode.trim().length >= 3 ? { barcode: f.barcode.trim() } : {}) }); setF({ name: '', factor: '', price: '', barcode: '' }) }, 'Presentación agregada.')}>Agregar presentación</button></p>
    </div>
  )
}

/** Receta: insumos que gasta un platillo, un servicio o una técnica (se descuentan al vender). */
export function Receta({ ownerId }: { ownerId: string }) {
  const [items, setItems] = useState<{ productId: string; name: string; quantity: string }[]>([])
  const [catalog, setCatalog] = useState<P[]>([])
  const [find, setFind] = useState('')
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  useEffect(() => {
    api<any>('GET', `/recipes/${ownerId}`).then((r) => setItems(r.items.map((i: any) => ({ ...i, quantity: String(i.quantity) })))).catch(() => {})
    api<{ products: P[] }>('GET', '/products').then((r) => setCatalog(r.products.filter((x) => x.id !== ownerId && x.active !== false && x.trackStock !== false))).catch(() => {})
  }, [ownerId])
  const matches = find ? catalog.filter((x) => x.name.toLowerCase().includes(find.toLowerCase()) && !items.some((i) => i.productId === x.id)).slice(0, 6) : []
  return (
    <div>
      <p className="muted small">Lo que se gasta cada vez que se vende (en la unidad del insumo: kg, litro, pieza).</p>
      <table className="list"><tbody>
        {items.map((it, i) => (
          <tr key={it.productId}><td>{it.name}</td><td style={{ width: '9em' }}><input aria-label={`Cantidad de ${it.name}`} inputMode="decimal" value={it.quantity} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} /></td><td className="num"><button className="mini" onClick={() => setItems(items.filter((_, j) => j !== i))}>Quitar</button></td></tr>
        ))}
        {items.length === 0 && <tr><td className="muted">Sin insumos.</td></tr>}
      </tbody></table>
      <label>Agregar insumo<input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Buscar insumo…" /></label>
      {matches.length > 0 && <div className="results">{matches.map((x) => <button key={x.id} onClick={() => { setItems([...items, { productId: x.id, name: x.name, quantity: '' }]); setFind('') }}>{x.name}<small>{UNIT[x.unit] ?? x.unit}</small></button>)}</div>}
      {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
      <p><button className="primary" onClick={async () => { try { await api('PUT', `/recipes/${ownerId}`, { items: items.filter((i) => Number(i.quantity) > 0).map((i) => ({ productId: i.productId, quantity: Number(i.quantity) })) }); setMsg({ ok: 'Receta guardada.' }) } catch (e) { setMsg({ err: (e as Error).message }) } }}>Guardar receta</button></p>
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
    <div>
      <p className="muted small">Desde cierta cantidad, la caja cobra otro precio por unidad.</p>
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
    <div>
      <p className="muted small">Fracciona este frasco en decants; el costo se reparte por mililitro.</p>
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
