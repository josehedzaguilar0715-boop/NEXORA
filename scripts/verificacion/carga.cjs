// Prueba de carga: varios negocios vendiendo a la vez contra un servidor (workerd local o staging).
// Uso: B=<url> NEG=<negocios> CONC=<conexiones simultáneas> TOTAL=<peticiones> node scripts/verificacion/carga.cjs
// Mezcla por petición (como una caja real): 50 % venta (POST /sales), 25 % catálogo, 15 % panel de Inicio, 10 % turno actual.
// Reporta: peticiones/segundo, latencia p50/p95/p99/máx por tipo, errores, y que las ventas cuadren (ninguna perdida ni duplicada).
const B = (process.env.B || 'http://localhost:8799') + '/api'
const NEG = Number(process.env.NEG || 5), CONC = Number(process.env.CONC || 20), TOTAL = Number(process.env.TOTAL || 2000)
const call = async (m, p, token, body) => {
  const t0 = performance.now()
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', 'user-agent': 'nexora-carga', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, json: j, ms: performance.now() - t0 }
}
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0
;(async () => {
  // Preparación: N negocios, cada uno con 20 productos y caja abierta.
  const biz = []
  for (let i = 0; i < NEG; i++) {
    const phone = '559' + String(Date.now()).slice(-6) + String(i)
    const r = await call('POST', '/auth/register', null, { businessName: `Carga ${i}`, ownerName: 'Dueño Prueba', phone, password: 'secreto123', giro: 'abarrotes' })
    if (!r.json.token) { console.error('no se pudo registrar', r.status, JSON.stringify(r.json).slice(0, 160)); process.exit(1) }
    const T = r.json.token
    await call('PATCH', '/business', T, { forcePasswordChange: false })
    const prods = []
    for (let k = 0; k < 20; k++) prods.push((await call('POST', '/products', T, { name: `Producto ${k}`, unit: 'pieza', price: 1000 + k * 50 })).json.product?.id)
    // Existencia real por lotes (PEPS), como una tienda surtida.
    await call('POST', '/purchases', T, { payment: 'contado', items: prods.filter(Boolean).map((productId) => ({ productId, quantity: 100000, cost: 50000000 })) })
    await call('POST', '/shifts/open', T, { openingFloat: 0 })
    biz.push({ T, prods: prods.filter(Boolean), sold: 0 })
  }
  console.log(`preparados ${biz.length} negocios × ${biz[0].prods.length} productos`)
  const lat = { venta: [], catalogo: [], panel: [], turno: [] }, errors = {}
  let done = 0
  const t0 = performance.now()
  const worker = async () => {
    while (done < TOTAL) {
      const n = done++
      const b = biz[n % biz.length], x = Math.random()
      const [kind, req] = x < 0.5 ? ['venta', () => call('POST', '/sales', b.T, { id: crypto.randomUUID(), paymentMethod: 'efectivo', items: [{ productId: b.prods[n % b.prods.length], quantity: 1 }, { productId: b.prods[(n * 7) % b.prods.length], quantity: 2 }] })]
        : x < 0.75 ? ['catalogo', () => call('GET', '/products', b.T)] : x < 0.9 ? ['panel', () => call('GET', '/dashboard/panel', b.T)] : ['turno', () => call('GET', '/shifts/current', b.T)]
      try {
        const r = await req()
        lat[kind].push(r.ms)
        if (r.status >= 400) errors[`${kind} ${r.status} ${r.json?.error?.code ?? ''}`] = (errors[`${kind} ${r.status} ${r.json?.error?.code ?? ''}`] ?? 0) + 1
        else if (kind === 'venta') b.sold++
      } catch (e) { errors[`${kind} red: ${e.message}`] = (errors[`${kind} red: ${e.message}`] ?? 0) + 1 }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker))
  const secs = (performance.now() - t0) / 1000
  const all = Object.values(lat).flat()
  console.log(`\n${TOTAL} peticiones · ${CONC} simultáneas · ${NEG} negocios · ${secs.toFixed(1)} s → ${(TOTAL / secs).toFixed(0)} pet/s`)
  for (const [k, a] of Object.entries(lat)) if (a.length) console.log(`${k.padEnd(9)} n=${String(a.length).padStart(5)}  p50 ${pct(a, 0.5).toFixed(0).padStart(5)} ms  p95 ${pct(a, 0.95).toFixed(0).padStart(5)} ms  p99 ${pct(a, 0.99).toFixed(0).padStart(5)} ms  máx ${Math.max(...a).toFixed(0).padStart(5)} ms`)
  console.log(`total     p50 ${pct(all, 0.5).toFixed(0)} ms · p95 ${pct(all, 0.95).toFixed(0)} ms · errores: ${JSON.stringify(errors)}`)
  // Cuadre: cada venta aceptada está en la base, ninguna de más.
  let okAll = true
  for (const b of biz) {
    const count = (await call('GET', '/reports/summary', b.T)).json.sales?.tickets
    if (count !== b.sold) { okAll = false; console.log(`✗ negocio: ${b.sold} ventas aceptadas, ${count} en la base`) }
  }
  console.log(okAll ? '✓ cuadre: todas las ventas aceptadas están en la base, sin duplicados' : '✗ cuadre con diferencias')
})().catch((e) => { console.error(e); process.exit(1) })
