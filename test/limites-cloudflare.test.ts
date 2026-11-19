import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** La base de datos de Cloudflare (Durable Objects) no une más de 5 consultas con UNION en una sola. */
describe('límites de la base de Cloudflare', () => {
  it('ninguna consulta une más de 5 SELECT con UNION', () => {
    const bad: string[] = []
    for (const f of readdirSync('src').filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(`src/${f}`, 'utf8')
      for (const m of src.matchAll(/`[^`]*`/g)) {
        const unions = (m[0].match(/\bUNION\b/g) ?? []).length
        if (unions > 4) bad.push(`${f}: ${unions + 1} consultas unidas`)
      }
    }
    expect(bad).toEqual([])
  })
})
