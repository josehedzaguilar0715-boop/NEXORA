import { useEffect, useMemo, useRef, useState } from 'react'
import { ScanButton } from '../Scanner'
import { api, ApiError, cache, flush, mxn, outbox, toCents } from '../api'
import { can, FIADO_GIROS, type Me, hasGiro } from '../App'

export interface Product {
  id: string; name: string; barcode: string | null; unit: 'pieza' | 'kg' | 'metro' | 'litro'; price: number; stock?: number
  presentations: { id: string; name: string; factorMilli: number; price: number; barcode: string | null }[]
}
export interface Service { id: string; name: string; price: number; category: string | null; durationMin: number | null; machineId: string | null; active: boolean }
interface Line { key: string; serviceId?: string; productId?: string; presentationId?: string; name: string; quantity: number; amount?: number; unitPrice: number; total: number; unit: string; free?: boolean }
interface Shift { id: string; opening_float: number; opened_at: string }
interface Customer { id: string; name: string }

const unitLabel = (u: string) => ({ pieza: 'pza', kg: 'kg', metro: 'm', litro: 'L' })[u] ?? u
const lineTotal = (l: Line) => (l.amount !== undefined ? l.amount : Math.round(l.quantity * l.unitPrice))

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  )
}

export function Caja({ me }: { me: Me }) {
  const [shift, setShift] = useState<Shift | null>(cache.get<Shift | null>('shift', null))
  const [loaded, setLoaded] = useState(false)
  const [catalog, setCatalog] = useState<Product[]>(cache.get<Product[]>('catalog', []))
  const [customers, setCustomers] = useState<Customer[]>(cache.get<Customer[]>('customers', []))
  const [services, setServices] = useState<Service[]>(cache.get<Service[]>('services', []))
  const [q, setQ] = useState('')
  const [cart, setCart] = useState<Line[]>([])
  const [modal, setModal] = useState<null | { kind: 'servicio'; sv: Service } | { kind: 'contador' } | { kind: 'granel'; p: Product } | { kind: 'libre' } | { kind: 'pago'; method: string } | { kind: 'ticket'; text: string; change?: number | null; provisional: boolean } | { kind: 'mov' } | { kind: 'corte' } | { kind: 'ventas' } | { kind: 'descuento' }>(null)
  const [discount, setDiscount] = useState<{ amount: number; code: string } | null>(null)
  const withStaff = hasGiro(me, 'barberia', 'unas', 'perfumeria')
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [staffId, setStaffId] = useState('')
  useEffect(() => { if (withStaff) api<any>('GET', hasGiro(me, 'barberia', 'unas') ? '/agenda/staff' : '/users').then((r) => setStaff((r.staff ?? r.users).filter((x: any) => x.active !== false))).catch(() => {}) }, [])
  const [msg, setMsg] = useState('')
  const search = useRef<HTMLInputElement>(null)

  const refresh = async () => {
    try {
      const cur = await api<{ shift: Shift | null }>('GET', '/shifts/current')
      // Si hay una apertura pendiente de enviar, se respeta la local.
      if (cur.shift || !outbox.items().some((i) => i.status === 'pendiente' && i.path === '/shifts/open')) {
        setShift(cur.shift)
        cache.set('shift', cur.shift)
      }
      // Solo lo que se vende: sin productos eliminados ni boletos (esos se venden en Taquilla).
      const p = await api<{ products: (Product & { active?: boolean })[] }>('GET', '/products')
      const live = p.products.filter((x) => x.active !== false)
      setCatalog(live)
      cache.set('catalog', live)
      const sv = await api<{ services: Service[] }>('GET', '/services')
      const svLive = sv.services.filter((x) => x.active && x.category !== 'boleto')
      setServices(svLive)
      cache.set('services', svLive)
      if (can(me, 'customers_credit')) {
        const c = await api<{ customers: Customer[] }>('GET', '/customers')
        setCustomers(c.customers)
        cache.set('customers', c.customers)
      }
    } catch {
      /* sin red: se usa lo guardado */
    } finally {
      setLoaded(true)
    }
  }
  useEffect(() => { void refresh() }, [])

  const quick = hasGiro(me, 'comedor', 'taqueria')
  const [soldOut, setSoldOut] = useState<string[]>([])
  const [top, setTop] = useState<string[]>([])
  useEffect(() => {
    if (!quick) return
    api<any>('GET', '/daily-menu').then((r) => setSoldOut(r.menus.flatMap((m: any) => m.items.filter((i: any) => i.soldOut).map((i: any) => i.productId)))).catch(() => {})
    api<any>('GET', '/products/top').then((r) => setTop(r.products.map((p: any) => p.id))).catch(() => {})
  }, [])
  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    const list = catalog.filter((p) => !soldOut.includes(p.id) && (p as Product & { sellable?: boolean }).sellable !== false)
    // Venta rápida: primero lo más vendido.
    if (!t) return [...list].sort((a, b) => (top.indexOf(a.id) + 1 || 999) - (top.indexOf(b.id) + 1 || 999)).slice(0, 24)
    return list.filter((p) => p.name.toLowerCase().includes(t) || p.barcode === t).slice(0, 24)
  }, [q, catalog, soldOut, top])
  const serviceResults = useMemo(() => services.filter((x) => !q.trim() || x.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 24), [q, services])

  const subtotal = cart.reduce((a, l) => a + lineTotal(l), 0)
  const total = Math.max(0, subtotal - (discount?.amount ?? 0))

  const add = (p: Product, presentationId?: string) => {
    if (!presentationId && p.unit !== 'pieza') return setModal({ kind: 'granel', p })
    const pr = p.presentations.find((x) => x.id === presentationId)
    setCart((c) => {
      const same = c.find((l) => l.productId === p.id && l.presentationId === presentationId && l.amount === undefined)
      if (same) return c.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l))
      return [...c, { key: crypto.randomUUID(), productId: p.id, presentationId, name: pr ? `${p.name} ${pr.name}` : p.name, quantity: 1, unitPrice: pr ? pr.price : p.price, total: 0, unit: pr ? 'pza' : unitLabel(p.unit) }]
    })
    setQ('')
    search.current?.focus()
  }

  // Lector de código de barras: escribe el código y manda Enter.
  const onEnter = (code = q) => {
    const t = code.trim()
    if (!t) return
    const byCode = catalog.find((p) => p.barcode === t)
    if (byCode) return add(byCode)
    for (const p of catalog) {
      const pr = p.presentations.find((x) => x.barcode === t)
      if (pr) return add(p, pr.id)
    }
    if (code === q && results.length === 1) return add(results[0]!)
    if (code !== q) setQ(t) // de la cámara y no está en el catálogo: se queda escrito para buscarlo
  }

  const setQty = (key: string, delta: number) => setCart((c) => c.flatMap((l) => (l.key !== key ? [l] : l.quantity + delta <= 0 ? [] : [{ ...l, quantity: l.quantity + delta }])))

  const charge = async (method: string, extra: { cashReceived?: number; customerId?: string; authCode?: string } = {}) => {
    const id = crypto.randomUUID()
    const body = {
      id, shiftId: shift!.id, paymentMethod: method, createdAt: new Date().toISOString(),
      items: cart.map((l) => (l.serviceId ? { serviceId: l.serviceId, quantity: l.quantity } : l.free ? { description: l.name, quantity: l.quantity, unitPrice: l.unitPrice } : { productId: l.productId, presentationId: l.presentationId, ...(l.amount !== undefined ? { amount: l.amount } : { quantity: l.quantity }) })),
      ...(discount ? { discount: discount.amount, authCode: discount.code } : {}),
      ...(staffId ? { staffId } : {}),
      ...extra,
    }
    const needsCode = !!discount || !!extra.authCode
    await flush()
    let sale: any = null
    if (outbox.pending() === 0) {
      try {
        sale = (await api('POST', '/sales', body, { 'idempotency-key': id })).sale
      } catch (e) {
        const err = e as ApiError
        if (err.code === 'codigo_requerido' && method === 'fiado') {
          const code = prompt('Este cliente pasa su límite de crédito. Código del dueño:')
          if (code) return charge(method, { ...extra, authCode: code })
          return
        }
        if (err.status !== 0 && err.status < 500) { setMsg(err.message); return }
      }
    }
    if (!sale) {
      if (needsCode || method === 'fiado') { setMsg('Sin internet no se pueden autorizar descuentos ni fiado. Intenta cuando regrese la señal.'); return }
      outbox.enqueue('POST', '/sales', body, `Venta ${mxn(total)}`, id)
    }
    let text = ''
    if (sale) text = (await api<{ text: string }>('GET', `/sales/${sale.id}/ticket`).catch(() => ({ text: '' }))).text
    if (!text) {
      text = [me.business.name, me.business.phone ? `Tel. ${me.business.phone}` : '', 'Folio provisional (sin internet)', new Date().toLocaleString('es-MX'), '-'.repeat(32),
        ...cart.map((l) => `${l.quantity} ${l.name}`.slice(0, 22).padEnd(22) + mxn(lineTotal(l)).padStart(10)), '-'.repeat(32),
        `TOTAL ${mxn(total)}`, `Pago: ${method}`, `Atendió: ${me.user.name}`].filter(Boolean).join('\n')
    }
    setModal({ kind: 'ticket', text, change: extra.cashReceived !== undefined ? (sale?.change ?? extra.cashReceived - total) : null, provisional: !sale })
    setCart([])
    setDiscount(null)
    setMsg('')
  }

  if (!loaded && !shift) return <p className="muted">Cargando caja…</p>
  if (!shift) return <OpenShift meals={hasGiro(me, 'comedor')} onOpen={(s) => { setShift(s); cache.set('shift', s) }} />

  return (
    <div className="sell">
      <section className="card">
        <div className="row">
          <input
            ref={search} autoFocus placeholder="Escanea o escribe el producto…" value={q} data-testid="buscar"
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onEnter()}
          />
          <ScanButton onCode={(c) => onEnter(c)} />
        </div>
        <div className="results">
          {serviceResults.map((sv) => (
            <button key={sv.id} onClick={() => setModal({ kind: 'servicio', sv })}>{sv.name}<small>{mxn(sv.price)}{sv.durationMin ? ` · ${sv.durationMin} min` : ''}</small></button>
          ))}
          {results.map((p) => (
            <button key={p.id} onClick={() => add(p)}>
              {p.name}
              <small>{mxn(p.price)} / {unitLabel(p.unit)}{p.stock !== undefined ? ` · hay ${p.stock}` : ''}</small>
            </button>
          ))}
          {results.flatMap((p) => p.presentations.map((pr) => (
            <button key={pr.id} onClick={() => add(p, pr.id)}>{p.name} {pr.name}<small>{mxn(pr.price)}</small></button>
          )))}
          <button onClick={() => setModal({ kind: 'libre' })}>➕ Otro / varios<small>Escribe el precio</small></button>
        </div>
      </section>

      <section className="card cart">
        <h2>Cuenta</h2>
        {cart.length === 0 ? <p className="muted">Agrega productos para cobrar.</p> : (
          <table>
            <tbody>
              {cart.map((l) => (
                <tr key={l.key}>
                  <td>{l.name}<br /><small className="muted">{l.amount !== undefined ? `por importe` : `${l.quantity} ${l.unit} × ${mxn(l.unitPrice)}`}</small></td>
                  <td>{l.amount === undefined && l.unit === 'pza' && (
                    <div className="qty"><button onClick={() => setQty(l.key, -1)} aria-label="menos">−</button><button onClick={() => setQty(l.key, 1)} aria-label="más">+</button></div>
                  )}{(l.amount !== undefined || l.unit !== 'pza') && <button onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))}>Quitar</button>}</td>
                  <td className="num">{mxn(lineTotal(l))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {withStaff && <label>¿Quién atendió?<select value={staffId} onChange={(e) => setStaffId(e.target.value)}><option value="">— Nadie (sin comisión) —</option>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        {discount && <p className="row"><span>Descuento</span><span className="num">−{mxn(discount.amount)}</span></p>}
        <div className="total" data-testid="total">{mxn(total)}</div>
        {msg && <p className="error">{msg}</p>}
        <div className="pay">
          <button className="primary big" disabled={!cart.length} onClick={() => setModal({ kind: 'pago', method: 'efectivo' })}>Efectivo</button>
          <button className="big" disabled={!cart.length} onClick={() => charge('transferencia')}>Transferencia</button>
          <button className="big" disabled={!cart.length} onClick={() => charge('tarjeta')}>Tarjeta</button>
          {can(me, 'customers_credit') && hasGiro(me, ...FIADO_GIROS) && <button className="big" disabled={!cart.length} onClick={() => setModal({ kind: 'pago', method: 'fiado' })}>Fiado</button>}
        </div>
        <div className="pay" style={{ marginTop: 12 }}>
          {can(me, 'cancel_discount') && <button disabled={!cart.length} onClick={() => setModal({ kind: 'descuento' })}>Descuento</button>}
          <button onClick={() => setModal({ kind: 'ventas' })}>Ventas del turno</button>
          {can(me, 'open_close_cash') && <button onClick={() => setModal({ kind: 'mov' })}>Retiro / depósito</button>}
          {can(me, 'open_close_cash') && <button onClick={() => setModal({ kind: 'corte' })}>Corte de caja</button>}
          {hasGiro(me, 'papeleria') && can(me, 'open_close_cash') && <button onClick={() => setModal({ kind: 'contador' })}>Contador copiadora</button>}
        </div>
      </section>

      {modal?.kind === 'granel' && <Granel p={modal.p} onClose={() => setModal(null)} onAdd={(l) => { setCart((c) => [...c, l]); setModal(null); setQ('') }} />}
      {modal?.kind === 'servicio' && <Cantidad sv={modal.sv} onClose={() => setModal(null)} onAdd={(l) => { setCart((c) => [...c, l]); setModal(null); setQ('') }} />}
      {modal?.kind === 'contador' && <Contador shift={shift} onClose={() => setModal(null)} />}
      {modal?.kind === 'libre' && <Libre onClose={() => setModal(null)} onAdd={(l) => { setCart((c) => [...c, l]); setModal(null) }} />}
      {modal?.kind === 'descuento' && <Descuento max={subtotal} onClose={() => setModal(null)} onSet={(d) => { setDiscount(d); setModal(null) }} />}
      {modal?.kind === 'pago' && <Pago method={modal.method} total={total} customers={customers} onClose={() => setModal(null)} onPay={(extra) => { setModal(null); void charge(modal.method, extra) }} />}
      {modal?.kind === 'ticket' && (
        <Modal onClose={() => { setModal(null); search.current?.focus() }}>
          <h2>Venta cobrada</h2>
          {modal.change != null && <div className="total">Cambio: {mxn(modal.change)}</div>}
          {modal.provisional && <p className="muted">Sin internet: la venta se guardó en este equipo y se enviará sola.</p>}
          <pre style={{ fontSize: 14, background: 'var(--bg)', padding: 10, borderRadius: 8 }}>{modal.text}</pre>
          <div className="ticket">{modal.text}</div>
          <div className="row">
            <button className="big" onClick={() => window.print()}>Imprimir ticket</button>
            <button className="primary big" autoFocus onClick={() => { setModal(null); search.current?.focus() }}>Nueva venta</button>
          </div>
        </Modal>
      )}
      {modal?.kind === 'mov' && <Movimiento shift={shift} onClose={() => setModal(null)} />}
      {modal?.kind === 'ventas' && <VentasTurno shift={shift} me={me} onClose={() => setModal(null)} />}
      {modal?.kind === 'corte' && <Corte shift={shift} onClose={() => setModal(null)} onClosed={() => { setShift(null); cache.set('shift', null); setModal(null) }} />}
    </div>
  )
}

/**
 * Monto escrito como lo escribe la gente: "1000", "1,000", "$10 000", "1.000" o "1,500.50" → centavos.
 * Vacío o inválido → null.
 */
export function parseAmount(v: string): number | null {
  let t = v.replace(/[$\s]/g, '')
  if (!t) return null
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '') // 1.000 o 10.000: punto de miles
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.') // 12,50: coma decimal
  else t = t.replace(/,/g, '')
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null
}

function OpenShift({ onOpen, meals }: { onOpen: (s: Shift) => void; meals?: boolean }) {
  const [amount, setAmount] = useState('')
  const [meal, setMeal] = useState(() => { const h = new Date().getHours(); return h < 12 ? 'desayuno' : h < 18 ? 'comida' : 'cena' })
  const [err, setErr] = useState('')
  const open = async () => {
    const cents = parseAmount(amount)
    if (cents == null) return setErr('Escribe con cuánto dinero abres (puede ser 0).')
    const id = crypto.randomUUID()
    const body = { id, openingFloat: cents, at: new Date().toISOString(), ...(meals ? { meal } : {}) }
    try {
      const r = await api<{ shift: Shift }>('POST', '/shifts/open', body, { 'idempotency-key': id })
      onOpen(r.shift)
    } catch (e) {
      const er = e as ApiError
      if (er.status !== 0 && er.status < 500) return setErr(er.message)
      // Sin internet: se abre en el equipo y se envía después.
      outbox.enqueue('POST', '/shifts/open', body, 'Apertura de caja', id)
      onOpen({ id, opening_float: body.openingFloat, opened_at: body.at })
    }
  }
  return (
    <div className="card login">
      <h1>Abrir caja</h1>
      <p className="muted">Cuenta el dinero con el que empiezas el turno.</p>
      {meals && <div className="tabs">{['desayuno', 'comida', 'cena'].map((m) => <button key={m} className={meal === m ? 'on' : ''} onClick={() => setMeal(m)}>{m[0]!.toUpperCase() + m.slice(1)}</button>)}</div>}
      <label>Fondo inicial (lo que hay en la caja al empezar)<input inputMode="decimal" placeholder="$0.00" value={amount} onChange={(e) => { setAmount(e.target.value); setErr('') }} autoFocus onKeyDown={(e) => e.key === 'Enter' && open()} /></label>
      <div className="quick">{[0, 500, 1000, 2000, 5000, 10000].map((v) => <button key={v} type="button" className={parseAmount(amount) === v * 100 ? 'on' : ''} onClick={() => setAmount(String(v))}>{mxn(v * 100).replace('.00', '')}</button>)}</div>
      {parseAmount(amount) != null && amount.trim() !== '' && <div className="total">{mxn(parseAmount(amount)!)}</div>}
      {err && <p className="error">{err}</p>}
      <p><button className="primary big" style={{ width: '100%' }} onClick={open}>Abrir caja</button></p>
    </div>
  )
}

function Granel({ p, onAdd, onClose }: { p: Product; onAdd: (l: Line) => void; onClose: () => void }) {
  const [by, setBy] = useState<'cantidad' | 'importe'>('cantidad')
  const [v, setV] = useState('')
  const u = unitLabel(p.unit)
  const n = Number(v.replace(',', '.'))
  const ok = v !== '' && n > 0
  const preview = !ok ? 0 : by === 'cantidad' ? Math.round(n * p.price) : toCents(v)
  const add = () => {
    if (!ok) return
    onAdd(by === 'cantidad'
      ? { key: crypto.randomUUID(), productId: p.id, name: p.name, quantity: n, unitPrice: p.price, total: preview, unit: u }
      : { key: crypto.randomUUID(), productId: p.id, name: p.name, quantity: Math.round((toCents(v) * 1000) / p.price) / 1000, amount: toCents(v), unitPrice: p.price, total: preview, unit: u })
  }
  return (
    <Modal onClose={onClose}>
      <h2>{p.name} · {mxn(p.price)} / {u}</h2>
      <div className="tabs">
        <button className={by === 'cantidad' ? 'on' : ''} onClick={() => setBy('cantidad')}>Por {u} (báscula)</button>
        <button className={by === 'importe' ? 'on' : ''} onClick={() => setBy('importe')}>Por importe ($)</button>
      </div>
      <label>{by === 'cantidad' ? `Cantidad en ${u}` : 'Importe en pesos'}<input inputMode="decimal" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={by === 'cantidad' ? '0.500' : '$20.00'} /></label>
      <div className="total">{mxn(preview)}</div>
      <div className="row"><button onClick={onClose}>Cancelar</button><button className="primary" disabled={!ok} onClick={add}>Agregar</button></div>
    </Modal>
  )
}

function Libre({ onAdd, onClose }: { onAdd: (l: Line) => void; onClose: () => void }) {
  const [d, setD] = useState('')
  const [p, setP] = useState('')
  const [qty, setQty] = useState('1')
  const ok = d.trim() && p && toCents(p) >= 0 && Number(qty) > 0
  return (
    <Modal onClose={onClose}>
      <h2>Otro producto</h2>
      <label>Descripción<input autoFocus value={d} onChange={(e) => setD(e.target.value)} /></label>
      <div className="row">
        <div><label>Cantidad<input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label></div>
        <div><label>Precio<input inputMode="decimal" value={p} onChange={(e) => setP(e.target.value)} placeholder="$0.00" /></label></div>
      </div>
      <p className="row"><button onClick={onClose}>Cancelar</button><button className="primary" disabled={!ok} onClick={() => onAdd({ key: crypto.randomUUID(), name: d.trim(), quantity: Number(qty), unitPrice: toCents(p), total: 0, unit: 'pza', free: true })}>Agregar</button></p>
    </Modal>
  )
}

function Descuento({ max, onSet, onClose }: { max: number; onSet: (d: { amount: number; code: string }) => void; onClose: () => void }) {
  const [a, setA] = useState('')
  const [code, setCode] = useState('')
  const amount = toCents(a)
  const ok = amount > 0 && amount <= max && code.length >= 4
  return (
    <Modal onClose={onClose}>
      <h2>Descuento</h2>
      <label>Monto del descuento<input inputMode="decimal" autoFocus value={a} onChange={(e) => setA(e.target.value)} placeholder="$0.00" /></label>
      <label>Código de autorización<input type="password" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></label>
      <p className="muted">El código se valida al cobrar y queda registrado quién autorizó.</p>
      <p className="row"><button onClick={onClose}>Cancelar</button><button className="primary" disabled={!ok} onClick={() => onSet({ amount, code })}>Aplicar</button></p>
    </Modal>
  )
}

function Pago({ method, total, customers, onPay, onClose }: { method: string; total: number; customers: Customer[]; onPay: (e: { cashReceived?: number; customerId?: string }) => void; onClose: () => void }) {
  const [r, setR] = useState('')
  const [cust, setCust] = useState('')
  const [find, setFind] = useState('')
  const received = r === '' ? total : toCents(r)
  if (method === 'fiado') {
    const list = customers.filter((c) => c.name.toLowerCase().includes(find.toLowerCase())).slice(0, 8)
    return (
      <Modal onClose={onClose}>
        <h2>Fiado · {mxn(total)}</h2>
        <label>Cliente<input autoFocus value={find} onChange={(e) => setFind(e.target.value)} placeholder="Buscar cliente…" /></label>
        <div className="results">{list.map((c) => <button key={c.id} className={cust === c.id ? 'primary' : ''} onClick={() => setCust(c.id)}>{c.name}</button>)}</div>
        <p className="row"><button onClick={onClose}>Cancelar</button><button className="primary big" disabled={!cust} onClick={() => onPay({ customerId: cust })}>Fiar</button></p>
      </Modal>
    )
  }
  const quick = [5000, 10000, 20000, 50000].filter((v) => v >= total).slice(0, 3)
  return (
    <Modal onClose={onClose}>
      <h2>Cobro en efectivo</h2>
      <div className="total">{mxn(total)}</div>
      <label>¿Con cuánto paga?
        <input inputMode="decimal" autoFocus value={r} onChange={(e) => setR(e.target.value)} placeholder={mxn(total)} onKeyDown={(e) => e.key === 'Enter' && received >= total && onPay({ cashReceived: received })} />
      </label>
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={() => setR(String(total / 100))}>Exacto</button>
        {quick.map((v) => <button key={v} onClick={() => setR(String(v / 100))}>{mxn(v)}</button>)}
      </div>
      <h2 style={{ marginTop: 12 }}>Cambio: {received >= total ? mxn(received - total) : '—'}</h2>
      {received < total && <p className="error">Falta {mxn(total - received)}</p>}
      <p className="row"><button onClick={onClose}>Cancelar</button><button className="primary big" disabled={received < total} onClick={() => onPay({ cashReceived: received })}>Cobrar</button></p>
    </Modal>
  )
}

function Movimiento({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const [type, setType] = useState<'retiro' | 'deposito'>('retiro')
  const [a, setA] = useState('')
  const [reason, setReason] = useState('')
  const [done, setDone] = useState('')
  const save = async () => {
    const id = crypto.randomUUID()
    outbox.enqueue('POST', `/shifts/${shift.id}/movements`, { id, type, amount: toCents(a), reason, at: new Date().toISOString() }, `${type === 'retiro' ? 'Retiro' : 'Depósito'} ${mxn(toCents(a))}`, id)
    await flush()
    const it = outbox.get(id)
    setDone(it?.status === 'rechazado' ? `No se pudo: ${it.error}` : 'Guardado.')
  }
  return (
    <Modal onClose={onClose}>
      <h2>Retiro o depósito</h2>
      <div className="tabs"><button className={type === 'retiro' ? 'on' : ''} onClick={() => setType('retiro')}>Retiro</button><button className={type === 'deposito' ? 'on' : ''} onClick={() => setType('deposito')}>Depósito</button></div>
      <label>Monto<input inputMode="decimal" value={a} onChange={(e) => setA(e.target.value)} placeholder="$0.00" autoFocus /></label>
      <label>Motivo<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. pago a proveedor" /></label>
      {done && <p className={done.startsWith('No') ? 'error' : 'okmsg'}>{done}</p>}
      <p className="row"><button onClick={onClose}>Cerrar</button><button className="primary" disabled={!(toCents(a) > 0 && reason.trim().length >= 2) || !!done} onClick={save}>Guardar</button></p>
    </Modal>
  )
}

function VentasTurno({ shift, me, onClose }: { shift: Shift; me: Me; onClose: () => void }) {
  const [list, setList] = useState<any[] | null>(null)
  const [err, setErr] = useState('')
  const load = () => api<{ sales: any[] }>('GET', `/sales?shiftId=${shift.id}`).then((r) => setList(r.sales)).catch((e) => setErr(e.message))
  useEffect(() => { void load() }, [])
  const cancel = async (id: string) => {
    const reason = prompt('¿Por qué se cancela?')
    if (!reason) return
    const code = prompt('Código de autorización:')
    if (!code) return
    try {
      await api('POST', `/sales/${id}/cancel`, { reason, authCode: code })
      void load()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <Modal onClose={onClose}>
      <h2>Ventas del turno</h2>
      {err && <p className="error">{err}</p>}
      {!list ? <p className="muted">Cargando…</p> : (
        <table className="list"><tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td>#{s.folio}<br /><small className="muted">{new Date(s.createdAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} · {s.paymentMethod}</small></td>
              <td className="num">{s.status === 'cancelada' ? <s>{mxn(s.total)}</s> : mxn(s.total)}</td>
              <td>{s.status === 'completada' && can(me, 'cancel_discount') ? <button onClick={() => cancel(s.id)}>Cancelar</button> : <small className="muted">{s.status}</small>}</td>
            </tr>
          ))}
        </tbody></table>
      )}
      <p><button onClick={onClose}>Cerrar</button></p>
    </Modal>
  )
}

