# 31 · Planes reales (Inicial, Crecimiento, Profesional) y cobro de citas solo en Caja

Rama `diseno-v0`. Lectura del código (`src/billing.ts`, `src/admin.ts`, `src/common.ts`, `src/users.ts`). **No se cambió ninguna suscripción, precio ni regla comercial. No existen «Agenda Libre» ni «Agenda Pro».**

## Diferencias reales entre planes
| | Inicial | Crecimiento | Profesional |
|---|---|---|---|
| Mensualidad (sin IVA) | $500 | $700 | $900 |
| Usuarios incluidos (dueño + personal) | 3 | 5 | 10 |
| Sucursales | 1 | 1 | 1 |
| Funciones | **las mismas** | **las mismas** | **las mismas** |

- Extras de pago (precios del código): **sucursal adicional $300/mes**; **paquete de +5 usuarios $200/mes**; **extra «reservas»** (link público de reservas): se habilita solo desde el Super Panel con cobro único de instalación (monto lo captura soporte). Sin ese extra, la página pública responde «no disponible».
- El plan **no activa ni desactiva** ninguna pantalla: lo que cambia por negocio es el **giro** (barbería/uñas tienen Agenda, etc.) y los **módulos** que el dueño enciende (membresías, promociones, sellos, asistencia, recordatorios) más el extra «reservas».
- Al bajar de plan o quitar extras, el sistema **no borra nada**: desactiva los usuarios o sucursales sobrantes (los más nuevos) y lo registra.
- Cuenta **Gratis**: no paga ni vence; no cambia funciones.
- Decisión pendiente tuya (no implementada): si quieres «Agenda Pro» como nombre comercial, sería solo el nombre del extra «reservas» (más recordatorios automáticos), definido por ti.

## Cobro de citas: solo Caja
- La **Agenda ya no tiene botón «Cobrar»**: ofrece Confirmar, Atender, **Terminar**, No vino, Cancelar y, cuando está terminada, la etiqueta **«Pendiente de cobro»** y el botón **«Ver en Caja»**, que abre directo el cobro de esa cita (la cita ya cobrada o inexistente muestra un aviso).
- **Servidor:** cobrar una cita sin terminarla responde 409 `terminar_primero`; cobrarla dos veces, 409 `ya_cobrada`. La venta, comisiones, sellos, Finanzas y reportes se leen de la venta real, así que se actualizan solos.
- Tras cobrar, Caja muestra el ticket (58/80 mm).
- Pruebas: A `agenda-cobro-publica.test.ts`; N `scripts/verificacion/agenda-caja.ts` y el e2e de punta a punta (Terminar → Ver en Caja → Cobrar → el cliente ve «Atendida»). Los tests de barbería y uñas se actualizaron para terminar el servicio antes de cobrar.

## Costos y márgenes: permiso independiente (`view_costs`)
- El dueño lo marca **por persona** (encargado, administrador o empleado que compra) en Personal → «Qué puede hacer». Sin él, el servidor **quita** de las respuestas: costo, margen y precio sugerido de productos; margen de categorías; costo de lotes; costos de compras recientes; costo estimado de reposición y de «Conviene comprar»/«Casi no se vende». En pantalla desaparecen la columna Costo, la línea de ganancia y los importes derivados.
- **Efecto sobre usuarios actuales:** no se modificó ningún permiso guardado, pero encargados y empleados que antes veían costos por tener permisos de inventario **dejan de verlos hasta que el dueño les marque «Ver costos y márgenes»**. Pueden seguir capturando costos al comprar.
- Pruebas: A (7 en `administrador-y-finanzas-acceso.test.ts`: sin permiso no hay costos; con permiso sí, sin abrir finanzas; otro encargado no; se puede quitar); N (`mi-dinero.ts`: columna Costo ausente/presente). 
