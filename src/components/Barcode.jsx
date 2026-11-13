import { useEffect, useRef, useState } from 'react'
import JsBarcode from 'jsbarcode'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { Camera, ScanLine, Flashlight, Repeat } from 'lucide-react'
import { Button, Modal, useToast, cx } from './ui.jsx'

// Renders a printable barcode (Code 128) for an item's barcode value
export function BarcodeSvg({ value, height = 50, width = 1.6, fontSize = 13, displayValue = true }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && value) {
      try { JsBarcode(ref.current, value, { format: 'CODE128', height, width, fontSize, margin: 6, displayValue }) } catch { /* ignore */ }
    }
  }, [value, height, width, fontSize, displayValue])
  return <svg ref={ref} />
}

// Short confirmation beep (like a store scanner) + vibration on phones
let audioCtx
export function beep(ok = true) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain()
    o.frequency.value = ok ? 1800 : 300; o.type = 'square'
    g.gain.setValueAtTime(0.08, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + (ok ? 0.12 : 0.3))
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + (ok ? 0.12 : 0.3))
  } catch { /* audio not available */ }
  try { navigator.vibrate?.(ok ? 60 : [80, 60, 80]) } catch { /* noop */ }
}

// Only look for the formats we print / sell — faster and fewer misreads
const hints = new Map()
hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.UPC_A, BarcodeFormat.QR_CODE])
hints.set(DecodeHintType.TRY_HARDER, true)

// Camera scanner (phone or laptop). Uses the BACK camera on phones.
// continuous = stay open and keep scanning (for ringing up / receiving many items).
export function CameraScanner({ open, onClose, onDetected, continuous = false }) {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const cbRef = useRef(onDetected)
  cbRef.current = onDetected
  const [err, setErr] = useState(null)
  const [last, setLast] = useState(null)
  const [torch, setTorch] = useState(false)
  const [torchOk, setTorchOk] = useState(false)
  const [keepOpen, setKeepOpen] = useState(continuous)
  const keepRef = useRef(keepOpen)
  keepRef.current = keepOpen

  useEffect(() => {
    if (!open) return
    let stopped = false
    const seen = { code: null, at: 0 }
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 80, delayBetweenScanSuccess: 400 })
    setErr(null); setLast(null); setTorch(false)
    reader.decodeFromConstraints(
      { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
      videoRef.current,
      (result) => {
        if (!result || stopped) return
        const code = result.getText()
        const now = Date.now()
        // same label still in front of the camera → don't add it again (move it away and back to add another)
        if (code === seen.code && now - seen.at < 1200) { seen.at = now; return }
        seen.code = code; seen.at = now
        setLast(code)
        cbRef.current(code)
        if (!keepRef.current) { stopped = true; controlsRef.current?.stop(); onClose() }
      },
    ).then((c) => {
      controlsRef.current = c
      if (stopped) c.stop()
      setTorchOk(typeof c.switchTorch === 'function')
    }).catch((e) => setErr(
      e?.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow camera access for this site in your browser settings, then try again.'
        : e?.name === 'NotFoundError' ? 'No camera found on this device.'
          : (e?.message || 'Camera unavailable — camera access needs the https:// site and permission.')))
    return () => { stopped = true; controlsRef.current?.stop(); controlsRef.current = null }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTorch = async () => {
    try { await controlsRef.current?.switchTorch?.(!torch); setTorch(!torch) } catch { setTorchOk(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Scan with camera"
      footer={<>
        <label className="mr-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} /><Repeat className="h-4 w-4" />Keep scanning (multiple items)</label>
        {torchOk && <Button variant="secondary" onClick={toggleTorch}><Flashlight className="h-4 w-4" />{torch ? 'Light off' : 'Light on'}</Button>}
        <Button onClick={onClose}>Done</Button>
      </>}>
      {err ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p> : (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline autoPlay />
          {/* aiming box */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-1/3 w-4/5 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
              <div className="absolute inset-x-3 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-red-500" />
            </div>
          </div>
          {last && <div className="absolute inset-x-0 bottom-0 bg-emerald-600/90 px-3 py-1.5 text-center font-mono text-sm text-white">✓ {last}</div>}
        </div>
      )}
      <ul className="mt-3 space-y-0.5 text-xs text-stone-500">
        <li>• Fit the barcode inside the box, about 10–20 cm (4–8 in) away; hold steady for a second.</li>
        <li>• Glare on glossy labels? Tilt the label slightly. Dim room? Use the light button.</li>
        <li>• Beep = added. To add the same item again, move the label out of view and back. A USB scanner also works.</li>
      </ul>
    </Modal>
  )
}

// Text box that accepts USB/Bluetooth scanner input (keyboard wedge + Enter)
// or typed SKU/barcode, plus a camera button. Resolves to an item.
// captureGlobal: also catch scanner input when the cursor isn't in the box (POS).
export function ScanInput({ items = [], onItem, placeholder = 'Scan or type barcode / SKU, press Enter', autoFocus, className, continuous = false, captureGlobal = false }) {
  const [val, setVal] = useState('')
  const [cam, setCam] = useState(false)
  const [flash, setFlash] = useState(null)
  const toast = useToast()
  const lookupRef = useRef(null)
  const lookup = (code) => {
    const c = String(code || '').trim().replace(/^0+(?=\d{12}$)/, '') // EAN-13 with leading 0 → UPC-A
    if (!c) return
    const it = items.find((i) => i.barcode === c) || items.find((i) => i.barcode === c.replace(/^0/, ''))
      || items.find((i) => i.sku.toLowerCase() === c.toLowerCase())
    if (it) { beep(true); setFlash('ok'); onItem(it) }
    else { beep(false); setFlash('bad'); toast.error(`No item with barcode/SKU "${c}"`) }
    setTimeout(() => setFlash(null), 500)
    setVal('')
  }
  lookupRef.current = lookup

  // USB scanners type very fast and end with Enter — catch that anywhere on the page
  useEffect(() => {
    if (!captureGlobal) return
    let buf = ''; let lastT = 0
    const onKey = (e) => {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const now = Date.now()
      if (now - lastT > 60) buf = ''
      lastT = now
      if (e.key === 'Enter') { if (buf.length >= 6) { e.preventDefault(); lookupRef.current(buf) } buf = ''; return }
      if (e.key.length === 1) buf += e.key
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [captureGlobal])

  return (
    <div className={`flex gap-2 ${className || ''}`}>
      <div className="relative flex-1">
        <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <input className={cx('input pl-9 font-mono transition', flash === 'ok' && 'border-emerald-500 ring-2 ring-emerald-200', flash === 'bad' && 'border-red-500 ring-2 ring-red-200')}
          value={val} autoFocus={autoFocus} placeholder={placeholder} autoComplete="off"
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(val) } }} />
      </div>
      <Button type="button" variant="secondary" onClick={() => setCam(true)} title="Scan with camera"><Camera className="h-4 w-4" /><span className="hidden sm:inline">Camera</span></Button>
      <CameraScanner open={cam} continuous={continuous} onClose={() => setCam(false)} onDetected={(c) => lookupRef.current(c)} />
    </div>
  )
}
