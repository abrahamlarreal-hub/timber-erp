import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { Factory, Plus, Play, CheckCircle2, XCircle } from 'lucide-react'
import { supabase, sel, rpc } from '../lib/supabase'
import { useItems, useLocations, useInventory, useReasons, useAction, useRpcQuery, usePolicy } from '../lib/hooks'
import { forecastItem, MODELS } from '../lib/forecast'
import { productImage } from '../lib/productArt'
import { money, qty, fmtDate, fmtDateTime, fmtShort, pct, isoDate, addDays, num } from '../lib/format'
import { Button, Card, PageHeader, Table, Modal, Field, Select, Input, Badge, StatusBadge, Tabs, Stat, DateRange, Explain, Textarea, Spinner } from '../components/ui.jsx'

export default function Production() {
  const [tab, setTab] = useState('orders')
  const [create, setCreate] = useState(false)
  const [complete, setComplete] = useState(null)
  const [start, setStart] = useState(null)
  const { data: orders = [] } = useQuery({
    queryKey: ['production_orders'],
    queryFn: () => sel(supabase.from('production_orders').select('*, item:items(name, sku, uom), location:locations(code)').order('created_at', { ascending: false }).limit(200)),
  })
  const cancel = useAction((id) => rpc('cancel_production_order', { p_id: id }), { success: 'Production order cancelled (components returned if issued)' })
  const open = orders.filter((o) => ['Planned', 'In Progress'].includes(o.status))
  return (
    <>
      <PageHeader icon={Factory} title="Production Orders" subtitle="Build finished goods and kits. Starting an order issues components per the BOM; completing it receives good units at rolled-up cost."
        actions={<Button onClick={() => setCreate(true)}><Plus className="h-4 w-4" />New production order</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'orders', label: `Open orders (${open.length})` }, { value: 'history', label: 'All orders' }, { value: 'forecast', label: 'Forecast & build plan' }, { value: 'report', label: 'Production & quality report' }]} />
      {tab === 'forecast' ? <ProductionForecast /> : tab === 'report' ? <ProductionReport /> : (
        <Card padded={false}>
          <Table rows={tab === 'orders' ? open : orders} columns={[
            { label: 'Order', render: (o) => <span className="font-medium">{o.number}</span> },
            { label: 'Item', render: (o) => <div><div>{o.item.name}</div><div className="text-xs text-stone-500">{o.item.sku}</div></div> },
            { label: 'Loc', render: (o) => o.location.code },
            { label: 'Status', render: (o) => <StatusBadge status={o.status} /> },
            { label: 'Planned', num: true, render: (o) => qty(o.qty_planned) },
            { label: 'Started', num: true, render: (o) => (Number(o.qty_started) ? qty(o.qty_started) : '') },
            { label: 'Good', num: true, render: (o) => (o.status === 'Completed' ? qty(o.qty_good) : '') },
            { label: 'Scrap / rework', num: true, render: (o) => (o.status === 'Completed' ? <span>{qty(o.qty_scrapped)} / {qty(o.qty_reworked)}{o.quality_reason && <Badge className="ml-1" color="amber">{o.quality_reason}</Badge>}</span> : '') },
            { label: 'Due', render: (o) => fmtDate(o.due_date) },
            { label: 'Started at', render: (o) => fmtDateTime(o.started_at) },
            { label: 'Finished at', render: (o) => fmtDateTime(o.finished_at) },
            { label: 'Unit cost', num: true, render: (o) => (o.unit_cost ? money(o.unit_cost) : '') },
            { label: '', render: (o) => (
              <div className="flex gap-1">
                {o.status === 'Planned' && <Button size="sm" variant="success" onClick={() => setStart(o)}><Play className="h-3.5 w-3.5" />Start</Button>}
                {o.status === 'In Progress' && <Button size="sm" variant="success" onClick={() => setComplete(o)}><CheckCircle2 className="h-3.5 w-3.5" />Complete</Button>}
                {['Planned', 'In Progress'].includes(o.status) && <Button size="sm" variant="ghost" onClick={() => confirm(`Cancel ${o.number}?`) && cancel.mutate(o.id)}><XCircle className="h-3.5 w-3.5" /></Button>}
              </div>) },
          ]} />
        </Card>
      )}
      <CreateMO open={create} onClose={() => setCreate(false)} />
      <StartMO order={start} onClose={() => setStart(null)} />
      <CompleteMO order={complete} onClose={() => setComplete(null)} />
    </>
  )
}

