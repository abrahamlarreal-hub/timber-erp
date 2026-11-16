import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, ChevronDown, Layers } from 'lucide-react'
import { supabase, sel } from '../lib/supabase'
import { useItems, usePolicy } from '../lib/hooks'
import { num, money } from '../lib/format'
import { productImage } from '../lib/productArt'
import { Badge, Select, Input, cx } from './ui.jsx'

// All BOM lines, grouped parent -> children
export function useBomMap() {
  const { data = [] } = useQuery({ queryKey: ['bom_all_lines'], queryFn: () => sel(supabase.from('bom_lines').select('parent_item_id, component_item_id, qty_per')) })
  return useMemo(() => {
    const m = {}
    data.forEach((b) => { (m[b.parent_item_id] = m[b.parent_item_id] || []).push(b) })
    return m
  }, [data])
}

// Flatten an item's multi-level structure for `qty` units (depth-first)
export function explode(itemId, qty, bom, depth = 0, path = []) {
  return (bom[itemId] || []).flatMap((b) => {
    const need = Number(b.qty_per) * qty
    const node = { itemId: b.component_item_id, qtyPer: Number(b.qty_per), need, depth: depth + 1, parentId: itemId, key: [...path, b.component_item_id].join('>') }
    return [node, ...explode(b.component_item_id, need, bom, depth + 1, [...path, b.component_item_id])]
  })
}

// Indented multi-level BOM table for `qty` units of `itemId`
export function BomBreakdown({ itemId, qty = 1, compact = false }) {
  const items = useItems().data || []
  const policy = usePolicy().data || []
  const bom = useBomMap()
  const [collapsed, setCollapsed] = useState({})
  const byId = Object.fromEntries(items.map((i) => [i.id, i]))
  const pol = Object.fromEntries(policy.map((p) => [p.item_id, p]))
  const rows = explode(itemId, Number(qty) || 0, bom)
  const hidden = (r) => Object.keys(collapsed).some((k) => collapsed[k] && r.key.startsWith(k + '>'))
  // cumulative lead time: longest path of lead times from the top item down to a purchased part
  const cumLT = (id) => (byId[id]?.lead_time_days || 0) + Math.max(0, ...(bom[id] || []).map((b) => cumLT(b.component_item_id)))
  if (!rows.length) return <p className="text-xs text-stone-500">This item has no bill of material — it's purchased, not made.</p>
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead><tr className="bg-stone-50">
          <th className="th">Component</th><th className="th text-right">Qty per parent</th><th className="th text-right">Needed for {num(qty)}</th>
          {!compact && <><th className="th text-right">On hand</th><th className="th text-right">Short</th><th className="th">Source</th><th className="th text-right">Lead time</th><th className="th text-right">Cost</th></>}
        </tr></thead>
        <tbody className="divide-y divide-stone-100">
          {rows.filter((r) => !hidden(r)).map((r) => {
            const it = byId[r.itemId] || {}; const p = pol[r.itemId] || {}; const made = !!bom[r.itemId]
            const onHand = Number(p.on_hand || 0); const short = Math.max(0, r.need - onHand)
            return (
              <tr key={r.key} className={cx(r.depth === 1 && 'bg-white', r.depth > 1 && 'bg-stone-50/50')}>
                <td className="td">
                  <div className="flex items-center gap-1.5" style={{ paddingLeft: (r.depth - 1) * 22 }}>
                    {made ? <button onClick={() => setCollapsed({ ...collapsed, [r.key]: !collapsed[r.key] })} className="text-stone-500">{collapsed[r.key] ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button> : <span className="inline-block w-3.5 text-center text-stone-300">└</span>}
                    <img src={productImage(it)} alt="" className="h-6 w-8 rounded object-cover" />
                    <span className={cx(made && 'font-medium')}>{it.name}</span>
                    {made && <Badge color="brown">sub-assembly</Badge>}
                  </div>
                </td>
                <td className="td num text-stone-600">{num(r.qtyPer, 3)} {it.uom}</td>
                <td className="td num font-medium">{num(r.need, 2)} {it.uom}</td>
                {!compact && <>
                  <td className="td num">{num(onHand, 2)}</td>
                  <td className="td num">{short > 0 ? <span className="font-semibold text-red-600">{num(short, 2)}</span> : <span className="text-emerald-600">✓</span>}</td>
                  <td className="td text-xs">{made ? 'Build (Orem Workshop)' : it.supplier?.name}</td>
                  <td className="td num">{it.lead_time_days}d</td>
                  <td className="td num text-stone-600">{money(r.need * Number(it.avg_cost || it.standard_cost || 0))}</td>
                </>}
              </tr>
            )
          })}
        </tbody>
      </table>
      {!compact && <p className="mt-2 text-xs text-stone-500">Cumulative lead time (longest buy + build path): <b>{cumLT(itemId)} days</b> — the earliest you could deliver this product if you had none of its parts.</p>}
    </div>
  )
}

// "Product structure" explorer: pick a product + quantity, see its full breakdown
export function ProductStructure() {
  const items = useItems().data || []
  const bom = useBomMap()
  const parents = items.filter((i) => bom[i.id])
  const [sel_, setSel] = useState('')
  const [q, setQ] = useState(1)
  const id = Number(sel_ || parents.find((p) => p.sku === 'TTC-GS-MAP')?.id || parents[0]?.id)
  const it = items.find((i) => i.id === id)
  const usedIn = (cid) => Object.entries(bom).filter(([, ls]) => ls.some((l) => l.component_item_id === cid)).map(([pid]) => items.find((i) => i.id === Number(pid))?.name)
  if (!parents.length) return null
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label><span className="label">Product</span><Select className="w-72" value={id || ''} onChange={(e) => setSel(e.target.value)} options={parents.map((p) => ({ value: p.id, label: `${p.name} (${bom[p.id].length} components)` }))} /></label>
        <label><span className="label">Quantity</span><Input type="number" min="1" className="w-28" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {it && <div className="flex items-center gap-2 text-sm"><img src={productImage(it)} alt="" className="h-10 w-14 rounded object-cover" /><div><div className="font-medium">{it.name}</div><div className="text-xs text-stone-500">{usedIn(it.id).length ? `Also used in: ${usedIn(it.id).join(', ')}` : 'Top-level product (sold to customers)'}</div></div></div>}
      </div>
      {id ? <BomBreakdown itemId={id} qty={q} /> : null}
    </div>
  )
}

export function MadeFrom({ itemId }) {
  const items = useItems().data || []
  const bom = useBomMap()
  const ls = bom[itemId] || []
  if (!ls.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs"><Layers className="h-3.5 w-3.5 text-brand-600" /><b>Made from:</b>
      {ls.map((l) => { const c = items.find((i) => i.id === l.component_item_id); return <span key={l.component_item_id} className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-800">{num(l.qty_per, 3)} {c?.uom} {c?.name}</span> })}
    </div>
  )
}
