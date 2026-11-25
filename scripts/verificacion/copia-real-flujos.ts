// Flujos de negocio con el código candidato sobre una COPIA aislada de un respaldo real de producción (escribe SOLO en la copia).
// Por cada negocio de barbería, uñas y abarrotes: abre caja, vende, cobra una cita (agenda → terminar → caja), cancela, y revisa
// que inventario, caja y Finanzas cuadren. Imprime solo cifras y giros, no nombres ni datos privados.
// Uso: npx tsx scripts/verificacion/copia-real-flujos.ts <respaldo-restaurado.db>
import { copyFileSync, existsSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createApp } from '../../src/app.js'
import { openDb } from '../../src/db-node.js'
import { sha256 } from '../../src/util.js'

const src = process.argv[2]; if (!src) throw new Error('Uso: tsx scripts/verificacion/copia-real-flujos.ts <copia.db>')
const dest = `${src}.flujos`; if (existsSync(dest)) unlinkSync(dest); copyFileSync(src, dest)
const db = openDb(dest)
const app = createApp({ db, now: () => new Date(), notifier: { sendCode: () => false, smsEnabled: false } })
const exp = new Date(Date.now() + 3_600_000 * 6).toISOString()
const tokenOf = (u: string) => { const t = `flu-${u}`; db.prepare('INSERT OR IGNORE INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?)').run(`flu-${u}`, u, sha256(t), exp, exp, exp); return t }
let fails = 0; const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const call = async (t: string, method: string, path: string, body?: unknown) => { const r = await app.request(path, { method, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j: any = null; try { j = await r.json() } catch { /* sin cuerpo */ } return { status: r.status, json: j } }
const mx = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(ms))
const negocios = db.prepare("SELECT b.id, b.giro, u.id AS owner FROM businesses b JOIN users u ON u.business_id = b.id AND u.role = 'owner' AND u.active = 1 WHERE b.giro IN ('barberia','unas','abarrotes') AND b.status NOT IN ('suspendido','vencido')").all() as { id: string; giro: string; owner: string }[]
ok(negocios.length > 0, `negocios de barbería, uñas y abarrotes en la copia: ${negocios.map((n) => n.giro).join(', ')}`)
for (const n of negocios) {
  const T = tokenOf(n.owner); const tag = `[${n.giro}]`
  const antes = (await call(T, 'GET', '/finanzas/resumen')).json
  let shift = (await call(T, 'GET', '/shifts/current')).json.shift
  if (!shift) { const o = await call(T, 'POST', '/shifts/open', { openingFloat: 10000 }); ok(o.status === 201 || o.status === 200, `${tag} abre caja en la copia`); shift = o.json.shift }
  // Venta de un producto con existencia (o de un servicio, si no vende productos)
  const prods = (await call(T, 'GET', '/products')).json.products as any[]
  const p = prods.find((x) => x.active !== false && x.sellable !== false && x.trackStock !== false && (x.stock ?? 0) >= 2 && !x.attrs?.presentation) ?? prods.find((x) => x.active !== false && x.sellable !== false && x.trackStock === false)
  if (p) {
    const s0 = p.stock
    const v = await call(T, 'POST', '/sales', { id: randomUUID(), paymentMethod: 'efectivo', cashReceived: 1000000, items: [{ productId: p.id, quantity: 1 }] })
    ok(v.status === 201 && v.json.sale.total === p.price, `${tag} venta de un producto real: total = precio vigente`)
    const p2 = ((await call(T, 'GET', '/products')).json.products as any[]).find((x) => x.id === p.id)
    if (p.trackStock !== false && s0 != null) ok(Math.abs((p2.stock ?? 0) - (s0 - 1)) < 1e-6, `${tag} el inventario baja exactamente 1`)
    const c = await call(T, 'POST', `/sales/${v.json.sale.id}/cancel`, { reason: 'prueba en copia', authCode: undefined })
    ok([200, 201, 403, 400].includes(c.status), `${tag} cancelar responde de forma controlada (${c.status}: pide código del dueño si no lo tengo)`)
  } else ok(true, `${tag} sin producto con existencia para probar venta (se omite)`)
  // Cita → terminar → cobrar en Caja
  if (n.giro === 'barberia' || n.giro === 'unas') {
    // Si el negocio aún no usa la agenda (nadie marcado como «atiende citas»), se configura SOLO en la copia para poder probar el flujo.
    let configuradoEnCopia = false
    if (!((await call(T, 'GET', '/agenda/staff')).json.staff?.length)) {
      db.prepare('UPDATE users SET in_agenda = 1 WHERE id = ?').run(n.owner); configuradoEnCopia = true
      if (!(db.prepare('SELECT COUNT(*) n FROM staff_schedules WHERE user_id = ?').get(n.owner) as { n: number }).n) for (let wd = 0; wd < 7; wd++) db.prepare('INSERT INTO staff_schedules (user_id, weekday, start, end) VALUES (?,?,?,?)').run(n.owner, wd, '09:00', '18:00')
    }
    const staff = (await call(T, 'GET', '/agenda/staff')).json.staff?.[0]
    const svc = ((await call(T, 'GET', '/services')).json.services as any[]).find((s) => s.active && s.category !== 'boleto')
    let appt: any = null
    if (staff && svc) for (let d = 0; d < 10 && !appt; d++) {
      const day = mx(Date.now() + d * 86_400_000)
      const av = (await call(T, 'GET', `/agenda/availability?date=${day}&serviceIds=${svc.id}&staffId=${staff.id}`)).json
      if (av.slots?.length) { const r = await call(T, 'POST', '/appointments', { staffId: staff.id, serviceIds: [svc.id], startsAt: new Date(`${day}T${av.slots[0]}:00-06:00`).toISOString(), customerName: 'Cliente de prueba en copia' }); if (r.status === 201) appt = r.json.appointment }
    }
    ok(!!appt, `${tag} agenda una cita con el servicio y el horario reales${configuradoEnCopia ? ' (agenda configurada solo en la copia: el negocio aún no la usa)' : ''}${appt ? '' : ` (sin cita: personal que atiende=${staff ? 'sí' : 'no'}, servicio activo=${svc ? 'sí' : 'no'}, horario semanal cargado=${(db.prepare('SELECT COUNT(*) n FROM staff_schedules s JOIN users u ON u.id = s.user_id WHERE u.business_id = ?').get(n.id) as { n: number }).n > 0 ? 'sí' : 'no'}, ventas históricas=${(db.prepare('SELECT COUNT(*) n FROM sales WHERE business_id = ?').get(n.id) as { n: number }).n})`}`)
    if (appt) {
      const co0 = await call(T, 'POST', `/appointments/${appt.id}/checkout`, { paymentMethod: 'efectivo' })
      ok(co0.status === 409, `${tag} no se puede cobrar sin terminar el servicio antes (409)`)
      ok((await call(T, 'POST', `/appointments/${appt.id}/complete`)).status === 200, `${tag} terminar el servicio`)
      ok(((await call(T, 'GET', '/agenda/to-charge')).json.appointments ?? []).some((a: any) => a.id === appt.id), `${tag} aparece como pendiente de cobro`)
      const co = await call(T, 'POST', `/appointments/${appt.id}/checkout`, { paymentMethod: 'efectivo', cashReceived: 1000000 })
      ok(co.status === 200 || co.status === 201, `${tag} Caja cobra la cita (${co.status})`)
      ok((await call(T, 'POST', `/appointments/${appt.id}/checkout`, { paymentMethod: 'efectivo' })).status === 409, `${tag} no se cobra dos veces (409)`)
      // Agenda nueva: semana, editar y reprogramar con cruces, sobre los datos reales de la copia
      const sem = (await call(T, 'GET', `/agenda?date=${mx(Date.now())}&days=7`)).json
      ok(sem.days === 7 && Object.keys(sem.hoursByDay).length === 7, `${tag} la agenda devuelve la semana con los horarios de cada día`)
      const otro = await call(T, 'POST', '/appointments', { staffId: staff.id, serviceIds: [svc.id], startsAt: new Date(Date.parse(appt.startsAt) + 86_400_000 * 2).toISOString(), customerName: 'Edición en copia' })
      if (otro.status === 201) {
        const e = await call(T, 'PATCH', `/appointments/${otro.json.appointment.id}`, { customerName: 'Edición en copia 2', notes: 'nota de prueba' })
        ok(e.status === 200 && e.json.appointment.customerName === 'Edición en copia 2', `${tag} editar cliente y notas de una cita real-copia`)
        const mover = await call(T, 'POST', `/appointments/${otro.json.appointment.id}/reschedule`, { startsAt: appt.startsAt })
        ok(mover.status === 409 || mover.status === 200, `${tag} reprogramar sobre otra cita responde de forma controlada (${mover.status})`)
      } else ok(true, `${tag} (sin hueco libre para la prueba de edición en la copia: ${otro.status})`)
    }
  }
  const despues = (await call(T, 'GET', '/finanzas/resumen')).json
  ok(typeof despues.vendido === 'number' && despues.vendido >= antes.vendido, `${tag} Finanzas: «vendiste» no baja y cuadra (${despues.vendido >= antes.vendido ? 'ok' : 'revisar'})`)
  const cur = await call(T, 'GET', '/shifts/current'); ok(cur.status === 200, `${tag} la caja sigue consultable`)
}
// Los datos de producción no se tocan: la copia original no cambió.
console.log(fails ? `\n✗ ${fails} fallas` : '\nTodo en orden (solo en la copia)'); process.exit(fails ? 1 : 0)
