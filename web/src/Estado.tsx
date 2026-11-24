import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'

const TIPOS = { ok: CheckCircle2, warn: AlertTriangle, danger: XCircle, info: Info } as const
export type TipoEstado = keyof typeof TIPOS

/** Insignia de estado: color + ícono + texto (el color nunca es el único medio). */
export function Estado({ tipo, children }: { tipo: TipoEstado; children: ReactNode }) {
  const I = TIPOS[tipo]
  return <span className={`estado ${tipo}`}><I size={16} strokeWidth={2.2} aria-hidden />{children}</span>
}
