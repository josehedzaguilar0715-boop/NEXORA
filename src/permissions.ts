export const PERMISSIONS = {
  sell: 'Vender y cobrar',
  open_close_cash: 'Abrir y cerrar caja',
  cancel_discount: 'Cancelar o descontar (con código)',
  change_prices: 'Cambiar precios',
  view_inventory: 'Ver inventario',
  edit_inventory: 'Editar inventario y compras',
  view_reports: 'Ver reportes y ventas de otros (de su sucursal; solo lectura)',
  create_employees: 'Crear empleados',
  view_commissions: 'Ver comisiones',
  configure_catalog: 'Configurar productos o menú',
  customers_credit: 'Clientes y fiado',
  attendance: 'Asistencia',
  give_stamps: 'Dar sellos o puntos a mano',
  kitchen: 'Cocina: ver comandas y pedidos y marcarlos listos',
  // Las tres primeras solo sirven al Administrador autorizado (las marca el dueño).
  view_dashboard: 'Ver el resumen general del negocio',
  view_finance: 'Ver las finanzas: ganancias, gastos y dinero disponible',
  manage_finance: 'Registrar retiros, gastos y el reparto del dinero',
  // Independiente: el dueño lo da a quien él quiera (encargado, administrador o empleado que compra).
  view_costs: 'Ver costos y márgenes de los productos',
} as const

export type Permission = keyof typeof PERMISSIONS
/** Funciones financieras: solo las puede tener un Administrador autorizado. */
export const FINANCE_PERMS: Permission[] = ['view_dashboard', 'view_finance', 'manage_finance']
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as [Permission, ...Permission[]]

/** Plantillas editables: solo son un punto de partida al crear un usuario. */
export const TEMPLATES: Record<string, { label: string; position: 'administrador' | 'encargado' | 'empleado'; permissions: Permission[] }> = {
  // El empleado no ve reportes ni ventas de otros: «ver reportes» lo autoriza el dueño aparte.
  // Nace sin ninguna función: el dueño marca una por una lo que puede ver y hacer.
  administrador: { label: 'Administrador autorizado', position: 'administrador', permissions: [] },
  cajero: { label: 'Cajero', position: 'empleado', permissions: ['sell', 'open_close_cash', 'customers_credit'] },
  encargado: {
    label: 'Encargado',
    position: 'encargado',
    permissions: ['sell', 'open_close_cash', 'cancel_discount', 'view_inventory', 'edit_inventory', 'view_reports', 'customers_credit', 'attendance', 'configure_catalog'],
  },
  barbero: { label: 'Barbero', position: 'empleado', permissions: ['sell', 'view_commissions'] },
  empleado_piso: { label: 'Empleado de piso', position: 'empleado', permissions: ['view_inventory', 'attendance'] },
  cocina: { label: 'Cocina', position: 'empleado', permissions: ['kitchen', 'attendance'] },
}
