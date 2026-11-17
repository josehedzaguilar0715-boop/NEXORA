# NEXORA: especificación para Claude Code (v1, 2026-11-16)

Documento de referencia para construir NEXORA desde cero. Es una base nueva: no reutiliza código, decisiones ni datos de versiones anteriores, ni de FÉNIX ni de Abarrotes Rosi.

Idioma de la interfaz: español (México). Moneda: MXN. Pantallas grandes, pocos pasos, lenguaje sencillo, pensado para adultos.

Flujo de trabajo: desarrollar y probar primero en local. Subir a staging solo cuando las pruebas locales pasen. No tocar producción hasta que staging sea estable. Un bloque grande por vez, con checkpoint y un push por bloque estable. Los errores técnicos (pruebas, migraciones, CI, builds) se corrigen sin pedir logs al dueño.

---

## 1. Principios

- Cada giro tiene su sistema, y todos comparten la misma base.
- Ningún dato se borra por vencimiento, cambio de plan ni cancelación de cuenta.
- Toda acción sensible (cancelar, descontar, cambiar precio, devolver, cortesía) pide código de autorización y queda en bitácora.
- El sistema funciona sin internet y sincroniza con la nube cuando vuelve la señal.
- Cada sistema se adapta a lo que pida su cliente, sin cambiar la base común sin aprobación.
- La facturación queda fuera, salvo que el cliente la pida.

## 2. Cuentas, acceso y roles

### Alta de negocios
- Cuenta propia: el dueño se registra con teléfono y contraseña. El código de verificación llega por WhatsApp o SMS.
- Alta asistida: el super panel crea el negocio y entrega el acceso al dueño.
- Días de prueba: los define el super panel para cada cliente.

### Usuarios del negocio
- El dueño crea cada usuario con nombre, usuario y contraseña. No se requiere correo.
- En el primer ingreso el usuario cambia su contraseña. El dueño puede desactivar este paso.
- Login de empleado: link único + usuario + contraseña + código del negocio.
- Login de dueño: link único + teléfono + contraseña.
- Si alguien olvida su contraseña, el dueño se la restablece. Si el dueño no está disponible, lo hace el super panel.
- El dueño recupera su cuenta con un código que llega a su teléfono. Si pierde el teléfono, el super panel verifica su identidad y restablece el acceso (método de verificación pendiente de definir).

### Código de autorización
- Es distinto a la contraseña. Lo asigna solo el dueño. Sirve para autorizar acciones sensibles.
- El dueño puede usar cualquier código.
- Tras varios intentos fallidos se bloquea temporalmente.

### Permisos
- El dueño marca, por cada usuario, qué puede hacer.
- Hay plantillas editables: cajero, encargado, barbero, empleado de piso.
- Un permiso no marcado no aparece en pantalla.
- Permisos disponibles: vender y cobrar, abrir y cerrar caja, cancelar o descontar (con código), cambiar precios, ver inventario, editar inventario y compras, ver reportes y finanzas, crear empleados, ver comisiones, configurar productos o menú, clientes y fiado, asistencia.

### Roles de referencia
- Super panel: ve todos los clientes, administra pruebas, mensualidades, bloqueos y buzón. No ve ventas internas de cada negocio.
- Dueño: configura todo su negocio y crea usuarios.
- Encargado, cajero, personal de piso o barbero: según permisos asignados.

### Seguridad
- Verificación en dos pasos para el dueño.
- Cada dispositivo queda registrado. El dueño puede cerrar sesiones desde su cuenta.
- Bloqueo temporal tras varios intentos fallidos, en contraseña y en código de autorización.
- Datos aislados por negocio. Ningún negocio ve datos de otro.

## 3. Caja, códigos y corte

