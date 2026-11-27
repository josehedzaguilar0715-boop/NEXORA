# 53 · Exportar inventario y clientes (Abarrotes Rosi y Barbería FENIX)

Sin migraciones, sin cambios de roles, permisos, planes ni precios. Solo lectura.

| Qué | Dónde | Quién | Formatos |
|---|---|---|---|
| Inventario completo | Productos → «Exportar inventario» (`GET /api/inventory/export`) | `view_inventory`; costos y valor solo con permiso de costos | Excel, CSV, PDF |
| Clientes + tarjeta de fidelidad + historial de sellos | Clientes → «Exportar clientes» (`GET /api/customers-export`) | `view_reports` (contiene teléfonos) | Excel (2 pestañas), PDF (2 secciones), CSV (`parte=clientes` o `parte=historial`) |

- Inventario: encabezados iguales a «Importar» (código de barras, nombre, categoría, unidad, precio, mayoreo, costo, existencia, mínimo) para llevarlo a otro sistema.
- Clientes: saldo de sellos/puntos, ganados, canjeados, último movimiento, premio disponible, próximo premio y cuántos faltan. Historial: fecha, hora (hora de México), cliente, movimiento, cantidad, saldo después, premio y quién lo registró. Nada se borra ni se modifica.
- Cada descarga queda en la bitácora (`inventario.exportado`, `clientes.exportado`).
- Código: `src/exportar.ts` (CSV/XLSX/PDF sin dependencias), `src/inventario-export.ts`, `src/clientes-export.ts`, `web/src/ExportarMenu.tsx`. Pruebas: `test/inventario-export.test.ts`, `test/clientes-export.test.ts` (archivos leídos con openpyxl, LibreOffice, `pdfinfo` y `pdftotext`).
- Se corrigió además un nombre de archivo mal formado en la primera versión del inventario.
