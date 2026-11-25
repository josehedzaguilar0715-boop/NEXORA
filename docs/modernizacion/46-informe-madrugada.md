# 46 · Informe de la madrugada del 25-nov (estado y decisión de publicación)

Candidato congelado: `70c85d7e91e00221c373e8bd96708d7fe85f7450` (diseno-v0). Producción: versión `34191efa`, esquema 48. **Nada se publicó. No se generó ni instaló ninguna llave.**

## Estado a las 04:12 UTC
| Condición | Estado |
|---|---|
| Pruebas del candidato (349 pruebas, e2e, 414 pantallas × 2 modos, páginas públicas, Super Panel, motor Cloudflare local) | Completas y en verde (doc 44) |
| Ensayo de migración | No aplica: 0 migraciones; ensayo repetido en verde |
| Producción responde (acción «Verificar despliegue», producción y staging) | En verde a las 03:54 UTC |
| Errores en producción (observabilidad Cloudflare, `nexora`, últimas 6 h) | 1,176 eventos, **0 de nivel error** |
| Respaldo manual posterior al lanzamiento (`nexora-2026-11-25T03-56`) | **Verificado**: gzip válido, esquema 48, 11 negocios, 99 ventas (95 antes), 22 usuarios, 172 productos; restaurado en una base aislada: integridad ok, 0 referencias rotas. Comparado con el respaldo pre-lanzamiento: nada perdido en tablas no vivas; en `push_subscriptions` un dispositivo se volvió a suscribir (1 quitada, 1 nueva del mismo usuario: comportamiento normal) |
| Respaldo automático de las 09:17 UTC y su comparación | Pendiente; tarea programada a las 09:35 UTC (solo lectura, escribe en este documento) |
| `BACKUP_KEY` | Pendiente por decisión del dueño: se instala **después** de la comparación (≥ 09:40 UTC). No la genero ni la instalo yo |
| Checklist de sesiones reales de barbería, Nails y abarrotes | **Pendiente** (requiere a cada dueño) |

## Decisión: NO publicar ahora
La versión no tiene defectos conocidos y publicar/revertir es solo código, pero **no puedo demostrar que sea segura para los tres negocios activos** mientras falten: (1) la validación con sesiones reales de esos tres negocios, que no puedo ni debo hacer yo y que no ocurre durante la noche; (2) la comparación del respaldo automático posterior al lanzamiento. Además, no hay autorización expresa de publicación. Cuando (1) y (2) estén en verde se presenta el informe final con la única pregunta de autorización.

## Automatizado (sin intervención)
Tarea programada `trig_01JWjjYW1vJGh9bz28m1D69e` a las 09:35 UTC: baja el respaldo de las 09:17 (si ya fuese `.enc` solo comprueba la firma, sin abrirlo), lo compara, restaura en carpeta aislada, vuelve a ejecutar «Verificar despliegue», consulta errores en Cloudflare y agrega las cifras a este documento. Solo lectura; no publica ni toca llaves, datos o configuración.

## Riesgos detectados
- Bajo: la comparación de hoy solo se puede hacer si el respaldo de las 09:17 sigue sin cifrar → por eso la llave se instala después.
- Medio: validación con negocios reales sin hacer (riesgo de que algo propio de sus datos no aparezca en demostraciones).
- Bajo: si la llave se pega mal, los respaldos fallan (no se guardan sin cifrar); se revisa la huella al instalar y se retira el secreto si falla.
- Pendiente de seguridad existente: respaldos sin cifrar hasta instalar la llave.

## Resultado de las 09:35 UTC (tarea programada)
- Respaldo automático de las 09:17 UTC: esquema 48, 11 negocios, 99 ventas; restaurado en base aislada (integridad ok, 0 referencias rotas).
- Comparado con el previo al lanzamiento y con el manual de las 03:56: nada perdido (solo `push_subscriptions`, tabla viva, por renovación de suscripción de un dispositivo).
- «Verificar despliegue» (producción y staging): verde. Cloudflare, 12 h: 1,305 eventos, 0 errores.
- Recorrido sobre la copia real en claro y oscuro: 466 pantallas por modo, único hallazgo cosmético preexistente (Ajustes, celular).
- **Veredicto: LISTO PARA AUTORIZAR** (detalle en el doc 47). Pendiente solo: `BACKUP_KEY`.
