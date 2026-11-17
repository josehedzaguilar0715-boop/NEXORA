import { useEffect, useState } from 'react'
import { ScanButton } from '../Scanner'
import { api, mxn } from '../api'
import type { Me } from '../App'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())

/** Taquilla: boletos por tipo, fecha y horario, sin vender de más. */
export function Taquilla(_: { me: Me }) {
  const [date, setDate] = useState(today())
  const [slots, setSlots] = useState<any[]>([])
  const [types, setTypes] = useState<any[]>([])
  const [start, setStart] = useState('')
  const [qty, setQty] = useState<Record<string, number>>({})
  const [token, setToken] = useState('')
  const [last, setLast] = useState<any>(null)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => {
    setSlots((await api<any>('GET', `/tourism/slots?date=${date}`)).slots)
    setTypes((await api<any>('GET', '/services')).services.filter((s: any) => s.active && s.category === 'boleto'))
  }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [date])
  const total = types.reduce((a, t) => a + (qty[t.id] ?? 0) * t.price, 0)
  const sell = async (paymentMethod: string) => {
    try {
      const r = await api<any>('POST', '/tourism/sell', { id: crypto.randomUUID(), date, start, paymentMethod, items: Object.entries(qty).filter(([, q]) => q > 0).map(([serviceId, quantity]) => ({ serviceId, quantity })) })
      setLast(r); setQty({}); setMsg({ ok: `Vendidos ${r.tickets.length} boletos: ${mxn(r.sale.total)}` }); void load()
    } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const payOnline = async (paymentMethod: string) => {
    try { const r = await api<any>('POST', `/tourism/orders/${token.trim()}/pay`, { paymentMethod }); setMsg({ ok: `Compra en línea pagada: ${r.paid} boletos, ${mxn(r.sale.total)}` }); setToken('') } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  return (
    <div className="grid2">
      <section className="card">
        <label>Día<input type="date" value={date} onChange={(e) => { setDate(e.target.value); setStart('') }} /></label>
        <h3 style={{ marginTop: 12 }}>Horario</h3>
        <div className="results">{slots.map((s) => (
          <button key={s.start} disabled={s.closed || s.available === 0} className={start === s.start ? 'primary' : ''} onClick={() => setStart(s.start)}>{s.start}–{s.end}<small>{s.closed ? 'Cerrado' : `${s.available} lugares`}</small></button>
        ))}</div>
        {slots.length === 0 && <p className="muted">No hay horarios para este día. Configúralos en <a href="#/configurar">Configurar negocio → Horarios y aforo</a>.</p>}
        <h3 style={{ marginTop: 12 }}>Boletos</h3>
        <div className="table-wrap"><table className="list"><tbody>{types.map((t) => (
          <tr key={t.id}><td>{t.name}<br /><small className="muted">{mxn(t.price)}</small></td>
            <td><div className="qty"><button onClick={() => setQty({ ...qty, [t.id]: Math.max(0, (qty[t.id] ?? 0) - 1) })}>−</button><b style={{ minWidth: 40, textAlign: 'center' }}>{qty[t.id] ?? 0}</b><button onClick={() => setQty({ ...qty, [t.id]: (qty[t.id] ?? 0) + 1 })}>+</button></div></td></tr>
        ))}</tbody></table></div>
        {types.length === 0 && <p className="muted">No hay tipos de boleto. Agrégalos en <a href="#/configurar">Configurar negocio → Tipos de boleto</a>.</p>}
        <div className="total">{mxn(total)}</div>
        <div className="pay">
          <button className="primary big" disabled={!start || !total} onClick={() => sell('efectivo')}>Efectivo</button>
          <button className="big" disabled={!start || !total} onClick={() => sell('transferencia')}>Transferencia</button>
          <button className="big" disabled={!start || !total} onClick={() => sell('tarjeta')}>Tarjeta</button>
        </div>
        {msg.err && <p className="error">{msg.err}</p>}
        {msg.ok && <p className="okmsg">{msg.ok}</p>}
        <h3 style={{ marginTop: 16 }}>Cobrar compra en línea</h3>
        <div className="row"><input aria-label="Folio de compra en línea" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Folio de la compra" /><button style={{ flex: '0 0 auto' }} disabled={!token} onClick={() => payOnline('efectivo')}>Efectivo</button><button style={{ flex: '0 0 auto' }} disabled={!token} onClick={() => payOnline('transferencia')}>Transferencia</button></div>
      </section>
      <section className="card">
        <h2>Boletos impresos</h2>
        {!last ? <p className="muted">Aquí aparecen los códigos para imprimir.</p> : (
          <>
            <div className="results">{last.tickets.map((t: any) => <div key={t.code} className="card" style={{ textAlign: 'center' }}><img alt={`QR ${t.code}`} src={`/api/public/ticket-qr/${t.code}.svg`} width={140} height={140} /><div>{t.type}</div><small className="muted">{t.code}</small></div>)}</div>
            <p><button onClick={() => window.print()}>Imprimir</button></p>
          </>
        )}
      </section>
    </div>
  )
}

/** Control de acceso con QR y aforo en tiempo real. */
export function Acceso(_: { me: Me }) {
  const [code, setCode] = useState('')
  const [inside, setInside] = useState(0)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = () => api<any>('GET', '/tourism/occupancy').then((r) => setInside(r.inside)).catch(() => {})
  useEffect(() => { void load(); const t = setInterval(load, 10_000); return () => clearInterval(t) }, [])
  const scan = async (c = code) => {
    try { const r = await api<any>('POST', '/tourism/scan', { code: c }); setInside(r.occupancy); setMsg({ ok: `✔ Adelante (${r.type})` }) } catch (e) { setMsg({ err: `✘ ${(e as Error).message}` }) }
    setCode('')
  }
  const exit = async (n: number) => { try { setInside((await api<any>('POST', '/tourism/exit', { count: n })).occupancy) } catch (e) { setMsg({ err: (e as Error).message }) } }
  return (
    <div className="card login" style={{ maxWidth: 640 }}>
      <h1>Personas adentro: {inside}</h1>
      <label>Escanea el boleto</label>
      <div className="row"><input aria-label="Código del boleto" autoFocus value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && code && scan()} /><ScanButton onCode={(c) => scan(c)} /></div>
      {msg.ok && <h2 className="okmsg" style={{ fontSize: '1.8rem' }}>{msg.ok}</h2>}
      {msg.err && <h2 className="error" style={{ fontSize: '1.4rem' }}>{msg.err}</h2>}
      <div className="row" style={{ marginTop: 12 }}><button className="big" onClick={() => exit(1)}>Salió 1</button><button className="big" onClick={() => exit(5)}>Salieron 5</button></div>
    </div>
  )
}

