// Mide la caja con CPU 4x más lenta (celular de gama baja): abrir la caja y agregar productos al carrito.
const { chromium } = require('playwright')
;(async () => {
  const b = await chromium.launch()
  const res = {}
  for (const [name, B] of [['antes', 'http://localhost:3136'], ['ahora', 'http://localhost:3135']]) {
    const tok = (await (await fetch(B + '/api/auth/owner/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '5500000001', password: 'demo1234' }) })).json()).token
    const runs = { open: [], add: [] }
    for (let r = 0; r < 6; r++) {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
      await ctx.addInitScript((t) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, tok)
      const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
      const t0 = Date.now(); await p.goto(B + '/#/caja'); await p.getByPlaceholder(/Código o nombre/).waitFor(); runs.open.push(Date.now() - t0)
      for (let i = 0; i < 5; i++) {
        const before = await p.locator('.pos-total').innerText()
        const s = Date.now()
        await p.getByPlaceholder(/Código o nombre/).fill('7501000000011'); await p.keyboard.press('Enter')
        await p.waitForFunction((b) => document.querySelector('.pos-total')?.innerText !== b, before, { timeout: 5000 })
        runs.add.push(Date.now() - s)
      }
      await ctx.close()
    }
    const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)]
    res[name] = { abrirCajaMs: med(runs.open), agregarProductoMs: med(runs.add) }
  }
  console.log(JSON.stringify(res, null, 1)); await b.close()
})()
