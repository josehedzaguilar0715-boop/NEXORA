# 48 · Procedimiento exacto: instalar `BACKUP_KEY`, comprobar huella, respaldo cifrado y descifrado aislado

Sin repositorio, sin VS Code: solo **PowerShell** en tu computadora con Windows y el **panel de Cloudflare**. La llave nace en tu computadora, vive en tus dos lugares de resguardo y en Cloudflare; **nunca pasa por el chat ni por mí**. Candidato y producción no cambian: guardar el secreto publica una nueva versión del mismo código (sin migraciones, sin tocar datos).
Verificado en el código: la llave debe ser **Base64 de exactamente 32 bytes**; la huella es SHA-256 de los bytes, 6 bytes en hexadecimal mayúscula `XXXX-XXXX-XXXX`; el respaldo cifrado se llama `nexora-….json.gz.enc` (también los respaldos por negocio); formato `NXE1` + IV de 12 bytes + AES-256-GCM (etiqueta de 16 bytes al final). Todo probado con una llave descartable (no la tuya).

## Paso 1 · Generar la llave (PowerShell de Windows, 1 minuto)
Menú Inicio → escribe `PowerShell` → ábrelo → pega y presiona Enter:
```
$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
$k = [Convert]::ToBase64String($b)
$h = [Security.Cryptography.SHA256]::Create().ComputeHash($b)
Set-Clipboard $k
"Huella: " + ((($h[0..5] | % { $_.ToString('X2') }) -join '') -replace '(.{4})(?=.)','$1-')
```
La llave **no se muestra**: queda en el portapapeles. Se muestra la **huella** (no secreta). Apúntala.

## Paso 2 · Guardarla en dos lugares (antes de instalarla)
1. **Gestor de contraseñas** (por ejemplo Bitwarden gratis): entrada «NEXORA BACKUP_KEY» → pega la llave (Ctrl+V) y anota también la huella.
2. **Papel o memoria USB, guardado en otro lugar físico:** en PowerShell escribe `$k` y Enter para verla **una sola vez**; cópiala a mano o imprímela, con la huella.
No la mandes por WhatsApp, correo ni chat, no le tomes captura y no la guardes en un archivo de la computadora. **Si se pierde, los respaldos cifrados no se pueden recuperar.**

## Paso 3 · Instalarla en Cloudflare (2 minutos)
1. dash.cloudflare.com → **Workers y Pages** → **nexora** (el de producción; no «nexora-staging») → **Configuración** → **Variables y secretos** → **Agregar**.
2. Tipo **Secreto**; nombre exacto `BACKUP_KEY`; valor: Ctrl+V (la llave sigue en el portapapeles). Guarda e **implementa**.
3. Vuelve a PowerShell: `Set-Clipboard $null` y ciérralo (o cierra la ventana).
Se agrega solo ese secreto; los `ADMIN_*` y el resto no se tocan. Puede haber un corte de segundos.

## Paso 4 · Comprobar la huella
Super Panel → Ajustes → **Respaldos** debe decir «🔒 Cifrados. Huella de la llave activa: XXXX-XXXX-XXXX». **Debe ser idéntica a la del Paso 1.** Pégame esa huella aquí (no es secreta). Si no coincide o el panel da error: ve a «Si algo sale mal».

## Paso 5 · Generar el respaldo cifrado
Super Panel → Respaldos → **Crear respaldo ahora**. El archivo nuevo debe terminar en **`.json.gz.enc`**. Avísame «listo». Yo (solo lectura) lo descargo del almacén y compruebo: firma `NXE1`, que **no** es un gzip legible, tamaño razonable y que el secreto `BACKUP_KEY` aparece en la lista de secretos (solo nombres).

