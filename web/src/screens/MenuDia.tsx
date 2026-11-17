import { useEffect, useState } from 'react'
import { api, mxn } from '../api'
import { hasGiro, type Me } from '../App'

const MEALS: Record<string, string> = { dia: 'Todo el día', desayuno: 'Desayuno', comida: 'Comida', cena: 'Cena' }

/** Menú del día (comedor) o guisados del día (taquería). Se publica con código; los agotados no se venden. */
export function MenuDia({ me }: { me: Me }) {
  const [data, setData] = useState<any>(null)
  const [products, setProducts] = useState<any[]>([])
  // Taquería sola: guisados del día; si también es comedor, se usan los tiempos de comida.
  const onlyTaco = hasGiro(me, 'taqueria') && !hasGiro(me, 'comedor')
  const [meal, setMeal] = useState(onlyTaco ? 'dia' : 'comida')
  const [sel, setSel] = useState<string[]>([])
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const load = async () => {
    setData(await api('GET', '/daily-menu'))
    setProducts((await api<any>('GET', '/products')).products.filter((p: any) => p.sellable !== false && p.active))
  }
  useEffect(() => { void load().catch((e) => setMsg({ err: e.message })) }, [])
  const publish = async () => {
    const code = prompt('Código de autorización para publicar:')
    if (!code) return
    try { await api('POST', '/daily-menu', { meal, productIds: sel, authCode: code }); setMsg({ ok: 'Menú publicado.' }); setSel([]); void load() } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const toggle = async (menuId: string, productId: string, soldOut: boolean) => { await api('POST', `/daily-menu/${menuId}/sold-out`, { productId, soldOut }); void load() }
  return (
    <div className="grid2">
      <section className="card">
        <h2>Publicar {onlyTaco ? 'guisados del día' : 'menú del día'}</h2>
        {!onlyTaco && <div className="tabs">{Object.entries(MEALS).map(([k, v]) => <button key={k} className={meal === k ? 'on' : ''} onClick={() => setMeal(k)}>{v}</button>)}</div>}
        <div className="results">{products.map((p) => (
          <button key={p.id} className={sel.includes(p.id) ? 'primary' : ''} onClick={() => setSel(sel.includes(p.id) ? sel.filter((x) => x !== p.id) : [...sel, p.id])}>{p.name}<small>{mxn(p.price)}</small></button>
        ))}</div>
        {msg.err && <p className="error">{msg.err}</p>}
        {msg.ok && <p className="okmsg">{msg.ok}</p>}
        <p><button className="primary big" style={{ width: '100%' }} disabled={!sel.length} onClick={publish}>Publicar</button></p>
      </section>
      <section className="card">
        <h2>Hoy</h2>
        {data?.menus.length === 0 && <p className="muted">Todavía no se publica nada hoy.</p>}
        {data?.menus.map((m: any) => (
          <div key={m.id} style={{ marginBottom: 12 }}>
            <h3>{MEALS[m.meal]}{m.meal === data.currentMeal ? ' (ahora)' : ''}</h3>
            <table className="list"><tbody>{m.items.map((i: any) => (
              <tr key={i.productId} style={{ opacity: i.soldOut ? 0.5 : 1 }}><td>{i.name}</td><td className="num">{mxn(i.price)}</td>
                <td><button className={i.soldOut ? '' : 'danger'} onClick={() => toggle(m.id, i.productId, !i.soldOut)}>{i.soldOut ? 'Hay de nuevo' : 'Se acabó'}</button></td></tr>
            ))}</tbody></table>
          </div>
        ))}
      </section>
    </div>
  )
}
