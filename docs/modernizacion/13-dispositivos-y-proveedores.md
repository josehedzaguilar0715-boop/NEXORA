# Push, SMS, correo, impresoras y aislamiento: qué se probó y qué falta

Fecha: 24 nov 2026. Rama `modernizacion`.

En las tablas, **simulado** significa que el servicio externo se imitó: no hay teléfonos, impresoras ni credenciales en este entorno. **Real** significa que se ejecutó contra el sistema real.

## 1. SMS (Twilio) y correo (Resend)

| Prueba | Tipo | Resultado |
|---|---|---|
| Formato exacto de la petición a Twilio: dirección, usuario y clave, número en +52, texto con el código | Simulado (`test/proveedores-externos.test.ts`) | ✅ |
| Formato exacto de la petición a Resend: remitente, destinatario, adjunto del respaldo | Simulado | ✅ |
| Si Twilio responde error o no hay red | Simulado | ✅ (corregido, ver abajo) |
| Super panel: si el SMS falla, el código igual sale por correo | Simulado | ✅ (corregido) |
| **Envío real a un teléfono o buzón** | Real | ❌ **No ejecutado: no hay credenciales** |

**Errores encontrados y corregidos:**

* Si Twilio o Resend fallaban, el dueño veía «Ocurrió un error» (500) sin saber qué pasó. Ahora ve «No pudimos enviar el SMS. Revisa el número o inténtalo en unos minutos» (502) y el detalle queda en los registros.
* En el super panel, si fallaba el SMS ya no se intentaba el correo. Ahora cada canal es independiente.

**Para probarlo en real hace falta** (decisión y gasto del propietario):

* **SMS:** una cuenta de Twilio con un número que pueda mandar a México. Secretos `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` y `TWILIO_FROM`. Costo aproximado: de $0.80 a $1.50 MXN por SMS.
* **Correo:** una cuenta de Resend con **un dominio propio verificado**. Secretos `RESEND_API_KEY` y `MAIL_FROM` (por ejemplo, `NEXORA <avisos@tudominio.mx>`). El plan gratis permite unos 3,000 correos al mes.
* Con eso: registrarse en staging con un teléfono propio, recibir el código y entrar; pedir un respaldo manual y verificar que llegue al correo.

## 2. Avisos push al celular

| Prueba | Tipo | Resultado |
|---|---|---|
| Firma VAPID (RFC 8292) **verificada criptográficamente** con la llave pública que recibe el celular; destinatario correcto; vence en menos de 24 h | Simulado | ✅ |
| Servicios de Chrome/Android (`fcm.googleapis.com`), Safari/iPhone (`web.push.apple.com`) y Firefox | Simulado | ✅ (los 3 reciben el aviso) |
| Celular que se dio de baja (410): se borra su suscripción. Servicio caído: los demás reciben igual | Simulado | ✅ (corregido: antes, una falla detenía a los demás) |
| Volver a suscribirse sola sin pedir permiso otra vez | Navegador con push simulado (fase 2) | ✅ |
| **Aviso llegando a un teléfono real** | Real | ❌ **No ejecutado: necesita un celular** |

**Para probarlo en real:**

* Un celular Android con Chrome. En iPhone hace falta iOS 16.4 o más reciente y **agregar NEXORA a la pantalla de inicio**: sin eso, Safari no permite avisos.
* Pasos:
  1. Entrar a staging y aceptar avisos.
  2. Desde otra sesión, mandar una comanda a cocina o crear una cita.
  3. Verificar que llegue el aviso con la pantalla bloqueada.
* Costo: $0. Las llaves VAPID ya las genera el sistema.

## 3. Impresoras, báscula, cajón y lector

Cómo funciona hoy:

* NEXORA imprime con el **diálogo de impresión del sistema**: sirve cualquier impresora instalada, incluidas las térmicas de 58 y 80 mm.
* La báscula se usa **escribiendo el peso**: no hay conexión directa.
* El lector de códigos funciona como teclado (USB o Bluetooth) o con la cámara.
* El cajón de dinero no tiene conexión directa.