## Paso 6 · Descifrado y lectura aislados con tu llave guardada (PowerShell 7, ≈5 min)
Prueba que **tu copia guardada** abre el respaldo, sin guardar nada descifrado en el disco.
1. Descarga el `.json.gz.enc` desde Super Panel → Respaldos (botón de descarga) a tu carpeta Descargas.
2. Instala PowerShell 7 si no lo tienes: en PowerShell escribe `winget install --id Microsoft.PowerShell -e` y luego abre **«PowerShell 7»** desde Inicio.
3. Pega y presiona Enter (te pedirá la ruta del archivo y la llave **oculta**; toma la llave de tu gestor de contraseñas):
```
$ruta = (Read-Host "Ruta del archivo .json.gz.enc").Trim('"')
$s = Read-Host "Llave (no se muestra)" -AsSecureString
$kb = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
$key = [Convert]::FromBase64String($kb.Trim())
if ($key.Length -ne 32) { throw "La llave no mide 32 bytes" }
$h = [Security.Cryptography.SHA256]::HashData($key)
"Huella de la llave que escribiste: " + ((($h[0..5] | % { $_.ToString('X2') }) -join '') -replace '(.{4})(?=.)','$1-')
$d = [IO.File]::ReadAllBytes($ruta)
if ([Text.Encoding]::ASCII.GetString($d, 0, 4) -ne 'NXE1') { throw "No es un respaldo cifrado de NEXORA" }
$iv = $d[4..15]; $ct = $d[16..($d.Length - 17)]; $tag = $d[($d.Length - 16)..($d.Length - 1)]
$plain = New-Object byte[] $ct.Length
[Security.Cryptography.AesGcm]::new($key).Decrypt($iv, $ct, $tag, $plain)
$gz = [IO.Compression.GZipStream]::new([IO.MemoryStream]::new($plain), [IO.Compression.CompressionMode]::Decompress)
$r = [IO.StreamReader]::new($gz).ReadToEnd() | ConvertFrom-Json
$t = $r.tables
"Descifrado correcto. Versión: $($r.version) · tablas: $(@($t.PSObject.Properties).Count) · negocios: $(@($t.businesses).Count) · usuarios: $(@($t.users).Count) · productos: $(@($t.products).Count) · ventas: $(@($t.sales).Count)"
Remove-Variable kb, key, s -ErrorAction SilentlyContinue
```
Debe mostrar **la misma huella** del Paso 1 y «Descifrado correcto» con cifras coherentes con el respaldo sin cifrar de las 09:17 UTC: **versión 48 · 108 tablas · 11 negocios · 22 usuarios · 172 productos · ventas ≥ 99**. Con una llave equivocada falla con un error de autenticación (eso también es una buena señal). Pégame esas dos líneas (huella y cifras).

## Paso 7 · Qué declararé y qué no
- Declaro **«cifrado activo y descifrable con la llave guardada»** cuando: la huella del panel = la del Paso 1 = la del Paso 6, el respaldo termina en `.enc` con firma `NXE1`, y el Paso 6 da cifras coherentes.
- **Restauración completa a una base de datos con ese archivo cifrado** (el script `restore.ts`) necesita Node y el repositorio; no la declaro comprobada con tu llave real. Sí está comprobada en pruebas automáticas con llave de prueba (restaurar con llave funciona; sin llave o con otra falla) y con respaldos reales sin cifrar restaurados en bases aisladas (integridad ok, 0 referencias rotas). Si más adelante quieres la prueba completa con tu llave real, hay una opción con GitHub Actions (llave como secreto de GitHub, que no se puede volver a leer); te la preparo solo si la pides.

## Si algo sale mal (todo reversible)
- **Huella distinta, error en la pantalla de Respaldos o el respaldo no termina en `.enc`:** Cloudflare → nexora → Variables y secretos → `BACKUP_KEY` → **Eliminar** → implementar. Todo vuelve a como estaba hoy (respaldos sin cifrar). Los respaldos ya cifrados solo se abren con esa llave: conserva la llave hasta que expiren (30 días).
- **Llave pegada mal:** los respaldos fallan en lugar de guardarse sin cifrar (por diseño); se detecta en el Paso 4/5. Repite los Pasos 1–3 con una llave nueva.
- **Corte de segundos al implementar:** normal; si tras 2 minutos la aplicación no responde, elimina el secreto y avísame.

## Lo que hago yo en cada paso (solo lectura)
Tras tu «listo»: lista de secretos (nombres), lista y descarga del respaldo `.enc` más nuevo, comprobación de firma/formato, «Verificar despliegue» de GitHub y errores en Cloudflare. No genero, pido ni instalo la llave. No publico nada.
