# Informe de cierre definitivo de la actualización de NEXORA

Fecha: 24 nov 2026. Rama `modernizacion`. **Producción sin cambios** (`efb75ff`, versión `2c16921e`). **Nada publicado.**

Este informe cierra los 10 puntos del pedido de cierre. Los detalles de cada punto están en los documentos `12` a `14` de esta carpeta. El trabajo de las fases 1 a 9 está en `11-informe-final.md`.

## 1. Qué quedó terminado

| # | Punto | Resultado |
|---|---|---|
| 1 | **Cifrado de respaldos** | Listo para activarse. Hay script para generar la llave en tu computadora (`npm run backup:key`), una **huella** para confirmar cuál llave está activa sin mostrarla, y el estado visible en el super panel. Activarlo en producción requiere tu autorización y que guardes la llave (`12-respaldos-y-recuperacion.md` §2). |
| 2 | **Restauración y recuperación** | Restauración **dentro de Cloudflare** en un objeto vacío (nunca sobre datos existentes), **probada en el motor de Cloudflare**: 98 tablas, 503 renglones, **0 diferencias**. Procedimientos escritos para tres casos: revisar en una computadora, pérdida total y volver de versión. |
| 3 | **Push, SMS, correo e impresoras** | Probado todo lo que se puede sin equipos: formato exacto de Twilio y Resend, firma VAPID verificada criptográficamente e impresión en PDF de 58 y 80 mm. Lo que falta está listado con exactitud en §4. |
| 4 | **Carga y límites reales** | Medidos (§3). Se encontró y corrigió un **cuello de botella grave**. |
| 5 | **Multiempresa, aislamiento, sucursales y permisos** | Barrido de **87 listas y reportes** más **~90 rutas con id**: ningún negocio ve datos de otro. Más de 100 rutas con permiso revisadas. **Sucursales:** dentro de un mismo negocio, la sucursal asignada hoy **no limita** lo que el empleado ve ni lo que el encargado edita (comprobado con una prueba real). La recomendación por rol (dueño, administrador, encargado y empleado) está en `16-permisos-por-sucursal.md`; implementarla queda a tu decisión. |
| 6 | **Los 14 productos** | Son la base «NEXORA» más los 13 de giro; ninguno faltaba en la lista. **Lo pendiente real:** las páginas públicas que ve el cliente final (reservar, boletos, tarjeta de sellos) salían con la identidad genérica. Ya muestran la del negocio. Los 14 se verificaron en el navegador. |
| 7 | **Base compartida** | Estrategia por etapas y reversible. Ya hechas y probadas las piezas que no tocan datos: índices, clasificación de las 102 tablas, extracción por negocio con suma exacta en los 13 giros, y restauración en un objeto aparte (`14-estrategia-de-crecimiento.md`). |
| 8 | **Aviso de privacidad** | El código ya no trae tu correo personal. El correo del negocio se captura en *Super panel → Ajustes*. Mientras no se capture, el aviso indica el buzón de Soporte y **no inventa ninguna dirección**. |
| 9 | **Versiones** | **Producción = commit `efb75ff` exacto**: los 35 archivos de la app desplegada coinciden 1 a 1 con su compilación. Staging = `a04435ff` (ver §6). Reversión probada con datos (§7). |
| 10 | **Verificación final** | Ver §3. |

## 2. Errores encontrados y corregidos

| # | Error | Gravedad | Corrección | Prueba que lo cubre |
|---|---|---|---|---|
| 1 | **Faltaban índices por negocio y fecha.** Con 40 negocios y 39,285 ventas, el panel de Inicio tardaba **3.1 s** y bloqueaba la base para **todos** los negocios mientras tanto. | **Alta**: muro a partir de unas decenas de negocios | Migración 40, que **solo agrega índices**. El panel bajó a **13.7 ms**, el reporte diario de 666 a 4 ms y el resumen de 151 a 1.4 ms. | `bench-panel.ts` |
| 2 | Las pantallas consultaban al servidor cada 8 a 60 s **aunque estuvieran ocultas** (otra pestaña, celular bloqueado). | Media (carga de fondo) | Solo consultan mientras están a la vista y se actualizan al volver. | revisión de código + `npm run check` |
| 3 | **El ticket no cabía en 58 mm**: cada renglón se partía en dos y salía una hoja en blanco. | Media (negocios con impresora) | Letra calculada para 32 columnas en 48 mm, en una sola hoja. | `impresion.cjs` |
| 4 | **Los boletos de la taquilla se imprimían en blanco.** | Media (turístico) | Cada botón imprime exactamente lo suyo. | `impresion.cjs` |
| 5 | La taquilla ofrecía **horarios que ya habían pasado** y luego rechazaba la venta. | Baja | Aparecen como «Ya pasó», desactivados. | `turistico.test.ts` |
| 6 | Si Twilio o Resend fallaban, el dueño veía «Ocurrió un error» (500). | Media | Mensaje claro, código 502, y el detalle en los registros. | `proveedores-externos.test.ts` |
| 7 | En el super panel, si fallaba el SMS **no se intentaba el correo**. | Media | Canales independientes. | mismo |
| 8 | Un servicio de push caído podía **cortar los avisos a los demás** celulares. | Baja | Cada envío es independiente. | mismo |
| 9 | Al restaurar en un objeto nuevo, la sesión de soporte de ese objeto quedaba huérfana y **la restauración completa se rechazaba**. | Media (recuperación) | Se quitan solo esas sesiones del objeto vacío. | `respaldos.test.ts` (falla sin la corrección) |
| 10 | Las páginas públicas no usaban la identidad del negocio. | Baja | Aplican la identidad por giro. | `enlaces-publicos.test.ts` + `productos14.cjs` |
| 11 | El correo personal estaba en el aviso de privacidad (público). | Media (privacidad) | Correo configurable; ninguno escrito en el código. | `superpanel.test.ts` |

