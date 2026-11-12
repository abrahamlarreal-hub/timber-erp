import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Undo2, Search, Camera } from 'lucide-react'
import { supabase, sel, rpc } from '../lib/supabase'
import { useItems, useReasons, useInventory, useAction, useSettings } from '../lib/hooks'
import { money, fmtDate, qty } from '../lib/format'
import { Button, Card, PageHeader, Table, StatusBadge, Input, Select, Field, Textarea, Badge, Explain } from '../components/ui.jsx'
import { CameraScanner } from '../components/Barcode.jsx'
import LineEditor from '../components/LineEditor.jsx'

export default function Returns() {
  const [params] = useSearchParams()
  const [lookup, setLookup] = useState('')
  const [orderId, setOrderId] = useState(params.get('order') ? Number(params.get('order')) : null)
  const [cam, setCam] = useState(false)
  const recent = useQuery({ queryKey: ['returns'], queryFn: () => sel(supabase.from('returns').select('*, order:sales_orders!returns_sales_order_id_fkey(number, id), lines:return_lines(qty, reason_code, disposition, item:items(name))').order('ts', { ascending: false }).limit(50)) })
  const find = async (code) => {
    const c = (code ?? lookup).trim().toUpperCase()
    const r = await sel(supabase.from('sales_orders').select('id').eq('number', c).maybeSingle())
    if (r) setOrderId(r.id); else alert(`No order ${c}`)
  }
  return (
    <>
      <PageHeader icon={Undo2} title="Returns & Exchanges" subtitle="Return items to stock (or Quality Hold for defects), reverse revenue and cost, or exchange for another item." />
      <Card title="Find the original sale" subtitle="Type the order / receipt number or scan the barcode printed on the receipt">
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-xs font-mono" placeholder="e.g. POS-52310" value={lookup} onChange={(e) => setLookup(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()} />
          <Button onClick={() => find()}><Search className="h-4 w-4" />Find</Button>
          <Button variant="secondary" onClick={() => setCam(true)}><Camera className="h-4 w-4" />Scan receipt</Button>
        </div>
      </Card>
      <CameraScanner open={cam} onClose={() => setCam(false)} onDetected={(t) => { setLookup(t); find(t) }} />
      {orderId && <ReturnForm key={orderId} orderId={orderId} onDone={() => setOrderId(null)} />}
      <Card className="mt-5" title="Recent returns & exchanges" padded={false}>
        <Table rows={recent.data || []} maxHeight={420} columns={[
          { label: 'RMA', render: (r) => <span className="font-medium">{r.number}</span> },
          { label: 'Type', render: (r) => <StatusBadge status={r.kind} /> },
          { label: 'Date', render: (r) => fmtDate(r.ts) },
          { label: 'Original sale', render: (r) => <Link className="text-brand-700 hover:underline" to={`/sales/${r.order?.id}`}>{r.order?.number}</Link> },
          { label: 'Items / reason', render: (r) => r.lines.map((l, i) => <div key={i} className="text-xs">{qty(l.qty)}× {l.item.name} — <b>{l.reason_code}</b> → {l.disposition}</div>) },
          { label: 'Refund', num: true, render: (r) => money(r.refund_amount) },
          { label: 'Net due from customer', num: true, render: (r) => money(r.net_due_from_customer) },
        ]} />
      </Card>
    </>
  )
}

