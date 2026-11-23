const { chromium } = require('playwright');
const B = process.env.B || 'http://localhost:3135';
const SIZE = process.env.SIZE || 'pc';
const VP = SIZE === 'cel' ? { width: 390, height: 844, isMobile: true, hasTouch: true } : { width: 1366, height: 860 };
let fails = 0, n = Number(process.env.N || 0);
const late = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'America/Mexico_City' }).format(new Date())) >= 20;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(Date.now() + (late ? 86400000 : 0)));

async function setupOwner(giro) {
  n++;
  const phone = '557' + String(Date.now()).slice(-5) + String(n).padStart(2, '0');
  const call = async (m, p, body, t) => (await fetch(B + '/api' + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
  const r = await call('POST', '/auth/register', { businessName: 'Prueba ' + giro, ownerName: 'Ana Ruiz', phone, password: 'secreto123', giro });
  await call('PATCH', '/business', { forcePasswordChange: false }, r.token);
  const me = await call('GET', '/auth/me', undefined, r.token);
  await call('PUT', `/users/${me.user.id}/auth-code`, { code: '4321' }, r.token);
  return { token: r.token, call: (m, p, body) => call(m, p, body, r.token) };
}

async function page(b, token) {
  const ctx = await b.newContext({ viewport: { width: VP.width, height: VP.height }, isMobile: !!VP.isMobile, hasTouch: !!VP.hasTouch });
  await ctx.addInitScript((t) => { sessionStorage.setItem('nx_intro', '1'); localStorage.setItem('nx_token', t) }, token);
  const p = await ctx.newPage();
  // Contra un servidor remoto (staging) las esperas fijas se alargan: SLOW=3 las triplica.
  const wt = p.waitForTimeout.bind(p); p.waitForTimeout = (ms) => wt(ms * Number(process.env.SLOW || 1));
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push('JS ' + e.message));
  p.on('response', (x) => { if (x.url().includes('/api/') && x.status() >= 500) p.errs.push(x.status() + ' ' + x.url()) });
  p.answers = [];
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (p.answers.shift() ?? '4321') : undefined));
  // Un solo ciclo a la vez: si dos ciclos contestan la misma ventana, el segundo escribe otra respuesta.
  let busy = false
  p.pump = setInterval(async () => {
    if (busy) return; busy = true
    try {
      const dlg = p.locator('.dialog-wrap'); if (!(await dlg.count())) return
      if (await dlg.locator('.dialog-choices').count()) { const want = p.answers.shift() ?? 'efectivo'; const c = dlg.locator('.dialog-choices button', { hasText: new RegExp('^' + want + '$', 'i') }); await ((await c.count()) ? c : dlg.locator('.dialog-choices button').first()).click(); return }
      if (await dlg.locator('input').count()) await dlg.locator('input').fill(p.answers.shift() ?? '4321')
      await dlg.locator('.dialog-actions button.primary, .dialog-actions button.danger').click()
    } catch {} finally { busy = false }
  }, 250); p.pump.unref();
  p.tap = (loc) => (VP.hasTouch ? loc.tap() : loc.click());
  p.go = async (h) => { await p.goto(B + '/#/' + h); await p.reload(); await p.waitForTimeout(900) };
  p.ctx = ctx;
  return p;
}
const ok = (g, c, m) => { console.log(`${c ? '✓' : '✗'} [${SIZE}] ${g}: ${m}`); if (!c) fails++ };
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function newProduct(p, f) {
  await p.go('productos');
  await p.tap(p.getByRole('button', { name: '+ Nuevo producto' }));
  await p.getByLabel('Nombre', { exact: true }).fill(f.name);
  if (f.brand) { await p.getByLabel('Marca').fill(f.brand); await p.getByLabel('Fragancia').fill(f.fragrance); await p.getByLabel('Mililitros').fill(String(f.ml)); await p.getByLabel('Presentación').selectOption(f.presentation) }
  await p.getByLabel('Precio de venta').fill(String(f.price));
  if (f.unit) await p.getByLabel('Se vende por').selectOption(f.unit);
  if (f.dish) await p.getByLabel(/platillo o bebida preparada/).check();
  if (f.stock) { await p.getByLabel('Existencia inicial (opcional)').fill(String(f.stock)); if (f.cost) await p.getByLabel(/^Costo por (pieza|kg|litro|metro)/).fill(String(f.cost)) }
  await p.tap(p.getByRole('button', { name: 'Agregar producto' }));
  await p.waitForTimeout(800);
}
async function openCaja(p, meal) {
  await p.go('caja');
  if (await p.getByRole('heading', { name: 'Abrir caja' }).count()) {
    if (meal) await p.tap(p.locator('.tabs button', { hasText: meal }));
    await p.tap(p.getByRole('button', { name: '$1,000' })); await p.tap(p.getByRole('button', { name: 'Abrir caja' })); await p.waitForTimeout(800);
  }
}
async function cobrarEfectivo(p) {
  await p.tap(p.getByRole('button', { name: /^Cobrar/ }).first());
  await p.tap(p.locator('.modal').getByRole('button', { name: /^Cobrar/ }));
  await p.getByRole('heading', { name: 'Venta cobrada' }).waitFor({ timeout: 8000 });
  const t = await p.locator('.modal pre').innerText();
  await p.tap(p.getByRole('button', { name: 'Nueva venta' }));
  return t;
}

