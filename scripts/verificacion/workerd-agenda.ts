// Agenda nueva (rango de días, foto, editar, reprogramar) sobre el MOTOR REAL de Cloudflare (workerd + Durable Object SQLite) en local, con un negocio nuevo de prueba. No toca producción.
// Uso: `npx wrangler dev --port 8799 > /tmp/dev.log` y luego: npx tsx scripts/verificacion/workerd-agenda.ts http://localhost:8799 /tmp/dev.log
import { readFileSync } from 'node:fs'
const [base, logFile] = process.argv.slice(2)
if (!base || !logFile) throw new Error('Uso: tsx scripts/verificacion/workerd-agenda.ts <url> <log>')
let token = ''
const raw = async (method: string, path: string, body?: unknown, tok = token) => {
  const r = await fetch(`${base}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  let j: any = null; try { j = await r.json() } catch { /* sin cuerpo */ }
  return { status: r.status, json: j }
}
const call = async (method: string, path: string, body?: unknown) => { const r = await raw(method, path, body); if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.json)}`); return r.json }
let fails = 0; const ok = (c: unknown, m: string) => { console.log(`${c ? '✓' : '✗'} ${m}`); if (!c) fails++ }
const phone = `55${String(Date.now()).slice(-8)}`
const reg = await call('POST', '/auth/register', { businessName: 'Salon de prueba agenda', ownerName: 'Prueba', phone, password: 'secreto123' })
await new Promise((r) => setTimeout(r, 600))
if (reg.token) token = reg.token; else { const code = [...readFileSync(logFile, 'utf8').matchAll(new RegExp(`${phone}: (\\d{6})`, 'g'))].at(-1)?.[1]; token = (await call('POST', '/auth/register/verify', { challengeId: reg.challengeId, code })).token }
ok(((await (await fetch(`${base}/api/health`)).json()) as any).schema === 48, 'esquema 48 en el motor de Cloudflare (sin migraciones nuevas)')
const me = await call('GET', '/auth/me'); await call('PUT', `/users/${me.user.id}/auth-code`, { code: '4321' })
const sem = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '19:00' }))
await call('PUT', `/staff/${me.user.id}/agenda`, { inAgenda: true, schedule: sem })
const corte = (await call('POST', '/services', { name: 'Corte', price: 15000, durationMin: 30 })).service
const barba = (await call('POST', '/services', { name: 'Barba', price: 10000, durationMin: 20 })).service
const mx = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(ms))
const dia = mx(Date.now() + 2 * 86_400_000)
const iso = (hm: string, d = dia) => new Date(`${d}T${hm}:00-06:00`).toISOString()
const a = (await call('POST', '/appointments', { staffId: me.user.id, serviceIds: [corte.id], startsAt: iso('11:00'), customerName: 'Pedro' })).appointment
const b = (await call('POST', '/appointments', { staffId: me.user.id, serviceIds: [corte.id], startsAt: iso('11:40'), customerName: 'Luis' })).appointment
ok(!!a.id && !!b.id, 'crear citas')
ok((await raw('POST', '/appointments', { staffId: me.user.id, serviceIds: [corte.id], startsAt: iso('11:15'), customerName: 'Cruce' })).status === 409, 'no permite cruces de horario')
const w = await call('GET', `/agenda?date=${dia}&days=7`)
ok(w.days === 7 && Object.keys(w.hoursByDay).length === 7 && w.appointments.length === 2, 'la agenda devuelve la semana con horarios y citas')
const e = await raw('PATCH', `/appointments/${a.id}`, { notes: 'Prefiere tijera', serviceIds: [corte.id, barba.id] })
ok(e.status === 409, 'editar agregando un servicio que choca con la siguiente cita se rechaza')
const e2 = await raw('PATCH', `/appointments/${a.id}`, { customerName: 'Pedro Pérez', notes: 'Prefiere tijera' })
ok(e2.status === 200 && e2.json.appointment.customerName === 'Pedro Pérez', 'editar cliente y notas')
ok((await raw('POST', `/appointments/${b.id}/reschedule`, { startsAt: iso('11:10') })).status === 409, 'reprogramar sobre otra cita se rechaza')
const m = await raw('POST', `/appointments/${b.id}/reschedule`, { startsAt: iso('15:00') })
ok(m.status === 200 && m.json.appointment.startsAt === iso('15:00'), 'reprogramar a una hora libre')
ok((await raw('PUT', `/staff/${me.user.id}/photo`, { url: 'http://inseguro.com/f.jpg' })).status === 400, 'foto http rechazada')
ok((await raw('PUT', `/staff/${me.user.id}/photo`, { url: 'https://ejemplo.com/f.jpg' })).status === 200 && (await call('GET', '/agenda/staff')).staff[0].photoUrl === 'https://ejemplo.com/f.jpg', 'foto https guardada y devuelta')
ok((await raw('GET', `/agenda?date=${dia}`, undefined, '')).status === 401, 'sin sesión: 401')
console.log(fails ? `\n✗ ${fails} fallas` : '\nTodo en orden en el motor de Cloudflare'); process.exit(fails ? 1 : 0)
