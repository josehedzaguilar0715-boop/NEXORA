import { useEffect, useState } from 'react'
import { api, mxn, toCents } from '../api'
import type { Me } from '../App'

/** Saldos: lo que hay en efectivo y en cada cuenta de banco. El saldo inicial se registra una vez; después solo ajustes con motivo. */
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())
const TIPO: Record<string, string> = { efectivo: 'Efectivo', banco: 'Cuenta de banco' }

export function Saldos({ me }: { me: Me }) {
  const [d, setD] = useState<any>(null)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const manage = !!me.access?.manage
  const load = () => api<any>('GET', '/finanzas/saldos').then(setD).catch((e) => setMsg({ err: (e as Error).message }))
  useEffect(() => { void load() }, [])
  const run = (fn: () => Promise<unknown>, ok: string) => async () => { try { await fn(); setMsg({ ok }); await load() } catch (e) { setMsg({ err: (e as Error).message }) } }
  const [ini, setIni] = useState({ accountType: 'efectivo', accountName: 'Efectivo', amount: '', date: today(), description: '' })
  const [con, setCon] = useState({ accountType: 'efectivo', accountName: 'Efectivo', counted: '', description: '' })
  const [aj, setAj] = useState({ accountType: 'banco', accountName: '', amount: '', description: '' })
  if (!d) return <p className="muted">{msg.err ?? 'Cargando…'}</p>
  return (
    <div className="stack">
      <p className="muted">Aquí le dices al sistema con cuánto dinero empezaste. Los movimientos anteriores a esa fecha no se vuelven a contar, así nada se duplica ni se mezcla con tus ventas nuevas.</p>
      {msg.err && <p className="error">{msg.err}</p>}{msg.ok && <p className="okmsg">{msg.ok}</p>}
      <div className="kpis">
        <div className="card kpi"><div className="label">Efectivo</div><div className="value">{mxn(d.efectivo)}</div><div className="hint">{d.since.efectivo ? `desde ${d.since.efectivo}` : 'sin saldo inicial'}</div></div>
        <div className="card kpi"><div className="label">Bancos (total)</div><div className="value">{mxn(d.banco)}</div><div className="hint">{d.since.banco ? `desde ${d.since.banco}` : 'sin saldo inicial'}</div></div>
        <div className="card kpi"><div className="label">Total</div><div className="value">{mxn(d.total)}</div></div>
      </div>
      {d.accounts.length > 0 && (
        <section className="card">
          <h2>Mis cuentas</h2>
          <div className="table-wrap cards-sm"><table className="list"><thead><tr><th>Cuenta</th><th className="num">Saldo inicial</th><th className="num">Ajustes</th></tr></thead><tbody>
            {d.accounts.map((a: any) => <tr key={`${a.type}${a.name}`}><td data-label="Cuenta"><b>{a.name}</b><br /><small className="muted">{TIPO[a.type]}</small></td><td data-label="Saldo inicial" className="num">{mxn(a.initial)}</td><td data-label="Ajustes" className="num">{mxn(a.adjustments)}</td></tr>)}
          </tbody></table></div>
          <p className="muted small">Las ventas, pagos y retiros se suman al total de efectivo o al total de bancos; el sistema no sabe de qué cuenta salió cada movimiento.</p>
        </section>
      )}
      {manage && (
        <>
          <section className="card">
            <h2>Registrar saldo inicial</h2>
            <p className="muted small">Una sola vez por cuenta. Para corregirlo después usa un ajuste.</p>
            <div className="row chips" role="group" aria-label="Tipo de cuenta">{['efectivo', 'banco'].map((t) => <button key={t} className={ini.accountType === t ? 'on' : ''} aria-pressed={ini.accountType === t} onClick={() => setIni({ ...ini, accountType: t, accountName: t === 'efectivo' ? 'Efectivo' : '' })}>{TIPO[t]}</button>)}</div>
            <label>Nombre de la cuenta<input value={ini.accountName} placeholder={ini.accountType === 'banco' ? 'Ej. BBVA negocio' : 'Efectivo'} onChange={(e) => setIni({ ...ini, accountName: e.target.value })} /></label>
            <div className="row"><label>¿Cuánto había?<input inputMode="decimal" placeholder="$0.00" value={ini.amount} onChange={(e) => setIni({ ...ini, amount: e.target.value })} /></label><label>Al empezar el día<input type="date" max={today()} value={ini.date} onChange={(e) => setIni({ ...ini, date: e.target.value })} /></label></div>
            <label>Descripción<input value={ini.description} placeholder="Ej. Efectivo en el cajón al empezar a usar NEXORA" onChange={(e) => setIni({ ...ini, description: e.target.value })} /></label>
            <button className="primary" disabled={ini.accountName.trim().length < 2 || ini.description.trim().length < 5 || !(toCents(ini.amount) >= 0) || ini.amount === ''} onClick={run(() => api('POST', '/finanzas/saldos', { ...ini, amount: toCents(ini.amount) }).then(() => setIni({ ...ini, amount: '', description: '' })), 'Saldo inicial registrado.')}>Guardar saldo inicial</button>
          </section>
          <section className="card">
            <h2>¿Cuadra? Comparar con lo que hay de verdad</h2>
            <p className="muted small">Cuenta el efectivo o suma tus cuentas de banco y escribe el total. Si no coincide con lo que espera el sistema, queda un ajuste con tu explicación.</p>
            <div className="row chips" role="group" aria-label="Qué comparar">{['efectivo', 'banco'].map((t) => <button key={t} className={con.accountType === t ? 'on' : ''} aria-pressed={con.accountType === t} onClick={() => setCon({ ...con, accountType: t, accountName: d.accounts.find((a: any) => a.type === t)?.name ?? (t === 'efectivo' ? 'Efectivo' : 'Banco') })}>{t === 'efectivo' ? 'Efectivo' : 'Bancos'}</button>)}</div>
            <p className="muted small">El sistema espera: <b>{mxn(con.accountType === 'efectivo' ? d.efectivo : d.banco)}</b></p>
            <label>¿Cuánto hay de verdad?<input inputMode="decimal" placeholder="$0.00" value={con.counted} onChange={(e) => setCon({ ...con, counted: e.target.value })} /></label>
            <label>Si no coincide, ¿qué pasó?<input value={con.description} placeholder="Ej. Faltaron 15 pesos de cambio" onChange={(e) => setCon({ ...con, description: e.target.value })} /></label>
            <button className="primary" disabled={con.counted === ''} onClick={async () => { try { const r = await api<any>('POST', '/finanzas/saldos/conciliar', { accountType: con.accountType, accountName: con.accountName, counted: toCents(con.counted), description: con.description || undefined }); setMsg({ ok: r.matches ? 'Todo cuadra: no hay nada que ajustar.' : `Ajuste registrado: ${mxn(r.difference)}.` }); setCon({ ...con, counted: '', description: '' }); await load() } catch (e) { setMsg({ err: (e as Error).message }) } }}>Comparar</button>
          </section>
          <details className="more">
            <summary>Ajuste manual (sumar o restar con motivo)</summary>
            <label>Cuenta<input value={aj.accountName} placeholder="Nombre de la cuenta" onChange={(e) => setAj({ ...aj, accountName: e.target.value })} /></label>
            <div className="row chips" role="group" aria-label="Tipo">{['efectivo', 'banco'].map((t) => <button key={t} className={aj.accountType === t ? 'on' : ''} aria-pressed={aj.accountType === t} onClick={() => setAj({ ...aj, accountType: t })}>{TIPO[t]}</button>)}</div>
            <label>Monto (usa − para restar)<input inputMode="decimal" placeholder="$0.00" value={aj.amount} onChange={(e) => setAj({ ...aj, amount: e.target.value })} /></label>
            <label>Motivo<input value={aj.description} placeholder="Ej. Intereses del mes" onChange={(e) => setAj({ ...aj, description: e.target.value })} /></label>
            <button disabled={aj.accountName.trim().length < 2 || aj.description.trim().length < 5 || !toCents(aj.amount)} onClick={run(() => api('POST', '/finanzas/saldos/ajuste', { accountType: aj.accountType, accountName: aj.accountName, amount: toCents(aj.amount), description: aj.description }).then(() => setAj({ ...aj, amount: '', description: '' })), 'Ajuste registrado.')}>Registrar ajuste</button>
          </details>
        </>
      )}
      {d.entries.length > 0 && (
        <section className="card">
          <h2>Historial</h2>
          <div className="table-wrap cards-sm"><table className="list"><tbody>
            {d.entries.map((e: any) => <tr key={e.id}><td data-label="Movimiento"><b>{e.kind === 'inicial' ? 'Saldo inicial' : 'Ajuste'} · {e.accountName}</b><br /><small className="muted">{e.date} · {e.description}</small></td><td data-label="Monto" className="num">{mxn(e.amount)}</td></tr>)}
          </tbody></table></div>
          <p className="muted small">El historial no se edita ni se borra.</p>
        </section>
      )}
    </div>
  )
}