- Inicio de caja obligatorio al empezar cada turno. Sin fondo inicial no se vende.
- Corte por turno: efectivo esperado = fondo inicial + ventas en efectivo − retiros + depósitos. Se compara contra lo contado. La diferencia queda registrada con motivo.
- Cierre del día: consolida los turnos de la sucursal.
- Formas de pago: efectivo, transferencia y tarjeta registrada manualmente. Sin terminal integrada.
- Retiro sugerido del dueño: utilidad del periodo − reserva para X días de gastos fijos − reposición de inventario. Sin porcentajes. El dueño define los días de reserva.

## 4. Registros y bitácora

- Ticket: logo, teléfono del negocio (lo captura el dueño), folio, fecha, productos, cantidades, precio total, forma de pago y cajero.
- Bitácora: quién hizo cada cambio, cuándo, valor anterior y valor nuevo. Las acciones con código guardan además quién autorizó.
- Nada se borra: ventas, compras, cortes, movimientos de inventario y bitácora se conservan siempre.
- Una venta cancelada queda marcada, con quién la autorizó y por qué.

## 5. Sin internet y nube

- La caja guarda cada venta en el equipo y sigue funcionando.
- Cada venta tiene un identificador único creado en el equipo. El servidor la recibe una sola vez y la ignora si llega repetida, así nunca se duplica un cobro.
- Si dos equipos cambian el mismo producto sin conexión, gana el movimiento más reciente y el conflicto queda marcado para revisión.
- Un equipo puede operar varios días sin señal. Las cajas de una misma sucursal se sincronizan entre sí cuando hay red local.
- Lo pendiente de sincronizar se muestra con un contador visible.
- El dueño ve su negocio desde cualquier lugar cuando hay señal: ventas, caja, inventario y reportes en tiempo real.

## 6. Super panel

Estados de un negocio:
- Prueba: días de prueba que define el super panel para cada cliente.
- Activo: mensualidad al día.
- Vencido: sin acceso a operar, datos intactos. Pasa aquí al terminar la prueba sin pago o al vencer una mensualidad.
- Suspendido: decisión del super panel, después de X días vencido. Datos intactos.
- Reactivación: al pagar, el negocio vuelve a Activo sin perder datos.

Pendiente: cuántos días vencido pasa un negocio a Suspendido.

Desde el super panel también:
- Crear negocios (alta asistida) y entregar acceso.
- Ver y responder el buzón de soporte de cada cliente.
- Ver solicitudes de cambio y marcarlas como aceptadas, en revisión o rechazadas.
- Restablecer accesos cuando el dueño no esté disponible.

## 7. Buzón y solicitudes

- Buzón de soporte: el cliente escribe sus dudas dentro del sistema. El super panel responde, y la respuesta llega al mismo buzón del cliente.
- Solicitudes de cambio: el cliente pide modificaciones desde el mismo buzón e indica el giro o módulo que afectan. El cliente ve el estado de cada solicitud.
- El buzón de cada cliente es privado.

Pendiente: si las solicitudes de cambio tienen costo o van incluidas en la mensualidad.

## 8. Módulo común (cualquier giro)

Se activa solo si el negocio lo necesita.

- Membresía: incluye un número de usos por periodo (por ejemplo, cuatro cortes al mes). Cada escaneo descuenta un uso.
- Promoción: descuento por porcentaje o monto, con vigencia y servicios o productos que aplica. No se combina con otras, salvo que la regla lo permita.
- Fidelidad: puntos o sellos por monto o por visita, canjeables por servicio o producto. Puede ser para todo el negocio o por persona.
- Asistencia: cada escaneo de entrada registra la visita con fecha y hora.
- QR: cada cliente final descarga su QR o código de barras. El personal lo escanea y el sistema aplica la acción. El código es un identificador único, no consecutivo. El servidor valida cada escaneo.
- Un código no puede usarse dos veces en la misma visita. Una membresía no se usa fuera de su vigencia.
- El dueño crea y edita membresías y promociones. Un cambio nuevo no altera los usos ya consumidos.

## 9. Compras, fletes y precios (abarrotes, ferretería, verdulería y otros que compren mercancía)