async function unas(b) {
  const g = 'uñas';
  const o = await setupOwner('unas');
  const staff = (await o.call('POST', '/users', { name: 'Lupita', username: 'lupita' + n + Date.now() % 100000, password: 'inicial123', template: 'barbero' })).user;
  const p = await page(b, o.token);
  // Servicio con secado y consumibles
  await newProduct(p, { name: 'Gel UV', price: 1, stock: 10, cost: 50 });
  await p.go('configurar');
  await p.getByLabel('Nombre').fill('Manicure gel'); await p.getByLabel('Precio').fill('300'); await p.getByLabel('Duración (min)').fill('60');
  await p.getByLabel(/Tiempo de secado/).fill('15'); await p.getByLabel('Técnica').fill('Gel');
  await p.tap(p.getByRole('button', { name: 'Agregar' })); await p.getByText('Servicio agregado.').waitFor({ timeout: 8000 });
  await p.tap(p.locator('tr', { hasText: 'Manicure gel' }));
  await p.locator('.danger-zone input[placeholder="Buscar insumo…"]').fill('gel uv'); await p.tap(p.locator('.danger-zone .results button', { hasText: 'Gel UV' }));
  await p.getByLabel('Cantidad de Gel UV').fill('0.1'); await p.tap(p.getByRole('button', { name: 'Guardar receta' })); await p.getByText('Receta guardada.').waitFor({ timeout: 8000 });
  ok(g, true, 'servicio con duración, secado y consumibles por técnica');
  await p.tap(p.locator('.subtabs button', { hasText: 'Comisiones' }));
  await p.tap(p.getByRole('button', { name: '+ Agregar regla' }));
  await p.locator('tbody tr').first().locator('input').fill('40');
  await p.tap(p.getByRole('button', { name: 'Guardar comisiones' })); await p.getByText('Comisiones guardadas.').waitFor({ timeout: 8000 });
  ok(g, true, 'comisión del 40% por técnica');
  // Horario de agenda
  await p.go('usuarios');
  await p.tap(p.locator('.team-row', { hasText: 'Lupita' }));
  await p.tap(p.locator('.modal .subtabs button', { hasText: 'Horario de agenda' }));
  await p.getByLabel(/Atiende citas/).check();
  const wd = new Date(today + 'T12:00:00-06:00').getUTCDay();
  const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  await p.locator('.modal .row.day', { hasText: DAYS[wd] }).locator('input[type=checkbox]').check();
  await p.locator('.modal').getByLabel(`Entrada ${DAYS[wd]}`).selectOption('00:00');
  await p.locator('.modal').getByLabel(`Salida ${DAYS[wd]}`).selectOption('23:30');
  await p.tap(p.getByRole('button', { name: 'Guardar horario' })); await p.getByText('Horario guardado.').waitFor({ timeout: 8000 });
  ok(g, true, 'horario de agenda de la técnica');
  await p.tap(p.locator('.modal .card-head button', { hasText: 'Cerrar' }));
  // Clienta con dirección y notas
  await p.go('clientes');
  await p.tap(p.getByRole('button', { name: '+ Nuevo cliente' }));
  await p.locator('.modal').getByLabel('Nombre').fill('Sofía Pérez'); await p.tap(p.getByRole('button', { name: 'Agregar cliente' })); await p.waitForTimeout(700);
  await p.tap(p.locator('.subtabs button', { hasText: 'Datos' }));
  await p.getByLabel(/Dirección/).fill('Calle Hidalgo 12'); await p.getByLabel(/Todos sus servicios son a domicilio/).check();
  await p.getByLabel(/Notas/).fill('Prefiere tonos nude');
  await p.tap(p.getByRole('button', { name: 'Guardar datos' })); await p.getByText('Datos guardados.').waitFor({ timeout: 8000 });
  ok(g, true, 'clienta con dirección, todo a domicilio y notas');
  // Cita a domicilio
  await openCaja(p);
  await p.go('agenda');
  if (late) { await p.locator('.day-label input').fill(today); await p.waitForTimeout(600) }
  await p.tap(p.getByRole('button', { name: '+ Nueva cita' }));
  await p.tap(p.locator('.modal .results button', { hasText: 'Manicure gel' }));
  await p.locator('.modal').getByLabel('A domicilio').check();
  await p.locator('.modal').getByLabel(/Dirección/).fill('Calle Hidalgo 12');
  await p.waitForTimeout(800);
  const slot = p.locator('.modal button', { hasText: /^\d{1,2}:\d{2} [ap]\.m\.$/ });
  await slot.first().waitFor({ timeout: 10000 }).catch(() => {});
  ok(g, await slot.count() > 0, 'la agenda muestra horas libres (con secado y traslado)');
  await p.tap(slot.last());
  await p.locator('.modal').getByLabel('Nombre del cliente').fill('Sofía Pérez');
  await p.tap(p.locator('.modal').getByRole('button', { name: 'Guardar' }));
  await p.getByText('Cita guardada.').waitFor({ timeout: 8000 });
  ok(g, await p.getByText('a domicilio').first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false), 'cita a domicilio guardada');
  await p.tap(p.getByRole('button', { name: 'Cobrar' }).first());
  await p.locator('.modal').getByLabel(/Propina/).fill('50');
  await p.tap(p.locator('.modal').getByRole('button', { name: 'Cobrar' }));
  await p.waitForTimeout(1200);
  await p.go('comisiones');
  ok(g, await p.getByText('$120.00').count() >= 1 && await p.getByText('$50.00').count() >= 1, 'comisión $120 (40% de $300) y propina $50 aparte');
  const g1 = (await o.call('GET', '/products')).products.find((x) => x.name === 'Gel UV');
  ok(g, Math.abs(g1.stock - 9.9) < 0.001, `el servicio descontó 0.1 de Gel UV (queda ${g1.stock})`);
  if ((await overflow(p)) > 1) { await p.screenshot({ path: require('os').tmpdir() + '/nexora-' + g + '.png', fullPage: true }); console.log('overflow', await overflow(p), await p.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)).join(' ; '))) }
  ok(g, (await overflow(p)) <= 1 && p.errs.length === 0, 'sin errores ni desbordes ' + JSON.stringify(p.errs));
  await p.ctx.close();
}