/** Tienda pública de boletos (venta anticipada). */
export function TiendaBoletos({ code }: { code: string }) {
  const [date, setDate] = useState(today())
  const [info, setInfo] = useState<any>(null)
  const [f, setF] = useState({ start: '', name: '', phone: '' })
  const [qty, setQty] = useState<Record<string, number>>({})
  const [err, setErr] = useState('')
  useEffect(() => { api(`GET`, `/public/tickets-shop/${code}?date=${date}`).then(setInfo).catch((e) => setErr(e.message)) }, [date])
  const buy = async () => {
    try {
      const r = await api<any>('POST', `/public/tickets-shop/${code}`, { date, start: f.start, name: f.name, phone: f.phone, items: Object.entries(qty).filter(([, q]) => q > 0).map(([serviceId, quantity]) => ({ serviceId, quantity })) })
      location.href = `/mis-boletos/${r.token}`
    } catch (e) { setErr((e as Error).message) }
  }
  if (!info) return <main className="login">{err ? <p className="error">{err}</p> : <p className="muted">Cargando…</p>}</main>
  const total = info.types.reduce((a: number, t: any) => a + (qty[t.id] ?? 0) * t.price, 0)
  return (
    <main className="login" style={{ maxWidth: 720 }}>
      <h1>{info.business.name}</h1>
      <div className="card">
        <label>Día de tu visita<input type="date" min={today()} value={date} onChange={(e) => { setDate(e.target.value); setF({ ...f, start: '' }) }} /></label>
        <div className="results" style={{ marginTop: 8 }}>{info.slots.map((s: any) => <button key={s.start} disabled={!s.available} className={f.start === s.start ? 'primary' : ''} onClick={() => setF({ ...f, start: s.start })}>{s.start}–{s.end}<small>{s.available} lugares</small></button>)}</div>
        <div className="table-wrap"><table className="list" style={{ marginTop: 8 }}><tbody>{info.types.map((t: any) => (
          <tr key={t.id}><td>{t.name} · {mxn(t.price)}</td><td><div className="qty"><button onClick={() => setQty({ ...qty, [t.id]: Math.max(0, (qty[t.id] ?? 0) - 1) })}>−</button><b style={{ minWidth: 40, textAlign: 'center' }}>{qty[t.id] ?? 0}</b><button onClick={() => setQty({ ...qty, [t.id]: (qty[t.id] ?? 0) + 1 })}>+</button></div></td></tr>
        ))}</tbody></table></div>
        <div className="total">{mxn(total)}</div>
        <label>Nombre<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Teléfono (10 dígitos)<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        {err && <p className="error">{err}</p>}
        <p><button className="primary big" style={{ width: '100%' }} disabled={!f.start || !total || f.name.trim().length < 2} onClick={buy}>Apartar boletos</button></p>
        <p className="muted">Se pagan en efectivo o por transferencia. Recibirás un QR por boleto.</p>
      </div>
    </main>
  )
}

export function MisBoletos({ token }: { token: string }) {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api('GET', `/public/tickets/${token}`).then(setD).catch((e) => setErr(e.message)) }, [token])
  if (!d) return <main className="login">{err ? <p className="error">{err}</p> : <p className="muted">Cargando…</p>}</main>
  return (
    <main className="login" style={{ maxWidth: 720 }}>
      <h1>{d.business}</h1>
      <p className="muted">Folio para pagar en taquilla: <b>{token}</b></p>
      <div className="results">{d.tickets.map((t: any) => (
        <div key={t.code} className="card" style={{ textAlign: 'center' }}>
          <img alt={`QR ${t.code}`} src={`/api/public/ticket-qr/${t.code}.svg`} width={160} height={160} />
          <div><b>{t.type}</b></div>
          <small className="muted">{t.date} {t.start} · {t.status === 'por_pagar' ? 'por pagar' : t.status}</small>
        </div>
      ))}</div>
    </main>
  )
}