function useBom(itemId) {
  return useQuery({ enabled: !!itemId, queryKey: ['bom', Number(itemId)], queryFn: () => sel(supabase.from('bom_lines').select('*, component:items!bom_lines_component_item_id_fkey(*)').eq('parent_item_id', itemId)) })
}

function ComponentCheck({ itemId, qtyNeeded, locationId }) {
  const { data: bom = [] } = useBom(itemId)
  const inv = useInventory().data || []
  const rows = bom.map((b) => {
    const need = Number(b.qty_per) * Number(qtyNeeded || 0)
    const have = Number(inv.find((r) => r.item_id === b.component_item_id && r.location_id === Number(locationId))?.qty || 0)
    return { ...b, need, have, cost: need * Number(b.component.avg_cost) }
  })
  const total = rows.reduce((s, r) => s + r.cost, 0)
  return (
    <div className="mt-3">
      <div className="label">Components to issue (BOM × quantity)</div>
      <Table rows={rows} dense columns={[
        { label: 'Component', render: (r) => r.component.name },
        { label: 'Per unit', num: true, render: (r) => `${num(r.qty_per, 3)} ${r.component.uom}` },
        { label: 'Required', num: true, render: (r) => qty(r.need) },
        { label: 'On hand here', num: true, render: (r) => <span className={r.have < r.need ? 'font-semibold text-red-600' : ''}>{qty(r.have)}</span> },
        { label: 'Cost', num: true, render: (r) => money(r.cost) },
      ]} footer={<tr><td className="td" colSpan={4}>Estimated rolled-up cost {qtyNeeded ? `(${money(total / qtyNeeded)} / unit)` : ''}</td><td className="td num">{money(total)}</td></tr>} />
      {rows.some((r) => r.have < r.need) && <p className="mt-2 text-xs text-red-600">Some components are short at this location — transfer stock or wait for the PO before starting.</p>}
    </div>
  )
}

function CreateMO({ open, onClose }) {
  const items = useItems().data || []
  const locs = useLocations().data || []
  const boms = useQuery({ queryKey: ['bom_all'], queryFn: () => sel(supabase.from('bom_lines').select('parent_item_id')) }).data || []
  const parents = items.filter((i) => boms.some((b) => b.parent_item_id === i.id))
  const wks = locs.find((l) => l.kind === 'production')
  const [f, setF] = useState({ item: '', qty: 10, loc: '', due: addDays(isoDate(), 3), notes: '' })
  const save = useAction(() => rpc('create_production_order', { p_item: Number(f.item), p_qty: Number(f.qty), p_location: Number(f.loc || wks?.id), p_due: f.due, p_notes: f.notes || null }), { success: 'Production order created', onSuccess: onClose })
  return (
    <Modal open={open} onClose={onClose} title="New production order" wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!f.item} loading={save.isPending} onClick={() => save.mutate()}>Create (Planned)</Button></>}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Item to build" className="sm:col-span-2"><Select placeholder="Choose…" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} options={parents.map((i) => ({ value: i.id, label: `${i.sku} — ${i.name}` }))} /></Field>
        <Field label="Quantity"><Input type="number" min="1" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
        <Field label="Due date"><Input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
        <Field label="Location" className="sm:col-span-2"><Select value={f.loc || wks?.id || ''} onChange={(e) => setF({ ...f, loc: e.target.value })} options={locs.filter((l) => l.kind !== 'quarantine').map((l) => ({ value: l.id, label: l.name }))} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Input value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {f.item && <ComponentCheck itemId={Number(f.item)} qtyNeeded={f.qty} locationId={f.loc || wks?.id} />}
    </Modal>
  )
}

