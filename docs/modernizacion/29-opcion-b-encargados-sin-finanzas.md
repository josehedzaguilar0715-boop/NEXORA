# 29 · Opción B: los encargados ya no ven el panel general ni las finanzas

Decisión del propietario (24 nov 2026). Rama `diseno-v0`. Sin publicar; sin tocar producción.

## Qué cambió
- `canFinance()` (src/context.ts): **encargado y empleado → siempre falso** para panel, finanzas y mover dinero. Solo dueño y Administrador autorizado (con el permiso marcado por el dueño).
- Aplica a las mismas rutas del documento 28 (panel, reportes, gastos, contabilidad, bitácora, valor de inventario, tendencia) y a todo `/finanzas/*`. En pantalla: Inicio muestra «Mi día»; Finanzas y Ventas desaparecen del menú; entrar por la dirección no muestra cifras.

## Qué NO cambió
- Ningún usuario se eliminó ni cambió de puesto; **ningún permiso guardado se modificó** (no hay migración). El encargado conserva `view_reports`, `cancel_discount`, etc. En la práctica `view_reports` solo le sirve ya para ver las ventas de su sucursal.
- Funciones operativas y de supervisión de su sucursal: caja, ventas de la sucursal, productos e inventario, clientes y fiado (lista), comisiones/personal según sus permisos.

## Consecuencias a tener presentes
- El encargado ya no ve la pantalla «Ventas» (trae utilidad) ni la lista de gastos. Si necesita supervisar totales de venta de su sucursal sin utilidad, habría que crear un resumen sin utilidades (no hecho).
- **Costos de productos:** el encargado sigue viéndolos mientras tenga permisos de inventario, porque compra y fija precios. Si quieres ocultarlos también, es una decisión aparte.
- Reversible: basta restaurar la rama del encargado en `canFinance()`.

## Pruebas (A = automatizada, N = navegador, datos de prueba)
- A: `administrador-y-finanzas-acceso.test.ts` — dueño 200 en las 10 rutas financieras; **encargado 403** en ellas y en `/finanzas/*`, `/accounting/*`, `/fixed-expenses`; encargado 200 en `/sales`, `/products`, `/shifts/current`, `/customers`, `/receivables`, `/dashboard/mine`; su puesto y permisos intactos; administrador sin permisos 403 y con permisos solo lo marcado; empleado 403 siempre.
- A: `finanzas-inteligentes.test.ts` (matriz de los 4 puestos en `/finanzas/*`), `puestos-*`, `permisos-reportes` actualizados a la nueva regla. Suite: 313/313.
- N: `scripts/verificacion/mi-dinero.ts` — dueño, administrador con «ver finanzas» (sin botón de retiros), empleado y **encargado** (menú sin Finanzas, Inicio «Mi día», `#/finanzas` sin cifras), escritorio y celular, más auditoría de contraste/letra/desborde.
