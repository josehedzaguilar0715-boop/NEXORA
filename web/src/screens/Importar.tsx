import { useMemo, useState } from 'react'
import { api, mxn } from '../api'
import type { Me } from '../App'

/**
 * Importar datos de otro sistema o de Excel: productos (con existencia y costo), clientes (con su fiado) y proveedores.
 * Lee CSV o Excel (.xlsx), reconoce las columnas por su nombre y deja corregirlas antes de importar.
 */

type Kind = 'productos' | 'clientes' | 'proveedores'
type Field = { key: string; label: string; required?: boolean; type?: 'money' | 'number' | 'unit' | 'text'; synonyms: string[]; example: string }

const FIELDS: Record<Kind, Field[]> = {
  productos: [
    { key: 'name', label: 'Nombre', required: true, synonyms: ['nombre', 'producto', 'descripcion', 'articulo', 'nombre del producto', 'nombre producto'], example: 'Refresco 600 ml' },
    { key: 'barcode', label: 'Código de barras', synonyms: ['codigo de barras', 'codigo', 'barcode', 'sku', 'clave', 'ean', 'upc', 'codigobarras', 'cod barras'], example: '7501055300075' },
    { key: 'price', label: 'Precio de venta', required: true, type: 'money', synonyms: ['precio de venta', 'precio venta', 'precio', 'pventa', 'precio publico', 'venta', 'p venta'], example: '22.00' },
    { key: 'cost', label: 'Costo', type: 'money', synonyms: ['costo', 'precio de compra', 'precio compra', 'costo unitario', 'pcompra', 'compra', 'p compra'], example: '14.50' },
    { key: 'stock', label: 'Existencia', type: 'number', synonyms: ['existencia', 'existencias', 'stock', 'cantidad', 'inventario', 'inv', 'disponible', 'piezas'], example: '24' },
    { key: 'unit', label: 'Unidad', type: 'unit', synonyms: ['unidad', 'um', 'unidad de medida', 'tipo de venta', 'se vende por'], example: 'pieza' },
    { key: 'minStock', label: 'Mínimo', type: 'number', synonyms: ['minimo', 'stock minimo', 'existencia minima', 'inventario minimo', 'min'], example: '6' },
    { key: 'category', label: 'Categoría', synonyms: ['categoria', 'departamento', 'familia', 'linea', 'grupo', 'depto'], example: 'Bebidas' },
  ],
  clientes: [
    { key: 'name', label: 'Nombre', required: true, synonyms: ['nombre', 'cliente', 'nombre del cliente', 'nombre cliente', 'razon social'], example: 'Doña Mari' },
    { key: 'phone', label: 'Teléfono', synonyms: ['telefono', 'tel', 'celular', 'whatsapp', 'movil', 'cel'], example: '5512345678' },
    { key: 'balance', label: 'Saldo que debe (fiado)', type: 'money', synonyms: ['saldo', 'adeudo', 'debe', 'deuda', 'fiado', 'saldo pendiente', 'por cobrar'], example: '350.00' },
    { key: 'creditLimit', label: 'Límite de crédito', type: 'money', synonyms: ['limite de credito', 'limite', 'credito', 'limite credito'], example: '1000.00' },
    { key: 'stamps', label: 'Sellos o puntos que ya tiene', type: 'number', synonyms: ['sellos', 'puntos', 'sellos ciclo', 'sellos total', 'sellos actuales', 'stamps'], example: '3' },
    { key: 'notes', label: 'Notas', synonyms: ['notas', 'comentarios', 'observaciones', 'direccion', 'domicilio'], example: 'Calle Hidalgo 12' },
  ],
  proveedores: [
    { key: 'name', label: 'Nombre', required: true, synonyms: ['nombre', 'proveedor', 'razon social', 'empresa', 'nombre del proveedor'], example: 'Distribuidora del Sur' },
    { key: 'phone', label: 'Teléfono', synonyms: ['telefono', 'tel', 'celular', 'whatsapp', 'contacto'], example: '9631234567' },
    { key: 'notes', label: 'Notas', synonyms: ['notas', 'comentarios', 'observaciones', 'dias de visita', 'vendedor'], example: 'Viene los martes' },
  ],
}
const ENDPOINT: Record<Kind, string> = { productos: '/import/products', clientes: '/import/customers', proveedores: '/import/suppliers' }
const KIND_LABEL: Record<Kind, string> = { productos: 'Productos e inventario', clientes: 'Clientes y fiado', proveedores: 'Proveedores' }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Lector de CSV: detecta separador (coma, punto y coma o tabulador) y respeta comillas. */
function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const sep = [';', '\t', ','].map((s) => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0]
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === sep) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

async function readFile(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import('read-excel-file/browser')
    const data = (await readSheet(file)) as unknown[][]
    return data.map((r) => r.map((v) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v))))
  }
  if (/\.xls$/i.test(file.name)) throw new Error('Ese es un Excel antiguo (.xls). Ábrelo en Excel y guárdalo como "Libro de Excel (.xlsx)" o como CSV.')
  const buf = await file.arrayBuffer()
  let text = new TextDecoder('utf-8').decode(buf)
  // Excel en español suele guardar el CSV en Windows-1252: si hay letras rotas, se vuelve a leer así.
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf)
  return parseCsv(text.replace(/^﻿/, ''))
}

