import { useState } from 'react'
import { Trash2, ListChecks, X } from 'lucide-react'
import { Input, Select, Button } from './ui.jsx'
import { ScanInput } from './Barcode.jsx'
import { money } from '../lib/format'
import { productImage } from '../lib/productArt'

// Generic order-line editor used by Sales Orders and Purchase Orders.
// lines: [{item_id, qty, unit_price|unit_cost, discount_pct}]
export default function LineEditor({ items, lines, setLines, priceField = 'unit_price', withDiscount = false, filter = () => true, stockFor }) {
  const choices = items.filter(filter)
  const [multi, setMulti] = useState(false)
  const add = (it) => {
    const i = lines.findIndex((l) => l.item_id === it.id)
    if (i >= 0) { const n = [...lines]; n[i] = { ...n[i], qty: Number(n[i].qty) + 1 }; setLines(n) }
    else setLines([...lines, { item_id: it.id, qty: 1, [priceField]: priceField === 'unit_price' ? Number(it.price) : Number(it.standard_cost), discount_pct: 0 }])
  }
  const upd = (i, k, v) => { const n = [...lines]; n[i] = { ...n[i], [k]: v }; setLines(n) }
  const byId = Object.fromEntries(items.map((i) => [i.id, i]))
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <select className="input" value="" onChange={(e) => e.target.value && add(byId[e.target.value])}>
          <option value="">+ Add item…</option>
          {[...new Set(choices.map((i) => i.category))].sort().map((c) => (
            <optgroup key={c} label={c}>
              {choices.filter((i) => i.category === c).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>)}
            </optgroup>
          ))}
        </select>
        <ScanInput items={choices} onItem={add} continuous placeholder="…or scan barcode" />
        <Button type="button" variant={multi ? 'primary' : 'secondary'} onClick={() => setMulti((m) => !m)}><ListChecks className="h-4 w-4" />Select multiple</Button>
      </div>
      {multi && <MultiPicker items={choices} priceField={priceField} onClose={() => setMulti(false)} onAdd={(picked) => {
        const n = [...lines]
        picked.forEach(({ it, qty }) => {
          const i = n.findIndex((l) => l.item_id === it.id)
          if (i >= 0) n[i] = { ...n[i], qty: Number(n[i].qty) + qty }
          else n.push({ item_id: it.id, qty, [priceField]: priceField === 'unit_price' ? Number(it.price) : Number(it.standard_cost), discount_pct: 0 })
        })
        setLines(n); setMulti(false)
      }} />}
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
                  <td className="td"><div className="flex items-center gap-2"><img src={productImage(it)} alt="" className="h-8 w-10 rounded object-cover" /><div><div className="font-medium">{it?.name}</div><div className="text-xs text-stone-500">{it?.sku} · {it?.uom}</div></div></div></td>
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

// Checkbox list grouped by product type: tick several items (or a whole group), set quantities, add them all at once.
function MultiPicker({ items, priceField, onAdd, onClose }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState({}) // id -> qty
  const defQty = (it) => (priceField === 'unit_cost' ? Math.max(1, Number(it.min_order_qty) || 1) : 1)
  const shown = items.filter((i) => !q || `${i.name} ${i.sku} ${i.category}`.toLowerCase().includes(q.toLowerCase()))
  const cats = [...new Set(shown.map((i) => i.category))].sort()
  const toggle = (it) => setPicked((p) => { const n = { ...p }; if (n[it.id] != null) delete n[it.id]; else n[it.id] = defQty(it); return n })
  const toggleGroup = (c) => {
    const g = shown.filter((i) => i.category === c)
    const all = g.every((i) => picked[i.id] != null)
    setPicked((p) => { const n = { ...p }; g.forEach((i) => { if (all) delete n[i.id]; else if (n[i.id] == null) n[i.id] = defQty(i) }); return n })
  }
  const ids = Object.keys(picked)
  const total = ids.reduce((s, id) => { const it = items.find((i) => String(i.id) === id); return s + Number(picked[id] || 0) * Number(priceField === 'unit_price' ? it.price : it.standard_cost) }, 0)
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Input autoFocus placeholder="Filter items…" value={q} onChange={(e) => setQ(e.target.value)} className="py-1" />
        <Button type="button" size="sm" variant="ghost" onClick={() => setPicked({})}>Clear</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
        {cats.map((c) => {
          const g = shown.filter((i) => i.category === c)
          const all = g.every((i) => picked[i.id] != null)
          return (
            <div key={c}>
              <label className="mb-1 flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                <input type="checkbox" checked={all} onChange={() => toggleGroup(c)} />{c} <span className="font-normal normal-case">({g.length})</span>
              </label>
              <div className="grid gap-1 sm:grid-cols-2">
                {g.map((it) => {
                  const on = picked[it.id] != null
                  return (
                    <div key={it.id} className={`flex items-center gap-2 rounded-md border px-2 py-1 text-sm ${on ? 'border-brand-400 bg-white' : 'border-transparent hover:bg-white'}`}>
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                        <input type="checkbox" checked={on} onChange={() => toggle(it)} />
                        <img src={productImage(it)} alt="" className="h-7 w-9 rounded object-cover" />
                        <span className="min-w-0"><span className="block truncate">{it.name}</span><span className="block text-xs text-stone-500">{it.sku} · {money(priceField === 'unit_price' ? it.price : it.standard_cost)}</span></span>
                      </label>
                      {on && <input type="number" min="0" step="any" className="input w-20 py-0.5 text-right" value={picked[it.id]} onChange={(e) => setPicked((p) => ({ ...p, [it.id]: e.target.value }))} title="Quantity" />}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {cats.length === 0 && <div className="py-4 text-center text-sm text-stone-400">No items match.</div>}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-brand-100 pt-2">
        <span className="text-sm text-stone-600">{ids.length} selected · {money(total)}</span>
        <Button type="button" size="sm" disabled={!ids.length} onClick={() => onAdd(ids.map((id) => ({ it: items.find((i) => String(i.id) === id), qty: Number(picked[id]) || 0 })).filter((x) => x.qty > 0))}>Add {ids.length || ''} item{ids.length === 1 ? '' : 's'}</Button>
      </div>
    </div>
  )
}
