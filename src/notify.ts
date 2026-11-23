import type { Notifier } from './context.js'
import { AppError } from './util.js'

/** El proveedor falló (caído, número inválido, saldo): mensaje claro en vez de «Ocurrió un error». */
const failed = (what: 'sms' | 'correo', detail: string) => {
  console.error(`[${what}] ${detail}`)
  return new AppError(502, what === 'sms' ? 'sms_no_enviado' : 'correo_no_enviado', what === 'sms' ? 'No pudimos enviar el SMS. Revisa el número o inténtalo en unos minutos.' : 'No pudimos enviar el correo. Inténtalo en unos minutos.')
}

/**
 * Avisos al usuario: códigos por SMS (Twilio) y correo (Resend).
 * Sin credenciales configuradas, el aviso solo se imprime en consola (desarrollo).
 *
 * Variables: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (número de Twilio, formato +1…),
 * RESEND_API_KEY, MAIL_FROM (p. ej. "NEXORA <avisos@tudominio.com>").
 */
export function createNotifier(env: Record<string, string | undefined> = process.env): Notifier {
  const sms = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM
  const mail = env.RESEND_API_KEY && env.MAIL_FROM
  return {
    smsEnabled: !!sms,
    mailEnabled: !!mail,
    async sendCode(phone, code) {
      const body = `NEXORA: tu código es ${code}. Vence en 10 minutos. No lo compartas.`
      if (!sms) {
        console.log(`[sms sin proveedor] ${phone}: ${code}`)
        return false
      }
      // Números de México: 10 dígitos → +52.
      const to = phone.startsWith('+') ? phone : `+52${phone}`
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: { authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: env.TWILIO_FROM!, Body: body }),
      }).catch((e: Error) => { throw failed('sms', `sin conexión con Twilio: ${e.message}`) })
      if (!res.ok) throw failed('sms', `Twilio respondió ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
      return true
    },
    async sendEmail(to, subject, text, attachments) {
      if (!mail) {
        console.log(`[correo sin proveedor] ${to}: ${subject} — ${text}${attachments?.length ? ` (+${attachments.length} adjunto)` : ''}`)
        return false
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, ...(attachments?.length ? { attachments } : {}) }),
      }).catch((e: Error) => { throw failed('correo', `sin conexión con Resend: ${e.message}`) })
      if (!res.ok) throw failed('correo', `Resend respondió ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
      return true
    },
  }
}
