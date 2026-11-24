# Estrategia de crecimiento: de 3 a 500 negocios sin poner en riesgo los datos

Fecha: 24 nov 2026. Rama `modernizacion`. **No se cambió nada de la infraestructura de Cloudflare.**

## 1. El límite real (medido, no estimado)

Hoy **todos los negocios comparten una sola base** (un Durable Object con SQLite). Tiene dos límites.

**Espacio**

* Tope de 1 GB por base en el plan gratis y 10 GB en el de pago.
* Cada venta ocupa ~2.9 KB, así que un negocio activo suma ~160 MB al año.
* Ver `08-seguridad.md` §5. El super panel ya lo vigila (*Ajustes → Espacio de la base*).

**Velocidad: la base atiende una petición a la vez**

| Medición (motor de Cloudflare en local, `scripts/verificacion/carga.cjs`) | Antes | Ahora |
|---|---|---|
| Venta sola (sin cola) | 13 ms | 12 ms |
| Panel de Inicio con 4 negocios | 63 ms | 24 ms |
| Peticiones por segundo en saturación (30 conexiones) | ~71 | **~98**, sin errores y sin ventas perdidas ni duplicadas |
| **Panel de Inicio con 40 negocios y 39,285 ventas** (`scripts/verificacion/bench-panel.ts`) | **3,122 ms** | **13.7 ms** |
| Reporte diario, misma base | 666 ms | 4 ms |
| Resumen de ventas, misma base | 151 ms | 1.4 ms |

**Error grave encontrado y corregido.** Faltaban índices por negocio y fecha. Cada reporte recorría las ventas de **todos** los negocios, así que con unas decenas de negocios **cada apertura del Inicio detenía a todos los negocios ~3 segundos**.

* Corrección: la migración 40 solo agrega índices.
* Además, las pantallas ya no consultan al servidor cuando no están a la vista.

**Capacidad estimada de una sola base, ya corregida:**

* Cada equipo con el Inicio abierto hace ~10 consultas por minuto.
* Con ~100 peticiones por segundo de techo, una base atiende cómodamente **~100 a 150 negocios** (2 equipos cada uno).
* **No alcanza para 500.** Para eso hay que separar la base.

## 2. La estrategia: una base por negocio (por etapas y reversible)

```
Hoy:            Worker → [ base «principal»: todos los negocios ]

Destino:        Worker → [ base «directorio»: cuentas, sesiones, super panel, planes ]
                       → [ base del negocio 1 ]  [ base del negocio 2 ]  …  [ base del negocio N ]
```

* Cada negocio tiene su propia base de hasta 10 GB y su propia velocidad. Ya no compiten entre sí.
* Un problema en un negocio no toca a los demás.
* Los respaldos y restauraciones se hacen por negocio.

### Etapas

| # | Etapa | Estado | Riesgo para los datos |
|---|---|---|---|
| 1 | **Índices y menos consultas de fondo** (multiplica la capacidad de la base actual) | ✅ **Hecho y probado** | Ninguno: solo agrega índices |
| 2 | **Clasificar cada tabla** (de un negocio, o global) y **extraer un negocio completo** | ✅ **Hecho y probado**: 102 tablas clasificadas. Con los 13 giros, la suma de las extracciones es exactamente la base (1,464 renglones, sin repetidos ni faltantes), y cada negocio cargado solo da el mismo resumen y su dueño entra igual (`test/particion.test.ts`). | Ninguno: solo lee |
| 3 | **Elegir el objeto de datos** (`DB_OBJECT`) y **restaurar en un objeto vacío** | ✅ **Hecho y probado** en el motor de Cloudflare (98 tablas, 0 diferencias). Ver `12-respaldos-y-recuperacion.md`. | Ninguno: nunca escribe en un objeto con datos |
| 4 | **Directorio**: el Worker averigua a qué base va cada petición (por el token de sesión o el negocio) | Pendiente (~1 semana) | Bajo, si se prueba primero en staging |
| 5 | **Mover un negocio**: copiar su extracción a su base nueva, comparar conteos y sumas, cambiar su ruta en el directorio | Pendiente (~3 días, con las piezas 2 y 3 ya hechas) | Bajo: **la base vieja no se borra**; volver atrás es cambiar la ruta de nuevo |
| 6 | Mover los negocios uno por uno: primero las demos, después un negocio real con su permiso | Pendiente | Controlado: uno a la vez, con respaldo verificado antes |

### Reglas para no poner en riesgo los datos

1. **Nunca se borra la base original** durante la migración. Queda como respaldo vivo.
2. Cada movimiento se verifica: conteo por tabla, suma de ventas y existencias, y el dueño entra y ve lo mismo.
3. Se empieza en staging, sigue con las demos y al final los negocios reales, uno por uno y con autorización.
4. Respaldo verificado (y cifrado) antes de cada paso.

## 3. Cuándo hacer cada cosa

| Negocios activos | Qué hacer | Costo |
|---|---|---|
| 3 a ~30 | Nada más: la base actual con los índices nuevos alcanza. Vigilar *Espacio de la base*. | $0 (plan gratis) |
| ~30 a ~100 | Etapas 4 y 5 en staging. Pasar al plan de pago de Cloudflare cuando las escrituras diarias se acerquen a 100,000. | $5 USD/mes |
| ~100 a 500 | Etapa 6: cada negocio en su base. | ~$5 a $20 USD/mes en total (ver `09-arquitectura-comercial.md` §4) |

## 4. Límites de la cuenta gratis que afectan a producción

* Staging y producción **comparten la cuenta**, y con ella los topes diarios del plan gratis: 100,000 peticiones y 100,000 renglones escritos al día.
* Por eso las pruebas de carga grandes se hicieron en el motor local y **no contra staging**. Una prueba de carga fuerte contra staging podría dejar sin cuota a los 3 negocios reales ese día.
