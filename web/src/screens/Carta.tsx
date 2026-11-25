import { useEffect, useState } from 'react'
import { applyPublicProduct } from '../products'
import { api, mxn } from '../api'
import { EncabezadoNegocio, type PerfilPub } from '../PerfilPublico'
import { Foto } from '../ilustraciones'

interface Item { name: string; price: number; unit: string; imageUrl: string | null; note: string }
interface Datos { kind: 'menu' | 'precios' | 'catalogo'; business: { name: string; phone: string | null; giro: string; logoUrl: string | null }; profile: PerfilPub; sections: { name: string; items: Item[] }[] }
const UNIDAD: Record<string, string> = { kg: ' / kg', metro: ' / metro', litro: ' / litro' }
const TITULO = { menu: 'Menú', precios: 'Precios de hoy', catalogo: 'Catálogo' } as const

/** Página pública para compartir: menú digital, lista de precios o catálogo (solo consulta; sin pedido ni pago en línea). */
export function Carta({ slug }: { slug: string }) {
  const [d, setD] = useState<Datos | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api<Datos>('GET', `/public/carta/${slug}`).then((r) => { applyPublicProduct(r.business.giro); setD(r) }).catch((e) => setErr(e.message)) }, [slug])
  if (!d) return <main className="login">{err ? <p className="error">{err}</p> : <p className="muted">Cargando…</p>}</main>
  const conFoto = d.kind !== 'precios'
  return (
    <main className="pub-wrap">
      <EncabezadoNegocio business={d.business} profile={d.profile} />
      <h2 style={{ margin: 0 }}>{TITULO[d.kind]}</h2>
      {d.kind === 'precios' && <p className="muted" style={{ margin: 0 }}>Precios vigentes al abrir esta página.</p>}
      {d.sections.length === 0 && <p className="muted">Todavía no hay artículos publicados.</p>}
      {d.sections.map((sec) => (
        <section key={sec.name} className="pub-seccion">
          <h2>{sec.name}</h2>
          {conFoto ? (
            <div className="pub-grid">{sec.items.map((it) => (
              <article key={it.name} className="pub-item">
                <Foto url={it.imageUrl} giro={d.business.giro} alto={120} radio={12} />
                <span><b>{it.name}</b>{it.note && <small>{it.note}</small>}</span>
                <span className="pub-precio">{mxn(it.price)}{UNIDAD[it.unit] ?? ''}</span>
              </article>
            ))}</div>
          ) : (
            <div className="card pub-lista">{sec.items.map((it) => (
              <div key={it.name} className="pub-fila"><div><b>{it.name}</b></div><span className="pub-precio">{mxn(it.price)}{UNIDAD[it.unit] ?? ''}</span></div>
            ))}</div>
          )}
        </section>
      ))}
      <p className="pub-pie">Los precios pueden cambiar. Para pedir, contacta directamente al negocio.</p>
    </main>
  )
}
