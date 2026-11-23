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

export type ProductId = 'nexora' | 'barber' | 'nails' | 'market' | 'tools' | 'paper' | 'scent' | 'access' | 'tour' | 'beach' | 'dining' | 'fonda' | 'taco' | 'greens'

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
  // ---- Los otros 10 giros (nombres provisionales hasta que el propietario los apruebe) ----
  tools: {
    id: 'tools', name: 'NEXORA Ferretería', short: 'Ferretería', tagline: 'Mostrador, cotizaciones y surtido sin perder una pieza', giros: ['ferreteria'],
    quick: ['caja', 'cotizaciones', 'productos', 'compras', 'devoluciones'], hide: [], home: 'base', themeColor: '#131518',
  },
  paper: {
    id: 'paper', name: 'NEXORA Papelería', short: 'Papelería', tagline: 'Copias, encargos y temporada escolar en orden', giros: ['papeleria'],
    quick: ['caja', 'encargos', 'productos', 'compras', 'clientes'], hide: [], home: 'base', themeColor: '#f7f5ef',
  },
  scent: {
    id: 'scent', name: 'NEXORA Perfumería', short: 'Perfumería', tagline: 'Fragancias, decants y asesoras con su comisión', giros: ['perfumeria'],
    quick: ['caja', 'productos', 'clientes', 'comisiones', 'devoluciones'], hide: [], home: 'base', themeColor: '#140f16',
  },
  access: {
    id: 'access', name: 'NEXORA Acceso', short: 'Acceso', tagline: 'Entradas, pases y limpieza por turno', giros: ['banos'],
    quick: ['entradas', 'caja', 'escanear', 'productos', 'reportes'], hide: [], home: 'base', themeColor: '#f1f5fa',
  },
  tour: {
    id: 'tour', name: 'NEXORA Turismo', short: 'Turismo', tagline: 'Taquilla, aforo y acceso con QR', giros: ['turistico'],
    quick: ['taquilla', 'acceso', 'caja', 'reportes', 'productos'], hide: [], home: 'base', themeColor: '#f5f1e6',
  },
  beach: {
    id: 'beach', name: 'NEXORA Palapa', short: 'Palapa', tagline: 'Mesas frente al mar, cocina y barra al día', giros: ['palapa'],
    quick: ['mesas', 'caja', 'cocina', 'precios', 'comisiones'], hide: [], home: 'base', themeColor: '#fbf6ec',
  },
  dining: {
    id: 'dining', name: 'NEXORA Restaurante', short: 'Restaurante', tagline: 'Mesas, comandas y cocina en tiempo real', giros: ['restaurante'],
    quick: ['mesas', 'pedidos', 'cocina', 'menu', 'caja'], hide: [], home: 'base', themeColor: '#faf6f0',
  },
  fonda: {
    id: 'fonda', name: 'NEXORA Comedor', short: 'Comedor', tagline: 'Menú del día, venta rápida y cuentas de oficina', giros: ['comedor'],
    quick: ['caja', 'menu', 'pedidos', 'clientes', 'cocina'], hide: [], home: 'base', themeColor: '#faf6f0',
  },
  taco: {
    id: 'taco', name: 'NEXORA Taquería', short: 'Taquería', tagline: 'Trompo, guisados y pedidos sin que se escape un taco', giros: ['taqueria'],
    quick: ['caja', 'mesas', 'carne', 'pedidos', 'precios'], hide: [], home: 'base', themeColor: '#151110',
  },
  greens: {
    id: 'greens', name: 'NEXORA Mercado', short: 'Mercado', tagline: 'Precio del día, báscula, merma y pedidos', giros: ['verduleria'],
    quick: ['caja', 'precios', 'pedidos', 'cierre', 'compras'], hide: [], home: 'base', themeColor: '#f6f7f0',
  },
}

/** Producto de un negocio: por su giro principal. Los giros sin producto propio usan la identidad base. */
export function productOf(giro: string | undefined | null): Product {
  return Object.values(PRODUCTS).find((p) => giro && p.giros.includes(giro)) ?? PRODUCTS.nexora
}

const KEY = 'nx_product'
/** Aplica la identidad visual (también en la pantalla de acceso, recordando la última usada en este equipo). */
export function applyProduct(p: Product, remember = true) {
  document.documentElement.dataset.product = p.id
  document.documentElement.style.background = ''
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.themeColor)
  if (remember) try { localStorage.setItem(KEY, p.id) } catch { /* sin almacenamiento */ }
}
/** Páginas públicas (reservar, boletos, tarjeta): el cliente final ve la identidad del negocio, sin cambiar la que recuerda su equipo. */
export const applyPublicProduct = (giro: string | undefined | null) => { if (giro) applyProduct(productOf(giro), false) }
export function lastProduct(): Product {
  try { const id = localStorage.getItem(KEY) as ProductId | null; if (id && PRODUCTS[id]) return PRODUCTS[id] } catch { /* sin almacenamiento */ }
  return PRODUCTS.nexora
}