/** "$1,234.50", "1234,5" o 1234.5 → número. */
function toNumber(v: string): number | null {
  let s = v.replace(/[$\s]/g, '')
  if (!s) return null
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '')
  else if (/^-?\d+,\d{1,3}$/.test(s) && !/^-?\d{1,3},\d{3}$/.test(s)) s = s.replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}
function toUnit(v: string) {
  const s = norm(v)
  if (!s) return undefined
  if (/^(kg|kilo|kilos|kilogramo|granel|kgs)/.test(s)) return 'kg'
  if (/^(l|lt|lts|litro|litros)$/.test(s)) return 'litro'
  if (/^(m|mt|mts|metro|metros)$/.test(s)) return 'metro'
  return 'pieza'
}

function autoMap(kind: Kind, headers: string[]): Record<string, number> {
  const h = headers.map(norm)
  const map: Record<string, number> = {}
  const used = new Set<number>()
  for (const pass of ['exact', 'contains'] as const)
    for (const f of FIELDS[kind]) {
      if (map[f.key] !== undefined) continue
      const i = h.findIndex((x, j) => !used.has(j) && x && f.synonyms.some((s) => (pass === 'exact' ? x === s : x.includes(s))))
      if (i >= 0) { map[f.key] = i; used.add(i) }
    }
  return map
}

function template(kind: Kind) {
  const f = FIELDS[kind]
  const csv = '﻿' + [f.map((x) => x.label).join(','), f.map((x) => (x.example.includes(',') ? `"${x.example}"` : x.example)).join(',')].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `plantilla-${kind}.csv`
  a.click()
}

type Built = { line: number; data: Record<string, unknown>; error?: string }

