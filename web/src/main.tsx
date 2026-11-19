import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DialogHost } from './Dialog'
import './fonts.css'
import './styles.css'

// El navegador avisa una sola vez que la app se puede instalar; se guarda para el botón «Instalar NEXORA».
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  window.nxInstall = e as NonNullable<Window['nxInstall']>
  window.dispatchEvent(new Event('nx-install-ready'))
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="boot-loading" aria-busy="true" />}>
      <App />
    </Suspense>
    <DialogHost />
  </StrictMode>,
)

if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('/sw.js').catch(() => {})
