import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// El navegador avisa una sola vez que la app se puede instalar; se guarda para el botón «Instalar NEXORA».
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  window.nxInstall = e as NonNullable<Window['nxInstall']>
  window.dispatchEvent(new Event('nx-install-ready'))
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('/sw.js').catch(() => {})
