import { useState } from 'react'
import { Tag, Printer } from 'lucide-react'
import { useItems } from '../lib/hooks'
import { money } from '../lib/format'
import { Button, Card, PageHeader, Input } from '../components/ui.jsx'
import { BarcodeSvg } from '../components/Barcode.jsx'

export default function Labels() {
  const items = useItems().data || []
  const [copies, setCopies] = useState({})
  const [q, setQ] = useState('')
  const sheet = items.flatMap((i) => Array.from({ length: Number(copies[i.id] || 0) }, () => i))
  const all = (n) => setCopies(Object.fromEntries(items.map((i) => [i.id, n])))
  return (
    <>
      <PageHeader icon={Tag} title="Barcode Labels" subtitle="Print Code 128 labels to stick on bins, shelves and products. Works with USB scanners and phone cameras."
        actions={<><Button variant="secondary" onClick={() => all(1)}>1 of each</Button><Button variant="secondary" onClick={() => all(0)}>Clear</Button><Button onClick={() => window.print()} disabled={!sheet.length}><Printer className="h-4 w-4" />Print {sheet.length} labels</Button></>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="no-print" title="Choose labels" actions={<Input className="w-40 py-1" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />}>
          <div className="max-h-[65vh] space-y-1 overflow-y-auto">
            {items.filter((i) => !q || (i.name + i.sku).toLowerCase().includes(q.toLowerCase())).map((i) => (
              <div key={i.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-stone-50">
                <div className="min-w-0 flex-1"><div className="truncate text-sm">{i.name}</div><div className="font-mono text-[11px] text-stone-500">{i.barcode}</div></div>
                <Input type="number" min="0" className="w-16 py-1" value={copies[i.id] || ''} onChange={(e) => setCopies({ ...copies, [i.id]: e.target.value })} />
              </div>
            ))}
          </div>
        </Card>
        <div className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-dashed border-stone-300 bg-white p-3 sm:grid-cols-3 print:grid-cols-3 print:border-0 print:p-0">
            {sheet.length === 0 && <p className="col-span-3 py-10 text-center text-sm text-stone-400">Pick items on the left to build a label sheet.</p>}
            {sheet.map((i, k) => (
              <div key={k} className="flex flex-col items-center rounded border border-stone-200 p-2 text-center break-inside-avoid">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Timpanogos Timber</div>
                <div className="line-clamp-1 text-xs font-medium">{i.name}</div>
                <BarcodeSvg value={i.barcode} height={42} width={1.5} fontSize={11} />
                <div className="flex w-full justify-between text-[10px] text-stone-500"><span>{i.sku}</span><span>{Number(i.price) ? money(i.price) : i.uom}</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