async function perfumeria(b) {
  const g = 'perfumería';
  const o = await setupOwner('perfumeria');
  const p = await page(b, o.token);
  await newProduct(p, { name: 'Sauvage 100 ml', brand: 'Dior', fragrance: 'Sauvage', ml: 100, presentation: 'regular', price: 2500, stock: 3, cost: 1500 });
  await newProduct(p, { name: 'Sauvage decant 5 ml', brand: 'Dior', fragrance: 'Sauvage', ml: 5, presentation: 'decant', price: 200 });
  await newProduct(p, { name: 'Sauvage tester', brand: 'Dior', fragrance: 'Sauvage', ml: 100, presentation: 'tester', price: 0, stock: 1, cost: 1200 });
  await newProduct(p, { name: 'Caja de regalo', price: 0, stock: 10, cost: 20 });
  await newProduct(p, { name: 'Set regalo Sauvage', brand: 'Dior', fragrance: 'Sauvage', ml: 100, presentation: 'set', price: 2800 });
  ok(g, await p.locator('tr', { hasText: 'Sauvage 100 ml' }).count() === 1, 'variantes con marca, fragancia, ml y presentación');
  // Decants
  await p.tap(p.locator('tr', { hasText: 'Sauvage 100 ml' }));
  await p.tap(p.locator('.modal .subtabs button', { hasText: 'Decants' }));
  await p.locator('.modal').getByLabel('Cuántos').fill('4');
  await p.tap(p.getByRole('button', { name: 'Fraccionar' })); await p.waitForTimeout(900);
  await p.go('productos');
  ok(g, (await p.locator('tr', { hasText: 'Sauvage decant 5 ml' }).locator('.pill').innerText()) === '4', 'fraccionar el frasco en 4 decants de 5 ml');
  // Tester
  await p.tap(p.locator('tr', { hasText: 'Sauvage tester' }).getByRole('button', { name: '+ Agregar' }));
  await p.tap(p.locator('.modal .tabs button', { hasText: 'Usar (tester o muestra)' }));
  await p.locator('.modal').getByLabel('Cantidad').fill('1');
  await p.tap(p.getByRole('button', { name: 'Registrar uso' })); await p.getByText('Uso registrado.').waitFor({ timeout: 8000 });
  ok(g, true, 'uso de tester registrado (no se vende)');
  await p.tap(p.locator('.modal .card-head button', { hasText: 'Cerrar' }));
  // Set
  await p.tap(p.locator('tr', { hasText: 'Set regalo Sauvage' }));
  await p.tap(p.locator('.modal .subtabs button', { hasText: 'Set o paquete' }));
  for (const name of ['Sauvage 100 ml', 'Caja de regalo']) { await p.locator('.modal').getByLabel('Agregar pieza').fill(name.split(' ')[0]); await p.tap(p.locator('.modal .results button', { hasText: name })) }
  await p.tap(p.getByRole('button', { name: 'Guardar set' })); await p.getByText('Set guardado.').waitFor({ timeout: 8000 });
  ok(g, true, 'set con un solo precio (perfume + empaque)');
  await p.tap(p.locator('.modal .card-head button', { hasText: 'Cerrar' }));
  // Venta con asesora y comisión por marca
  await openCaja(p);
  ok(g, await p.getByRole('button', { name: /Sauvage tester/ }).count() === 0, 'el tester no aparece en la caja');
  await p.getByTestId('buscar').fill('set regalo'); await p.getByTestId('buscar').press('Enter');
  await p.getByTestId('buscar').fill('sauvage 100'); await p.getByTestId('buscar').press('Enter');
  const t = await cobrarEfectivo(p);
  ok(g, t.includes('$5,300.00'), 'venta de set + frasco: $5,300');
  const prods = (await o.call('GET', '/products')).products;
  ok(g, prods.find((x) => x.name === 'Sauvage 100 ml').stock === 0 && prods.find((x) => x.name === 'Caja de regalo').stock === 9, 'el set descontó su frasco y su caja de regalo');
  // Devolución: solo sellado
  await p.go('devoluciones');
  await p.getByLabel('Folio del ticket').fill('1'); await p.tap(p.getByRole('button', { name: 'Buscar' }));
  await p.getByLabel('Devolver de Sauvage 100 ml').fill('1');
  await p.getByLabel('Motivo').fill('no le gustó'); await p.getByLabel('Código de autorización').fill('4321');
  await p.tap(p.getByRole('button', { name: 'Registrar devolución' })); await p.waitForTimeout(800);
  ok(g, await p.getByText(/sellados/).count() >= 1, 'sin marcar "sellado" no se devuelve');
  await p.locator('label', { hasText: 'Sellado' }).last().locator('input').check();
  await p.tap(p.getByRole('button', { name: 'Registrar devolución' })); await p.getByText(/Devolución registrada/).waitFor({ timeout: 8000 });
  ok(g, true, 'producto sellado sí se devuelve con ticket y código');
  if ((await overflow(p)) > 1) { await p.screenshot({ path: require('os').tmpdir() + '/nexora-' + g + '.png', fullPage: true }); console.log('overflow', await overflow(p), await p.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)).join(' ; '))) }
  ok(g, (await overflow(p)) <= 1 && p.errs.length === 0, 'sin errores ni desbordes ' + JSON.stringify(p.errs));
  await p.ctx.close();
}