function ReturnForm({ orderId, onDone }) {
  const items = useItems().data || []
  const inv = useInventory().data || []
  const taxRate = Number(useSettings().data?.map.tax_rate || 0)
  const reasons = (useReasons().data || []).filter((r) => ['return', 'quality'].includes(r.category) && !r.code.startsWith('SC-') && !r.code.startsWith('RW-'))
  const { data: o } = useQuery({ queryKey: ['order', orderId], queryFn: () => sel(supabase.from('sales_orders').select('*, customer:customers(name), location:locations(*), lines:sales_order_lines(*, item:items(name, sku))').eq('id', orderId).single()) })
  const [sel_, setSel] = useState({})
  const [exch, setExch] = useState([])
  const [notes, setNotes] = useState('')
  useEffect(() => { setSel({}) }, [orderId])
  const process = useAction(() => rpc('process_return', {
    p_order: orderId,
    p_lines: Object.entries(sel_).filter(([, v]) => Number(v.qty) > 0).map(([id, v]) => ({ so_line_id: Number(id), qty: Number(v.qty), reason_code: v.reason, disposition: v.disposition })),
    p_exchange_lines: exch.length ? exch.map((l) => ({ item_id: l.item_id, qty: Number(l.qty) })) : null,
    p_notes: notes || null,
  }), { success: (rid) => `Return processed — inventory and financials updated`, onSuccess: onDone })
  if (!o) return null
  if (!['Fulfilled', 'Closed'].includes(o.status)) return <Card className="mt-5"><p className="text-sm">Order {o.number} is <StatusBadge status={o.status} /> — only fulfilled sales can be returned.</p></Card>
  const refund = o.lines.reduce((s, l) => {
    const v = sel_[l.id]; if (!v?.qty) return s
    return s + (Number(l.net_amount) + Number(l.tax_amount)) / Number(l.qty) * Number(v.qty)
  }, 0)
  const exTotal = exch.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0) * (1 + taxRate)
  const set = (id, k, v) => setSel({ ...sel_, [id]: { qty: 0, reason: 'CHG', disposition: 'Restock', ...sel_[id], [k]: v } })
  return (
    <Card className="mt-5" title={`Return against ${o.number}`} subtitle={`${o.customer?.name || 'Walk-in'} · ${o.location.name} · sold ${fmtDate(o.fulfilled_at)}`}>
      <Table rows={o.lines} columns={[
        { label: 'Item', render: (l) => <div><div className="font-medium">{l.item.name}</div><div className="text-xs text-stone-500">paid {money((Number(l.net_amount) + Number(l.tax_amount)) / Number(l.qty))}/ea incl. tax</div></div> },
        { label: 'Sold', num: true, render: (l) => qty(l.qty) },
        { label: 'Returnable', num: true, render: (l) => qty(l.qty - l.qty_returned) },
        { label: 'Return qty', render: (l) => <Input type="number" min="0" max={l.qty - l.qty_returned} className="w-20 py-1" value={sel_[l.id]?.qty || ''} onChange={(e) => set(l.id, 'qty', e.target.value)} disabled={l.qty - l.qty_returned <= 0} /> },
        { label: 'Reason code', render: (l) => <Select className="w-56 py-1" value={sel_[l.id]?.reason || 'CHG'} onChange={(e) => { const r = e.target.value; setSel({ ...sel_, [l.id]: { qty: 0, ...sel_[l.id], reason: r, disposition: r.startsWith('QF') ? 'Quality Hold' : 'Restock' } }) }} options={reasons.map((r) => ({ value: r.code, label: `${r.code} — ${r.description}` }))} /> },
        { label: 'Disposition', render: (l) => <Select className="w-40 py-1" value={sel_[l.id]?.disposition || 'Restock'} onChange={(e) => set(l.id, 'disposition', e.target.value)} options={[{ value: 'Restock', label: 'Restock (sellable)' }, { value: 'Quality Hold', label: 'Quality Hold' }]} /> },
      ]} />
      <div className="mt-4">
        <div className="label">Exchange for (optional)</div>
        <LineEditor items={items.filter((i) => i.sellable && Number(i.price) > 0)} lines={exch} setLines={setExch}
          stockFor={(id) => Number(inv.find((r) => r.item_id === id && r.location_id === o.location_id)?.qty || 0)} />
      </div>
      <Field label="Notes" className="mt-3"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-stone-50 p-3">
        <div className="text-sm">
          Refund <b>{money(refund)}</b>{exch.length > 0 && <> · Exchange items ≈ <b>{money(exTotal)}</b> · {exTotal - refund >= 0 ? <>Customer pays <b>{money(exTotal - refund)}</b></> : <>Refund difference <b>{money(refund - exTotal)}</b></>}</>}
        </div>
        <div className="flex gap-2"><Button variant="secondary" onClick={onDone}>Cancel</Button>
          <Button loading={process.isPending} disabled={refund <= 0} onClick={() => process.mutate()}>{exch.length ? 'Process exchange' : 'Process return'}</Button></div>
      </div>
      <div className="mt-3"><Explain title="What happens in the books">
        <p><b>Inventory:</b> returned units go back to {o.location.name} at their original cost — or to <b>Quality Hold</b> (not sellable) when the reason is a quality failure, so defects are inspected before restocking or scrapping.</p>
        <p><b>Revenue:</b> the net price paid is debited to <i>Sales Returns &amp; Allowances</i> (a contra-revenue account, so the P&amp;L shows gross sales, returns and net sales separately) and sales tax is reversed.</p>
        <p><b>Cost:</b> COGS is credited and Inventory debited by the original unit cost, so gross margin is corrected.</p>
        <p><b>Exchange:</b> the replacement is recorded as a new sale (inventory out, revenue, COGS) linked to this RMA; the customer pays or receives the difference.</p>
      </Explain></div>
    </Card>
  )
}
