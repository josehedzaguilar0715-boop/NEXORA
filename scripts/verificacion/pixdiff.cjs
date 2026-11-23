// Toma la misma pantalla con el CSS anterior y con el nuevo (mismos datos y hora) y cuenta píxeles distintos.
const { chromium } = require('playwright'); const fs = require('fs')
const B = 'http://localhost:3135', SP = process.argv[2], OLD = fs.readFileSync(SP + '/styles.before.css', 'utf8')
;(async () => {
  const b = await chromium.launch()
  const tok = (await (await fetch(B + '/api/auth/owner/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '5500000001', password: 'demo1234' }) })).json()).token
  for (const path of ['#/inicio', '#/caja', '#/productos', '#/reportes']) {
    const shots = []
    for (const mode of ['nuevo', 'anterior']) {
      const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
      await ctx.addInitScript((t) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t); Date.now = () => 1795449600000 }, tok)
      const p = await ctx.newPage(); await p.goto(B + '/' + path); await p.waitForTimeout(1500)
      if (mode === 'anterior') { await p.evaluate((css) => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('--bg')) s.remove(); for (const l of document.querySelectorAll('link[rel=stylesheet]')) l.remove(); const st = document.createElement('style'); st.textContent = css; document.head.append(st) }, OLD); await p.waitForTimeout(400) }
      await p.addStyleTag({ content: '.clock,.dash-head .clock{visibility:hidden} *{animation:none!important;transition:none!important}' })
      shots.push(await p.screenshot()); await ctx.close()
    }
    fs.writeFileSync(`${SP}/pd-a.png`, shots[0]); fs.writeFileSync(`${SP}/pd-b.png`, shots[1])
    const { execSync } = require('child_process')
    console.log(path, execSync(`python3 -c "
from PIL import Image, ImageChops
a=Image.open('${SP}/pd-a.png').convert('RGB'); b=Image.open('${SP}/pd-b.png').convert('RGB')
d=ImageChops.difference(a,b).convert('L').point(lambda v: 255 if v>6 else 0)
print('pixeles distintos:', sum(1 for v in d.getdata() if v), 'de', a.size[0]*a.size[1])
"`).toString().trim())
  }
  await b.close()
})()
