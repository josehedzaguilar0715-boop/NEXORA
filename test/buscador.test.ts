import { describe, expect, it } from 'vitest'
import { buscar, norm, SINONIMOS } from '../web/src/buscar'

const it1 = (key: string, label: string, desc = '', modulo = 'Ventas') => ({ key, label, desc, modulo })
const TODAS = [
  it1('caja', 'Caja', 'Cobrar, abrir y cerrar caja, cortes'), it1('agenda', 'Agenda', 'Citas del día', 'Agenda'), it1('clientes', 'Clientes y fiado', 'Lista y saldo de fiado', 'Clientes'),
  it1('productos', 'Productos', 'Altas, precios, existencias y mayoreo', 'Inventario'), it1('compras', 'Compras', 'Lo que compras a proveedores', 'Inventario'),
  it1('finanzas', 'Finanzas', 'Estado de resultados, gastos', 'Dinero'), it1('usuarios', 'Personal', 'Empleados, permisos y horarios', 'Mi negocio'),
]

describe('buscador global: lógica de búsqueda', () => {
  it('ignora acentos y mayúsculas', () => {
    expect(norm('  CRÉDITO Día ')).toBe('credito dia')
    expect(buscar(TODAS, 'CLIENTÉS')[0]!.key).toBe('clientes')
  })
  it('encuentra por nombre, por sinónimo y por descripción, con el nombre primero', () => {
    expect(buscar(TODAS, 'caj')[0]!.key).toBe('caja')
    expect(buscar(TODAS, 'cita')[0]!.key).toBe('agenda') // sinónimo
    expect(buscar(TODAS, 'deuda').map((i) => i.key)).toContain('clientes')
    expect(buscar(TODAS, 'proveedor')[0]!.key).toBe('compras')
    expect(buscar(TODAS, 'empleado')[0]!.key).toBe('usuarios')
    expect(buscar(TODAS, 'mayoreo')[0]!.key).toBe('productos') // descripción
  })
  it('varias palabras: todas deben aparecer', () => {
    expect(buscar(TODAS, 'precio producto').map((i) => i.key)).toEqual(['productos'])
    expect(buscar(TODAS, 'cita gastos')).toEqual([])
  })
  it('vacío y sin coincidencias devuelven lista vacía; solo busca entre lo que se le da (permisos/giro ya filtrados)', () => {
    expect(buscar(TODAS, '')).toEqual([])
    expect(buscar(TODAS, 'zzzz')).toEqual([])
    const empleado = TODAS.filter((i) => !['finanzas', 'usuarios'].includes(i.key))
    expect(buscar(empleado, 'finanzas')).toEqual([])
    expect(buscar(empleado, 'gastos')).toEqual([])
  })
  it('cada pantalla conocida tiene sinónimos', () => {
    for (const k of ['caja', 'agenda', 'clientes', 'productos', 'compras', 'finanzas', 'reportes', 'usuarios', 'ajustes', 'configurar']) expect(SINONIMOS[k], k).toBeTruthy()
  })
})
