import { describe, expect, it } from 'vitest'
import { DEMOS } from '../src/demo.js'
import { setup } from './helpers.js'

describe('negocios de demostración', () => {
  it('crea una demo por giro con datos, sin errores, accesos fáciles y sin duplicar', async () => {
    const s = setup()
    const at = await s.adminToken()
    for (const d of DEMOS) {
      const r = await s.call('POST', `/admin/demos/${d.giro}`, { token: at })
      expect(r.json.error?.message ?? 'ok', d.giro).toBe('ok')
      expect(r.json).toMatchObject({ created: true, demo: { giro: d.giro, password: 'demo1234', staffUser: `demo.${d.giro}`, code: '1234' } })
      // El dueño entra con su teléfono y el empleado con su usuario.
      let own = await s.call('POST', '/auth/owner/login', { body: { phone: r.json.demo.phone, password: 'demo1234' } })
      // En pruebas hay SMS: se completa el código (en producción sin SMS entra directo).
      if (own.json.challengeId) own = await s.call('POST', '/auth/owner/verify', { body: { challengeId: own.json.challengeId, code: s.codes[r.json.demo.phone] } })
      expect(own.json.token, d.giro).toBeTruthy()
      expect(own.json.mustChangePassword).toBe(false)
      const emp = await s.call('POST', '/auth/login', { body: { username: `demo.${d.giro}`, password: 'demo1234' } })
      expect(emp.json.token, d.giro).toBeTruthy()
      // Tiene ventas, inventario o servicios para recorrer.
      const sum = (await s.call('GET', '/reports/summary', { token: own.json.token })).json
      expect(sum.sales.total, d.giro).toBeGreaterThan(0)
    }
    // Repetirlo no duplica.
    const again = await s.call('POST', '/admin/demos/abarrotes', { token: at })
    expect(again.json.created).toBe(false)
    const list = (await s.call('GET', '/admin/demos', { token: at })).json.demos
    expect(list.every((d: any) => d.created)).toBe(true)
    // Son gratis y activas.
    const biz = (await s.call('GET', '/admin/businesses?status=gratis', { token: at })).json.businesses
    expect(biz.length).toBe(DEMOS.length)
  }, 120_000)
})
