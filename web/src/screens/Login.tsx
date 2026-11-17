import { useState, type FormEvent } from 'react'
import { api, auth, deviceId } from '../api'
import type { Me } from '../App'
import { Logo } from '../Brand'

const deviceName = () => `${navigator.platform || 'Equipo'} · ${new Date().toLocaleDateString('es-MX')}`

export function Login({ onLogin, forceChange }: { onLogin: (m: Me) => void; forceChange?: boolean }) {
  // El link único puede traer el código del negocio: /?negocio=ABC123
  const linkCode = new URLSearchParams(location.search).get('negocio') ?? localStorage.getItem('nx_business_code') ?? ''
  const [mode, setMode] = useState<'empleado' | 'dueno' | 'registro'>(linkCode ? 'empleado' : 'dueno')
  const [recover, setRecover] = useState<null | true>(null)
  const [f, setF] = useState({ businessCode: linkCode, username: '', password: '', phone: '', businessName: '', ownerName: '', code: '', newPassword: '', newPassword2: '' })
  const [challenge, setChallenge] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const finish = async (token: string) => {
    auth.set(token)
    onLogin(await api<Me>('GET', '/auth/me'))
  }
  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (forceChange) {
    return (
      <form className="card login" onSubmit={run(async () => {
        if (f.newPassword !== f.newPassword2) throw new Error('Las contraseñas nuevas no coinciden.')
        await api('POST', '/auth/change-password', { currentPassword: f.password, newPassword: f.newPassword })
        onLogin(await api<Me>('GET', '/auth/me'))
      })}>
        <h1>Cambia tu contraseña</h1>
        <p className="muted">Es tu primer ingreso. Elige una contraseña que solo tú conozcas.</p>
        <label>Contraseña actual<input type="password" value={f.password} onChange={set('password')} autoFocus /></label>
        <label>Contraseña nueva (mínimo 8)<input type="password" value={f.newPassword} onChange={set('newPassword')} /></label>
        <label>Repite la contraseña nueva<input type="password" value={f.newPassword2} onChange={set('newPassword2')} /></label>
        {error && <p className="error">{error}</p>}
        <p><button className="primary big" style={{ width: '100%' }} disabled={busy}>Guardar</button></p>
      </form>
    )
  }

  return (
    <div className="login">
      <div style={{ display: 'grid', justifyItems: 'center', gap: 10, marginBottom: 20 }}>
        <Logo size={72} />
        <div className="brand" style={{ padding: 0 }}><span className="word" style={{ fontSize: '1.6rem', letterSpacing: '0.3em' }}>NEXORA</span></div>
      </div>
      {mode === 'dueno' && recover !== null && <Recuperar phone={f.phone} onDone={() => { setRecover(null); setError(''); }} />}
      <div className="tabs">
        <button className={mode === 'empleado' ? 'on' : ''} onClick={() => { setMode('empleado'); setChallenge(null) }}>Empleado</button>
        <button className={mode === 'dueno' ? 'on' : ''} onClick={() => { setMode('dueno'); setChallenge(null) }}>Dueño</button>
        <button className={mode === 'registro' ? 'on' : ''} onClick={() => { setMode('registro'); setChallenge(null) }}>Crear cuenta</button>
      </div>
      <div className="card">
        {mode === 'empleado' && (
          <form onSubmit={run(async () => {
            const r = await api<{ token: string }>('POST', '/auth/login', { businessCode: f.businessCode, username: f.username, password: f.password, deviceId: deviceId(), deviceName: deviceName() })
            localStorage.setItem('nx_business_code', f.businessCode.toUpperCase())
            await finish(r.token)
          })}>
            <label>Código del negocio<input value={f.businessCode} onChange={set('businessCode')} autoCapitalize="characters" /></label>
            <label>Usuario<input value={f.username} onChange={set('username')} autoCapitalize="none" autoFocus={!!linkCode} /></label>
            <label>Contraseña<input type="password" value={f.password} onChange={set('password')} /></label>
            {error && <p className="error">{error}</p>}
            <p><button className="primary big" style={{ width: '100%' }} disabled={busy}>Entrar</button></p>
          </form>
        )}
        {mode !== 'empleado' && !challenge && (
          <form onSubmit={run(async () => {
            const r = mode === 'dueno'
              ? await api<{ challengeId: string }>('POST', '/auth/owner/login', { phone: f.phone, password: f.password, deviceId: deviceId(), deviceName: deviceName() })
              : await api<{ challengeId: string }>('POST', '/auth/register', { businessName: f.businessName, ownerName: f.ownerName, phone: f.phone, password: f.password, deviceId: deviceId(), deviceName: deviceName() })
            setChallenge(r.challengeId)
          })}>
            {mode === 'registro' && (
              <>
                <label>Nombre del negocio<input value={f.businessName} onChange={set('businessName')} /></label>
                <label>Tu nombre<input value={f.ownerName} onChange={set('ownerName')} /></label>
              </>
            )}
            <label>Teléfono (10 dígitos)<input inputMode="tel" value={f.phone} onChange={set('phone')} /></label>
            <label>Contraseña<input type="password" value={f.password} onChange={set('password')} /></label>
            {error && <p className="error">{error}</p>}
            <p><button className="primary big" style={{ width: '100%' }} disabled={busy}>{mode === 'dueno' ? 'Continuar' : 'Crear cuenta'}</button></p>
            {mode === 'dueno' && <p style={{ textAlign: 'center' }}><a href="#" onClick={(e) => { e.preventDefault(); setRecover(true) }}>¿Olvidaste tu contraseña?</a></p>}
          </form>
        )}
        {mode !== 'empleado' && challenge && (
          <form onSubmit={run(async () => {
            const r = await api<{ token: string }>('POST', mode === 'dueno' ? '/auth/owner/verify' : '/auth/register/verify', { challengeId: challenge, code: f.code })
            await finish(r.token)
          })}>
            <p>Te enviamos un código por WhatsApp o SMS al {f.phone}.</p>
            <label>Código de 6 dígitos<input inputMode="numeric" value={f.code} onChange={set('code')} autoFocus maxLength={6} /></label>
            {error && <p className="error">{error}</p>}
            <p><button className="primary big" style={{ width: '100%' }} disabled={busy}>Verificar</button></p>
          </form>
        )}
      </div>
    </div>
  )
}

