/**
 * Encabezados de seguridad y privacidad para todas las respuestas (pantallas y API).
 * - Referrer-Policy: el navegador no manda la dirección completa (con tokens de citas o boletos) a otros sitios.
 * - frame-ancestors / X-Frame-Options: nadie puede meter NEXORA dentro de otra página para engañar al usuario.
 * - CSP: solo se ejecuta código de NEXORA (las imágenes pueden venir de https para el logo del negocio).
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
  'content-security-policy': [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "font-src 'self'",
    "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
  ].join('; '),
}

/** Copia la respuesta agregando los encabezados (sin tocar el cuerpo). */
export function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v)
  return out
}
