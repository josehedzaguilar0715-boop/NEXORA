// Llave para cifrar los respaldos de NEXORA (BACKUP_KEY). Se ejecuta en la computadora del propietario.
//   npm run backup:key                 → genera una llave nueva y muestra su huella (no la guarda en ningún lado)
//   npm run backup:key -- --huella     → pide una llave existente (oculta) y muestra su huella, para comprobar
//                                        que la que tienes guardada es la que está activa (super panel → Respaldos)
import { randomBytes } from 'node:crypto'
import { keyFingerprint } from '../src/backup.js'

const mode = process.argv[2]
if (mode === '--huella') {
  const key = process.env.NEXORA_BACKUP_KEY ?? (await new Promise<string>((res) => {
    process.stdout.write('Pega la llave (no se muestra) y presiona Enter: ')
    const stdin = process.stdin
    if (stdin.isTTY) stdin.setRawMode(true)
    let s = ''
    stdin.on('data', (d) => {
      for (const ch of d.toString()) {
        if (ch === '\r' || ch === '\n') { if (stdin.isTTY) stdin.setRawMode(false); process.stdout.write('\n'); stdin.pause(); return res(s.trim()) }
        if (ch === '\u0003') process.exit(1)
        s += ch
      }
    })
  }))
  const raw = Buffer.from(key, 'base64')
  if (raw.length !== 32) { console.error('No es una llave válida (deben ser 32 bytes en base64).'); process.exit(1) }
  console.log(`Huella: ${await keyFingerprint(key)}`)
} else {
  const key = randomBytes(32).toString('base64')
  console.log(`
LLAVE NUEVA (cópiala UNA vez a tu gestor de contraseñas; no se guarda en ningún otro lado):

  ${key}

Huella (para comprobar después, no es secreta): ${await keyFingerprint(key)}

Siguiente paso, con tu autorización y desde tu computadora:
  npx wrangler secret put BACKUP_KEY --env production      (pega la llave cuando la pida)
Sin esta llave, los respaldos cifrados NO se pueden recuperar. Guarda dos copias en lugares distintos.
`)
}