async function palapa(b) {
  const g = 'palapa';
  const o = await setupOwner('palapa');
  const p = await page(b, o.token);
  await p.go('configurar');
  await p.getByLabel('Número o nombre').fill('1'); await p.getByLabel('Área').selectOption('terraza'); await p.getByLabel(/Consumo mínimo/).fill('200');
  await p.tap(p.getByRole('button', { name: 'Agregar mesa' })); await p.waitForTimeout(600);
  await p.tap(p.locator('.subtabs button', { hasText: 'Rentas' }));
  await p.getByLabel('Nombre').fill('Camastro'); await p.getByLabel('Cuántos tienes').fill('10'); await p.getByLabel('Precio de renta').fill('50');
  await p.tap(p.getByRole('button', { name: 'Agregar' })); await p.waitForTimeout(600);
  ok(g, await p.locator('tr', { hasText: 'Camastro' }).count() === 1, 'mesa con consumo mínimo y activos para rentar');
  await newProduct(p, { name: 'Pescado frito', price: 300, unit: 'kg', dish: true });
  await newProduct(p, { name: 'Michelada', price: 90, dish: true });
  await p.go('precios');
  await p.getByLabel('Precio de hoy Pescado frito').fill('320');
  await p.tap(p.getByRole('button', { name: 'Guardar precios' })); await p.getByText(/Precios actualizados/).waitFor({ timeout: 8000 });
  ok(g, true, 'precio por kilo del día con código');
  await openCaja(p);
  await p.go('mesas');
  await p.tap(p.getByRole('button', { name: 'Reservas de mesa' }));
  await p.locator('.modal').getByLabel('Nombre').fill('Familia López'); await p.locator('.modal').getByLabel('Personas').fill('6');
  await p.tap(p.getByRole('button', { name: 'Guardar reserva' })); await p.waitForTimeout(700);
  await p.tap(p.locator('.modal').getByRole('button', { name: 'Confirmar' })); await p.locator('.modal').getByText('Reserva confirmada.').waitFor({ timeout: 8000 });
  ok(g, true, 'reserva de mesa guardada y confirmada');
  await p.tap(p.locator('.modal .card-head button', { hasText: 'Cerrar' }));
  p.answers.push('2');
  await p.tap(p.getByRole('button', { name: /Mesa 1/ }));
  await p.waitForTimeout(800);
  p.answers.push('1.5');
  await p.tap(p.locator('.results button', { hasText: 'Pescado frito' }));
  await p.waitForTimeout(500);
  await p.tap(p.locator('.results button', { hasText: 'Michelada' }));
  await p.waitForTimeout(500);
  await p.tap(p.getByRole('button', { name: /Rentar sillas, camastros/ }));
  await p.locator('.modal').getByLabel('Cuántos Camastro').fill('2');
  await p.tap(p.locator('.modal').getByRole('button', { name: 'Rentar' })); await p.getByText('Renta agregada a la cuenta.').waitFor({ timeout: 8000 });
  ok(g, (await p.locator('.cart .total').innerText()) === '$670.00', 'cuenta: 1.5 kg pescado a $320 + michelada + 2 camastros = $670');
  await p.tap(p.getByRole('button', { name: 'Mandar a cocina' })); await p.waitForTimeout(600);
  await p.tap(p.getByRole('button', { name: 'Cobrar todo' }));
  await p.tap(p.locator('.modal').getByRole('button', { name: /Cobrar/ }).last()); await p.waitForTimeout(1200);
  await p.go('mesas');
  await p.tap(p.getByRole('button', { name: 'Rentas fuera' }));
  await p.waitForTimeout(600);
  ok(g, await p.locator('.modal').getByText('Todo lo rentado ya regresó.').count() === 1, 'cobro de la mesa y regreso de los camastros');
  if ((await overflow(p)) > 1) { await p.screenshot({ path: require('os').tmpdir() + '/nexora-' + g + '.png', fullPage: true }); console.log('overflow', await overflow(p), await p.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)).join(' ; '))) }
  ok(g, (await overflow(p)) <= 1 && p.errs.length === 0, 'sin errores ni desbordes ' + JSON.stringify(p.errs));
  await p.ctx.close();
}

