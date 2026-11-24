import { useEffect, useRef, useState } from 'react'
import { api, ApiError, mxn, toCents } from '../api'
import { type Me } from '../App'
import { ask, confirmAsk } from '../Dialog'

/**
 * Finanzas inteligentes, en lenguaje de todos los días.
 * Mi dinero: cuánto entró, cuánto salió, cuánto se ganó de verdad, cuánto hay, cuánto hay que apartar y cuánto se puede retirar.
 * Reparto: el dueño decide sus propias partidas y porcentajes. Retiros: cada salida del dueño queda registrada.
 * El servidor hace todos los cálculos (src/finanzas.ts); aquí solo se muestran.
 */

export const KIND_LABEL: Record<string, string> = { operacion: 'Operación', gastos: 'Gastos', nomina: 'Nómina', ahorro: 'Ahorro', reinversion: 'Reinversión', inversion: 'Inversiones', retiro: 'Retiro del dueño', otro: 'Otro' }
const BASE_LABEL: Record<string, string> = { ganancia: 'La ganancia real', ganancia_bruta: 'La ganancia bruta (ventas menos lo que costó lo vendido)', ventas: 'Las ventas' }
const CATEGORIAS = ['Sueldo del dueño', 'Gastos personales', 'Inversión', 'Ahorro personal', 'Préstamo', 'Otro']

type Resumen = {
  vendido: number; entro: number; salio: number; gananciaReal: number; retiradoPeriodo: number; disponible: number; libre: number; retirable: number
  porReservar: { total: number; partes: { key: string; label: string; amount: number; why: string }[] }
  sugerido: { monto: number; motivos: string[] }
  plan: null | { name: string; baseLabel: string; base: number; lines: { name: string; kind: string; mode: string; value: number; amount: number }[]; notes: string[] }
  avisos: string[]
}

function Card({ label, value, tone, how, big }: { label: string; value: string; tone?: 'pos' | 'neg'; how: string; big?: boolean }) {
  return (
    <div className={`card kpi${big ? ' kpi-main' : ''}`}>
      <div className="label">{label}</div>
      <div className={`value ${tone ?? ''}`}>{value}</div>
      <details className="how"><summary>¿Cómo se calcula?</summary><p className="muted small">{how}</p></details>
    </div>
  )
}