export function Importar(_: { me: Me }) {
  const [kind, setKind] = useState<Kind>('productos')
  const [file, setFile] = useState<string>('')
  const [table, setTable] = useState<string[][]>([])
  const [map, setMap] = useState<Record<string, number>>({})
  const [onExisting, setOnExisting] = useState<'actualizar' | 'omitir'>('actualizar')
  const [err, setErr] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; failed: number; errors: { line: number; message: string }[] } | null>(null)

  const headerIdx = table.findIndex((r) => r.some((c) => c.trim()))
  const headers = headerIdx >= 0 ? table[headerIdx]! : []
  const body = headerIdx >= 0 ? table.slice(headerIdx + 1).map((r, i) => ({ r, line: headerIdx + i + 2 })).filter(({ r }) => r.some((c) => c.trim())) : []

  const built: Built[] = useMemo(() => body.map(({ r, line }) => {
    const data: Record<string, unknown> = {}
    let error: string | undefined
    for (const f of FIELDS[kind]) {
      const i = map[f.key]
      const raw = i === undefined ? '' : (r[i] ?? '').trim()
      if (!raw) { if (f.required) error ??= `Falta ${f.label.toLowerCase()}`; continue }
      if (f.type === 'money' || f.type === 'number') {
        const n = toNumber(raw)
        if (n == null) continue
        if (Number.isNaN(n)) { error ??= `${f.label} no es un número: "${raw}"`; continue }
        data[f.key] = f.type === 'money' ? Math.round(n * 100) : n
      } else if (f.type === 'unit') data[f.key] = toUnit(raw)
      else data[f.key] = raw
    }
    return { line, data, error }
  }), [table, map, kind])

  const load = async (fl: File | undefined) => {
    setErr(''); setResult(null)
    if (!fl) return
    try {
      const t = await readFile(fl)
      setFile(fl.name); setTable(t)
      const hi = t.findIndex((r) => r.some((c) => c.trim()))
      setMap(autoMap(kind, hi >= 0 ? t[hi]! : []))
      if (t.length < 2) setErr('El archivo no tiene filas.')
    } catch (e) { setErr((e as Error).message); setTable([]) }
  }
  const switchKind = (k: Kind) => { setKind(k); setResult(null); setMap(autoMap(k, headers)) }
  const valid = built.filter((b) => !b.error)
  const missing = FIELDS[kind].filter((f) => f.required && map[f.key] === undefined)

  const run = async () => {
    setErr(''); setResult(null)
    const errors: { line: number; message: string }[] = built.filter((b) => b.error).map((b) => ({ line: b.line, message: b.error! }))
    const tot = { created: 0, updated: 0, skipped: 0, failed: errors.length }
    try {
      for (let i = 0; i < valid.length; i += 500) {
        const chunk = valid.slice(i, i + 500)
        setProgress({ done: i, total: valid.length })
        const r = await api<any>('POST', ENDPOINT[kind], { rows: chunk.map((b) => b.data), onExisting })
        tot.created += r.created; tot.updated += r.updated; tot.skipped += r.skipped; tot.failed += r.failed
        for (const x of r.results) if (x.status === 'error') errors.push({ line: chunk[x.row]!.line, message: x.message })
      }
      setResult({ ...tot, errors: errors.sort((a, b) => a.line - b.line) })
    } catch (e) { setErr(`${(e as Error).message} Lo que ya se importó quedó guardado; puedes volver a intentarlo sin duplicar.`) }
    setProgress(null)
  }

  return (
    <div className="grid2" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.6fr)', alignItems: 'start' }}>
      <section className="card">
        <h2>1. ¿Qué vas a traer?</h2>
        <div className="seg wrap" style={{ marginBottom: 12 }}>{(Object.keys(KIND_LABEL) as Kind[]).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => switchKind(k)}>{KIND_LABEL[k]}</button>)}</div>
        <p className="muted small">Sirve un archivo de Excel (.xlsx) o CSV exportado de tu sistema anterior. Si no tienes uno, llena la plantilla.</p>
        <p><button onClick={() => template(kind)}>⬇ Descargar plantilla</button></p>
        <h2 style={{ marginTop: 18 }}>2. Sube el archivo</h2>
        <label className="drop">
          <input type="file" accept=".csv,.xlsx,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => void load(e.target.files?.[0])} />
          <span>{file ? <><b>{file}</b><br /><small className="muted">{body.length} filas · toca para cambiarlo</small></> : <>Toca para elegir el archivo<br /><small className="muted">.xlsx o .csv</small></>}</span>
        </label>
        {err && <p className="error">{err}</p>}
        {kind === 'productos' && <p className="muted small">La existencia queda igual a la del archivo (como un conteo), con el costo que traiga. Si importas otra vez, se actualiza y no se duplica.</p>}
        {kind === 'clientes' && <p className="muted small">El saldo que debe cada cliente entra como «saldo inicial» de su fiado, solo al crearlo; repetir la importación no lo duplica.</p>}
      </section>

      <section className="card">
        <h2>3. Revisa las columnas</h2>
        {!headers.length && <p className="muted">Cuando subas el archivo, aquí verás cómo se acomodan sus columnas.</p>}
        {headers.length > 0 && (<>
          <div className="mapgrid">
            {FIELDS[kind].map((f) => (
              <label key={f.key}>{f.label}{f.required && <span className="neg"> *</span>}
                <select value={map[f.key] ?? ''} onChange={(e) => { const m = { ...map }; if (e.target.value === '') delete m[f.key]; else m[f.key] = Number(e.target.value); setMap(m) }}>
                  <option value="">— no usar —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          {missing.length > 0 && <p className="error">Elige la columna de: {missing.map((f) => f.label).join(', ')}.</p>}
          <h3 style={{ marginTop: 14 }}>Vista previa</h3>
          <div className="table-wrap">
            <table className="list preview"><thead><tr><th>Fila</th>{FIELDS[kind].filter((f) => map[f.key] !== undefined).map((f) => <th key={f.key} className={f.type === 'money' || f.type === 'number' ? 'num' : ''}>{f.label}</th>)}</tr></thead>
              <tbody>{built.slice(0, 8).map((b) => (
                <tr key={b.line} className={b.error ? 'row-err' : ''}>
                  <td className="muted">{b.line}</td>
                  {FIELDS[kind].filter((f) => map[f.key] !== undefined).map((f) => <td key={f.key} className={f.type === 'money' || f.type === 'number' ? 'num' : ''}>{b.data[f.key] == null ? '' : f.type === 'money' ? mxn(b.data[f.key] as number) : String(b.data[f.key])}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
          {built.length > 8 && <p className="muted small">…y {built.length - 8} filas más.</p>}
          <h2 style={{ marginTop: 18 }}>4. Importar</h2>
          <label>Si ya existe (mismo código de barras, teléfono o nombre)<select value={onExisting} onChange={(e) => setOnExisting(e.target.value as 'actualizar' | 'omitir')}><option value="actualizar">Actualizarlo con los datos del archivo</option><option value="omitir">Dejarlo como está</option></select></label>
          <p className="muted">{valid.length} filas listas{built.length - valid.length ? ` · ${built.length - valid.length} con problema (no se importan)` : ''}.</p>
          {progress && <div className="bar-track" style={{ marginBottom: 10 }}><div className="bar-fill in" style={{ width: `${Math.max(5, (progress.done / progress.total) * 100)}%` }} /></div>}
          <p><button className="primary big" style={{ width: '100%' }} disabled={!!progress || missing.length > 0 || valid.length === 0} onClick={run}>{progress ? 'Importando…' : `Importar ${valid.length} ${kind}`}</button></p>
        </>)}
        {result && (
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Listo</h3>
            <p><span className="pos">{result.created} nuevos</span> · {result.updated} actualizados · {result.skipped} sin cambios{result.failed ? <> · <span className="neg">{result.failed} con problema</span></> : null}</p>
            {result.errors.length > 0 && <div className="table-wrap"><table className="list"><tbody>{result.errors.slice(0, 50).map((e, i) => <tr key={i}><td className="muted nowrap">Fila {e.line}</td><td>{e.message}</td></tr>)}</tbody></table></div>}
            {result.errors.length > 50 && <p className="muted small">…y {result.errors.length - 50} más.</p>}
          </div>
        )}
      </section>
    </div>
  )
}
