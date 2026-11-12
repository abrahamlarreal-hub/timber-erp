import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, LineChart, Line } from 'recharts'
import { BarChart3, Download } from 'lucide-react'
import { supabase, sel } from '../lib/supabase'
import { useRpcQuery, usePolicy, useLocations, useItems, useInventory } from '../lib/hooks'
import { money, money0, num, qty, fmtShort, fmtDate, isoDate, addDays, pct } from '../lib/format'
import { Card, PageHeader, Tabs, DateRange, Table, Select, Badge, StatusBadge, Button } from '../components/ui.jsx'

function csv(rows, name) {
  if (!rows?.length) return
  const keys = Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object')
  const body = [keys.join(','), ...rows.map((r) => keys.map((k) => JSON.stringify(r[k] ?? '')).join(','))].join('\n')
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' })); a.download = name + '.csv'; a.click()
}

export default function Reports() {
  const [tab, setTab] = useState('sales')
  return (
    <>
      <PageHeader icon={BarChart3} title="Management Reports" subtitle="Live reports for running the business — export any table to CSV" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'sales', label: 'Sales by period' }, { value: 'top', label: 'Top sellers' }, { value: 'low', label: 'Low stock & reorder' }, { value: 'loc', label: 'Inventory by location' }, { value: 'sup', label: 'Supplier performance' }]} />
      {tab === 'sales' && <SalesReport />}
      {tab === 'top' && <TopSellers />}
      {tab === 'low' && <LowStock />}
      {tab === 'loc' && <ByLocation />}
      {tab === 'sup' && <SupplierPerf />}
    </>
  )
}

