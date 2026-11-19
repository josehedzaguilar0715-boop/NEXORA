import { useEffect, useState } from 'react'
import { Logo } from '../Brand'

/** El aviso de instalación del navegador llega una sola vez y muy temprano: se guarda en main.tsx. */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
declare global { interface Window { nxInstall?: InstallEvent | null } }

type Plat = 'android' | 'iphone' | 'pc'
const detect = (): Plat => (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iphone' : /android/i.test(navigator.userAgent) ? 'android' : 'pc')

const STEPS: Record<Plat, { title: string; steps: string[] }> = {
  android: { title: 'Android', steps: ['Abre este link en Chrome.', 'Toca «Instalar NEXORA» (o el menú ⋮ → «Instalar app» / «Agregar a pantalla principal»).', 'Listo: NEXORA queda como app en tu pantalla de inicio.'] },
  iphone: { title: 'iPhone o iPad', steps: ['Abre este link en Safari (no funciona desde otro navegador).', 'Toca el botón Compartir (el cuadro con flecha hacia arriba).', 'Elige «Agregar a pantalla de inicio» y luego «Agregar».', 'Ábrela al menos una vez por semana: si no se usa en varias semanas, el iPhone puede borrar sus datos guardados.'] },
  pc: { title: 'Computadora', steps: ['Abre este link en Chrome o Edge.', 'Da clic en «Instalar NEXORA» (o en el ícono de instalar en la barra de direcciones).', 'NEXORA se abre en su propia ventana y queda en el escritorio y el menú de inicio.'] },
}

/** Página pública «Descargar NEXORA»: instalar la app desde el navegador en cualquier equipo, y compartirla por WhatsApp. */
export function Descargar() {
  const [plat, setPlat] = useState<Plat>(detect())
  const [canInstall, setCanInstall] = useState(!!window.nxInstall)
  const [done, setDone] = useState(window.matchMedia?.('(display-mode: standalone)').matches ?? false)
  useEffect(() => {
    const on = () => setCanInstall(!!window.nxInstall)
    const installed = () => { setDone(true); setCanInstall(false) }
    window.addEventListener('nx-install-ready', on)
    window.addEventListener('appinstalled', installed)
    return () => { window.removeEventListener('nx-install-ready', on); window.removeEventListener('appinstalled', installed) }
  }, [])
  const install = async () => {
    const e = window.nxInstall
    if (!e) return
    await e.prompt()
    const r = await e.userChoice
    window.nxInstall = null
    setCanInstall(false)
    if (r.outcome === 'accepted') setDone(true)
  }
  const s = STEPS[plat]
  return (
    <main className="login download-page">
      <div className="download-logo"><Logo size={72} /></div>
      <h1 style={{ textAlign: 'center' }}>Descargar NEXORA</h1>
      <p className="muted" style={{ textAlign: 'center' }}>Todo tu negocio, conectado. Gratis de instalar, sin tiendas de apps.</p>
      <section className="card">
        <div className="seg" role="tablist">
          {(Object.keys(STEPS) as Plat[]).map((k) => <button key={k} className={plat === k ? 'on' : ''} onClick={() => setPlat(k)}>{STEPS[k].title}</button>)}
        </div>
        {done ? <p className="okmsg">NEXORA ya está instalada en este equipo. Ábrela desde tu pantalla de inicio.</p>
          : canInstall && plat !== 'iphone' && <p><button className="primary big" style={{ width: '100%' }} onClick={install}>Instalar NEXORA</button></p>}
        <ol className="steps">{s.steps.map((x) => <li key={x}>{x}</li>)}</ol>
        <p className="muted small">Después entra con tu teléfono y contraseña (dueño) o con el usuario y la contraseña que te dio el dueño (empleados). La caja sigue vendiendo aunque se vaya el internet.</p>
        <p><a className="button" href="/">Abrir NEXORA en el navegador</a></p>
      </section>
      <section className="card">
        <h2>Compártela</h2>
        <p className="muted small">Manda este link a tus empleados o a otro equipo de tu negocio.</p>
        <WhatsAppShare />
      </section>
    </main>
  )
}

export const downloadUrl = () => `${location.origin}/descargar`
export const downloadMessage = (who?: string) => `${who ? `Hola ${who}, ` : 'Hola, '}instala NEXORA en tu celular o computadora desde este link (Android, iPhone y PC): ${downloadUrl()}`

/** Botón para mandar el link de descarga por WhatsApp (elige el contacto en WhatsApp) y copiarlo. */
export function WhatsAppShare({ phone, who }: { phone?: string; who?: string }) {
  const [copied, setCopied] = useState(false)
  const digits = (phone ?? '').replace(/\D/g, '').slice(-10)
  return (
    <p className="row">
      <a className="button primary" href={`https://wa.me/${digits ? `52${digits}` : ''}?text=${encodeURIComponent(downloadMessage(who))}`} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>
      <button onClick={async () => { try { await navigator.clipboard.writeText(downloadUrl()); setCopied(true) } catch { prompt('Copia el link:', downloadUrl()) } }}>{copied ? 'Link copiado' : 'Copiar link'}</button>
    </p>
  )
}
