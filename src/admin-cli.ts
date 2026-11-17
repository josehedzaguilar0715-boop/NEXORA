// Crea un usuario del super panel: ADMIN_PASSWORD=... npm run admin:create -- usuario "Nombre"
import { createAdmin } from './admin.js'
import { openDb } from './db.js'

const [username, name] = process.argv.slice(2)
const password = process.env.ADMIN_PASSWORD
if (!username || !name || !password) {
  console.error('Uso: ADMIN_PASSWORD=... npm run admin:create -- <usuario> "<Nombre>"')
  process.exit(1)
}
const db = openDb(process.env.NEXORA_DB ?? 'data/nexora.db')
createAdmin({ db, now: () => new Date(), notifier: { sendCode: () => {} } }, { username, name, password })
console.log(`Super panel: usuario ${username} creado.`)
