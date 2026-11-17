export const PERMISSIONS = {
  sell: 'Vender y cobrar',
  open_close_cash: 'Abrir y cerrar caja',
  cancel_discount: 'Cancelar o descontar (con código)',
  change_prices: 'Cambiar precios',
  view_inventory: 'Ver inventario',
  edit_inventory: 'Editar inventario y compras',
  view_reports: 'Ver reportes y finanzas (todos; solo lectura)',
  create_employees: 'Crear empleados',
  view_commissions: 'Ver comisiones',
  configure_catalog: 'Configurar productos o menú',
  customers_credit: 'Clientes y fiado',
  attendance: 'Asistencia',
} as const

export type Permission = keyof typeof PERMISSIONS
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as [Permission, ...Permission[]]

/** Plantillas editables: solo son un punto de partida al crear un usuario. */
export const TEMPLATES: Record<string, { label: string; permissions: Permission[] }> = {
  cajero: { label: 'Cajero', permissions: ['sell', 'open_close_cash', 'customers_credit', 'view_reports'] },
  encargado: {
    label: 'Encargado',
    permissions: ['sell', 'open_close_cash', 'cancel_discount', 'view_inventory', 'edit_inventory', 'view_reports', 'customers_credit', 'attendance', 'configure_catalog'],
  },
  barbero: { label: 'Barbero', permissions: ['sell', 'view_commissions', 'view_reports'] },
  empleado_piso: { label: 'Empleado de piso', permissions: ['view_inventory', 'attendance', 'view_reports'] },
}
