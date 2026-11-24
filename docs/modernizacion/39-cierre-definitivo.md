# 39 · Cierre definitivo de `diseno-v0`

Complementa `38-informe-final.md`. **Nada publicado ni fusionado; no se ejecutó ninguna migración en producción; no se tocó ninguna base de negocios activos; no se contrató ningún servicio ni se generó gasto.** Producción sigue en 72bda7f0. Tipos de prueba: A = automatizada (vitest, base en memoria) · N = navegador real con datos de demostración en memoria. **Ninguna prueba se hizo con negocios reales ni con impresora física.**

## 1. Pantallas adaptadas en esta última etapa
No se reconstruyó nada ni se quitó ninguna función. Se hizo una adaptación compartida y cambios puntuales:
- **Tarjetas en celular, automáticas** (`web/src/cardsAuto.ts`): en las pantallas de la lista, cada tabla se convierte en tarjetas con el título de cada dato; en computadora y tableta la tabla se ve igual. Se aplica a: **Configurar negocio, Personal, Productos, Devoluciones, Entradas, Acceso, Importar, Membresías y promociones, Cotizaciones, Encargos, Verdulería (Precio del día), Trompo (Carne) y Menú del día**. Celdas de acciones con botones que se acomodan en varias líneas.
- **Formularios por pasos con títulos:** Encargos (1 ¿Para quién? · 2 ¿Qué se va a hacer? · 3 Precio y entrega) y Cotizaciones (1 ¿Para quién? · 2 ¿Qué lleva?).
- **Lista de Productos en celular:** corregida (se había encimado con las tarjetas): precio, existencia y costo en tres columnas con título, acciones en su propia fila; conserva su diseño propio.
- **Ficha de Productos:** formulario por secciones y opciones avanzadas plegadas (etapa anterior); ahora auditada pestaña por pestaña.
- Ya cumplían la arquitectura v0 y solo se verificaron: Personal (lista de equipo con avatar), Importar (pasos 1, 2…), Devoluciones, Entradas/Acceso, Menú del día, Trompo, Verdulería, Membresías y promociones (sin cambios de organización; se confirmó con capturas en computadora y celular).
- **Decisión de alcance:** donde la organización actual ya era buena, se conservó y solo se adaptó lo visual, como pediste.

## 2. Resultados de pruebas (última ejecución)
Ver resultados al final de este documento, §7 (se llenan con la corrida de cierre). Auditorías de esta etapa, **solo de lo afectado** (no se repitieron las ya aprobadas):
- **Pantallas de la lista**, 9 giros que las contienen (abarrotes, ferretería, baños, turístico, barbería, papelería, verdulería, taquería, comedor): escritorio+celular **claro 282/282, oscuro 282/282**, tableta **141/141**: 0 hallazgos. Tras corregir Productos: abarrotes de nuevo claro 30/30, oscuro 30/30, tableta 15/15: 0 hallazgos.
- **Ficha de Productos** (`auditoria-ficha.ts`): 4 vistas × claro/oscuro × computadora, tableta y celular: 6/6 sin hallazgos.
- Navegación, roles y regresión funcional: ver §7.

## 3. Productos y roles verificados
- **14 productos:** los 13 giros (auditados completos antes y re-auditados los 9 afectados ahora) + la **base NEXORA** (audit en la etapa anterior, 26/26 y 13/13; esta etapa no la modificó). La guía visual de los 14 (84 combinaciones) sigue en 0 hallazgos desde la última corrida completa y esta etapa no cambió tokens ni colores.
- **Roles:** dueño, administrador autorizado, encargado y empleado (accesos de servidor por pruebas A; interfaz por `puestos.ts`, `mi-dinero.ts`, `navegacion.ts`). Ver §7.

## 4. Errores encontrados y corregidos en esta etapa
1. El **auditor** marcaba como «texto encimado» lo que está detrás de una ventana abierta (ficha, diálogo): ahora solo cuenta lo de la ventana (se corrigió el auditor, no la interfaz; la ventana tapa lo de atrás).
2. La lista de **Productos** en celular quedó con «apartados» partido letra por letra y el costo recortado al combinar mis tarjetas con su diseño propio → se devolvió a su diseño y se ordenó en tres columnas.
3. Un cambio de hook mal ubicado se detectó antes de ejecutar (el hook de tarjetas va en un componente aparte para no romper el orden de hooks de React).

