import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Network, Zap, ChevronDown, ChevronRight } from 'lucide-react'
import { rpc } from '../lib/supabase'
import { useRpcQuery, useAction } from '../lib/hooks'
import { qty, fmtShort, fmtDate, money } from '../lib/format'
import { Button, Card, PageHeader, Table, Badge, Select, Spinner, Explain, cx } from '../components/ui.jsx'

export default function MRP() {
  const nav = useNavigate()
  const [weeks, setWeeks] = useState(4)
  const [onlyActions, setOnlyActions] = useState(false)
  const { data, isLoading, refetch, isFetching } = useRpcQuery('mrp_plan', { p_weeks: weeks })
  const [picked, setPicked] = useState({})
  const [open, setOpen] = useState({})
  useEffect(() => { if (data) setPicked(Object.fromEntries(data.orders.map((o, i) => [i, true]))) }, [data])
  const execute = useAction(() => rpc('create_suggested_orders', {
    p_lines: data.orders.filter((_, i) => picked[i]).map((o) => ({ item_id: o.item_id, qty: Number(o.qty), need_date: o.need_date })), p_source: 'MRP',
  }), { success: (r) => `Created ${r.purchase_orders.length} PO(s) ${r.purchase_orders.join(', ')} and ${r.production_orders.length} production order(s) ${r.production_orders.join(', ')}` })

  if (isLoading || !data) return <Spinner label="Running MRP…" />
  const items = data.items.filter((it) => !onlyActions || it.planned_receipt.some((x) => x > 0))
  const rowsDef = [
    ['Gross requirements', 'gross'], ['Scheduled receipts', 'scheduled'], ['Projected on hand', 'projected'],
    ['Net requirements', 'net'], ['Planned order receipt', 'planned_receipt'], ['Planned order release', 'planned_release'],
  ]
  return (
    <>
      <PageHeader icon={Network} title="Material Requirements Planning"
        subtitle="Confirmed sales orders × bills of material − on hand − open POs / production = what to buy or build, and when to order it"
        actions={<>
          <Select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} className="w-32" options={[4, 6, 8].map((w) => ({ value: w, label: `${w} weeks` }))} />
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={onlyActions} onChange={(e) => setOnlyActions(e.target.checked)} />Only items needing action</label>
          <Button variant="secondary" loading={isFetching} onClick={() => refetch()}>Re-run MRP</Button>
        </>} />

      <Card title={`Planned orders (${data.orders.length})`} subtitle="Order-by date = need date − lead time. Red = order-by date already passed → expedite." className="mb-5"
        actions={<Button disabled={!data.orders.some((_, i) => picked[i])} loading={execute.isPending} onClick={() => execute.mutate()}><Zap className="h-4 w-4" />Create selected POs & production orders</Button>} padded={false}>
        <Table rows={data.orders.map((o, i) => ({ ...o, _i: i, _rowClass: o.past_due ? 'bg-red-50/60' : '' }))} rowKey="_i" empty="No shortages in the horizon — on-hand and open orders cover all confirmed demand." columns={[
          { label: '', render: (o) => <input type="checkbox" checked={!!picked[o._i]} onChange={(e) => setPicked({ ...picked, [o._i]: e.target.checked })} /> },
          { label: 'Action', render: (o) => <Badge color={o.action === 'Buy' ? 'blue' : 'brown'}>{o.action}</Badge> },
          { label: 'Item', render: (o) => <div><div className="font-medium">{o.name}</div><div className="text-xs text-stone-500">{o.sku}</div></div> },
          { label: 'Net req.', num: true, render: (o) => qty(o.net_requirement) },
          { label: 'Order qty', num: true, render: (o) => <b>{qty(o.qty)} {o.uom}</b> },
          { label: 'Needed by', render: (o) => fmtDate(o.need_date) },
          { label: 'Lead time', num: true, render: (o) => `${o.lead_time_days}d` },
          { label: 'Order by', render: (o) => <span className={cx('font-medium', o.past_due && 'text-red-600')}>{fmtDate(o.order_by)}{o.past_due && ' — EXPEDITE'}</span> },
          { label: 'Source', render: (o) => o.supplier_name || 'Orem Workshop' },
          { label: 'Est. cost', num: true, render: (o) => money(o.qty * o.unit_cost) },
        ]} />
      </Card>

      <Card title="Time-phased MRP records" subtitle={`Planning horizon from ${fmtDate(data.today)} · processed level by level (finished goods first, then their components)`} padded={false}>
        <div className="divide-y divide-stone-100">
          {items.map((it) => {
            const needs = it.planned_receipt.some((x) => x > 0)
            const isOpen = open[it.item_id] ?? needs
            return (
              <div key={it.item_id} className="px-4 py-3">
                <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen({ ...open, [it.item_id]: !isOpen })}>
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="font-medium">{it.name}</span><span className="text-xs text-stone-500">{it.sku}</span>
                  <Badge color={it.action === 'Buy' ? 'blue' : 'brown'}>{it.action}</Badge>
                  <Badge>Level {it.level}</Badge>
                  <span className="text-xs text-stone-500">LT {it.lead_time_days}d · on hand {qty(it.on_hand)} {it.uom}{it.supplier_name ? ` · ${it.supplier_name}` : ''}</span>
                  {needs ? <Badge color="red" className="ml-auto">Shortage → planned order</Badge> : <Badge color="green" className="ml-auto">Covered</Badge>}
                </button>
                {isOpen && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead><tr className="bg-stone-50"><th className="th w-52"></th><th className="th text-right">Past due</th>
                        {data.weeks.map((w) => <th key={w.week} className="th text-right">Wk {w.week}<div className="font-normal normal-case text-stone-400">{fmtShort(w.start)}–{fmtShort(w.end)}</div></th>)}</tr></thead>
                      <tbody className="divide-y divide-stone-100">
                        {rowsDef.map(([label, key]) => (
                          <tr key={key} className={key === 'planned_release' ? 'bg-brand-50/50 font-medium' : key === 'net' ? 'text-red-700' : ''}>
                            <td className="td">{label}</td>
                            <td className="td num">{key === 'planned_release' && it.release_past_due > 0 ? <span className="font-semibold text-red-600">{qty(it.release_past_due)}</span> : key === 'projected' ? qty(it.on_hand) : ''}</td>
                            {it[key].map((v, i) => <td key={i} className="td num">{Number(v) ? qty(v) : <span className="text-stone-300">0</span>}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-2 grid gap-2 text-xs text-stone-600 md:grid-cols-3">
                      <div><b>Demand from:</b> {it.demand.map((d) => `${d.source} (${qty(d.qty)} on ${fmtShort(d.date)})`).join(', ') || '—'}</div>
                      <div><b>Scheduled receipts:</b> {it.receipts.map((d) => `${d.source} (${qty(d.qty)} on ${fmtShort(d.date)})`).join(', ') || '—'}</div>
                      <div><b>Used in:</b> {it.parents.map((p) => `${p.sku} × ${p.qty_per}`).join(', ') || 'sold directly'}</div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>
      <div className="mt-5">
        <Explain title="How MRP works here">
          <p>1. <b>Gross requirements</b> for finished goods come from confirmed (status <i>Placed</i>) sales orders, bucketed by requested date into weeks. Planned production orders that haven’t started also require their components.</p>
          <p>2. <b>Netting:</b> projected on hand = previous balance + scheduled receipts (open POs at their expected date, open production orders) − gross requirements. A negative balance is a <b>net requirement</b>.</p>
          <p>3. <b>Lot sizing:</b> lot-for-lot (order exactly the shortage, respecting the item’s minimum order quantity) → <b>planned order receipt</b> in that week.</p>
          <p>4. <b>Lead-time offset:</b> the order must be released (PO sent / build started) <i>lead time</i> days before the need date → <b>planned order release</b> and order-by date. If that date is already past, the line is flagged to expedite.</p>
          <p>5. <b>BOM explosion:</b> a planned build’s release becomes gross requirements for each component (quantity × qty-per on the BOM). Items are processed by low-level code, so a gift set’s demand flows to maple boards and board butter, and then to lumber, oil, wax, tins and labels.</p>
        </Explain>
      </div>
      <div className="mt-3 text-right"><Button variant="link" onClick={() => nav('/purchasing')}>Go to purchase orders →</Button></div>
    </>
  )
}