export function MiDinero({ me, from, to, go }: { me: Me; from: string; to: string; go: (t: 'reparto' | 'retiros') => void }) {
  const [r, setR] = useState<Resumen | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { setR(null); api<Resumen>('GET', `/finanzas/resumen?from=${from}&to=${to}`).then((x) => { setR(x); setErr('') }).catch((e) => setErr((e as Error).message)) }, [from, to])
  if (err) return <p className="error">{err}</p>
  if (!r) return <p className="muted">Calculando…</p>
  const parte = (kinds: string[]) => r.plan?.lines.filter((l) => kinds.includes(l.kind)).reduce((a, l) => a + l.amount, 0) ?? null
  const ahorro = parte(['ahorro', 'reinversion', 'inversion'])
  return (
    <>
      {r.avisos.map((a) => <p key={a} className="notice">{a}</p>)}
      <div className="kpis">
        <Card label="Vendiste" value={mxn(r.vendido)} how="Lo que vendiste en el periodo, ya sin devoluciones. Todavía no es ganancia, ni siempre es dinero en mano (el fiado se cuenta cuando lo cobras)." />
        <Card label="Entró dinero" value={mxn(r.entro)} how="Lo que realmente se cobró: ventas en efectivo, tarjeta y transferencia, abonos de fiado, anticipos y depósitos a caja." />
        <Card label="Salió dinero" value={mxn(r.salio)} how="Lo que realmente se pagó: proveedores, gastos, pagos al personal, devoluciones y retiros (de caja y los que registras aquí)." />
        <Card label="Ganancia real" value={mxn(r.gananciaReal)} tone={r.gananciaReal < 0 ? 'neg' : 'pos'} how="Lo vendido, menos lo que costó lo vendido, menos gastos, comisiones y mermas. Es lo que el negocio ganó de verdad, aunque parte siga por cobrar." />
      </div>
      <div className="kpis">
        <Card label="Dinero disponible" value={mxn(r.disponible)} tone={r.disponible < 0 ? 'neg' : undefined} how="Todo lo que ha entrado menos todo lo que ha salido, según lo que has registrado en NEXORA (efectivo y banco). Si registraste saldos iniciales en «Saldos», parte de ahí. No incluye dinero que no hayas capturado." />
        <Card label="Por reservar" value={mxn(r.porReservar.total)} how="Lo que debes apartar antes de pensar en retirar: pagos a proveedores, personal pendiente, anticipos de clientes, gastos fijos y reposición de inventario." />
        <Card big label="Puedes retirar" value={mxn(r.retirable)} tone="pos" how="Lo menor entre (dinero disponible − por reservar) y la ganancia del periodo que aún no has retirado. Así no te llevas el capital del negocio." />
        {ahorro !== null && <Card label="Para ahorrar o reinvertir" value={mxn(ahorro)} how={`Según tu reparto «${r.plan!.name}»: la suma de tus partidas de ahorro, reinversión e inversiones.`} />}
      </div>
      <div className="grid2">
        <section className="card">
          <h2>Antes de retirar, aparta</h2>
          <div className="table-wrap"><table className="list statement"><tbody>
            {r.porReservar.partes.map((p) => <tr key={p.key}><td>{p.label}<br /><small className="muted">{p.why}</small></td><td className="num">{mxn(p.amount)}</td></tr>)}
            <tr className="total"><td>Total por reservar</td><td className="num">{mxn(r.porReservar.total)}</td></tr>
          </tbody></table></div>
        </section>
        <section className="card">
          <h2>Retiro sugerido <span className="muted small">(opcional)</span></h2>
          <div className="plan-amount">{mxn(r.sugerido.monto)}</div>
          <ul className="plan-reasons">{r.sugerido.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
          <div className="row chips">
            {me.access?.manage && <button className="primary" onClick={() => go('retiros')}>Registrar un retiro</button>}
            <button onClick={() => go('reparto')}>{r.plan ? `Reparto: ${r.plan.name}` : 'Elegir cómo repartir'}</button>
          </div>
          {r.retiradoPeriodo > 0 && <p className="muted small">En este periodo ya retiraste {mxn(r.retiradoPeriodo)}.</p>}
        </section>
      </div>
      {r.plan && (
        <section className="card">
          <h2>Tu reparto: {r.plan.name}</h2>
          <p className="muted small">Sobre {r.plan.baseLabel}: {mxn(r.plan.base)}</p>
          <div className="table-wrap"><table className="list statement"><tbody>
            {r.plan.lines.map((l) => <tr key={l.name}><td>{l.name} <small className="muted">· {KIND_LABEL[l.kind]}{l.mode === 'pct' ? ` · ${l.value} %` : ''}</small></td><td className="num">{mxn(l.amount)}</td></tr>)}
          </tbody></table></div>
          {r.plan.notes.map((n) => <p key={n} className="error">{n}</p>)}
        </section>
      )}
    </>
  )
}

// ---------------------------------------------------------------- Reparto

type Item = { name: string; kind: string; mode: 'pct' | 'monto'; value: number }
type Plan = { id: string; name: string; base: string; items: Item[]; active: boolean; legacy: boolean }
const PLANTILLAS: { label: string; hint: string; items: Item[] }[] = [
  { label: 'En blanco', hint: 'Tú pones las partidas.', items: [{ name: 'Operación', kind: 'operacion', mode: 'pct', value: 100 }] },
  { label: 'Ejemplo: 50 / 30 / 20', hint: 'Una regla popular; es solo un ejemplo, cámbiala como quieras.', items: [{ name: 'Operación', kind: 'operacion', mode: 'pct', value: 50 }, { name: 'Dueño', kind: 'retiro', mode: 'pct', value: 30 }, { name: 'Ahorro', kind: 'ahorro', mode: 'pct', value: 20 }] },
  { label: 'Ejemplo: crecer el negocio', hint: 'Más para reinvertir.', items: [{ name: 'Operación', kind: 'operacion', mode: 'pct', value: 50 }, { name: 'Reinversión', kind: 'reinversion', mode: 'pct', value: 25 }, { name: 'Dueño', kind: 'retiro', mode: 'pct', value: 15 }, { name: 'Ahorro', kind: 'ahorro', mode: 'pct', value: 10 }] },
]

