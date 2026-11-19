import type { Me } from './App'

/** Giros de NEXORA con su nombre para mostrar (mismo orden que la spec). */
export const GIROS: Record<string, string> = {
  abarrotes: 'Abarrotes', ferreteria: 'Ferretería', papeleria: 'Papelería', barberia: 'Barbería', unas: 'Estudio de uñas', perfumeria: 'Perfumería',
  banos: 'Baños públicos', turistico: 'Lugar turístico', palapa: 'Palapa', restaurante: 'Restaurante', comedor: 'Comedor', taqueria: 'Taquería', verduleria: 'Verdulería',
}
export const giroLabel = (g: string) => GIROS[g] ?? g

/**
 * Vocabulario de cada giro: un solo lugar para decidir cómo se llama cada cosa y qué opciones existen,
 * para que ningún negocio vea palabras o botones de otro (mesas en una ferretería, fiado en una barbería…).
 */

export const FOOD_GIROS = ['palapa', 'restaurante', 'taqueria', 'comedor']
export const AGENDA_GIROS = ['barberia', 'unas']
/** Venden a crédito a clientes de confianza. */
export const FIADO_GIROS = ['abarrotes', 'ferreteria', 'papeleria', 'comedor', 'verduleria']
/** Reciben propinas (con mesero o con quien atiende). */
export const TIP_GIROS = [...FOOD_GIROS, ...AGENDA_GIROS]
/** Venden por kilo, litro o metro como parte normal de la tienda. */
export const BULK_GIROS = ['abarrotes', 'verduleria', 'ferreteria']

const giros = (me: Me) => [me.business.giro, ...(me.business.giros ?? [])].filter(Boolean) as string[]
const any = (me: Me, list: string[]) => giros(me).some((g) => list.includes(g))

export function vocab(me: Me) {
  const g = giros(me)
  const food = any(me, FOOD_GIROS)
  const has = (x: string) => g.includes(x)
  /** Quien atiende en la agenda: barbero, técnica o ambos. */
  const staff = has('barberia') && has('unas') ? 'barbero o técnica' : has('unas') ? 'técnica' : has('barberia') ? 'barbero' : 'empleado'
  // Lo que «Empezar de cero» borra, solo con lo que este negocio usa.
  const resetItems = ['ventas', 'cortes de caja', 'gastos']
  if (any(me, FIADO_GIROS)) resetItems.push('fiados')
  if (has('abarrotes')) resetItems.push('apartados')
  if (any(me, AGENDA_GIROS)) resetItems.push('citas')
  if (food) resetItems.push('cuentas de mesa', 'pedidos y comandas')
  if (has('ferreteria')) resetItems.push('cotizaciones')
  if (has('papeleria')) resetItems.push('encargos')
  if (has('banos') || has('turistico')) resetItems.push('entradas')
  return {
    food,
    fiado: any(me, FIADO_GIROS),
    tips: any(me, TIP_GIROS),
    agenda: any(me, AGENDA_GIROS),
    staff,
    /** Etiqueta para lo vendido por kilo, litro o metro. */
    bulk: any(me, BULK_GIROS) ? 'Granel' : food ? 'Por kilo' : 'Por kilo, litro o metro',
    /** Qué incluye el costo de lo vendido en este negocio. */
    costOf: food ? 'ingredientes de tus recetas y platillos' : any(me, AGENDA_GIROS) ? 'productos y material de los servicios' : has('papeleria') ? 'productos e insumos (papel, tinta)' : 'lo que te costó la mercancía',
    /** Insumos que gasta un servicio. */
    supplies: has('papeleria') ? 'papel, tinta y material' : any(me, AGENDA_GIROS) ? 'productos y material' : has('banos') ? 'jabón, papel y limpieza' : 'insumos',
    resetItems: resetItems.join(', ').replace(/, ([^,]*)$/, ' y $1'),
  }
}
