import { describe, expect, it } from 'vitest'
import { setup } from './helpers.js'

describe('escaparate público', () => {
  it('la carta no es pública hasta que el dueño la enciende; solo muestra nombre, precio y foto https', async () => {
    const s = setup()
    const o = await s.registerOwner()
    s.setGiro('restaurante')
    const T = o.token
    await s.call('PATCH', '/business', { token: T, body: { forcePasswordChange: false } })
    await s.call('POST', '/products', { token: T, body: { name: 'Tacos', unit: 'pieza', price: 3000, cost: 1200, attrs: { imagenUrl: 'https://ejemplo.com/tacos.jpg', descripcion: 'De pastor' } } })
    await s.call('POST', '/products', { token: T, body: { name: 'Agua', unit: 'pieza', price: 2000, attrs: { imagenUrl: 'javascript:alert(1)' } } })
    const slug = (await s.call('GET', '/business/public-link', { token: T })).json.slug as string
    // Apagada por defecto.
    expect((await s.call('GET', `/public/carta/${slug}`)).status).toBe(404)
    // Imágenes inseguras se rechazan al guardar el perfil.
    expect((await s.call('PUT', '/escaparate', { token: T, body: { portadaUrl: 'http://inseguro.com/a.jpg' } })).status).toBe(400)
    const ok = await s.call('PUT', '/escaparate', { token: T, body: { publicarCarta: true, descripcion: 'Los mejores tacos', direccion: 'Centro', portadaUrl: 'https://ejemplo.com/p.jpg' } })
    expect(ok.status).toBe(200)
    const r = (await s.call('GET', `/public/carta/${slug}`)).json
    expect(r.kind).toBe('menu')
    expect(r.profile.descripcion).toBe('Los mejores tacos')
    const items = r.sections.flatMap((x: any) => x.items)
    expect(items.find((i: any) => i.name === 'Tacos').imageUrl).toBe('https://ejemplo.com/tacos.jpg')
    expect(items.find((i: any) => i.name === 'Agua').imageUrl).toBeNull()
    // Nada interno: ni costos, ni existencias, ni ids.
    expect(JSON.stringify(r)).not.toMatch(/cost|stock|business_id|"id"/i)
  })

  it('solo el dueño edita el escaparate y el enlace de otro negocio no lo ve', async () => {
    const s = setup()
    const o = await s.registerOwner()
    const e = await s.call('GET', '/escaparate', { token: o.token })
    expect(e.status).toBe(200)
    expect((await s.call('GET', '/escaparate')).status).toBe(401)
    expect((await s.call('GET', '/public/carta/no-existe')).status).toBe(404)
  })
})
