import { useEffect, useMemo, useRef, useState } from 'react'
import { ScanButton } from '../Scanner'
import { api, ApiError, cache, flush, mxn, outbox, toCents } from '../api'
import { can, FIADO_GIROS, type Me, hasGiro } from '../App'

export interface Product {
  id: string; name: string; barcode: string | null; unit: 'pieza' | 'kg' | 'metro' | 'litro'; price: number; stock?: number
  presentations: { id: string; name: string; factorMilli: number; price: number; barcode: string | null }[]
  /** Precio de mayoreo o escalas por volumen (desde cierta cantidad). */
  tiers?: { minQuantity: number; price: number }[]
  /** A granel por pieza: se compra por bolsa/caja de `size` piezas. */
  pack?: { name: string; size: number } | null
}
export interface Service { id: string; name: string; price: number; category: string | null; durationMin: number | null; machineId: string | null; active: boolean }
interface Line { key: string; serviceId?: string; productId?: string; presentationId?: string; name: string; quantity: number; amount?: number; unitPrice: number; total: number; unit: string; free?: boolean; tiers?: { minQuantity: number; price: number }[] }
interface Shift { id: string; opening_float: number; opened_at: string }
interface Customer { id: string; name: string }

const unitLabel = (u: string) => ({ pieza: 'pza', kg: 'kg', metro: 'm', litro: 'L' })[u] ?? u
/** Precio por unidad del renglón: el de mayoreo si la cantidad llega (lo mismo que cobra el servidor). */
export const linePrice = (l: Line) => {
  if (l.amount !== undefined || !l.tiers?.length) return l.unitPrice
  const t = [...l.tiers].reverse().find((x) => l.quantity + 1e-9 >= x.minQuantity)
  return t ? t.price : l.unitPrice
}
const isWholesale = (l: Line) => linePrice(l) !== l.unitPrice
const lineTotal = (l: Line) => (l.amount !== undefined ? l.amount : Math.round(l.quantity * linePrice(l)))

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  )
}

interface Held { id: string; at: string; cart: Line[]; discount: { amount: number; code: string } | null; customer: Customer | null; staffId: string }
export interface Loyalty { unit: string; earned: number; balance: number; ready: string[]; next: { name: string; cost: number } | null }
/** «Ganó 1 sello · lleva 7 · le faltan 3 para Corte gratis». */
export function loyaltyText(l: Loyalty): string {
  const u = (n: number) => `${n} ${l.unit === 'sellos' ? (n === 1 ? 'sello' : 'sellos') : n === 1 ? 'punto' : 'puntos'}`
  const parts = [l.earned > 0 ? `Ganó ${u(l.earned)}` : `Hoy ya no suma ${l.unit} (llegó al tope del día)`, `lleva ${u(l.balance)}`]
  if (l.ready.length) parts.push(`¡ya puede canjear: ${l.ready.join(', ')}!`)
  else if (l.next) parts.push(`le faltan ${l.next.cost - l.balance} para ${l.next.name}`)
  return parts.join(' · ')
}

type Modal_ = null | { kind: 'servicio'; sv: Service } | { kind: 'contador' } | { kind: 'granel'; p: Product; qty?: number } | { kind: 'libre' } | { kind: 'cobro' } | { kind: 'fiado' } | { kind: 'ticket'; text: string; change?: number | null; provisional: boolean; loyalty?: Loyalty | null } | { kind: 'mov' } | { kind: 'corte' } | { kind: 'ventas' } | { kind: 'descuento' } | { kind: 'espera' } | { kind: 'cliente' } | { kind: 'cancelar' }

/** Atajos de teclado de la caja (se muestran en cada botón). */
const KEYS = { buscar: 'F2', cliente: 'F3', descuento: 'F4', espera: 'F6', mov: 'F7', libre: 'F8', ventas: 'F9', cobrar: 'F10' } as const

/**
 * Punto de venta: buscador (código o nombre, Enter; "3*código" para cantidad), ticket en tabla editable,
 * total y cobro (efectivo, tarjeta, transferencia, mixto o fiado). Ventas en espera y atajos de teclado.
 */
