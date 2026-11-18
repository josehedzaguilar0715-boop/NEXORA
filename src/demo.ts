import type { Hono } from 'hono'
import { createSession } from './auth.js'
import type { Deps, Env, UserRow } from './context.js'
import { businessCode, hashSecret, iso, localDate, newId } from './util.js'

/**
 * Negocios de demostración (uno por giro) con inventario, clientes, ventas y lo propio de cada giro, todo ficticio,
 * para conocer el sistema y capacitar. Se crean gratis y con accesos fáciles. Repetirlo no duplica nada.
 * Se cargan usando la misma API que usa la app, así todo cuadra (inventario, caja, reportes, bitácora).
 */

export const DEMO_PASSWORD = 'demo1234'
export const DEMO_CODE = '1234'
export const DEMOS: { giro: string; label: string; staff: string }[] = [
  { giro: 'abarrotes', label: 'Abarrotes', staff: 'cajero' },
  { giro: 'ferreteria', label: 'Ferretería', staff: 'cajero' },
  { giro: 'papeleria', label: 'Papelería', staff: 'cajero' },
  { giro: 'barberia', label: 'Barbería', staff: 'barbero' },
  { giro: 'unas', label: 'Estudio de uñas', staff: 'barbero' },
  { giro: 'perfumeria', label: 'Perfumería', staff: 'cajero' },
  { giro: 'banos', label: 'Baños públicos', staff: 'cajero' },
  { giro: 'turistico', label: 'Lugar turístico', staff: 'cajero' },
  { giro: 'palapa', label: 'Palapa', staff: 'cajero' },
  { giro: 'restaurante', label: 'Restaurante', staff: 'cajero' },
  { giro: 'comedor', label: 'Comedor', staff: 'cajero' },
  { giro: 'taqueria', label: 'Taquería', staff: 'cajero' },
  { giro: 'verduleria', label: 'Verdulería', staff: 'cajero' },
]
/** Nombres ficticios para los dueños de las demos. */
const OWNER_NAMES = ['Rosa Díaz', 'Jorge Méndez', 'Patricia Luna', 'Carlos Ramírez', 'Daniela Ortiz', 'Mónica Salas', 'Ernesto Vidal', 'Gabriela Ríos', 'Raúl Castillo', 'Lucía Fernández', 'Teresa Gómez', 'Arturo Navarro', 'Silvia Morales']
/** Teléfonos ficticios del dueño de cada demo: 5500000001 … 5500000013. */
export const demoPhone = (giro: string) => `55000000${String(DEMOS.findIndex((d) => d.giro === giro) + 1).padStart(2, '0')}`
export const demoStaffUser = (giro: string) => `demo.${giro}`

export function demoAccess(db: Deps['db']) {
  return DEMOS.map((d) => {
    const owner = db.prepare("SELECT u.business_id FROM users u WHERE u.role = 'owner' AND u.phone = ?").get(demoPhone(d.giro)) as { business_id: string } | undefined
    return { giro: d.giro, label: d.label, created: !!owner, businessId: owner?.business_id ?? null, phone: demoPhone(d.giro), password: DEMO_PASSWORD, staffUser: demoStaffUser(d.giro), staffPassword: DEMO_PASSWORD, code: DEMO_CODE }
  })
}

type Api = (method: string, path: string, body?: unknown) => Promise<any>

/** La app se registra al crearse, para que la carga de demos use la misma API. */
let appRef: Hono<Env> | null = null
export const setDemoApp = (a: Hono<Env>) => void (appRef = a)
export const demoApp = () => { if (!appRef) throw new Error('App no lista'); return appRef }

