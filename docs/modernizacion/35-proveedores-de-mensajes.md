# 35 · Comparativa de proveedores de mensajes para recordatorios (sin contratar nada)

**No se contrató, instaló ni integró ningún servicio de pago. No se generó ningún costo.** Fuente: búsquedas web de hoy; casi todo es de páginas de los proveedores o de terceros y **los precios cambian y a veces se contradicen**: toda cifra debe confirmarse por escrito con el proveedor antes de decidir. Importes de lista, no cotizaciones.

| Opción | Costo (referencia) | Requisitos | Integración con NEXORA | Notas |
|---|---|---|---|---|
| **A. WhatsApp manual (lo que hay hoy)** | $0 | Que el negocio use su WhatsApp | Ya hecho: mensaje escrito + botón; marca «avisado» | Requiere un clic por cliente; no es automático |
| **B. Notificación dentro de la app / push** | $0 (ya existe) | El cliente no tiene app | Solo avisa al negocio y a su equipo, no al cliente final | Útil para «tienes 5 citas por avisar» |
| **C. Correo (p. ej. plan gratuito de un proveedor de correo)** | Gratis hasta un tope mensual (confirmar) | Que el cliente dé su correo (hoy no se pide) | Sencillo (API HTTP) | Menos efectivo en México que WhatsApp |
| **D. WhatsApp Business Platform (API oficial de Meta), directo** | Se cobra por mensaje según categoría: terceros citan para México ≈ US$0.0085 por mensaje «utility» y ≈ US$0.04 «marketing» (cifras discrepantes; MXN disponible desde abril 2026; Meta anunció cambios en cobro de plantillas dentro de la ventana de 24 h a partir del 1-oct-2026) | Cuenta de negocio verificada; número exclusivo; nombre visible con el nombre real del negocio; **plantillas aprobadas por Meta (típ. 24–48 h, a veces hasta una semana)**; **consentimiento (opt-in) explícito** del cliente | Cloud API por HTTP desde el Worker; requiere guardar un secreto (token) en el entorno | Los recordatorios de citas encajan en categoría «utility»; menor costo, mejor llegada |
| **E. WhatsApp vía intermediario (p. ej. Twilio)** | Intermediario cobra aparte: Twilio publica ≈ MXN 0.10 por mensaje + la tarifa de Meta | Igual que D, pero el intermediario hace el alta | API propia del intermediario | Más fácil de empezar, algo más caro |
| **F. SMS** | Twilio publica ≈ US$0.15 por SMS a México (varía por operador); un proveedor mexicano publica ≈ MXN 0.47–0.90 por SMS según volumen (cifras de su propio marketing) | Remitente/registro según normativa mexicana; no hay plantillas que aprobar | API HTTP simple | Funciona sin que el cliente tenga WhatsApp; más caro por mensaje |

## Orden de magnitud (solo ilustrativo, no cotización)
Un negocio con 20 citas al día ≈ 600 recordatorios al mes: por WhatsApp oficial, del orden de decenas a pocos cientos de pesos al mes según tarifa vigente; por SMS, del orden de cientos de pesos. **Confirmar con tarifas del día.**

## Recomendación (para que decidas tú)
1. **Seguir con la opción A** mientras se valida con negocios de prueba (doc 37): costo cero y ya funciona.
2. Si los recordatorios automáticos demuestran valor, evaluar **D (directo) o E (intermediario)**; empezar con **un solo negocio de prueba** y un tope mensual de gasto.
3. Antes de integrar: aviso de privacidad y **consentimiento** del cliente para recibir mensajes; texto de las plantillas (3 modelos: confirmación, recordatorio, cancelación); política de quién paga el consumo (¿el negocio lo asume, se cobra aparte, o va incluido en el plan?).
4. **Necesito de ti:** autorización para abrir cuenta, quién la paga, tope mensual, y el modelo comercial. Nada de esto se hace sin tu autorización expresa.

Fuentes consultadas: documentación de precios de Meta (WhatsApp Business Platform), páginas de precios de Twilio (SMS México y WhatsApp), guías de terceros (Telnyx, Vonage, Wati, Sleekflow, Courier), y comparativas de proveedores de SMS. **Verificar todo en las páginas oficiales actuales.**