async function comedor(b) {
  const g = 'comedor';
  const o = await setupOwner('comedor');
  const p = await page(b, o.token);
  await newProduct(p, { name: 'Comida corrida', price: 85, dish: true });
  await newProduct(p, { name: 'Agua de jamaica', price: 20, dish: true });
  await p.go('menu');
  await p.tap(p.locator('.tabs button', { hasText: 'Comida' }));
  await p.tap(p.locator('.results button', { hasText: 'Comida corrida' }));
  await p.tap(p.locator('.results button', { hasText: 'Agua de jamaica' }));
  await p.tap(p.getByRole('button', { name: 'Publicar' })); await p.getByText('Menú publicado.').waitFor({ timeout: 8000 });
  ok(g, true, 'menú del día publicado con código');
  await openCaja(p, 'Comida');
  ok(g, await p.locator('.quick-grid button', { hasText: 'Comida corrida' }).count() === 1, 'venta rápida con botones grandes');
  await p.tap(p.locator('.quick-grid button', { hasText: 'Comida corrida' }));
  await p.tap(p.locator('.quick-grid button', { hasText: 'Agua de jamaica' }));
  const t = await cobrarEfectivo(p);
  ok(g, t.includes('$105.00'), 'cobro rápido $105');
  // Crédito para oficina
  const cu = (await o.call('POST', '/customers', { name: 'Taller Gómez' })).customer;
  await o.call('PUT', `/customers/${cu.id}/credit-limit`, { limit: 100000 });
  await p.go('caja'); await p.go('inicio'); await p.go('caja');
  await p.tap(p.locator('.quick-grid button', { hasText: 'Comida corrida' }));
  await p.tap(p.getByRole('button', { name: /^Cobrar/ }).first());
  await p.tap(p.locator('.modal').getByRole('button', { name: 'Fiado' }));
  await p.tap(p.locator('.modal .results button', { hasText: 'Taller Gómez' }));
  await p.tap(p.locator('.modal').getByRole('button', { name: 'Fiar' }));
  await p.getByRole('heading', { name: 'Venta cobrada' }).waitFor({ timeout: 8000 });
  await p.tap(p.getByRole('button', { name: 'Nueva venta' }));
  const rec = (await o.call('GET', '/receivables')).total;
  ok(g, rec === 8500, 'cuenta a crédito del taller: debe $85');
  await p.go('menu');
  await p.tap(p.locator('tr', { hasText: 'Comida corrida' }).getByRole('button', { name: 'Se acabó' })); await p.waitForTimeout(600);
  await p.go('caja'); await p.go('inicio'); await p.go('caja');
  ok(g, await p.locator('.quick-grid button', { hasText: 'Comida corrida' }).count() === 0, 'lo agotado ya no aparece para vender');
  if ((await overflow(p)) > 1) { await p.screenshot({ path: require('os').tmpdir() + '/nexora-' + g + '.png', fullPage: true }); console.log('overflow', await overflow(p), await p.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)).join(' ; '))) }
  ok(g, (await overflow(p)) <= 1 && p.errs.length === 0, 'sin errores ni desbordes ' + JSON.stringify(p.errs));
  await p.ctx.close();
}

