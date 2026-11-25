# 51 · Lanzamiento de la Agenda con calendario gráfico

Autorización expresa del propietario (25-nov-2026) para publicar la mejora de Agenda en el Worker de producción `nexora`.

| Dato | Valor |
|---|---|
| **Nuevo despliegue (Version ID)** | **`9a0ff173-b574-420a-97d9-5d31271e446b`** (100 % del tráfico, 25-nov 15:46:01 UTC) |
| Despliegue anterior (reversión inmediata) | `51773d59-c582-40b8-bfbe-a72451fa9de9` (evolución del 25-nov); antes `34191efa-5149-4d55-ad8f-6a40bd2b8179` |
| Commit publicado | `f5e26ed1aafd1a1d1942af5062a1b3b69eb02628` (rama `agenda-calendario`) |
| Cómo se publicó | Copia limpia del commit (`git worktree`) → `npm run build:worker` → `wrangler deploy --env production`. No se tocó `nexora-staging` |
| Migraciones / esquema | **Ninguna**; esquema 48 antes y después. Sin cambios en `src/db.ts`, `wrangler.toml`, `package.json`, permisos, roles, planes ni precios |
| Datos | Despliegue solo de código; no se tocaron citas, clientes, ventas, inventarios ni históricos |

## Pruebas antes de publicar (todas en verde)
- Tipos del servidor y de la web sin errores; **353 pruebas automáticas** (se agregaron 4: rango de días, fotos, editar/reprogramar sin cruces); prueba **punta a punta** (actualizada al calendario); CI de GitHub en verde en los tres commits de la rama.
- **Calendario en navegador** (escritorio, tableta y celular × claro y oscuro): columnas por profesional con foto, bloques por duración, los seis estados con su color, espacios disponibles y bloqueos, semana de 7 columnas, lista; contraste, letra ≥ 18 px en celular, desborde y nombres accesibles sin hallazgos.
- **Funciones en pantalla:** abrir el detalle, editar, reprogramar con horas libres, **arrastrar** una cita a otra hora o columna (sin perderla), terminar → «Por cobrar», cobro solo en Caja (sin botón «Cobrar» y sin doble cobro), cancelar con motivo, tocar un espacio libre abre «Nueva cita».
- **Auditoría de todas las pantallas de barbería y uñas** (64 en claro y 64 en oscuro): 0 hallazgos.
- **Motor real de Cloudflare** (local): 11 comprobaciones en verde (cruces 409, semana, editar, reprogramar, foto https, 401 sin sesión, esquema 48).
- **Copias aisladas de un respaldo real de producción:** flujos de barbería, uñas y abarrotes con el código nuevo (46 comprobaciones, incluidas semana, edición y reprogramación) y recorrido en navegador de todas las pantallas de barbería y uñas en claro y oscuro (104 por modo): único hallazgo, el desborde cosmético ya conocido de Ajustes en celular.
- **Respaldo recuperable previo:** `nexora-2026-11-25T09-17` y `…T03-56` (esquema 48, restaurados en bases aisladas, comparados sin pérdidas) y respaldos por negocio.

## Verificación posterior
- Lista de despliegues de producción: `9a0ff173…` al 100 %.
- Cloudflare (observabilidad), desde el despliegue: ver actualización al final de este documento.
- «Verificar despliegue» (GitHub): el disparo directo devolvió error 500 de GitHub (varios intentos); se repitió una ejecución anterior (`run 8`, intento 2), que consulta el sitio en vivo. Resultado al final de este documento.

## Limitaciones
- **La captura de Booksy no llegó a la sesión**; la comparación se hizo contra la lista de requisitos del mensaje y el patrón descrito en el doc 42, no contra la imagen. Ver doc 50.
- Arrastrar y soltar funciona con ratón (computadora y tableta con ratón); en pantalla táctil se reprograma con el botón «Reprogramar» del detalle.
- La foto del profesional se agrega con una dirección https (sin carga de archivos, por costo de almacenamiento).
- Desde el entorno de desarrollo no se alcanza el dominio de producción; no se operaron cuentas reales (ni se crearon citas en los negocios activos).
- Hallazgo menor preexistente (no causado por esta versión): Ajustes desborda 16 px en celular en un negocio con el enlace de reservas activo.
- `giros6.cjs` e `internet-lento.cjs` (scripts manuales anteriores) esperan la vista de lista en la Agenda.

## Reversión (si hiciera falta)
`CLOUDFLARE_API_TOKEN=dummy NODE_USE_ENV_PROXY=1 npx wrangler rollback 51773d59-c582-40b8-bfbe-a72451fa9de9 --env production --message "reversión"`. Solo código; la única clave nueva en datos es `fotosPersonal` (ajustes), que la versión anterior ignora.

## Resultado de la verificación posterior (25-nov 15:48 UTC)
| Comprobación | Resultado |
|---|---|
| Despliegues de producción | `9a0ff173-b574-420a-97d9-5d31271e446b` al 100 % |
| GitHub «Verificar despliegue» (repetición de la ejecución 8, intento 2, 15:48 UTC: producción **y** staging) | **En verde**: salud, esquema 48, pantalla principal, aplicación en la página, credenciales falsas rechazadas, rutas con datos exigen sesión, ruta interna de respaldos no alcanzable, salud del sistema con sesión de soporte, encabezados de seguridad |
| Cloudflare (observabilidad) desde el despliegue | 13 eventos, **0 de nivel error** |
| Incidencias | Ninguna (el único tropiezo fue un error 500 de GitHub al disparar el flujo directamente; se resolvió repitiendo la ejecución) |

Seguimiento: revisión automática a las 16:08 UTC (con reversión a `51773d59…` si hubiese errores repetidos) y comparación del respaldo de las 09:17 UTC del 26-nov.
