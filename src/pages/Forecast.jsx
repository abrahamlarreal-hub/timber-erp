import { useMemo, useState } from 'react'
import { ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useItems, usePolicy, useRpcQuery } from '../lib/hooks'
import { MODELS, forecastItem } from '../lib/forecast'
import { productImage } from '../lib/productArt'
import { money0, num, fmtShort, fmtDate, addDays } from '../lib/format'
import { Card, PageHeader, Table, Badge, Select, Stat, Spinner, Explain, Field, cx } from '../components/ui.jsx'

export default function Forecast() {
  const items = useItems().data || []
  const policy = usePolicy().data || []
  const { data: hist, isLoading } = useRpcQuery('weekly_usage', { p_weeks: 26 })
  const [method, setMethod] = useState('auto')
  const [horizon, setHorizon] = useState(8)
  const [series, setSeries] = useState('sold')
  const [group, setGroup] = useState('sellable')
  const [cat, setCat] = useState('')
  const [p, setP] = useState({ n: 4, alpha: 0.3, beta: 0.1 })
  const [sel, setSel] = useState(null)

  const rows = useMemo(() => {
    if (!hist?.items) return []
    const pol = Object.fromEntries(policy.map((x) => [x.item_id, x]))
    return hist.items.map((h) => {
      const it = items.find((i) => i.id === h.item_id)
      if (!it) return null
      const y = (series === 'sold' ? h.sold : h.used).map(Number)
      const f = forecastItem(y, { method, horizon, params: p })
      const pl = pol[it.id] || {}
      const onHand = Number(pl.on_hand || 0)
      const daily = f.weekly / 7
      const coverDays = daily > 0 ? onHand / daily : null
      const lt = it.lead_time_days
      const risk = daily <= 0 ? 'none' : coverDays < lt ? 'high' : coverDays < lt + 14 ? 'medium' : 'ok'
      return { ...it, y, f, onHand, onOrder: Number(pl.on_order || 0), coverDays, risk,
        stockout: coverDays != null ? addDays(hist.today, Math.floor(coverDays)) : null,
        revenue: Number(it.price) > 0 && it.sellable ? f.total * Number(it.price) : 0 }
    }).filter(Boolean)
  }, [hist, items, policy, method, horizon, series, p])

  const shown = rows.filter((r) => (group === 'all' || (group === 'sellable' ? r.sellable && Number(r.price) > 0 : r.item_type === 'component'))
    && (!cat || r.category === cat)).sort((a, b) => b.f.total - a.f.total)
  const cats = [...new Set(rows.filter((r) => group === 'all' || (group === 'sellable' ? r.sellable && Number(r.price) > 0 : r.item_type === 'component')).map((r) => r.category))].sort()
  const current = shown.find((r) => r.id === sel) || shown[0]
  const acc = shown.filter((r) => r.f.accuracy != null)
  if (isLoading || !hist) return <Spinner label="Building forecasts…" />

  const byCat = Object.values(shown.reduce((m, r) => {
    const k = r.category; m[k] = m[k] || { category: k, units: 0, revenue: 0 }; m[k].units += r.f.total; m[k].revenue += r.revenue; return m
  }, {})).sort((a, b) => b.revenue - a.revenue)

  return (
    <>
      <PageHeader icon={TrendingUp} title="Demand Forecast"
        subtitle="Forecasts the next weeks for every item from 26 weeks of actual transactions, measures each method's accuracy, and flags items that will run out before a reorder could arrive" />

      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Products"><Select value={group} onChange={(e) => { setGroup(e.target.value); setCat('') }} options={[{ value: 'sellable', label: 'Products we sell' }, { value: 'component', label: 'Raw materials / components' }, { value: 'all', label: 'All items' }]} /></Field>
          <Field label="Product group"><Select value={cat} onChange={(e) => setCat(e.target.value)} placeholder="All groups" options={cats.map((c) => ({ value: c, label: c }))} /></Field>
          <Field label="Demand measured as"><Select value={series} onChange={(e) => setSeries(e.target.value)} options={[{ value: 'sold', label: 'Customer sales (net of returns)' }, { value: 'used', label: 'Total usage (sales + production)' }]} /></Field>
          <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)} options={[{ value: 'auto', label: 'Auto — most accurate per item' }, ...Object.entries(MODELS).map(([k, m]) => ({ value: k, label: m.label }))]} /></Field>
          <Field label="Horizon"><Select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} options={[4, 8, 12].map((h) => ({ value: h, label: `${h} weeks` }))} /></Field>
          <div className="space-y-1 text-xs">
            <label className="flex items-center justify-between gap-2">Moving avg weeks <b>{p.n}</b></label>
            <input type="range" min="2" max="12" value={p.n} onChange={(e) => setP({ ...p, n: Number(e.target.value) })} className="w-full" />
            <label className="flex items-center justify-between gap-2">Smoothing α <b>{p.alpha.toFixed(2)}</b></label>
            <input type="range" min="0.05" max="0.9" step="0.05" value={p.alpha} onChange={(e) => setP({ ...p, alpha: Number(e.target.value) })} className="w-full" />
            <label className="flex items-center justify-between gap-2">Trend β <b>{p.beta.toFixed(2)}</b></label>
            <input type="range" min="0.05" max="0.5" step="0.05" value={p.beta} onChange={(e) => setP({ ...p, beta: Number(e.target.value) })} className="w-full" />
          </div>
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`Forecast units (${horizon} wks)`} value={num(shown.reduce((s, r) => s + r.f.total, 0))} />
        <Stat label={`Forecast revenue (${horizon} wks)`} value={money0(shown.reduce((s, r) => s + r.revenue, 0))} sub="units × list price" />
        <Stat label="Avg forecast accuracy" value={acc.length ? `${num(acc.reduce((s, r) => s + r.f.accuracy, 0) / acc.length, 0)}%` : '—'} sub="100% − MAPE, last 8 weeks" />
        <Stat label="Stockout risk" value={shown.filter((r) => r.risk === 'high').length} tone={shown.some((r) => r.risk === 'high') ? 'bad' : 'good'} sub="run out before lead time" />
      </div>

      {current && (
        <Card className="mb-5" title={<span className="flex items-center gap-3"><img src={productImage(current)} className="h-10 w-12 rounded object-cover" alt="" />{current.name}</span>}
          subtitle={`${MODELS[current.f.method].label} · accuracy ${current.f.accuracy == null ? '—' : num(current.f.accuracy, 0) + '%'} · error ±${num(current.f.mad, 1)} units/wk · ${current.f.bias > 0.5 ? 'tends to over-forecast' : current.f.bias < -0.5 ? 'tends to under-forecast' : 'no bias'}`}>
          <ItemChart r={current} weeks={hist.weeks} today={hist.today} horizon={horizon} />
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" padded={false} title="Forecast by item" subtitle="Click a row to chart it">
          <Table rows={shown} onRowClick={(r) => setSel(r.id)} maxHeight="60vh" columns={[
            { label: 'Item', render: (r) => <div className="flex items-center gap-2"><img src={productImage(r)} className="h-8 w-10 rounded object-cover" alt="" /><div><div className={cx('font-medium', current?.id === r.id && 'text-brand-700')}>{r.name}</div><div className="text-xs text-stone-500">{r.category}</div></div></div> },
            { label: 'Last 4 wks / wk', num: true, render: (r) => num(r.f.recent, 1) },
            { label: 'Trend', render: (r) => r.f.change == null ? '' : <span className={cx('flex items-center gap-1 text-xs', r.f.change > 5 ? 'text-emerald-700' : r.f.change < -5 ? 'text-red-600' : 'text-stone-500')}>
              {r.f.change > 5 ? <TrendingUp className="h-3.5 w-3.5" /> : r.f.change < -5 ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}{num(r.f.change, 0)}%</span> },
            { label: 'Forecast / wk', num: true, render: (r) => <b>{num(r.f.weekly, 1)}</b> },
            { label: `Next ${horizon} wks`, num: true, render: (r) => num(r.f.total, 0) },
            { label: 'Method', render: (r) => <Badge>{MODELS[r.f.method].short}</Badge> },
            { label: 'Accuracy', num: true, render: (r) => r.f.accuracy == null ? '—' : <span className={r.f.accuracy >= 75 ? 'text-emerald-700' : r.f.accuracy >= 55 ? 'text-amber-700' : 'text-red-600'}>{num(r.f.accuracy, 0)}%</span> },
            { label: 'On hand', num: true, render: (r) => num(r.onHand, 0) },
            { label: 'Runs out', render: (r) => r.coverDays == null ? '—' : <div className="text-xs"><div>{fmtDate(r.stockout)}</div><div className="text-stone-500">{num(r.coverDays, 0)} days · LT {r.lead_time_days}d</div></div> },
            { label: 'Risk', render: (r) => r.risk === 'high' ? <Badge color="red">Order now</Badge> : r.risk === 'medium' ? <Badge color="amber">Watch</Badge> : r.risk === 'ok' ? <Badge color="green">OK</Badge> : '' },
          ]} />
        </Card>
        <Card title="Forecast by product group" padded={false}>
          <Table rows={byCat} rowKey="category" columns={[
            { label: 'Group', key: 'category' },
            { label: 'Units', num: true, render: (c) => num(c.units, 0) },
            { label: 'Revenue', num: true, render: (c) => money0(c.revenue) },
          ]} />
        </Card>
      </div>

      <div className="mt-5"><Explain title="How the forecast works">
        <p><b>Data:</b> weekly units for the last 26 weeks, rebuilt from the inventory transaction ledger (sales and returns, optionally plus production consumption).</p>
        <p><b>Methods:</b> <i>Moving average</i> = average of the last n weeks. <i>Exponential smoothing</i> = level updated each week by α × (actual − level), so recent weeks count more. <i>Trend (Holt)</i> = also smooths a trend (β), so growing items like holiday gift sets are projected upward.</p>
        <p><b>Accuracy:</b> each method is back-tested on the last 8 weeks (forecast each week using only the weeks before it). MAD = average absolute error; MAPE = average % error; accuracy = 100% − MAPE. <i>Auto</i> picks the method with the lowest error for each item.</p>
        <p><b>Risk:</b> days of cover = on hand ÷ forecast daily demand. If that's shorter than the item's lead time, the item will run out before a new order can arrive → <i>Order now</i>. The shaded band on the chart is an 80% range (±1.28 × back-test RMSE).</p>
      </Explain></div>
    </>
  )
}

