/** Búsqueda de funciones (pura, sin pantalla): ignora acentos y mayúsculas, acepta varias palabras y sinónimos. */
export interface ItemBusqueda { key: string; label: string; desc?: string; modulo: string; palabras?: string }

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Palabras que la gente usa para cada pantalla (además de su nombre). */
export const SINONIMOS: Record<string, string> = {
  inicio: 'panel resumen tablero hoy indicadores',
  caja: 'vender venta cobrar cobro ticket corte efectivo dinero abrir cerrar caja arqueo retiro',
  agenda: 'cita citas turno turnos reservar reservacion calendario horario',
  entradas: 'entrada acceso aforo bano banos cobrar',
  taquilla: 'boleto boletos entrada vender taquilla',
  acceso: 'validar boleto qr escanear entrada',
  mesas: 'mesa cuenta comensal salon reserva renta',
  pedidos: 'pedido llevar recoger telefono domicilio',
  cocina: 'comanda comandas platillo orden estacion',
  menu: 'menu guisado platillo agotado hoy',
  carne: 'trompo asada sobrante pastor',
  apartados: 'apartado anticipo abono apartar',
  cotizaciones: 'cotizar cotizacion presupuesto',
  encargos: 'encargo trabajo anticipo',
  devoluciones: 'devolver devolucion reembolso cambio ticket',
  escanear: 'qr sello membresia entrada escanear camara',
  productos: 'producto inventario existencias stock precio alta codigo barras mayoreo catalogo articulos',
  precios: 'precio precios kilo dia actualizar',
  compras: 'compra proveedor proveedores surtir pedido factura mercancia',
  cierre: 'cierre merma conteo inventario fisico',
  clientes: 'cliente fiado deuda credito saldo abonar contacto telefono',
  lealtad: 'sellos premios promocion promociones rifa membresia fidelidad puntos',
  finanzas: 'dinero gastos utilidad ganancia estado de resultados contabilidad balance egresos',
  reportes: 'reporte ventas retiro periodo mes cajero grafica estadistica',
  comisiones: 'comision propina propinas pago personal',
  configurar: 'configurar catalogo servicios tarifas horarios categorias copia respaldo exportar datos',
  asistencia: 'entrada salida checar asistencia',
  usuarios: 'personal empleado empleados permisos usuario encargado contrasena',
  buzon: 'soporte ayuda duda problema contacto',
  importar: 'importar excel csv traer datos',
  ajustes: 'ajustes negocio datos modulos instalar impresora ticket logo',
}

/**
 * Ordena por relevancia: nombre que empieza con lo escrito > nombre que lo contiene > sinónimos > descripción.
 * Todas las palabras escritas deben aparecer en alguna parte (nombre, sinónimos, descripción o módulo).
 */
export function buscar<T extends ItemBusqueda>(items: T[], consulta: string): T[] {
  const q = norm(consulta)
  if (!q) return []
  const tokens = q.split(/\s+/)
  const puntuados: [T, number][] = []
  for (const it of items) {
    const nombre = norm(it.label), sin = norm(`${it.palabras ?? ''} ${SINONIMOS[it.key] ?? ''}`), desc = norm(it.desc ?? ''), mod = norm(it.modulo)
    let total = 0, ok = true
    for (const t of tokens) {
      let p = 0
      if (nombre.startsWith(t)) p = 6
      else if (nombre.split(/\s+/).some((w) => w.startsWith(t))) p = 5
      else if (nombre.includes(t)) p = 4
      else if (sin.split(/\s+/).some((w) => w.startsWith(t))) p = 3
      else if (desc.includes(t)) p = 2
      else if (mod.includes(t)) p = 1
      if (!p) { ok = false; break }
      total += p
    }
    if (ok) puntuados.push([it, total])
  }
  return puntuados.sort((a, b) => b[1] - a[1] || a[0].label.localeCompare(b[0].label, 'es')).map(([it]) => it)
}
