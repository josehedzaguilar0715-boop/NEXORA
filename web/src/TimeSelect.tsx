import { h12 } from './api'

/** Elegir una hora en formato de 12 horas (el valor sigue siendo «HH:MM» de 24 horas). */
export function TimeSelect({ value, onChange, step = 15, disabled, 'aria-label': label, from = 0, to = 24 }: { value: string; onChange: (v: string) => void; step?: number; disabled?: boolean; 'aria-label'?: string; from?: number; to?: number }) {
  const opts: string[] = []
  for (let m = from * 60; m < to * 60; m += step) opts.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  if (value && !opts.includes(value)) opts.push(value)
  opts.sort()
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {opts.map((o) => <option key={o} value={o}>{h12(o)}</option>)}
    </select>
  )
}
