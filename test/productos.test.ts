import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PRODUCTS, productOf } from '../web/src/products/index.js'

describe('productos por giro', () => {
  it('cada giro piloto tiene su producto; los demás usan la identidad base', () => {
    expect(productOf('barberia').id).toBe('barber')
    expect(productOf('unas').id).toBe('nails')
    expect(productOf('abarrotes').id).toBe('market')
    for (const g of ['ferreteria', 'taqueria', 'comedor', 'verduleria', null, undefined]) expect(productOf(g).id).toBe('nexora')
  })

  it('cada producto tiene su identidad en products.css (colores, letra, forma y gráficas)', () => {
    const css = readFileSync('web/src/products/products.css', 'utf8')
    for (const p of Object.values(PRODUCTS).filter((x) => x.id !== 'nexora')) {
      const block = css.split(`:root[data-product='${p.id}'] {`)[1]?.split('\n}')[0] ?? ''
      for (const token of ['--bg', '--card', '--ink', '--primary', '--font-display', '--radius', '--chart-in', '--tone-main', '--logo-1']) expect(block, `${p.id} ${token}`).toContain(`${token}:`)
    }
  })

  it('las herramientas escondidas existen y ningún producto esconde la caja', () => {
    const app = readFileSync('web/src/App.tsx', 'utf8')
    for (const p of Object.values(PRODUCTS)) {
      expect(p.hide).not.toContain('caja')
      for (const k of [...p.hide, ...p.quick]) expect(app, `${p.id}: ${k}`).toContain(`key: '${k}'`)
    }
  })
})