export function Caja({ me }: { me: Me }) {
  const [shift, setShift] = useState<Shift | null>(cache.get<Shift | null>('shift', null))
  const [loaded, setLoaded] = useState(false)
  const [catalog, setCatalog] = useState<Product[]>(cache.get<Product[]>('catalog', []))
  const [customers, setCustomers] = useState<Customer[]>(cache.get<Customer[]>('customers', []))
  const [services, setServices] = useState<Service[]>(cache.get<Service[]>('services', []))
  const [q, setQ] = useState('')
  const [pick, setPick] = useState(0)
  const [cart, setCart] = useState<Line[]>([])
  const [selLine, setSelLine] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal_>(null)
  const [discount, setDiscount] = useState<{ amount: number; code: string } | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [held, setHeld] = useState<Held[]>(cache.get<Held[]>('held', []))
  const withStaff = hasGiro(me, 'barberia', 'unas', 'perfumeria')
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([])
  const [staffId, setStaffId] = useState('')
  useEffect(() => { if (withStaff) api<any>('GET', hasGiro(me, 'barberia', 'unas') ? '/agenda/staff' : '/users').then((r) => setStaff((r.staff ?? r.users).filter((x: any) => x.active !== false))).catch(() => {}) }, [])
  const [msg, setMsg] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const fiadoOk = can(me, 'customers_credit') && hasGiro(me, ...FIADO_GIROS)

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
      if (can(me, 'customers_credit') || can(me, 'sell')) {
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
    if (quick) api<any>('GET', '/daily-menu').then((r) => setSoldOut(r.menus.flatMap((m: any) => m.items.filter((i: any) => i.soldOut).map((i: any) => i.productId)))).catch(() => {})
    api<any>('GET', '/products/top').then((r) => setTop(r.products.map((p: any) => p.id))).catch(() => {})
  }, [])
  const sellable = useMemo(() => catalog.filter((p) => !soldOut.includes(p.id) && (p as Product & { sellable?: boolean }).sellable !== false), [catalog, soldOut])
  // "3*leche" → cantidad 3 y búsqueda "leche".
  const parsed = useMemo(() => { const m = q.match(/^\s*(\d+(?:[.,]\d+)?)\s*\*\s*(.*)$/); return m ? { qty: Number(m[1]!.replace(',', '.')), term: m[2]!.trim() } : { qty: 1, term: q.trim() } }, [q])
  type Hit = { key: string; label: string; sub: string; go: (qty: number) => void }
  const hits: Hit[] = useMemo(() => {
    const t = parsed.term.toLowerCase()
    if (!t) return []
    const out: Hit[] = []
    for (const sv of services) if (sv.name.toLowerCase().includes(t)) out.push({ key: sv.id, label: sv.name, sub: `servicio · ${mxn(sv.price)}`, go: (n) => addService(sv, n) })
    for (const p of sellable) {
      if (p.name.toLowerCase().includes(t) || p.barcode === parsed.term) out.push({ key: p.id, label: p.name, sub: `${mxn(p.price)} / ${unitLabel(p.unit)}${p.tiers?.length ? ` · mayoreo ${mxn(p.tiers[0]!.price)} desde ${p.tiers[0]!.minQuantity}` : ''}${p.stock !== undefined ? ` · hay ${p.stock}` : ''}`, go: (n) => add(p, undefined, n) })
      for (const pr of p.presentations) if (`${p.name} ${pr.name}`.toLowerCase().includes(t) || pr.barcode === parsed.term) out.push({ key: pr.id, label: `${p.name} ${pr.name}`, sub: mxn(pr.price), go: (n) => add(p, pr.id, n) })
    }
    return out.slice(0, 8)
  }, [parsed, sellable, services])
  useEffect(() => setPick(0), [q])
  // Botones rápidos (pantallas táctiles): lo más vendido primero; servicios arriba.
  const favorites = useMemo(() => [...sellable].sort((a, b) => (top.indexOf(a.id) + 1 || 999) - (top.indexOf(b.id) + 1 || 999)).slice(0, quick ? 24 : 12), [sellable, top])

  const subtotal = cart.reduce((a, l) => a + lineTotal(l), 0)
  const total = Math.max(0, subtotal - (discount?.amount ?? 0))
  const items = cart.reduce((a, l) => a + (l.amount !== undefined || l.unit !== 'pza' ? 1 : l.quantity), 0)

  const focusSearch = () => setTimeout(() => search.current?.focus(), 0)
  function add(p: Product, presentationId?: string, qty = 1) {
    if (!presentationId && p.unit !== 'pieza') return setModal({ kind: 'granel', p, qty })
    const pr = p.presentations.find((x) => x.id === presentationId)
    let key = ''
    setCart((c) => {
      const same = c.find((l) => l.productId === p.id && l.presentationId === presentationId && l.amount === undefined)
      if (same) { key = same.key; return c.map((l) => (l === same ? { ...l, quantity: l.quantity + qty } : l)) }
      key = crypto.randomUUID()
      return [...c, { key, productId: p.id, presentationId, name: pr ? `${p.name} ${pr.name}` : p.name, quantity: qty, unitPrice: pr ? pr.price : p.price, total: 0, unit: pr ? 'pza' : unitLabel(p.unit), ...(pr ? {} : { tiers: p.tiers }) }]
    })
    setTimeout(() => setSelLine(key), 0)
    setQ('')
    focusSearch()
  }
  function addService(sv: Service, qty = 1) {
    if (qty === 1 && hasGiro(me, 'papeleria')) return setModal({ kind: 'servicio', sv })
    setCart((c) => [...c, { key: crypto.randomUUID(), serviceId: sv.id, name: sv.name, quantity: qty, unitPrice: sv.price, total: 0, unit: 'pza', free: false }])
    setQ('')
    focusSearch()
  }

  // Lector de código de barras o Enter: código exacto primero; si no, la sugerencia elegida.
  const onEnter = (code = q) => {
    const m = code.match(/^\s*(\d+(?:[.,]\d+)?)\s*\*\s*(.*)$/)
    const qty = m ? Number(m[1]!.replace(',', '.')) : 1
    const t = (m ? m[2]! : code).trim()
    if (!t) { if (cart.length && code === q) setModal({ kind: 'cobro' }); return }
    const byCode = sellable.find((p) => p.barcode === t)
    if (byCode) return add(byCode, undefined, qty)
    for (const p of sellable) {
      const pr = p.presentations.find((x) => x.barcode === t)
      if (pr) return add(p, pr.id, qty)
    }
    if (code === q && hits[pick]) return hits[pick]!.go(qty)
    if (code !== q) { setQ(t); setMsg(`No hay ningún producto con el código ${t}.`) }
  }

  const setQtyTo = (key: string, n: number) => setCart((c) => c.flatMap((l) => (l.key !== key ? [l] : n <= 0 ? [] : [{ ...l, quantity: n }])))
  const removeLine = (key: string) => { setCart((c) => c.filter((l) => l.key !== key)); setSelLine(null) }
  const reset = () => { setCart([]); setDiscount(null); setCustomer(null); setStaffId(''); setMsg(''); setSelLine(null) }

  const hold = () => {
    if (!cart.length) return setModal({ kind: 'espera' })
    const h: Held = { id: crypto.randomUUID(), at: new Date().toISOString(), cart, discount, customer, staffId }
    const next = [...held, h]
    setHeld(next); cache.set('held', next); reset(); setMsg(`Venta puesta en espera (${next.length}).`); focusSearch()
  }
  const recall = (h: Held) => {
    let next = held.filter((x) => x.id !== h.id)
    if (cart.length) next = [...next, { id: crypto.randomUUID(), at: new Date().toISOString(), cart, discount, customer, staffId }]
    setHeld(next); cache.set('held', next)
    setCart(h.cart); setDiscount(h.discount); setCustomer(h.customer); setStaffId(h.staffId); setModal(null); setMsg(''); focusSearch()
  }

  const charge = async (method: string, extra: { cashReceived?: number; customerId?: string; authCode?: string; otherPayments?: { method: string; amount: number }[] } = {}) => {
    const id = crypto.randomUUID()
    const body = {
      id, shiftId: shift!.id, paymentMethod: method, createdAt: new Date().toISOString(),
      items: cart.map((l) => (l.serviceId ? { serviceId: l.serviceId, quantity: l.quantity } : l.free ? { description: l.name, quantity: l.quantity, unitPrice: l.unitPrice } : { productId: l.productId, presentationId: l.presentationId, ...(l.amount !== undefined ? { amount: l.amount } : { quantity: l.quantity }) })),
      ...(discount ? { discount: discount.amount, authCode: discount.code } : {}),
      ...(staffId ? { staffId } : {}),
      ...(customer && !extra.customerId ? { customerId: customer.id } : {}),
      ...extra,
    }
    const needsCode = !!discount || !!extra.authCode
    await flush()
    let sale: any = null
    let loyalty: Loyalty | null = null
    if (outbox.pending() === 0) {
      try {
        const r = await api<any>('POST', '/sales', body, { 'idempotency-key': id })
        sale = r.sale; loyalty = r.loyalty ?? null
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
      text = [me.business.name, me.business.phone ? `Tel. ${me.business.phone}` : '', 'Folio provisional (sin internet)', new Date().toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short', hour12: true, timeZone: 'America/Mexico_City' }), '-'.repeat(32),
        ...cart.map((l) => `${l.quantity} ${l.name}`.slice(0, 22).padEnd(22) + mxn(lineTotal(l)).padStart(10)), '-'.repeat(32),
        `TOTAL ${mxn(total)}`, `Pago: ${method}`, `Atendió: ${me.user.name}`].filter(Boolean).join('\n')
    }
    const cashPart = total - (extra.otherPayments ?? []).reduce((a, p) => a + p.amount, 0)
    setModal({ kind: 'ticket', text, change: extra.cashReceived !== undefined ? (sale?.change ?? extra.cashReceived - cashPart) : null, provisional: !sale, loyalty })
    reset()
  }

  // Atajos de teclado (solo sin ventanas abiertas).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!shift) return
      if (modal) { if (e.key === 'Escape' && modal.kind !== 'ticket') setModal(null); return }
      const act: Record<string, () => void> = {
        F2: () => search.current?.focus(),
        F3: () => setModal({ kind: 'cliente' }),
        F4: () => { if (can(me, 'cancel_discount') && cart.length) setModal({ kind: 'descuento' }) },
        F6: hold,
        F7: () => { if (can(me, 'open_close_cash')) setModal({ kind: 'mov' }) },
        F8: () => setModal({ kind: 'libre' }),
        F9: () => setModal({ kind: 'ventas' }),
        F10: () => { if (cart.length) setModal({ kind: 'cobro' }) },
      }
      if (act[e.key]) { e.preventDefault(); act[e.key]!(); return }
      if (e.key === 'Escape') { if (q) setQ(''); else if (cart.length) setModal({ kind: 'cancelar' }); return }
      // Con el buscador vacío: flechas eligen renglón; + y − cambian cantidad; Supr lo quita.
      const typing = document.activeElement === search.current && q !== ''
      if (typing || !cart.length) return
      const idx = cart.findIndex((l) => l.key === selLine)
      const line = cart[idx]
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (document.activeElement !== search.current && document.activeElement?.tagName === 'INPUT') return
        e.preventDefault()
        const n = idx < 0 ? cart.length - 1 : Math.max(0, Math.min(cart.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))
        setSelLine(cart[n]!.key)
      } else if (line && (e.key === '+' || e.key === '-') && document.activeElement === search.current) {
        e.preventDefault()
        if (line.amount === undefined && line.unit === 'pza') setQtyTo(line.key, line.quantity + (e.key === '+' ? 1 : -1))
      } else if (line && e.key === 'Delete') {
        e.preventDefault(); removeLine(line.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!loaded && !shift) return <p className="muted">Cargando caja…</p>
  if (!shift) return <OpenShift meals={hasGiro(me, 'comedor')} onOpen={(s) => { setShift(s); cache.set('shift', s) }} />

  const K = ({ k }: { k: string }) => <kbd>{k}</kbd>
  return (
    <div className="pos-screen">
      <section className="pos-main">
        <div className="pos-search">
          <div className="row">
            <input
              ref={search} autoFocus placeholder="Código o nombre del producto · 3*código para varios" value={q} data-testid="buscar" aria-label="Buscar producto"
              onChange={(e) => { setQ(e.target.value); setMsg('') }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); onEnter() }
                else if (q && e.key === 'ArrowDown') { e.preventDefault(); setPick((p) => Math.min(p + 1, hits.length - 1)) }
                else if (q && e.key === 'ArrowUp') { e.preventDefault(); setPick((p) => Math.max(p - 1, 0)) }
              }}
            />
            <ScanButton onCode={(c) => onEnter(c)} />
          </div>
          {q.trim() && (
            <div className="suggest" role="listbox" aria-label="Productos encontrados">
              {hits.map((h, i) => <button key={h.key} role="option" aria-selected={i === pick} className={i === pick ? 'on' : ''} onMouseEnter={() => setPick(i)} onClick={() => h.go(parsed.qty)}><span>{parsed.qty !== 1 ? `${parsed.qty} × ` : ''}{h.label}</span><small>{h.sub}</small></button>)}
              {hits.length === 0 && <p className="muted" style={{ margin: 0, padding: '10px 12px' }}>Nada coincide. Usa <b>Artículo común ({KEYS.libre})</b> para cobrar algo que no está en la lista.</p>}
            </div>
          )}
        </div>

        <div className="ticket-table card">
          <table>
            <thead><tr><th className="hide-sm">#</th><th>Descripción</th><th className="num">Cant.</th><th className="num hide-sm">Precio</th><th className="num">Importe</th><th /></tr></thead>
            <tbody>
              {cart.map((l, i) => (
                <tr key={l.key} className={selLine === l.key ? 'sel' : ''} onClick={() => setSelLine(l.key)}>
                  <td className="muted hide-sm">{i + 1}</td>
                  <td>{l.name}{l.amount !== undefined && <><br /><small className="muted">por importe</small></>}{isWholesale(l) && <><br /><span className="tag">mayoreo</span></>}</td>
                  <td className="num">{l.amount === undefined && l.unit === 'pza'
                    ? <div className="qty"><button onClick={(e) => { e.stopPropagation(); setQtyTo(l.key, l.quantity - 1) }} aria-label={`Menos ${l.name}`}>−</button><input className="qty-in" aria-label={`Cantidad de ${l.name}`} inputMode="numeric" value={l.quantity} onClick={(e) => e.stopPropagation()} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0) setQtyTo(l.key, n || 0.0001) }} onBlur={(e) => { if (!(Number(e.target.value) > 0)) removeLine(l.key) }} onKeyDown={(e) => e.key === 'Enter' && focusSearch()} /><button onClick={(e) => { e.stopPropagation(); setQtyTo(l.key, l.quantity + 1) }} aria-label={`Más ${l.name}`}>+</button></div>
                    : `${l.amount !== undefined ? '' : `${l.quantity} ${l.unit}`}`}</td>
                  <td className="num hide-sm">{l.amount === undefined ? mxn(linePrice(l)) : ''}</td>
                  <td className="num"><b>{mxn(lineTotal(l))}</b></td>
                  <td className="num"><button className="mini" aria-label={`Quitar ${l.name}`} onClick={(e) => { e.stopPropagation(); removeLine(l.key) }}>✕</button></td>
                </tr>
              ))}
              {cart.length === 0 && <tr><td colSpan={6} className="empty">Escanea un código o escribe el nombre del producto y presiona Enter.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="quick-grid">
          <div className="card-head"><h3>{services.length ? 'Servicios y productos' : 'Productos más vendidos'}</h3><span className="muted small">toca para agregar</span></div>
          <div className="results">
            {services.slice(0, 12).map((sv) => <button key={sv.id} onClick={() => addService(sv)}>{sv.name}<small>{mxn(sv.price)}{sv.durationMin ? ` · ${sv.durationMin} min` : ''}</small></button>)}
            {favorites.map((p) => <button key={p.id} onClick={() => add(p)}>{p.name}<small>{mxn(p.price)} / {unitLabel(p.unit)}{p.stock !== undefined ? ` · hay ${p.stock}` : ''}</small></button>)}
            <button onClick={() => setModal({ kind: 'libre' })}>➕ Artículo común<small>escribe descripción y precio</small></button>
          </div>
        </div>
      </section>

      <aside className="pos-side card">
        <div className="pos-chips">
          <button className="chip" onClick={() => setModal({ kind: 'cliente' })}>👤 {customer ? customer.name : 'Público en general'} <K k={KEYS.cliente} /></button>
          {customer && can(me, 'give_stamps') && me.modules?.includes('fidelidad') && <button className="chip" onClick={async () => {
            const n = Number(prompt(`¿Cuántos sellos le das a ${customer.name}?`, '1'))
            if (!(n > 0)) return
            try { const r = await api<{ loyalty: Loyalty | null }>('POST', `/customers/${customer.id}/stamps`, { quantity: Math.floor(n) }); setMsg(r.loyalty ? loyaltyText(r.loyalty) : 'Listo.') } catch (e) { setMsg((e as Error).message) }
          }}>⭐ Dar sello</button>}
          {held.length > 0 && <button className="chip" onClick={() => setModal({ kind: 'espera' })}>⏸ En espera: {held.length}</button>}
        </div>
        {withStaff && <label>¿Quién atendió?<select value={staffId} onChange={(e) => setStaffId(e.target.value)}><option value="">— Nadie (sin comisión) —</option>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        <div className="pos-total">
          <span className="muted">{items} {items === 1 ? 'artículo' : 'artículos'}</span>
          {discount && <span className="muted">Subtotal {mxn(subtotal)} · descuento {mxn(-discount.amount)}</span>}
          <div className="total" data-testid="total">{mxn(total)}</div>
        </div>
        {msg && <p className={msg.startsWith('Venta puesta') ? 'okmsg' : 'error'}>{msg}</p>}
        <button className="primary big cobrar" disabled={!cart.length} onClick={() => setModal({ kind: 'cobro' })}>Cobrar <K k={KEYS.cobrar} /></button>
        <div className="pos-actions">
          <button onClick={hold}>{cart.length ? 'Apartar venta' : 'Ventas apartadas'} <K k={KEYS.espera} /></button>
          {can(me, 'cancel_discount') && <button disabled={!cart.length} onClick={() => setModal({ kind: 'descuento' })}>Descuento <K k={KEYS.descuento} /></button>}
          <button onClick={() => setModal({ kind: 'libre' })}>Artículo común <K k={KEYS.libre} /></button>
          <button onClick={() => setModal({ kind: 'ventas' })}>Ventas del turno <K k={KEYS.ventas} /></button>
          {can(me, 'open_close_cash') && <button onClick={() => setModal({ kind: 'mov' })}>Meter o sacar dinero <K k={KEYS.mov} /></button>}
          {hasGiro(me, 'papeleria') && can(me, 'open_close_cash') && <button onClick={() => setModal({ kind: 'contador' })}>Contador copiadora</button>}
          <button disabled={!cart.length} onClick={() => setModal({ kind: 'cancelar' })}>Cancelar venta <K k="Esc" /></button>
          {can(me, 'open_close_cash') && <button className="corte" onClick={() => setModal({ kind: 'corte' })}>Corte de caja</button>}
        </div>
      </aside>

      {modal?.kind === 'granel' && <Granel p={modal.p} onClose={() => setModal(null)} onAdd={(l) => { setCart((c) => [...c, l]); setModal(null); setQ(''); focusSearch() }} />}
      {modal?.kind === 'servicio' && <Cantidad sv={modal.sv} onClose={() => setModal(null)} onAdd={(l) => { setCart((c) => [...c, l]); setModal(null); setQ(''); focusSearch() }} />}
      {modal?.kind === 'contador' && <Contador shift={shift} onClose={() => setModal(null)} />}
      {modal?.kind === 'libre' && <Libre onClose={() => setModal(null)} onAdd={(l) => { setCart((c) => [...c, l]); setModal(null); focusSearch() }} />}
      {modal?.kind === 'descuento' && <Descuento max={subtotal} onClose={() => setModal(null)} onSet={(d) => { setDiscount(d); setModal(null) }} />}
      {modal?.kind === 'cobro' && <Cobro total={total} fiado={fiadoOk} onClose={() => { setModal(null); focusSearch() }} onFiado={() => setModal({ kind: 'fiado' })} onPay={(method, extra) => { setModal(null); void charge(method, extra) }} />}
      {modal?.kind === 'fiado' && <Pago method="fiado" total={total} customers={customers} preselect={customer?.id} onClose={() => setModal(null)} onPay={(extra) => { setModal(null); void charge('fiado', extra) }} />}
      {modal?.kind === 'cliente' && <ElegirCliente customers={customers} onClose={() => setModal(null)} onPick={(c) => { setCustomer(c); setModal(null); focusSearch() }} />}
      {modal?.kind === 'espera' && (
        <Modal onClose={() => setModal(null)}>
          <h2>Ventas en espera</h2>
          {held.length === 0 ? <p className="muted">No hay ventas en espera. Con una venta a medias, presiona {KEYS.espera} para apartarla y atender a otro cliente.</p> : (
            <div className="table-wrap"><table className="list"><tbody>{held.map((h) => (
              <tr key={h.id} className="clickable" onClick={() => recall(h)}>
                <td><b>{h.customer?.name ?? 'Público en general'}</b><br /><small className="muted">{new Date(h.at).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Mexico_City' })} · {h.cart.length} renglones</small></td>
                <td className="num">{mxn(Math.max(0, h.cart.reduce((a, l) => a + lineTotal(l), 0) - (h.discount?.amount ?? 0)))}</td>
                <td className="num"><button className="mini">Recuperar</button></td>
              </tr>
            ))}</tbody></table></div>
          )}
          <p><button onClick={() => setModal(null)}>Cerrar</button></p>
        </Modal>
      )}
      {modal?.kind === 'cancelar' && (
        <Modal onClose={() => setModal(null)}>
          <h2>¿Cancelar esta venta?</h2>
          <p className="muted">Se borra la cuenta actual ({items} artículos, {mxn(total)}). No se cobró nada.</p>
          <p className="row"><button autoFocus onClick={() => setModal(null)}>No, seguir</button><button className="danger" onClick={() => { reset(); setModal(null); focusSearch() }}>Sí, cancelar</button></p>
        </Modal>
      )}
      {modal?.kind === 'ticket' && (
        <Modal onClose={() => { setModal(null); focusSearch() }}>
          <h2>Venta cobrada</h2>
          {modal.change != null && <div className="total">Cambio: {mxn(modal.change)}</div>}
          {modal.provisional && <p className="muted">Sin internet: la venta se guardó en este equipo y se enviará sola.</p>}
          {modal.loyalty && <p className="okmsg">{loyaltyText(modal.loyalty)}</p>}
          <pre style={{ fontSize: 14, background: 'var(--bg)', padding: 10, borderRadius: 8, overflowX: 'auto' }}>{modal.text}</pre>
          <div className="ticket">{modal.text}</div>
          <div className="row">
            <button className="big" onClick={() => window.print()}>Imprimir ticket</button>
            <button className="primary big" autoFocus onClick={() => { setModal(null); focusSearch() }}>Nueva venta</button>
          </div>
        </Modal>
      )}
      {modal?.kind === 'mov' && <Movimiento shift={shift} onClose={() => setModal(null)} />}
      {modal?.kind === 'ventas' && <VentasTurno shift={shift} me={me} onClose={() => setModal(null)} />}
      {modal?.kind === 'corte' && <Corte shift={shift} onClose={() => setModal(null)} onClosed={() => { setShift(null); cache.set('shift', null); setModal(null) }} />}
    </div>
  )
}

/** Cobro: efectivo (con cambio), tarjeta, transferencia, mixto o fiado. Enter cobra. */
function Cobro({ total, fiado, onPay, onFiado, onClose }: { total: number; fiado: boolean; onPay: (method: string, extra: { cashReceived?: number; otherPayments?: { method: string; amount: number }[] }) => void; onFiado: () => void; onClose: () => void }) {
  const [mode, setMode] = useState<'efectivo' | 'tarjeta' | 'transferencia' | 'mixto'>('efectivo')
  const [r, setR] = useState('')
  const [card, setCard] = useState('')
  const [transfer, setTransfer] = useState('')
  const others = mode === 'mixto' ? [{ method: 'tarjeta', amount: toCents(card || '0') }, { method: 'transferencia', amount: toCents(transfer || '0') }].filter((p) => p.amount > 0) : []
  const othersTotal = others.reduce((a, p) => a + p.amount, 0)
  const cashDue = mode === 'efectivo' ? total : mode === 'mixto' ? total - othersTotal : 0
  const received = r.trim() === '' ? cashDue : parseAmount(r) ?? 0
  const ok = mode === 'tarjeta' || mode === 'transferencia' ? true : cashDue >= 0 && received >= cashDue && (mode === 'efectivo' || othersTotal > 0)
  const pay = () => {
    if (!ok) return
    if (mode === 'tarjeta' || mode === 'transferencia') return onPay(mode, {})
    onPay('efectivo', { ...(cashDue > 0 ? { cashReceived: received } : {}), ...(others.length ? { otherPayments: others } : {}) })
  }
  const quickBills = [2000, 5000, 10000, 20000, 50000, 100000].filter((v) => v >= cashDue).slice(0, 4)
  const TAB: [typeof mode, string][] = [['efectivo', 'Efectivo'], ['tarjeta', 'Tarjeta'], ['transferencia', 'Transferencia'], ['mixto', 'Mixto']]
  return (
    <Modal onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); pay() }}>
        <div className="card-head"><h2>Cobrar</h2><span className="total" style={{ margin: 0 }}>{mxn(total)}</span></div>
        <div className="tabs">{TAB.map(([k, v]) => <button type="button" key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{v}</button>)}{fiado && <button type="button" onClick={onFiado}>Fiado</button>}</div>
        {mode === 'mixto' && (
          <div className="row">
            <label>Con tarjeta<input inputMode="decimal" value={card} onChange={(e) => setCard(e.target.value)} placeholder="$0.00" autoFocus /></label>
            <label>Con transferencia<input inputMode="decimal" value={transfer} onChange={(e) => setTransfer(e.target.value)} placeholder="$0.00" /></label>
          </div>
        )}
        {(mode === 'efectivo' || mode === 'mixto') && (<>
          {mode === 'mixto' && <p className="muted">Resto en efectivo: <b>{cashDue >= 0 ? mxn(cashDue) : '—'}</b></p>}
          {cashDue < 0 && <p className="error">Con tarjeta y transferencia ya pasa del total.</p>}
          {cashDue > 0 && (<>
            <label>¿Con cuánto paga?<input inputMode="decimal" autoFocus={mode === 'efectivo'} value={r} onChange={(e) => setR(e.target.value)} placeholder={mxn(cashDue)} /></label>
            <div className="quick">
              <button type="button" onClick={() => setR(String(cashDue / 100))}>Exacto</button>
              {quickBills.map((v) => <button type="button" key={v} onClick={() => setR(String(v / 100))}>{mxn(v).replace('.00', '')}</button>)}
            </div>
            <h2 style={{ marginTop: 12 }}>Cambio: {received >= cashDue ? mxn(received - cashDue) : '—'}</h2>
            {received < cashDue && <p className="error">Falta {mxn(cashDue - received)}</p>}
          </>)}
        </>)}
        {(mode === 'tarjeta' || mode === 'transferencia') && <p className="muted">Cobra {mxn(total)} con {mode === 'tarjeta' ? 'la terminal' : 'transferencia'} y confirma cuando se haya pagado.</p>}
        <p className="row"><button type="button" onClick={onClose}>Regresar</button><button className="primary big" disabled={!ok} autoFocus={mode === 'tarjeta' || mode === 'transferencia'}>Cobrar {mode === 'mixto' ? 'mixto' : ''}</button></p>
      </form>
    </Modal>
  )
}

