import { Fragment, useEffect, useState } from 'react'
import { api, auth, mxn, toCents } from '../api'
import type { Me } from '../App'

/** Finanzas y contabilidad: estado de resultados, flujo de efectivo, balance, gastos y libro de movimientos. */

const tz = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(d)
const today = () => tz(new Date())
const shift = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

const PRESETS: { key: string; label: string; range: () => [string, string] }[] = [
  { key: 'hoy', label: 'Hoy', range: () => [today(), today()] },
  { key: 'semana', label: 'Esta semana', range: () => { const t = today(); const dow = (new Date(`${t}T12:00:00Z`).getUTCDay() + 6) % 7; return [shift(t, -dow), t] } },
  { key: 'mes', label: 'Este mes', range: () => [`${today().slice(0, 8)}01`, today()] },
  { key: 'mesant', label: 'Mes pasado', range: () => { const first = `${today().slice(0, 8)}01`; const end = shift(first, -1); return [`${end.slice(0, 8)}01`, end] } },
  { key: 'anio', label: 'Este año', range: () => [`${today().slice(0, 4)}-01-01`, today()] },
]

export const CATEGORIES: Record<string, string> = {
  renta: 'Renta', servicios: 'Luz, agua, gas, internet y teléfono', nomina: 'Sueldos', insumos: 'Insumos y limpieza', transporte: 'Transporte y gasolina',
  mantenimiento: 'Mantenimiento', publicidad: 'Publicidad', impuestos: 'Impuestos y permisos', comisiones_bancarias: 'Comisiones bancarias', otros: 'Otros',
}
const METHOD: Record<string, string> = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta' }
const FLOW: Record<string, string> = { ventas: 'Ventas cobradas', cobranza: 'Cobro de fiado', aportaciones: 'Depósitos a caja', proveedores: 'Pagos a proveedores', gastos: 'Gastos', devoluciones: 'Devoluciones a clientes', retiros: 'Retiros de caja' }
const pct = (n: number | null) => (n == null ? '—' : `${(n * 100).toFixed(1)} %`)
const fmtDate = (d: string) => new Date(`${d}T12:00:00-06:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })

async function download(kind: string, from: string, to: string) {
  const res = await fetch(`/api/accounting/export?kind=${kind}&from=${from}&to=${to}`, { headers: { authorization: `Bearer ${auth.token}` } })
  if (!res.ok) throw new Error('No se pudo exportar.')
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = `nexora-${kind}-${from}-a-${to}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

type Tab = 'resumen' | 'resultados' | 'flujo' | 'balance' | 'gastos' | 'movimientos'
const TABS: [Tab, string][] = [['resumen', 'Resumen'], ['resultados', 'Estado de resultados'], ['flujo', 'Flujo de efectivo'], ['balance', 'Balance'], ['gastos', 'Gastos'], ['movimientos', 'Movimientos']]

export function Finanzas(_: { me: Me }) {
  const [tab, setTab] = useState<Tab>('resumen')
  const [preset, setPreset] = useState('mes')
  const [[from, to], setRange] = useState<[string, string]>(PRESETS[2]!.range())
  const [err, setErr] = useState('')
  const pick = (k: string) => { setPreset(k); const p = PRESETS.find((x) => x.key === k); if (p) setRange(p.range()) }
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Finanzas</h1>
          <p className="muted">{tab === 'balance' ? `Al día de hoy, ${fmtDate(today())}` : `${fmtDate(from)} — ${fmtDate(to)}`}</p>
        </div>
        {tab !== 'balance' && (
          <div className="period">
            <div className="seg">{PRESETS.map((p) => <button key={p.key} className={preset === p.key ? 'on' : ''} onClick={() => pick(p.key)}>{p.label}</button>)}
              <button className={preset === 'custom' ? 'on' : ''} onClick={() => setPreset('custom')}>Otro</button></div>
            {preset === 'custom' && <div className="row dates"><input type="date" aria-label="Desde" value={from} max={to} onChange={(e) => setRange([e.target.value, to])} /><input type="date" aria-label="Hasta" value={to} min={from} onChange={(e) => setRange([from, e.target.value])} /></div>}
          </div>
        )}
      </header>
      <nav className="subtabs" aria-label="Secciones de finanzas">{TABS.map(([k, v]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{v}</button>)}</nav>
      {err && <p className="error">{err}</p>}
      {tab === 'resumen' && <Resumen from={from} to={to} onErr={setErr} go={setTab} />}
      {tab === 'resultados' && <Resultados from={from} to={to} onErr={setErr} />}
      {tab === 'flujo' && <Flujo from={from} to={to} onErr={setErr} />}
      {tab === 'balance' && <Balance onErr={setErr} />}
      {tab === 'gastos' && <Gastos from={from} to={to} onErr={setErr} />}
      {tab === 'movimientos' && <Movimientos from={from} to={to} onErr={setErr} />}
      <p className="muted small" style={{ marginTop: 18 }}>Contabilidad administrativa para decidir mejor. Para declaraciones ante el SAT, comparte las exportaciones con tu contador.</p>
    </div>
  )
}

function useLoad<T>(path: string, deps: unknown[], onErr: (e: string) => void) {
  const [data, setData] = useState<T | null>(null)
  const reload = () => api<T>('GET', path).then((d) => { setData(d); onErr('') }).catch((e) => onErr((e as Error).message))
  useEffect(() => { setData(null); void reload() }, deps)
  return [data, reload] as const
}

function Delta({ now, before, invert }: { now: number; before: number; invert?: boolean }) {
  if (!before) return <span className="delta muted">—</span>
  const d = (now - before) / Math.abs(before)
  const good = invert ? d <= 0 : d >= 0
  return <span className={`delta ${good ? 'pos' : 'neg'}`}>{d >= 0 ? '▲' : '▼'} {Math.abs(d * 100).toFixed(0)} %</span>
}

function Resumen({ from, to, onErr, go }: { from: string; to: string; onErr: (e: string) => void; go: (t: Tab) => void }) {
  const [is] = useLoad<any>(`/accounting/income-statement?from=${from}&to=${to}`, [from, to], onErr)
  const [cf] = useLoad<any>(`/accounting/cash-flow?from=${from}&to=${to}`, [from, to], onErr)
  const [bal] = useLoad<any>('/accounting/balance', [], onErr)
  const c = is?.current, p = is?.previous
  const max = Math.max(1, c?.netSales ?? 0, (c?.costOfSales ?? 0) + (c?.operatingExpenses ?? 0))
  return (
    <>
      <div className="kpis">
        <div className="card kpi"><div className="label">Ventas netas</div><div className="value">{c ? mxn(c.netSales) : '—'}</div><div className="hint">{c && (p.netSales ? <><Delta now={c.netSales} before={p.netSales} /> vs. periodo anterior</> : 'sin datos del periodo anterior')}</div></div>
        <div className="card kpi"><div className="label">Utilidad neta</div><div className={`value ${c && c.netProfit < 0 ? 'neg' : ''}`}>{c ? mxn(c.netProfit) : '—'}</div><div className="hint">margen {c ? pct(c.netMargin) : '—'}{c && p.netProfit ? <> · <Delta now={c.netProfit} before={p.netProfit} /></> : null}</div></div>
        <div className="card kpi"><div className="label">Flujo de efectivo</div><div className={`value ${cf && cf.net < 0 ? 'neg' : 'pos'}`}>{cf ? `${cf.net >= 0 ? '+' : ''}${mxn(cf.net)}` : '—'}</div><div className="hint">entró {cf ? mxn(cf.totalIn) : '—'} · salió {cf ? mxn(cf.totalOut) : '—'}</div></div>
        <div className="card kpi"><div className="label">Ticket promedio</div><div className="value">{c ? mxn(c.averageTicket) : '—'}</div><div className="hint">{c ? `${c.tickets} ventas` : ''}</div></div>
      </div>
      <div className="grid2">
        <section className="card">
          <div className="card-head"><h2>¿A dónde se fue cada peso?</h2><button className="link" onClick={() => go('resultados')}>Ver estado de resultados →</button></div>
          {c && (
            <div className="bars">
              <Bar label="Ventas netas" value={c.netSales} max={max} tone="in" />
              <Bar label="Costo de lo vendido" value={c.costOfSales} max={max} tone="cost" />
              <Bar label="Gastos" value={c.expenses} max={max} tone="out" />
              {c.waste > 0 && <Bar label="Mermas" value={c.waste} max={max} tone="out" />}
              {c.commissions > 0 && <Bar label="Comisiones" value={c.commissions} max={max} tone="out" />}
              <Bar label="Utilidad neta" value={c.netProfit} max={max} tone={c.netProfit >= 0 ? 'profit' : 'loss'} />
            </div>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>Situación hoy</h2><button className="link" onClick={() => go('balance')}>Ver balance →</button></div>
          {bal && (
            <table className="list statement"><tbody>
              <tr><td>Efectivo en cajas abiertas</td><td className="num">{mxn(bal.cashInRegisters)}</td></tr>
              <tr><td>Mercancía (a costo)</td><td className="num">{mxn(bal.inventory)}</td></tr>
              <tr><td>Te deben (fiado)</td><td className="num">{mxn(bal.receivables)}</td></tr>
              <tr><td>Debes a proveedores</td><td className="num neg">−{mxn(bal.payables)}</td></tr>
              <tr className="total"><td>Valor del negocio</td><td className="num">{mxn(bal.equity)}</td></tr>
            </tbody></table>
          )}
        </section>
      </div>
    </>
  )
}

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  return (
    <div className="bar-row">
      <div className="bar-label"><span>{label}</span><b className="num">{mxn(value)}</b></div>
      <div className="bar-track"><div className={`bar-fill ${tone}`} style={{ width: `${Math.min(100, (Math.abs(value) / max) * 100)}%` }} /></div>
    </div>
  )
}

function Resultados({ from, to, onErr }: { from: string; to: string; onErr: (e: string) => void }) {
  const [is] = useLoad<any>(`/accounting/income-statement?from=${from}&to=${to}`, [from, to], onErr)
  if (!is) return <section className="card"><p className="muted">Cargando…</p></section>
  const c = is.current, p = is.previous
  const of = (n: number) => (c.netSales ? `${((n / c.netSales) * 100).toFixed(1)} %` : '')
  const line = (label: string, a: number, b: number, opts: { cls?: string; neg?: boolean; invert?: boolean } = {}) => (
    <tr className={opts.cls}>
      <td>{label}</td>
      <td className="num">{opts.neg ? mxn(-Math.abs(a)) : mxn(a)}</td>
      <td className="num muted hide-sm">{of(a)}</td>
      <td className="num muted hide-sm">{opts.neg ? mxn(-Math.abs(b)) : mxn(b)}</td>
      <td className="num hide-sm"><Delta now={a} before={b} invert={opts.invert} /></td>
    </tr>
  )
  const prevCat = (k: string) => p.expensesByCategory.find((x: any) => x.category === k)?.amount ?? 0
  return (
    <section className="card">
      <div className="card-head"><h2>Estado de resultados</h2><button onClick={() => download('resultados', from, to).catch((e) => onErr(e.message))}>⬇ Exportar a Excel</button></div>
      <table className="list statement">
        <thead><tr><th>Concepto</th><th className="num">Este periodo</th><th className="num hide-sm">% ventas</th><th className="num hide-sm">Periodo anterior</th><th className="num hide-sm">Cambio</th></tr></thead>
        <tbody>
          {line('Ventas', c.grossSales, p.grossSales)}
          {c.discounts > 0 && line('Descuentos', c.discounts, p.discounts, { cls: 'indent', neg: true, invert: true })}
          {c.refunds > 0 && line('Devoluciones', c.refunds, p.refunds, { cls: 'indent', neg: true, invert: true })}
          {line('Ventas netas', c.netSales, p.netSales, { cls: 'sub' })}
          {line('Costo de lo vendido', c.costOfSales, p.costOfSales, { cls: 'indent', neg: true, invert: true })}
          {line('Utilidad bruta', c.grossProfit, p.grossProfit, { cls: 'sub' })}
          <tr className="section"><td colSpan={5}>Gastos de operación</td></tr>
          {c.expensesByCategory.map((e: any) => <Fragment key={e.category}>{line(CATEGORIES[e.category] ?? e.category, e.amount, prevCat(e.category), { cls: 'indent', neg: true, invert: true })}</Fragment>)}
          {c.waste > 0 && line('Mermas', c.waste, p.waste, { cls: 'indent', neg: true, invert: true })}
          {c.commissions > 0 && line('Comisiones del personal', c.commissions, p.commissions, { cls: 'indent', neg: true, invert: true })}
          {line('Total de gastos', c.operatingExpenses, p.operatingExpenses, { cls: 'sub', neg: true, invert: true })}
          {line('Utilidad neta', c.netProfit, p.netProfit, { cls: `total ${c.netProfit < 0 ? 'neg' : ''}` })}
        </tbody>
      </table>
      <div className="kpis mini">
        <div><span className="muted">Margen bruto</span><b>{pct(c.grossMargin)}</b></div>
        <div><span className="muted">Margen neto</span><b>{pct(c.netMargin)}</b></div>
        <div><span className="muted">Ticket promedio</span><b>{mxn(c.averageTicket)}</b></div>
      </div>
      <p className="muted small">Periodo anterior: {fmtDate(p.from)} — {fmtDate(p.to)}. Las comisiones se cuentan al vender; no las registres también como gasto.</p>
    </section>
  )
}

function Flujo({ from, to, onErr }: { from: string; to: string; onErr: (e: string) => void }) {
  const [cf] = useLoad<any>(`/accounting/cash-flow?from=${from}&to=${to}`, [from, to], onErr)
  if (!cf) return <section className="card"><p className="muted">Cargando…</p></section>
  const group = (rows: any[]) => Object.entries(rows.reduce((a: Record<string, any[]>, r) => ({ ...a, [r.category]: [...(a[r.category] ?? []), r] }), {})) as [string, any[]][]
  const block = (title: string, rows: any[], total: number, sign: string) => (
    <section className="card">
      <h2>{title}</h2>
      <table className="list statement"><tbody>
        {group(rows).map(([k, rs]) => (
          <Fragment key={k}>
            <tr><td>{FLOW[k] ?? k}</td><td className="num">{sign}{mxn(rs.reduce((a, r) => a + r.amount, 0))}</td></tr>
            {rs.length > 1 && rs.map((r) => <tr key={r.method} className="indent muted"><td>{METHOD[r.method] ?? r.method}</td><td className="num">{mxn(r.amount)}</td></tr>)}
            {rs.length === 1 && <tr className="indent muted"><td>{METHOD[rs[0].method] ?? rs[0].method}</td><td /></tr>}
          </Fragment>
        ))}
        {rows.length === 0 && <tr><td className="muted">Sin movimientos.</td><td /></tr>}
        <tr className="total"><td>Total</td><td className="num">{sign}{mxn(total)}</td></tr>
      </tbody></table>
    </section>
  )
  return (
    <>
      <div className="kpis">
        <div className="card kpi"><div className="label">Flujo neto</div><div className={`value ${cf.net < 0 ? 'neg' : 'pos'}`}>{cf.net >= 0 ? '+' : ''}{mxn(cf.net)}</div><div className="hint">lo que entró menos lo que salió</div></div>
        <div className="card kpi"><div className="label">En efectivo</div><div className={`value ${cf.cashNet < 0 ? 'neg' : ''}`}>{cf.cashNet >= 0 ? '+' : ''}{mxn(cf.cashNet)}</div><div className="hint">caja</div></div>
        <div className="card kpi"><div className="label">En banco</div><div className={`value ${cf.bankNet < 0 ? 'neg' : ''}`}>{cf.bankNet >= 0 ? '+' : ''}{mxn(cf.bankNet)}</div><div className="hint">transferencias y tarjeta</div></div>
      </div>
      <div className="grid2">
        {block('Entradas de dinero', cf.inflows, cf.totalIn, '+')}
        {block('Salidas de dinero', cf.outflows, cf.totalOut, '−')}
      </div>
      <p className="muted small">El fiado no cuenta como dinero hasta que el cliente paga. Las compras a crédito cuentan cuando las pagas.</p>
    </>
  )
}

function Balance({ onErr }: { onErr: (e: string) => void }) {
  const [b] = useLoad<any>('/accounting/balance', [], onErr)
  if (!b) return <section className="card"><p className="muted">Cargando…</p></section>
  return (
    <>
      <div className="grid2">
        <section className="card">
          <h2>Lo que tiene el negocio</h2>
          <table className="list statement"><tbody>
            <tr><td>Efectivo en cajas abiertas<br /><small className="muted">{b.openRegisters} caja(s) abierta(s); sin propinas</small></td><td className="num">{mxn(b.cashInRegisters)}</td></tr>
            <tr><td>Mercancía en inventario<br /><small className="muted">a lo que te costó</small></td><td className="num">{mxn(b.inventory)}</td></tr>
            <tr><td>Cuentas por cobrar<br /><small className="muted">fiado de clientes</small></td><td className="num">{mxn(b.receivables)}</td></tr>
            <tr className="total"><td>Total</td><td className="num">{mxn(b.assets)}</td></tr>
          </tbody></table>
        </section>
        <section className="card">
          <h2>Lo que debe el negocio</h2>
          <table className="list statement"><tbody>
            <tr><td>Cuentas por pagar<br /><small className="muted">compras a crédito sin liquidar</small></td><td className="num">{mxn(b.payables)}</td></tr>
            <tr><td>Saldo a favor de clientes<br /><small className="muted">devoluciones como saldo</small></td><td className="num">{mxn(b.customerCredit)}</td></tr>
            <tr className="total"><td>Total</td><td className="num">{mxn(b.liabilities)}</td></tr>
          </tbody></table>
        </section>
      </div>
      <section className="card hero-total">
        <div><div className="muted">Capital (lo que tiene menos lo que debe)</div><div className={`value ${b.equity < 0 ? 'neg' : ''}`}>{mxn(b.equity)}</div></div>
        <p className="muted small">No incluye el dinero en el banco, el que guardas fuera de la caja ni el equipo (refrigeradores, mostradores…).</p>
      </section>
    </>
  )
}

function Gastos({ from, to, onErr }: { from: string; to: string; onErr: (e: string) => void }) {
  const [list, reload] = useLoad<any>(`/expenses?from=${from}&to=${to}`, [from, to], onErr)
  const empty = { concept: '', amount: '', category: 'otros', kind: 'variable', method: 'efectivo', fromCash: false, date: today() }
  const [f, setF] = useState(empty)
  const [ok, setOk] = useState('')
  const total = (list?.expenses ?? []).reduce((a: number, e: any) => a + e.amount, 0)
  const save = async () => {
    try {
      await api('POST', '/expenses', { id: crypto.randomUUID(), concept: f.concept, amount: toCents(f.amount), category: f.category, kind: f.kind, method: f.method, fromCash: f.method === 'efectivo' && f.fromCash, date: f.date })
      setF({ ...empty, category: f.category, method: f.method }); setOk('Gasto registrado.'); void reload()
    } catch (e) { onErr((e as Error).message) }
  }
  return (
    <div className="grid2" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)' }}>
      <section className="card">
        <h2>Registrar gasto</h2>
        <label>Concepto<input value={f.concept} onChange={(e) => setF({ ...f, concept: e.target.value })} placeholder="Ej. Recibo de luz de noviembre" /></label>
        <div className="row"><label>Importe<input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="$0.00" /></label><label>Fecha<input type="date" value={f.date} max={today()} onChange={(e) => setF({ ...f, date: e.target.value })} /></label></div>
        <label>Categoría<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <div className="row">
          <label>Tipo<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="variable">Variable</option><option value="fijo">Fijo (cada mes)</option></select></label>
          <label>Forma de pago<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        {f.method === 'efectivo' && <label className="check"><input type="checkbox" checked={f.fromCash} onChange={(e) => setF({ ...f, fromCash: e.target.checked })} />Lo pago con dinero de la caja abierta</label>}
        {ok && <p className="okmsg">{ok}</p>}
        <p><button className="primary" disabled={!(toCents(f.amount) > 0 && f.concept.trim().length >= 2)} onClick={save}>Guardar gasto</button></p>
      </section>
      <section className="card">
        <div className="card-head"><h2>Gastos del periodo</h2><button onClick={() => download('gastos', from, to).catch((e) => onErr(e.message))}>⬇ Exportar</button></div>
        <table className="list"><thead><tr><th>Fecha</th><th>Concepto</th><th className="num">Importe</th></tr></thead><tbody>
          {(list?.expenses ?? []).map((e: any) => <tr key={e.id}><td className="nowrap">{fmtDate(e.date)}</td><td>{e.concept}<br /><small className="muted">{CATEGORIES[e.category] ?? e.category} · {e.kind} · {METHOD[e.method] ?? e.method}</small></td><td className="num">{mxn(e.amount)}</td></tr>)}
          {list && list.expenses.length === 0 && <tr><td colSpan={3} className="muted">No hay gastos en este periodo.</td></tr>}
        </tbody>{total > 0 && <tfoot><tr className="total"><td colSpan={2}>Total</td><td className="num">{mxn(total)}</td></tr></tfoot>}</table>
      </section>
    </div>
  )
}

function Movimientos({ from, to, onErr }: { from: string; to: string; onErr: (e: string) => void }) {
  const [lg] = useLoad<any>(`/accounting/ledger?from=${from}&to=${to}`, [from, to], onErr)
  const [q, setQ] = useState('')
  const rows = (lg?.entries ?? []).filter((e: any) => !q || `${e.type} ${e.concept} ${e.method}`.toLowerCase().includes(q.toLowerCase()))
  let running = 0
  return (
    <section className="card">
      <div className="card-head">
        <h2>Libro de movimientos</h2>
        <div className="row" style={{ flex: '0 1 460px' }}><input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} /><button style={{ flex: '0 0 auto' }} onClick={() => download('movimientos', from, to).catch((e) => onErr(e.message))}>⬇ Exportar a Excel</button></div>
      </div>
      <div className="table-wrap">
        <table className="list ledger">
          <thead><tr><th>Fecha</th><th>Movimiento</th><th className="hide-sm">Forma</th><th className="num">Entrada</th><th className="num">Salida</th><th className="num hide-sm">Saldo</th></tr></thead>
          <tbody>{rows.map((e: any, i: number) => {
            running += e.inflow - e.outflow
            const d = new Date(e.at)
            return (
              <tr key={i}>
                <td className="nowrap">{d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}{e.type !== 'Gasto' && <><br /><small className="muted">{d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</small></>}</td>
                <td>{e.type}<br /><small className="muted">{e.concept}</small></td>
                <td className="hide-sm">{METHOD[e.method] ?? e.method}</td>
                <td className="num pos">{e.inflow ? mxn(e.inflow) : ''}</td>
                <td className="num neg">{e.outflow ? mxn(e.outflow) : ''}</td>
                <td className={`num hide-sm ${running < 0 ? 'neg' : ''}`}>{mxn(running)}</td>
              </tr>
            )
          })}
          {lg && rows.length === 0 && <tr><td colSpan={6} className="muted">Sin movimientos en este periodo.</td></tr>}
          </tbody>
          {lg && <tfoot><tr className="total"><td colSpan={3}>Totales</td><td className="num">{mxn(lg.totalIn)}</td><td className="num">{mxn(lg.totalOut)}</td><td className="num hide-sm">{mxn(lg.totalIn - lg.totalOut)}</td></tr></tfoot>}
        </table>
      </div>
    </section>
  )
}

