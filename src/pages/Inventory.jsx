import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Boxes, ArrowLeftRight, ClipboardCheck, SlidersHorizontal } from 'lucide-react'
import { supabase, sel, rpc } from '../lib/supabase'
import { useItems, useLocations, useInventory, usePolicy, useReasons, useAction } from '../lib/hooks'
import { money, qty, fmtDate, fmtDateTime } from '../lib/format'
import { Button, Card, PageHeader, Table, Modal, Field, Select, Input, Badge, Stat, Tabs, cx } from '../components/ui.jsx'
import { ScanInput, BarcodeSvg } from '../components/Barcode.jsx'

export default function Inventory() {
  const [params, setParams] = useSearchParams()
  const items = useItems().data || []
  const locs = useLocations().data || []
  const inv = useInventory().data || []
  const policy = usePolicy().data || []
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [filter, setFilter] = useState('all')
  const [openItem, setOpenItem] = useState(params.get('item') ? Number(params.get('item')) : null)
  const [scanAction, setScanAction] = useState('adjust')
  const [action, setAction] = useState(null) // {type, item}
  useEffect(() => { if (params.get('item')) setOpenItem(Number(params.get('item'))) }, [params])

  const pol = Object.fromEntries(policy.map((p) => [p.item_id, p]))
  const rows = useMemo(() => items.filter((i) => i.active).map((i) => {
    const r = { ...i, p: pol[i.id] || {} }
    locs.forEach((l) => { r['loc_' + l.id] = Number(inv.find((x) => x.item_id === i.id && x.location_id === l.id)?.qty || 0) })
    r.total = locs.reduce((s, l) => s + r['loc_' + l.id], 0)
    r.value = r.total * Number(i.avg_cost)
    return r
  }).filter((r) => (!q || (r.name + r.sku + r.barcode).toLowerCase().includes(q.toLowerCase())) && (!cat || r.category === cat)
    && (filter === 'all' || (filter === 'low' && r.p.needs_reorder) || (filter === 'bo' && r.p.backordered_qty > 0) || (filter === 'hold' && r.p.on_hold > 0))),
  [items, locs, inv, q, cat, filter, pol])

  const totalValue = rows.reduce((s, r) => s + r.value, 0)
  const cats = [...new Set(items.map((i) => i.category))].sort()
  return (
    <>
      <PageHeader icon={Boxes} title="Inventory" subtitle="On-hand by item and location, transfers, adjustments with reason codes, cycle counts, backorders and ETAs" />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Inventory value (shown)" value={money(totalValue)} sub="qty × weighted average cost" />
        <Stat label="Below reorder point" value={policy.filter((p) => p.needs_reorder).length} tone="warn" onClick={() => setFilter('low')} />
        <Stat label="Backordered items" value={policy.filter((p) => p.backordered_qty > 0).length} tone="bad" onClick={() => setFilter('bo')} />
        <Stat label="Units on quality hold" value={qty(policy.reduce((s, p) => s + Number(p.on_hold), 0))} onClick={() => setFilter('hold')} />
      </div>

      <Card className="mb-5" title="Scan to adjust / count / transfer" subtitle="Scan a printed label with a USB scanner or phone camera — the matching action opens for that item">
        <div className="flex flex-wrap gap-2">
          <Select className="w-48" value={scanAction} onChange={(e) => setScanAction(e.target.value)} options={[{ value: 'adjust', label: 'Adjust (reason code)' }, { value: 'count', label: 'Cycle count' }, { value: 'transfer', label: 'Transfer' }, { value: 'view', label: 'Look up item' }]} />
          <ScanInput className="min-w-[280px] flex-1" items={items} onItem={(it) => (scanAction === 'view' ? setOpenItem(it.id) : setAction({ type: scanAction, item: it }))} />
        </div>
      </Card>

      <Card padded={false} title="Stock by location" actions={<>
        <Input placeholder="Search item, SKU, barcode…" value={q} onChange={(e) => setQ(e.target.value)} className="w-56 py-1.5" />
        <Select value={cat} onChange={(e) => setCat(e.target.value)} placeholder="All categories" options={cats.map((c) => ({ value: c, label: c }))} className="w-44 py-1.5" />
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-40 py-1.5" options={[{ value: 'all', label: 'All items' }, { value: 'low', label: 'Below ROP' }, { value: 'bo', label: 'Backordered' }, { value: 'hold', label: 'On quality hold' }]} />
      </>}>
        <Table rows={rows} onRowClick={(r) => setOpenItem(r.id)} maxHeight="65vh" columns={[
          { label: 'Item', render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-stone-500">{r.sku} · {r.uom}</div></div> },
          ...locs.map((l) => ({ label: l.code, num: true, render: (r) => <span className={cx(r['loc_' + l.id] === 0 && 'text-stone-300', l.kind === 'quarantine' && r['loc_' + l.id] > 0 && 'font-semibold text-amber-700')}>{qty(r['loc_' + l.id])}</span> })),
          { label: 'Total', num: true, render: (r) => <b>{qty(r.total)}</b> },
          { label: 'On order', num: true, render: (r) => (Number(r.p.on_order) ? qty(r.p.on_order) : '') },
          { label: 'ROP', num: true, render: (r) => r.p.reorder_point },
          { label: 'Status', render: (r) => r.p.backordered_qty > 0
            ? <div><Badge color="red">Backordered {qty(r.p.backordered_qty)}</Badge><div className="text-[11px] text-stone-500">ETA {fmtDate(r.p.backorder_eta)}</div></div>
            : r.p.needs_reorder ? <Badge color="amber">Reorder</Badge> : <Badge color="green">OK</Badge> },
          { label: 'Avg cost', num: true, render: (r) => money(r.avg_cost) },
          { label: 'Value', num: true, render: (r) => money(r.value) },
        ]} />
      </Card>
      <ItemDrawer id={openItem} onClose={() => { setOpenItem(null); if (params.get('item')) setParams({}) }} onAction={(type, item) => setAction({ type, item })} />
      <InvActionModal action={action} onClose={() => setAction(null)} />
    </>
  )
}

function ItemDrawer({ id, onClose, onAction }) {
  const items = useItems().data || []
  const locs = useLocations().data || []
  const inv = useInventory().data || []
  const p = (usePolicy().data || []).find((x) => x.item_id === id)
  const it = items.find((i) => i.id === id)
  const [tab, setTab] = useState('stock')
  const ledger = useQuery({
    enabled: !!id, queryKey: ['ledger', id],
    queryFn: () => sel(supabase.from('inv_txns').select('*, location:locations(code)').eq('item_id', id).order('ts', { ascending: false }).limit(150)),
  })
  if (!it) return null
  return (
    <Modal open={!!id} onClose={onClose} title={`${it.name} (${it.sku})`} size="xl"
      footer={<>
        <Button variant="secondary" onClick={() => onAction('transfer', it)}><ArrowLeftRight className="h-4 w-4" />Transfer</Button>
        <Button variant="secondary" onClick={() => onAction('adjust', it)}><SlidersHorizontal className="h-4 w-4" />Adjust</Button>
        <Button onClick={() => onAction('count', it)}><ClipboardCheck className="h-4 w-4" />Cycle count</Button>
      </>}>
      <div className="mb-4 flex flex-wrap items-center gap-6">
        <BarcodeSvg value={it.barcode} height={40} />
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-stone-500">Avg cost</dt><dd>{money(it.avg_cost)}</dd></div>
          <div><dt className="text-xs text-stone-500">Price</dt><dd>{Number(it.price) ? money(it.price) : '—'}</dd></div>
          <div><dt className="text-xs text-stone-500">Lead time</dt><dd>{it.lead_time_days} days</dd></div>
          <div><dt className="text-xs text-stone-500">Supplier</dt><dd>{it.supplier?.name || 'Made in-house'}</dd></div>
          <div><dt className="text-xs text-stone-500">Reorder point</dt><dd>{p?.reorder_point}</dd></div>
          <div><dt className="text-xs text-stone-500">On order</dt><dd>{qty(p?.on_order)}</dd></div>
          <div><dt className="text-xs text-stone-500">Allocated to orders</dt><dd>{qty(p?.allocated)}</dd></div>
          <div><dt className="text-xs text-stone-500">Est. available</dt><dd>{p?.backordered_qty > 0 ? fmtDate(p.backorder_eta) : 'In stock'}</dd></div>
        </dl>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'stock', label: 'By location' }, { value: 'ledger', label: 'Transaction history' }]} />
      {tab === 'stock' ? (
        <Table rows={locs} columns={[
          { label: 'Location', render: (l) => <div><b>{l.code}</b> {l.name}</div> },
          { label: 'Type', render: (l) => <Badge>{l.kind}</Badge> },
          { label: 'On hand', num: true, render: (l) => qty(inv.find((x) => x.item_id === id && x.location_id === l.id)?.qty || 0) },
          { label: 'Value', num: true, render: (l) => money((inv.find((x) => x.item_id === id && x.location_id === l.id)?.qty || 0) * it.avg_cost) },
        ]} />
      ) : (
        <Table rows={ledger.data || []} maxHeight={360} dense columns={[
          { label: 'When', render: (t) => fmtDateTime(t.ts) },
          { label: 'Type', render: (t) => <Badge color={t.qty > 0 ? 'green' : 'gray'}>{t.txn_type.replace('_', ' ')}</Badge> },
          { label: 'Loc', render: (t) => t.location.code },
          { label: 'Qty', num: true, render: (t) => <span className={t.qty > 0 ? 'text-emerald-700' : 'text-stone-700'}>{t.qty > 0 ? '+' : ''}{qty(t.qty)}</span> },
          { label: 'Unit cost', num: true, render: (t) => money(t.unit_cost) },
          { label: 'Reason', render: (t) => t.reason_code || '' },
          { label: 'Ref', render: (t) => t.note || '' },
          { label: 'User', render: (t) => t.user_name },
        ]} />
      )}
    </Modal>
  )
}