function ItemChart({ r, weeks, horizon }) {
  const fitted = Object.fromEntries(r.f.fitted.map((x) => [x.t, x.f]))
  const last = weeks[weeks.length - 1]
  const data = [
    ...r.y.map((v, i) => ({ week: weeks[i], actual: v, fitted: fitted[i] })),
    ...r.f.forecast.map((v, i) => ({ week: addDays(last, 7 * (i + 1)), forecast: v, range: [Math.max(0, v - r.f.band), v + r.f.band] })),
  ]
  data[r.y.length - 1].forecast = r.y[r.y.length - 1] // connect the line
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="week" tickFormatter={fmtShort} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip labelFormatter={(d) => 'Week of ' + fmtShort(d)} formatter={(v) => (Array.isArray(v) ? `${num(v[0], 1)} – ${num(v[1], 1)}` : num(v, 1))} />
          <Legend />
          <Area dataKey="range" name="80% range" fill="#2f7a55" fillOpacity={0.12} stroke="none" isAnimationActive={false} />
          <Bar dataKey="actual" name="Actual units" fill="#c2a47a" isAnimationActive={false} />
          <Line dataKey="fitted" name="Back-test forecast" stroke="#94a3b8" strokeDasharray="4 3" dot={{ r: 2 }} isAnimationActive={false} />
          <Line dataKey="forecast" name={`Forecast (${horizon} wks)`} stroke="#2f7a55" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
