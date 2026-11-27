/**
 * Generadores genéricos de archivos para exportar tablas: CSV, Excel (.xlsx) y PDF.
 * Sin dependencias ni servicios externos; corren igual en Node y en el Worker.
 */
export type Cell = string | number | null
export interface PdfCol { w: number; head?: string; right?: boolean }
export interface Hoja {
  /** Nombre de la pestaña de Excel (máx. 31 caracteres, sin : \ / ? * [ ]). */
  name: string
  /** Título de la sección en el PDF. */
  title: string
  head: string[]
  rows: Cell[][]
  /** Ancho de cada columna en Excel. */
  widths: number[]
  /** Columnas (posición) con formato de dinero (2 decimales). */
  money?: number[]
  pdf: PdfCol[]
  /** Texto ya formateado para el PDF (si falta, se usan las celdas tal cual). */
  pdfRows?: string[][]
}
export interface Doc { title: string; subtitle: string; hojas: Hoja[] }

const UNI = String.fromCharCode
/** Texto → nombre de archivo seguro: sin acentos, minúsculas y guiones. */
export function slugify(s: string, max = 30): string {
  const sinMarcas = s.normalize('NFD').split('').filter((ch) => { const c = ch.charCodeAt(0); return c < 0x300 || c > 0x36f }).join('')
  return sinMarcas.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'negocio'
}

// ---------- CSV (Excel lo abre directo) ----------
export function toCsv(h: Hoja): Uint8Array {
  const esc = (v: Cell) => { if (v == null) return ''; const s = String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const money = new Set(h.money ?? [])
  const lines = [h.head, ...h.rows.map((r) => r.map((v, i) => (typeof v === 'number' && money.has(i) ? v.toFixed(2) : v)))]
  return new TextEncoder().encode(UNI(0xfeff) + lines.map((l) => l.map(esc).join(',')).join('\r\n') + '\r\n')
}

// ---------- XLSX (zip sin compresión + XML mínimo) ----------
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]!) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder(); const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0
  const u16 = (n: number) => [n & 255, (n >>> 8) & 255]; const u32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
  const time = 0x6000, date = 0x5a21 // 2025-01-01 12:00 (marca fija: el archivo no depende del reloj)
  for (const f of files) {
    const name = enc.encode(f.name); const crc = crc32(f.data)
    const local = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...name])
    parts.push(local, f.data)
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]))
    offset += local.length + f.data.length
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0)
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)])
  const all = [...parts, ...central, end]; const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0
  for (const a of all) { out.set(a, p); p += a.length }
  return out
}

