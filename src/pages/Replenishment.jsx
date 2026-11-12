import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine, ComposedChart, Bar } from 'recharts'
import { RefreshCcw, Zap, Save } from 'lucide-react'
import { supabase, rpc } from '../lib/supabase'
import { usePolicy, useSettings, useAction, useRpcQuery } from '../lib/hooks'
import { useAuth } from '../lib/auth.jsx'
import { money, qty, fmtDate, fmtShort, num } from '../lib/format'
import { Button, Card, PageHeader, Table, Badge, Tabs, Input, Field, Modal, Explain, Select, cx } from '../components/ui.jsx'

const SETTING_KEYS = ['ordering_cost', 'holding_cost_rate', 'service_level_z', 'review_period_days', 'history_days']

export default function Replenishment() {
  const { data: policy = [] } = usePolicy()
  const settings = useSettings().data
  const { isManager } = useAuth()
  const [mode, setMode] = useState('continuous')
  const [type, setType] = useState('all')
  const [picked, setPicked] = useState({})
  const [detail, setDetail] = useState(null)
  const [vals, setVals] = useState({})
  useEffect(() => { if (settings) setVals(Object.fromEntries(SETTING_KEYS.map((k) => [k, settings.map[k]]))) }, [settings])

  const rows = useMemo(() => policy.filter((p) => type === 'all' || (type === 'buy' ? !p.is_made : p.is_made))
    .map((p) => ({ ...p, orderQty: mode === 'continuous' ? Number(p.suggested_qty) : Number(p.periodic_order_qty) }))
    .sort((a, b) => (b.orderQty > 0) - (a.orderQty > 0) || String(a.order_by_date).localeCompare(String(b.order_by_date))), [policy, mode, type])
  useEffect(() => { setPicked(Object.fromEntries(rows.filter((r) => r.orderQty > 0).map((r) => [r.item_id, true]))) }, [mode, type, policy.length]) // eslint-disable-line

  const saveSettings = useAction(async () => {
    for (const k of SETTING_KEYS) {
      const { error } = await supabase.from('settings').update({ value: Number(vals[k]) }).eq('key', k)
      if (error) throw new Error(error.message)
    }
  }, { success: 'Settings saved — ROP, safety stock and EOQ recalculated for every item' })
  const create = useAction(() => rpc('create_suggested_orders', {
    p_lines: rows.filter((r) => picked[r.item_id] && r.orderQty > 0).map((r) => ({ item_id: r.item_id, qty: r.orderQty })),
    p_source: mode === 'continuous' ? 'Reorder point' : 'Periodic review',
  }), { success: (r) => `Created ${[...r.purchase_orders, ...r.production_orders].join(', ') || 'nothing'}` })

  const n = rows.filter((r) => r.orderQty > 0).length
  return (
    <>
      <PageHeader icon={RefreshCcw} title="Replenishment Planning" subtitle="Reorder points with lead-time demand + safety stock, periodic review, and EOQ — all from the last 180 days of actual usage" />
      <Card title="Inventory policy settings" subtitle={isManager ? 'Editable — every number below recalculates instantly when you save' : 'Only managers can edit'} className="mb-5"
        actions={isManager && <Button loading={saveSettings.isPending} onClick={() => saveSettings.mutate()}><Save className="h-4 w-4" />Save & recalculate</Button>}>
        <div className="grid gap-3 sm:grid-cols-5">
          {settings?.rows.filter((r) => SETTING_KEYS.includes(r.key)).map((r) => (
            <Field key={r.key} label={r.label} hint={r.description}><Input type="number" step="any" disabled={!isManager} value={vals[r.key] ?? ''} onChange={(e) => setVals({ ...vals, [r.key]: e.target.value })} /></Field>
          ))}
        </div>
      </Card>
      <Tabs value={mode} onChange={setMode} tabs={[{ value: 'continuous', label: 'Continuous review (ROP + EOQ)' }, { value: 'periodic', label: `Periodic review (every ${settings?.map.review_period_days ?? '…'} days, order-up-to)` }]} />
      <Card padded={false} title={mode === 'continuous' ? `${n} item(s) at or below reorder point` : `Periodic review — ${n} item(s) below order-up-to level`}
        subtitle={mode === 'continuous' ? 'Trigger: inventory position (on hand + on order − allocated) ≤ ROP. Order quantity: EOQ (or enough to get back above ROP).' : 'Every review period, order enough to bring the inventory position up to: avg daily usage × (review period + lead time) + safety stock.'}
        actions={<>
          <Select className="w-44 py-1.5" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: 'all', label: 'Buy & build items' }, { value: 'buy', label: 'Purchased items' }, { value: 'make', label: 'Made in-house' }]} />
          <Button disabled={!rows.some((r) => picked[r.item_id] && r.orderQty > 0)} loading={create.isPending} onClick={() => create.mutate()}><Zap className="h-4 w-4" />Create orders for selected</Button>
        </>}>
        <Table rows={rows} rowKey="item_id" maxHeight="65vh" onRowClick={setDetail} columns={[
          { label: '', render: (r) => r.orderQty > 0 && <input type="checkbox" checked={!!picked[r.item_id]} onClick={(e) => e.stopPropagation()} onChange={(e) => setPicked({ ...picked, [r.item_id]: e.target.checked })} /> },
          { label: 'Item', render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-stone-500">{r.sku} · {r.is_made ? 'Build' : r.supplier_name}</div></div> },
          { label: 'Avg daily use', num: true, render: (r) => num(r.avg_daily, 2) },
          { label: 'σ daily', num: true, render: (r) => num(r.sd_daily, 2) },
          { label: 'LT', num: true, render: (r) => `${r.lead_time_days}d` },
          { label: 'LT demand', num: true, render: (r) => num(r.lt_demand, 1) },
          { label: 'Safety stock', num: true, render: (r) => num(r.safety_stock, 1) },
          { label: 'ROP', num: true, render: (r) => <b>{r.reorder_point}{r.rop_overridden && '*'}</b> },
          { label: 'On hand', num: true, render: (r) => qty(r.on_hand) },
          { label: 'On order', num: true, render: (r) => qty(r.on_order) },
          { label: 'Allocated', num: true, render: (r) => qty(r.allocated) },
          { label: 'Position', num: true, render: (r) => <span className={cx(Number(r.position) <= r.reorder_point && 'font-semibold text-red-600')}>{qty(r.position)}</span> },
          mode === 'continuous' ? { label: 'EOQ', num: true, render: (r) => r.eoq } : { label: 'Order-up-to', num: true, render: (r) => r.order_up_to },
          { label: 'Suggested qty', num: true, render: (r) => (r.orderQty > 0 ? <b>{num(r.orderQty)} {r.uom}</b> : '') },
          { label: 'Order by', render: (r) => r.order_by_date && <span className={cx(r.orderQty > 0 && 'font-medium text-red-600')}>{fmtDate(r.order_by_date)}</span> },
          { label: 'Days supply', num: true, render: (r) => num(r.days_of_supply, 1) },
        ]} />
      </Card>
      <div className="mt-5"><Explain title="Formulas (all computed live from transaction history + settings)">
        <p><b>Average daily usage (d)</b> = units sold + units consumed by production − units returned over the last {settings?.map.history_days} days ÷ {settings?.map.history_days}. σ is the standard deviation of daily usage.</p>
        <p><b>Lead-time demand</b> = d × lead time. <b>Safety stock</b> = z × σ × √lead time (z = {settings?.map.service_level_z}). <b>Reorder point</b> = lead-time demand + safety stock.</p>
        <p><b>EOQ</b> = √(2 × D × S ÷ H), where D = annual demand (d × 365), S = ordering cost ({money(settings?.map.ordering_cost)}), H = holding cost rate ({num(settings?.map.holding_cost_rate * 100)}%) × unit cost.</p>
        <p><b>Order-by date</b> = today if position ≤ ROP, otherwise today + (position − ROP) ÷ d — the day the item is projected to hit its reorder point.</p>
      </Explain></div>
      <ItemPolicyModal row={detail} settings={settings?.map} onClose={() => setDetail(null)} />
    </>
  )
}