export function Reparto({ me, from, to }: { me: Me; from: string; to: string }) {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [edit, setEdit] = useState<{ id?: string; name: string; base: string; items: Item[] } | null>(null)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const manage = !!me.access?.manage
  const load = () => api<{ plans: Plan[] }>('GET', '/finanzas/planes').then((r) => setPlans(r.plans)).catch((e) => setMsg({ err: (e as Error).message }))
  useEffect(() => { void load() }, [])
  const run = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); setMsg({ ok }); await load() } catch (e) { setMsg({ err: (e as Error).message }) } }
  if (!plans) return <p className="muted">{msg.err ?? 'Cargando…'}</p>
  return (
    <div className="stack">
      <p className="muted">Aquí decides cómo repartir lo que gana tu negocio. Nada viene impuesto: crea tu reparto, guarda los que quieras y usa el que más te sirva.</p>
      {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
      {plans.length === 0 && <section className="card"><p>Todavía no tienes un reparto. Empieza con una plantilla o en blanco.</p></section>}
      {plans.map((p) => (
        <section key={p.id} className="card">
          <div className="card-head">
            <h2>{p.name} {p.active && <span className="estado ok">En uso</span>} {p.legacy && <span className="estado info">Histórico</span>}</h2>
          </div>
          <p className="muted small">Se reparte {BASE_LABEL[p.base]?.toLowerCase()}.</p>
          <ul className="plan-reasons">{p.items.map((i) => <li key={i.name}>{i.name}: {i.mode === 'pct' ? `${i.value} %` : mxn(i.value)} <span className="muted">({KIND_LABEL[i.kind]})</span></li>)}</ul>
          {manage && (
            <div className="row chips">
              {p.active
                ? <button onClick={run(() => api('POST', `/finanzas/planes/${p.id}/activar`, { active: false }), 'Dejaste de usar este reparto.')}>Dejar de usar</button>
                : <button className="primary" onClick={run(() => api('POST', `/finanzas/planes/${p.id}/activar`, { active: true }), `Ahora usas «${p.name}».`)}>Usar este</button>}
              {!p.legacy && <button onClick={() => setEdit({ id: p.id, name: p.name, base: p.base, items: p.items.map((i) => ({ ...i })) })}>Editar</button>}
              <button onClick={() => setEdit({ name: `${p.name} (copia)`.slice(0, 40), base: p.base, items: p.items.map((i) => ({ ...i })) })}>Duplicar</button>
              {!p.legacy && <button className="danger" onClick={async () => { if (await confirmAsk('¿Borrar este reparto?', p.name, true)) await run(() => api('DELETE', `/finanzas/planes/${p.id}`), 'Reparto borrado.')() }}>Borrar</button>}
            </div>
          )}
        </section>
      ))}
      {manage && !edit && (
        <section className="card">
          <h2>Crear un reparto nuevo</h2>
          <div className="row chips">{PLANTILLAS.map((t) => <button key={t.label} title={t.hint} onClick={() => setEdit({ name: '', base: 'ganancia', items: t.items.map((i) => ({ ...i })) })}>{t.label}</button>)}</div>
        </section>
      )}
      {edit && <Editor me={me} plan={edit} from={from} to={to} onCancel={() => setEdit(null)} onSaved={async (m) => { setEdit(null); setMsg({ ok: m }); await load() }} />}
    </div>
  )
}

