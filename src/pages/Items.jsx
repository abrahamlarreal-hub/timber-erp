import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Package, Plus, Trash2, Pencil, Layers } from 'lucide-react'
import { supabase, sel } from '../lib/supabase'
import { useItems, useSuppliers, useAction } from '../lib/hooks'
import { money, qty, num } from '../lib/format'
import { Button, Card, PageHeader, Table, Modal, Field, Select, Input, Badge, Textarea } from '../components/ui.jsx'

export default function Items() {
  const items = useItems().data || []
  const boms = useQuery({ queryKey: ['bom_all'], queryFn: () => sel(supabase.from('bom_lines').select('*')) }).data || []
  const [edit, setEdit] = useState(null)
  const [bomFor, setBomFor] = useState(null)
  const [q, setQ] = useState('')
  const isParent = (id) => boms.some((b) => b.parent_item_id === id)
  const rolled = (id) => boms.filter((b) => b.parent_item_id === id).reduce((s, b) => {
    const c = items.find((i) => i.id === b.component_item_id); return s + Number(b.qty_per) * Number(c?.avg_cost || c?.standard_cost || 0)
  }, 0)
  const rows = items.filter((i) => !q || (i.name + i.sku + i.barcode + i.category).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <PageHeader icon={Package} title="Items & Bills of Material" subtitle={`${items.length} items · ${new Set(boms.map((b) => b.parent_item_id)).size} parent items with BOMs`}
        actions={<Button onClick={() => setEdit({})}><Plus className="h-4 w-4" />New item</Button>} />
      <Card padded={false} actions={<Input placeholder="Search…" className="w-60 py-1.5" value={q} onChange={(e) => setQ(e.target.value)} />} title="Item master">
        <Table rows={rows} maxHeight="70vh" columns={[
          { label: 'SKU', render: (i) => <span className="font-mono text-xs">{i.sku}</span> },
          { label: 'Name', render: (i) => <div className="font-medium">{i.name}{!i.active && <Badge className="ml-2">inactive</Badge>}</div> },
          { label: 'Barcode', render: (i) => <span className="font-mono text-xs">{i.barcode}</span> },
          { label: 'Type', render: (i) => <Badge color={i.item_type === 'finished' ? 'brown' : i.item_type === 'resale' ? 'violet' : 'gray'}>{i.item_type}</Badge> },
          { label: 'Category', key: 'category' },
          { label: 'Avg cost', num: true, render: (i) => money(i.avg_cost) },
          { label: 'Price', num: true, render: (i) => (Number(i.price) ? money(i.price) : '—') },
          { label: 'Margin', num: true, render: (i) => (Number(i.price) ? `${num((1 - i.avg_cost / i.price) * 100, 0)}%` : '') },
          { label: 'Lead time', num: true, render: (i) => `${i.lead_time_days}d` },
          { label: 'Supplier', render: (i) => i.supplier?.name || <span className="text-stone-400">In-house</span> },
          { label: 'BOM', render: (i) => isParent(i.id) ? <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setBomFor(i) }}><Layers className="h-3.5 w-3.5" />BOM · {money(rolled(i.id))}</Button>
            : i.item_type === 'finished' ? <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setBomFor(i) }}>Add BOM</Button> : '' },
          { label: '', render: (i) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEdit(i) }}><Pencil className="h-3.5 w-3.5" /></Button> },
        ]} />
      </Card>
      <ItemModal item={edit} onClose={() => setEdit(null)} />
      <BomModal parent={bomFor} onClose={() => setBomFor(null)} />
    </>
  )
}

function ItemModal({ item, onClose }) {
  const suppliers = useSuppliers().data || []
  const [f, setF] = useState({})
  useEffect(() => { if (item) setF({ item_type: 'component', uom: 'ea', lead_time_days: 7, standard_cost: 0, price: 0, sellable: true, active: true, min_order_qty: 1, ...item }) }, [item])
  const save = useAction(async () => {
    const row = {
      sku: f.sku, barcode: f.barcode, name: f.name, description: f.description, category: f.category, item_type: f.item_type, uom: f.uom,
      standard_cost: Number(f.standard_cost || 0), price: Number(f.price || 0), lead_time_days: Number(f.lead_time_days || 0),
      supplier_id: f.supplier_id ? Number(f.supplier_id) : null, sellable: !!f.sellable, active: !!f.active, min_order_qty: Number(f.min_order_qty || 1),
      reorder_point_override: f.reorder_point_override === '' || f.reorder_point_override == null ? null : Number(f.reorder_point_override),
    }
    const q = item.id ? supabase.from('items').update(row).eq('id', item.id) : supabase.from('items').insert(row)
    const { error } = await q; if (error) throw new Error(error.message)
  }, { success: 'Item saved', onSuccess: onClose })
  if (!item) return null
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const genBarcode = () => {
    const base = '8500127' + String(Math.floor(Math.random() * 9000) + 1000)
    const d = base.split('').map(Number); const sum = 3 * (d[0] + d[2] + d[4] + d[6] + d[8] + d[10]) + (d[1] + d[3] + d[5] + d[7] + d[9])
    setF({ ...f, barcode: base + ((10 - (sum % 10)) % 10) })
  }
  return (
    <Modal open onClose={onClose} title={item.id ? `Edit ${item.sku}` : 'New item'} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="SKU"><Input value={f.sku || ''} onChange={set('sku')} /></Field>
        <Field label="Barcode"><div className="flex gap-1"><Input className="font-mono" value={f.barcode || ''} onChange={set('barcode')} /><Button variant="secondary" size="sm" onClick={genBarcode}>Gen</Button></div></Field>
        <Field label="Type"><Select value={f.item_type} onChange={set('item_type')} options={[{ value: 'finished', label: 'Finished (made in-house)' }, { value: 'component', label: 'Component / raw material' }, { value: 'resale', label: 'Resale (buy & sell)' }]} /></Field>
        <Field label="Name" className="sm:col-span-2"><Input value={f.name || ''} onChange={set('name')} /></Field>
        <Field label="Category"><Input value={f.category || ''} onChange={set('category')} /></Field>
        <Field label="Description" className="sm:col-span-3"><Textarea rows={2} value={f.description || ''} onChange={set('description')} /></Field>
        <Field label="Unit of measure"><Input value={f.uom || ''} onChange={set('uom')} /></Field>
        <Field label="Standard / purchase cost"><Input type="number" step="0.01" value={f.standard_cost} onChange={set('standard_cost')} /></Field>
        <Field label="Selling price"><Input type="number" step="0.01" value={f.price} onChange={set('price')} /></Field>
        <Field label="Lead time (days)" hint="Supplier lead time, or production time for made items"><Input type="number" value={f.lead_time_days} onChange={set('lead_time_days')} /></Field>
        <Field label="Preferred supplier"><Select placeholder="— none (made in-house)" value={f.supplier_id || ''} onChange={set('supplier_id')} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} /></Field>
        <Field label="Min order qty"><Input type="number" value={f.min_order_qty} onChange={set('min_order_qty')} /></Field>
        <Field label="Reorder point override" hint="Blank = computed from usage × lead time + safety stock"><Input type="number" value={f.reorder_point_override ?? ''} onChange={set('reorder_point_override')} /></Field>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={!!f.sellable} onChange={set('sellable')} />Sold to customers</label>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={!!f.active} onChange={set('active')} />Active</label>
      </div>
      {item.id && <p className="mt-3 text-xs text-stone-500">Weighted-average cost ({money(item.avg_cost)}) is maintained automatically by receipts and production.</p>}
    </Modal>
  )
}

