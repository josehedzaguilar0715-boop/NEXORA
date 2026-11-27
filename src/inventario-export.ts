import { Hono } from 'hono'
import { audit } from './audit.js'
import { canFinance, requirePerm, type Env } from './context.js'
import type { Db } from './db.js'
import { bad, localDate } from './util.js'

/**
 * Exportar el inventario completo a Excel (.xlsx), CSV o PDF, para llevarlo a otro sistema o tenerlo en papel.
 * Solo lectura. El costo y el valor del inventario salen únicamente para quien puede ver costos.
 * Los encabezados coinciden con los de «Importar datos» (Nombre, Código de barras, Precio de venta, Costo, Existencia, Unidad, Mínimo, Categoría).
 */
export interface InvRow { code: string; name: string; category: string; unit: string; price: number; wholesale: number | null; wholesaleFrom: number | null; cost: number | null; stock: number | null; min: number; value: number | null }
export interface InvData { business: string; branch: string; date: string; costs: boolean; rows: InvRow[] }

const pesos = (c: number) => Math.round(c) / 100

export function inventoryData(db: Db, businessId: string, branchId: string, costs: boolean, date: string): InvData {
  const business = (db.prepare('SELECT name FROM businesses WHERE id = ?').get(businessId) as { name: string }).name
  const branch = (db.prepare('SELECT name FROM branches WHERE id = ?').get(branchId) as { name: string } | undefined)?.name ?? ''
  const list = db.prepare(`SELECT p.id, p.name, p.barcode, p.unit, p.price, p.min_stock_milli, p.last_cost, p.track_stock, COALESCE(c.name, '') AS category,
      (SELECT COALESCE(SUM(qty_milli), 0) FROM stock_movements m WHERE m.branch_id = ? AND m.product_id = p.id) AS stock_milli,
      (SELECT price FROM price_tiers t WHERE t.product_id = p.id ORDER BY min_milli LIMIT 1) AS tier_price,
      (SELECT min_milli FROM price_tiers t WHERE t.product_id = p.id ORDER BY min_milli LIMIT 1) AS tier_min
    FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.business_id = ? AND p.active = 1 ORDER BY p.name COLLATE NOCASE`).all(branchId, businessId) as {
      name: string; barcode: string | null; unit: string; price: number; min_stock_milli: number; last_cost: number; track_stock: number | null; category: string; stock_milli: number; tier_price: number | null; tier_min: number | null }[]
  const rows: InvRow[] = list.map((p) => {
    const tracked = p.track_stock !== 0
    const stock = tracked ? p.stock_milli / 1000 : null
    const cost = costs ? pesos(p.last_cost) : null
    return {
      code: p.barcode ?? '', name: p.name, category: p.category, unit: p.unit, price: pesos(p.price),
      wholesale: p.tier_price != null ? pesos(p.tier_price) : null, wholesaleFrom: p.tier_min != null ? p.tier_min / 1000 : null,
      cost, stock, min: p.min_stock_milli / 1000, value: costs && stock != null ? Math.round(stock * p.last_cost) / 100 : null,
    }
  })
  return { business, branch, date, costs, rows }
}

const HEAD = (costs: boolean) => ['Código de barras', 'Nombre', 'Categoría', 'Unidad', 'Precio de venta', 'Precio de mayoreo', 'Mayoreo desde', ...(costs ? ['Costo'] : []), 'Existencia', 'Mínimo', ...(costs ? ['Valor a costo'] : [])]
const cells = (r: InvRow, costs: boolean): (string | number | null)[] => [r.code, r.name, r.category, r.unit, r.price, r.wholesale, r.wholesaleFrom, ...(costs ? [r.cost] : []), r.stock, r.min, ...(costs ? [r.value] : [])]
/** Columnas numéricas (por posición) y cuáles son dinero. */
const NUM = (costs: boolean) => (costs ? [4, 5, 6, 7, 8, 9, 10] : [4, 5, 6, 7, 8])
const MONEY = (costs: boolean) => (costs ? [4, 5, 7, 10] : [4, 5])

