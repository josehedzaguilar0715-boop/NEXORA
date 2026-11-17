import { useState, type FormEvent } from 'react'
import { api, auth, deviceId } from '../api'
import type { Me } from '../App'

const deviceName = () => `${navigator.platform || 'Equipo'} · ${new Date().toLocaleDateString('es-MX')}`

export function Login({ onLogin, forceChange }: { onLogin: (m: Me) => void; forceChange?: boolean }) {
  // El link único puede traer el código del negocio: /?negocio=ABC123
  const linkCode = new URLSearchParams(location.search).get('negocio') ?? localStorage.getItem('nx_business_code') ?? ''
  const [mode, setMode] = useState<'empleado' | 'dueno' | 'registro'>(linkCode ? 'empleado' : 'dueno')
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
      <h1 style={{ textAlign: 'center', color: 'var(--brand)' }}>NEXORA</h1>
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
