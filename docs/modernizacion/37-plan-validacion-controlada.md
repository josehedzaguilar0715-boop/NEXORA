# 37 · Plan de validación controlada con negocios de prueba

**Principio:** nada de producción. No se importan, copian ni consultan datos de negocios reales; no se publica nada (la publicación requiere tu autorización expresa). Todo ocurre en un entorno separado con negocios creados para la prueba.

## Entorno
- **Datos:** negocios de **demostración** (Super Panel → Demos, 13 giros, se pueden reiniciar) o negocios de prueba nuevos con datos ficticios. Teléfonos y nombres inventados.
- **Dónde:** instancia de **staging** o ejecución local de la rama `diseno-v0` con base vacía; nunca la base de producción ni una copia de ella. Restaurar respaldos de producción en staging **no** se hace sin autorización.
- **Personas:** el equipo interno y, si lo autorizas, 2–3 dueños voluntarios usando **cuentas de prueba** con datos ficticios (no sus datos).
- **Costos:** ninguno (sin proveedores de mensajes ni pasarelas).

## Qué se valida (por giro piloto: barbería, uñas, abarrotes, restaurante/taquería, ferretería o perfumería)
| Área | Escenarios | Criterio |
|---|---|---|
| Roles | Dueño, administrador autorizado, encargado, empleado intentan entrar a cada pantalla y por URL directa | 403/ausencia donde corresponde (matriz de `permisos-rutas.ts`) |
| Caja | Venta efectivo/tarjeta/mixta, fiado, descuento con código, cancelación, corte X/Z con diferencia | Totales cuadran con lo contado |
| Agenda | Cita por mostrador y por link, confirmar, terminar, cobrar en Caja, no asistió, reprogramar | Sin cobros dobles; Finanzas refleja el cobro |
| Finanzas | Saldo inicial, conciliación, reparto propio, retiro con motivo, «puedes retirar» | Números explicables con «¿cómo se calcula?» |
| Automatizaciones | Con datos completos, incompletos y vacíos | Sin recomendaciones cuando faltan datos |
| Tickets | Impresión (protocolo doc 36), reimpresión, comprobante digital | Caso por caso del protocolo |
| Dispositivos | Computadora, tableta, celular; claro y oscuro | Sin desbordes; texto legible; flujos completos |

## Método (2 semanas)
1. **Semana 0 – preparación:** crear negocios piloto; cargar productos/servicios ficticios; checklist de roles.
2. **Semana 1 – uso guiado:** guion diario por giro (abrir caja, 10–20 ventas simuladas, 3 citas, un retiro, un corte). Cada tarea se cronometra y se anota si hubo duda.
3. **Semana 2 – uso libre:** la persona usa el sistema como en su negocio (con datos ficticios) y anota fricciones.
4. **Cierre:** reunión, lista de defectos priorizados (bloqueante / molesto / sugerencia).

## Medidas de éxito (decididas antes de empezar)
- 0 defectos bloqueantes abiertos; 0 fugas de datos entre roles o negocios.
- El 80 % de las tareas del guion se completa sin ayuda, en el tiempo esperado (p. ej. venta ≤ 30 s, cobro de cita ≤ 45 s).
- Las cifras de Finanzas coinciden con el cálculo manual del guion en el 100 % de los casos.
- Satisfacción: el voluntario entiende «Mi dinero» sin explicación (pregunta de comprensión).

## Registro y seguridad
- Bitácora de pruebas (fecha, persona, caso, resultado, evidencia). Sin datos personales reales; capturas con datos ficticios.
- Cualquier incidente (dato real aparecido, error de permisos) detiene la prueba y se reporta de inmediato.
- Al terminar: se borran los negocios de prueba (reinicio de demos) y se documenta.

## Qué necesita tu autorización
Participantes externos, el entorno staging si hay que desplegar ahí, y el momento de empezar. Hasta entonces solo se ejecuta la parte automatizada (ya hecha: 350+ pruebas, 14 scripts de navegador, auditorías visuales).