const INVALID_XML = new RegExp('[^\\u0009\\u000a\\u000d\\u0020-\\ud7ff\\ue000-\\ufffd]', 'g')
const xmlEsc = (s: string) => s.replace(INVALID_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const colLetter = (i: number): string => (i >= 26 ? colLetter(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26))
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function sheetXml(h: Hoja): string {
  const money = new Set(h.money ?? [])
  const cell = (r: number, c: number, v: Cell, header = false) => {
    const ref = `${colLetter(c)}${r}`
    if (header) return `<c r="${ref}" s="1" t="inlineStr"><is><t>${xmlEsc(String(v))}</t></is></c>`
    if (v == null || v === '') return ''
    if (typeof v === 'number') return `<c r="${ref}"${money.has(c) ? ' s="2"' : ''}><v>${v}</v></c>`
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`
  }
  const rows = [`<row r="1">${h.head.map((t, i) => cell(1, i, t, true)).join('')}</row>`, ...h.rows.map((r, k) => `<row r="${k + 2}">${r.map((v, i) => cell(k + 2, i, v)).join('')}</row>`)]
  const last = `${colLetter(h.head.length - 1)}${h.rows.length + 1}`
  return `${XML}<worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${h.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`
}

export function toXlsx(hojas: Hoja[]): Uint8Array {
  const styles = `${XML}<styleSheet ${NS}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F7"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  const enc = new TextEncoder(); const f = (name: string, s: string) => ({ name, data: enc.encode(s) })
  const ct = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
  const wb = `${XML}<workbook ${NS} xmlns:r="${REL}"><sheets>${hojas.map((h, i) => `<sheet name="${xmlEsc(h.name.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`
  const wbRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${hojas.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`
  return zipStore([
    f('[Content_Types].xml', ct),
    f('_rels/.rels', `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    f('xl/workbook.xml', wb), f('xl/_rels/workbook.xml.rels', wbRels), f('xl/styles.xml', styles),
    ...hojas.map((h, i) => f(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(h))),
  ])
}

// ---------- PDF (A4 horizontal, tablas con letra de ancho fijo) ----------
const CP1252: Record<number, number> = { 0x20ac: 0x80, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85 }
/** Texto a bytes WinAnsi (acentos y ñ incluidos); lo demás se cambia por «?». */
const win = (s: string) => { let o = ''; for (const ch of s.normalize('NFC')) { const c = ch.codePointAt(0)!; o += c < 0x80 || (c >= 0xa0 && c <= 0xff) ? String.fromCharCode(c) : CP1252[c] != null ? String.fromCharCode(CP1252[c]!) : '?' } return o }
const pdfEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
const fit = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '.' : s)
export const money2 = (v: number | null) => (v == null ? '' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export function toPdf(d: Doc): Uint8Array {
  const W = 841.89, H = 595.28, M = 36, LH = 11
  const pages: string[] = []
  let s = '', y = 0
  const text = (font: string, size: number, x: number, yy: number, t: string) => { s += `BT /${font} ${size} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td (${pdfEsc(win(t))}) Tj ET\n` }
  const rule = (yy: number, g: string, w: string) => { s += `${g} G ${w} w ${M} ${(yy - 2.5).toFixed(2)} m ${(W - M).toFixed(2)} ${(yy - 2.5).toFixed(2)} l S\n` }
  const newPage = () => {
    if (s) pages.push(s)
    s = ''; y = H - M - 12
    text('F3', 14, M, y, d.title); y -= 15
    text('F1', 9, M, y, d.subtitle); y -= 18
  }
  const line = (cols: PdfCol[], vals: string[]) => vals.map((v, i) => { const c = cols[i]!; const t = fit(v, c.w); return c.right ? t.padStart(c.w) : t.padEnd(c.w) }).join('  ')
  const bottom = M + 12
  newPage()
  for (const h of d.hojas) {
    const heads = line(h.pdf, h.pdf.map((c, i) => c.head ?? h.head[i]!))
    const header = () => { text('F2', 8, M, y, heads); rule(y + 0.5, '0.2', '0.8'); y -= LH + 2 }
    if (d.hojas.length > 1) { if (y - 2 * LH - 3 * LH < bottom) newPage(); y -= 6; text('F3', 11, M, y, `${h.title} (${h.rows.length})`); y -= 16 }
    header()
    const body = (h.pdfRows ?? h.rows.map((r) => r.map((v) => (v == null ? '' : String(v))))).map((r) => line(h.pdf, r))
    if (body.length === 0) { text('F1', 8, M, y, '(sin registros)'); y -= LH * 2; continue }
    for (const l of body) {
      if (y < bottom) { newPage(); header() }
      text('F1', 8, M, y, l); rule(y, '0.88', '0.4'); y -= LH
    }
    y -= LH
  }
  pages.push(s)
  const total = pages.length
  const streams = pages.map((p, i) => { s = p; text('F1', 7, M, M - 6, `Pagina ${i + 1} de ${total}  |  Generado por NEXORA`); return s })
  const objs: string[] = []
  const pageIds = streams.map((_, i) => 6 + i * 2)
  objs.push('<< /Type /Catalog /Pages 2 0 R >>')
  objs.push(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${streams.length} >>`)
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>')
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>')
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  streams.forEach((st, i) => {
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${7 + i * 2} 0 R >>`)
    objs.push(`<< /Length ${st.length} >>\nstream\n${st}endstream`)
  })
  let out = '%PDF-1.4\n'; const off: number[] = []
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255
  return bytes
}

export const FORMATS = {
  xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  csv: { type: 'text/csv; charset=utf-8', ext: 'csv' },
  pdf: { type: 'application/pdf', ext: 'pdf' },
} as const
export type Format = keyof typeof FORMATS