| Prueba | Tipo | Resultado |
|---|---|---|
| Ticket de venta, tal como lo recibe la impresora (PDF de 58 y 80 mm) | Navegador real, impresora simulada (`scripts/verificacion/impresion.cjs`) | ✅ 1 hoja, renglones completos (32 columnas) |
| Corte X impreso | Mismo | ✅ 1 hoja, total completo |
| Boletos con QR (taquilla) | Mismo | ✅ 1 hoja, 2 boletos con su QR |
| **Impresión en una impresora térmica física** | Real | ❌ **No ejecutado: necesita la impresora** |

**Errores encontrados y corregidos:**

1. **El ticket no cabía en 58 mm.** Con letra de 12 px, cada renglón se partía en dos (producto en una línea y precio en otra) y salía una **hoja en blanco** extra. Ahora la letra está calculada para que las 32 columnas quepan en el ancho útil de 58 mm (48 mm), en una sola hoja, sin la dirección ni la fecha que agrega el navegador.
2. **Los boletos de la taquilla salían en blanco.** La regla de impresión ocultaba todo lo que no fuera ticket. Ahora cada botón imprime exactamente lo suyo.
3. **La taquilla ofrecía horarios que ya habían pasado** y luego rechazaba la venta. Ahora aparecen como «Ya pasó» y desactivados.

**Para probarlo en real hace falta:**

* La impresora térmica del negocio (58 u 80 mm) instalada con su controlador en la computadora o el celular. En Android, con la app del fabricante o con «Impresión» del sistema.
* Pasos:
  1. Hacer una venta y pulsar «Imprimir ticket».
  2. En el diálogo, elegir la impresora, **tamaño de papel = rollo** y **márgenes = ninguno**.
* Revisar que salga en una tira, sin cortes de renglón.
* **No soportado hoy** (quedaría como mejora): abrir el cajón automáticamente, leer el peso directo de la báscula, imprimir por Bluetooth sin diálogo.

## 4. Aislamiento entre negocios, sucursales y permisos

| Prueba | Resultado |
|---|---|
| ~90 rutas con identificador: B no puede leer ni cambiar nada de A (`aislamiento-negocios.test.ts`) | ✅ |
| **Nuevo:** las **87 listas y reportes** (rutas sin identificador), consultados por B con los ids de A en la dirección. Ninguna devuelve datos de A: nombres, teléfonos, códigos de barras ni ids (`aislamiento-listas.test.ts`) | ✅ |
| Más de 100 rutas con permiso: un empleado sin ese permiso recibe 403 en todas (`permisos-barrido.test.ts`) | ✅ |
| Páginas públicas: solo nombre, teléfono, giro y personal como «Luis G.»; sin ids internos ni direcciones | ✅ |
| Sucursales: inventario y caja separados por sucursal; los traspasos conservan costo (`abarrotes.test.ts`) | ✅ |
| Separar un negocio de la base sin mezclar datos: 13 giros, suma exacta (`particion.test.ts`) | ✅ |

**Observación (decisión del propietario, no es una fuga):**

* Dentro de **un mismo negocio**, los reportes muestran todas las sucursales a quien tenga permiso de verlos, y hoy **todos los empleados lo tienen**.
* Si se quiere que un empleado de una sucursal vea solo la suya, hay que decidirlo; es un cambio pequeño.

## 5. Pruebas de carga

Ver `14-estrategia-de-crecimiento.md` §1.

**Resumen:**

* Una sola base atiende ~98 peticiones por segundo sin errores ni ventas perdidas.
* El panel de Inicio pasó de 3.1 s a 14 ms con 39,000 ventas.
* La base actual alcanza para ~100 a 150 negocios; más allá, hay que separarla por negocio.
