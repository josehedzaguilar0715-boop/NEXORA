# 47 · Informe final para autorización de publicación

**Candidato (congelado):** `70c85d7e91e00221c373e8bd96708d7fe85f7450` en `diseno-v0` (los commits posteriores solo agregan documentos y scripts de verificación; la aplicación no cambió).
**Producción hoy:** versión `34191efa`, esquema 48. **Migraciones a aplicar: ninguna.** No se publicó nada. No se generó ni instaló `BACKUP_KEY`.
**Estado de este documento:** completo (parte A de la madrugada y parte B de las 09:35 UTC). Veredicto al final.

## A. Validaciones completadas sin intervención de los dueños
| # | Validación | Resultado |
|---|---|---|
| 1 | Pruebas automáticas, tipos, punta a punta | 349/349, sin errores de tipos, e2e OK (doc 44) |
| 2 | Auditoría de 414 pantallas × claro/oscuro × escritorio/celular (demos de 13 giros) | 0 hallazgos en ambos modos |
| 3 | Páginas públicas, Super Panel, motor de Cloudflare local | 0 hallazgos; 12/12 en el motor real |
| 4 | Verificación externa de producción y staging (GitHub Actions, 03:54 UTC) | En verde |
| 5 | Errores en Cloudflare (producción, 6 h) | 1,176 eventos, **0 de nivel error** |
| 6 | Respaldo manual posterior al lanzamiento (`nexora-2026-11-25T03-56`) | Esquema 48, 11 negocios, 99 ventas (95 antes), 22 usuarios, 172 productos; **restaurado en base aislada**: integridad ok, 0 referencias rotas; nada perdido en tablas no vivas respecto al respaldo previo al lanzamiento (un dispositivo del mismo usuario renovó su suscripción de notificaciones: tabla viva) |
| 7 | Tabla `error_log` de la aplicación en ese respaldo | 0 filas (la aplicación no registró errores propios) |
| 8 | **Candidato sobre una copia de un respaldo real posterior al lanzamiento**: ensayo de migración/recorrido de API por negocio y puesto | Sin pérdida de renglones ni cambio de valores; integridad ok; 0 referencias rotas; reabrir idempotente; 11/11 dueños recorren Finanzas, panel, ventas, productos, clientes y automatizaciones de su giro sin error; 10/10 personal sin acceso financiero y con acceso operativo; ventas por negocio idénticas. *Tres comprobaciones del script fallan por diseño en una base ya en uso (esperan «migrar de 42 a 48», un reparto sin activar y columnas nuevas vacías): los dueños ya usaron funciones nuevas tras el lanzamiento — ver «Uso real observado»* |
| 9 | **Recorrido en navegador sobre esa copia real** (sesiones creadas solo en la copia; sin guardar capturas por tener datos privados): un dueño y un empleado/encargado por negocio, todas las pantallas de su menú, escritorio y celular, modo claro | **466 pantallas en modo claro y 466 en oscuro, 1 hallazgo en cada modo (el mismo, ver §B1)** |
| 10 | **Flujos de negocio sobre la copia real** (solo en la copia) en los negocios de barbería, uñas ×2 y abarrotes | **37 comprobaciones en verde**: abrir caja, vender un producto real al precio vigente, el inventario baja exactamente 1, cancelar pide autorización, cita real → «terminar» → pendiente de cobro → cobro en Caja → no se cobra dos veces, Finanzas «vendiste» no baja, caja consultable |
| 11 | Dependencias (`npm audit --omit=dev`) y búsqueda de secretos en el repositorio | 0 vulnerabilidades; ningún secreto encontrado |
| 12 | Cálculo de huella y formato de `BACKUP_KEY` contra el código | Verificado (ver doc 45 y conversación): 32 bytes base64, huella SHA-256 `XXXX-XXXX-XXXX` |

### Uso real observado tras el lanzamiento (del respaldo de las 03:56 UTC; solo cifras)
Acciones registradas: caja (arqueo ×2, corte ×1), reparto de Finanzas activado ×1 (el negocio de barbería activó el «Plan anterior»), pago de personal ×1, recordatorio de cita ×1, ajustes de fidelidad ×2, 2 ventas nuevas. Las funciones nuevas de la versión publicada ya se están usando por los negocios **sin errores** (0 en `error_log`, 0 en Cloudflare).