function ItemPolicyModal({ row, settings, onClose }) {
  const fc = useRpcQuery('demand_forecast', { p_item: row?.item_id }, { enabled: !!row })
  if (!row) return null
  const D = Number(row.annual_demand), S = Number(settings?.ordering_cost), H = Number(row.holding_cost_unit)
  const eoq = Number(row.eoq)
  const curve = eoq > 0 ? Array.from({ length: 40 }, (_, i) => {
    const Q = Math.max(1, Math.round((eoq * 2.5 * (i + 1)) / 40))
    return { Q, ordering: (D / Q) * S, holding: (Q / 2) * H, total: (D / Q) * S + (Q / 2) * H }
  }) : []
  const series = fc.data ? [...fc.data.history.map((h) => ({ week: h.week_start, actual: Number(h.qty) })), ...fc.data.forecast.map((f) => ({ week: f.week_start, forecast: Number(f.qty) }))] : []
  return (
    <Modal open onClose={onClose} title={`${row.name} — demand & order economics`} size="xl">
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <div className="label">Weekly usage (26 weeks) and 8-week forecast</div>
          <div className="h-64"><ResponsiveContainer><ComposedChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="week" tickFormatter={fmtShort} tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} />
            <Tooltip labelFormatter={fmtShort} /><Legend />
            <Bar dataKey="actual" name="Actual usage" fill="#c2a47a" />
            <Line dataKey="forecast" name="Forecast (Holt smoothing)" stroke="#2f7a55" strokeWidth={2} dot />
          </ComposedChart></ResponsiveContainer></div>
          <p className="mt-1 text-xs text-stone-500">Trend {num(fc.data?.trend_per_week, 2)} units/week. Forecast uses Holt’s double exponential smoothing (α 0.3, β 0.1) over the same transaction history.</p>
        </div>
        <div>
          <div className="label">EOQ cost curve — why {eoq} is the cheapest order size</div>
          <div className="h-64"><ResponsiveContainer><LineChart data={curve}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="Q" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => '$' + Math.round(v)} />
            <Tooltip formatter={(v) => money(v)} labelFormatter={(q) => `Order qty ${q}`} /><Legend />
            <Line dataKey="ordering" name="Annual ordering cost" stroke="#0ea5e9" dot={false} />
            <Line dataKey="holding" name="Annual holding cost" stroke="#f59e0b" dot={false} />
            <Line dataKey="total" name="Total cost" stroke="#5f422a" strokeWidth={2.5} dot={false} />
            <ReferenceLine x={curve.reduce((b, c) => (Math.abs(c.Q - eoq) < Math.abs(b.Q - eoq) ? c : b), curve[0] || {}).Q} stroke="#2f7a55" strokeDasharray="4 4" label={{ value: 'EOQ', fontSize: 11, fill: '#2f7a55' }} />
          </LineChart></ResponsiveContainer></div>
          <p className="mt-1 text-xs text-stone-500">D = {num(D)} /yr · S = {money(S)} · H = {money(H)} /unit/yr → EOQ = √(2·{num(D)}·{S}/{num(H, 3)}) = {eoq}. Annual cost at EOQ ≈ {money(row.eoq_annual_cost)}.</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[['Avg daily usage', num(row.avg_daily, 3)], ['Lead time', `${row.lead_time_days} days`], ['Safety stock', num(row.safety_stock, 1)], ['Reorder point', row.reorder_point],
          ['Inventory position', qty(row.position)], ['Order-up-to (periodic)', row.order_up_to], ['Days of supply', num(row.days_of_supply, 1)], ['Order by', fmtDate(row.order_by_date)]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-stone-50 p-2"><div className="text-xs text-stone-500">{k}</div><div className="font-semibold">{v}</div></div>))}
      </div>
    </Modal>
  )
}
