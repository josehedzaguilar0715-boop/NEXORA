import { useEffect, useRef, useState } from 'react'

/**
 * Escáner con la cámara del teléfono o la computadora (códigos de barras y QR).
 * Los lectores USB/Bluetooth no lo necesitan: escriben el código en el campo y mandan Enter.
 * La librería se carga solo cuando se abre la cámara, para no hacer lenta la app.
 */
export function ScanButton({ onCode, title = 'Escanear con la cámara' }: { onCode: (code: string) => void; title?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" title={title} aria-label={title} style={{ flex: '0 0 auto' }} onClick={() => setOpen(true)}>📷</button>
      {open && <ScanModal onClose={() => setOpen(false)} onCode={(c) => { setOpen(false); onCode(c) }} />}
    </>
  )
}

function ScanModal({ onClose, onCode }: { onClose: () => void; onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let stop: (() => void) | undefined
    let done = false
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara.')
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (done) return
        const reader = new BrowserMultiFormatReader()
        // El código puede leerse en el primer cuadro, antes de tener `controls`: por eso se detiene la cámara después.
        const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video.current!, (result) => {
          if (result && !done) {
            done = true
            stop?.()
            navigator.vibrate?.(80)
            onCode(result.getText().trim())
          }
        })
        stop = () => controls.stop()
        if (done) stop()
      } catch (e) {
        const name = (e as { name?: string }).name
        setErr(name === 'NotAllowedError' ? 'No diste permiso para usar la cámara. Actívalo en el candado de la barra de direcciones.' : name === 'NotFoundError' ? 'No se encontró una cámara en este equipo.' : (e as Error).message || 'No se pudo abrir la cámara.')
      }
    })()
    return () => { done = true; stop?.() }
  }, [])
  return (
    <div className="modal" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
        <h2>Escanear</h2>
        {err ? <p className="error">{err}</p> : <p className="muted">Apunta la cámara al código de barras o QR.</p>}
        <video ref={video} muted playsInline style={{ width: '100%', borderRadius: 12, background: '#000', aspectRatio: '4 / 3', objectFit: 'cover' }} />
        <p><button onClick={onClose}>Cerrar</button></p>
      </div>
    </div>
  )
}
