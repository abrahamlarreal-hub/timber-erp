import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Send, PackagePlus, DollarSign, XCircle, Printer } from 'lucide-react'
import { supabase, sel, rpc } from '../lib/supabase'
import { useLocations, useItems, useAction } from '../lib/hooks'
import { money, fmtDate, fmtDateTime, qty, daysBetween, isoDate } from '../lib/format'
import { Button, Card, PageHeader, Table, StatusBadge, Spinner, Input, Select, Field, Badge, Modal, useToast } from '../components/ui.jsx'
import { ScanInput } from '../components/Barcode.jsx'

export default function PurchaseOrderDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const items = useItems().data || []
  const locs = useLocations().data || []
  const { data: p } = useQuery({ queryKey: ['po', id], queryFn: () => sel(supabase.from('purchase_orders').select('*, supplier:suppliers(*), location:locations(*), lines:po_lines(*, item:items(sku,name,barcode,uom)), receipts:po_receipts(*, item:items(name), location:locations(code)), payments:supplier_payments(*)').eq('id', id).single()) })
  const payable = useQuery({ queryKey: ['payable', id], queryFn: () => sel(supabase.from('v_payables').select('*').eq('po_id', id).maybeSingle()) }).data
  const [recv, setRecv] = useState({})
  const [loc, setLoc] = useState('')
  const [payOpen, setPayOpen] = useState(false)
  const [amt, setAmt] = useState('')
  useEffect(() => { setRecv({}) }, [p?.lines?.map((l) => l.qty_received).join()])
  const send = useAction(() => rpc('send_purchase_order', { p_id: Number(id) }), { success: 'PO sent — expected date set from supplier lead time' })
  const receive = useAction(() => rpc('receive_purchase_order', { p_id: Number(id), p_location: Number(loc || p.location_id), p_lines: Object.entries(recv).filter(([, q]) => Number(q) > 0).map(([lid, q]) => ({ po_line_id: Number(lid), qty: Number(q) })) }),
    { success: 'Receipt posted — inventory increased, payable recorded' })
  const close = useAction(() => rpc('close_purchase_order', { p_id: Number(id) }), { success: 'PO closed' })
  const pay = useAction(() => rpc('pay_supplier', { p_po: Number(id), p_amount: Number(amt) }), { success: 'Payment recorded', onSuccess: () => setPayOpen(false) })
  if (!p) return <Spinner />
  p.lines.sort((a, b) => a.id - b.id)
  const canReceive = ['Sent', 'Partially Received'].includes(p.status)
  const total = p.lines.reduce((s, l) => s + l.qty_ordered * l.unit_cost, 0)
  const scan = (it) => {
    const l = p.lines.find((x) => x.item_id === it.id)
    if (!l) return toast.error(`${it.name} is not on this PO`)
    const open = Number(l.qty_ordered) - Number(l.qty_received)
    const cur = Number(recv[l.id] || 0)
    if (cur + 1 > open) return toast.error(`All ${qty(open)} open units of ${it.name} already counted`)
    setRecv({ ...recv, [l.id]: cur + 1 }); toast.success(`+1 ${it.name} (${cur + 1} of ${qty(open)})`)
  }
  const lateDays = p.first_receipt_date ? daysBetween(p.expected_date, p.first_receipt_date) : (p.expected_date && canReceive ? daysBetween(p.expected_date, isoDate()) : null)
  return (
    <>
      <button onClick={() => nav(-1)} className="mb-3 flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800 no-print"><ArrowLeft className="h-4 w-4" />Back</button>
      <PageHeader title={<span className="flex items-center gap-3">{p.number} <StatusBadge status={p.status} /></span>} subtitle={`${p.supplier.name} · ship to ${p.location.name} · created by ${p.created_by_name}`}
        actions={<>
          {p.status === 'Draft' && <Button loading={send.isPending} onClick={() => send.mutate()}><Send className="h-4 w-4" />Send to supplier</Button>}
          {payable && Number(payable.balance) > 0.005 && <Button variant="success" onClick={() => { setAmt(payable.balance); setPayOpen(true) }}><DollarSign className="h-4 w-4" />Pay supplier</Button>}
          {!['Closed', 'Cancelled'].includes(p.status) && <Button variant="secondary" onClick={() => confirm(p.first_receipt_date ? 'Close this PO (accept short shipment)?' : 'Cancel this PO?') && close.mutate()}><XCircle className="h-4 w-4" />{p.first_receipt_date ? 'Close' : 'Cancel PO'}</Button>}
          <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</Button>
        </>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[['Order date', fmtDate(p.order_date)], ['Quoted lead time', p.quoted_lead_days != null ? `${p.quoted_lead_days} days` : `${p.supplier.lead_time_days} days`],
          ['Expected receipt', fmtDate(p.expected_date)],
          ['Actual receipt', p.first_receipt_date ? <span>{fmtDate(p.first_receipt_date)} {lateDays > 0 ? <Badge color="red">{lateDays}d late</Badge> : <Badge color="green">on time</Badge>}</span> : lateDays > 0 ? <Badge color="red">{lateDays} days overdue</Badge> : '—'],
          ['Payment', payable ? <span>{money(payable.balance)} owed · due {fmtDate(payable.due_date)} <StatusBadge status={payable.pay_status} /></span> : `Net ${p.supplier.payment_terms_days} after receipt`]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-stone-200 bg-white p-3"><div className="text-xs uppercase tracking-wide text-stone-500">{k}</div><div className="mt-1 text-sm font-medium">{v}</div></div>))}
      </div>
      <Card title="Lines" padded={false} actions={canReceive && <div className="flex flex-wrap items-center gap-2 no-print">
        <Select className="w-48 py-1.5" value={loc || p.location_id} onChange={(e) => setLoc(e.target.value)} options={locs.filter((l) => l.kind !== 'quarantine').map((l) => ({ value: l.id, label: `Receive into ${l.code}` }))} />
        <ScanInput className="w-80" items={items} onItem={scan} continuous captureGlobal placeholder="Scan item labels to count…" />
        <Button size="sm" variant="secondary" onClick={() => setRecv(Object.fromEntries(p.lines.map((l) => [l.id, l.qty_ordered - l.qty_received])))}>Receive all</Button>
        <Button variant="success" loading={receive.isPending} disabled={!Object.values(recv).some((q) => Number(q) > 0)} onClick={() => receive.mutate()}><PackagePlus className="h-4 w-4" />Post receipt</Button>
      </div>}>
        <Table rows={p.lines} columns={[
          { label: 'Item', render: (l) => <div><div className="font-medium">{l.item.name}</div><div className="text-xs text-stone-500">{l.item.sku}</div></div> },
          { label: 'Ordered', num: true, render: (l) => `${qty(l.qty_ordered)} ${l.item.uom}` },
          { label: 'Received', num: true, render: (l) => qty(l.qty_received) },
          { label: 'Open', num: true, render: (l) => qty(l.qty_ordered - l.qty_received) },
          { label: 'Unit cost', num: true, render: (l) => money(l.unit_cost) },
          { label: 'Extended', num: true, render: (l) => money(l.qty_ordered * l.unit_cost) },
          ...(canReceive ? [{ label: 'Receive now', render: (l) => <Input type="number" min="0" max={l.qty_ordered - l.qty_received} className="w-24 py-1" value={recv[l.id] ?? ''} onChange={(e) => setRecv({ ...recv, [l.id]: e.target.value })} disabled={l.qty_ordered <= l.qty_received} /> }] : []),
        ]} footer={<tr><td className="td" colSpan={5}>PO total</td><td className="td num">{money(total)}</td>{canReceive && <td />}</tr>} />
      </Card>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Receipt history" padded={false}>
          <Table rows={p.receipts} dense columns={[{ label: 'Date', render: (r) => fmtDateTime(r.received_at) }, { label: 'Item', render: (r) => r.item.name }, { label: 'Qty', num: true, render: (r) => qty(r.qty) }, { label: 'Into', render: (r) => r.location.code }, { label: 'By', key: 'received_by_name' }]} empty="Nothing received yet" />
        </Card>
        <Card title="Payments" padded={false}>
          <Table rows={p.payments} dense columns={[{ label: 'Date', render: (r) => fmtDateTime(r.paid_at) }, { label: 'Method', key: 'method' }, { label: 'Amount', num: true, render: (r) => money(r.amount) }, { label: 'By', key: 'created_by_name' }]} empty="No payments yet" />
        </Card>
      </div>
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={`Pay ${p.supplier.name}`} footer={<><Button variant="secondary" onClick={() => setPayOpen(false)}>Cancel</Button><Button loading={pay.isPending} onClick={() => pay.mutate()}>Record payment</Button></>}>
        <Field label="Amount" hint={`Balance ${money(payable?.balance)} · due ${fmtDate(payable?.due_date)}`}><Input type="number" step="0.01" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
      </Modal>
    </>
  )
}
