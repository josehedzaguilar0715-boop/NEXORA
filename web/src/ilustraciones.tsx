import { useState, type CSSProperties } from 'react'
import { Armchair, Beef, Carrot, CookingPot, DoorOpen, Droplets, Hammer, Mountain, Package, PenLine, ScissorsLineDashed, ShoppingBasket, Sparkles, UtensilsCrossed, type LucideIcon } from 'lucide-react'

/**
 * Ilustraciones propias por giro (iconos sobre fondo azul de la identidad NEXORA): sin descargas, sin costo.
 * Se usan cuando el negocio no tiene foto, o cuando la dirección de su foto no carga.
 */
const ICONO: Record<string, LucideIcon> = {
  barberia: ScissorsLineDashed, unas: Sparkles, abarrotes: ShoppingBasket, ferreteria: Hammer, papeleria: PenLine, perfumeria: Droplets,
  banos: DoorOpen, turistico: Mountain, palapa: Armchair, restaurante: UtensilsCrossed, comedor: CookingPot, taqueria: Beef, verduleria: Carrot,
}
export const iconoDeGiro = (giro?: string | null): LucideIcon => ICONO[giro ?? ''] ?? Package

/** Fondo azul con un icono grande: portada de ejemplo cuando no hay foto. */
export function Ilustracion({ giro, alto = 160, radio = 16, style }: { giro?: string | null; alto?: number; radio?: number; style?: CSSProperties }) {
  const I = iconoDeGiro(giro)
  return (
    <div role="img" aria-label="Imagen ilustrativa" style={{ height: alto, borderRadius: radio, display: 'grid', placeItems: 'center', color: '#fff', background: 'linear-gradient(135deg, #1d4ed8 0%, #3b82f6 55%, #60a5fa 100%)', ...style }}>
      <I size={Math.max(28, Math.round(alto * 0.4))} strokeWidth={1.6} aria-hidden />
    </div>
  )
}

/** Foto del negocio por dirección https; si falla o no hay, la ilustración del giro. */
export function Foto({ url, giro, alto = 160, radio = 16, alt = '', style }: { url?: string | null; giro?: string | null; alto?: number; radio?: number; alt?: string; style?: CSSProperties }) {
  const [fallo, setFallo] = useState(false)
  if (!url || fallo) return <Ilustracion giro={giro} alto={alto} radio={radio} style={style} />
  return <img src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFallo(true)} style={{ width: '100%', height: alto, objectFit: 'cover', borderRadius: radio, display: 'block', ...style }} />
}