/** El dueño recupera su cuenta con un código que llega a su teléfono. */
function Recuperar({ phone: initial, onDone }: { phone: string; onDone: () => void }) {
  const [phone, setPhone] = useState(initial)
  const [ch, setCh] = useState<string | null>(null)
  const [f, setF] = useState({ code: '', p1: '', p2: '' })
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const send = async () => {
    try { setCh((await api<any>('POST', '/auth/owner/recover', { phone })).challengeId); setMsg({}) } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const save = async () => {
    if (f.p1 !== f.p2) return setMsg({ err: 'Las contraseñas no coinciden.' })
    try { await api('POST', '/auth/owner/recover/verify', { challengeId: ch, code: f.code, newPassword: f.p1 }); setMsg({ ok: 'Listo. Ya puedes entrar con tu contraseña nueva.' }); setTimeout(onDone, 1500) } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  return (
    <div className="modal" onClick={onDone}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2>Recuperar tu cuenta</h2>
        {!ch ? (
          <>
            <p className="muted">Te enviaremos un código por SMS al teléfono con el que te registraste.</p>
            <label>Teléfono (10 dígitos)<input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus /></label>
            <p><button className="primary big" style={{ width: '100%' }} disabled={phone.replace(/\D/g, '').length < 10} onClick={send}>Enviar código</button></p>
          </>
        ) : (
          <>
            <p className="muted">Si el número está registrado, te llegó un código.</p>
            <label>Código de 6 dígitos<input inputMode="numeric" maxLength={6} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} autoFocus /></label>
            <label>Contraseña nueva (mínimo 8)<input type="password" value={f.p1} onChange={(e) => setF({ ...f, p1: e.target.value })} /></label>
            <label>Repite la contraseña<input type="password" value={f.p2} onChange={(e) => setF({ ...f, p2: e.target.value })} /></label>
            <p><button className="primary big" style={{ width: '100%' }} disabled={f.code.length !== 6 || f.p1.length < 8} onClick={save}>Guardar</button></p>
          </>
        )}
        {msg.err && <p className="error">{msg.err}</p>}
        {msg.ok && <p className="okmsg">{msg.ok}</p>}
        <p className="muted">¿Perdiste tu teléfono? Recupera tu número con tu compañía y escríbenos: te enviaremos un código a ese número para verificar que eres tú.</p>
      </div>
    </div>
  )
}