function Editor({ plan, from, to, onCancel, onSaved }: { me: Me; plan: { id?: string; name: string; base: string; items: Item[] }; from: string; to: string; onCancel: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useState(plan.name)
  const [base, setBase] = useState(plan.base)
  const [items, setItems] = useState(plan.items)
  const [text, setText] = useState<string[]>(plan.items.map((i) => (i.mode === 'pct' ? String(i.value) : (i.value / 100).toFixed(2))))
  const [view, setView] = useState<{ base: number; lines: { amount: number }[]; notes: string[]; ok: boolean } | null>(null)
  const [err, setErr] = useState('')
  const seq = useRef(0)
  const norm = (): Item[] => items.map((i, k) => ({ ...i, value: i.mode === 'pct' ? Math.max(0, Math.min(100, Math.round(Number(text[k]) || 0))) : Math.max(0, toCents(text[k] ?? '0') || 0) }))
  const cur = norm()
  const pcts = cur.filter((i) => i.mode === 'pct')
  const sum = pcts.reduce((a, i) => a + i.value, 0)
  // Recalcula en vivo (el servidor es quien reparte) cada vez que algo cambia.
  useEffect(() => {
    const n = ++seq.current
    const t = setTimeout(() => { api<any>('POST', '/finanzas/planes/vista', { base, items: cur, from, to }).then((v) => { if (n === seq.current) setView(v) }).catch(() => {}) }, 250)
    return () => clearTimeout(t)
  }, [JSON.stringify(cur), base])
  const setItem = (k: number, patch: Partial<Item>) => setItems(items.map((x, i) => (i === k ? { ...x, ...patch } : x)))
  const sumOk = pcts.length === 0 || sum === 100
  const save = async () => {
    try {
      const body = { name, base, items: cur }
      if (plan.id) await api('PUT', `/finanzas/planes/${plan.id}`, body); else await api('POST', '/finanzas/planes', body)
      onSaved(`Reparto «${name}» guardado.`)
    } catch (e) { setErr((e as Error).message) }
  }
  return (
    <section className="card">
      <h2>{plan.id ? 'Editar reparto' : 'Nuevo reparto'}</h2>
      <label>Nombre<input value={name} maxLength={40} placeholder="Ej. Mi reparto" onChange={(e) => setName(e.target.value)} /></label>
      <label>¿Qué se reparte?<select value={base} onChange={(e) => setBase(e.target.value)}>{Object.entries(BASE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <div className="stack">
        {items.map((it, k) => (
          <div key={k} className="reparto-row">
            <input aria-label="Nombre de la partida" value={it.name} maxLength={40} onChange={(e) => setItem(k, { name: e.target.value })} />
            <select aria-label="Tipo de partida" value={it.kind} onChange={(e) => setItem(k, { kind: e.target.value })}>{Object.entries(KIND_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <select aria-label="Porcentaje o monto" value={it.mode} onChange={(e) => { setItem(k, { mode: e.target.value as 'pct' | 'monto' }); setText(text.map((t, i) => (i === k ? '0' : t))) }}><option value="pct">%</option><option value="monto">$ fijo</option></select>
            <input aria-label="Valor" inputMode="decimal" value={text[k] ?? ''} onChange={(e) => setText(text.map((t, i) => (i === k ? e.target.value : t)))} />
            <b className="num">{view ? mxn(view.lines[k]?.amount ?? 0) : '…'}</b>
            <button className="mini" aria-label="Quitar partida" onClick={() => { setItems(items.filter((_, i) => i !== k)); setText(text.filter((_, i) => i !== k)) }}>Quitar</button>
          </div>
        ))}
      </div>
      <p><button onClick={() => { setItems([...items, { name: '', kind: 'otro', mode: 'pct', value: 0 }]); setText([...text, '0']) }} disabled={items.length >= 12}>+ Agregar partida</button></p>
      <p className={sumOk ? 'okmsg' : 'error'}>{pcts.length === 0 ? 'Solo montos fijos.' : sum === 100 ? 'Los porcentajes suman 100 %.' : sum < 100 ? `Suman ${sum} %: faltan ${100 - sum} %.` : `Suman ${sum} %: te pasas por ${sum - 100} %.`}</p>
      {view && <p className="muted small">Con tus números de este periodo se reparten {mxn(view.base)}.</p>}
      {view?.notes.filter((n) => !/Faltan|pasas/.test(n)).map((n) => <p key={n} className="error">{n}</p>)}
      {err && <p className="error">{err}</p>}
      <div className="row chips"><button className="primary" disabled={!sumOk || name.trim().length < 2 || items.some((i) => !i.name.trim())} onClick={save}>Guardar reparto</button><button onClick={onCancel}>Cancelar</button></div>
    </section>
  )
}

// ---------------------------------------------------------------- Retiros

export function Retiros({ me, from, to }: { me: Me; from: string; to: string }) {
  const [list, setList] = useState<{ withdrawals: any[]; total: number } | null>(null)
  const [r, setR] = useState<Resumen | null>(null)
  const [f, setF] = useState({ amount: '', category: CATEGORIAS[0]!, reason: '', method: 'efectivo' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const manage = !!me.access?.manage
  const load = async () => {
    const [a, b] = await Promise.all([api<any>('GET', `/finanzas/retiros?from=${from}&to=${to}`), api<Resumen>('GET', `/finanzas/resumen?from=${from}&to=${to}`)])
    setList(a); setR(b)
  }
  useEffect(() => { void load().catch((e) => setMsg({ err: (e as Error).message })) }, [from, to])
  const send = async (force = false) => {
    try {
      await api('POST', '/finanzas/retiros', { amount: toCents(f.amount), category: f.category, reason: f.reason, method: f.method, ...(force ? { force: true } : {}) })
      setF({ ...f, amount: '', reason: '' }); setMsg({ ok: 'Retiro registrado.' }); await load()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'excede_retirable') { if (await confirmAsk('Es más de lo que conviene retirar', `${e.message} ¿Registrarlo de todos modos?`, true)) await send(true) }
      else setMsg({ err: (e as Error).message })
    }
  }
  const rechazar = async () => {
    const why = await ask({ title: 'No usar la sugerencia', hint: 'Si quieres, anota por qué (opcional).', label: 'Motivo', confirmLabel: 'Listo' })
    if (why === null) return
    try { await api('POST', '/finanzas/sugerencia/rechazar', { amount: r?.sugerido.monto ?? 0, reason: why || undefined }); setMsg({ ok: 'Anotado. No se registró ningún retiro.' }) } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  return (
    <div className="stack">
      {r && (
        <section className="card">
          <h2>Retiro sugerido <span className="muted small">(tú decides)</span></h2>
          <div className="plan-amount">{mxn(r.sugerido.monto)}</div>
          <ul className="plan-reasons">{r.sugerido.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
          {manage && <div className="row chips">
            <button className="primary" disabled={r.sugerido.monto <= 0} onClick={() => setF({ ...f, amount: (r.sugerido.monto / 100).toFixed(2), reason: f.reason || 'Retiro sugerido' })}>Aceptar</button>
            <button onClick={() => document.getElementById('retiro-monto')?.focus()}>Cambiar el monto</button>
            <button onClick={rechazar}>No, gracias</button>
          </div>}
        </section>
      )}
      {manage && (
        <section className="card">
          <h2>Registrar un retiro</h2>
          <label>Monto<input id="retiro-monto" inputMode="decimal" placeholder="$0.00" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
          <label>¿Para qué es?<input list="cats-retiro" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /><datalist id="cats-retiro">{CATEGORIAS.map((c) => <option key={c} value={c} />)}</datalist></label>
          <label>Motivo<input value={f.reason} maxLength={200} placeholder="Ej. Sueldo de la semana" onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
          <label>¿De dónde sale?<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}><option value="efectivo">Efectivo (de la caja)</option><option value="transferencia">Transferencia / banco</option></select></label>
          <p className="muted small">Queda anotado con fecha, quién lo hizo, categoría y motivo.</p>
          <button className="primary big" disabled={!(toCents(f.amount) > 0) || f.reason.trim().length < 3} onClick={() => void send()}>Registrar retiro</button>
        </section>
      )}
      {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
      <section className="card">
        <h2>Retiros del periodo {list && <span className="muted small">· {mxn(list.total)}</span>}</h2>
        <div className="table-wrap"><table className="list"><tbody>
          {list?.withdrawals.map((w) => <tr key={w.id}><td><b>{w.category}</b>{w.exceeded ? <span className="estado warn"> pasó lo sugerido</span> : null}<br /><small className="muted">{w.reason} · {w.date} · {w.responsible} · {w.method === 'efectivo' ? 'efectivo' : 'banco'}</small></td><td className="num">{mxn(w.amount)}</td></tr>)}
          {list && list.withdrawals.length === 0 && <tr><td className="empty">No hay retiros en este periodo.</td></tr>}
        </tbody></table></div>
      </section>
    </div>
  )
}