## 3. Pruebas ejecutadas y resultados

En la columna Tipo: **automática** = base de prueba en memoria; **navegador** = Chromium real contra servidor local; **workerd** = el motor de Cloudflare en local; **solo lectura** = consulta a Cloudflare sin cambiar nada.

| Prueba | Tipo | Resultado |
|---|---|---|
| `npm run check`: tipos, **254 pruebas en 52 archivos**, compilación y prueba de punta a punta (31 pasos) | automática + navegador | ✅ todo pasa |
| Los 14 productos: identidad al entrar, páginas públicas (reservas, boletos, tarjeta) y la base en acceso y super panel | navegador | ✅ **TODO OK** (`productos14.cjs`) |
| Recorrido profundo: 13 giros × dueño y empleado × celular y computadora | navegador | ✅ **Sin hallazgos**: sin errores de JS ni de servidor, ni desbordes |
| Flujos completos de 6 giros (`giros6.cjs`) | navegador | ✅ **43/43 en computadora y 43/43 en celular**: comedor 6, palapa 6, perfumería 10, taquería 7, uñas 9 y verdulería 5 pasos en cada tamaño; 0 fallas |
| Impresión: ticket y corte X en 58 y 80 mm, boletos con QR | navegador (impresora simulada en PDF) | ✅ 1 hoja cada uno, renglones completos, QR presentes |
| Carga, una sola base, 1 conexión | workerd | venta p50 12 ms; panel 24 ms; 0 errores |
| Carga, 30 conexiones simultáneas, 4 negocios | workerd | **~98 peticiones/s**, p95 403 ms, **0 errores, todas las ventas cuadran** |
| Base grande: 40 negocios, 39,285 ventas | automática | panel 3,122 → **13.7 ms** con los índices |
| Respaldo cifrado → descarga → restauración en un objeto vacío | workerd | ✅ 98 tablas, 0 diferencias; el dueño entra con su contraseña |
| Restaurar sobre una base con negocios | workerd + automática | ✅ se rechaza sin tocar nada |
| **Actualización**: base creada con el código de producción (8 negocios con datos) → versión nueva | servidor local | ✅ migraciones 35 a 40 aplicadas, **0 diferencias** en ventas, renglones, pagos, inventario, fiado y lotes |
| **Reversión**: esa base ya migrada, abierta con el código de producción | servidor local | ✅ entra, vende, abona, registra gasto, reporta y hace corte Z con diferencia 0 |
| 13 demos en el motor de Cloudflare | workerd | ✅ **TODO OK** (las 13, con todas sus pantallas) |
| Separar por negocio: 13 giros, suma exacta y cada negocio solo da el mismo resumen | automática | ✅ |
| Versión de producción contra el commit `efb75ff` | solo lectura | ✅ 35 de 35 archivos idénticos |
| Staging con esta versión | staging | ✅ versión `f9c3271f-0bc9-4679-88a7-253911d22e17`, desplegada en **staging** (no en producción) desde el mismo código de la rama. Prueba repetida el 24 nov: comprobaciones de dinero **7/7**; carga pequeña (2 negocios, 200 peticiones, 5 simultáneas) con mediana de 89 ms y p95 de 136 ms medidos desde aquí, **0 errores**, todas las ventas cuadran. |

## 4. Lo que sigue pendiente (depende de equipos, credenciales o decisiones tuyas)

