import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Plus } from 'lucide-react'
import { supabase, sel, rpc } from '../lib/supabase'
import { useItems, useLocations, useCustomers, useInventory, useAction } from '../lib/hooks'
import { money, fmtDate, addDays, isoDate } from '../lib/format'
import { Button, Card, PageHeader, Table, StatusBadge, Modal, Field, Select, Input, Textarea, Badge, Tabs } from '../components/ui.jsx'
import LineEditor from '../components/LineEditor.jsx'

export default function SalesOrders() {
  const nav = useNavigate()
  const [tab, setTab] = useState('open')
  const [show, setShow] = useState(false)
  const { data = [] } = useQuery({
    queryKey: ['sales_orders', tab],
    queryFn: () => {
      let q = supabase.from('sales_orders').select('*, customer:customers(name), location:locations(code)').order('order_date', { ascending: false }).limit(300)
      if (tab === 'open') q = q.in('status', ['Placed', 'Fulfilled'])
      else if (tab === 'orders') q = q.in('source', ['SO', 'WEB'])
      else if (tab === 'pos') q = q.eq('source', 'POS')
      return sel(q)
    },
  })
  return (
    <>
      <PageHeader icon={ClipboardList} title="Sales Orders" subtitle="Order Placed → Fulfilled (shipped/picked up: inventory & revenue posted) → Closed (paid) or Cancelled"
        actions={<Button onClick={() => setShow(true)}><Plus className="h-4 w-4" />New sales order</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'open', label: 'Open' }, { value: 'orders', label: 'All orders' }, { value: 'pos', label: 'POS sales' }, { value: 'all', label: 'Everything' }]} />
      <Card padded={false}>
        <Table rows={data} onRowClick={(r) => nav(`/sales/${r.id}`)} columns={[
          { label: 'Number', render: (r) => <span className="font-medium">{r.number}</span> },
          { label: 'Channel', render: (r) => <Badge color={r.source === 'WEB' ? 'violet' : r.source === 'POS' ? 'gray' : 'blue'}>{r.source === 'WEB' ? 'Customer portal' : r.source}</Badge> },
          { label: 'Customer', render: (r) => r.customer?.name || <span className="text-stone-400">Walk-in</span> },
          { label: 'Location', render: (r) => r.location?.code },
          { label: 'Ordered', render: (r) => fmtDate(r.order_date) },
          { label: 'Due', render: (r) => <span className={r.status === 'Placed' && r.due_date < isoDate() ? 'font-medium text-red-600' : ''}>{fmtDate(r.due_date)}</span> },
          { label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          { label: 'Total', num: true, render: (r) => money(r.total) },
        ]} />
      </Card>
      <NewSalesOrder open={show} onClose={() => setShow(false)} onCreated={(id) => nav(`/sales/${id}`)} />
    </>
  )
}

export function NewSalesOrder({ open, onClose, onCreated }) {
  const items = useItems().data || []
  const locs = useLocations().data || []
  const customers = useCustomers().data || []
  const inv = useInventory().data || []
  const [f, setF] = useState({ customer: '', location: '', due: addDays(isoDate(), 3), discount: 0, notes: '' })
  const [lines, setLines] = useState([])
  const wh = locs.find((l) => l.kind === 'warehouse')
  const loc = Number(f.location || wh?.id)
  const create = useAction(() => rpc('create_sales_order', {
    p_customer: Number(f.customer), p_location: loc, p_lines: lines.map((l) => ({ ...l, qty: Number(l.qty), unit_price: Number(l.unit_price), discount_pct: Number(l.discount_pct) })),
    p_source: 'SO', p_discount_pct: Number(f.discount || 0), p_due: f.due, p_notes: f.notes || null,
  }), { success: (id) => 'Sales order placed', onSuccess: (id) => { onClose(); setLines([]); onCreated?.(id) } })
  return (
    <Modal open={open} onClose={onClose} title="New sales order" size="xl"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!f.customer || !lines.length} loading={create.isPending} onClick={() => create.mutate()}>Place order</Button></>}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Customer"><Select placeholder="Choose…" value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })} options={customers.map((c) => ({ value: c.id, label: `${c.name}${c.customer_type === 'Wholesale' ? ' (wholesale)' : ''}` }))} /></Field>
        <Field label="Ship / pick-up from"><Select value={f.location || wh?.id || ''} onChange={(e) => setF({ ...f, location: e.target.value })} options={locs.filter((l) => l.sellable).map((l) => ({ value: l.id, label: l.name }))} /></Field>
        <Field label="Requested date"><Input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
        <Field label="Order discount %"><Input type="number" value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} /></Field>
      </div>
      <div className="mt-4"><LineEditor items={items.filter((i) => i.sellable && Number(i.price) > 0)} lines={lines} setLines={setLines} withDiscount
        stockFor={(id) => Number(inv.find((r) => r.item_id === id && r.location_id === loc)?.qty || 0)} /></div>
      <Field label="Notes" className="mt-3"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <p className="mt-2 text-xs text-stone-500">Placing an order reserves demand (MRP & available-to-promise see it). Inventory and revenue post when the order is fulfilled. If stock is short, the line shows as backordered with an estimated available date.</p>
    </Modal>
  )
}
