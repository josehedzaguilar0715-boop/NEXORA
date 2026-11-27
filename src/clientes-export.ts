import { Hono } from 'hono'
import { audit } from './audit.js'
import { requirePerm, type Env } from './context.js'
import type { Db } from './db.js'
import { FORMATS, slugify, toCsv, toPdf, toXlsx, type Cell, type Doc, type Format, type Hoja } from './exportar.js'
import { bad, localDate } from './util.js'

/**
 * Exportar los clientes con su tarjeta de fidelidad (saldo de sellos o puntos, premios) y el historial
 * completo de movimientos, a Excel, CSV o PDF. Solo lectura. Contiene teléfonos: solo para quien ve reportes.
 */
const MOVIMIENTO: Record<string, string> = {
  venta: 'Compra', visita: 'Visita', manual: 'Ajuste manual', escaneo: 'Tarjeta escaneada', canje: 'Canje de premio',
  ajuste: 'Ajuste', cancelacion: 'Venta cancelada', customer: 'Registrado por el cliente',
}

const fechaHora = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { fecha: '', hora: '' }
  const hora = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  return { fecha: localDate(d), hora }
}

interface ClienteRow { id: string; name: string; phone: string | null; notes: string | null; code: string; loyalty_enrolled: number; created_at: string }
interface Mov { customer_id: string; delta: number; reason: string; created_at: string; reward: string | null; quien: string | null }

export function clientesDoc(db: Db, businessId: string, date: string): { doc: Doc; clientes: Hoja; historial: Hoja | null } {
  const business = (db.prepare('SELECT name FROM businesses WHERE id = ?').get(businessId) as { name: string }).name
  const program = db.prepare('SELECT unit FROM loyalty_program WHERE business_id = ?').get(businessId) as { unit: 'puntos' | 'sellos' } | undefined
  const unit = program?.unit ?? 'sellos'
  const rewards = db.prepare('SELECT name, cost FROM loyalty_rewards WHERE business_id = ? AND active = 1 ORDER BY cost').all(businessId) as { name: string; cost: number }[]
  const list = db.prepare('SELECT id, name, phone, notes, code, loyalty_enrolled, created_at FROM customers WHERE business_id = ? AND active = 1 ORDER BY name COLLATE NOCASE').all(businessId) as ClienteRow[]
  const movs = program
    ? db.prepare(`SELECT l.customer_id, l.delta, l.reason, l.created_at, r.name AS reward, u.name AS quien
        FROM loyalty_ledger l JOIN customers c ON c.id = l.customer_id AND c.business_id = ? AND c.active = 1
        LEFT JOIN loyalty_rewards r ON r.id = l.reward_id LEFT JOIN users u ON u.id = l.created_by
        WHERE l.business_id = ? ORDER BY l.created_at, l.rowid`).all(businessId, businessId) as Mov[]
    : []

  // Saldo corrido por cliente (en orden cronológico) para mostrar «saldo después» en cada movimiento.
  const saldo = new Map<string, { bal: number; ganados: number; canjeados: number; ultimo: string }>()
  const hist: { c: ClienteRow; m: Mov; despues: number }[] = []
  const byId = new Map(list.map((c) => [c.id, c]))
  for (const m of movs) {
    const c = byId.get(m.customer_id); if (!c) continue
    const s = saldo.get(c.id) ?? { bal: 0, ganados: 0, canjeados: 0, ultimo: '' }
    s.bal += m.delta; if (m.delta > 0) s.ganados += m.delta; else s.canjeados += -m.delta
    s.ultimo = m.created_at; saldo.set(c.id, s)
    hist.push({ c, m, despues: s.bal })
  }

  const U = unit === 'sellos' ? 'sellos' : 'puntos'
  const filas: Cell[][] = []
  const pdfFilas: string[][] = []
  let conSaldo = 0
  for (const c of list) {
    const s = saldo.get(c.id)
    const alta = fechaHora(c.created_at).fecha
    if (!program) { filas.push([c.name, c.phone ?? '', c.code, alta, c.notes ?? '']); pdfFilas.push([c.name, c.phone ?? '', c.code, alta, c.notes ?? '']); continue }
    const bal = s?.bal ?? 0
    const sig = rewards.find((r) => r.cost > bal)
    const disp = [...rewards].reverse().find((r) => r.cost <= bal)
    if (bal > 0) conSaldo++
    const ult = s?.ultimo ? fechaHora(s.ultimo).fecha : ''
    const faltan = sig ? sig.cost - bal : null
    const row: Cell[] = [c.name, c.phone ?? '', c.code, c.loyalty_enrolled ? 'Sí' : 'No', bal, s?.ganados ?? 0, s?.canjeados ?? 0, ult, disp?.name ?? '', sig?.name ?? '', faltan, alta, c.notes ?? '']
    filas.push(row)
    pdfFilas.push([c.name, c.phone ?? '', c.code, c.loyalty_enrolled ? 'Sí' : 'No', String(bal), String(s?.ganados ?? 0), String(s?.canjeados ?? 0), ult, disp?.name ?? '', sig?.name ?? '', faltan == null ? '' : String(faltan)])
  }
  const clientes: Hoja = program
    ? {
      name: 'Clientes', title: 'Clientes y tarjeta de fidelidad',
      head: ['Nombre', 'Teléfono', 'Código de cliente', 'En fidelidad', `Saldo de ${U}`, `${U[0]!.toUpperCase()}${U.slice(1)} ganados`, `${U[0]!.toUpperCase()}${U.slice(1)} canjeados`, 'Último movimiento', 'Premio disponible', 'Próximo premio', `Faltan (${U})`, 'Alta', 'Notas'],
      rows: filas, widths: [32, 16, 16, 12, 14, 14, 14, 16, 22, 22, 14, 12, 40],
      pdf: [{ w: 28 }, { w: 12 }, { w: 13 }, { w: 6, head: 'Fidel.' }, { w: 6, head: 'Saldo', right: true }, { w: 7, head: 'Ganados', right: true }, { w: 6, head: 'Canjes', right: true }, { w: 10, head: 'Últ. mov.' }, { w: 16, head: 'Disponible' }, { w: 16, head: 'Próximo' }, { w: 6, head: 'Faltan', right: true }],
      pdfRows: pdfFilas,
    }
    : {
      name: 'Clientes', title: 'Clientes', head: ['Nombre', 'Teléfono', 'Código de cliente', 'Alta', 'Notas'], rows: filas, widths: [32, 16, 16, 12, 40],
      pdf: [{ w: 36 }, { w: 14 }, { w: 12 }, { w: 10 }, { w: 60 }], pdfRows: pdfFilas,
    }

  let historial: Hoja | null = null
  if (program) {
    const orden = hist.slice().reverse() // lo más reciente primero
    const rows: Cell[][] = orden.map(({ c, m, despues }) => {
      const t = fechaHora(m.created_at)
      return [t.fecha, t.hora, c.name, c.phone ?? '', MOVIMIENTO[m.reason] ?? m.reason, m.delta, despues, m.reward ?? '', m.quien ?? '']
    })
    historial = {
      name: 'Historial', title: `Historial de ${U}`,
      head: ['Fecha', 'Hora', 'Cliente', 'Teléfono', 'Movimiento', `Cantidad (${U})`, 'Saldo después', 'Premio', 'Registró'],
      rows, widths: [12, 8, 32, 16, 24, 14, 14, 22, 22],
      pdf: [{ w: 10 }, { w: 5 }, { w: 28 }, { w: 12 }, { w: 22 }, { w: 8, head: 'Cant.', right: true }, { w: 7, head: 'Saldo', right: true }, { w: 18 }, { w: 18 }],
      pdfRows: rows.map((r) => r.map((v, i) => (v == null ? '' : i === 5 && typeof v === 'number' && v > 0 ? `+${v}` : String(v)))),
    }
  }
  const resumen = program ? `  |  ${conSaldo} con ${U}  |  ${rewards.length ? 'Premios: ' + rewards.map((r) => `${r.name} (${r.cost})`).join(', ') : 'sin premios configurados'}` : ''
  const doc: Doc = {
    title: `Clientes - ${business}`,
    subtitle: `al ${date}  |  ${list.length} clientes${resumen}`,
    hojas: historial ? [clientes, historial] : [clientes],
  }
  return { doc, clientes, historial }
}

