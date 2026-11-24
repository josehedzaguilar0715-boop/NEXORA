#!/usr/bin/env bash
# Verificación de solo lectura de un despliegue (staging o producción). No crea ni modifica datos.
# Uso: bash scripts/verificar-despliegue.sh https://nexora.ejemplo.workers.dev [esquema-esperado]
# Sale con error si algo falla. Lo ejecuta también la acción «Verificar despliegue» de GitHub, que SÍ llega a internet.
set -u
URL="${1:?Falta la URL}"
ESQ="${2:-$(npx --no-install tsx -e "import {SCHEMA_VERSION} from './src/db.ts'; console.log(SCHEMA_VERSION)" 2>/dev/null | tail -1)}"
fail=0
ok() { echo "✓ $1"; }
ko() { echo "✗ $1"; fail=1; }
code() { curl -s -m 25 -o /dev/null -w '%{http_code}' "$@"; }

h=$(curl -s -m 25 "$URL/api/health" || true)
echo "$h" | grep -q '"ok":true' && ok "salud: $h" || ko "salud: $h"
if [ -n "$ESQ" ]; then echo "$h" | grep -q "\"schema\":$ESQ" && ok "esquema de la base = $ESQ (migraciones aplicadas)" || ko "esquema distinto del esperado ($ESQ): $h"; fi
[ "$(code "$URL/")" = 200 ] && ok "la pantalla principal carga (200)" || ko "la pantalla principal no carga"
curl -s -m 25 "$URL/" | grep -qi "<div id=\"root\"" && ok "la aplicación (React) está en la página" || ko "falta la aplicación en la página"
[ "$(code -X POST -H 'content-type: application/json' -d '{"businessCode":"XXXXXX","username":"nadie","password":"nada"}' "$URL/api/auth/login")" = 401 ] && ok "el acceso rechaza credenciales falsas (401)" || ko "el acceso no respondió 401"
[ "$(code "$URL/api/sales")" = 401 ] && ok "las rutas del negocio exigen sesión (401)" || ko "una ruta con datos respondió sin sesión"
[ "$(code "$URL/api/__interno/respaldo")" = 404 ] && ok "la ruta interna de respaldos no se alcanza desde internet (404)" || ko "la ruta interna es accesible"
[ "$(code "$URL/api/admin/salud")" = 401 ] && ok "la salud del sistema exige sesión de soporte (401)" || ko "la salud del sistema es pública"
curl -sI -m 25 "$URL/" | tr 'A-Z' 'a-z' | grep -q "x-content-type-options: nosniff" && ok "encabezados de seguridad presentes" || ko "faltan encabezados de seguridad"
[ $fail = 0 ] && echo "TODO EN ORDEN" || { echo "HAY FALLOS"; exit 1; }
