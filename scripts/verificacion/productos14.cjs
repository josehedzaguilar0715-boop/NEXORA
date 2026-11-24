// Los 14 productos de NEXORA en el navegador: cada giro entra con su identidad (data-product), las páginas públicas
// (reservar, boletos, tarjeta de sellos) muestran la del negocio, y la base «NEXORA» se usa en el acceso y el super panel.
// Uso: servidor local con las 13 demos y `node scripts/verificacion/productos14.cjs <carpeta con demos.txt>`.
const { chromium } = require('playwright'); const fs = require('fs')
const B = process.env.B || 'http://localhost:3135', SP = process.argv[2]
const EXPECT = { abarrotes: 'market', ferreteria: 'tools', papeleria: 'paper', barberia: 'barber', unas: 'nails', perfumeria: 'scent', banos: 'access', turistico: 'tour', palapa: 'beach', restaurante: 'dining', comedor: 'fonda', taqueria: 'taco', verduleria: 'greens' }
const demos = fs.readFileSync(SP + '/demos.txt', 'utf8').trim().split('\n').map((l) => l.split(' '))
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
;(async () => {
  const b = await chromium.launch(); const seen = new Set()
  const prodOf = async (url, token) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
    if (token) await ctx.addInitScript((t) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, token)
    else await ctx.addInitScript(() => sessionStorage.setItem('nx_intro', '1'))
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message))
    await p.goto(B + url); await p.waitForTimeout(2200)
    const r = { product: await p.evaluate(() => document.documentElement.dataset.product), brand: await p.locator('.product-name').first().innerText().catch(() => ''), errs }
    await ctx.close(); return r
  }
  // Las demos no traen el extra «reservas» (de pago): se activa aquí para probar las páginas públicas reales.
  const adm = (await (await fetch(B + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: process.env.ADMIN_USER || 'soporte', password: process.env.ADMIN_PASS || 'superpanel1' }) })).json()).token
  const bizList = adm ? (await (await fetch(B + '/api/admin/businesses', { headers: { authorization: 'Bearer ' + adm } })).json()).businesses : []
  for (const [giro, phone] of demos) {
    const login = await (await fetch(B + '/api/auth/owner/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, password: 'demo1234' }) })).json()
    const r = await prodOf('/', login.token)
    ok(r.product === EXPECT[giro] && !r.errs.length, `${giro}: entra como «${r.product}» ${r.brand ? '(' + r.brand + ')' : ''}`)
    seen.add(r.product)
    const call = async (p) => (await fetch(B + '/api' + p, { headers: { authorization: 'Bearer ' + login.token } })).json()
    const slug = (await call('/business/public-link')).slug
    if (['barberia', 'unas', 'turistico'].includes(giro) && adm) {
      const biz = bizList.find((x) => x.owner?.phone === phone)
      if (biz && !biz.addons.includes('reservas')) await fetch(B + `/api/admin/businesses/${biz.id}/addons`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + adm }, body: JSON.stringify({ addon: 'reservas', installationFee: 0, note: 'verificación de páginas públicas' }) })
      const mods = (await call('/modules')).active
      if (!mods.includes('reservas')) await fetch(B + '/api/modules', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + login.token }, body: JSON.stringify({ active: [...mods, 'reservas'] }) })
    }
    if (['barberia', 'unas'].includes(giro) && slug) { const x = await prodOf('/reservar/' + slug); ok(x.product === EXPECT[giro], `${giro}: página pública de reservas como «${x.product}»`) }
    if (giro === 'turistico' && slug) { const x = await prodOf('/boletos/' + slug); ok(x.product === EXPECT[giro], `${giro}: tienda pública de boletos como «${x.product}»`) }
    const cust = (await call('/customers')).customers?.find((c) => c.code)
    // Tarjeta de sellos: solo donde el negocio tiene el programa activo (si no, la página dice que no hay tarjeta).
    const card = cust ? await (await fetch(B + '/api/public/loyalty/' + cust.code)).json() : null
    if (card && !card.error) { const x = await prodOf('/tarjeta/' + cust.code); ok(x.product === EXPECT[giro], `${giro}: tarjeta de sellos pública como «${x.product}»`) }
  }
  // Base NEXORA: equipo nuevo (acceso) y super panel.
  const first = await prodOf('/'); ok(first.product === 'nexora', `acceso en un equipo nuevo como «${first.product}»`); seen.add(first.product)
  const sp = await prodOf('/admin'); ok(sp.product === 'nexora', `super panel como «${sp.product}»`)
  ok(seen.size === 14, `${seen.size} productos distintos vistos (se esperan 14)`)
  await b.close(); console.log(fails ? `${fails} FALLAS` : 'TODO OK'); process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) })
