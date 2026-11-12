import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Users, Plus, Pencil } from 'lucide-react'
import { supabase, sel } from '../lib/supabase'
import { useCustomers, useAction } from '../lib/hooks'
import { money, fmtDate } from '../lib/format'
import { Button, Card, PageHeader, Table, Modal, Field, Input, Select, Badge, StatusBadge } from '../components/ui.jsx'

export default function Customers() {
  const customers = useCustomers().data || []
  const stats = useQuery({ queryKey: ['cust_stats'], queryFn: async () => {
    const rows = await sel(supabase.from('sales_orders').select('customer_id, total, status, order_date').not('customer_id', 'is', null).neq('status', 'Cancelled'))
    const m = {}; rows.forEach((r) => { const x = m[r.customer_id] || { orders: 0, spend: 0, last: null, open: 0 }; x.orders++; x.spend += Number(r.total); if (r.status === 'Placed') x.open++; if (!x.last || r.order_date > x.last) x.last = r.order_date; m[r.customer_id] = x })
    return m
  } }).data || {}
  const [edit, setEdit] = useState(null)
  const [view, setView] = useState(null)
  return (
    <>
      <PageHeader icon={Users} title="Customers" subtitle="Retail and wholesale accounts. Customers who sign up in the portal appear here automatically." actions={<Button onClick={() => setEdit({})}><Plus className="h-4 w-4" />New customer</Button>} />
      <Card padded={false}>
        <Table rows={customers} onRowClick={setView} columns={[
          { label: 'Name', render: (c) => <span className="font-medium">{c.name}</span> }, { label: 'Type', render: (c) => <Badge color={c.customer_type === 'Wholesale' ? 'violet' : 'gray'}>{c.customer_type}</Badge> },
          { label: 'Email', key: 'email' }, { label: 'Phone', key: 'phone' },
          { label: 'Orders', num: true, render: (c) => stats[c.id]?.orders || 0 }, { label: 'Open', num: true, render: (c) => stats[c.id]?.open || '' },
          { label: 'Lifetime spend', num: true, render: (c) => money(stats[c.id]?.spend || 0) }, { label: 'Last order', render: (c) => fmtDate(stats[c.id]?.last) },
          { label: '', render: (c) => <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEdit(c) }}><Pencil className="h-3.5 w-3.5" /></Button> },
        ]} />
      </Card>
      <CustomerModal c={edit} onClose={() => setEdit(null)} />
      <CustomerOrders c={view} onClose={() => setView(null)} />
    </>
  )
}

function CustomerOrders({ c, onClose }) {
  const nav = useNavigate()
  const { data = [] } = useQuery({ enabled: !!c, queryKey: ['cust_orders', c?.id], queryFn: () => sel(supabase.from('sales_orders').select('*').eq('customer_id', c.id).order('order_date', { ascending: false })) })
  if (!c) return null
  return (
    <Modal open onClose={onClose} title={c.name} wide>
      <p className="mb-3 text-sm text-stone-600">{c.email} · {c.phone} · {c.address}</p>
      <Table rows={data} onRowClick={(o) => nav(`/sales/${o.id}`)} dense columns={[{ label: 'Order', key: 'number' }, { label: 'Date', render: (o) => fmtDate(o.order_date) }, { label: 'Channel', key: 'source' }, { label: 'Status', render: (o) => <StatusBadge status={o.status} /> }, { label: 'Total', num: true, render: (o) => money(o.total) }]} />
    </Modal>
  )
}

function CustomerModal({ c, onClose }) {
  const [f, setF] = useState({})
  useEffect(() => { if (c) setF({ customer_type: 'Retail', ...c }) }, [c])
  const save = useAction(async () => {
    const row = { name: f.name, email: f.email || null, phone: f.phone, address: f.address, customer_type: f.customer_type }
    const { error } = c.id ? await supabase.from('customers').update(row).eq('id', c.id) : await supabase.from('customers').insert(row)
    if (error) throw new Error(error.message)
  }, { success: 'Customer saved', onSuccess: onClose })
  if (!c) return null
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <Modal open onClose={onClose} title={c.id ? `Edit ${c.name}` : 'New customer'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="Name"><Input value={f.name || ''} onChange={set('name')} /></Field>
        <Field label="Type"><Select value={f.customer_type} onChange={set('customer_type')} options={[{ value: 'Retail', label: 'Retail' }, { value: 'Wholesale', label: 'Wholesale' }]} /></Field>
        <Field label="Email" hint="A portal sign-up with this email links to this customer"><Input value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Phone"><Input value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Address"><Input value={f.address || ''} onChange={set('address')} /></Field>
      </div>
    </Modal>
  )
}