/**
 * Corte de caja con verificación a ciegas: 1) se cuenta el dinero físico sin ver lo que dice el sistema;
 * 2) el sistema compara contra lo registrado (cuadra, sobra o falta) y se puede volver a contar; 3) se cierra.
 */
function Corte({ shift, onClose, onClosed }: { shift: Shift; onClose: () => void; onClosed: () => void }) {
  const [step, setStep] = useState<'contar' | 'verificar'>('contar')
  const [typed, setTyped] = useState('')
  const [check, setCheck] = useState<any>(null)
  const [offline, setOffline] = useState(false)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<any>(null)
  const counted = toCents(typed || '0')

  const verify = async () => {
    setErr(''); setBusy(true)
    try {
      await flush()
      setCheck(await api('POST', `/shifts/${shift.id}/verify`, { countedCash: counted }))
      setOffline(false)
    } catch (e) {
      if ((e as { code?: string }).code === 'sin_red') { setOffline(true); setCheck(null) } else { setBusy(false); return setErr((e as Error).message) }
    }
    setBusy(false); setStep('verificar')
  }
  const close = async () => {
    setBusy(true)
    const body = { countedCash: counted, reason: reason || undefined, at: new Date().toISOString() }
    const id = outbox.enqueue('POST', `/shifts/${shift.id}/close`, body, 'Corte de caja')
    await flush()
    const it = outbox.get(id)
    setBusy(false)
    if (it?.status === 'rechazado') {
      outbox.dismiss(id)
      return setErr(it.error ?? 'No se pudo cerrar.')
    }
    setResult(it?.result ?? { pending: true })
  }

  if (result) {
    return (
      <Modal onClose={onClosed}>
        <h2>Caja cerrada</h2>
        {result.pending ? <p>Sin internet: el corte se enviará solo al reconectar.</p> : (
          <>
            <p className="row"><span>Efectivo esperado</span><b className="num">{mxn(result.totals.expectedCash)}</b></p>
            <p className="row"><span>Contado</span><b className="num">{mxn(result.shift.counted_cash)}</b></p>
            <p className="row"><span>Diferencia</span><b className="num" style={{ color: result.difference ? 'var(--danger)' : 'var(--ok)' }}>{mxn(result.difference)}</b></p>
          </>
        )}
        <p><button className="primary big" style={{ width: '100%' }} onClick={onClosed}>Listo</button></p>
      </Modal>
    )
  }

  if (step === 'contar') {
    return (
      <Modal onClose={onClose}>
        <h2>Corte de caja · 1. Cuenta el dinero</h2>
        <p className="muted">Cuenta todo el dinero que hay en la caja y escribe el total. Después el sistema te dice si coincide con lo registrado.</p>
        <label>¿Cuánto dinero hay en la caja?<input inputMode="decimal" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && typed.trim() && void verify()} placeholder="$0.00" /></label>
        <div className="total">{mxn(counted)}</div>
        {err && <p className="error">{err}</p>}
        <p className="row"><button onClick={onClose}>Volver</button><button className="primary big" disabled={busy || typed.trim() === '' || Number.isNaN(counted)} onClick={verify}>{busy ? 'Verificando…' : 'Verificar con el sistema'}</button></p>
      </Modal>
    )
  }

  const diff = check ? check.difference : null
  const t = check?.totals
  return (
    <Modal onClose={onClose}>
      <h2>Corte de caja · 2. Verificación</h2>
      {offline ? <p className="error">Sin internet: no se puede comparar ahora. Puedes cerrar y el sistema lo comparará al reconectar; escribe una nota.</p> : (
        <div className={`verdict ${diff === 0 ? 'ok' : 'bad'}`}>
          <div className="big-ico" aria-hidden>{diff === 0 ? '✓' : '!'}</div>
          <div>
            <b>{diff === 0 ? 'La caja cuadra' : diff! > 0 ? `Sobran ${mxn(diff!)}` : `Faltan ${mxn(-diff!)}`}</b>
            <div className="muted small">Contaste {mxn(check.counted)} · el sistema registra {mxn(check.expectedCash)}</div>
          </div>
        </div>
      )}
      {t && (
        <table className="list statement"><tbody>
          <tr><td>Fondo inicial</td><td className="num">{mxn(t.openingFloat)}</td></tr>
          <tr><td>Ventas en efectivo</td><td className="num">{mxn(t.cashSales)}</td></tr>
          {t.tipsCash > 0 && <tr><td>Propinas en efectivo</td><td className="num">{mxn(t.tipsCash)}</td></tr>}
          <tr><td>Depósitos y abonos</td><td className="num">{mxn(t.deposits)}</td></tr>
          <tr><td>Retiros y pagos desde la caja</td><td className="num">{mxn(-t.withdrawals)}</td></tr>
          <tr className="total"><td>Debe haber en caja</td><td className="num">{mxn(t.expectedCash)}</td></tr>
          <tr className="muted"><td>No es efectivo: transferencia · tarjeta · fiado</td><td className="num">{mxn(t.transferSales)} · {mxn(t.cardSales)} · {mxn(t.creditSales)}</td></tr>
        </tbody></table>
      )}
      {(diff !== 0 || offline) && <label>{offline ? 'Nota' : 'Motivo de la diferencia'}<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={offline ? 'Corte sin internet' : 'Ej. di cambio de más'} /></label>}
      {err && <p className="error">{err}</p>}
      <p className="row">
        <button onClick={() => { setStep('contar'); setCheck(null); setReason('') }}>Volver a contar</button>
        <button className={diff === 0 ? 'primary big' : 'danger big'} disabled={busy || ((diff !== 0 || offline) && !reason.trim())} onClick={close}>{busy ? 'Cerrando…' : diff === 0 ? 'Cerrar caja' : 'Cerrar con diferencia'}</button>
      </p>
    </Modal>
  )
}