function BomModal({ parent, onClose }) {
  const items = useItems().data || []
  const { data: lines = [], refetch } = useQuery({ enabled: !!parent, queryKey: ['bom', parent?.id], queryFn: () => sel(supabase.from('bom_lines').select('*, component:items!bom_lines_component_item_id_fkey(*)').eq('parent_item_id', parent.id).order('id')) })
  const [add, setAdd] = useState({ component: '', qty: 1 })
  const addLine = useAction(async () => {
    const { error } = await supabase.from('bom_lines').insert({ parent_item_id: parent.id, component_item_id: Number(add.component), qty_per: Number(add.qty) })
    if (error) throw new Error(error.message.includes('duplicate') ? 'That component is already on the BOM' : error.message)
  }, { success: 'Component added', onSuccess: () => { setAdd({ component: '', qty: 1 }); refetch() } })
  const updLine = useAction(async ({ id, qty_per }) => { const { error } = await supabase.from('bom_lines').update({ qty_per }).eq('id', id); if (error) throw new Error(error.message) }, { onSuccess: () => refetch() })
  const delLine = useAction(async (id) => { const { error } = await supabase.from('bom_lines').delete().eq('id', id); if (error) throw new Error(error.message) }, { success: 'Removed', onSuccess: () => refetch() })
  if (!parent) return null
  const total = lines.reduce((s, l) => s + Number(l.qty_per) * Number(l.component.avg_cost || l.component.standard_cost), 0)
  return (
    <Modal open onClose={onClose} title={`Bill of material — ${parent.name}`} wide footer={<Button onClick={onClose}>Done</Button>}>
      <Table rows={lines} columns={[
        { label: 'Component', render: (l) => <div><div className="font-medium">{l.component.name}</div><div className="text-xs text-stone-500">{l.component.sku} · lead time {l.component.lead_time_days}d</div></div> },
        { label: 'Qty per unit', render: (l) => <div className="flex items-center gap-1"><Input type="number" step="any" className="w-24 py-1" defaultValue={l.qty_per} onBlur={(e) => Number(e.target.value) !== Number(l.qty_per) && updLine.mutate({ id: l.id, qty_per: Number(e.target.value) })} /><span className="text-xs text-stone-500">{l.component.uom}</span></div> },
        { label: 'Unit cost', num: true, render: (l) => money(l.component.avg_cost || l.component.standard_cost) },
        { label: 'Extended', num: true, render: (l) => money(Number(l.qty_per) * Number(l.component.avg_cost || l.component.standard_cost)) },
        { label: '', render: (l) => <Button size="sm" variant="ghost" onClick={() => delLine.mutate(l.id)}><Trash2 className="h-4 w-4" /></Button> },
      ]} footer={<tr><td className="td" colSpan={3}>Rolled-up material cost per unit</td><td className="td num">{money(total)}</td><td /></tr>} />
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Field label="Add component" className="flex-1"><Select placeholder="Choose…" value={add.component} onChange={(e) => setAdd({ ...add, component: e.target.value })} options={items.filter((i) => i.id !== parent.id).map((i) => ({ value: i.id, label: `${i.sku} — ${i.name}` }))} /></Field>
        <Field label="Qty per"><Input type="number" step="any" className="w-24" value={add.qty} onChange={(e) => setAdd({ ...add, qty: e.target.value })} /></Field>
        <Button disabled={!add.component} onClick={() => addLine.mutate()}><Plus className="h-4 w-4" />Add</Button>
      </div>
      <p className="mt-3 text-xs text-stone-500">Selling price {money(parent.price)} → material margin {parent.price ? num((1 - total / parent.price) * 100, 1) : 0}%. Production orders issue exactly these quantities × units started, and MRP explodes demand through this BOM.</p>
    </Modal>
  )
}