- Cada compra es un lote con su costo. Se captura desde un ticket de compra; se pueden agregar productos nuevos en ese momento.
- Los fletes y gastos de traer mercancía (gasolina, casetas) se reparten entre los productos de la compra. Reparto por pieza para productos por pieza; por kilo para productos a granel.
- El costo real del lote incluye su parte de los gastos de traslado.
- Lotes con precio: se vende primero el lote más viejo. El precio nuevo entra cuando se agota el stock anterior, sin acción del cajero.
- Margen sugerido: el dueño lo define por producto o por categoría. No hay margen fijo del sistema. Sin margen definido no hay sugerencia de precio.
- Caducidad por lote, con alerta de productos por vencer y registro de mermas con motivo.

## 10. Giros

### 10.1 Abarrotes
- Venta por pieza, paquete y a granel (por kilo o por importe, con báscula).
- Cobro en efectivo, transferencia o tarjeta manual. Fiado con límite y saldo, abonos.
- Descuentos y cambios de precio con código.
- Inventario con presentaciones, caducidad por lote, stock mínimo, mermas, traspasos entre sucursales.
- Proveedores, compras, gastos y cuentas por pagar.
- Clientes frecuentes con historial.
- Personal: roles, asistencia, caja asignada por cajero.
- Ticket y corte según secciones 3 y 4.
- Costo de inventario por lote (primero entra, primero sale).
- Precios con centavos exactos, sin desglose de IVA.
- Hardware: lector de código de barras, impresora térmica, cajón de dinero, báscula; corre en computadora o tableta.

### 10.2 Ferretería
- Todo lo de abarrotes, más:
- Varias unidades por producto (pieza, caja, kilo, metro, litro) con equivalencias capturadas una vez por producto.
- Venta a granel por kilo, metro o litro.
- Escalas de precio por volumen, configuradas por el dueño o encargado. La caja las aplica sola.
- Cotizaciones: no reservan stock. Al convertirse en venta, descuentan.
- Clientes constructores: cuenta corriente con saldo y abonos. Pasar el límite de crédito requiere código del dueño.
- Proveedores con clave propia por producto.
- Devoluciones con ticket original y código. Sin ticket, también requieren código.

### 10.3 Papelería
- Servicios sin inventario: fotocopias, impresiones, escaneo, plastificado y encuadernado. Cobro por hoja, con precio por tamaño (carta u oficio) y por color o blanco y negro.
- Impresiones desde archivo del cliente (USB o correo). El sistema no guarda esos archivos.
- Lectura del contador de la copiadora al inicio y fin de turno. El sistema compara con las hojas vendidas y marca la diferencia. Número de equipos según el cliente.
- Consumibles de servicio (tinta, tóner, papel) como inventario de uso, con costo.
- Combos de temporada, por ejemplo paquetes de útiles por grado, con un solo precio.
- Encargos con anticipo. La devolución del anticipo la decide el dueño con código.
- Mayoreo a escuelas y oficinas, con escalas de precio y crédito.

### 10.4 Barbería
- Agenda por barbero, por hora y con duración por servicio. Se reserva desde la app o en mostrador.
- Clientes sin cita se registran en la misma agenda como atención inmediata.
- Servicios y combos. El combo tiene precio fijo que el dueño reparte entre sus servicios.
- Comisiones por barbero y por servicio o producto, sin valores predeterminados. Cada venta guarda el porcentaje aplicado.
- Productos en la misma cuenta del servicio, con inventario y costo.
- Propinas por barbero, aparte del ingreso del negocio. No cuentan para comisión.
- Horarios, días de descanso y bloqueos de agenda por barbero.
- Comisiones sobre precio final con descuento. Sin barbero asignado, no hay comisión.
- Sin recordatorios automáticos por defecto.
- Membresías, paquetes y productos de temporada según el cliente.
- Reserva pública por link: el cliente elige servicio, barbero o "el primero disponible", día y hora (solo horas libres), y deja nombre y teléfono. La cita queda pendiente hasta que el recepcionista o barbero la confirme. Se puede reservar en cualquier momento; el cliente ve el estado en el mismo link.
- Pendiente: si el link de reserva se cobra como módulo de barbería o como sitio web aparte.

