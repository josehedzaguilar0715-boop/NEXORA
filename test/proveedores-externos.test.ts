import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNotifier } from '../src/notify.js'
import { negocioListo, setup } from './helpers.js'

/**
 * SMS (Twilio), correo (Resend) y push (Web Push con VAPID): se verifica el FORMATO exacto de cada petición
 * según la documentación de cada servicio, y qué pasa cuando fallan. Los servicios están SIMULADOS
 * (no hay credenciales ni teléfonos reales en este entorno); el envío real se prueba con las credenciales del propietario.
 */
afterEach(() => vi.unstubAllGlobals())
const ENV = { TWILIO_ACCOUNT_SID: 'AC' + '0'.repeat(32), TWILIO_AUTH_TOKEN: 'token-de-prueba', TWILIO_FROM: '+15005550006', RESEND_API_KEY: 're_prueba', MAIL_FROM: 'NEXORA <avisos@ejemplo.mx>' }

describe('SMS por Twilio', () => {
  it('manda a la API de mensajes con usuario/clave y el número mexicano en +52', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 201 }))
    vi.stubGlobal('fetch', f)
    expect(await createNotifier(ENV).sendCode('9611234567', '482913')).toBe(true)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${ENV.TWILIO_ACCOUNT_SID}/Messages.json`)
    const h = init.headers as Record<string, string>
    expect(atob(h.authorization!.replace('Basic ', ''))).toBe(`${ENV.TWILIO_ACCOUNT_SID}:${ENV.TWILIO_AUTH_TOKEN}`)
    expect(h['content-type']).toBe('application/x-www-form-urlencoded')
    const body = new URLSearchParams(String(init.body))
    expect(body.get('To')).toBe('+529611234567')
    expect(body.get('From')).toBe(ENV.TWILIO_FROM)
    expect(body.get('Body')).toContain('482913')
  })

  it('si Twilio falla, el dueño ve un mensaje claro (no «error interno») y puede reintentar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":21211,"message":"Invalid To"}', { status: 400 })))
    const s = setup()
    // App con SMS activo (como producción con Twilio).
    const { createApp } = await import('../src/app.js')
    const deps = { db: s.db, now: () => new Date('2026-11-17T15:00:00Z'), notifier: createNotifier(ENV) }
    const app = createApp(deps)
    const r = await app.request('/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessName: 'Prueba', ownerName: 'Ana', phone: '5512345678', password: 'secreto123' }) })
    expect(r.status).toBe(502)
    expect(((await r.json()) as any).error).toMatchObject({ code: 'sms_no_enviado', message: expect.stringContaining('No pudimos enviar el SMS') })
    // Sin red también.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(createNotifier(ENV).sendCode('5512345678', '1')).rejects.toMatchObject({ status: 502, code: 'sms_no_enviado' })
  })
})

describe('correo por Resend', () => {
  it('manda JSON con remitente, destinatario y adjunto; si falla, mensaje claro', async () => {
    const f = vi.fn(async () => new Response('{"id":"x"}', { status: 200 }))
    vi.stubGlobal('fetch', f)
    expect(await createNotifier(ENV).sendEmail!('dueno@ejemplo.mx', 'Respaldo', 'Texto', [{ filename: 'r.json.gz', content: 'AAAA' }])).toBe(true)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_prueba')
    expect(JSON.parse(String(init.body))).toEqual({ from: ENV.MAIL_FROM, to: ['dueno@ejemplo.mx'], subject: 'Respaldo', text: 'Texto', attachments: [{ filename: 'r.json.gz', content: 'AAAA' }] })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    await expect(createNotifier(ENV).sendEmail!('d@e.mx', 's', 't')).rejects.toMatchObject({ status: 502, code: 'correo_no_enviado' })
  })

  it('super panel: si el SMS falla, el código igual sale por correo', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(u); return u.includes('twilio') ? new Response('', { status: 500 }) : new Response('{}', { status: 200 }) }))
    const s = setup()
    const { createApp } = await import('../src/app.js')
    const { createAdmin } = await import('../src/admin.js')
    const deps = { db: s.db, now: () => new Date('2026-11-17T15:00:00Z'), notifier: createNotifier(ENV) }
    createAdmin(deps, { name: 'S', username: 'soporte8', password: 'superpanel1', phone: '5511112222', email: 'soporte@ejemplo.mx' })
    const r = await createApp(deps).request('/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'soporte8', password: 'superpanel1' }) })
    const j = (await r.json()) as any
    expect(r.status).toBe(200)
    expect(j.sentTo).toEqual([expect.stringContaining('correo')])
    expect(calls.some((u) => u.includes('twilio')) && calls.some((u) => u.includes('resend'))).toBe(true)
  })
})

describe('push (Web Push, RFC 8030 y VAPID RFC 8292)', () => {
  it('firma VAPID válida con la llave pública que recibe el celular; aud = servicio; vence en ≤ 24 h; 410 borra la suscripción', async () => {
    const { s, o, T, product, open } = await negocioListo()
    s.setGiro('comedor')
    const mesa = (await s.call('POST', '/tables', { token: T, body: { name: '1', area: 'salon', seats: 4 } })).json.id
    const plato = await product({ name: 'Sopa', unit: 'pieza', price: 5000, trackStock: false })
    await open(0)
    const k = await s.createStaff(T, o.business.code, 'cocina1', 'cocina')
    const pub = (await s.call('GET', '/push/key', { token: k.token })).json.publicKey as string
    const f = vi.fn(async (_u: string, _i?: RequestInit) => new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', f)
    for (const ep of ['https://fcm.googleapis.com/fcm/send/a1', 'https://web.push.apple.com/QGx', 'https://updates.push.services.mozilla.com/wpush/v2/z'])
      expect((await s.call('POST', '/push/subscribe', { token: k.token, body: { endpoint: ep } })).status).toBe(201)
    const tab = (await s.call('POST', '/tabs', { token: T, body: { kind: 'mesa', tableId: mesa, people: 1 } })).json.tab
    await s.call('POST', `/tabs/${tab.id}/items`, { token: T, body: { items: [{ productId: plato.id, quantity: 1 }] } })
    await s.call('POST', `/tabs/${tab.id}/send`, { token: T })
    await new Promise((r) => setTimeout(r, 80))
    expect(f).toHaveBeenCalledTimes(3) // Chrome/Android, Safari/iPhone y Firefox
    const b64u = (x: string) => Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (x.length % 4)) % 4)), (c) => c.charCodeAt(0))
    const key = await crypto.subtle.importKey('raw', b64u(pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    for (const [url, init] of f.mock.calls as unknown as [string, RequestInit][]) {
      const h = init.headers as Record<string, string>
      expect(h.ttl).toBe('86400')
      const m = h.authorization!.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/)!
      expect(m[4]).toBe(pub)
      const claims = JSON.parse(new TextDecoder().decode(b64u(m[2]!)))
      expect(claims.aud).toBe(new URL(url).origin)
      expect(claims.exp - Date.parse('2026-11-17T15:00:00Z') / 1000).toBeLessThanOrEqual(24 * 3600)
      expect(claims.sub).toMatch(/^mailto:/)
      expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64u(m[3]!), new TextEncoder().encode(`${m[1]}.${m[2]}`))).toBe(true)
    }
    // El celular se dio de baja (410) y otro servicio está caído: el aviso sigue, la suscripción vencida se borra.
    f.mockImplementation(async (u: string) => (u.includes('apple') ? new Response(null, { status: 410 }) : u.includes('mozilla') ? Promise.reject(new TypeError('caído')) : new Response(null, { status: 201 })) as any)
    const tab2 = (await s.call('POST', '/tabs', { token: T, body: { kind: 'llevar' } })).json.tab
    await s.call('POST', `/tabs/${tab2.id}/items`, { token: T, body: { items: [{ productId: plato.id, quantity: 1 }] } })
    await s.call('POST', `/tabs/${tab2.id}/checkout`, { token: T, body: { parts: [{ paymentMethod: 'efectivo' }] } })
    await s.call('POST', `/tabs/${tab2.id}/send`, { token: T })
    await new Promise((r) => setTimeout(r, 80))
    const left = (s.db.prepare('SELECT endpoint FROM push_subscriptions').all() as any[]).map((r) => r.endpoint)
    expect(left.some((e: string) => e.includes('apple'))).toBe(false)
    expect(left).toHaveLength(2)
  })
})