function Cantidad({ sv, onAdd, onClose }: { sv: Service; onAdd: (l: Line) => void; onClose: () => void }) {
  const [v, setV] = useState('1')
  const n = Number(v)
  const ok = n > 0
  const add = () => ok && onAdd({ key: crypto.randomUUID(), serviceId: sv.id, name: sv.name, quantity: n, unitPrice: sv.price, total: 0, unit: 'pza', free: false })
  return (
    <Modal onClose={onClose}>
      <h2>{sv.name} · {mxn(sv.price)}</h2>
      <label>Cantidad (hojas, piezas…)<input inputMode="numeric" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></label>
      <div className="row" style={{ marginTop: 8 }}>{[1, 10, 20, 50, 100].map((x) => <button key={x} onClick={() => setV(String(x))}>{x}</button>)}</div>
      <div className="total">{mxn(ok ? Math.round(n * sv.price) : 0)}</div>
      <div className="row"><button onClick={onClose}>Cancelar</button><button className="primary" disabled={!ok} onClick={add}>Agregar</button></div>
    </Modal>
  )
}

/** Papelería: contador de la copiadora al inicio y fin del turno, comparado con las hojas cobradas. */
function Contador({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const [machines, setMachines] = useState<{ id: string; name: string }[]>([])
  const [report, setReport] = useState<any[]>([])
  const [f, setF] = useState({ machineId: '', type: 'inicio', value: '' })
  const [msg, setMsg] = useState('')
  const load = async () => {
    const m = await api<any>('GET', '/machines')
    setMachines(m.machines)
    setF((x) => ({ ...x, machineId: x.machineId || m.machines[0]?.id || '' }))
    setReport((await api<any>('GET', `/shifts/${shift.id}/counters`)).machines)
  }
  useEffect(() => { void load().catch((e) => setMsg(e.message)) }, [])
  const save = async () => {
    try { await api('POST', `/machines/${f.machineId}/readings`, { type: f.type, value: Number(f.value), shiftId: shift.id }); setMsg('Guardado.'); setF({ ...f, value: '' }); void load() } catch (e) { setMsg((e as Error).message) }
  }
  return (
    <Modal onClose={onClose}>
      <h2>Contador de copiadora</h2>
      <label>Equipo<select value={f.machineId} onChange={(e) => setF({ ...f, machineId: e.target.value })}>{machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <div className="tabs" style={{ marginTop: 10 }}><button className={f.type === 'inicio' ? 'on' : ''} onClick={() => setF({ ...f, type: 'inicio' })}>Inicio de turno</button><button className={f.type === 'fin' ? 'on' : ''} onClick={() => setF({ ...f, type: 'fin' })}>Fin de turno</button></div>
      <label>Número del contador<input inputMode="numeric" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></label>
      <p><button className="primary" disabled={!f.machineId || f.value === ''} onClick={save}>Guardar lectura</button></p>
      {msg && <p className="muted">{msg}</p>}
      <table className="list"><thead><tr><th>Equipo</th><th className="num">Contador</th><th className="num">Cobradas</th><th className="num">Diferencia</th></tr></thead>
        <tbody>{report.map((r) => <tr key={r.machineId}><td>{r.name}</td><td className="num">{r.counted ?? '—'}</td><td className="num">{r.sold}</td><td className="num" style={{ color: r.difference ? 'var(--danger)' : undefined }}>{r.difference ?? '—'}</td></tr>)}</tbody></table>
      <p><button onClick={onClose}>Cerrar</button></p>
    </Modal>
  )
}