export async function seedDemo(app: Hono<Env>, deps: Deps, giro: string) {
  const demo = DEMOS.find((d) => d.giro === giro)
  if (!demo) throw new Error('Giro no válido')
  const { db, now } = deps
  const phone = demoPhone(giro)
  if (db.prepare("SELECT 1 FROM users WHERE role = 'owner' AND phone = ?").get(phone)) return { created: false }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(demoStaffUser(giro))) return { created: false }

  // Negocio, sucursal y dueño (como el alta asistida), gratis y sin cambio de contraseña obligatorio.
  const t = now()
  const bizId = newId(), branchId = newId(), ownerId = newId()
  db.transaction(() => {
    db.prepare("INSERT INTO businesses (id, code, name, phone, trial_days, trial_ends_at, plan, giro, extra_giros, created_at, status, free, force_password_change) VALUES (?,?,?,?,0,?, 'profesional', ?, '[]', ?, 'activo', 1, 0)").run(
      bizId, businessCode(), `Demo · ${demo.label}`, phone, iso(t), giro, iso(t))
    db.prepare('INSERT INTO branches (id, business_id, name, created_at) VALUES (?,?,?,?)').run(branchId, bizId, 'Principal', iso(t))
    db.prepare("INSERT INTO users (id, business_id, branch_id, role, name, phone, phone_verified, password_hash, must_change_password, created_at) VALUES (?,?,?,'owner',?,?,1,?,0,?)").run(ownerId, bizId, branchId, OWNER_NAMES[DEMOS.indexOf(demo) % OWNER_NAMES.length]!, phone, hashSecret(DEMO_PASSWORD), iso(t))
  })()
  const owner = db.prepare('SELECT * FROM users WHERE id = ?').get(ownerId) as UserRow
  const { token } = createSession(deps, owner, { deviceName: 'Carga de demo' })
  const call: Api = async (method, path, body) => {
    const r = await app.request(path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
    const j = (await r.json().catch(() => ({}))) as any
    if (r.status >= 400) throw new Error(`${method} ${path}: ${j?.error?.message ?? r.status}`)
    return j
  }
  await call('PUT', `/users/${ownerId}/auth-code`, { code: DEMO_CODE })
  const staff = (await call('POST', '/users', { name: demo.staff === 'barbero' ? 'Luis Pérez' : 'Karla Méndez', username: demoStaffUser(giro), password: DEMO_PASSWORD, template: demo.staff })).user
  db.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(staff.id)

  const day = (n: number, h = 13) => new Date(Date.parse(`${localDate(new Date(t.getTime() - n * 86_400_000))}T${String(h + 6).padStart(2, '0')}:15:00.000Z`))
  const past = (n: number, h?: number) => { const d = day(n, h); return iso(d > t ? new Date(t.getTime() - 60_000) : d) }
  const ctx = new Ctx(call, past)
  try {
    await SEEDS[giro]!(ctx, { ownerId, staffId: staff.id, t })
  } catch (e) {
    // Si algo falla a medias, la demo queda apartada (no se borra nada) y se puede volver a crear.
    db.prepare("UPDATE users SET phone = 'x' || substr(id, 1, 9), username = CASE WHEN username IS NULL THEN NULL ELSE 'x.' || id END, active = 0 WHERE business_id = ?").run(bizId)
    db.prepare("UPDATE businesses SET name = 'Demo fallida (ignorar)', status = 'suspendido' WHERE id = ?").run(bizId)
    throw e
  }
  return { created: true, businessId: bizId }
}

/** Ayudas para cargar el catálogo y las ventas. */
class Ctx {
  constructor(readonly call: Api, readonly past: (n: number, h?: number) => string) {}
  async supplier(name: string, phone: string) { return (await this.call('POST', '/suppliers', { name, phone })).id as string }
  async product(p: Record<string, unknown>) { return (await this.call('POST', '/products', p)).product as { id: string; name: string } }
  async buy(supplierId: string | undefined, items: { productId: string; quantity: number; cost: number; expiresAt?: string }[]) { return this.call('POST', '/purchases', { payment: 'contado', ...(supplierId ? { supplierId } : {}), items }) }
  async customer(name: string, phone?: string) { return (await this.call('POST', '/customers', { name, ...(phone ? { phone } : {}) })).customer as { id: string } }
  async service(s: Record<string, unknown>) { return (await this.call('POST', '/services', s)).service as { id: string } }
  async open(meal?: string) { await this.call('POST', '/shifts/open', { openingFloat: 50000, ...(meal ? { meal } : {}) }) }
  async sell(items: unknown[], n: number, extra: Record<string, unknown> = {}) {
    return this.call('POST', '/sales', { id: crypto.randomUUID(), paymentMethod: 'efectivo', createdAt: this.past(n, 10 + (n % 7)), items, ...extra })
  }
  /** Ventas de los últimos 6 días para que haya reportes y gráfica. */
  async history(lines: unknown[][]) { for (let n = 6; n >= 0; n--) for (let k = 0; k < lines.length; k++) if ((n + k) % 2 === 0 || n === 0) await this.sell(lines[k]!, n) }
}

type Seed = (c: Ctx, ids: { ownerId: string; staffId: string; t: Date }) => Promise<void>
const futureDate = (t: Date, days: number) => localDate(new Date(t.getTime() + days * 86_400_000))
const atLocal = (t: Date, days: number, hm: string) => new Date(`${futureDate(t, days)}T${hm}:00-06:00`).toISOString()

/** Clientes frecuentes ficticios. */
async function customers(c: Ctx, names: string[]) {
  const out: { id: string }[] = []
  for (let i = 0; i < names.length; i++) out.push(await c.customer(names[i]!, `96300000${String(i + 10).padStart(2, '0')}`))
  return out
}
/** Fiado: límite de crédito y deuda anterior. */
async function fiado(c: Ctx, ids: { id: string }[], debts: number[]) {
  for (let i = 0; i < debts.length; i++) {
    await c.call('PUT', `/customers/${ids[i]!.id}/credit-limit`, { limit: 200000 })
    if (debts[i]) await c.call('POST', `/customers/${ids[i]!.id}/credit-charges`, { amount: debts[i], note: 'Deuda de la libreta (demo)' })
  }
}