export function InvActionModal({ action, onClose }) {
  const locs = useLocations().data || []
  const inv = useInventory().data || []
  const reasons = (useReasons().data || []).filter((r) => r.category === 'adjustment' || r.code.startsWith('QF'))
  const [f, setF] = useState({})
  useEffect(() => { setF({ from: '', to: '', loc: '', qty: '', reason: action?.type === 'count' ? 'CC' : 'DMG', direction: '-', note: '' }) }, [action])
  const it = action?.item
  const onHand = (lid) => Number(inv.find((x) => x.item_id === it?.id && x.location_id === Number(lid))?.qty || 0)
  const run = useAction(async () => {
    if (action.type === 'transfer') return rpc('transfer_inventory', { p_item: it.id, p_from: Number(f.from), p_to: Number(f.to), p_qty: Number(f.qty), p_note: f.note || null })
    if (action.type === 'adjust') return rpc('adjust_inventory', { p_item: it.id, p_loc: Number(f.loc), p_qty_change: Number(f.qty) * (f.direction === '-' ? -1 : 1), p_reason: f.reason, p_note: f.note || null })
    return rpc('cycle_count', { p_item: it.id, p_loc: Number(f.loc), p_counted: Number(f.qty), p_reason: f.reason, p_note: f.note || null })
  }, { success: (d) => (action.type === 'count' ? `Count saved — variance ${d > 0 ? '+' : ''}${qty(d)}` : 'Inventory updated'), onSuccess: onClose })
  if (!action) return null
  const title = { transfer: 'Transfer between locations', adjust: 'Inventory adjustment', count: 'Cycle count' }[action.type]
  const locOpts = locs.map((l) => ({ value: l.id, label: `${l.name} (on hand ${qty(onHand(l.id))})` }))
  return (
    <Modal open={!!action} onClose={onClose} title={`${title}: ${it.name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={run.isPending} onClick={() => run.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        {action.type === 'transfer' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><Select placeholder="Choose…" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} options={locOpts} /></Field>
            <Field label="To"><Select placeholder="Choose…" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} options={locOpts} /></Field>
          </div>
        ) : (
          <Field label="Location"><Select placeholder="Choose…" value={f.loc} onChange={(e) => setF({ ...f, loc: e.target.value })} options={locOpts} /></Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          {action.type === 'adjust' && <Field label="Direction"><Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })} options={[{ value: '-', label: 'Decrease (−)' }, { value: '+', label: 'Increase (+)' }]} /></Field>}
          <Field label={action.type === 'count' ? 'Counted quantity' : 'Quantity'} hint={action.type === 'count' && f.loc ? `System shows ${qty(onHand(f.loc))} — variance ${qty(Number(f.qty || 0) - onHand(f.loc))}` : null}>
            <Input type="number" min="0" step="any" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} autoFocus /></Field>
          {action.type !== 'transfer' && <Field label="Reason code"><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} options={reasons.map((r) => ({ value: r.code, label: `${r.code} — ${r.description}` }))} /></Field>}
        </div>
        <Field label="Note"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {action.type !== 'transfer' && <p className="text-xs text-stone-500">Adjustments are valued at weighted-average cost and posted to the “Inventory Shrinkage &amp; Adjustments” expense account on the P&amp;L.</p>}
      </div>
    </Modal>
  )
}
