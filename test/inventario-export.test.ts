import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

async function abarrotes() {
  const n = await negocioListo()
  const { s, o, T } = n
  const cat = (await s.call('POST', '/categories', { token: T, body: { name: 'Bebidas' } })).json.category
  const a = await n.product({ name: 'Refresco 600 ml', unit: 'pieza', price: 2200, barcode: '7501055300075', categoryId: cat?.id })
  const b = await n.product({ name: 'Jabón "Zote" (grande) ñandú', unit: 'pieza', price: 1850 })
  const c = await n.product({ name: 'Frijol a granel', unit: 'kg', price: 3200 })
  await s.call('PUT', `/products/${a.id}/price-tiers`, { token: T, body: { tiers: [{ minQuantity: 12, price: 1900 }] } })
  await n.buy([{ productId: a.id, quantity: 24, cost: 33600 }, { productId: b.id, quantity: 10, cost: 14000 }, { productId: c.id, quantity: 5.5, cost: 12000 }])
  return { ...n, a, b, c, o }
}
const bin = async (s: any, T: string, q: string) => { const r = await s.app.request(`/inventory/export?${q}`, { headers: { authorization: `Bearer ${T}` } }); return { status: r.status, type: r.headers.get('content-type') ?? '', disp: r.headers.get('content-disposition') ?? '', buf: Buffer.from(await r.arrayBuffer()) } }

describe('exportar inventario (Excel, CSV y PDF)', () => {
  it('Excel: un libro .xlsx válido con todo el inventario, costos y existencias', async () => {
    const { s, T } = await abarrotes()
    const r = await bin(s, T, 'format=xlsx')
    expect(r.status).toBe(200)
    expect(r.type).toContain('spreadsheetml'); expect(r.disp).toMatch(/inventario-.*\.xlsx/)
    expect(r.buf.subarray(0, 2).toString()).toBe('PK')
    const dir = mkdtempSync(join(tmpdir(), 'inv-')); const f = join(dir, 'inv.xlsx'); writeFileSync(f, r.buf)
    // Lo leemos con una biblioteca ajena (openpyxl), como lo haría otro sistema.
    const out = execFileSync('python3', ['-c', `
import openpyxl, json
ws = openpyxl.load_workbook(${JSON.stringify(f)}).active
print(json.dumps([[c.value for c in row] for row in ws.iter_rows()]))
`]).toString()
    const rows = JSON.parse(out) as any[][]
    expect(rows[0]).toEqual(['Código de barras', 'Nombre', 'Categoría', 'Unidad', 'Precio de venta', 'Precio de mayoreo', 'Mayoreo desde', 'Costo', 'Existencia', 'Mínimo', 'Valor a costo'])
    expect(rows).toHaveLength(4)
    const ref = rows.find((x) => x[1] === 'Refresco 600 ml')!
    expect(ref[0]).toBe('7501055300075')            // el código queda como texto (sin notación científica)
    expect(ref[4]).toBe(22); expect(ref[5]).toBe(19); expect(ref[6]).toBe(12)
    expect(ref[7]).toBe(14); expect(ref[8]).toBe(24); expect(ref[10]).toBe(336)
    expect(rows.find((x) => x[1] === 'Jabón "Zote" (grande) ñandú')).toBeTruthy()  // comillas, paréntesis y ñ
    expect(rows.find((x) => x[1] === 'Frijol a granel')![8]).toBe(5.5)
  })

  it('CSV: abre en Excel (BOM), con comillas bien escapadas y los mismos encabezados que «Importar»', async () => {
    const { s, T } = await abarrotes()
    const r = await bin(s, T, 'format=csv')
    expect(r.status).toBe(200); expect(r.buf.subarray(0, 3).toString('hex')).toBe('efbbbf')
    const txt = r.buf.toString('utf8')
    expect(txt.split('\r\n')[0]).toContain('Código de barras,Nombre,Categoría,Unidad,Precio de venta')
    expect(txt).toContain('"Jabón ""Zote"" (grande) ñandú"')
    expect(txt).toContain('7501055300075,Refresco 600 ml')
  })

  it('PDF: documento válido, con el nombre de cada producto y los totales', async () => {
    const { s, T } = await abarrotes()
    const r = await bin(s, T, 'format=pdf')
    expect(r.status).toBe(200); expect(r.type).toBe('application/pdf')
    expect(r.buf.subarray(0, 5).toString()).toBe('%PDF-'); expect(r.buf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true)
    const dir = mkdtempSync(join(tmpdir(), 'inv-')); const f = join(dir, 'inv.pdf'); writeFileSync(f, r.buf)
    const info = execFileSync('pdfinfo', [f]).toString(); expect(info).toMatch(/Pages:\s+1/)
    const txt = execFileSync('pdftotext', ['-layout', f, '-']).toString()
    for (const t of ['Inventario', 'Refresco 600 ml', 'Frijol a granel', 'ñandú', 'Valor a costo']) expect(txt).toContain(t)
  })

  it('un inventario grande ocupa varias hojas y nada se corta', async () => {
    const { s, T } = await abarrotes()
    for (let i = 0; i < 120; i++) await s.call('POST', '/products', { token: T, body: { name: `Producto de prueba número ${String(i).padStart(3, '0')}`, unit: 'pieza', price: 1000 + i } })
    const r = await bin(s, T, 'format=pdf'); const dir = mkdtempSync(join(tmpdir(), 'inv-')); const f = join(dir, 'g.pdf'); writeFileSync(f, r.buf)
    expect(execFileSync('pdfinfo', [f]).toString()).toMatch(/Pages:\s+3/)
    const txt = execFileSync('pdftotext', ['-layout', f, '-']).toString()
    expect(txt).toContain('número 000'); expect(txt).toContain('número 119')
    const x = await bin(s, T, 'format=xlsx'); writeFileSync(join(dir, 'g.xlsx'), x.buf)
    const n = execFileSync('python3', ['-c', `import openpyxl;print(openpyxl.load_workbook(${JSON.stringify(join(dir, 'g.xlsx'))}).active.max_row)`]).toString().trim()
    expect(n).toBe('124')
  })

  it('sin permiso de costos no salen ni costo ni valor; sin sesión o con formato raro se rechaza; es solo lectura', async () => {
    const { s, T, o } = await abarrotes()
    const emp = await s.createStaff(T, o.business.code, 'cajera1', 'cajero')
    const r = await bin(s, emp.token, 'format=csv')
    if (r.status === 200) { const h = r.buf.toString('utf8').split('\r\n')[0]!; expect(h).not.toContain('Costo'); expect(h).not.toContain('Valor a costo') }
    else expect(r.status).toBe(403)
    expect((await s.app.request('/inventory/export?format=csv')).status).toBe(401)
    expect((await bin(s, T, 'format=exe')).status).toBe(400)
    const antes = (await s.call('GET', '/products', { token: T })).json.products.length
    await bin(s, T, 'format=xlsx')
    expect((await s.call('GET', '/products', { token: T })).json.products.length).toBe(antes)
  })
})
