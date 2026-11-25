# 50 · Agenda con calendario gráfico (día y semana)

Rama de trabajo: `agenda-calendario` (separada de producción). Todo se probó con datos de demostración en memoria y con **copias aisladas de un respaldo real** de producción; no se tocó producción durante el desarrollo.

## Aviso importante sobre la referencia de Booksy
La captura de Booksy Biz **no llegó a esta sesión** (la carpeta de archivos recibidos solo contiene materiales anteriores; ya se avisó lo mismo en el doc 42). Por eso **no pude comparar píxel a píxel contra esa imagen**. El diseño se hizo siguiendo, punto por punto, la lista de requisitos de tu mensaje (calendario por día/semana, horas en vertical, columnas por profesional con foto y nombre, citas como bloques por duración, colores por estado, navegación, adaptable) y el patrón general de calendario de Booksy descrito en el doc 42 (`42-referencia-visual-booksy-diagnostico.md`). Si me compartes la imagen, la comparo y ajusto.

## Qué se construyó
**Pantalla Agenda** (barbería y uñas): al entrar se ve el **calendario gráfico**; la **lista** sigue como alternativa (control `Día | Semana | Lista`).
- **Día:** horas en vertical (cuadrícula cada 30 min), **una columna por profesional** con su **foto** (dirección https; si no hay, su inicial en un círculo de color) y nombre, citas como **bloques cuya altura depende de la duración**, línea roja de «ahora», filtro por profesional, tira de siete días para cambiar de día con un toque.
- **Semana:** siete columnas (lunes a domingo) para el profesional elegido; tocar un día abre su vista de día.
- **Estados con color y texto** (no solo color): Confirmada (azul), Por confirmar (ámbar, borde punteado), Atendiendo (violeta), **Por cobrar** (verde con contorno), Cobrada (gris), Cancelada (rojo rayado y tachado), No vino (gris). **Espacios disponibles** en blanco con «+» al pasar; **fuera de horario y descansos** rayados; **bloqueos** de agenda con su motivo. Leyenda de colores.
- **Crear:** tocar un espacio disponible abre «Nueva cita» con ese profesional y esa hora; botón «+ Nueva cita» (en celular, botón flotante) y «Cliente sin cita».
- **Detalle de cita** (panel lateral): cuándo, profesional, servicios, duración, total, teléfono, notas, y las acciones **Confirmar, Atender, Terminar, Reprogramar, Editar, No vino, Cancelar cita, WhatsApp**.
- **Reprogramar:** por el detalle (día, profesional y horas libres reales o una hora escrita) o **arrastrando el bloque** con el ratón a otra hora u otra columna. El sistema valida cruces, horarios, descansos y bloqueos; si no cabe, rechaza **sin perder la cita**.
- **Editar:** cliente, teléfono, notas y **servicios** (recalcula la duración y rechaza si choca con la siguiente cita).
- **Flujo acordado intacto:** cita → «Terminar» (queda **Por cobrar**) → «Ver en Caja» → cobro **solo en Caja**; no hay botón «Cobrar» en la Agenda y un segundo cobro se rechaza (409).
- **Mi equipo:** el dueño pone la foto de cada profesional («Fotos del equipo»; se guarda en los ajustes del negocio, **sin migración**).
- **Celular:** encabezado compacto (calendario a la vista sin bajar mucho), controles de 44 px, letra ≥ 18 px, columnas con desplazamiento horizontal, botón «+» flotante. **Tableta y computadora:** columnas amplias, arrastrar y soltar.

## Cambios de servidor (aditivos, sin migraciones)
`GET /agenda?days=7` (rango de hasta 7 días con `hoursByDay`), `PUT /staff/:id/photo` (solo dueño, solo https), `PATCH /appointments/:id` (editar cita abierta con validación de cruces), `GET /agenda/staff` devuelve `photoUrl`. Esquema **sin cambios (48)**.
También: los paneles laterales (`.modal.sheet`) ahora quedan por encima de la barra superior (antes su cabecera quedaba tapada) y el botón activo de los controles segmentados conserva su color con el ratón encima.

## Evidencia
Capturas reales en `docs/modernizacion/capturas/agenda-calendario/`: `escritorio-claro-dia`, `escritorio-oscuro-dia`, `escritorio-claro-semana`, `escritorio-claro-detalle`, `escritorio-claro-lista`, `tableta-claro-dia`, `tableta-oscuro-dia`, `celular-claro-dia`, `celular-oscuro-dia`, `celular-claro-semana`, `celular-claro-lista`.

| Requisito de tu mensaje | Dónde se ve / cómo se comprobó |
|---|---|
| Calendario visual por día y semana | `escritorio-claro-dia`, `escritorio-claro-semana`, `celular-claro-semana`; prueba: 7 columnas de día |
| Horarios verticales | Riel de horas a la izquierda en todas las capturas; prueba: ≥ 8 horas visibles |
| Profesionales con foto y nombre | Cabeceras de columna y chips con foto o inicial; prueba con una foto servida en el navegador |
| Columnas por profesional | `escritorio-claro-dia`, `tableta-claro-dia` |
| Citas como bloques según duración | Alturas distintas por duración (probado: 48/62/78 px en celular según servicio) |
| Colores y estados (confirmada, pendiente, cancelada, disponible) | Leyenda y bloques; prueba: los 6 estados presentes con su clase |
| Navegación entre fechas, días y semanas | ‹ ›, selector de fecha, «Hoy», tira de días, Día/Semana |
| Computadora, tableta y celular | Capturas de los 3 tamaños, claro y oscuro |
| Lista como alternativa | `escritorio-claro-lista`, `celular-claro-lista` |
| Crear, editar, reprogramar, cancelar | Pruebas en pantalla y de servidor (ver abajo) |
| Cruces, horarios y descansos | Pruebas de servidor: cruce, antes de abrir, lunes de descanso, bloqueos |
| Cita → terminar → por cobrar → Caja; sin doble cobro | Prueba en pantalla + 409 en el segundo cobro |
