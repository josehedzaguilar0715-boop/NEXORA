import { describe, expect, it } from 'vitest'
import { setup } from './helpers.js'

describe('límite de intentos por IP (rutas públicas)', () => {
  const req = (s: ReturnType<typeof setup>, path: string, body: object, ip: string) =>
    s.app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body) })

  it('muchos intentos de entrar con cuentas distintas desde una IP: se frena; otra IP sigue; se libera con el tiempo', async () => {
    const s = setup()
    let last = 0
    for (let i = 0; i < 31; i++) last = (await req(s, '/auth/login', { businessCode: 'XXXX', username: `u${i}`, password: 'nada12345' }, '1.2.3.4')).status
    expect(last).toBe(429)
    const r = await req(s, '/auth/login', { businessCode: 'XXXX', username: 'u', password: 'nada12345' }, '1.2.3.4')
    expect(r.headers.get('retry-after')).toBeTruthy()
    expect(((await r.json()) as any).error.code).toBe('demasiados_intentos')
    expect((await req(s, '/auth/login', { businessCode: 'XXXX', username: 'u', password: 'nada12345' }, '5.6.7.8')).status).not.toBe(429)
    s.advance(11 * 60_000)
    expect((await req(s, '/auth/login', { businessCode: 'XXXX', username: 'u', password: 'nada12345' }, '1.2.3.4')).status).not.toBe(429)
  })

  it('registros (mandan SMS): máximo 10 por hora por IP', async () => {
    const s = setup()
    const codes: number[] = []
    for (let i = 0; i < 11; i++) codes.push((await req(s, '/auth/register', { businessName: 'Neg ' + i, ownerName: 'Dueño', phone: '55123400' + String(i).padStart(2, '0'), password: 'secreto123' }, '9.9.9.9')).status)
    expect(codes.slice(0, 10).every((c) => c !== 429)).toBe(true)
    expect(codes[10]).toBe(429)
  })

  it('sin IP de Cloudflare (pruebas, desarrollo) no se limita; las rutas con sesión no cuentan', async () => {
    const s = setup()
    for (let i = 0; i < 40; i++) await s.call('POST', '/auth/login', { body: { businessCode: 'XXXX', username: 'u', password: 'nada12345' } })
    expect((await s.call('POST', '/auth/login', { body: { businessCode: 'XXXX', username: 'u', password: 'nada12345' } })).status).not.toBe(429)
  })
})
