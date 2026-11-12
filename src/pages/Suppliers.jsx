import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Building2, Plus, Pencil, Phone, Mail } from 'lucide-react'
import { supabase, sel } from '../lib/supabase'
import { useAction } from '../lib/hooks'
import { money, fmtDate, pct, num, daysBetween } from '../lib/format'
import { Button, Card, PageHeader, Table, Modal, Field, Input, Textarea, Badge, StatusBadge, Explain, cx } from '../components/ui.jsx'

const ratingColor = { Keep: 'border-emerald-300 bg-emerald-50', Watch: 'border-amber-300 bg-amber-50', Replace: 'border-red-300 bg-red-50', New: 'border-stone-200 bg-white' }

function Meter({ value, good = 90, warn = 75 }) {
  const v = Math.max(0, Math.min(100, Number(value || 0)))
  return (
    <div className="h-1.5 w-full rounded-full bg-stone-200">
      <div className={cx('h-1.5 rounded-full', v >= good ? 'bg-emerald-500' : v >= warn ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${v}%` }} />
    </div>
  )
}

export default function Suppliers() {
  const { data: cards = [] } = useQuery({ queryKey: ['scorecard'], queryFn: () => sel(supabase.from('v_supplier_scorecard').select('*').order('score', { ascending: false, nullsFirst: false })) })
  const [edit, setEdit] = useState(null)
  const [detail, setDetail] = useState(null)
  return (
    <>
      <PageHeader icon={Building2} title="Suppliers & Scorecard" subtitle="Every measure is computed from purchase order history — receipts vs. expected dates, quantities, and payments."
        actions={<Button onClick={() => setEdit({})}><Plus className="h-4 w-4" />Add supplier</Button>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <div key={c.supplier_id} className={cx('rounded-xl border-2 p-4 shadow-sm', ratingColor[c.rating])}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <button onClick={() => setDetail(c)} className="text-left font-semibold hover:underline">{c.name}</button>
                <div className="text-xs text-stone-600">{c.contact_name} · Net {c.payment_terms_days} · quoted {c.quoted_lead_days}d</div>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold tabular-nums leading-none">{c.score ?? '—'}</div>
                <div className="mt-1"><StatusBadge status={c.rating} /> <Badge>Grade {c.grade}</Badge></div>
              </div>
            </div>
            <div className="mt-4 space-y-2.5 text-sm">
              <div><div className="flex justify-between"><span>On-time delivery</span><b>{pct(c.on_time_pct)}</b></div><Meter value={c.on_time_pct} /></div>
              <div><div className="flex justify-between"><span>Fill rate (received ÷ ordered)</span><b>{pct(c.fill_pct)}</b></div><Meter value={c.fill_pct} good={98} warn={92} /></div>
              <div><div className="flex justify-between"><span>Avg actual vs quoted lead time</span><b className={Number(c.avg_actual_lead) > c.quoted_lead_days ? 'text-red-700' : 'text-emerald-700'}>{num(c.avg_actual_lead, 1)}d vs {c.quoted_lead_days}d</b></div>
                <Meter value={Math.min(100, (c.quoted_lead_days / Math.max(0.5, Number(c.avg_actual_lead || c.quoted_lead_days))) * 100)} /></div>
              <div className="grid grid-cols-3 gap-2 border-t border-black/5 pt-2 text-xs">
                <div><div className="text-stone-500">Owed</div><div className="font-semibold">{money(c.owed)}</div></div>
                <div><div className="text-stone-500">Overdue</div><div className={cx('font-semibold', Number(c.overdue) > 0 && 'text-red-700')}>{money(c.overdue)}</div></div>
                <div><div className="text-stone-500">Next due</div><div className="font-semibold">{fmtDate(c.next_due_date)}</div></div>
              </div>
              <div className="flex justify-between text-xs text-stone-500"><span>{c.pos_received} POs received · {c.pos_open} open{c.pos_late_open ? ` (${c.pos_late_open} late)` : ''}</span><span>Spend {money(c.total_spend)}</span></div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5"><Explain title="How the overall rating is computed">
        <p><b>Score (0–100)</b> = 40% × on-time delivery rate + 30% × fill rate + 30% × lead-time accuracy (quoted ÷ actual average lead time, capped at 100%).</p>
        <p><b>Keep</b> ≥ 90 · <b>Watch</b> 75–89 · <b>Replace</b> &lt; 75. On-time = first receipt on or before the expected date (order date + quoted lead time). Fill rate uses completed (received/closed) POs. Owed = value received − payments; due date = receipt date + payment terms.</p>
      </Explain></div>
      <SupplierModal s={edit} onClose={() => setEdit(null)} />
      <SupplierHistory s={detail} onClose={() => setDetail(null)} onEdit={(s) => { setDetail(null); setEdit(s) }} />
    </>
  )
}

function SupplierHistory({ s, onClose, onEdit }) {
  const { data = [] } = useQuery({ enabled: !!s, queryKey: ['sup_pos', s?.supplier_id], queryFn: () => sel(supabase.from('purchase_orders').select('*, lines:po_lines(qty_ordered, qty_received, unit_cost)').eq('supplier_id', s.supplier_id).neq('status', 'Draft').order('order_date', { ascending: false })) })
  const full = useQuery({ enabled: !!s, queryKey: ['supplier', s?.supplier_id], queryFn: () => sel(supabase.from('suppliers').select('*').eq('id', s.supplier_id).single()) }).data
  if (!s) return null
  return (
    <Modal open onClose={onClose} title={s.name} size="xl" footer={<Button variant="secondary" onClick={() => onEdit(full)}><Pencil className="h-4 w-4" />Edit supplier</Button>}>
      {full && <div className="mb-4 flex flex-wrap gap-4 text-sm text-stone-600"><span>{full.contact_name}</span><span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{full.email}</span><span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{full.phone}</span><span>{full.address}</span></div>}
      <Table rows={data} maxHeight={420} dense columns={[
        { label: 'PO', key: 'number' }, { label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
        { label: 'Ordered', render: (p) => fmtDate(p.order_date) }, { label: 'Expected', render: (p) => fmtDate(p.expected_date) },
        { label: 'Received', render: (p) => fmtDate(p.first_receipt_date) },
        { label: 'Actual lead', num: true, render: (p) => (p.first_receipt_date ? `${daysBetween(p.order_date, p.first_receipt_date)}d` : '') },
        { label: 'vs expected', render: (p) => { if (!p.first_receipt_date) return ''; const d = daysBetween(p.expected_date, p.first_receipt_date); return d > 0 ? <Badge color="red">+{d}d late</Badge> : <Badge color="green">on time</Badge> } },
        { label: 'Fill', num: true, render: (p) => pct(p.lines.reduce((a, l) => a + Number(l.qty_received), 0) / p.lines.reduce((a, l) => a + Number(l.qty_ordered), 0) * 100, 0) },
        { label: 'Value', num: true, render: (p) => money(p.lines.reduce((a, l) => a + l.qty_ordered * l.unit_cost, 0)) },
      ]} />
    </Modal>
  )
}

function SupplierModal({ s, onClose }) {
  const [f, setF] = useState({})
  useEffect(() => { if (s) setF({ lead_time_days: 7, payment_terms_days: 30, active: true, ...s }) }, [s])
  const save = useAction(async () => {
    const row = { name: f.name, contact_name: f.contact_name, email: f.email, phone: f.phone, address: f.address, notes: f.notes,
      lead_time_days: Number(f.lead_time_days), payment_terms_days: Number(f.payment_terms_days), active: !!f.active }
    const { error } = s.id ? await supabase.from('suppliers').update(row).eq('id', s.id) : await supabase.from('suppliers').insert(row)
    if (error) throw new Error(error.message)
  }, { success: 'Supplier saved', onSuccess: onClose })
  if (!s) return null
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  return (
    <Modal open onClose={onClose} title={s.id ? `Edit ${s.name}` : 'New supplier'} wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company name"><Input value={f.name || ''} onChange={set('name')} /></Field>
        <Field label="Contact person"><Input value={f.contact_name || ''} onChange={set('contact_name')} /></Field>
        <Field label="Email"><Input value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Phone"><Input value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={f.address || ''} onChange={set('address')} /></Field>
        <Field label="Quoted lead time (days)" hint="Drives PO expected dates, MRP order-by dates and reorder points"><Input type="number" value={f.lead_time_days} onChange={set('lead_time_days')} /></Field>
        <Field label="Payment terms (Net days)" hint="e.g. 30 = Net 30"><Input type="number" value={f.payment_terms_days} onChange={set('payment_terms_days')} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes || ''} onChange={set('notes')} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.active} onChange={set('active')} />Active</label>
      </div>
      <p className="mt-3 text-xs text-stone-500">Tip: changing the quoted lead time updates every purchased item’s reorder point and MRP order-by dates immediately; existing POs keep the lead time quoted when they were sent.</p>
    </Modal>
  )
}