## 5. Limitaciones reales
- **Sin pruebas con negocios reales** ni con usuarios externos: solo datos de demostración y simulación.
- **Impresión física no verificada** (no hay impresora): solo el contenido y anchos de columna; protocolo en `36`.
- **Los recordatorios no se envían solos** (WhatsApp manual con mensaje listo); sin proveedor de mensajes.
- **Sin facturación CFDI**; los comprobantes dicen que no son factura.
- El logotipo es una **dirección de imagen** (no se sube archivo).
- «Dinero disponible» aplica el flujo de bancos al **total de bancos**, no a cada cuenta.
- Las tarjetas en celular de esas pantallas se activan por JavaScript tras pintar la pantalla (un instante después de cargar); en equipos muy lentos puede verse la tabla un momento.
- Solo se probó con Chromium; sin lectores de pantalla.
- Las migraciones 43–48 son aditivas y están probadas sobre una base con datos, pero **se aplicarán a producción al publicar**.

## 6. Pendiente que requiere equipo o servicios externos (mejoras futuras, NO implementadas)
| Mejora | Requiere |
|---|---|
| Prueba de impresión en papel (58/80 mm) | Impresora térmica y quien la ejecute (protocolo `36`) |
| Validación controlada con negocios de prueba | Participantes y, si se despliega, staging (plan `37`) |
| Recordatorios automáticos por WhatsApp/SMS | Proveedor de mensajes y presupuesto (comparativa `35`) |
| Anticipos en línea | Pasarela de pagos |
| «Agenda Pro» y precios | Decisión comercial (propuesta `34`) |
| Subir logotipo como archivo | Almacenamiento de archivos |
| Impresión directa ESC/POS (corte, cajón) | Puente local o app y pruebas con hardware |
| Análisis de rentabilidad para baños/turístico | Definir qué costos capturar |

## 7. Corrida final de pruebas
Ejecutada sobre el código final de esta etapa:
- **A:** 66 archivos, **345 pruebas, 0 fallas**; compilación de servidor y de interfaz sin errores.
- **N, todas en orden:** e2e de punta a punta · navegación · puestos (roles) · dashboards · teclado · tema claro/oscuro · mi-dinero (Finanzas, saldos, permisos de los 4 puestos, resumen del encargado, costos) · giros-auto (automatizaciones, 4 giros × claro/oscuro × 2 tamaños) · ticket (58/80 mm, logotipo, comprobante digital) · agenda-caja · páginas públicas (18, 0 hallazgos).
- **Auditorías de pantallas de esta etapa:** ver §2 (0 hallazgos en todas).
- **No se repitieron** las auditorías completas de los 13 giros, el panel administrativo (36) ni la guía visual (84): no hubo cambios que las afecten (solo CSS de tarjetas en celular, que se activa únicamente en las pantallas listadas, y el cambio de auditor).
- **Fallidas:** ninguna en la corrida final; los fallos intermedios están en §4.

## 8. Cómo hacer una futura validación controlada
1. Leer `37-plan-validacion-controlada.md`. Crear negocios de **demostración** (Super Panel → Demos) o de prueba con datos ficticios; **nunca** copiar ni restaurar datos de producción.
2. Ejecutar localmente o en staging la rama `diseno-v0` con base vacía (`npm run build` y arrancar el servidor local; las verificaciones usan bases en memoria).
3. Seguir el guion por giro (caja, agenda→caja, finanzas, saldos, tickets) y registrar resultados en la bitácora del plan.
4. Probar impresión con `36-protocolo-prueba-impresion.md`.
5. Repetir las verificaciones automáticas: `npx vitest run`, `npm run e2e` y los scripts de `scripts/verificacion/` (navegación, puestos, mi-dinero, giros-auto, ticket, agenda-caja, auditorías de pantallas).
6. Antes de publicar (solo con autorización expresa): ensayo con respaldo (`scripts/verificacion/ensayo-respaldo.ts`) y verificación posterior con el flujo «Verificar despliegue».

## 9. Últimos commits
Se indican en el mensaje de entrega y con `git log --oneline` de `diseno-v0` (el último commit de esta etapa es «cierre definitivo»).
