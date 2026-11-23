# NEXORA — Privacidad de los enlaces públicos

Fecha: 23 nov 2026 · Rama `modernizacion`.

## 1. Inventario de enlaces que ve un cliente o el público

| Enlace | Para qué | Identificador | ¿Qué revela? (antes) | Estado |
|---|---|---|---|---|
| `/reservar/{id}` | Reservar cita (barbería, uñas) | **Código de negocio** (6 caracteres) | El mismo código con el que pueden entrar los empleados; nombres completos del personal e ids internos | **Corregido:** identificador público propio (`fenix-barberia` o `nombre-xxxx`); personal como «Luis G.»; sin ids |
| `/cita/{token}` | Estado de la cita del cliente | Token aleatorio de 128 bits | Nombre completo e id de quien atiende | **Corregido:** «Luis G.», sin id |
| `/boletos/{id}` | Compra anticipada de boletos (turístico) | Código de negocio | Igual que reservas | **Corregido:** mismo identificador público |
| `/mis-boletos/{token}` | Boletos comprados | Token de 128 bits | Solo los boletos de esa compra | Sin cambios (correcto) |
| `/tarjeta/{código de cliente}` | Tarjeta de sellos del cliente | Código de 96 bits (`NX…`) | Solo nombre de pila, sellos y premios | Sin cambios (correcto) |
| `/descargar` | Instalar la app | — | Nada | Sin cambios |
| `/privacidad` | Aviso de privacidad | — | Correo de contacto del propietario (Gmail personal) | **Pendiente decisión:** usar un correo de la empresa |
| Mensajes de WhatsApp preparados | Recordatorios, cobro de fiado, «pedido listo», tarjetas | — | Llevan el enlace correspondiente | Usan los enlaces de arriba |
| Recuperación de contraseña | Dueño: código por SMS/correo (sin enlace). Empleados: el dueño restablece | — | No hay enlaces de recuperación | Correcto |
| Invitaciones / accesos compartidos | No existen enlaces de invitación; el dueño crea usuario y contraseña | — | — | Correcto |

**Todos los tokens** (cita, boletos, tarjeta) son aleatorios y largos (≥ 96 bits): no se pueden adivinar ni recorrer. **Verificado** en el código (`randomBytes(16)`, `randomBytes(12)`).

## 2. Lo que se cambió en esta rama (sin tocar producción)

1. **Identificador público por negocio** (`businesses.public_slug`), independiente del código interno y de cualquier dato personal. Se crea solo la primera vez que el dueño ve su enlace (`nombre-del-negocio-xxxx`) y el dueño puede cambiarlo en Ajustes (p. ej. `fenix-barberia`); valida formato y que no se repita. El cambio queda en la bitácora.
2. **Compatibilidad:** los enlaces ya compartidos con el código (`/reservar/ABC123`) **siguen funcionando**; Fénix no tiene que volver a mandar nada. Se puede retirar más adelante.
3. **Personal en páginas públicas:** nombre + inicial («Luis G.»), sin ids internos.
4. **Encabezados** en todas las respuestas: `Referrer-Policy: strict-origin-when-cross-origin` (los tokens no viajan a otros sitios), CSP, anti-iframe, `nosniff`, `Permissions-Policy`.
5. Migración **solo agrega** una columna y un índice. Pruebas: `test/enlaces-publicos.test.ts` (3 casos).

## 3. El dominio (requiere decisión del propietario — no se tocó nada)

Hoy todo vive en `https://nexora.josehedzaguilar0715.workers.dev`. La parte `josehedzaguilar0715` es el **subdominio de la cuenta de Cloudflare**, no algo de NEXORA. Opciones:

| Opción | Costo | Ventajas | Riesgos |
|---|---|---|---|
| **A. Dominio propio** (p. ej. `nexora.mx` / `nexora.app`) conectado al Worker como dominio personalizado | ~USD 10–35/año (registro) | Profesional, permite subdominios por producto (`barber.nexora.mx`, `reservar.nexora.mx`), correo de la empresa | Requiere comprar dominio y configurar DNS (autorización). Al cambiar de dirección, las apps instaladas y las sesiones abiertas del dominio viejo **no se pasan solas** (el navegador las guarda por dominio): hay que mantener el dominio viejo funcionando un tiempo y pedir a los clientes que vuelvan a entrar |
| B. Cambiar el subdominio de `workers.dev` de la cuenta (p. ej. `nexora-app.workers.dev`) | Gratis | Quita el nombre personal | Cambia **todos** los enlaces de inmediato: los enlaces compartidos, las apps instaladas y los avisos push dejan de funcionar el mismo día. **No recomendado** con clientes activos |
| C. Dejarlo igual por ahora | Gratis | Sin riesgo | Sigue visible el nombre de la cuenta |

**Recomendación:** A, con transición: (1) comprar el dominio, (2) conectarlo al mismo Worker (producción sigue igual en la dirección vieja), (3) cambiar los enlaces que muestra la app al dominio nuevo, (4) avisar a los 3 negocios para reinstalar la app desde el dominio nuevo, (5) mantener la dirección vieja al menos 3 meses.

### Estructura de enlaces propuesta (con dominio propio)

```
https://app.nexora.mx                         app de negocios (dueños y empleados)
https://reservar.nexora.mx/{negocio}          reservas  (p. ej. /fenix-barberia)
https://reservar.nexora.mx/cita/{token}       estado de la cita
https://tarjeta.nexora.mx/{código}            tarjeta de sellos del cliente
https://boletos.nexora.mx/{negocio}           venta de boletos
```
Con productos con marca propia (ver `03-arquitectura-de-productos.md`) se podría usar un dominio por producto, pero no es necesario al inicio.