function ElegirCliente({ customers, onPick, onClose }: { customers: Customer[]; onPick: (c: Customer | null) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const list = customers.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 10)
  return (
    <Modal onClose={onClose}>
      <h2>Cliente de la venta</h2>
      <label>Buscar<input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre del cliente…" onKeyDown={(e) => e.key === 'Enter' && list[0] && onPick(list[0])} /></label>
      <div className="results">
        <button onClick={() => onPick(null)}>Público en general<small>sin cliente</small></button>
        {list.map((c) => <button key={c.id} onClick={() => onPick(c)}>{c.name}</button>)}
      </div>
      {customers.length === 0 && <p className="muted small">Da de alta clientes en «Clientes» para fiarles o darles puntos.</p>}
    </Modal>
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
  // Propone el mismo fondo de la última vez en este equipo.
  const [amount, setAmount] = useState(() => cache.get<string>('lastFloat', ''))
  const [meal, setMeal] = useState(() => { const h = new Date().getHours(); return h < 12 ? 'desayuno' : h < 18 ? 'comida' : 'cena' })
  const [err, setErr] = useState('')
  const open = async () => {
    const cents = parseAmount(amount)
    if (cents == null) return setErr('Escribe con cuánto dinero abres (puede ser 0).')
    const id = crypto.randomUUID()
    const body = { id, openingFloat: cents, at: new Date().toISOString(), ...(meals ? { meal } : {}) }
    cache.set('lastFloat', String(cents / 100))
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
      <p className="muted">Cuenta el dinero con el que empiezas el turno.{amount ? ' Te propusimos el de la última vez.' : ''}</p>
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
      ? { key: crypto.randomUUID(), productId: p.id, name: p.name, quantity: n, unitPrice: p.price, total: preview, unit: u, tiers: p.tiers }
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

function Pago({ method, total, customers, preselect, onPay, onClose }: { method: string; total: number; customers: Customer[]; preselect?: string; onPay: (e: { cashReceived?: number; customerId?: string }) => void; onClose: () => void }) {
  const [r, setR] = useState('')
  const [cust, setCust] = useState(preselect ?? '')
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
      <h2>Meter o sacar dinero de la caja</h2>
      <div className="tabs"><button className={type === 'retiro' ? 'on' : ''} onClick={() => setType('retiro')}>Sacar (salida)</button><button className={type === 'deposito' ? 'on' : ''} onClick={() => setType('deposito')}>Meter (entrada)</button></div>
      <label>Monto<input inputMode="decimal" value={a} onChange={(e) => setA(e.target.value)} placeholder="$0.00" autoFocus /></label>
      <label>Motivo<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type === 'retiro' ? 'Ej. retiro del dueño, pago al gas' : 'Ej. cambio que trajo el dueño'} /></label>
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
        <div className="table-wrap"><table className="list"><tbody>
          {list.map((s) => (
            <tr key={s.id}>
              <td>#{s.folio}<br /><small className="muted">{new Date(s.createdAt).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Mexico_City' })} · {s.paymentMethod}</small></td>
              <td className="num">{s.status === 'cancelada' ? <s>{mxn(s.total)}</s> : mxn(s.total)}</td>
              <td>{s.status === 'completada' && can(me, 'cancel_discount') ? <button onClick={() => cancel(s.id)}>Cancelar</button> : <small className="muted">{s.status}</small>}</td>
            </tr>
          ))}
        </tbody></table></div>
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
  const [step, setStep] = useState<'elegir' | 'x' | 'contar' | 'verificar'>('elegir')
  const [xReport, setXReport] = useState<any>(null)
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
        <h2>Caja cerrada{result.report ? ` · Corte Z #${result.report.number}` : ''}</h2>
        {result.pending ? <p>Sin internet: el corte se enviará solo al reconectar.</p> : (
          <>
            <p className="row"><span>Efectivo esperado</span><b className="num">{mxn(result.totals.expectedCash)}</b></p>
            <p className="row"><span>Contado</span><b className="num">{mxn(result.shift.counted_cash)}</b></p>
            <p className="row"><span>Diferencia</span><b className="num" style={{ color: result.difference ? 'var(--danger)' : 'var(--ok)' }}>{mxn(result.difference)}</b></p>
            {result.report && <><pre className="report">{result.report.text}</pre><div className="ticket">{result.report.text}</div></>}
          </>
        )}
        <p className="row">{result.report && <button className="big" onClick={() => window.print()}>Imprimir corte Z</button>}<button className="primary big" onClick={onClosed}>Listo</button></p>
      </Modal>
    )
  }

  if (step === 'elegir') {
    return (
      <Modal onClose={onClose}>
        <h2>Corte de caja</h2>
        <div className="choice">
          <button className="big" onClick={async () => { setBusy(true); setErr(''); try { await flush(); setXReport((await api<any>('POST', `/shifts/${shift.id}/x-report`)).report); setStep('x') } catch (e) { setErr((e as Error).message) } setBusy(false) }} disabled={busy}>
            <b>Corte X</b><small>Ver cómo va la caja. No la cierra; se puede sacar las veces que quieras.</small>
          </button>
          <button className="big" onClick={() => setStep('contar')}>
            <b>Corte Z</b><small>Contar el dinero y cerrar el turno. Es el corte final del día o del turno.</small>
          </button>
        </div>
        {err && <p className="error">{err}</p>}
        <p><button onClick={onClose}>Regresar</button></p>
      </Modal>
    )
  }

  if (step === 'x' && xReport) {
    return (
      <Modal onClose={onClose}>
        <h2>Corte X #{xReport.number} · la caja sigue abierta</h2>
        <div className="kpis mini">
          <div><span className="muted">Ventas</span><b>{mxn(xReport.salesTotal)}</b></div>
          <div><span className="muted">Tickets</span><b>{xReport.tickets}</b></div>
          <div><span className="muted">Debe haber en caja</span><b>{mxn(xReport.totals.expectedCash)}</b></div>
        </div>
        <pre className="report">{xReport.text}</pre>
        <div className="ticket">{xReport.text}</div>
        <p className="row"><button className="big" onClick={() => window.print()}>Imprimir corte X</button><button className="primary big" onClick={onClose}>Seguir vendiendo</button></p>
      </Modal>
    )
  }

  if (step === 'contar') {
    return (
      <Modal onClose={onClose}>
        <h2>Corte Z · 1. Cuenta el dinero</h2>
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
      <h2>Corte Z · 2. Verificación</h2>
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
        <div className="table-wrap"><table className="list statement"><tbody>
          <tr><td>Fondo inicial</td><td className="num">{mxn(t.openingFloat)}</td></tr>
          <tr><td>Ventas en efectivo</td><td className="num">{mxn(t.cashSales)}</td></tr>
          {t.tipsCash > 0 && <tr><td>Propinas en efectivo</td><td className="num">{mxn(t.tipsCash)}</td></tr>}
          <tr><td>Depósitos y abonos</td><td className="num">{mxn(t.deposits)}</td></tr>
          <tr><td>Retiros y pagos desde la caja</td><td className="num">{mxn(-t.withdrawals)}</td></tr>
          <tr className="total"><td>Debe haber en caja</td><td className="num">{mxn(t.expectedCash)}</td></tr>
          <tr className="muted"><td>No es efectivo: transferencia · tarjeta · fiado</td><td className="num">{mxn(t.transferSales)} · {mxn(t.cardSales)} · {mxn(t.creditSales)}</td></tr>
        </tbody></table></div>
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
      <div className="table-wrap"><table className="list"><thead><tr><th>Equipo</th><th className="num">Contador</th><th className="num">Cobradas</th><th className="num">Diferencia</th></tr></thead>
        <tbody>{report.map((r) => <tr key={r.machineId}><td>{r.name}</td><td className="num">{r.counted ?? '—'}</td><td className="num">{r.sold}</td><td className="num" style={{ color: r.difference ? 'var(--danger)' : undefined }}>{r.difference ?? '—'}</td></tr>)}</tbody></table></div>
      <p><button onClick={onClose}>Cerrar</button></p>
    </Modal>
  )
}
