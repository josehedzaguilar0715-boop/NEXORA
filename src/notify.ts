import type { Notifier } from './context.js'

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
        headers: { authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: env.TWILIO_FROM!, Body: body }),
      })
      if (!res.ok) throw new Error(`No se pudo enviar el SMS (${res.status}).`)
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
      })
      if (!res.ok) throw new Error(`No se pudo enviar el correo (${res.status}).`)
      return true
    },
  }
}
