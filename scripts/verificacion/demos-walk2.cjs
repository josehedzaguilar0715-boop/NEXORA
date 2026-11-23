const { chromium } = require('playwright')
const B = process.env.B || 'http://localhost:3135'
;(async () => {
  const post = async (p, body, t) => (await fetch(B + '/api' + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: JSON.stringify(body ?? {}) })).json()
  const at = (await post('/admin/login', { username: 'soporte', password: 'superpanel1' })).token
  const demos = (await (await fetch(B + '/api/admin/demos', { headers: { authorization: 'Bearer ' + at } })).json()).demos
  for (const d of demos) { const r = await post('/admin/demos/' + d.giro, {}, at); if (r.error) console.log('✗ crear', d.giro, r.error.message) }
  const b = await chromium.launch(process.env.HTTPS_PROXY && /^https:/.test(B) ? { proxy: { server: process.env.HTTPS_PROXY } } : {}); let bad = 0
  for (const d of demos) {
    const tok = (await post('/auth/owner/login', { phone: d.phone, password: 'demo1234' })).token
    const ctx = await b.newContext({ viewport: { width: 1366, height: 860 }, timezoneId: 'America/Mexico_City' })
    await ctx.addInitScript((t) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, tok)
    const p = await ctx.newPage(); const errs = []
    p.on('pageerror', (e) => errs.push('JS ' + e.message))
    p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400 && r.status() !== 401) errs.push(r.status() + ' ' + r.url().replace(B, '')) })
    await p.goto(B + '/#/inicio'); await p.waitForTimeout(1200)
    const links = await p.locator('nav > a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
    const n = await p.locator('nav button.portal-btn').count()
    for (let i = 0; i < n; i++) { await p.locator('nav button.portal-btn').nth(i).click(); await p.waitForTimeout(200); links.push(...await p.locator('.portal-pop a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))); await p.keyboard.press('Escape') }
    for (const h of [...new Set(links)]) { await p.goto(B + '/' + h); await p.waitForTimeout(700) }
    console.log(errs.length ? '✗' : '✓', d.label, `(${new Set(links).size} pantallas)`, errs.slice(0, 4).join(' | '))
    if (errs.length) bad++
    await ctx.close()
  }
  console.log(bad ? `CON ERRORES: ${bad}` : 'TODO OK'); await b.close()
})()
