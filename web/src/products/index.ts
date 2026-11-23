/**
 * Productos de NEXORA: misma estructura profesional, identidad propia por giro.
 *
 * Un producto define:
 *  - marca (nombre, lema) que ve el negocio,
 *  - identidad visual (se aplica con `data-product` en <html>; los tokens viven en products.css),
 *  - qué herramientas van primero (accesos rápidos) y cuáles no se muestran porque ese negocio no las usa,
 *  - el bloque principal de su Inicio.
 *
 * Los giros que todavía no tienen producto propio usan «nexora» (la identidad base de siempre).
 * Para agregar un producto: un objeto aquí + su bloque en products.css. Nada más cambia.
 */

export type ProductId = 'nexora' | 'barber' | 'nails' | 'market'

export interface Product {
  id: ProductId
  /** Nombre comercial (provisional hasta que el propietario lo apruebe). */
  name: string
  /** Segunda palabra de la marca junto a NEXORA en el menú. */
  short: string
  tagline: string
  giros: string[]
  /** Pantallas que van primero en los accesos rápidos de Inicio. */
  quick: string[]
  /** Pantallas que este producto no muestra aunque el permiso las permita. */
  hide: string[]
  /** Bloque principal del Inicio: la agenda de hoy (servicios) o la caja y el surtido (tienda). */
  home: 'agenda' | 'tienda' | 'base'
  /** Color de la barra del navegador en celular. */
  themeColor: string
}

export const PRODUCTS: Record<ProductId, Product> = {
  nexora: {
    id: 'nexora', name: 'NEXORA', short: '', tagline: 'Punto de venta para tu negocio', giros: [],
    quick: [], hide: [], home: 'base', themeColor: '#07090f',
  },
  barber: {
    id: 'barber', name: 'NEXORA Barber', short: 'Barber', tagline: 'La agenda y la caja de tu barbería', giros: ['barberia'],
    quick: ['agenda', 'caja', 'clientes', 'comisiones', 'reportes'],
    // Una barbería no fía ni hace cierres de mercancía perecedera.
    hide: ['cierre', 'apartados'],
    home: 'agenda', themeColor: '#100e0c',
  },
  nails: {
    id: 'nails', name: 'NEXORA Nails', short: 'Nails', tagline: 'Tu estudio, tus citas y tus clientas', giros: ['unas'],
    quick: ['agenda', 'caja', 'clientes', 'comisiones', 'productos'],
    hide: ['cierre', 'apartados'],
    home: 'agenda', themeColor: '#fbf6f4',
  },
  market: {
    id: 'market', name: 'NEXORA Tienda', short: 'Tienda', tagline: 'Vende, surte y cobra el fiado sin complicarte', giros: ['abarrotes'],
    quick: ['caja', 'productos', 'compras', 'clientes', 'apartados'],
    hide: [],
    home: 'tienda', themeColor: '#f5f6f0',
  },
}

/** Producto de un negocio: por su giro principal. Los giros sin producto propio usan la identidad base. */
export function productOf(giro: string | undefined | null): Product {
  return Object.values(PRODUCTS).find((p) => giro && p.giros.includes(giro)) ?? PRODUCTS.nexora
}

const KEY = 'nx_product'
/** Aplica la identidad visual (también en la pantalla de acceso, recordando la última usada en este equipo). */
export function applyProduct(p: Product) {
  document.documentElement.dataset.product = p.id
  document.documentElement.style.background = ''
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.themeColor)
  try { localStorage.setItem(KEY, p.id) } catch { /* sin almacenamiento */ }
}
export function lastProduct(): Product {
  try { const id = localStorage.getItem(KEY) as ProductId | null; if (id && PRODUCTS[id]) return PRODUCTS[id] } catch { /* sin almacenamiento */ }
  return PRODUCTS.nexora
}