async function taqueria(b) {
  const g = 'taquería';
  const o = await setupOwner('taqueria');
  const p = await page(b, o.token);
  await newProduct(p, { name: 'Carne al pastor', price: 250, unit: 'kg', stock: 10, cost: 120 });
  await newProduct(p, { name: 'Taco al pastor', price: 18, dish: true });
  await p.tap(p.locator('tr', { hasText: 'Taco al pastor' }));
  await p.tap(p.locator('.modal .subtabs button', { hasText: 'Receta' }));
  await p.locator('.modal').getByLabel('Agregar insumo').fill('carne'); await p.tap(p.locator('.modal .results button', { hasText: 'Carne al pastor' }));
  await p.locator('.modal').getByLabel('Cantidad de Carne al pastor').fill('0.03');
  await p.tap(p.getByRole('button', { name: 'Guardar receta' })); await p.getByText('Receta guardada.').waitFor({ timeout: 8000 });
  ok(g, true, 'receta del taco: 30 g de carne');
  await p.tap(p.locator('.modal .card-head button', { hasText: 'Cerrar' }));
  await p.go('menu');
  await p.tap(p.locator('.results button', { hasText: 'Taco al pastor' }));
  await p.tap(p.getByRole('button', { name: 'Publicar' })); await p.getByText('Menú publicado.').waitFor({ timeout: 8000 });
  ok(g, await p.locator('h2', { hasText: 'guisados del día' }).count() === 1, 'guisados del día publicados ' + (await p.locator('h2').allInnerTexts()).join('|'));
  await openCaja(p);
  await p.go('carne');
  await p.getByLabel('Kilos que se ponen').fill('5');
  await p.tap(p.getByRole('button', { name: 'Registrar' })); await p.waitForTimeout(700);
  await openCaja(p);
  await p.getByTestId('buscar').fill('10*taco'); await p.getByTestId('buscar').press('Enter');
  const t = await cobrarEfectivo(p);
  ok(g, t.includes('$180.00'), '10 tacos: $180');
  await p.go('carne');
  ok(g, await p.getByText('0.3 kg').count() >= 1, 'el trompo registra 0.3 kg vendidos por receta');
  await p.screenshot({ path: require('os').tmpdir() + '/nexora-carne.png', fullPage: true });
  p.answers.push('4.7');
  await p.tap(p.getByRole('button', { name: 'Contar sobrante' })); await p.getByText(/Cerrado. Diferencia: 0 kg/).waitFor({ timeout: 8000 });
  ok(g, true, 'sobrante contado con código: 4.7 kg, sin diferencia');
  await p.go('caja');
  await p.tap(p.getByRole('button', { name: 'Corte de caja' })); await p.tap(p.getByRole('button', { name: /Corte Z/ }));
  await p.getByLabel('¿Cuánto dinero hay en la caja?').fill('1180');
  await p.tap(p.getByRole('button', { name: 'Verificar con el sistema' })); await p.getByText('La caja cuadra').waitFor({ timeout: 8000 });
  await p.tap(p.getByRole('button', { name: 'Cerrar caja' })); await p.getByRole('heading', { name: /Corte Z/ }).waitFor({ timeout: 8000 });
  ok(g, true, 'cierre del turno con la carne contada');
  if ((await overflow(p)) > 1) { await p.screenshot({ path: require('os').tmpdir() + '/nexora-' + g + '.png', fullPage: true }); console.log('overflow', await overflow(p), await p.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)).join(' ; '))) }
  ok(g, (await overflow(p)) <= 1 && p.errs.length === 0, 'sin errores ni desbordes ' + JSON.stringify(p.errs));
  await p.ctx.close();
}

