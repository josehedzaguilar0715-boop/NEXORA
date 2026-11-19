import { Fragment } from 'react'
import text from '../../../docs/aviso-de-privacidad.md?raw'
import { Logo } from '../Brand'

/** Muestra el aviso de privacidad (docs/aviso-de-privacidad.md) con un formato sencillo. */
export function Privacidad() {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p.replace(/^\*(.*)\*$/, '$1')}</Fragment>))
  const blocks: JSX.Element[] = []
  let list: string[] = []
  let ordered = false
  const flush = () => {
    if (!list.length) return
    const items = list.map((l, i) => <li key={i}>{inline(l)}</li>)
    blocks.push(ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>)
    list = []
  }
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (/^[-]\s/.test(t) || /^\d+\.\s/.test(t)) { ordered = /^\d/.test(t); list.push(t.replace(/^([-]|\d+\.)\s/, '')); continue }
    flush()
    if (!t || t === '---') continue
    if (t.startsWith('# ')) blocks.push(<h1 key={blocks.length}>{t.slice(2)}</h1>)
    else if (t.startsWith('## ')) blocks.push(<h2 key={blocks.length} style={{ marginTop: 20 }}>{t.slice(3)}</h2>)
    else blocks.push(<p key={blocks.length}>{inline(t)}</p>)
  }
  flush()
  return (
    <main className="login" style={{ maxWidth: 820 }}>
      <p><a href="/"><Logo size={36} /></a></p>
      <article className="card" style={{ lineHeight: 1.5 }}>{blocks}</article>
    </main>
  )
}
