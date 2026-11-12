import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Truck, Plus } from 'lucide-react'
import { supabase, sel, rpc } from '../lib/supabase'
import { useItems, useLocations, useSuppliers, useAction } from '../lib/hooks'
import { money, fmtDate, isoDate, addDays, daysBetween } from '../lib/format'
import { Button, Card, PageHeader, Table, StatusBadge, Modal, Field, Select, Textarea, Tabs, Badge, Stat } from '../components/ui.jsx'
import LineEditor from '../components/LineEditor.jsx'

export default function Purchasing() {
  const nav = useNavigate()
  const [tab, setTab] = useState('open')
  const [show, setShow] = useState(false)
  const { data = [] } = useQuery({
    queryKey: ['pos', tab],
    queryFn: async () => {
      let q = supabase.from('purchase_orders').select('*, supplier:suppliers(name, payment_terms_days), location:locations(code), lines:po_lines(qty_ordered, qty_received, unit_cost)').order('created_at', { ascending: false }).limit(300)
      if (tab === 'open') q = q.in('status', ['Draft', 'Sent', 'Partially Received'])
      if (tab === 'received') q = q.eq('status', 'Received')
      return sel(q)
    },
  })
  const pay = useQuery({ queryKey: ['payables'], queryFn: () => sel(supabase.from('v_payables').select('*').gt('balance', 0.005).order('due_date')) }).data || []
  const today = isoDate()
  const late = data.filter((p) => ['Sent', 'Partially Received'].includes(p.status) && p.expected_date < today)
  return (
    <>
      <PageHeader icon={Truck} title="Purchase Orders" subtitle="Order Sent → Received (inventory up, A/P recorded) → Closed (paid or short-closed). Expected date = order date + supplier’s quoted lead time."
        actions={<Button onClick={() => setShow(true)}><Plus className="h-4 w-4" />New purchase order</Button>} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open POs" value={data.filter((p) => ['Sent', 'Partially Received'].includes(p.status)).length} />
        <Stat label="Late (past expected)" value={late.length} tone={late.length ? 'bad' : 'good'} />
        <Stat label="Accounts payable" value={money(pay.reduce((s, p) => s + Number(p.balance), 0))} sub={`${pay.length} invoices`} />
        <Stat label="Overdue payables" value={money(pay.filter((p) => p.pay_status === 'Overdue').reduce((s, p) => s + Number(p.balance), 0))} tone="bad" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'open', label: 'Open' }, { value: 'received', label: 'Received (awaiting payment)' }, { value: 'all', label: 'All' }, { value: 'payables', label: 'Payables' }]} />
      {tab === 'payables' ? (
        <Card padded={false}><Table rows={pay} rowKey="po_id" onRowClick={(r) => nav(`/purchasing/${r.po_id}`)} columns={[
          { label: 'PO', key: 'number' }, { label: 'Supplier', key: 'supplier_name' },
          { label: 'Terms', render: (r) => `Net ${r.payment_terms_days}` }, { label: 'Invoice (receipt) date', render: (r) => fmtDate(r.invoice_date) },
          { label: 'Due date', render: (r) => fmtDate(r.due_date) }, { label: 'Status', render: (r) => <StatusBadge status={r.pay_status} /> },
          { label: 'Amount', num: true, render: (r) => money(r.amount) }, { label: 'Paid', num: true, render: (r) => money(r.paid) },
          { label: 'Balance', num: true, render: (r) => <b>{money(r.balance)}</b> },
        ]} /></Card>
      ) : (
        <Card padded={false}>
          <Table rows={data} onRowClick={(r) => nav(`/purchasing/${r.id}`)} columns={[
            { label: 'PO', render: (p) => <span className="font-medium">{p.number}</span> },
            { label: 'Supplier', render: (p) => p.supplier.name },
            { label: 'Ship to', render: (p) => p.location.code },
            { label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
            { label: 'Ordered', render: (p) => fmtDate(p.order_date) },
            { label: 'Expected', render: (p) => fmtDate(p.expected_date) },
            { label: 'Received', render: (p) => {
              if (!p.first_receipt_date) return ['Sent', 'Partially Received'].includes(p.status) && p.expected_date < today ? <Badge color="red">{daysBetween(p.expected_date, today)}d late</Badge> : '—'
              const d = daysBetween(p.expected_date, p.first_receipt_date)
              return <span>{fmtDate(p.first_receipt_date)} {d > 0 ? <Badge color="red">+{d}d</Badge> : <Badge color="green">on time</Badge>}</span>
            } },
            { label: 'Fill', num: true, render: (p) => { const o = p.lines.reduce((s, l) => s + Number(l.qty_ordered), 0); const r = p.lines.reduce((s, l) => s + Number(l.qty_received), 0); return `${Math.round((r / o) * 100)}%` } },
            { label: 'Total', num: true, render: (p) => money(p.lines.reduce((s, l) => s + l.qty_ordered * l.unit_cost, 0)) },
            { label: 'Source', render: (p) => <span className="text-xs text-stone-500">{p.source}</span> },
          ]} />
        </Card>
      )}
      <NewPO open={show} onClose={() => setShow(false)} onCreated={(id) => nav(`/purchasing/${id}`)} />
    </>
  )
}

export function NewPO({ open, onClose, onCreated, initial }) {
  const items = useItems().data || []
  const locs = useLocations().data || []
  const suppliers = useSuppliers().data || []
  const [f, setF] = useState({ supplier: '', location: '', notes: '' })
  const [lines, setLines] = useState(initial || [])
  const sup = suppliers.find((s) => s.id === Number(f.supplier))
  const wks = locs.find((l) => l.kind === 'production')
  const save = useAction((send) => rpc('create_purchase_order', {
    p_supplier: Number(f.supplier), p_location: Number(f.location || wks?.id), p_send: send, p_notes: f.notes || null,
    p_lines: lines.map((l) => ({ item_id: l.item_id, qty: Number(l.qty), unit_cost: Number(l.unit_cost) })),
  }), { success: (id, send) => (send ? 'PO created and sent to supplier' : 'Draft PO saved'), onSuccess: (id) => { onClose(); setLines([]); onCreated?.(id) } })
  return (
    <Modal open={open} onClose={onClose} title="New purchase order" size="xl"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="secondary" disabled={!f.supplier || !lines.length} onClick={() => save.mutate(false)}>Save draft</Button><Button disabled={!f.supplier || !lines.length} loading={save.isPending} onClick={() => save.mutate(true)}>Create & send</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Supplier"><Select placeholder="Choose…" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} options={suppliers.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name }))} /></Field>
        <Field label="Receive into"><Select value={f.location || wks?.id || ''} onChange={(e) => setF({ ...f, location: e.target.value })} options={locs.filter((l) => l.kind !== 'quarantine').map((l) => ({ value: l.id, label: l.name }))} /></Field>
        <div className="rounded-lg bg-stone-50 p-2 text-xs text-stone-600">{sup ? <>Quoted lead time <b>{sup.lead_time_days} days</b> → expected <b>{fmtDate(addDays(isoDate(), sup.lead_time_days))}</b> if sent today. Terms Net {sup.payment_terms_days}.</> : 'Pick a supplier to see lead time & terms.'}</div>
      </div>
      <div className="mt-4"><LineEditor items={items.filter((i) => !sup || i.supplier_id === sup.id || i.item_type !== 'finished')} lines={lines} setLines={setLines} priceField="unit_cost" /></div>
      <Field label="Notes" className="mt-3"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </Modal>
  )
}
