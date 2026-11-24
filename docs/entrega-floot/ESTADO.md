# Estado de NEXORA al empaquetar

Para leer esta tabla: **Terminado** significa implementado y con prueba que pasa. **Pendiente** significa que no está hecho, o que requiere una decisión o un gasto del propietario. **No probado** significa implementado, pero sin verificar en ese escenario real.

## 1. Dónde está cada versión

| Entorno | Versión | Contenido |
|---|---|---|
| **Este ZIP** | rama `modernizacion` (commit exacto en `VERSION.txt`) | Todo lo de abajo |
| Staging (Cloudflare `nexora-staging`) | ver `docs/modernizacion/15-informe-cierre-definitivo.md` §6 | Versión de cierre definitivo |
| **Producción** (Cloudflare `nexora`, 3 negocios reales) | `2c16921e` = commit `efb75ff` | **No incluye** el trabajo de modernización. Publicarlo requiere autorización del propietario. |

Todas las demás ramas (`main`, `staging`, `claude/new-session-pqpyhl`) ya están contenidas en `modernizacion`: ninguna tiene commits que falten.

## 2. Terminado (implementado y con pruebas que pasan)

**Funciones base (ya en producción):**

* Punto de venta y caja con cortes X y Z, fondo, retiros y depósitos.
* Venta por pieza, granel, presentaciones, mayoreo y lotes PEPS.
* Compras con fletes, proveedores, cuentas por pagar e inventario con merma, conteo y traspasos.
* Fiado con límite y abonos; apartados; cotizaciones; encargos; devoluciones.
* Agenda de citas con reserva pública, horarios y bloqueos (barbería y uñas); comisiones y propinas.
* Mesas, comandas, cocina por estación, pedidos para llevar y menú del día (palapa, restaurante, comedor, taquería).
* Boletos con aforo y acceso por QR (turístico); entradas, pases y limpieza (baños).
* Decants y testers (perfumería); copias y contador (papelería); precio del día y báscula (verdulería); trompo (taquería).
* Lealtad: sellos, membresías y promociones.
* Finanzas: estado de resultados, flujo, balance, 50/30/20 y retiro sugerido.
* Avisos y push; importar de Excel; super panel con planes, pagos, suspensión, buzón y demos.
* Respaldos diarios.

**Modernización (fases 1 a 9; en staging, NO en producción):**

* Enlaces públicos con identificador propio y encabezados de seguridad.
* Identidad visual propia para los **13 giros**, con contraste AA verificado por prueba.
* Acabado premium.
* Avisos push que no hay que reactivar.
* Correcciones de internet lento: horario de agenda, horas libres, ajustes vacíos y conteo con ventas pendientes.
* **No sale de la caja más efectivo del que hay** (compras, gastos, devoluciones y cancelaciones).
* Anular gasto, anular abono de fiado y devolución a proveedor.
* **Pago de comisiones y propinas** al personal.
* El saldo a favor ya no cuenta como dinero cobrado.
* Límite de intentos por IP; respaldos cifrables; monitor de espacio de la base.
* Barrido automático de permisos.
* Aviso de renovación al dueño; métricas comerciales en el super panel; primeros pasos por giro.

**Verificación al empaquetar:**

* `npm run check` sin errores: tipos, 293 pruebas, compilación y prueba de punta a punta.
* Recorrido de 13 giros × dueño y empleado × celular y computadora: sin hallazgos.
* 13 demos en el motor de Cloudflare: todo OK.

## 3. Pendiente

**Actualización del 24 nov:** ver `docs/modernizacion/15-informe-cierre-definitivo.md` §4. Ya se resolvieron el correo del aviso de privacidad (ahora configurable), el procedimiento de cifrado y restauración, y el rendimiento de la base compartida.


| Pendiente | Requiere |
|---|---|
| Publicar la modernización en producción | Autorización del propietario |
| Activar `BACKUP_KEY` (respaldos cifrados) en producción | Autorización; el propietario guarda la llave |
| **Separar la base por negocio** (tope de 1 GB del objeto compartido en el plan gratis) | Decisión; desarrollo de 1 a 2 semanas |
| Cobro automático de mensualidades (Mercado Pago o Stripe) | Decisión y gasto (comisiones) |
| Facturación CFDI de la mensualidad | Decisión y gasto (PAC) |
| Dominio propio y nombres comerciales definitivos (los actuales son provisionales) | Decisión y gasto |
| Archivar ventas viejas para ahorrar espacio | Desarrollo y autorización |
| Regla WAF de Cloudflare (opcional) | Autorización de configuración |
| Correo personal del propietario en `docs/aviso-de-privacidad.md` | Decidir si se cambia por un correo del negocio |
| **Migración a Floot** | Ver `MIGRAR-A-FLOOT.md`: es una reescritura del backend y de la base, no una importación directa |

## 4. Implementado pero NO probado en real

* Push llegando a un **teléfono real** (probado con el servicio de push simulado).
* SMS y correos reales (Twilio, Resend): sin credenciales en el entorno de desarrollo.
* Impresora de tickets, báscula, cajón y lector físicos (probados con simuladores en navegador).
* Cientos de negocios al mismo tiempo (carga).
* Restaurar un respaldo **dentro** de un Durable Object de producción (sí probado: restaurar a una base nueva).
* El plan real de la cuenta de Cloudflare: la credencial usada no permitía leerlo.
* El segundo paso del super panel **en producción**: el código lo tiene; depende de la configuración.

## 5. Qué NO viene en el ZIP, a propósito

* `node_modules/`: se reinstala con `npm ci`.
* `web/dist/` y `src/assets.gen.ts`: se generan con `npm run build` y `npm run build:worker`.
* `.dev.vars`, secretos, tokens y contraseñas: solo los **nombres** en `.dev.vars.example`.
* Bases de datos y respaldos (`data/`, `*.db`): **no hay datos de clientes**. Los datos ficticios se crean con las demos.
* Historial de git (`.git`): el código es el de la rama y el commit indicados en `VERSION.txt`.
* Los archivos CSV de la barbería real que se usaron en una importación anterior: datos reales de clientes, fuera del proyecto.