// ---------- CSV (Excel lo abre directo) ----------
export function toCsv(d: InvData): Uint8Array {
  const esc = (v: string | number | null) => { if (v == null) return ''; const s = String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const money = new Set(MONEY(d.costs))
  const lines = [HEAD(d.costs), ...d.rows.map((r) => cells(r, d.costs).map((v, i) => (typeof v === 'number' && money.has(i) ? v.toFixed(2) : v)))]
  return new TextEncoder().encode('\ufeff' + lines.map((l) => l.map(esc).join(',')).join('\r\n') + '\r\n')
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
const colLetter = (i: number) => String.fromCharCode(65 + i)

export function toXlsx(d: InvData): Uint8Array {
  const head = HEAD(d.costs); const money = new Set(MONEY(d.costs)); const num = new Set(NUM(d.costs))
  const widths = d.costs ? [18, 42, 18, 9, 14, 16, 14, 12, 12, 10, 14] : [18, 42, 18, 9, 14, 16, 14, 12, 10]
  const cell = (r: number, c: number, v: string | number | null, header = false) => {
    const ref = `${colLetter(c)}${r}`
    if (header) return `<c r="${ref}" s="1" t="inlineStr"><is><t>${xmlEsc(String(v))}</t></is></c>`
    if (v == null || v === '') return ''
    if (typeof v === 'number' && num.has(c)) return `<c r="${ref}"${money.has(c) ? ' s="2"' : ''}><v>${v}</v></c>`
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`
  }
  const rows = [`<row r="1">${head.map((h, i) => cell(1, i, h, true)).join('')}</row>`, ...d.rows.map((r, k) => `<row r="${k + 2}">${cells(r, d.costs).map((v, i) => cell(k + 2, i, v)).join('')}</row>`)]
  const last = `${colLetter(head.length - 1)}${d.rows.length + 1}`
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F7"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  const enc = new TextEncoder(); const f = (name: string, s: string) => ({ name, data: enc.encode(s) })
  return zipStore([
    f('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    f('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    f('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inventario" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    f('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    f('xl/styles.xml', styles),
    f('xl/worksheets/sheet1.xml', sheet),
  ])
}

// ---------- PDF (hoja A4 horizontal, tabla con letra de ancho fijo) ----------
const CP1252: Record<number, number> = { 0x20ac: 0x80, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85 }
/** Texto a bytes WinAnsi (acentos y ñ incluidos); lo demás se cambia por «?». */
const win = (s: string) => { let o = ''; for (const ch of s.normalize('NFC')) { const c = ch.codePointAt(0)!; o += c < 0x80 || (c >= 0xa0 && c <= 0xff) ? String.fromCharCode(c) : CP1252[c] != null ? String.fromCharCode(CP1252[c]!) : '?' } return o }
const pdfEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
const fit = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '.' : s)
const money2 = (v: number | null) => (v == null ? '' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const qty = (v: number | null) => (v == null ? '' : String(Math.round(v * 1000) / 1000))

export function toPdf(d: InvData): Uint8Array {
  const W = 841.89, H = 595.28, M = 36, LH = 11, CW = 4.8
  const cols = d.costs
    ? [{ h: 'Código', w: 14, r: false }, { h: 'Nombre', w: 38, r: false }, { h: 'Categoría', w: 15, r: false }, { h: 'Unid.', w: 6, r: false }, { h: 'Precio', w: 10, r: true }, { h: 'Mayoreo', w: 10, r: true }, { h: 'Costo', w: 10, r: true }, { h: 'Exist.', w: 9, r: true }, { h: 'Mín.', w: 6, r: true }, { h: 'Valor', w: 12, r: true }]
    : [{ h: 'Código', w: 15, r: false }, { h: 'Nombre', w: 46, r: false }, { h: 'Categoría', w: 18, r: false }, { h: 'Unid.', w: 6, r: false }, { h: 'Precio', w: 11, r: true }, { h: 'Mayoreo', w: 11, r: true }, { h: 'Exist.', w: 10, r: true }, { h: 'Mín.', w: 7, r: true }]
  const line = (vals: string[]) => vals.map((v, i) => { const c = cols[i]!; const t = fit(v, c.w); return c.r ? t.padStart(c.w) : t.padEnd(c.w) }).join('  ')
  const body = d.rows.map((r) => line(d.costs
    ? [r.code, r.name, r.category, r.unit, money2(r.price), money2(r.wholesale), money2(r.cost), qty(r.stock), qty(r.min), money2(r.value)]
    : [r.code, r.name, r.category, r.unit, money2(r.price), money2(r.wholesale), qty(r.stock), qty(r.min)]))
  const total = d.costs ? d.rows.reduce((a, r) => a + (r.value ?? 0), 0) : null
  const perPage = Math.floor((H - M * 2 - 70) / LH)
  const pages = Math.max(1, Math.ceil(body.length / perPage))
  const streams: string[] = []
  for (let p = 0; p < pages; p++) {
    let s = ''
    const text = (font: string, size: number, x: number, y: number, t: string) => { s += `BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfEsc(win(t))}) Tj ET\n` }
    let y = H - M - 12
    text('F3', 14, M, y, `Inventario - ${d.business}`)
    y -= 15
    text('F1', 9, M, y, `${d.branch ? d.branch + '  |  ' : ''}al ${d.date}  |  ${d.rows.length} productos${total != null ? `  |  Valor a costo: $${money2(total)}` : ''}`)
    y -= 18
    text('F2', 8, M, y, line(cols.map((c) => c.h)))
    s += `0.2 G 0.8 w ${M} ${(y - 3).toFixed(2)} m ${(W - M).toFixed(2)} ${(y - 3).toFixed(2)} l S\n`
    y -= LH + 2
    for (const l of body.slice(p * perPage, (p + 1) * perPage)) {
      text('F1', 8, M, y, l)
      s += `0.88 G 0.4 w ${M} ${(y - 2.5).toFixed(2)} m ${(W - M).toFixed(2)} ${(y - 2.5).toFixed(2)} l S\n`
      y -= LH
    }
    text('F1', 7, M, M - 6, `Pagina ${p + 1} de ${pages}  |  Generado por NEXORA`)
    void CW
    streams.push(s)
  }
  // Objetos: 1 catálogo, 2 páginas, 3-5 fuentes, luego (página, contenido) por hoja.
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

// ---------- Ruta ----------
export const inventarioExport = new Hono<Env>()

const FORMATS = { xlsx: { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' }, csv: { type: 'text/csv; charset=utf-8', ext: 'csv' }, pdf: { type: 'application/pdf', ext: 'pdf' } } as const

inventarioExport.get('/inventory/export', requirePerm('view_inventory'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const format = (c.req.query('format') ?? 'xlsx') as keyof typeof FORMATS
  if (!FORMATS[format]) throw bad('Elige el formato: xlsx, csv o pdf.')
  const branchId = c.req.query('branchId') ?? u.branch_id ?? (db.prepare('SELECT id FROM branches WHERE business_id = ? AND active = 1 ORDER BY created_at LIMIT 1').get(u.business_id) as { id: string } | undefined)?.id
  if (!branchId || !db.prepare('SELECT 1 FROM branches WHERE id = ? AND business_id = ?').get(branchId, u.business_id)) throw bad('Sucursal no válida.')
  const costs = canFinance(u, 'costs')
  const date = localDate(now())
  const data = inventoryData(db, u.business_id, branchId, costs, date)
  const bytes = format === 'xlsx' ? toXlsx(data) : format === 'csv' ? toCsv(data) : toPdf(data)
  const slug = data.business.normalize('NFD').replace(/[\u0300-\u036f/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'negocio'
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'inventario.exportado', newValue: { format, productos: data.rows.length, conCostos: costs } })
  return new Response(bytes as unknown as BodyInit, { status: 200, headers: { 'content-type': FORMATS[format].type, 'content-disposition': `attachment; filename="inventario-${slug}-${date}.${FORMATS[format].ext}"`, 'cache-control': 'no-store' } })
})
