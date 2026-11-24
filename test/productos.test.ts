import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GIROS } from '../src/billing.js'
import { PRODUCTS, productOf } from '../web/src/products/index.js'

const css = readFileSync('web/src/identidad.css', 'utf8')
const lightBlock = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? ''
const tokens = (b: string) => Object.fromEntries([...b.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]!.trim()]))
const lum = (hex: string) => {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05) }

describe('productos por giro', () => {
  it('los 13 giros tienen producto con identidad propia', () => {
    expect(productOf('barberia').id).toBe('barber')
    expect(productOf('unas').id).toBe('nails')
    expect(productOf('abarrotes').id).toBe('market')
    for (const g of GIROS) expect(productOf(g).id, g).not.toBe('nexora')
    for (const g of [null, undefined, 'otro']) expect(productOf(g).id).toBe('nexora')
    // Ningún giro está en dos productos.
    const all = Object.values(PRODUCTS).flatMap((p) => p.giros)
    expect(new Set(all).size).toBe(all.length)
  })

  it('identidad visual ÚNICA (decisión del propietario): ningún producto tiene paleta propia y todos conservan nombre y lema', () => {
    for (const f of ['identidad.css', 'tokens.css', 'shell.css', 'v0.css']) expect(readFileSync(`web/src/${f}`, 'utf8'), f).not.toMatch(/data-product=/)
    for (const p of Object.values(PRODUCTS)) { expect(p.name.length, p.id).toBeGreaterThan(2); expect(p.tagline.length, p.id).toBeGreaterThan(2) }
  })

  it('contraste AA de la paleta única (modo claro): texto, texto secundario y botón principal se leen', () => {
    const t = tokens(lightBlock)
    const bad: string[] = []
    const check = (fg: string, bg: string, min: number) => { const c = contrast(t[fg]!, t[bg]!); if (!(c >= min)) bad.push(`${fg} sobre ${bg} = ${c.toFixed(2)} (mín. ${min})`) }
    check('--ink', '--bg', 7); check('--ink', '--card', 7)
    check('--muted', '--card', 4.5); check('--muted', '--bg', 4.5)
    check('--on-primary', '--primary', 4.5)
    expect(bad).toEqual([])
  })

  it('las herramientas escondidas o rápidas existen y ningún producto esconde la caja', () => {
    const app = readFileSync('web/src/App.tsx', 'utf8')
    for (const p of Object.values(PRODUCTS)) {
      expect(p.hide).not.toContain('caja')
      for (const k of [...p.hide, ...p.quick]) expect(app, `${p.id}: ${k}`).toContain(`key: '${k}'`)
    }
  })
})