| Pendiente | Qué hace falta | Costo |
|---|---|---|
| **Publicar en producción** | Tu autorización expresa | $0 |
| **Activar el cifrado de respaldos** | Generar la llave en tu computadora, guardarla y ponerla como secreto (`12-…` §2) | $0 |
| **Correo del aviso de privacidad** | Un correo del negocio que tú elijas, capturado en el super panel | $0 (o el costo de tu dominio) |
| SMS reales | Cuenta de Twilio con número para México | ~$0.80 a $1.50 MXN por SMS |
| Correos reales (respaldo al correo, segundo paso del super panel) | Cuenta de Resend y un **dominio propio** verificado | Gratis hasta ~3,000 al mes; el dominio, ~$200 a $400 MXN al año |
| Push en un teléfono real | Un Android con Chrome, o un iPhone con iOS 16.4 o más reciente y la app agregada al inicio | $0 |
| Impresora térmica real | La impresora del negocio con su controlador; en el diálogo, papel = rollo y márgenes = ninguno | $0 |
| Separar la base por negocio (etapas 4 a 6) | Tu decisión; desarrollo de ~1.5 semanas | $5 USD/mes al pasar al plan de pago (a partir de ~30 a 100 negocios) |
| **Permisos por sucursal** (`16-permisos-por-sucursal.md`) | Tu decisión. Hoy un empleado ve la información de todas las sucursales de su negocio, y el encargado puede editar el inventario de otra sucursal. Se recomienda limitar a su sucursal y crear el rol Administrador; serían 2 a 3 días. | $0 |
| Cajón de dinero, báscula conectada, impresión por Bluetooth sin diálogo | No existen hoy; serían mejoras nuevas | — |
| El correo personal sigue en el **historial** de git (commits viejos) | Borrarlo del historial requiere reescribirlo (destructivo). No se hizo: decisión tuya. | — |

## 5. Riesgos que quedan

1. **Sucursales:** en negocios con más de una sucursal, cualquier empleado ve la información de todas y el encargado puede ajustar el inventario de otra sucursal. No afecta a negocios de una sola sucursal ni cruza entre negocios. Ver `16-permisos-por-sucursal.md`.
2. **Una sola base para todos los negocios.** Con los índices alcanza para ~100 a 150 negocios. Para 500 hay que separarla (§7 de la estrategia). El super panel avisa al 70 % y al 85 % del espacio.
3. **Respaldos sin cifrar en producción** hasta que actives la llave. Si pierdes la llave después de activarla, los respaldos cifrados no se recuperan.
4. **Cuota compartida** entre staging y producción en el plan gratis (100,000 peticiones y 100,000 escrituras al día). Una prueba de carga fuerte contra staging podría afectar a producción; por eso no se hizo.
5. **Cambio de comportamiento al publicar:** ya no se permite sacar de la caja más efectivo del que hay (compras, gastos, devoluciones, cancelaciones). Conviene avisar a los 3 negocios.
6. **Cambio visual leve** en los 3 negocios (identidades de la Fase 5; Nails, un tono de gris).
7. Push, SMS, correo e impresión **no verificados con equipos reales** (§4).

## 6. Versión exacta lista para publicar

* **Rama `modernizacion`. Código final: commit `ef0fc48`.** Los commits posteriores solo agregan documentación; publicar el último commit de la rama es equivalente. Staging (`f9c3271f`) se desplegó desde ese mismo código.
* Migraciones de base: **hasta la 40**. Todas solo agregan. La 40 crea índices: en una base del tamaño actual (~1 MB) tarda menos de un segundo.
* Staging tiene esta misma versión: `f9c3271f-0bc9-4679-88a7-253911d22e17`, desplegada el 24 nov.

**Para publicar** (solo con tu autorización expresa):

1. Confirmar que exista el respaldo del día en producción.
2. `git checkout <commit> && npm ci && npm run deploy:prod`.
3. Revisar los registros 15 minutos.
4. Entrar a cada uno de los 3 negocios.
5. Activar `BACKUP_KEY` y capturar el correo del aviso de privacidad.

## 7. Cómo volver atrás sin perder datos

**Forma 1, la más rápida (no compila nada):**

```bash
npx wrangler rollback 2c16921e-6ccb-41c8-8399-1069ca9a8ca3 --env production -m "Volver a la versión anterior"
```

**Forma 2, desde el código:**

```bash
git checkout efb75ff && npm ci && npm run deploy:prod
```

**Por qué no se pierden datos:**

* Ninguna de las dos formas toca la base.
* Las tablas y columnas nuevas (migraciones 35 a 40) quedan sin uso y el código anterior las ignora.
* **Esto se probó:** la base migrada abierta con el código de producción vendió, abonó, registró un gasto, reportó y cerró caja sin errores.
* Lo que se haya registrado con funciones nuevas (por ejemplo, pagos de comisiones o devoluciones a proveedor) se conserva en la base. La versión anterior simplemente no lo muestra.

**Si además hubiera daño en los datos** (no esperado): seguir `12-respaldos-y-recuperacion.md` §4.B. Se restaura en un objeto nuevo sin borrar el anterior.
