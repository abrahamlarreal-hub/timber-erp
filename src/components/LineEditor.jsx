import { Trash2 } from 'lucide-react'
import { Input, Select, Button } from './ui.jsx'
import { ScanInput } from './Barcode.jsx'
import { money } from '../lib/format'

// Generic order-line editor used by Sales Orders and Purchase Orders.
// lines: [{item_id, qty, unit_price|unit_cost, discount_pct}]
export default function LineEditor({ items, lines, setLines, priceField = 'unit_price', withDiscount = false, filter = () => true, stockFor }) {
  const choices = items.filter(filter)
  const add = (it) => {
    const i = lines.findIndex((l) => l.item_id === it.id)
    if (i >= 0) { const n = [...lines]; n[i] = { ...n[i], qty: Number(n[i].qty) + 1 }; setLines(n) }
    else setLines([...lines, { item_id: it.id, qty: 1, [priceField]: priceField === 'unit_price' ? Number(it.price) : Number(it.standard_cost), discount_pct: 0 }])
  }
  const upd = (i, k, v) => { const n = [...lines]; n[i] = { ...n[i], [k]: v }; setLines(n) }
  const byId = Object.fromEntries(items.map((i) => [i.id, i]))
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Select placeholder="+ Add item…" value="" onChange={(e) => e.target.value && add(byId[e.target.value])}
          options={choices.map((i) => ({ value: i.id, label: `${i.sku} — ${i.name}` }))} />
        <ScanInput items={choices} onItem={add} placeholder="…or scan barcode" />
      </div>
      <div className="overflow-x-auto rounded-lg border border-stone-200">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50"><tr>
            <th className="th">Item</th>{stockFor && <th className="th text-right">Available</th>}<th className="th w-24">Qty</th>
            <th className="th w-28">{priceField === 'unit_price' ? 'Price' : 'Unit cost'}</th>
            {withDiscount && <th className="th w-24">Disc %</th>}<th className="th text-right">Line</th><th className="w-8"></th>
          </tr></thead>
          <tbody className="divide-y divide-stone-100">
            {lines.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-stone-400">No lines yet — pick or scan an item.</td></tr>}
            {lines.map((l, i) => {
              const it = byId[l.item_id]
              const line = Number(l.qty || 0) * Number(l[priceField] || 0) * (1 - Number(l.discount_pct || 0) / 100)
              const avail = stockFor?.(l.item_id)
              return (
                <tr key={i}>
                  <td className="td"><div className="font-medium">{it?.name}</div><div className="text-xs text-stone-500">{it?.sku} · {it?.uom}</div></td>
                  {stockFor && <td className={`td num ${avail < Number(l.qty) ? 'font-semibold text-red-600' : 'text-stone-500'}`}>{avail ?? '—'}</td>}
                  <td className="td"><Input type="number" min="0" step="any" value={l.qty} onChange={(e) => upd(i, 'qty', e.target.value)} className="py-1" /></td>
                  <td className="td"><Input type="number" min="0" step="0.01" value={l[priceField]} onChange={(e) => upd(i, priceField, e.target.value)} className="py-1" /></td>
                  {withDiscount && <td className="td"><Input type="number" min="0" max="100" value={l.discount_pct} onChange={(e) => upd(i, 'discount_pct', e.target.value)} className="py-1" /></td>}
                  <td className="td num font-medium">{money(line)}</td>
                  <td className="td"><Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
