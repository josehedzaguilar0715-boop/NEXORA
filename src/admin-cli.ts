// Crea un usuario del super panel.
// ADMIN_PASSWORD=... ADMIN_PHONE=... ADMIN_EMAIL=... npm run admin:create -- <usuario> "<Nombre>"
// Con teléfono y/o correo, el acceso pide un código que llega por SMS y correo (dos pasos).
import { createAdmin } from './admin.js'
import { openDb } from './db.js'
import { createNotifier } from './notify.js'

const [username, name] = process.argv.slice(2)
const { ADMIN_PASSWORD: password, ADMIN_PHONE: phone, ADMIN_EMAIL: email } = process.env
if (!username || !name || !password) {
  console.error('Uso: ADMIN_PASSWORD=... [ADMIN_PHONE=...] [ADMIN_EMAIL=...] npm run admin:create -- <usuario> "<Nombre>"')
  process.exit(1)
}
if (!phone && !email) console.warn('Aviso: sin ADMIN_PHONE ni ADMIN_EMAIL el super panel entra sin segundo paso.')
const db = openDb(process.env.NEXORA_DB ?? 'data/nexora.db')
createAdmin({ db, now: () => new Date(), notifier: createNotifier() }, { username, name, password, phone, email })
console.log(`Super panel: usuario ${username} creado${phone || email ? ' con verificación en dos pasos' : ''}.`)
