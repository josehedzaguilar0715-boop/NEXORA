import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setup } from './helpers.js'

async function barberia() {
  const s = setup()
  const o = await s.registerOwner()
  await s.call('PATCH', '/business', { token: o.token, body: { forcePasswordChange: false } })
  await s.call('PUT', '/modules', { token: o.token, body: { active: ['fidelidad'] } })
  await s.call('PUT', '/loyalty', { token: o.token, body: { unit: 'sellos', earnBy: 'visita', earnPoints: 1, scope: 'por_persona' } })
  const premio = (await s.call('POST', '/loyalty/rewards', { token: o.token, body: { name: 'Facial', cost: 5 } })).json.id
  const mk = async (name: string, phone: string) => (await s.call('POST', '/customers', { token: o.token, body: { name, phone, loyaltyEnrolled: true } })).json.customer
  const ana = await mk('Ana "La Güera" Peña', '5511111111'); const beto = await mk('Beto Núñez', '5522222222'); const sin = await mk('Carlos Sin Sellos', '5533333333')
  await s.call('POST', `/customers/${ana.id}/stamps`, { token: o.token, body: { quantity: 4 } })
  await s.call('POST', `/customers/${beto.id}/stamps`, { token: o.token, body: { quantity: 5 } })
  await s.call('POST', `/customers/${beto.id}/redeem`, { token: o.token, body: { rewardId: premio } })
  return { s, o, ana, beto, sin }
}
const bin = async (s: any, T: string, q: string) => { const r = await s.app.request(`/customers-export?${q}`, { headers: { authorization: `Bearer ${T}` } }); return { status: r.status, type: r.headers.get('content-type') ?? '', disp: r.headers.get('content-disposition') ?? '', buf: Buffer.from(await r.arrayBuffer()) } }
const py = (code: string) => execFileSync('python3', ['-W', 'ignore', '-c', code]).toString()
const tmp = (name: string, b: Buffer) => { const f = join(mkdtempSync(join(tmpdir(), 'cli-')), name); writeFileSync(f, b); return f }

describe('exportar clientes con historial de sellos (Excel, CSV y PDF)', () => {
  it('Excel: hoja de clientes con saldo y próximo premio, y hoja de historial con saldo corrido', async () => {
    const { s, o } = await barberia()
    const r = await bin(s, o.token, 'format=xlsx')
    expect(r.status).toBe(200); expect(r.disp).toMatch(/clientes-.*\.xlsx/)
    const f = tmp('c.xlsx', r.buf)
    const out = JSON.parse(py(`
import openpyxl, json
wb = openpyxl.load_workbook(${JSON.stringify(f)})
print(json.dumps({'hojas': wb.sheetnames, 'c': [[c.value for c in r] for r in wb['Clientes'].iter_rows()], 'h': [[c.value for c in r] for r in wb['Historial'].iter_rows()]}))`))
    expect(out.hojas).toEqual(['Clientes', 'Historial'])
    const c = out.c as any[][]
    expect(c[0]!.slice(0, 5)).toEqual(['Nombre', 'Teléfono', 'Código de cliente', 'En fidelidad', 'Saldo de sellos'])
    expect(c).toHaveLength(4)
    const ana = c.find((x) => String(x[0]).startsWith('Ana'))!
    expect(ana[0]).toBe('Ana "La Güera" Peña'); expect(ana[4]).toBe(4); expect(ana[5]).toBe(4); expect(ana[6]).toBe(0)
    expect(ana[9]).toBe('Facial'); expect(ana[10]).toBe(1)           // le falta 1 sello para el Facial
    const beto = c.find((x) => String(x[0]).startsWith('Beto'))!
    expect(beto[4]).toBe(0); expect(beto[5]).toBe(5); expect(beto[6]).toBe(5)
    const h = out.h as any[][]
    expect(h[0]).toContain('Saldo después'); expect(h).toHaveLength(1 + 3)
    const canje = h.find((x) => x[4] === 'Canje de premio')!
    expect(canje[5]).toBe(-5); expect(canje[6]).toBe(0); expect(canje[7]).toBe('Facial')
  })

  it('CSV de clientes y CSV del historial; PDF con ambas secciones', async () => {
    const { s, o } = await barberia()
    const a = await bin(s, o.token, 'format=csv'); expect(a.buf.subarray(0, 3).toString('hex')).toBe('efbbbf')
    expect(a.buf.toString('utf8')).toContain('"Ana ""La Güera"" Peña"')
    const b = await bin(s, o.token, 'format=csv&parte=historial'); expect(b.disp).toMatch(/historial-sellos-/)
    expect(b.buf.toString('utf8').split('\r\n')[0]).toContain('Fecha,Hora,Cliente')
    const p = await bin(s, o.token, 'format=pdf'); expect(p.type).toBe('application/pdf')
    const f = tmp('c.pdf', p.buf)
    expect(execFileSync('pdfinfo', [f]).toString()).toMatch(/Pages:\s+1/)
    const txt = execFileSync('pdftotext', ['-layout', f, '-']).toString()
    for (const t of ['Clientes -', 'Clientes y tarjeta de fidelidad (3)', 'Historial de sellos (3)', 'Peña', 'Núñez', 'Canje de premio', 'Facial']) expect(txt).toContain(t)
  })

  it('negocio sin tarjeta de fidelidad: solo clientes; el historial se rechaza', async () => {
    const s = setup(); const o = await s.registerOwner()
    await s.call('POST', '/customers', { token: o.token, body: { name: 'Lupita', phone: '5544444444' } })
    const x = await bin(s, o.token, 'format=xlsx'); expect(x.status).toBe(200)
    expect(py(`import openpyxl;print(openpyxl.load_workbook(${JSON.stringify(tmp('s.xlsx', x.buf))}).sheetnames)`)).toContain("['Clientes']")
    expect((await bin(s, o.token, 'format=csv&parte=historial')).status).toBe(400)
  })

  it('solo quien ve reportes; no mezcla negocios; no cambia datos', async () => {
    const { s, o } = await barberia()
    const cajero = await s.createStaff(o.token, o.business.code, 'cajera1', 'cajero')
    expect((await bin(s, cajero.token, 'format=csv')).status).toBe(403)
    expect((await s.app.request('/customers-export?format=csv')).status).toBe(401)
    expect((await bin(s, o.token, 'format=exe')).status).toBe(400)
    const otro = setup(); const o2 = await otro.registerOwner()
    await otro.call('POST', '/customers', { token: o2.token, body: { name: 'Cliente Ajeno', phone: '5599999999' } })
    expect((await bin(otro, o2.token, 'format=csv')).buf.toString('utf8')).not.toContain('Ana')
    expect((await bin(s, o.token, 'format=csv')).buf.toString('utf8')).not.toContain('Ajeno')
  })

  it('muchos clientes: varias hojas, nada se corta y la cabecera se repite', async () => {
    const { s, o } = await barberia()
    for (let i = 0; i < 90; i++) await s.call('POST', '/customers', { token: o.token, body: { name: `Cliente número ${String(i).padStart(3, '0')}`, phone: '5500000000' } })
    const p = await bin(s, o.token, 'format=pdf'); const f = tmp('g.pdf', p.buf)
    const n = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [f]).toString())![1])
    expect(n).toBeGreaterThanOrEqual(3)
    const txt = execFileSync('pdftotext', ['-layout', f, '-']).toString()
    expect(txt).toContain('número 000'); expect(txt).toContain('número 089'); expect(txt).toContain(`Pagina ${n} de ${n}`)
  })
})
