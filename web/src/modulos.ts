import type { LucideIcon } from 'lucide-react'
import { Archive, Armchair, CalendarDays, ChefHat, ChartColumn, ClipboardCheck, ClipboardList, Clock, DoorOpen, FileText, Flame, Gift, Boxes, Landmark, LayoutDashboard, LifeBuoy, Package, Percent, QrCode, ScanLine, Settings, ShoppingCart, SlidersHorizontal, Tag, Ticket, Truck, Undo2, Upload, UserCog, Users, UtensilsCrossed } from 'lucide-react'

/** Familias de color de módulo (valores en tokens.css: --m-*). */
export type Modulo = 'ventas' | 'inventario' | 'clientes' | 'dinero' | 'reportes' | 'mesas' | 'cocina' | 'agenda' | 'admin'

export const MODULOS: Record<Modulo, { nombre: string; icono: LucideIcon }> = {
  ventas: { nombre: 'Ventas', icono: ShoppingCart }, inventario: { nombre: 'Inventario', icono: Boxes }, clientes: { nombre: 'Clientes', icono: Users },
  dinero: { nombre: 'Dinero', icono: Landmark }, reportes: { nombre: 'Reportes', icono: ChartColumn }, mesas: { nombre: 'Mesas', icono: Armchair },
  cocina: { nombre: 'Cocina', icono: ChefHat }, agenda: { nombre: 'Agenda', icono: CalendarDays }, admin: { nombre: 'Mi negocio', icono: Settings },
}

/** Pantalla (clave de App.tsx) → familia de color. Se usa en el menú, los encabezados y el buscador (fases siguientes). */
export const MODULO_DE: Record<string, Modulo> = {
  inicio: 'ventas', caja: 'ventas', taquilla: 'ventas', entradas: 'ventas', acceso: 'ventas', apartados: 'ventas', cotizaciones: 'ventas', encargos: 'ventas', devoluciones: 'ventas',
  agenda: 'agenda', mesas: 'mesas', pedidos: 'mesas', cocina: 'cocina', menu: 'cocina', carne: 'cocina',
  productos: 'inventario', precios: 'inventario', compras: 'inventario', cierre: 'inventario',
  clientes: 'clientes', lealtad: 'clientes', escanear: 'clientes',
  finanzas: 'dinero', comisiones: 'dinero', reportes: 'reportes',
  configurar: 'admin', asistencia: 'admin', usuarios: 'admin', buzon: 'admin', importar: 'admin', ajustes: 'admin',
}
export const moduloDe = (clave: string): Modulo => MODULO_DE[clave] ?? 'admin'
// Íconos que ya usa cada pantalla en el menú (App.tsx) se conservan; estos solo sirven a la guía visual.
export const ICONOS_GUIA: [string, LucideIcon][] = [['Inicio', LayoutDashboard], ['Apartados', Archive], ['Pedidos', ClipboardList], ['Cierre', ClipboardCheck], ['Asistencia', Clock], ['Entradas', DoorOpen], ['Cotizaciones', FileText], ['Carne', Flame], ['Promos', Gift], ['Soporte', LifeBuoy], ['Encargos', Package], ['Comisiones', Percent], ['Escanear', QrCode], ['Acceso', ScanLine], ['Configurar', SlidersHorizontal], ['Precios', Tag], ['Taquilla', Ticket], ['Compras', Truck], ['Devoluciones', Undo2], ['Importar', Upload], ['Personal', UserCog], ['Menú', UtensilsCrossed]]
