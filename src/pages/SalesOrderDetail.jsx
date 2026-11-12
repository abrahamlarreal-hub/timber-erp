import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, PackageCheck, CheckCircle2, XCircle, Receipt as ReceiptIcon, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { supabase, sel, rpc } from '../lib/supabase'
import { useInventory, useAction } from '../lib/hooks'
import { money, fmtDate, fmtDateTime, qty, pct } from '../lib/format'
import { Button, Card, PageHeader, Table, StatusBadge, Spinner, Badge } from '../components/ui.jsx'
import { useOrder, ReceiptModal } from '../components/Receipt.jsx'

export default function SalesOrderDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const { data: o, isLoading } = useOrder(Number(id))
  const inv = useInventory().data || []
  const [receipt, setReceipt] = useState(null)
  const returns = useQuery({ enabled: !!o, queryKey: ['returns_for', id], queryFn: () => sel(supabase.from('returns').select('*, lines:return_lines(*, item:items(name))').eq('sales_order_id', id)) })
  const shortLines = (o?.status === 'Placed' ? o.lines : []).filter((l) => Number(inv.find((r) => r.item_id === l.item_id && r.location_id === o.location_id)?.qty || 0) < Number(l.qty))
  const etas = useQuery({
    enabled: shortLines.length > 0,
    queryKey: ['eta', id, shortLines.map((l) => l.id).join()],
    queryFn: async () => Object.fromEntries(await Promise.all(shortLines.map(async (l) => [l.id, await rpc('est_available_date', { p_item: l.item_id, p_qty: Number(l.qty) })]))),
  })
  const fulfill = useAction(() => rpc('fulfill_sales_order', { p_id: o.id }), { success: 'Fulfilled — inventory relieved, revenue & COGS recorded' })
  const close = useAction(() => rpc('close_sales_order', { p_id: o.id }), { success: 'Order closed — payment recorded' })
  const cancel = useAction(() => rpc('cancel_sales_order', { p_id: o.id, p_reason: 'Cancelled by staff' }), { success: 'Order cancelled' })
  if (isLoading || !o) return <Spinner />
  const margin = o.cogs && o.subtotal ? ((o.subtotal - o.discount - o.cogs) / (o.subtotal - o.discount)) * 100 : null
  return (
    <>
      <button onClick={() => nav(-1)} className="mb-3 flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800"><ArrowLeft className="h-4 w-4" />Back</button>
      <PageHeader title={<span className="flex items-center gap-3">{o.number} <StatusBadge status={o.status} /></span>}
        subtitle={`${o.customer?.name || 'Walk-in customer'} · ${o.location?.name} · ${o.source === 'WEB' ? 'Customer portal pickup order' : o.source}`}
        actions={<>
          {o.status === 'Placed' && <Button variant="success" loading={fulfill.isPending} onClick={() => fulfill.mutate()}><PackageCheck className="h-4 w-4" />Fulfill (ship / pick up)</Button>}
          {o.status === 'Fulfilled' && <Button variant="success" loading={close.isPending} onClick={() => close.mutate()}><CheckCircle2 className="h-4 w-4" />Record payment & close</Button>}
          {o.status === 'Placed' && <Button variant="secondary" loading={cancel.isPending} onClick={() => confirm('Cancel this order?') && cancel.mutate()}><XCircle className="h-4 w-4" />Cancel</Button>}
          {['Fulfilled', 'Closed'].includes(o.status) && <Button variant="secondary" onClick={() => nav(`/returns?order=${o.id}`)}><Undo2 className="h-4 w-4" />Return / exchange</Button>}
          {['Fulfilled', 'Closed'].includes(o.status) && <Button variant="secondary" onClick={() => setReceipt(o.id)}><ReceiptIcon className="h-4 w-4" />Receipt</Button>}
        </>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Lines" padded={false}>
          <Table rows={o.lines} columns={[
            { label: 'Item', render: (l) => <div><div className="font-medium">{l.item.name}</div><div className="text-xs text-stone-500">{l.item.sku}</div></div> },
            { label: 'Qty', num: true, render: (l) => qty(l.qty) },
            { label: 'Price', num: true, render: (l) => money(l.unit_price) },
            { label: 'Disc', num: true, render: (l) => (Number(l.discount_pct) ? pct(l.discount_pct, 0) : '') },
            { label: 'Net', num: true, render: (l) => money(l.net_amount) },
            { label: 'Unit cost', num: true, render: (l) => (l.unit_cost ? money(l.unit_cost) : '—') },
            { label: 'Availability', render: (l) => {
              if (o.status !== 'Placed') return Number(l.qty_returned) ? <Badge color="amber">{qty(l.qty_returned)} returned</Badge> : <Badge color="green">Shipped</Badge>
              const have = Number(inv.find((r) => r.item_id === l.item_id && r.location_id === o.location_id)?.qty || 0)
              if (have >= Number(l.qty)) return <Badge color="green">In stock ({qty(have)})</Badge>
              return <div><Badge color="red">Backordered — {qty(Number(l.qty) - have)} short</Badge><div className="mt-0.5 text-xs text-stone-500">Est. available {etas.data?.[l.id] ? fmtDate(etas.data[l.id]) : '…'}</div></div>
            } },
          ]} />
        </Card>
        <Card title="Summary">
          <dl className="space-y-1.5 text-sm">
            {[['Ordered', fmtDateTime(o.order_date)], ['Requested / due', fmtDate(o.due_date)], ['Fulfilled', fmtDateTime(o.fulfilled_at)], ['Closed', fmtDateTime(o.closed_at)], ['Entered by', o.created_by_name]].map(([k, v]) => (
              <div key={k} className="flex justify-between"><dt className="text-stone-500">{k}</dt><dd>{v}</dd></div>))}
            <div className="my-2 border-t" />
            <div className="flex justify-between"><dt className="text-stone-500">Subtotal</dt><dd>{money(o.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Discounts</dt><dd>−{money(o.discount)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Sales tax</dt><dd>{money(o.tax)}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{money(o.total)}</dd></div>
            {Number(o.cogs) > 0 && <><div className="flex justify-between"><dt className="text-stone-500">Cost of goods sold</dt><dd>{money(o.cogs)}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">Gross margin</dt><dd>{pct(margin)}</dd></div></>}
          </dl>
          {o.notes && <p className="mt-3 rounded-lg bg-stone-50 p-2 text-xs text-stone-600">{o.notes}</p>}
        </Card>
      </div>
      {returns.data?.length > 0 && (
        <Card className="mt-5" title="Returns & exchanges on this order" padded={false}>
          <Table rows={returns.data} columns={[
            { label: 'RMA', key: 'number' }, { label: 'Type', render: (r) => <StatusBadge status={r.kind} /> },
            { label: 'Date', render: (r) => fmtDate(r.ts) },
            { label: 'Items', render: (r) => r.lines.map((l) => `${qty(l.qty)}× ${l.item.name} (${l.reason_code}, ${l.disposition})`).join('; ') },
            { label: 'Refund', num: true, render: (r) => money(r.refund_amount) },
          ]} />
        </Card>
      )}
      <ReceiptModal id={receipt} onClose={() => setReceipt(null)} />
    </>
  )
}