const SEEDS: Record<string, Seed> = {
  async abarrotes(c, { t }) {
    const sup = await c.supplier('Distribuidora del Sur', '9631000001')
    const sup2 = await c.supplier('Lácteos La Vaquita', '9631000002')
    const P = [
      await c.product({ name: 'Refresco cola 600 ml', unit: 'pieza', price: 2000, minStock: 12, barcode: '7501000000011' }),
      await c.product({ name: 'Papas fritas 45 g', unit: 'pieza', price: 1800, minStock: 10 }),
      await c.product({ name: 'Leche entera 1 L', unit: 'pieza', price: 2800, minStock: 8, trackExpiry: true }),
      await c.product({ name: 'Huevo', unit: 'kg', price: 4500, minStock: 3 }),
      await c.product({ name: 'Azúcar', unit: 'kg', price: 3200, minStock: 5 }),
      await c.product({ name: 'Frijol negro', unit: 'kg', price: 3800, minStock: 5 }),
      await c.product({ name: 'Aceite 1 L', unit: 'pieza', price: 4500, minStock: 6 }),
      await c.product({ name: 'Jabón de barra', unit: 'pieza', price: 2200, minStock: 6 }),
      await c.product({ name: 'Pan de caja', unit: 'pieza', price: 4900, minStock: 4, trackExpiry: true }),
      await c.product({ name: 'Galletas surtidas', unit: 'pieza', price: 1500, minStock: 10 }),
    ]
    await c.buy(sup, [{ productId: P[0]!.id, quantity: 48, cost: 62400 }, { productId: P[1]!.id, quantity: 30, cost: 33000 }, { productId: P[3]!.id, quantity: 15, cost: 52500 }, { productId: P[4]!.id, quantity: 20, cost: 48000 }, { productId: P[5]!.id, quantity: 15, cost: 42000 }, { productId: P[6]!.id, quantity: 12, cost: 38400 }, { productId: P[7]!.id, quantity: 4, cost: 6000 }, { productId: P[9]!.id, quantity: 40, cost: 36000 }])
    await c.buy(sup2, [{ productId: P[2]!.id, quantity: 24, cost: 48000, expiresAt: futureDate(t, 4) }, { productId: P[8]!.id, quantity: 6, cost: 20400, expiresAt: futureDate(t, 2) }])
    await c.call('PUT', `/products/${P[0]!.id}/price-tiers`, { tiers: [{ minQuantity: 12, price: 1700 }] })
    const cu = await customers(c, ['Doña Mari López', 'Don Beto Cruz', 'Fonda La Güera', 'Juan Hernández', 'Sofía Ramírez'])
    await fiado(c, cu, [45000, 12000, 0])
    await c.open()
    await c.history([[{ productId: P[0]!.id, quantity: 3 }, { productId: P[1]!.id, quantity: 2 }], [{ productId: P[2]!.id, quantity: 2 }, { productId: P[3]!.id, quantity: 1 }], [{ productId: P[4]!.id, quantity: 2 }, { productId: P[9]!.id, quantity: 3 }]])
    await c.sell([{ productId: P[0]!.id, quantity: 2 }, { productId: P[6]!.id, quantity: 1 }], 0, { paymentMethod: 'fiado', customerId: cu[2]!.id })
    await c.call('POST', '/layaways', { customerId: cu[3]!.id, items: [{ productId: P[6]!.id, quantity: 2 }], deposit: 3000, method: 'efectivo', dueDate: futureDate(t, 2) })
  },
  async ferreteria(c, { t }) {
    const sup = await c.supplier('Aceros y Tornillos del Sureste', '9631000011')
    const P = [
      await c.product({ name: 'Tornillo para madera 1"', unit: 'pieza', price: 150, minStock: 200 }),
      await c.product({ name: 'Cable calibre 12', unit: 'metro', price: 1800, minStock: 50 }),
      await c.product({ name: 'Cemento gris 50 kg', unit: 'pieza', price: 23500, minStock: 10 }),
      await c.product({ name: 'Pintura vinílica blanca 19 L', unit: 'pieza', price: 145000, minStock: 3 }),
      await c.product({ name: 'Clavo 2.5"', unit: 'kg', price: 4200, minStock: 10 }),
      await c.product({ name: 'Cinta de aislar', unit: 'pieza', price: 2500, minStock: 15 }),
      await c.product({ name: 'Martillo 16 oz', unit: 'pieza', price: 18900, minStock: 3 }),
      await c.product({ name: 'Tubo PVC 1/2" (6 m)', unit: 'pieza', price: 6500, minStock: 10 }),
    ]
    await c.buy(sup, [{ productId: P[0]!.id, quantity: 1000, cost: 60000 }, { productId: P[1]!.id, quantity: 200, cost: 220000 }, { productId: P[2]!.id, quantity: 25, cost: 450000 }, { productId: P[3]!.id, quantity: 5, cost: 500000 }, { productId: P[4]!.id, quantity: 30, cost: 75000 }, { productId: P[5]!.id, quantity: 10, cost: 12000 }, { productId: P[6]!.id, quantity: 6, cost: 66000 }, { productId: P[7]!.id, quantity: 20, cost: 80000 }])
    await c.call('PUT', `/products/${P[0]!.id}/price-tiers`, { tiers: [{ minQuantity: 100, price: 110 }, { minQuantity: 500, price: 90 }] })
    await c.call('POST', `/products/${P[2]!.id}/presentations`, { name: 'Tarima (40 bultos)', factor: 40, price: 880000 })
    const cu = await customers(c, ['Constructora Ruiz', 'Ing. Pedro Gómez', 'Plomería El Chino', 'María Torres'])
    await fiado(c, cu, [350000, 0, 85000])
    await c.open()
    await c.history([[{ productId: P[0]!.id, quantity: 50 }, { productId: P[5]!.id, quantity: 2 }], [{ productId: P[1]!.id, quantity: 15 }], [{ productId: P[2]!.id, quantity: 3 }, { productId: P[4]!.id, quantity: 2 }]])
    await c.call('POST', '/quotes', { customerId: cu[0]!.id, items: [{ productId: P[2]!.id, quantity: 40 }, { productId: P[0]!.id, quantity: 500 }] })
    void t
  },
  async papeleria(c, { t }) {
    const sup = await c.supplier('Papelera del Centro', '9631000021')
    const P = [
      await c.product({ name: 'Cuaderno profesional raya', unit: 'pieza', price: 3500, minStock: 20 }),
      await c.product({ name: 'Lápiz del 2', unit: 'pieza', price: 600, minStock: 50 }),
      await c.product({ name: 'Pluma azul', unit: 'pieza', price: 800, minStock: 40 }),
      await c.product({ name: 'Colores 12 pzas', unit: 'pieza', price: 4500, minStock: 10 }),
      await c.product({ name: 'Hojas blancas (paquete 500)', unit: 'pieza', price: 12000, minStock: 5 }),
      await c.product({ name: 'Paquete escolar 3er grado', unit: 'pieza', price: 18900, minStock: 0 }),
      await c.product({ name: 'Tóner copiadora', unit: 'pieza', price: 0, minStock: 1, sellable: false }),
    ]
    await c.buy(sup, [{ productId: P[0]!.id, quantity: 60, cost: 120000 }, { productId: P[1]!.id, quantity: 200, cost: 40000 }, { productId: P[2]!.id, quantity: 150, cost: 45000 }, { productId: P[3]!.id, quantity: 8, cost: 24000 }, { productId: P[4]!.id, quantity: 10, cost: 80000 }, { productId: P[6]!.id, quantity: 2, cost: 180000 }])
    await c.call('PUT', `/products/${P[5]!.id}/combo`, { items: [{ productId: P[0]!.id, quantity: 4 }, { productId: P[1]!.id, quantity: 3 }, { productId: P[3]!.id, quantity: 1 }] })
    const m = (await c.call('POST', '/machines', { name: 'Copiadora 1' })).machine ?? (await c.call('GET', '/machines')).machines[0]
    const copia = await c.service({ name: 'Copia carta B/N', price: 100, category: 'copias', attrs: { size: 'carta', color: false }, machineId: m?.id ?? null, sheetsPerUnit: 1 })
    await c.service({ name: 'Copia color', price: 500, category: 'copias', attrs: { size: 'carta', color: true }, machineId: m?.id ?? null, sheetsPerUnit: 1 })
    await c.service({ name: 'Engargolado', price: 3500, category: 'servicios' })
    const cu = await customers(c, ['Escuela Benito Juárez', 'Oficina Contable Pérez', 'Ana García'])
    await fiado(c, cu, [120000, 0])
    await c.open()
    await c.history([[{ serviceId: copia.id, quantity: 20 }, { productId: P[2]!.id, quantity: 2 }], [{ productId: P[0]!.id, quantity: 2 }], [{ productId: P[5]!.id, quantity: 1 }]])
    await c.call('POST', '/orders', { customerName: 'Ana García', phone: '9630000012', description: '50 invitaciones impresas a color', total: 45000, deposit: 20000, dueDate: futureDate(t, 3) })
  },
  async barberia(c, { ownerId, staffId, t }) {
    const sup = await c.supplier('Distribuidora Barber Pro', '9631000031')
    const cera = await c.product({ name: 'Cera mate', unit: 'pieza', price: 18000, minStock: 5 })
    const gel = await c.product({ name: 'Gel fijación extrema', unit: 'pieza', price: 9500, minStock: 5 })
    const aceite = await c.product({ name: 'Aceite para barba', unit: 'pieza', price: 22000, minStock: 3 })
    await c.buy(sup, [{ productId: cera.id, quantity: 12, cost: 96000 }, { productId: gel.id, quantity: 4, cost: 18000 }, { productId: aceite.id, quantity: 6, cost: 66000 }])
    const corte = await c.service({ name: 'Corte clásico', price: 15000, durationMin: 30, category: 'cortes' })
    const fade = await c.service({ name: 'Corte fade', price: 18000, durationMin: 40, category: 'cortes' })
    const barba = await c.service({ name: 'Arreglo de barba', price: 10000, durationMin: 20, category: 'barba' })
    const facial = await c.service({ name: 'Facial', price: 25000, durationMin: 30, category: 'facial' })
    const all = [0, 1, 2, 3, 4, 5, 6].filter((w) => w !== 0).map((w) => ({ weekday: w, start: '09:00', end: '20:00' }))
    for (const id of [ownerId, staffId]) await c.call('PUT', `/staff/${id}/agenda`, { inAgenda: true, schedule: all })
    await c.call('PUT', '/commission-rules', { rules: [{ targetType: 'all', rateBp: 4000 }] })
    await c.call('PUT', '/modules', { active: ['fidelidad', 'membresias'] })
    await c.call('PUT', '/loyalty', { unit: 'sellos', earnBy: 'venta', earnPoints: 1, scope: 'todos', dailyCap: 3 })
    await c.call('POST', '/loyalty/rewards', { name: 'Corte gratis', cost: 10 })
    await c.call('POST', '/loyalty/rewards', { name: 'Arreglo de barba gratis', cost: 6 })
    const cu = await customers(c, ['Joel Zamorano', 'Miguel Ángel Pérez', 'Daniel López', 'Kevin García', 'Saúl Hernández'])
    for (const [i, n] of [[0, 7], [1, 4], [2, 9]] as const) await c.call('POST', `/customers/${cu[i]!.id}/stamps/adjust`, { delta: n, reason: 'Sellos anteriores (demo)' })
    await c.open()
    await c.history([[{ serviceId: corte.id, quantity: 1, staffId }], [{ serviceId: fade.id, quantity: 1, staffId: ownerId }, { productId: cera.id, quantity: 1 }], [{ serviceId: barba.id, quantity: 1, staffId }]])
    for (const [k, svc, who, h, d] of [[0, corte, staffId, '17:00', 0], [1, fade, ownerId, '18:00', 0], [3, barba, staffId, '11:00', 1], [4, facial, ownerId, '12:30', 1]] as const) {
      const n = ['Joel Zamorano', 'Miguel Ángel Pérez', 'Daniel López', 'Kevin García', 'Saúl Hernández'][k]!
      const startsAt = atLocal(t, d, h)
      if (startsAt > iso(t)) await c.call('POST', '/appointments', { staffId: who, serviceIds: [svc.id], customerId: cu[k]!.id, customerName: n, phone: `96300000${String(k + 10).padStart(2, '0')}`, startsAt }).catch(() => {})
    }
  },
  async unas(c, { ownerId, staffId, t }) {
    const sup = await c.supplier('Nails Supply', '9631000041')
    const gel = await c.product({ name: 'Gel UV (uso)', unit: 'pieza', price: 0, minStock: 2, sellable: false })
    const esmalte = await c.product({ name: 'Esmalte rojo', unit: 'pieza', price: 8500, minStock: 4 })
    const crema = await c.product({ name: 'Crema de manos', unit: 'pieza', price: 12000, minStock: 3 })
    await c.buy(sup, [{ productId: gel.id, quantity: 10, cost: 150000 }, { productId: esmalte.id, quantity: 10, cost: 40000 }, { productId: crema.id, quantity: 2, cost: 12000 }])
    const mani = await c.service({ name: 'Manicure gel', price: 30000, durationMin: 60, attrs: { technique: 'Gel', dryMin: 15 } })
    const acri = await c.service({ name: 'Uñas acrílicas', price: 45000, durationMin: 90, attrs: { technique: 'Acrílico', dryMin: 10 } })
    const pedi = await c.service({ name: 'Pedicure spa', price: 35000, durationMin: 60, attrs: { technique: 'Pedicure' } })
    await c.call('PUT', `/recipes/${mani.id}`, { items: [{ productId: gel.id, quantity: 0.1 }] })
    const all = [1, 2, 3, 4, 5, 6].map((w) => ({ weekday: w, start: '10:00', end: '19:00' }))
    for (const id of [ownerId, staffId]) await c.call('PUT', `/staff/${id}/agenda`, { inAgenda: true, schedule: all })
    await c.call('PUT', '/commission-rules', { rules: [{ targetType: 'all', rateBp: 3500 }] })
    await c.call('PUT', '/modules', { active: ['fidelidad'] })
    await c.call('PUT', '/loyalty', { unit: 'sellos', earnBy: 'venta', earnPoints: 1, scope: 'todos', dailyCap: 2 })
    await c.call('POST', '/loyalty/rewards', { name: 'Manicure gratis', cost: 8 })
    const cu = await customers(c, ['Sofía Pérez', 'Valeria Gómez', 'Fernanda Ruiz', 'Andrea Castillo'])
    await c.call('PATCH', `/customers/${cu[0]!.id}`, { address: 'Calle Hidalgo 12, Centro', homeAll: true, notes: 'Prefiere tonos nude' })
    await c.open()
    await c.history([[{ serviceId: mani.id, quantity: 1, staffId }], [{ serviceId: pedi.id, quantity: 1, staffId: ownerId }, { productId: crema.id, quantity: 1 }]])
    const startsAt = atLocal(t, 1, '11:00')
    await c.call('POST', '/appointments', { staffId, serviceIds: [acri.id], customerId: cu[1]!.id, customerName: 'Valeria Gómez', phone: '9630000011', startsAt }).catch(() => {})
  },
  async perfumeria(c) {
    const sup = await c.supplier('Fragancias de Importación', '9631000051')
    const mk = (name: string, brand: string, fragrance: string, ml: number, presentation: string, price: number) => c.product({ name, unit: 'pieza', price, minStock: presentation === 'regular' ? 2 : 0, attrs: { brand, fragrance, ml, presentation }, ...(presentation === 'tester' ? { sellable: false } : {}) })
    const P = [
      await mk('Sauvage 100 ml', 'Dior', 'Sauvage', 100, 'regular', 250000),
      await mk('Sauvage decant 5 ml', 'Dior', 'Sauvage', 5, 'decant', 20000),
      await mk('Sauvage tester', 'Dior', 'Sauvage', 100, 'tester', 0),
      await mk('Good Girl 80 ml', 'Carolina Herrera', 'Good Girl', 80, 'regular', 280000),
      await mk('Acqua di Giò 100 ml', 'Armani', 'Acqua di Giò', 100, 'regular', 230000),
      await mk('Set regalo Good Girl', 'Carolina Herrera', 'Good Girl', 80, 'set', 310000),
      await c.product({ name: 'Caja de regalo', unit: 'pieza', price: 0, minStock: 5, sellable: false }),
    ]
    await c.buy(sup, [{ productId: P[0]!.id, quantity: 4, cost: 600000 }, { productId: P[2]!.id, quantity: 1, cost: 120000 }, { productId: P[3]!.id, quantity: 3, cost: 480000 }, { productId: P[4]!.id, quantity: 1, cost: 140000 }, { productId: P[6]!.id, quantity: 20, cost: 40000 }])
    await c.call('PUT', `/products/${P[5]!.id}/combo`, { items: [{ productId: P[3]!.id, quantity: 1 }, { productId: P[6]!.id, quantity: 1 }] })
    await customers(c, ['Laura Méndez', 'Ricardo Solís', 'Paola Jiménez'])
    await c.open()
    await c.history([[{ productId: P[3]!.id, quantity: 1 }], [{ productId: P[4]!.id, quantity: 1 }]])
  },
  async banos(c) {
    const sup = await c.supplier('Limpieza Total', '9631000061')
    const papel = await c.product({ name: 'Papel higiénico (rollo)', unit: 'pieza', price: 0, minStock: 24, sellable: false })
    const jabon = await c.product({ name: 'Jabón líquido (litro)', unit: 'litro', price: 0, minStock: 3, sellable: false })
    await c.buy(sup, [{ productId: papel.id, quantity: 48, cost: 28800 }, { productId: jabon.id, quantity: 2, cost: 9000 }])
    const san = await c.service({ name: 'Sanitario', price: 700 })
    const reg = await c.service({ name: 'Regadera', price: 3000 })
    await c.service({ name: 'Toalla', price: 1000 })
    await c.call('PUT', `/recipes/${san.id}`, { items: [{ productId: papel.id, quantity: 0.2 }] })
    for (const n of ['Limpiar sanitarios', 'Trapear piso', 'Surtir papel y jabón']) await c.call('POST', '/cleaning/tasks', { name: n })
    await c.open()
    await c.history([[{ serviceId: san.id, quantity: 3 }], [{ serviceId: reg.id, quantity: 1 }]])
  },
  async turistico(c, { t }) {
    const sup = await c.supplier('Recuerdos Artesanales', '9631000071')
    const llavero = await c.product({ name: 'Llavero artesanal', unit: 'pieza', price: 5000, minStock: 10 })
    await c.buy(sup, [{ productId: llavero.id, quantity: 40, cost: 80000 }])
    const adulto = await c.service({ name: 'Adulto', price: 15000, category: 'boleto' })
    await c.service({ name: 'Niño', price: 8000, category: 'boleto' })
    await c.service({ name: 'Adulto mayor', price: 7500, category: 'boleto' })
    await c.call('PUT', '/tourism/slots', { slots: [0, 1, 2, 3, 4, 5, 6].flatMap((w) => [{ weekday: w, start: '09:00', end: '11:00', capacity: 60 }, { weekday: w, start: '11:00', end: '13:00', capacity: 60 }, { weekday: w, start: '13:00', end: '15:00', capacity: 60 }, { weekday: w, start: '15:00', end: '17:00', capacity: 40 }]) })
    await c.service({ name: 'Estacionamiento', price: 3000 })
    await c.open()
    await c.history([[{ productId: llavero.id, quantity: 2 }]])
    void adulto; void t
  },
  async palapa(c) {
    const sup = await c.supplier('Mariscos El Puerto', '9631000081')
    const pescado = await c.product({ name: 'Pescado frito', unit: 'kg', price: 32000, trackStock: false, attrs: { station: 'cocina' } })
    const camaron = await c.product({ name: 'Cóctel de camarón', unit: 'pieza', price: 18000, trackStock: false, attrs: { station: 'cocina' } })
    const michelada = await c.product({ name: 'Michelada', unit: 'pieza', price: 9000, trackStock: false, attrs: { station: 'barra' } })
    const cerveza = await c.product({ name: 'Cerveza 355 ml', unit: 'pieza', price: 4000, minStock: 48, attrs: { station: 'barra' } })
    const hielo = await c.product({ name: 'Bolsa de hielo 5 kg', unit: 'pieza', price: 0, minStock: 5, sellable: false })
    await c.buy(sup, [{ productId: cerveza.id, quantity: 120, cost: 216000 }, { productId: hielo.id, quantity: 10, cost: 25000 }])
    for (const [n, a, s, m] of [['1', 'terraza', 4, 0], ['2', 'terraza', 4, 0], ['3', 'salon', 6, 0], ['4', 'salon', 8, 30000], ['VIP', 'privada', 10, 100000]] as const) await c.call('POST', '/tables', { name: n, area: a, seats: s, ...(m ? { minConsumption: m } : {}) })
    for (const [n, q, p] of [['Camastro', 20, 5000], ['Sombrilla', 10, 3000], ['Silla extra', 30, 1000]] as const) await c.call('POST', '/rental-assets', { name: n, quantity: q, price: p })
    await c.open()
    await c.history([[{ productId: pescado.id, quantity: 1.2 }, { productId: michelada.id, quantity: 2 }], [{ productId: camaron.id, quantity: 2 }, { productId: cerveza.id, quantity: 4 }]])
  },
  async restaurante(c) {
    const sup = await c.supplier('Abastos Central', '9631000091')
    const P = [
      await c.product({ name: 'Enchiladas verdes', unit: 'pieza', price: 12000, trackStock: false, attrs: { station: 'cocina_caliente' } }),
      await c.product({ name: 'Ensalada César', unit: 'pieza', price: 11000, trackStock: false, attrs: { station: 'cocina_fria' } }),
      await c.product({ name: 'Arrachera 300 g', unit: 'pieza', price: 26000, trackStock: false, attrs: { station: 'cocina_caliente' } }),
      await c.product({ name: 'Limonada', unit: 'pieza', price: 4500, trackStock: false, attrs: { station: 'barra' } }),
      await c.product({ name: 'Flan napolitano', unit: 'pieza', price: 5500, trackStock: false, attrs: { station: 'postres' } }),
      await c.product({ name: 'Refresco 355 ml', unit: 'pieza', price: 3500, minStock: 24, attrs: { station: 'barra' } }),
    ]
    await c.buy(sup, [{ productId: P[5]!.id, quantity: 48, cost: 57600 }])
    for (const [n, a, s] of [['1', 'salon', 4], ['2', 'salon', 4], ['3', 'salon', 2], ['4', 'terraza', 6], ['Barra', 'barra', 4]] as const) await c.call('POST', '/tables', { name: n, area: a, seats: s })
    await c.open()
    await c.history([[{ productId: P[0]!.id, quantity: 2 }, { productId: P[3]!.id, quantity: 2 }], [{ productId: P[2]!.id, quantity: 1 }, { productId: P[4]!.id, quantity: 1 }]])
  },
  async comedor(c, { t }) {
    const sup = await c.supplier('Abastos Central', '9631000101')
    const corrida = await c.product({ name: 'Comida corrida', unit: 'pieza', price: 8500, trackStock: false })
    const desayuno = await c.product({ name: 'Desayuno completo', unit: 'pieza', price: 7500, trackStock: false })
    const agua = await c.product({ name: 'Agua de jamaica', unit: 'pieza', price: 2000, trackStock: false })
    const refresco = await c.product({ name: 'Refresco 355 ml', unit: 'pieza', price: 2500, minStock: 24 })
    await c.buy(sup, [{ productId: refresco.id, quantity: 36, cost: 43200 }])
    const cu = await customers(c, ['Taller Mecánico Gómez', 'Oficinas del Ayuntamiento', 'Pedro Sánchez'])
    await fiado(c, cu, [68000, 34000])
    await c.call('POST', '/daily-menu', { date: localDate(t), meal: 'comida', productIds: [corrida.id, agua.id], authCode: DEMO_CODE })
    await c.call('POST', '/daily-menu', { date: localDate(t), meal: 'desayuno', productIds: [desayuno.id, agua.id], authCode: DEMO_CODE })
    await c.open('comida')
    await c.history([[{ productId: corrida.id, quantity: 3 }, { productId: agua.id, quantity: 3 }], [{ productId: desayuno.id, quantity: 2 }]])
  },
  async taqueria(c, { t }) {
    const sup = await c.supplier('Carnicería El Toro', '9631000111')
    const pastor = await c.product({ name: 'Carne al pastor', unit: 'kg', price: 0, minStock: 5, sellable: false })
    const tortilla = await c.product({ name: 'Tortilla', unit: 'kg', price: 0, minStock: 5, sellable: false })
    await c.buy(sup, [{ productId: pastor.id, quantity: 20, cost: 240000 }, { productId: tortilla.id, quantity: 10, cost: 25000 }])
    const taco = await c.product({ name: 'Taco al pastor', unit: 'pieza', price: 1800, trackStock: false })
    const gringa = await c.product({ name: 'Gringa de pastor', unit: 'pieza', price: 6500, trackStock: false })
    const agua = await c.product({ name: 'Agua de horchata', unit: 'pieza', price: 2500, trackStock: false })
    await c.call('PUT', `/recipes/${taco.id}`, { items: [{ productId: pastor.id, quantity: 0.03 }, { productId: tortilla.id, quantity: 0.02 }] })
    await c.call('PUT', `/recipes/${gringa.id}`, { items: [{ productId: pastor.id, quantity: 0.1 }] })
    await c.call('POST', '/daily-menu', { date: localDate(t), meal: 'dia', productIds: [taco.id, gringa.id, agua.id], authCode: DEMO_CODE })
    await c.open()
    await c.call('POST', '/meat/batches', { productId: pastor.id, kg: 8 })
    await c.history([[{ productId: taco.id, quantity: 10 }, { productId: agua.id, quantity: 2 }], [{ productId: gringa.id, quantity: 2 }]])
  },
  async verduleria(c, { t }) {
    const sup = await c.supplier('Central de Abastos', '9631000121')
    const P = [
      await c.product({ name: 'Jitomate', unit: 'kg', price: 2800, minStock: 10 }),
      await c.product({ name: 'Cebolla blanca', unit: 'kg', price: 2400, minStock: 8 }),
      await c.product({ name: 'Aguacate', unit: 'kg', price: 6500, minStock: 5 }),
      await c.product({ name: 'Limón', unit: 'kg', price: 3000, minStock: 8 }),
      await c.product({ name: 'Plátano', unit: 'kg', price: 2200, minStock: 10 }),
      await c.product({ name: 'Cilantro', unit: 'pieza', price: 800, minStock: 20 }),
    ]
    await c.buy(sup, [{ productId: P[0]!.id, quantity: 40, cost: 72000 }, { productId: P[1]!.id, quantity: 25, cost: 37500 }, { productId: P[2]!.id, quantity: 15, cost: 60000 }, { productId: P[3]!.id, quantity: 6, cost: 10200 }, { productId: P[4]!.id, quantity: 30, cost: 36000 }, { productId: P[5]!.id, quantity: 50, cost: 20000 }])
    await c.call('POST', `/products/${P[5]!.id}/presentations`, { name: 'Manojo grande', factor: 3, price: 2000 })
    const cu = await customers(c, ['Fonda Doña Lupe', 'Restaurante El Mirador', 'Carmen Ruiz'])
    await fiado(c, cu, [125000, 0])
    await c.open()
    await c.history([[{ productId: P[0]!.id, quantity: 2 }, { productId: P[1]!.id, quantity: 1 }], [{ productId: P[2]!.id, quantity: 1 }, { productId: P[5]!.id, quantity: 2 }]])
    void t
  },
}