### 10.5 Estudio de uñas
- Agenda por técnica (manicure, pedicure, gel, acrílico, esmaltado, diseño) con duración y tiempo de secado que bloquea la agenda.
- Consumibles con receta por técnica. Cada servicio descuenta lo que gasta.
- Comisiones por técnica, sin valores predeterminados. Propinas aparte.
- Productos de venta con inventario y costo.
- Paquetes de sesiones y recordatorio de retoque, opcionales y apagados por defecto.
- Notas de la clienta: campo de texto libre que escribe el dueño. No se guardan fichas médicas ni datos de salud en estructura.
- Servicios a domicilio: la clienta elige si todos sus servicios serán a domicilio o solo algunos. La dirección se guarda por clienta y solo la ve el negocio. El tiempo de traslado bloquea la agenda. Cargo por traslado opcional, apagado por defecto, fuera de la comisión.

### 10.6 Perfumería
- Variantes por marca, fragancia, tamaño (ml) y presentación (regular, tester, set). Cada una con código de barras y costo.
- Decants: fraccionar un frasco grande descuenta mililitros y crea el frasco pequeño con costo proporcional.
- Testers y muestras son inventario de uso, no se venden ni se devuelven.
- Devoluciones solo de productos sellados o sin usar, con ticket y código. Los abiertos no se devuelven.
- Sets con un solo precio; el empaque se descuenta como consumible.
- Comisiones por asesora, marca o categoría, sin valores predeterminados.
- Caducidad por lote, opcional.
- Temporadas y combos mediante promociones.

### 10.7 Baños públicos
- Tarifas por servicio: sanitario, regadera, casillero, toalla, jabón u otros. El dueño las edita. Se combinan en una entrada.
- Cobro al entrar. Cada entrada genera ticket con hora y se cuenta para el conteo de accesos.
- Pases por día, semana o mes, con QR que también registra asistencia.
- Conteo de accesos por hora, día y tipo de servicio.
- Insumos de uso (papel, jabón, cloro, desinfectante, toallas) descontados por número de accesos, con referencia que define el dueño.
- Control de limpieza por turno: tareas, quién las hizo y a qué hora. Interno por defecto.
- Gastos fijos del local (agua, luz, gas, renta) alimentan la reserva del retiro sugerido.
- Horarios y asistencia de quien atiende caja y limpieza.
- Cobro por tiempo: se activa por servicio si el dueño lo necesita.

### 10.8 Lugar turístico con entrada cobrada
- Boletos por tipo (adulto, niño, adulto mayor, estudiante, grupo y otros que defina el dueño), con precio editable.
- Boletos por fecha y horario. Aforo por horario: no se vende de más.
- Aforo en tiempo real: cuántas personas hay dentro.
- Venta anticipada en línea con el mismo tipo de link de reserva. Genera QR de entrada.
- Control de acceso con QR: un boleto sirve una entrada. Rechaza repetidos, vencidos y cancelados.
- Taquilla por turno con cierre por taquillero y corte por tipo de boleto.
- Visitas guiadas con cupo, hora y guía asignado, si el lugar las ofrece.
- Tienda de recuerdos con inventario y estacionamiento como servicio separado.
- Cierre temporal de un día u horario por clima o mantenimiento. Los boletos afectados se avisan y se cancelan con código.
- Reembolsos y cancelaciones solo con código del dueño, en bitácora. Sin reembolso automático.
- Grupos con descuento por cantidad, vía promociones.
- Reportes de visitas por día, horario, tipo de boleto y canal de venta.

