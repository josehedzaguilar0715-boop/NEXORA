// Mete las pantallas compiladas (web/dist) dentro del paquete del Worker, para servirlas sin
// el paso aparte de subida de archivos. Genera src/assets.gen.ts (no se versiona).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = 'web/dist'
const types: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', webmanifest: 'application/manifest+json', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2', ico: 'image/x-icon', json: 'application/json' }
const files: Record<string, { type: string; body: string }> = {}
const walk = (dir: string) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p)
    else files[`/${relative(root, p)}`] = { type: types[f.split('.').pop()!] ?? 'application/octet-stream', body: readFileSync(p).toString('base64') }
  }
}
walk(root)
writeFileSync('src/assets.gen.ts', `// Generado por scripts/embed-assets.ts. No editar.\nexport const ASSETS: Record<string, { type: string; body: string }> = ${JSON.stringify(files)}\n`)
console.log(`Pantallas incluidas: ${Object.keys(files).length} archivos`)
