// Impresión: ticket de venta, corte X y boletos con QR, tal como los recibe la impresora (PDF de 58 y 80 mm).
// Pulsa los botones reales de la app; window.print se sustituye para capturar lo que se mandaría a imprimir.
// Uso: servidor local con las demos (ver README) y `node scripts/verificacion/impresion.cjs <carpeta-salida>`.
// Revisa: una sola hoja, renglones completos (32 columnas) y QR presentes. Requiere `pdfinfo`/`pdftotext` (poppler).
const { chromium } = require('playwright'); const { execSync } = require('child_process')
const B = process.env.B || 'http://localhost:3135', OUT = process.argv[2] || '.'
const login = async (phone) => (await (await fetch(B + '/api/auth/owner/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone, password: 'demo1234' }) })).json()).token
let fails = 0; const ok = (c, m) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
;(async () => {
  const b = await chromium.launch()
  const page = async (token, hash) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
    await ctx.addInitScript((t) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t); window.print = () => { window.__printed = (window.__printed || 0) + 1 } }, token)
    const p = await ctx.newPage(); p.on('dialog', (d) => d.accept()); await p.goto(B + '/' + hash); await p.waitForTimeout(2200); return p
  }
  // Cada PDF se genera justo después de pulsar el botón (la app limpia al terminar de imprimir).
  const capture = async (p, click, name, w) => { await p.emulateMedia({ media: 'screen' }); await click(); await p.waitForTimeout(300); await p.emulateMedia({ media: 'print' }); const f = `${OUT}/${name}-${w}.pdf`; p.lastImgs = await p.locator('.print-root img').count(); await p.pdf({ path: f, width: w, printBackground: true }); await p.emulateMedia({ media: 'screen' }); await p.evaluate(() => window.dispatchEvent(new Event('afterprint'))); return f }
  const pages = (f) => Number(execSync(`pdfinfo ${f}`).toString().match(/Pages:\s+(\d+)/)[1])
  const text = (f) => execSync(`pdftotext -layout ${f} -`).toString()
  // Ticket de venta y corte X (abarrotes)
  const T = await login('5500000001'); const call = async (m, u, body) => (await fetch(B + '/api' + u, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + T }, body: body ? JSON.stringify(body) : undefined })).json()
  if (!(await call('GET', '/shifts/current')).shift) await call('POST', '/shifts/open', { openingFloat: 50000 })
  let p = await page(T, '#/caja')
  for (const n of ['Aceite', 'Caramelo', 'Chicle']) { await p.getByPlaceholder(/Código o nombre/).fill(n); await p.keyboard.press('Enter'); await p.waitForTimeout(400) }
  await p.getByRole('button', { name: /^Cobrar/ }).first().click(); await p.waitForTimeout(800); await p.locator('.modal button.primary').last().click(); await p.waitForTimeout(1500)
  for (const w of ['58mm', '80mm']) {
    const f = await capture(p, () => p.getByRole('button', { name: 'Imprimir ticket' }).click(), 'ticket', w)
    const lines = text(f).split('\n').filter((l) => l.trim())
    ok(pages(f) === 1, `ticket ${w}: ${pages(f)} hoja(s)`)
    ok(lines.some((l) => /^TOTAL\s+\$[\d,.]+$/.test(l.trim())) && lines.some((l) => /^-{32}$/.test(l.trim())), `ticket ${w}: TOTAL y separadores en un solo renglón`)
  }
  await p.getByRole('button', { name: 'Nueva venta' }).click(); await p.waitForTimeout(500)
  await p.getByRole('button', { name: 'Corte de caja' }).click(); await p.waitForTimeout(600); await p.getByRole('button', { name: /Corte X/ }).first().click(); await p.waitForTimeout(1500)
  for (const w of ['58mm', '80mm']) { const f = await capture(p, () => p.getByRole('button', { name: 'Imprimir corte X' }).click(), 'corteX', w); ok(pages(f) === 1 && /DEBE HABER EN CAJA\s+\$/.test(text(f)), `corte X ${w}: ${pages(f)} hoja(s), total completo`) }
  // Boletos con QR (turístico)
  const T2 = await login('5500000008'); const call2 = async (m, u, body) => (await fetch(B + '/api' + u, { method: m, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + T2 }, body: body ? JSON.stringify(body) : undefined })).json()
  if (!(await call2('GET', '/shifts/current')).shift) await call2('POST', '/shifts/open', { openingFloat: 10000 })
  p = await page(T2, '#/taquilla')
  const libres = await p.locator('.results button:not([disabled])').count()
  if (!libres) console.log('· boletos: no quedan horarios hoy (se prueba otro día)')
  else {
    await p.locator('.results button:not([disabled])').first().click(); await p.getByRole('button', { name: '+', exact: true }).first().click(); await p.getByRole('button', { name: '+', exact: true }).first().click()
    await p.getByRole('button', { name: 'Efectivo', exact: true }).first().click(); await p.waitForTimeout(2000)
    const f = await capture(p, () => p.getByRole('button', { name: 'Imprimir', exact: true }).click(), 'boletos', '80mm')
    ok(pages(f) === 1 && (text(f).match(/Adulto|Niño|Boleto/gi) || []).length >= 2, `boletos 80mm: ${pages(f)} hoja(s) con los 2 boletos`)
    ok(p.lastImgs >= 2, `boletos: ${p.lastImgs} QR incluidos`)
  }
  await b.close(); console.log(fails ? `${fails} FALLAS` : 'TODO OK'); process.exit(fails ? 1 : 0)
})().catch((e) => { console.error(e.message); process.exit(1) })