export const clientesExport = new Hono<Env>()

clientesExport.get('/customers-export', requirePerm('view_reports'), async (c) => {
  const { db, now } = c.get('deps')
  const u = c.get('session').user
  const format = (c.req.query('format') ?? 'xlsx') as Format
  if (!FORMATS[format]) throw bad('Elige el formato: xlsx, csv o pdf.')
  const parte = c.req.query('parte') ?? 'clientes'
  if (parte !== 'clientes' && parte !== 'historial') throw bad('Elige la parte: clientes o historial.')
  const date = localDate(now())
  const { doc, clientes, historial } = clientesDoc(db, u.business_id, date)
  if (parte === 'historial' && !historial) throw bad('Este negocio todavía no tiene tarjeta de fidelidad.')
  const bytes = format === 'xlsx' ? toXlsx(doc.hojas) : format === 'csv' ? toCsv(parte === 'historial' ? historial! : clientes) : toPdf(doc)
  const business = (db.prepare('SELECT name FROM businesses WHERE id = ?').get(u.business_id) as { name: string }).name
  audit(db, now, { businessId: u.business_id, userId: u.id, action: 'clientes.exportado', newValue: { format, parte, clientes: clientes.rows.length, movimientos: historial?.rows.length ?? 0 } })
  const nombre = format === 'csv' && parte === 'historial' ? 'historial-sellos' : 'clientes'
  return new Response(bytes as unknown as BodyInit, { status: 200, headers: { 'content-type': FORMATS[format].type, 'content-disposition': `attachment; filename="${nombre}-${slugify(business)}-${date}.${FORMATS[format].ext}"`, 'cache-control': 'no-store' } })
})
