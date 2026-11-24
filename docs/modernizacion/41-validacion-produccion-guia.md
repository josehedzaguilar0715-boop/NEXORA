# 41 · Validación de producción: guía paso a paso y estado

Producción: versión `34191efa`, esquema 48 (publicada 24-nov-2026 22:50 UTC). **Regla de esta etapa: solo lectura y respaldos. Sin migraciones, sin restauraciones ni rollback, sin cambiar planes, precios ni permisos, sin servicios nuevos.** Lo que cada paso marca como «tú» requiere tus credenciales (yo no las tengo ni debo pedirlas); lo marcado «yo» lo verifico desde aquí en solo lectura cuando me avises.

## Estado al 24-nov 23:20 UTC (verificado por mí)
| Punto | Resultado |
|---|---|
| 1 Producción en esquema 48 | ✅ «Verificar despliegue» (GitHub, desde internet) en verde **dos veces** (22:50 y 23:18 UTC): salud `ok`, **esquema 48**, pantalla y app cargan, credenciales falsas rechazadas, rutas protegidas, ruta interna de respaldos inalcanzable, encabezados de seguridad |
| 6 Errores en producción | ✅ **0 errores** en el registro de Cloudflare entre las 22:40 y las 23:20 UTC (37 eventos: 200, 401/404 esperados de las propias verificaciones y dos respuestas 201). **Hay actividad real de negocios ya con la versión nueva**: a las ≈23:15 UTC entraron peticiones de avisos y «hoy» y se registró una operación con respuesta 201 (alta/venta), sin ningún error |
| 5 Comparación de respaldos del 25-nov | ⏳ **Aún no ocurre**: el respaldo automático de las 09:17 UTC del 25-nov (3:17 a. m. México) todavía no existe. La tarea programada corre a las **09:35 UTC** y reportará. Los respaldos actuales son todos esquema 42 |
| 2, 3, 4 | Requieren tus credenciales: pasos abajo |

## Paso A · Salud del sistema (tú, 2 min)
1. Entra al **Super Panel** (`/admin`) con tu usuario de soporte → **Ajustes → Salud del sistema**.
2. Debe decir **«Todo en orden»**, versión de esquema **48 = 48**, sin errores nuevos, sin ventas con total distinto de sus pagos.
3. Si algo sale en amarillo/rojo, **no hagas nada más**: mándame el texto de la línea afectada.

## Paso B · Respaldo manual posterior al lanzamiento (tú crea, yo comprobé)
1. Super Panel → **Ajustes → Respaldos → Crear respaldo ahora** (no cambia datos).
2. Avísame («listo»). **Yo** descargo el archivo nuevo del almacén de respaldos (solo lectura), compruebo que es esquema 48 y que se restaura **en una base aislada**, y lo comparo con el de antes del lanzamiento (`comparar-respaldos.ts`): los 11 negocios deben conservar usuarios, productos, ventas, clientes, turnos y demás (solo cambian las ventas nuevas del día).
3. Este respaldo **sin cifrar** queda como red de seguridad ya en esquema 48. **No lo borres.**

## Paso C · BACKUP_KEY y cifrado (tú, 10 min; sin riesgo para respaldos anteriores)
Los respaldos anteriores **siguen sin cifrar y legibles**: instalar la llave **no los toca** (solo cifra los **nuevos**). Se borran solos a los 30 días; no los elimines antes.
1. En tu computadora: `npm run backup:key` → muestra una **llave nueva y su huella** (no la guarda en ningún lado). Alternativa: `openssl rand -base64 32`.
2. **Guárdala en dos lugares** (gestor de contraseñas + papel). **Si se pierde, los respaldos cifrados no se recuperan.** Nunca me la envíes ni la pegues en un chat.
3. `npx wrangler secret put BACKUP_KEY --env production` y pega la llave. (Cloudflare publica una versión con el secreto; no cambia código ni datos; puede haber un corte de segundos.)
4. Super Panel → Ajustes → Respaldos debe mostrar **«🔒 Cifrados. Huella: XXXX-XXXX-XXXX»** y la huella debe coincidir con la del paso 1 (`npm run backup:key -- --huella` te la muestra desde tu llave guardada).
5. **Crear respaldo ahora** otra vez: el archivo nuevo debe terminar en **`.json.gz.enc`**. Avísame: **yo** compruebo en solo lectura que el archivo está cifrado (ilegible como texto, firma `NXE1`) y que **no** se abre sin la llave.
6. **Tú** compruebas que se restaura con la llave: `NEXORA_BACKUP_KEY=<tu llave> npx tsx scripts/restore.ts respaldo.json.gz.enc nueva.db` (carpeta nueva; debe funcionar). Con otra llave o sin ella debe **fallar**. Después puedes correr `npx tsx scripts/verificacion/ensayo-respaldo.ts respaldo.json.gz.enc <carpeta-nueva>`.
Hasta completar 4–6, **no se declaran protegidos** los respaldos.

## Paso D · Sesiones reales de los negocios autorizados (tú / cada dueño; **solo lectura**, sin crear ventas)
Para cada negocio autorizado, con su dueño presente. Marca ✔/✘ y anota solo lo que falle.
| # | Qué | Debe pasar |
|---|---|---|
| 1 | **Iniciar sesión** como dueño (y como un empleado) | Entra con su usuario y contraseña de siempre; sin pedir nada nuevo |
| 2 | **Inicio** | Dueño: panel completo. Empleado: «Mi día». Encargado: «Mi día» + «Mi sucursal hoy» |
| 3 | **Ventas / Caja** | Las **ventas anteriores** siguen en «Ventas del turno» / Tickets del día; los totales y la caja abierta (si hay) coinciden con lo que tenían. **No registres una venta de prueba en un negocio real**; si necesitas probar cobro, usa un negocio de demostración |
| 4 | **Finanzas → Mi dinero** (dueño) | Se abre sin error; «Vendiste/Entró» coinciden con sus reportes; «Reparto» muestra solo **«Plan anterior» (Histórico)**, nada activo; «Saldos» vacío (tú decides si registras saldo inicial) |
| 5 | **Productos e inventario** | Mismos productos y existencias que antes; el encargado/empleado ya **no ve costos** (hasta que marques «Ver costos y márgenes») |
| 6 | **Clientes** | Lista, saldos de fiado y ficha igual que antes |
| 7 | **Permisos** | Empleado/encargado no ven Finanzas ni «Ventas» con utilidad; entrar a `#/finanzas` no muestra cifras |
| 8 | **Sucursales** (si tiene varias) | Cada encargado ve solo su sucursal; el dueño ve todas |
| 9 | **Celular** | Las pantallas se ven completas, sin cortes |
Si algo falla: **no corrijas ni restaures**; mándame negocio (sin datos privados), pantalla y mensaje. Con una razón comprobada y tu autorización decidimos.

## Paso E · Confirmación de la comparación del 25-nov (yo)
A las 09:35 UTC del 25-nov (o cuando me avises) descargo el respaldo automático (esquema 48), lo comparo con el previo y reporto cifras. Resultado esperado: 11 negocios con todos sus usuarios, productos, ventas anteriores y configuraciones intactos.

## Criterios para llamar «estable» a NEXORA
1. Salud «Todo en orden», esquema 48, sin errores nuevos (A + registro de errores).
2. Respaldo manual posterior verificado y restaurable (B).
3. Comparación del respaldo del 25-nov sin pérdida (E).
4. Sesiones reales sin fallas de datos ni permisos (D).
5. BACKUP_KEY verificada (C) — recomendable pero no bloquea el uso diario.
