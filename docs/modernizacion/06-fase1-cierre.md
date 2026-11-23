# Fase 1 — Cierre del trabajo en curso

Fecha: 23 nov 2026 · Rama `modernizacion` (`8cc2d05`) · Staging `0bc5a23b` · Producción **sin cambios** (`2c16921e`).

## 1. Tipos de prueba (cómo leer este documento)

| Tipo | Qué significa |
|---|---|
| **Automatizada** | Corre sola sobre una base de prueba en memoria o local (vitest, Playwright local). |
| **Real en staging** | Navegador real contra el servidor de staging en Cloudflare (internet real, base real de staging con datos de prueba). |
| **Simulada** | Una parte se imita (p. ej. el servicio de push de Google o un internet lento). Se dice qué se imitó. |
| **Real en producción (solo lectura)** | Registros y lista de respaldos de producción; no se abre ni se cambia nada. |

## 2. Resultados

| Prueba | Tipo | Resultado |
|---|---|---|
| 216 pruebas de servidor (`npx vitest run`) | Automatizada | **216/216** |
| Prueba de punta a punta en navegador (`npm run e2e`) | Automatizada | **OK** |
| Recorrido de 296 pantallas: 13 giros × dueño/empleado × celular/computadora | Automatizada (local) | **Sin hallazgos** |
| Flujos completos de 6 giros (uñas, perfumería, palapa, comedor, taquería, verdulería) | Automatizada (local) | **43/43 pc, 43/43 celular** |
| 13 demos en el motor de Cloudflare (workerd local) | Automatizada | **OK** |
| Flujos de 6 giros **contra staging** | **Real en staging** | Celular **43/43**; computadora 42/43 en la última corrida (la falla fue una página que no terminó de cargar por la red de este entorno, ver §4) |
| Internet lento (respuestas con 1.5 s de retraso) y venta sin internet | **Simulada** (retraso y corte de red imitados en el navegador) | **8/8** |
| Avisos al celular que se reactivan solos | **Simulada** (servicio de push de Google imitado) | Funciona; **no probado en teléfono real** |
| Estado de los 3 negocios reales | **Real en producción (solo lectura)** | Ver §5 |

## 3. Errores reales encontrados y corregidos en esta fase

Todos se encontraron **probando contra staging con internet real** (en local no aparecían por ser instantáneo):

1. **Horario de agenda perdía lo marcado.** Si se marcaba «Atiende citas» antes de que llegara el horario guardado, al llegar lo sobrescribía y se guardaba «no atiende». Efecto: la técnica no aparecía en la agenda («No hay horas libres»). → El formulario espera a tener los datos.
2. **Horas libres en desorden.** Al cambiar servicio/a domicilio/traslado, respuestas viejas podían llegar después de las nuevas y mostrar horas que no correspondían. → Solo cuenta la última; una hora que ya no cabe se quita.
3. **Ajustes y tarjeta de sellos podían guardar vacío.** Si la carga fallaba o tardaba, «Guardar módulos» podía apagar todos los módulos (p. ej. los sellos de Fénix). → No se puede guardar hasta tener los datos; si falla la carga se avisa.
4. **Conteo de inventario con ventas sin enviar.** Una venta cortada por la red queda «por enviar»; si en ese momento se contaba el inventario, el conteo anotaba diferencias falsas y al enviarse la venta la existencia quedaba descontada dos veces. → No se puede contar (ni cerrar la carne) con ventas pendientes en ese equipo; primero se envían. El corte de caja ya era seguro (va en la misma cola).

Las ventas reintentadas **no se duplican** (identificador único por venta; prueba existente en `test/sync.test.ts`).

## 4. Lo que falla y no es de NEXORA

* Este entorno de pruebas sale a internet por un proxy que a veces corta conexiones (se vio un 502 y una carga de página de más de 30 s). Los registros de staging de esa hora: **2,000 peticiones, mediana 28 ms en servidor, p95 89 ms, máximo 438 ms, 0 errores 5xx**. Es decir, staging respondió bien; el corte fue en el camino del entorno de pruebas.
* Por eso los recorridos contra staging usan `SLOW=3` (esperas fijas ×3) y `NODE_USE_ENV_PROXY=1` (ver `scripts/verificacion/README.md`).

## 5. Los tres negocios reales (producción, solo lectura)

* Versión en producción: `2c16921e` (la misma desde el 19 nov; nada publicado desde entonces).
* Últimas 24 h: 2,000 peticiones registradas; **0 errores de servidor**; ventas, servicios y ajustes de sellos registrándose normalmente.
* Respaldos diarios del 18 al 23 nov, tamaño creciente (20 KB → 118 KB): los datos siguen creciendo y respaldándose.
* No se abrieron datos de clientes.

## 6. Permiso agregado en esta fase

* Red del entorno: se agregó solo `nexora-staging.josehedzaguilar0715.workers.dev` (para probar staging en navegador). Producción sigue fuera del alcance de este entorno.
