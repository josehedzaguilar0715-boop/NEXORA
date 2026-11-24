# Cómo continuar NEXORA en Floot

**Importante, antes de empezar:** este ZIP es el proyecto completo y funciona tal cual en Node o en Cloudflare. Pero **Floot no ejecuta este código sin cambios**. Floot tiene su propio formato de proyecto, y migrar significa **reescribir el backend y la base de datos a la forma de Floot**, reutilizando la lógica, las pantallas, el diseño y las pruebas. Este documento dice qué se reutiliza, qué cambia y en qué orden hacerlo sin perder nada.

(Basado en la guía oficial de Floot, `floot-overview`, consultada el 23 nov 2026.)

## 1. Diferencias que importan

| NEXORA hoy | Floot | Consecuencia |
|---|---|---|
| **SQLite** (Durable Object) con 41 migraciones | **Postgres** (kysely + postgres-js); columnas en `snake_case`; ENUM para estados | Traducir el esquema (`esquema-sqlite.sql`) a Postgres. Las fechas son texto ISO y el dinero son enteros en centavos: conviene mantenerlo así. Los *triggers* «no borrar» se reescriben en Postgres. |
| API **Hono**: ~320 rutas con `:id`, y métodos GET, POST, PUT, PATCH y DELETE | Un archivo por ruta y método en `endpoints/`, **solo GET y POST**, **sin parámetros en la ruta** | Cada ruta pasa a ser `endpoints/<ruta>_<GET|POST>.ts` con su `.schema.ts`. El `:id` va en el cuerpo o en la consulta. PUT, PATCH y DELETE pasan a POST. |
| Base **síncrona** (`db.prepare().get()`) dentro de transacciones | Postgres **asíncrono** | Toda la lógica de `src/*.ts` necesita `await`. Las transacciones de dinero e inventario se vuelven `db.transaction().execute(async (trx) => …)`. **Es el cambio más grande y el más delicado.** |
| Middleware de Hono: sesión, negocio vigente, idempotencia | `endpoints/_middleware.ts` con `before()` | Se traduce casi 1 a 1. |
| Sesiones y contraseñas propias (scrypt, token con sha256) | Floot ofrece su propio inicio de sesión, o se puede conservar uno propio | Para no obligar a los usuarios a cambiar contraseña, conservar el esquema propio (tablas `users` y `sessions`) y migrar los hashes tal cual. |
| Límite por IP en memoria (`cf-connecting-ip`) | Endpoints serverless sin memoria; IP en `x-floot-client-ip`; firewall de Floot con límites por ruta en planes de pago | Mover el contador a una tabla de Postgres, o usar los límites de Floot. |
| **Service worker propio** (`web/public/sw.js`): app sin internet y push | **Floot prohíbe service workers propios**; tiene su push integrado (`@floot/push`) | ⚠️ **Hay que decidir cómo se conserva el funcionamiento sin internet.** La cola de ventas (`localStorage` + id único) sí funciona sin service worker, pero la app no abriría sin red si no estaba abierta. Hay que confirmar con Floot qué ofrece. El push se cambia a `@floot/push`. |
| Encabezados de seguridad (CSP) en el código | Floot los maneja; **no ponerlos en el código** | Quitar `src/headers.ts`. |
| Cron diario de Cloudflare (respaldo) | Tareas programadas de Floot y respaldos propios de Postgres | El respaldo propio pasa a ser opcional. |
| Pantallas React 18 + Vite, ruteo por `#/` | React 19, carpetas `pages/`, `components/`, `helpers/`, React Router, CSS Modules y kit de componentes de Floot | Las 30 pantallas se reutilizan en su lógica. Hay que repartirlas en `pages/` y `components/`, y pasar los estilos globales a `base.css` y a módulos CSS. |
| Identidad por giro con `data-product` y variables CSS | `base.css` con variables (modo claro y oscuro) | Las 13 paletas de `web/src/products/products.css` se copian como variables. |
| Pruebas vitest (268) | Floot solo ejecuta pruebas de *helpers* (`.spec.tsx`) | Conservar la lógica de negocio en *helpers* puros y migrar sus pruebas. Las pruebas de este ZIP sirven como **especificación** de qué debe dar cada caso. |

## 2. Lo que se reutiliza casi sin cambios

* **Reglas de negocio:** cálculo de corte, PEPS, comisiones, 50/30/20, retiro sugerido, verificación de efectivo, vocabulario por giro, pendientes y primeros pasos. Están en `src/*.ts` y conviene separarlas en funciones puras.
* **Validaciones Zod:** Floot también usa Zod en los `.schema.ts`.
* **Textos y mensajes en español**, estructura de pantallas y flujos.
* **Paletas y diseño** de los 13 productos.
* **Las pruebas como lista de comportamiento esperado:** sobre todo `test/dia-completo.test.ts`, `test/<giro>.test.ts`, `test/permisos-barrido.test.ts` y `test/aislamiento-negocios.test.ts`.

## 3. Orden sugerido (sin poner en riesgo a los 3 negocios reales)

1. **No apagar Cloudflare.** Producción sigue ahí hasta que Floot esté probado.
2. En Floot:
   * crear el proyecto y la base Postgres;
   * traducir el esquema (empezar por negocios, usuarios, sesiones, productos, lotes, ventas, pagos, turnos y movimientos);
   * guardar el plan en `static/__dev/plans/`.
3. Migrar primero **el núcleo de un giro** (abarrotes): entrar, productos, caja, venta, corte. Repetir en Floot los casos de `test/abarrotes.test.ts` y `test/dia-completo.test.ts` hasta que den lo mismo.
4. Seguir giro por giro (los demás comparten caja, inventario y fiado).
5. **Datos reales:**
   * exportar un respaldo (`/admin/export` o el respaldo diario);
   * cargarlo a una **copia** de prueba en Floot (rama de Floot) y comparar totales por negocio: ventas, existencias y saldos de fiado;
   * solo entonces planear el cambio definitivo, con autorización y un respaldo verificado.
6. Al final, decidir el funcionamiento sin internet (ver la advertencia del service worker).

## 4. Riesgos de la migración

* **Transacciones asíncronas:** el error más probable es perder la atomicidad en ventas, cortes y pagos. Hay que probar cada caso de dinero.
* **Sin internet:** posible pérdida de la app sin conexión (ver arriba). Es crítico para tiendas con mala señal.
* **Cambio de contraseñas o sesiones:** si se cambia el sistema de inicio de sesión, todos los usuarios tendrían que volver a entrar o reiniciar su contraseña.
* **Tamaño del trabajo:** son ~18,000 líneas de TypeScript, ~320 rutas y 102 tablas. Es un proyecto de semanas, no un copiar y pegar.
