// Recorrido profundo: cada demo (dueño y empleado), cada pantalla y pestaña, en celular y computadora.
// Detecta: errores JS, API con error, página más ancha que la pantalla, elementos que se salen y botones con texto cortado.
const { chromium } = require('playwright'); const fs = require('fs')
const B = process.env.B || 'http://localhost:3135', SP = process.argv[2], ONLY = process.argv[3]
const demos = fs.readFileSync(SP + '/demos.txt', 'utf8').trim().split('\n').map((l) => l.split(' ')).filter(([g]) => !ONLY || ONLY.split(',').includes(g))
const post = async (p, body) => (await fetch(B + '/api' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
const probe = () => {
  const W = innerWidth, out = []
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' }
  const inScroller = (e) => { for (let p = e.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return true; if (p.tagName === 'MAIN') break } return false }
  for (const e of document.querySelectorAll('main button, main a, main input, main select, main .card, main h1, main h2, main td, main label')) {
    if (!vis(e)) continue
    const r = e.getBoundingClientRect()
    if ((r.right > W + 1 || r.left < -1) && !inScroller(e)) out.push(`sale de la pantalla: <${e.tagName.toLowerCase()} class="${e.className}"> «${(e.innerText || e.value || '').trim().slice(0, 40)}» (${Math.round(r.left)}–${Math.round(r.right)} de ${W})`)
    if (e.tagName === 'BUTTON' && e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).overflow !== 'visible') out.push(`botón cortado: «${e.innerText.trim().slice(0, 40)}»`)
  }
  if (document.documentElement.scrollWidth > W + 1) out.push(`página más ancha: ${document.documentElement.scrollWidth} > ${W}`)
  return [...new Set(out)].slice(0, 8)
}
;(async () => {
  const b = await chromium.launch(); const report = []; const known = {}
  for (const [giro, phone] of demos) for (const who of ['dueño', 'empleado']) for (const [dev, vp] of [['pc', { width: 1366, height: 900 }], ['cel', { width: 390, height: 844 }]]) {
    const r = who === 'dueño' ? await post('/auth/owner/login', { phone, password: 'demo1234' }) : await post('/auth/login', { username: 'demo.' + giro, password: 'demo1234' })
    if (!r.token) { report.push(`${giro} ${who}: no pudo entrar ${JSON.stringify(r).slice(0, 120)}`); continue }
    const ctx = await b.newContext({ viewport: vp, timezoneId: 'America/Mexico_City', ...(dev === 'cel' ? { isMobile: true, hasTouch: true } : {}) })
    await ctx.addInitScript((t) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, r.token)
    const p = await ctx.newPage(); let errs = []
    p.on('pageerror', (e) => errs.push('JS ' + e.message))
    p.on('response', (x) => { if (x.url().includes('/api/') && x.status() >= 400 && x.status() !== 401) errs.push(x.status() + ' ' + x.request().method() + ' ' + x.url().replace(B, '')) })
    await p.goto(B + '/'); await p.waitForTimeout(1800)
    const keys = dev === 'cel' && known[giro + who] ? [...known[giro + who]] : await p.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="#/"]')].map((a) => a.getAttribute('href').slice(2)))])
    const portals = await p.locator('.side nav .portal-btn').count()
    if (dev === 'pc') for (let i = 0; i < portals; i++) { await p.locator('.side nav .portal-btn').nth(i).click().catch(() => {}); await p.waitForTimeout(120); for (const k of await p.evaluate(() => [...document.querySelectorAll('.portal-pop a[href^="#/"]')].map((a) => a.getAttribute('href').slice(2)))) if (!keys.includes(k)) keys.push(k); await p.keyboard.press('Escape') }
    if (dev === 'pc') known[giro + who] = keys
    for (const k of keys) {
      if (k.includes('/')) continue
      errs = []
      await p.goto(B + '/#/' + k); await p.waitForTimeout(900)
      const issues = await p.evaluate(probe)
      const tabs = await p.locator('main nav.subtabs button, main .tabs button').allInnerTexts().catch(() => [])
      for (const t of tabs.slice(0, 12)) {
        await p.locator('main nav.subtabs button, main .tabs button', { hasText: t }).first().click().catch(() => {}); await p.waitForTimeout(350)
        for (const i of await p.evaluate(probe)) issues.push(`[${t.trim()}] ${i}`)
      }
      if (dev === 'cel') await p.screenshot({ path: `${SP}/shots/${giro}-${who}-${k}.png`, fullPage: true }).catch(() => {})
      const all = [...new Set([...issues, ...errs])]
      if (all.length) report.push(`${giro} · ${who} · ${dev} · ${k}:\n   ` + all.join('\n   '))
    }
    await ctx.close()
  }
  fs.writeFileSync(SP + '/deep-report.txt', report.join('\n')); console.log(report.length ? report.join('\n') : 'SIN HALLAZGOS'); await b.close()
})()
