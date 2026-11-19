import { useEffect, useState } from 'react'
import { api } from '../api'
import { ask, askCode } from '../Dialog'
import type { Me } from '../App'

/** Taquería: carne del trompo o asada. Lo empezado, lo vendido (por recetas) y el sobrante contado al cierre con código. */
export function Trompo(_: { me: Me }) {
  const [batches, setBatches] = useState<any[]>([])
  const [meats, setMeats] = useState<any[]>([])
  const [f, setF] = useState({ productId: '', kg: '' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => {
    setBatches((await api<any>('GET', '/meat/batches')).batches)
    const m = (await api<any>('GET', '/products')).products.filter((p: any) => p.unit === 'kg' && p.active)
    setMeats(m)
    setF((x) => ({ ...x, productId: x.productId || m[0]?.id || '' }))
  }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })); const t = setInterval(() => void load().catch(() => {}), 20_000); return () => clearInterval(t) }, [])
  const start = async () => {
    try { await api('POST', '/meat/batches', { productId: f.productId, kg: Number(f.kg) }); setF({ ...f, kg: '' }); setMsg({ ok: 'Registrado.' }); void load() } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const close = async (b: any) => {
    const left = (await ask({ title: `Sobrante de ${b.name}`, hint: `Se esperan ${b.expectedLeftoverKg} kg.`, label: 'Kilos que sobraron', placeholder: String(b.expectedLeftoverKg), confirmLabel: 'Continuar' }))?.replace(',', '.') ?? null
    if (left === null) return
    const diff = Math.abs(Number(left) - b.expectedLeftoverKg) > 0.0005
    const reason = diff ? (await ask({ title: 'Hay diferencia', label: '¿Por qué?', placeholder: 'Ej. se quemó un poco', confirmLabel: 'Continuar' })) ?? '' : undefined
    const code = await askCode('Para cerrar la carne se necesita el código del dueño o encargado.')
    if (!code) return
    try { const r = await api<any>('POST', `/meat/batches/${b.id}/close`, { leftoverKg: Number(left), reason, authCode: code }); setMsg({ ok: `Cerrado. Diferencia: ${r.differenceKg} kg.` }); void load() } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  return (
    <div className="grid2">
      <section className="card">
        <h2>Empezar carne</h2>
        <label>Carne<select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>{meats.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label>Kilos que se ponen<input inputMode="decimal" value={f.kg} onChange={(e) => setF({ ...f, kg: e.target.value })} /></label>
        <p><button className="primary big" style={{ width: '100%' }} disabled={!f.productId || !(Number(f.kg) > 0)} onClick={start}>Registrar</button></p>
        {msg.err && <p className="error">{msg.err}</p>}
        {msg.ok && <p className="okmsg">{msg.ok}</p>}
      </section>
      <section className="card">
        <h2>Hoy</h2>
        <div className="table-wrap"><table className="list"><thead><tr><th>Carne</th><th className="num">Empezó</th><th className="num">Vendido</th><th className="num">Debe sobrar</th><th></th></tr></thead>
          <tbody>{batches.map((b) => (
            <tr key={b.id}><td>{b.name}</td><td className="num">{b.startedKg} kg</td><td className="num">{b.soldKg} kg</td>
              <td className="num">{b.open ? `${b.expectedLeftoverKg} kg` : `${b.countedKg} kg (${b.differenceKg >= 0 ? '+' : ''}${b.differenceKg})`}</td>
              <td>{b.open && <button className="primary" onClick={() => close(b)}>Contar sobrante</button>}</td></tr>
          ))}</tbody></table></div>
      </section>
    </div>
  )
}