### 10.9 Palapa
- Mesas con cuenta abierta. Comandas a cocina y barra con mesa y hora.
- Cobro en mesa, con división por persona o por producto.
- Propinas por mesero, aparte.
- Reservas de mesa por fecha, hora y número de personas, confirmadas por el dueño o encargado.
- Consumo mínimo por mesa u horario, según decida el dueño.
- Renta de activos (sillas, camastros, sombrillas) con su propio control de inventario.
- Recetas e insumos. Precio por kilo del día (mariscos, pescado) actualizado al abrir con código.
- Merma de perecederos con motivo.
- Bebidas y hielo como productos con costo.
- Opera sin señal: caja local con sincronización posterior.

### 10.10 Restaurante
- Plano de mesas (salón, terraza, barra, área privada) con estados: libre, ocupada, reservada, por cobrar, en limpieza.
- Mapa en vivo: cuáles mesas quedan libres y para cuántas personas. La mesa pasa a limpieza al cobrar y el mesero la libera.
- Comandas por estación (cocina caliente, cocina fría, barra, postres). Cada estación ve solo lo suyo. Se envían al confirmar el pedido.
- Tiempos de cocina por comanda.
- Cuenta dividible por persona o por producto. Cobro en mesa o caja.
- Cancelaciones y cortesías con código del dueño, siempre, en bitácora.
- Recetas con mermas registradas.
- Pedidos para llevar y para recoger: número de pedido, estados (recibido, en cocina, listo, entregado). Se cobran al hacerlos.
- Reserva de hora para pedidos para recoger: opcional, con interruptor visible para el dueño. Si está apagada, solo se da número de pedido.
- Reservas de mesa por fecha, hora y personas, confirmadas por encargado.
- Aviso de pedido listo: manual, con botón que prepara el mensaje (por ejemplo, WhatsApp con el número de pedido). Nada se envía solo.
- Propinas por mesero, aparte.
- Menú editable por el dueño sin tocar la caja. Variantes y combos.

### 10.11 Comedor
- Menú del día (o menú corrido) que el encargado publica cada día con código.
- Venta rápida con botones grandes para los platillos más vendidos.
- Turnos de comida (desayuno, comida, cena), con menú y corte por turno.
- Platillos por porción con receta y costo.
- Cuenta a crédito para clientes frecuentes (oficinas, talleres), con límite. Pasar el límite requiere código del dueño.
- Mapa de mesas opcional, apagado por defecto.
- Caja rápida: cobro en efectivo con cambio al momento.
- Propinas opcionales, apagadas por defecto.

### 10.12 Taquería
- Venta por pieza (tacos, quesadillas, gorditas) y por kilo o importe (carne, guisados, salsas) con báscula.
- Catálogo corto con botones grandes (tipo de guisado, tortilla, extras).
- Recetas por guisado. Insumos descontados por kilo. El costo por taco sale de la receta.
- Carne del trompo o asada: se registra lo que se empieza y lo que se vende. Al cierre, el sobrante se cuenta con código.
- Guisados del día, publicados por el encargado en la mañana. Los agotados no aparecen para vender.
- Cuenta por mesa o barra, igual que restaurante, si hay mesas.
- Pedidos para llevar por pieza o por kilo, con número de pedido.
- Cierre por turno con sobrante de carne y efectivo contado.
- Precio por kilo actualizado por el dueño, con código, en bitácora.

### 10.13 Verdulería
- Venta por kilo, pieza, manojo o bolsa armada, cada presentación con su equivalencia.
- Báscula en caja. Precio del día actualizado al abrir por el encargado.
- Compras al mercado como lote, con fletes repartidos por kilo.
- Merma diaria registrada con motivo y código al cierre.
- Clientes frecuentes (fondas, restaurantes) con cuenta semanal, límite y saldo.
- Pedidos por teléfono o WhatsApp. Se cobran al entregar, salvo que el dueño cambie la regla.
- Conteo rápido al cierre para cuadrar venta y merma.

## 11. Orden de construcción

