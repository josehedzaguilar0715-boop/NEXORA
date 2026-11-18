import { describe, expect, it } from 'vitest'
import { negocioListo } from './helpers.js'

describe('rifa de sellos (Barbería Fénix)', () => {
  it('ganan los primeros en llegar; el mismo día desempata quien tiene más faciales o compras; se descuentan al entregar', async () => {
    const { s, T, o, product, buy, open } = await negocioListo()
    s.setGiro('barberia')
    await s.call('PUT', '/modules', { token: T, body: { active: ['fidelidad'] } })
    await s.call('PUT', '/loyalty', { token: T, body: { unit: 'sellos', earnBy: 'venta', earnPoints: 1, scope: 'todos', dailyCap: 3 } })
    const r = await s.call('POST', '/campaigns', { token: T, body: { name: 'Rifa de diciembre', prizes: [
      { name: 'Perfume', goal: 10, quantity: 2, tiebreak: 'faciales' },
      { name: 'Servicio VIP', goal: 7, quantity: 2, tiebreak: 'faciales' },
      { name: 'Kit de peinado', goal: 5, quantity: 2, tiebreak: 'productos' },
    ] } })
    expect(r.status).toBe(201)
    const campId = r.json.campaign.id
    // Solo una rifa activa a la vez.
    expect((await s.call('POST', '/campaigns', { token: T, body: { name: 'Otra', prizes: [{ name: 'Gorra', goal: 1, quantity: 1, tiebreak: 'ninguno' }] } })).status).toBe(409)

    await open(0)
    const corte = (await s.call('POST', '/services', { token: T, body: { name: 'Corte', price: 15000, durationMin: 30 } })).json.service
    const facial = (await s.call('POST', '/services', { token: T, body: { name: 'Facial', price: 20000, durationMin: 30 } })).json.service
    const cera = await product({ name: 'Cera', unit: 'pieza', price: 15000 })
    await buy([{ productId: cera.id, quantity: 50, cost: 5000 }])
    const cli = async (name: string) => (await s.call('POST', '/customers', { token: T, body: { name } })).json.customer
    const ana = await cli('Ana'), beto = await cli('Beto'), caro = await cli('Caro'), dani = await cli('Dani')
    const pay = (c: any, items: any[]) => s.call('POST', '/sales', { token: T, body: { id: s.uuid(), paymentMethod: 'efectivo', customerId: c.id, items } })
    const days = async (c: any, n: number, items: any[]) => { for (let i = 0; i < n; i++) await pay(c, items) }

    // Día 1: los cuatro juntan 3 sellos. Beto compra cera (productos) y Caro un facial.
    await days(ana, 3, [{ serviceId: corte.id, quantity: 1 }])
    await days(beto, 3, [{ serviceId: corte.id, quantity: 1 }, { productId: cera.id, quantity: 1 }])
    await days(caro, 3, [{ serviceId: facial.id, quantity: 1 }])
    await days(dani, 3, [{ serviceId: corte.id, quantity: 1 }])
    s.advance(86_400_000); s.longLived()
    // Día 2: llegan a 5 sellos Ana, Beto y Dani el mismo día. Desempate por productos: Beto (3) primero; Ana y Dani 0 → la primera en llegar.
    await days(ana, 2, [{ serviceId: corte.id, quantity: 1 }])
    await days(beto, 2, [{ serviceId: corte.id, quantity: 1 }])
    await days(dani, 2, [{ serviceId: corte.id, quantity: 1 }])
    let st = (await s.call('GET', '/campaigns', { token: T })).json.campaigns[0]
    let kit = st.prizes.find((p: any) => p.name === 'Kit de peinado')
    expect(kit.standings.map((x: any) => [x.name, x.status])).toEqual([['Beto', 'ganador'], ['Ana', 'ganador'], ['Dani', 'en_espera']])

    // El cliente ve en su tarjeta su lugar en la rifa.
    const pub = (await s.call('GET', `/public/loyalty/${dani.code}/campaign`)).json.campaign
    expect(pub.prizes.find((p: any) => p.name === 'Kit de peinado')).toMatchObject({ status: 'en_espera', place: 3, remaining: 2 })

    // Entregar el kit a Beto: se le descuentan 5 sellos y ya no compite por otros premios.
    expect((await s.call('POST', `/campaigns/${campId}/prizes/${kit.id}/deliver`, { token: T, body: { customerId: dani.id } })).status).toBe(409)
    const del = await s.call('POST', `/campaigns/${campId}/prizes/${kit.id}/deliver`, { token: T, body: { customerId: beto.id } })
    expect(del.status).toBe(200)
    expect((await s.call('GET', `/public/loyalty/${beto.code}`)).json.balance).toBe(0)
    kit = del.json.campaign.prizes.find((p: any) => p.name === 'Kit de peinado')
    expect(kit.remaining).toBe(1)
    expect(kit.standings.map((x: any) => [x.name, x.status])).toEqual([['Beto', 'entregado'], ['Ana', 'ganador'], ['Dani', 'en_espera']])

    // Días 3 y 4: Caro (con faciales) y Dani llegan a 7 el mismo día: Caro queda primero por faciales aunque Dani llegó antes en la hora.
    s.advance(86_400_000); s.longLived()
    await days(caro, 3, [{ serviceId: facial.id, quantity: 1 }]) // 6
    await days(dani, 1, [{ serviceId: corte.id, quantity: 1 }]) // 6
    s.advance(86_400_000); s.longLived()
    await days(dani, 1, [{ serviceId: corte.id, quantity: 1 }]) // 7 (llega primero en la hora)
    await days(caro, 1, [{ serviceId: facial.id, quantity: 1 }]) // 7 (mismo día, más faciales)
    st = (await s.call('GET', '/campaigns', { token: T })).json.campaigns[0]
    const vip = st.prizes.find((p: any) => p.name === 'Servicio VIP')
    expect(vip.standings[0]).toMatchObject({ name: 'Caro', status: 'ganador' })
    // Dani gana el VIP (segundo lugar) y por eso deja libre su lugar en el kit... pero el kit ya tenía a Ana como ganadora.
    expect(vip.standings[1]).toMatchObject({ name: 'Dani', status: 'ganador' })
    kit = st.prizes.find((p: any) => p.name === 'Kit de peinado')
    expect(kit.standings.map((x: any) => x.name)).toEqual(['Beto', 'Ana'])

    // Terminar la rifa: ya no aparece en la tarjeta del cliente.
    await s.call('POST', `/campaigns/${campId}/end`, { token: T })
    expect((await s.call('GET', `/public/loyalty/${ana.code}/campaign`)).json.campaign).toBeNull()
    void o
  })

  it('la rifa cierra en su fecha: después ya no cuenta quien llegue', async () => {
    const { s, T, open } = await negocioListo()
    s.setGiro('barberia')
    await s.call('PUT', '/modules', { token: T, body: { active: ['fidelidad'] } })
    await s.call('PUT', '/loyalty', { token: T, body: { unit: 'sellos', earnBy: 'venta', earnPoints: 1, scope: 'todos', dailyCap: 3 } })
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(Date.now()))
    const r = await s.call('POST', '/campaigns', { token: T, body: { name: 'Rifa corta', endDate: today, prizes: [{ name: 'Kit de peinado', goal: 2, quantity: 2, tiebreak: 'ninguno' }] } })
    expect(r.json.campaign.endsAt).toBeTruthy()
    await open(0)
    const corte = (await s.call('POST', '/services', { token: T, body: { name: 'Corte', price: 15000, durationMin: 30 } })).json.service
    const a = (await s.call('POST', '/customers', { token: T, body: { name: 'Ana' } })).json.customer
    const b = (await s.call('POST', '/customers', { token: T, body: { name: 'Beto' } })).json.customer
    const pay = (c: any) => s.call('POST', '/sales', { token: T, body: { id: s.uuid(), paymentMethod: 'efectivo', customerId: c.id, items: [{ serviceId: corte.id, quantity: 1 }] } })
    await pay(a); await pay(a) // Ana llega a 2 antes del cierre
    s.advance(2 * 86_400_000); s.longLived()
    await pay(b); await pay(b) // Beto llega después del cierre: no cuenta
    const st = (await s.call('GET', '/campaigns', { token: T })).json.campaigns[0]
    expect(st.prizes[0].standings.map((x: any) => x.name)).toEqual(['Ana'])
    // Se puede mover la fecha de cierre.
    const later = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(Date.now() + 5 * 86_400_000))
    const p = await s.call('PATCH', `/campaigns/${st.id}`, { token: T, body: { endDate: later } })
    expect(p.json.campaign.prizes[0].standings.map((x: any) => x.name)).toEqual(['Ana', 'Beto'])
  })
})