function SalesReport() {
  const [r, setR] = useState({ from: addDays(isoDate(), -89), to: isoDate(), grain: 'week' })
  const { data } = useRpcQuery('sales_report', { p_from: r.from, p_to: r.to, p_grain: r.grain })
  const s = data?.series || []
  const tot = s.reduce((a, x) => ({ net: a.net + Number(x.net_sales), gp: a.gp + Number(x.gross_profit), o: a.o + Number(x.orders), u: a.u + Number(x.units) }), { net: 0, gp: 0, o: 0, u: 0 })
  return (
    <div className="space-y-5">
      <Card><div className="flex flex-wrap items-center gap-3"><DateRange from={r.from} to={r.to} onChange={(from, to) => setR({ ...r, from, to })} />
        <Select className="w-32 py-1.5" value={r.grain} onChange={(e) => setR({ ...r, grain: e.target.value })} options={[{ value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} /></div></Card>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Net sales', money0(tot.net)], ['Gross profit', money0(tot.gp)], ['Orders', num(tot.o)], ['Avg order', money(tot.o ? tot.net / tot.o : 0)]].map(([k, v]) => <div key={k} className="rounded-xl border bg-white p-4"><div className="text-xs uppercase text-stone-500">{k}</div><div className="text-2xl font-semibold">{v}</div></div>)}
      </div>
      <Card title={`Net sales & gross profit by ${r.grain}`}>
        <div className="h-72"><ResponsiveContainer><BarChart data={s}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="period" tickFormatter={fmtShort} tick={{ fontSize: 11 }} /><YAxis tickFormatter={(v) => '$' + Math.round(v / 100) / 10 + 'k'} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => money(v)} labelFormatter={fmtDate} /><Legend />
          <Bar dataKey="net_sales" name="Net sales" fill="#c2a47a" /><Bar dataKey="gross_profit" name="Gross profit" fill="#2f7a55" />
        </BarChart></ResponsiveContainer></div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="By channel" padded={false}><Table rows={data?.by_source || []} rowKey="source" columns={[{ label: 'Channel', key: 'source' }, { label: 'Orders', num: true, key: 'orders' }, { label: 'Net sales', num: true, render: (x) => money(x.net) }]} /></Card>
        <Card title="By location" padded={false}><Table rows={data?.by_location || []} rowKey="location" columns={[{ label: 'Location', key: 'location' }, { label: 'Orders', num: true, key: 'orders' }, { label: 'Net sales', num: true, render: (x) => money(x.net) }]} /></Card>
      </div>
      <Card title="Detail" padded={false} actions={<Button size="sm" variant="secondary" onClick={() => csv(s, 'sales')}><Download className="h-3.5 w-3.5" />CSV</Button>}>
        <Table rows={s} rowKey="period" maxHeight={400} dense columns={[{ label: 'Period', render: (x) => fmtDate(x.period) }, { label: 'Orders', num: true, key: 'orders' }, { label: 'Units', num: true, render: (x) => qty(x.units) }, { label: 'Net sales', num: true, render: (x) => money(x.net_sales) }, { label: 'COGS', num: true, render: (x) => money(x.cogs) }, { label: 'Gross profit', num: true, render: (x) => money(x.gross_profit) }]} />
      </Card>
    </div>
  )
}

function TopSellers() {
  const [r, setR] = useState({ from: addDays(isoDate(), -89), to: isoDate() })
  const { data } = useRpcQuery('sales_report', { p_from: r.from, p_to: r.to, p_grain: 'month' })
  const top = data?.top_items || []
  return (
    <div className="space-y-5">
      <Card><DateRange from={r.from} to={r.to} onChange={(from, to) => setR({ from, to })} /></Card>
      <Card title="Revenue by item">
        <div className="h-80"><ResponsiveContainer><BarChart data={top.slice(0, 12)} layout="vertical" margin={{ left: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis type="number" tickFormatter={(v) => '$' + Math.round(v / 1000) + 'k'} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => money(v)} /><Legend /><Bar dataKey="revenue" name="Net revenue" fill="#7a5632" /><Bar dataKey="gross_profit" name="Gross profit" fill="#2f7a55" />
        </BarChart></ResponsiveContainer></div>
      </Card>
      <Card padded={false} title="Ranking" actions={<Button size="sm" variant="secondary" onClick={() => csv(top, 'top-sellers')}><Download className="h-3.5 w-3.5" />CSV</Button>}>
        <Table rows={top.map((t, i) => ({ ...t, rank: i + 1 }))} rowKey="item_id" columns={[{ label: '#', key: 'rank' }, { label: 'Item', key: 'name' }, { label: 'Category', key: 'category' }, { label: 'Units (net of returns)', num: true, render: (t) => qty(t.units) }, { label: 'Revenue', num: true, render: (t) => money(t.revenue) }, { label: 'Gross profit', num: true, render: (t) => money(t.gross_profit) }, { label: 'Margin', num: true, render: (t) => pct((t.gross_profit / t.revenue) * 100) }]} />
      </Card>
    </div>
  )
}

function LowStock() {
  const rows = (usePolicy().data || []).filter((p) => p.needs_reorder || p.backordered_qty > 0).sort((a, b) => String(a.order_by_date).localeCompare(String(b.order_by_date)))
  return (
    <Card padded={false} title={`${rows.length} items at or below reorder point / backordered`} subtitle="Suggested quantity = EOQ (or enough to clear the reorder point); order-by = today when at/below ROP"
      actions={<Button size="sm" variant="secondary" onClick={() => csv(rows, 'low-stock')}><Download className="h-3.5 w-3.5" />CSV</Button>}>
      <Table rows={rows} rowKey="item_id" columns={[
        { label: 'Item', render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-stone-500">{r.sku}</div></div> },
        { label: 'Source', render: (r) => (r.is_made ? <Badge color="brown">Build</Badge> : r.supplier_name) },
        { label: 'On hand', num: true, render: (r) => qty(r.on_hand) }, { label: 'On order', num: true, render: (r) => qty(r.on_order) },
        { label: 'Allocated', num: true, render: (r) => qty(r.allocated) }, { label: 'Position', num: true, render: (r) => qty(r.position) },
        { label: 'ROP', num: true, key: 'reorder_point' }, { label: 'Suggested qty', num: true, render: (r) => <b>{num(r.suggested_qty)}</b> },
        { label: 'Order by', render: (r) => <span className="font-medium text-red-600">{fmtDate(r.order_by_date)}</span> },
        { label: 'Backordered', render: (r) => (r.backordered_qty > 0 ? <span><Badge color="red">{qty(r.backordered_qty)}</Badge> ETA {fmtDate(r.backorder_eta)}</span> : '') },
      ]} />
    </Card>
  )
}

function ByLocation() {
  const locs = useLocations().data || []
  const items = useItems().data || []
  const inv = useInventory().data || []
  const [loc, setLoc] = useState('')
  const rows = inv.filter((r) => Number(r.qty) > 0 && (!loc || r.location_id === Number(loc))).map((r) => {
    const it = items.find((i) => i.id === r.item_id) || {}; const l = locs.find((x) => x.id === r.location_id) || {}
    return { id: `${r.item_id}-${r.location_id}`, location: l.name, sku: it.sku, name: it.name, qty: Number(r.qty), avg_cost: Number(it.avg_cost), value: Number(r.qty) * Number(it.avg_cost) }
  }).sort((a, b) => a.location?.localeCompare(b.location) || b.value - a.value)
  const sum = locs.map((l) => ({ name: l.code, value: inv.filter((r) => r.location_id === l.id).reduce((s, r) => s + Number(r.qty) * Number(items.find((i) => i.id === r.item_id)?.avg_cost || 0), 0) }))
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{sum.map((s) => <div key={s.name} className="rounded-xl border bg-white p-4"><div className="text-xs uppercase text-stone-500">{s.name}</div><div className="text-2xl font-semibold">{money0(s.value)}</div></div>)}</div>
      <Card padded={false} title="Stock by location" actions={<><Select className="w-56 py-1.5" placeholder="All locations" value={loc} onChange={(e) => setLoc(e.target.value)} options={locs.map((l) => ({ value: l.id, label: l.name }))} /><Button size="sm" variant="secondary" onClick={() => csv(rows, 'inventory-by-location')}><Download className="h-3.5 w-3.5" />CSV</Button></>}>
        <Table rows={rows} maxHeight="60vh" dense columns={[{ label: 'Location', key: 'location' }, { label: 'SKU', key: 'sku' }, { label: 'Item', key: 'name' }, { label: 'Qty', num: true, render: (r) => qty(r.qty) }, { label: 'Avg cost', num: true, render: (r) => money(r.avg_cost) }, { label: 'Value', num: true, render: (r) => money(r.value) }]} />
      </Card>
    </div>
  )
}

function SupplierPerf() {
  const { data = [] } = useQuery({ queryKey: ['scorecard'], queryFn: () => sel(supabase.from('v_supplier_scorecard').select('*').order('score', { ascending: false })) })
  return (
    <div className="space-y-5">
      <Card title="Average actual vs quoted lead time (days)">
        <div className="h-72"><ResponsiveContainer><BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-12} height={50} /><YAxis tick={{ fontSize: 11 }} />
          <Tooltip /><Legend /><Bar dataKey="quoted_lead_days" name="Quoted" fill="#c2a47a" /><Bar dataKey="avg_actual_lead" name="Actual (avg)" fill="#7a5632" />
        </BarChart></ResponsiveContainer></div>
      </Card>
      <Card padded={false} title="Supplier performance" actions={<Button size="sm" variant="secondary" onClick={() => csv(data, 'supplier-performance')}><Download className="h-3.5 w-3.5" />CSV</Button>}>
        <Table rows={data} rowKey="supplier_id" columns={[{ label: 'Supplier', key: 'name' }, { label: 'POs', num: true, key: 'pos_received' }, { label: 'On-time', num: true, render: (s) => pct(s.on_time_pct) }, { label: 'Quoted LT', num: true, render: (s) => `${s.quoted_lead_days}d` }, { label: 'Actual LT', num: true, render: (s) => `${num(s.avg_actual_lead, 1)}d` }, { label: 'Fill rate', num: true, render: (s) => pct(s.fill_pct) }, { label: 'Owed', num: true, render: (s) => money(s.owed) }, { label: 'Score', num: true, key: 'score' }, { label: 'Rating', render: (s) => <StatusBadge status={s.rating} /> }]} />
      </Card>
    </div>
  )
}