1. Base: cuentas, acceso y roles, inicio de caja, códigos de autorización, bitácora y tickets.
2. Sincronización sin internet, con identificadores únicos y sin duplicados. Nube para acceso desde cualquier lugar.
3. Super panel: estados de prueba, activo, vencido y suspendido, con bloqueo que conserva datos. Buzón y solicitudes.
4. Módulo común: promociones, membresías, fidelidad, asistencia y QR.
5. Abarrotes, completo y probado antes de cualquier otro giro.
6. Ferretería.
7. Papelería.
8. Barbería.
9. Estudio de uñas.
10. Perfumería.
11. Baños públicos.
12. Lugar turístico con entrada cobrada.
13. Palapa.
14. Restaurante.
15. Comedor.
16. Taquería.
17. Verdulería.

Cada paso se prueba en local antes de pasar al siguiente. Cada giro se entrega completo con pruebas antes de empezar el siguiente.

## 12. Pendientes para definir

- Días de prueba: los define el super panel por cliente. Valor por defecto: pendiente.
- Días vencido antes de pasar a Suspendido: pendiente.
- Método de verificación para recuperar la cuenta del dueño cuando pierde su teléfono: pendiente.
- Costo de las solicitudes de cambio: pendiente (incluidas o cobradas aparte).
- Si el link de reserva de barbería es parte del módulo o un sitio web aparte: pendiente.
- Confirmar el link único para todos los usuarios (confirmado por el dueño).

## 13. Fuera de alcance

- Facturación electrónica (solo si el cliente la pide, como proyecto aparte).
- Sitios web: se cobran aparte y se conectan al sistema según el cliente.
- Terminal de pago integrada: el cobro con tarjeta es manual.
- Nómina: módulo futuro.
- FÉNIX BARBERÍA y Abarrotes Rosi: no forman parte de este diseño.

## 14. Planes y precios (v1, 2026-11-16)

Todos los planes incluyen acceso a todas las funciones y todos los giros. Los planes solo cambian por usuarios incluidos. Precios en MXN, al mes, sin IVA agregado.

| Plan | Mensualidad | Usuarios incluidos |
|---|---|---|
| Inicial | $500 | 3 |
| Crecimiento | $700 | 5 |
| Profesional | $900 | 10 |

Cargos adicionales:
- Sucursal adicional: $300 al mes cada una.
- Usuarios extra: paquetes de 5 por $200 al mes ($40 por usuario).

Ejemplos:
- 1 sucursal con 4 usuarios: plan Inicial ($500) + 1 paquete de usuarios extra ($200) = $700.
- 3 sucursales con 10 usuarios: plan Profesional ($900) + 2 sucursales adicionales ($600) = $1,500.

Reglas:
- El super panel asigna el plan, las sucursales y los usuarios extra de cada negocio.
- Un cambio de plan o de sucursales se aplica al siguiente periodo de cobro, salvo que el super panel indique otra cosa.
- Si el negocio baja de sucursales o usuarios, no se borra ningún dato; solo se ajusta el cobro y el acceso de los usuarios sobrantes queda desactivado.
- Revisión de precios cada 2 meses. Cualquier cambio se anota aquí con fecha y no afecta a los negocios activos sin aviso previo.

Pendiente: definir el costo real por sucursal y por usuario (nube, mensajes de verificación, respaldos y soporte) para confirmar que estos precios los cubren.

## 15. Decisiones (2026-11-17)

- Códigos de verificación: por SMS.
- Alojamiento de staging: Fly.io, región Dallas (dfw), la más cercana a México disponible.
- Boletos y compras por link: quedan por pagar; se liquidan en efectivo o transferencia. Sin pago en línea.
- Báscula: el peso se captura a mano.
- Super panel: verificación en dos pasos con código por SMS y por correo.
- Solicitudes de cambio: sin costo.
- Link de reservas: se cobra como extra con instalación; lo habilita el super panel.
- Días de prueba por defecto: 14. Días vencido antes de poder suspender: 30 (editables en el super panel).
- Pendiente: método para verificar la identidad del dueño que pierde su teléfono.
