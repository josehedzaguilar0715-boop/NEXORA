import { useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Estado } from '../Estado'
import { ICONOS_GUIA, MODULOS, type Modulo } from '../modulos'
import { cambiarModo, modoActual, suscribirModo } from '../tema'

/** Guía visual (#/guia-visual): muestrario de colores, letra, estados y módulos del producto actual. No aparece en el menú. */
export function GuiaVisual() {
  const modo = useSyncExternalStore(suscribirModo, modoActual)
  return (
    <div className="guia">
      <div className="fila" style={{ justifyContent: 'space-between' }}>
        <div><h1>Guía visual</h1><p className="muted">Producto «{document.documentElement.dataset.product}» · modo {modo}</p></div>
        <button onClick={() => cambiarModo(modo === 'claro' ? 'oscuro' : 'claro')}>{modo === 'claro' ? <Moon size={18} aria-hidden /> : <Sun size={18} aria-hidden />} Cambiar a modo {modo === 'claro' ? 'oscuro' : 'claro'}</button>
      </div>
      <section className="card">
        <h2>Un color, un ícono y un nombre por módulo</h2>
        <div className="muestras">
          {(Object.keys(MODULOS) as Modulo[]).map((k) => { const M = MODULOS[k]; return <div key={k} className="muestra"><span className={`mod-ico mod-${k}`}><M.icono size={22} aria-hidden /></span>{M.nombre}</div> })}
        </div>
      </section>
      <section className="card">
        <h2>Estados: color + ícono + texto</h2>
        <div className="fila"><Estado tipo="ok">Pagado</Estado><Estado tipo="warn">Pendiente</Estado><Estado tipo="danger">Cancelado</Estado><Estado tipo="info">En proceso</Estado></div>
        <p className="okmsg" style={{ marginTop: 12 }}>Venta registrada correctamente.</p>
        <p className="error">No se pudo conectar con la terminal.</p>
      </section>
      <section className="card">
        <h2>Letra</h2>
        <div className="escala">
          <div><span style={{ fontSize: 'var(--fs-title)', fontWeight: 700 }}>Resumen del día</span><small>título 32 px</small></div>
          <div><span style={{ fontSize: 'var(--fs-subtitle)', fontWeight: 650 }}>Ventas por categoría</span><small>subtítulo 25 px</small></div>
          <div><span style={{ fontSize: 'var(--fs-data)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>$48,250.00</span><small>dato 30 px</small></div>
          <div><span>Selecciona un producto para ver su historial.</span><small>texto 20 px</small></div>
          <div><span style={{ fontSize: 'var(--fs-small)', color: 'var(--muted)' }}>Fecha de corte · ayuda</span><small>etiqueta 18 px</small></div>
        </div>
      </section>
      <section className="card">
        <h2>Botones y campos</h2>
        <div className="fila"><button className="primary">Cobrar</button><button>Exportar</button><button className="danger">Eliminar</button></div>
        <label style={{ marginTop: 12 }}>Nombre del producto<input placeholder="Escribe aquí" /></label>
      </section>
      <section className="card">
        <h2>Íconos del menú</h2>
        <div className="muestras">{ICONOS_GUIA.map(([n, I]) => <div key={n} className="muestra"><I size={22} aria-hidden />{n}</div>)}</div>
      </section>
    </div>
  )
}