function StartMO({ order, onClose }) {
  const [q, setQ] = useState('')
  useEffect(() => { if (order) setQ(order.qty_planned) }, [order])
  const go = useAction(() => rpc('start_production_order', { p_id: order.id, p_qty_started: Number(q) }), { success: 'Started — components issued from inventory to work-in-process', onSuccess: onClose })
  if (!order) return null
  return (
    <Modal open onClose={onClose} title={`Start ${order.number}: ${order.item.name}`} wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="success" loading={go.isPending} onClick={() => go.mutate()}><Play className="h-4 w-4" />Issue components & start</Button></>}>
      <Field label="Quantity started" hint="Start time is recorded now."><Input type="number" value={q} onChange={(e) => setQ(e.target.value)} className="w-40" /></Field>
      <ComponentCheck itemId={order.item_id} qtyNeeded={q} locationId={order.location_id} />
    </Modal>
  )
}

function CompleteMO({ order, onClose }) {
  const reasons = (useReasons().data || []).filter((r) => r.category === 'quality')
  const [f, setF] = useState({})
  useEffect(() => { if (order) setF({ good: order.qty_started, scrap: 0, rework: 0, reason: '', notes: '' }) }, [order])
  const go = useAction(() => rpc('complete_production_order', { p_id: order.id, p_good: Number(f.good), p_scrapped: Number(f.scrap), p_reworked: Number(f.rework), p_reason: f.reason || null, p_notes: f.notes || null }),
    { success: 'Completed — good units received into inventory at rolled-up cost', onSuccess: onClose })
  if (!order) return null
  const sum = Number(f.good || 0) + Number(f.scrap || 0)
  return (
    <Modal open onClose={onClose} title={`Complete ${order.number}: ${order.item.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="success" loading={go.isPending} onClick={() => go.mutate()}>Complete order</Button></>}>
      <p className="mb-3 text-sm text-stone-600">Started {qty(order.qty_started)} at {fmtDateTime(order.started_at)}. Component cost {money(order.component_cost)} → {money(order.unit_cost)} per unit started.</p>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Good units"><Input type="number" value={f.good ?? ""} onChange={(e) => setF({ ...f, good: e.target.value, scrap: Math.max(0, Number(order.qty_started) - Number(e.target.value)) })} /></Field>
        <Field label="Scrapped"><Input type="number" value={f.scrap ?? ""} onChange={(e) => setF({ ...f, scrap: e.target.value, good: Math.max(0, Number(order.qty_started) - Number(e.target.value)) })} /></Field>
        <Field label="Reworked (of good)"><Input type="number" value={f.rework ?? ""} onChange={(e) => setF({ ...f, rework: e.target.value })} /></Field>
      </div>
      {sum !== Number(order.qty_started) && <p className="mt-2 text-xs text-red-600">Good + scrapped must equal {qty(order.qty_started)} started.</p>}
      <Field label="Quality reason code (required if scrap or rework)" className="mt-3"><Select placeholder="—" value={f.reason ?? ""} onChange={(e) => setF({ ...f, reason: e.target.value })} options={reasons.map((r) => ({ value: r.code, label: `${r.code} — ${r.description}` }))} /></Field>
      <Field label="Notes" className="mt-3"><Textarea rows={2} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <p className="mt-3 text-xs text-stone-500">Good units go to inventory at {money(order.unit_cost)}/unit; the cost of scrapped units ({money(Number(f.scrap || 0) * order.unit_cost)}) is expensed to “Production Scrap” on the P&amp;L.</p>
    </Modal>
  )
}

function ProductionReport() {
  const [r, setR] = useState({ from: addDays(isoDate(), -89), to: isoDate() })
  const { data } = useRpcQuery('production_report', { p_from: r.from, p_to: r.to })
  const m = data?.metrics || {}
  return (
    <div className="space-y-5">
      <Card><DateRange from={r.from} to={r.to} onChange={(from, to) => setR({ from, to })} /></Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Orders completed" value={m.orders_completed ?? '—'} />
        <Stat label="Good units" value={num(m.units_good)} sub={`${num(m.throughput_per_day, 1)}/day`} />
        <Stat label="Yield" value={pct(m.yield_pct)} tone={m.yield_pct >= 97 ? 'good' : 'warn'} sub="good ÷ started" />
        <Stat label="First-pass yield" value={pct(m.first_pass_yield_pct)} sub="good w/o rework ÷ started" />
        <Stat label="Scrap rate" value={pct(m.scrap_rate_pct, 2)} tone={m.scrap_rate_pct > 3 ? 'bad' : undefined} sub={money(m.scrap_cost) + ' scrap cost'} />
        <Stat label="On-time completion" value={pct(m.on_time_pct)} sub="finished ≤ due date" />
        <Stat label="Avg cycle time" value={`${num(m.avg_cycle_hours, 1)} h`} sub="start → finish" />
        <Stat label="Avg unit cost" value={money(m.avg_unit_cost)} sub="rolled-up components" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Yield & cycle time by item">
          <div className="h-64"><ResponsiveContainer><BarChart data={data?.by_item || []}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="item" tick={{ fontSize: 10 }} interval={0} angle={-15} height={50} />
            <YAxis yAxisId="l" domain={[90, 100]} tick={{ fontSize: 11 }} /><YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
            <Tooltip /><Legend />
            <Bar yAxisId="l" dataKey="yield_pct" name="Yield %" fill="#2f7a55" /><Bar yAxisId="r" dataKey="avg_cycle_hours" name="Cycle hrs" fill="#c2a47a" />
          </BarChart></ResponsiveContainer></div>
        </Card>
        <Card title="Quality issues by reason code" padded={false}>
          <Table rows={data?.by_reason || []} columns={[
            { label: 'Code', render: (r) => <Badge color="amber">{r.reason}</Badge> }, { label: 'Description', key: 'description' },
            { label: 'Orders', num: true, key: 'orders' }, { label: 'Scrapped', num: true, render: (r) => qty(r.scrapped) },
            { label: 'Reworked', num: true, render: (r) => qty(r.reworked) }, { label: 'Scrap cost', num: true, render: (r) => money(r.scrap_cost) },
          ]} />
        </Card>
      </div>
      <Card title="Production orders in range" padded={false}>
        <Table rows={data?.orders || []} maxHeight={420} dense columns={[
          { label: 'Order', key: 'number' }, { label: 'Item', key: 'item' }, { label: 'Status', render: (o) => <StatusBadge status={o.status} /> },
          { label: 'Started', num: true, render: (o) => qty(o.qty_started) }, { label: 'Good', num: true, render: (o) => qty(o.qty_good) },
          { label: 'Scrap', num: true, render: (o) => qty(o.qty_scrapped) }, { label: 'Rework', num: true, render: (o) => qty(o.qty_reworked) },
          { label: 'Reason', key: 'reason' }, { label: 'Yield', num: true, render: (o) => pct(o.yield_pct) },
          { label: 'Start', render: (o) => fmtDateTime(o.started_at) }, { label: 'Finish', render: (o) => fmtDateTime(o.finished_at) },
          { label: 'Cycle h', num: true, render: (o) => num(o.cycle_hours, 1) },
          { label: 'On time', render: (o) => (o.on_time == null ? '' : o.on_time ? <Badge color="green">Yes</Badge> : <Badge color="red">Late</Badge>) },
          { label: 'Unit cost', num: true, render: (o) => money(o.unit_cost) },
        ]} />
      </Card>
      <Explain>
        <p><b>Yield</b> = good units ÷ units started. <b>First-pass yield</b> = (good − reworked) ÷ started — units that were right the first time. <b>Scrap rate</b> = scrapped ÷ started; scrap cost = scrapped × rolled-up unit cost.</p>
        <p><b>Cycle time</b> = finish time − start time. <b>On-time</b> = finished on or before the order’s due date. All metrics are computed from the production order history for completed orders in the date range.</p>
      </Explain>
    </div>
  )
}

// ---------------------------------------------------------------------
// Forecast & build plan: forecast demand for everything we make, compare
// with stock + work already in production, and suggest what to build.
// ---------------------------------------------------------------------
function ProductionForecast() {
  const items = useItems().data || []
  const policy = usePolicy().data || []
  const { data: hist } = useRpcQuery('weekly_usage', { p_weeks: 26 })
  const boms = useQuery({ queryKey: ['bom_all'], queryFn: () => sel(supabase.from('bom_lines').select('parent_item_id')) }).data || []
  const cap = useRpcQuery('production_report', { p_from: addDays(isoDate(), -56), p_to: addDays(isoDate(), -1) }).data
  const [horizon, setHorizon] = useState(4)
  const [buffer, setBuffer] = useState(1)
  const [picked, setPicked] = useState({})
  const made = items.filter((i) => boms.some((b) => b.parent_item_id === i.id))

  const rows = useMemo(() => {
    if (!hist?.items) return []
    return made.map((it) => {
      const h = hist.items.find((x) => x.item_id === it.id)
      const y = (h?.used || []).map(Number) // sales + use inside kits (e.g. boards in gift sets)
      const f = forecastItem(y, { method: 'auto', horizon, params: { n: 4, alpha: 0.3, beta: 0.1 } })
      const p = policy.find((x) => x.item_id === it.id) || {}
      const onHand = Number(p.on_hand || 0), inProd = Number(p.on_order || 0), orders = Number(p.allocated || 0)
      const demand = Math.max(f.total, orders)            // forecast, but never less than confirmed orders
      const safety = f.weekly * buffer                    // keep N weeks of cover after the horizon
      const need = demand + safety - (onHand + inProd)
      const batch = it.sku.startsWith('TTC-BB') ? 10 : 5
      const build = need > 0 ? Math.ceil(need / batch) * batch : 0
      return { ...it, f, onHand, inProd, orders, demand, safety, need, build,
        cover: f.weekly > 0 ? (onHand + inProd) / f.weekly : null }
    }).sort((a, b) => b.build - a.build || a.cover - b.cover)
  }, [hist, made.length, policy, horizon, buffer]) // eslint-disable-line react-hooks/exhaustive-deps

  const buildKey = rows.map((r) => `${r.id}:${r.build}`).join(',')
  useEffect(() => { setPicked(Object.fromEntries(rows.filter((r) => r.build > 0).map((r) => [r.id, true]))) }, [buildKey])
  const capacity = cap?.metrics?.units_good ? Number(cap.metrics.units_good) / 8 : null // good units per week, last 8 weeks
  const planned = rows.filter((r) => picked[r.id]).reduce((s, r) => s + r.build, 0)
  const util = capacity ? (planned / (capacity * horizon)) * 100 : null
  const create = useAction(() => rpc('create_suggested_orders', {
    p_lines: rows.filter((r) => picked[r.id] && r.build > 0).map((r) => ({ item_id: r.id, qty: r.build, need_date: addDays(isoDate(), Math.max(3, r.lead_time_days + 2)) })),
    p_source: 'Production forecast',
  }), { success: (r) => `Created ${r.production_orders.join(', ') || 'no orders'}` })
  const weeks = Array.from({ length: Math.min(horizon, 4) }, (_, i) => addDays(hist?.today || isoDate(), 7 * i))

  if (!hist) return <Spinner label="Forecasting demand…" />
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Plan horizon"><Select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="w-36" options={[2, 4, 6, 8].map((w) => ({ value: w, label: `${w} weeks` }))} /></Field>
          <Field label="Safety buffer"><Select value={buffer} onChange={(e) => setBuffer(Number(e.target.value))} className="w-40" options={[0, 1, 2].map((w) => ({ value: w, label: w ? `${w} week${w > 1 ? 's' : ''} of cover` : 'None' }))} /></Field>
          <div className="ml-auto"><Button disabled={!rows.some((r) => picked[r.id] && r.build > 0)} loading={create.isPending} onClick={() => create.mutate()}><Plus className="h-4 w-4" />Create production orders for selected</Button></div>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`Forecast demand (${horizon} wks)`} value={num(rows.reduce((s, r) => s + r.demand, 0))} sub="units of everything we make" />
        <Stat label="Suggested builds" value={num(planned)} sub={`${rows.filter((r) => picked[r.id] && r.build > 0).length} products`} />
        <Stat label="Typical output" value={capacity ? `${num(capacity, 0)}/wk` : '—'} sub="good units, last 8 weeks" />
        <Stat label="Workshop load" value={util == null ? '—' : `${num(util, 0)}%`} tone={util > 100 ? 'bad' : util > 85 ? 'warn' : 'good'} sub={util > 100 ? 'over typical capacity — start early or add shifts' : 'of typical capacity'} />
      </div>
      <Card padded={false} title="Build plan by product" subtitle="Suggested build = forecast demand (or confirmed orders, if higher) + safety buffer − on hand − already in production, rounded to a batch">
        <Table rows={rows} columns={[
          { label: '', render: (r) => r.build > 0 && <input type="checkbox" checked={!!picked[r.id]} onChange={(e) => setPicked({ ...picked, [r.id]: e.target.checked })} /> },
          { label: 'Product', render: (r) => <div className="flex items-center gap-2"><img src={productImage(r)} alt="" className="h-8 w-10 rounded object-cover" /><div><div className="max-w-[180px] truncate font-medium">{r.name}</div><div className="text-xs text-stone-500">{MODELS[r.f.method].short} · accuracy {r.f.accuracy == null ? '—' : num(r.f.accuracy, 0) + '%'}</div></div></div> },
          ...weeks.map((w, i) => ({ label: fmtShort(w), num: true, render: (r) => <span className="text-stone-500">{num(r.f.forecast[i], 0)}</span> })),
          { label: `Forecast ${horizon}w`, num: true, render: (r) => num(r.f.total, 0) },
          { label: 'Orders', num: true, render: (r) => (r.orders ? num(r.orders, 0) : '') },
          { label: 'On hand + WIP', num: true, render: (r) => <span>{num(r.onHand, 0)}{r.inProd ? <span className="text-stone-500"> + {num(r.inProd, 0)}</span> : ''}</span> },
          { label: 'Cover', num: true, render: (r) => (r.cover == null ? '—' : <span className={r.cover < horizon ? 'font-semibold text-red-600' : ''}>{num(r.cover, 1)}w</span>) },
          { label: 'Build', num: true, render: (r) => (r.build > 0 ? <b className="text-brand-800">{num(r.build)}</b> : <Badge color="green">Covered</Badge>) },
        ]} />
      </Card>
      <Explain title="How the build plan works">
        <p><b>Forecast:</b> weekly usage of each made item over 26 weeks (customer sales plus use inside kits — e.g. maple boards that go into gift sets) is forecast with the most accurate of moving average, exponential smoothing and trend, as on the Demand Forecast page.</p>
        <p><b>Netting:</b> demand for the horizon (or confirmed orders, whichever is larger) + a safety buffer of N weeks − on hand − units already planned or in progress = units to build, rounded up to a batch (5, or 10 for board butter).</p>
        <p><b>Capacity check:</b> compares the suggested builds with the workshop's typical good output per week over the last 8 weeks. This is make-to-stock planning from the forecast; MRP covers confirmed customer orders and the components they need.</p>
      </Explain>
    </div>
  )
}
