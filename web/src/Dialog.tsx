import { useEffect, useRef, useState } from 'react'

/**
 * Ventanas para pedir un dato (código, motivo, cantidad) con el diseño de NEXORA, en lugar de las del navegador.
 * Los códigos se escriben ocultos. Se usan como `await ask({...})` desde cualquier pantalla.
 */

interface AskOpts {
  title: string
  label?: string
  /** Texto de ayuda debajo del título. */
  hint?: string
  value?: string
  placeholder?: string
  /** Código o contraseña: se escribe oculto. */
  secret?: boolean
  /** Teclado numérico en celular. */
  numeric?: boolean
  /** Opciones en botones (p. ej. forma de pago) en lugar de un campo. */
  choices?: { value: string; label: string }[]
  confirmLabel?: string
  /** Solo pide confirmar (sí / no). */
  confirmOnly?: boolean
  danger?: boolean
}
type Req = AskOpts & { resolve: (v: string | null) => void }

let push: ((r: Req) => void) | null = null
const queue: Req[] = []

/** Pide un dato. Regresa el texto escrito, o null si se cancela. */
export function ask(o: AskOpts): Promise<string | null> {
  return new Promise((resolve) => {
    const r = { ...o, resolve }
    if (push) push(r)
    else queue.push(r)
  })
}
/** Pide el código de autorización (oculto). */
export const askCode = (why: string) => ask({ title: 'Código de autorización', hint: why, label: 'Código', secret: true, numeric: true, confirmLabel: 'Autorizar' })
/** Pregunta sí / no. */
export const confirmAsk = async (title: string, hint?: string, danger = false) => (await ask({ title, hint, confirmOnly: true, danger, confirmLabel: 'Sí' })) !== null

export function DialogHost() {
  const [req, setReq] = useState<Req | null>(null)
  const [v, setV] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    push = (r) => { setReq(r); setV(r.value ?? '') }
    const first = queue.shift()
    if (first) push(first)
    return () => { push = null }
  }, [])
  useEffect(() => { if (req && !req.choices && !req.confirmOnly) setTimeout(() => input.current?.focus(), 30) }, [req])
  if (!req) return null
  const done = (value: string | null) => {
    req.resolve(value)
    const next = queue.shift()
    if (next) { setReq(next); setV(next.value ?? '') } else setReq(null)
  }
  const ok = () => { if (req.confirmOnly) done('si'); else if (v.trim()) done(v.trim()) }
  return (
    <div className="modal dialog-wrap" role="dialog" aria-modal="true" aria-label={req.title} onClick={() => done(null)} onKeyDown={(e) => { if (e.key === 'Escape') done(null) }}>
      <div className="card dialog" onClick={(e) => e.stopPropagation()}>
        <h2>{req.title}</h2>
        {req.hint && <p className="muted">{req.hint}</p>}
        {req.choices ? (
          <div className="dialog-choices">{req.choices.map((c) => <button key={c.value} onClick={() => done(c.value)}>{c.label}</button>)}</div>
        ) : !req.confirmOnly && (
          <label>{req.label ?? 'Escribe'}
            <input ref={input} type={req.secret ? 'password' : 'text'} inputMode={req.numeric ? 'numeric' : undefined} autoComplete={req.secret ? 'off' : undefined}
              value={v} placeholder={req.placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') ok() }} />
          </label>
        )}
        <div className="dialog-actions">
          <button onClick={() => done(null)}>Cancelar</button>
          {!req.choices && <button className={req.danger ? 'danger' : 'primary'} disabled={!req.confirmOnly && !v.trim()} onClick={ok}>{req.confirmLabel ?? 'Aceptar'}</button>}
        </div>
      </div>
    </div>
  )
}
