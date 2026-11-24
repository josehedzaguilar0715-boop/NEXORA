# 18 · Respaldo y exportación de datos de un negocio (formato y restauración)

Pantalla: **Configurar → «Respaldo y exportación de datos»** (solo el dueño). Código: `src/datos.ts`.

## 1. Qué puede hacer el dueño

| Acción | Detalle |
|---|---|
| Descargar su información completa | `GET /data/export` → archivo `.json` con todo su negocio. Funciona **aunque la cuenta esté vencida o suspendida**. |
| Saber cuándo se generó y qué contiene | El archivo trae su resumen (`manifest`); la pantalla muestra la última descarga y el número de registros por área. |
| Respaldos automáticos por negocio | Cada noche, un archivo por negocio (30 días, cifrado si hay `BACKUP_KEY`) con registro de fecha, tamaño, huella y resultado. Se pueden **verificar** (huella + integridad) y hacer uno manual (máx. uno cada 5 min). |
| Recuperar | **Simulación** (se ejecuta todo y se deshace) → ver qué se agregaría → escribir `RESTAURAR` → se aplica. Desde un archivo o desde uno de sus respaldos. |

## 2. Formato `nexora-negocio` v1

```json
{
  "format": "nexora-negocio", "formatVersion": 1,
  "manifest": {
    "businessId": "…", "businessName": "…", "exportedAt": "2026-11-24T05:00:00.000Z",
    "schemaVersion": 42,
    "counts": { "sales": 90, "products": 172, … },
    "excluded": { "tables": [ … ], "columns": { "users": ["password_hash", …] } },
    "note": "…"
  },
  "tables": { "sales": [ { "id": "…", "business_id": "…", … } ], … },
  "sha256": "huella de {manifest, tables}"
}
```

* Cada tabla es una lista de renglones tal como están en la base (dinero en **centavos**, cantidades en **milésimas** `*_milli`, fechas ISO UTC, identificadores UUID). Las relaciones se conservan por identificador.
* Qué tablas son del negocio lo define `src/partition.ts` (clasificación vigilada por prueba: toda tabla nueva debe clasificarse o las pruebas fallan).
* **Nunca incluye**: contraseñas ni códigos de autorización (hashes), contadores de bloqueo, sesiones, dispositivos de confianza, códigos de verificación, suscripciones push, llaves del sistema, enlaces/tokens públicos (`appointments.public_token`, `entry_tickets.order_token`), usuarios del super panel ni bitácoras técnicas. Comprobado con búsqueda de hashes en el archivo.
* `sha256` permite detectar un archivo dañado o alterado; no es una firma (quien tiene el archivo de su propio negocio puede rehacerlo, y aun así solo puede agregar a su propio negocio).

## 3. Reglas de la restauración

1. **Negocio propietario**: el `businessId` del archivo debe ser el del negocio con sesión; si no, se rechaza («es de OTRO negocio»). Un archivo con renglones de otro negocio, o cuyos identificadores pertenezcan a otro negocio, se rechaza.
2. **Integridad**: la huella debe coincidir; el número de renglones por tabla, igual al resumen.
3. **Compatibilidad**: formato igual; versión de esquema del archivo ≤ la del sistema (más nueva se rechaza). Tablas que ya no existen se omiten con aviso.
4. **Relaciones**: todo se carga en una transacción con referencias diferidas; si al final quedara una referencia rota, **no se carga nada**.
5. **Duplicados y datos nuevos**: solo se **agrega lo que falta**. Lo que ya existe no se toca: si es igual cuenta como «ya está»; si cambió después del respaldo cuenta como «distinto» y **se conserva lo actual**.
6. **Personas**: los usuarios que se restauran quedan sin contraseña válida y con «cambiar contraseña»; el dueño les asigna una nueva (el dueño que falte se recupera con *Super panel → Restablecer acceso del dueño*).
7. **Confirmación explícita**: `POST /data/import/confirm` exige la palabra `RESTAURAR` y la huella del archivo simulado; vuelve a simular antes de aplicar.
8. Cada simulación, restauración, descarga y respaldo manual queda en la **bitácora** del negocio.
9. Interruptor `importar_respaldo` (super panel) para apagar solo la restauración.

## 4. Acceso a respaldos entre negocios

El identificador del negocio sale **de la sesión**, nunca de la petición. Un respaldo se localiza por su registro (`backup_log`) filtrado por ese negocio; un dueño que pida el respaldo de otro recibe 404 (probado). Los archivos en KV se nombran `negocio-<id>-<fecha>` y solo el servidor accede a ellos.

## 5. Recuperación de un negocio en un servidor nuevo (soporte)

`scripts/verificacion/ensayo-respaldo.ts` hace, sobre cualquier respaldo y en una carpeta nueva: restaurar la base completa, migrar «en el sitio» y exportar/restaurar cada negocio comparando renglón por renglón. Los cobros del super panel (`one_time_charges`) referencian al usuario de soporte que los registró: si ese usuario no existe en el destino se omiten con aviso (en el mismo sistema existen siempre).