### B1. Hallazgo del recorrido real (severidad baja, cosmético, **ya existe en producción**)
En celular, **Ajustes** del dueño de la barbería desborda 16 px horizontalmente porque el enlace de reservas (`https://…/reservar/<enlace>`) es una palabra larga que no se parte. Es del código ya publicado (bloque «Link de reservas» de Ajustes) y el candidato añade una línea parecida en «Mi escaparate». No afecta datos ni funciones; la página sigue usable. La corrección es una regla de CSS (`overflow-wrap: anywhere`) y **no la apliqué** porque pediste no modificar el candidato: queda a tu decisión (cambiaría el commit a publicar y exigiría repetir las verificaciones).

## Limitaciones que no se pueden comprobar sin los dueños
- Iniciar sesión con las credenciales reales de FENIX (barbería), Nails y abarrotes y ver sus pantallas con **su** dispositivo, red y navegador.
- Operar su caja real (por diseño no se crearon ventas ni citas reales).
- Comparar a ojo sus totales y existencias con lo que ellos esperan.
Mitigación: el recorrido #9 y los flujos #10 usan **sus datos reales** (copia del respaldo) con el código candidato, por puesto y por pantalla; la diferencia que queda es el entorno del dispositivo. Tras publicar, la verificación posterior y la observabilidad detectan errores en minutos, y la reversión es solo código.

## Pendiente (única tarea para mañana)
**Instalar `BACKUP_KEY`** (≥ 09:40 UTC, después de la comparación automática) con el procedimiento de PowerShell y el panel de Cloudflare (doc 45 y conversación), y luego: huella igual, respaldo nuevo `.json.gz.enc`, restauración aislada con la llave. No bloquea la publicación del candidato (el cifrado es independiente del código).

## Plan de despliegue y reversión
Sin cambios respecto de los docs 44 §12–13: respaldo fresco ≤ 24 h (existe el de las 03:56 UTC y el de las 09:17) → `npm run deploy:prod` → «Verificar despliegue» + observabilidad 30–60 min → reversión con `wrangler rollback` a `34191efa` si hay errores > 1 %, fallo de inicio de sesión, Caja/Agenda con errores o `schema ≠ 48`. Los datos nuevos del candidato (`perfil`, `planoMesas`, `imagenUrl`) son claves adicionales que la versión anterior ignora.

## B. Resultados automáticos de las 09:35 UTC y veredicto
**Ejecutado automáticamente el 25-nov 09:35–09:45 UTC (solo lectura).**
| Comprobación | Resultado |
|---|---|
| Respaldo automático de las 09:17 UTC (`nexora-2026-11-25T09-17.json.gz`) | Existe, sin cifrar (la llave aún no está instalada), gzip válido, esquema 48 |
| Comparación contra el respaldo previo al lanzamiento | Esquema 42 → 48; negocios 11 → 11, usuarios 22 → 22, productos 172 → 172, ventas 95 → 99. Única tabla marcada: `push_subscriptions` (un dispositivo del mismo usuario renovó su suscripción: tabla viva, benigno). Ninguna otra pérdida |
| Comparación contra el respaldo manual de las 03:56 UTC | **Nada se perdió ni se alteró** (solo tablas vivas) |
| Restauración aislada del respaldo de las 09:17 | Integridad ok, 0 referencias rotas, 11 negocios, 99 ventas, esquema 48, `error_log` con 0 filas |
| Verificación externa (GitHub «Verificar despliegue», ejecución 7, 09:36 UTC) | **Producción y staging en verde** |
| Errores en Cloudflare, producción, últimas 12 h | 1,305 eventos, **0 de nivel error** |
| Recorrido en navegador sobre la copia real, modo oscuro | 466 pantallas; el único hallazgo es el mismo desborde cosmético de Ajustes (§B1) |

### VEREDICTO: **LISTO PARA AUTORIZAR**
Sin pérdidas críticas, restauración aislada correcta, producción y staging en verde, 0 errores nuevos, 0 migraciones. Condiciones que **no** se pudieron cubrir y se aceptan como limitación documentada: sesiones con credenciales reales de los dueños (§Limitaciones). Único pendiente para el dueño: instalar `BACKUP_KEY` (no bloquea la publicación).
Candidato a publicar: `70c85d7e91e00221c373e8bd96708d7fe85f7450`.