async function verduleria(b) {
  const g = 'verdulería';
  const o = await setupOwner('verduleria');
  const p = await page(b, o.token);
  await newProduct(p, { name: 'Jitomate', price: 25, unit: 'kg', stock: 20, cost: 15 });
  await newProduct(p, { name: 'Cilantro', price: 8, stock: 30, cost: 4 });
  await p.tap(p.locator('tr', { hasText: 'Cilantro' }));
  await p.tap(p.locator('.modal .subtabs button', { hasText: 'Presentaciones' }));
  await p.locator('.modal').getByLabel('Nombre').fill('Manojo grande'); await p.locator('.modal').getByLabel('Equivale a').fill('3'); await p.locator('.modal').getByLabel('Precio').fill('20');
  await p.tap(p.getByRole('button', { name: 'Agregar presentación' })); await p.getByText('Presentación agregada.').waitFor({ timeout: 8000 });
  ok(g, true, 'presentación "manojo grande" = 3 piezas');
  await p.tap(p.locator('.modal .card-head button', { hasText: 'Cerrar' }));
  await p.go('precios');
  await p.getByLabel('Precio de hoy Jitomate').fill('28');
  await p.tap(p.getByRole('button', { name: 'Guardar precios' })); await p.getByText(/Precios actualizados/).waitFor({ timeout: 8000 });
  ok(g, true, 'precio del día con código');
  await openCaja(p);
  await p.tap(p.locator('.quick-grid button', { hasText: 'Jitomate' }));
  await p.tap(p.getByRole('button', { name: 'Por importe ($)' }));
  await p.getByLabel('Importe en pesos').fill('56'); await p.tap(p.getByRole('button', { name: 'Agregar' }));
  await p.getByTestId('buscar').fill('manojo'); await p.getByTestId('buscar').press('Enter');
  const t = await cobrarEfectivo(p);
  ok(g, t.includes('$76.00'), '$56 de jitomate a $28/kg + manojo $20 = $76');
  await p.go('cierre');
  await p.getByLabel('Merma Jitomate').fill('1'); await p.getByLabel('Motivo Jitomate').fill('aplastado');
  await p.tap(p.getByRole('button', { name: 'Registrar merma' })); await p.getByText(/Merma registrada/).waitFor({ timeout: 8000 });
  await p.getByLabel('Contado Jitomate').fill('17');
  await p.getByLabel('Contado Cilantro').fill('27');
  await p.tap(p.getByRole('button', { name: 'Guardar conteo' })); await p.waitForTimeout(900);
  const diffs = await p.locator('td.num').allInnerTexts();
  ok(g, diffs.length >= 2 && diffs.every((x) => ['0', '$0.00'].includes(x.trim())), `merma con código y conteo rápido cuadran (${diffs.join(', ')})`);
  if ((await overflow(p)) > 1) { await p.screenshot({ path: require('os').tmpdir() + '/nexora-' + g + '.png', fullPage: true }); console.log('overflow', await overflow(p), await p.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((e) => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)).join(' ; '))) }
  ok(g, (await overflow(p)) <= 1 && p.errs.length === 0, 'sin errores ni desbordes ' + JSON.stringify(p.errs));
  await p.ctx.close();
}

(async () => {
  const b = await chromium.launch(process.env.HTTPS_PROXY && /^https:/.test(B) ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  for (const [name, fn] of Object.entries({ unas, perfumeria, palapa, comedor, taqueria, verduleria })) {
    if (only && !only.includes(name)) continue;
    try { await fn(b) } catch (e) { fails++; console.log(`✗ [${SIZE}] ${name}: ${e.message.split('\n').slice(0,3).join(' | ')}`) }
  }
  console.log(fails ? `FALLAS: ${fails}` : 'TODO OK');
  await b.close();
})();
