import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { Camera, ScanLine } from 'lucide-react'
import { Button, Modal, useToast } from './ui.jsx'

// Renders a printable barcode (Code 128) for an item's barcode value
export function BarcodeSvg({ value, height = 50, width = 1.6, fontSize = 13, displayValue = true }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && value) {
      try { JsBarcode(ref.current, value, { format: 'CODE128', height, width, fontSize, margin: 4, displayValue }) } catch { /* ignore */ }
    }
  }, [value, height, width, fontSize, displayValue])
  return <svg ref={ref} />
}

// Camera scanner (phone or laptop webcam). Calls onDetected(text) once.
export function CameraScanner({ open, onClose, onDetected }) {
  const videoRef = useRef(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    if (!open) return
    let controls; let done = false
    const reader = new BrowserMultiFormatReader()
    setErr(null)
    reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
      if (result && !done) {
        done = true
        try { navigator.vibrate?.(80) } catch { /* noop */ }
        onDetected(result.getText())
        controls?.stop()
        onClose()
      }
    }).then((c) => { controls = c }).catch((e) => setErr(e?.message || 'Camera unavailable (camera access needs HTTPS and permission).'))
    return () => { done = true; controls?.stop() }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} onClose={onClose} title="Scan barcode with camera">
      {err ? <p className="text-sm text-red-600">{err}</p> : (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80 shadow-[0_0_12px_rgba(239,68,68,0.9)]" />
        </div>
      )}
      <p className="mt-3 text-xs text-stone-500">Hold the printed label 15–25 cm from the camera. A USB scanner also works — just scan into the box.</p>
    </Modal>
  )
}

// Text box that accepts USB/Bluetooth scanner input (keyboard wedge + Enter)
// or typed SKU/barcode, plus a camera button. Resolves to an item.
export function ScanInput({ items = [], onItem, placeholder = 'Scan or type barcode / SKU, press Enter', autoFocus, className }) {
  const [val, setVal] = useState('')
  const [cam, setCam] = useState(false)
  const toast = useToast()
  const lookup = (code) => {
    const c = String(code || '').trim()
    if (!c) return
    const it = items.find((i) => i.barcode === c) || items.find((i) => i.sku.toLowerCase() === c.toLowerCase())
    if (it) onItem(it)
    else toast.error(`No item with barcode/SKU "${c}"`)
    setVal('')
  }
  return (
    <div className={`flex gap-2 ${className || ''}`}>
      <div className="relative flex-1">
        <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input className="input pl-9 font-mono" value={val} autoFocus={autoFocus} placeholder={placeholder}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(val) } }} />
      </div>
      <Button type="button" variant="secondary" onClick={() => setCam(true)} title="Scan with camera"><Camera className="h-4 w-4" /><span className="hidden sm:inline">Camera</span></Button>
      <CameraScanner open={cam} onClose={() => setCam(false)} onDetected={lookup} />
    </div>
  )
}
