import { useEffect, useState } from 'react'
import { applyPublicProduct } from '../products'
import { api } from '../api'
import { closeDay } from './Lealtad'

/** Mensaje de WhatsApp con el link de su tarjeta (ahí está su QR para que le den su sello). */
export const cardLink = (code: string) => `${location.origin}/tarjeta/${code}`
export function cardWhatsApp(c: { name: string; phone?: string | null; code: string }, business: string) {
  const text = `Hola ${c.name.split(' ')[0]}, esta es tu tarjeta de sellos de ${business}. Ahí ves tus sellos, tus premios y tu código QR: muéstralo cada vez que vengas para que te sumen tu sello.\n${cardLink(c.code)}`
  const digits = String(c.phone ?? '').replace(/\D/g, '').slice(-10)
  return `https://wa.me/${digits.length === 10 ? `52${digits}` : ''}?text=${encodeURIComponent(text)}`
}

const REASON: Record<string, string> = { ajuste: 'Ajuste de sellos', escaneo: 'Sello (QR)', rifa: 'Premio de rifa', importado: 'Sellos anteriores', manual: 'Sello', venta: 'Compra', visita: 'Visita', canje: 'Canjeó', cancelacion: 'Compra cancelada' }

/** Página pública: el cliente ve su tarjeta de sellos o puntos en su teléfono con su link (solo lectura). */
export function MiTarjeta({ code }: { code: string }) {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  const [camp, setCamp] = useState<any>(null)
  useEffect(() => {
    api<any>('GET', `/public/loyalty/${encodeURIComponent(code)}`).then((r) => { applyPublicProduct(r.giro); setD(r) }).catch((e) => setErr(e.message))
    api<any>('GET', `/public/loyalty/${encodeURIComponent(code)}/campaign`).then((r) => setCamp(r.campaign)).catch(() => {})
  }, [code])
  if (!d) return <main className="login">{err ? <p className="error">{err}</p> : <p className="muted">Cargando…</p>}</main>
  const stamps = d.unit === 'sellos'
  const word = (n: number) => (stamps ? (n === 1 ? 'sello' : 'sellos') : n === 1 ? 'punto' : 'puntos')
  const next = d.rewards.find((r: any) => r.cost > d.balance)
  const ready = d.rewards.filter((r: any) => r.cost <= d.balance)
  // La tarjeta se dibuja hasta el siguiente premio (o el más grande), máximo 30 casillas.
  const goal = Math.min(30, next?.cost ?? d.rewards[d.rewards.length - 1]?.cost ?? 10)
  return (
    <main className="login stamp-page">
      {d.logoUrl && <img src={d.logoUrl} alt="" className="stamp-logo" />}
      <h1>{d.business}</h1>
      <p className="muted">Hola {d.name}, esta es tu tarjeta de {stamps ? 'sellos' : 'puntos'}.</p>
      <section className="card stamp-card">
        <div className="stamp-total"><b>{d.balance}</b> {word(d.balance)}</div>
        {stamps && goal > 0 && (
          <div className="stamp-grid" aria-label={`${Math.min(d.balance, goal)} de ${goal} sellos`}>
            {Array.from({ length: goal }, (_, i) => <span key={i} className={i < d.balance ? 'stamp on' : 'stamp'}>{i < d.balance ? '✓' : i + 1}</span>)}
          </div>
        )}
        {ready.length > 0 && <p className="okmsg">¡Ya puedes canjear: {ready.map((r: any) => r.name).join(', ')}! Pídelo en tu próxima visita.</p>}
        {next && <p>Te faltan <b>{next.cost - d.balance}</b> {word(next.cost - d.balance)} para <b>{next.name}</b>.</p>}
        <p className="muted small">
          {d.earnBy === 'venta' ? `Ganas ${d.earnPoints} ${word(d.earnPoints)} cada vez que pagas` : d.earnBy === 'visita' ? `Ganas ${d.earnPoints} ${word(d.earnPoints)} por visita` : `Ganas ${word(2)} según lo que compras`}
          {d.dailyCap ? ` (máximo ${d.dailyCap} al día).` : '.'}
        </p>
      </section>
      {camp && (
        <section className="card">
          <h2>{camp.name}</h2>
          {camp.endsAt && <p className="muted small">{Date.now() >= Date.parse(camp.endsAt) ? `La rifa cerró el ${closeDay(camp.endsAt)}.` : `Cierra el ${closeDay(camp.endsAt)}: cuentan los sellos que juntes hasta ese día.`}</p>}
          {camp.prizes.map((p: any) => (
            <div key={p.name} className="stamp-reward">
              <div className="info-row"><span>{p.name}</span><b>{p.goal} sellos</b></div>
              <small className="muted">
                {p.status === 'entregado' ? '¡Ya lo ganaste!' : p.status === 'ganador' ? `¡Vas ganando! Lugar ${p.place}. Pídelo en tu próxima visita.` : p.status === 'en_espera' ? `Llegaste: lugar ${p.place} (hay ${p.quantity}).` : camp.endsAt && Date.now() >= Date.parse(camp.endsAt) ? 'La rifa ya cerró.' : p.remaining > 0 ? `Te faltan ${Math.max(0, p.goal - d.balance)} ${word(Math.max(0, p.goal - d.balance))} · quedan ${p.remaining} de ${p.quantity}.` : 'Ya se entregaron todos.'}
                {p.tiebreak !== 'ninguno' && !p.status ? ` Si varios llegan el mismo día, gana quien tenga más ${p.tiebreak === 'faciales' ? 'faciales pagados' : 'productos comprados'}.` : ''}
              </small>
              <div className="bar-track"><div className="bar-fill in" style={{ width: `${Math.min(100, (d.balance / p.goal) * 100)}%` }} /></div>
            </div>
          ))}
        </section>
      )}
      {d.rewards.length > 0 && (
        <section className="card">
          <h2>Premios</h2>
          {d.rewards.map((r: any) => (
            <div key={r.name} className="stamp-reward">
              <div className="info-row"><span>{r.name}</span><b>{r.cost} {word(r.cost)}</b></div>
              <div className="bar-track"><div className="bar-fill profit" style={{ width: `${Math.min(100, (d.balance / r.cost) * 100)}%` }} /></div>
            </div>
          ))}
        </section>
      )}
      {d.history.length > 0 && (
        <section className="card">
          <h2>Movimientos</h2>
          <div className="table-wrap"><table className="list"><tbody>
            {d.history.map((h: any, i: number) => (
              <tr key={i}><td>{REASON[h.reason] ?? h.reason}{h.reward ? `: ${h.reward}` : ''}<br /><small className="muted">{new Date(h.at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}</small></td>
                <td className="num"><b className={h.delta > 0 ? 'pos' : 'neg'}>{h.delta > 0 ? '+' : ''}{h.delta}</b></td></tr>
            ))}
          </tbody></table></div>
        </section>
      )}
      <section className="card" style={{ textAlign: 'center' }}>
        <img alt="Tu código QR" src={`/api/public/qr/${code}.svg`} width={170} height={170} style={{ background: '#fff', borderRadius: 12, padding: 6 }} />
        <p className="muted small">Muéstralo en caja para que te encuentren rápido. Guarda esta página en tu inicio para verla cuando quieras.</p>
      </section>
    </main>
  )
}
