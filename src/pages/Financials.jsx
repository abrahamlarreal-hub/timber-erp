import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell } from 'recharts'
import { Landmark, Plus } from 'lucide-react'
import { supabase, sel, rpc } from '../lib/supabase'
import { useRpcQuery, useAction } from '../lib/hooks'
import { money, money0, pct, num, isoDate, addDays, fmtDateTime, qty } from '../lib/format'
import { Card, PageHeader, Tabs, DateRange, Stat, Table, Spinner, Explain, Button, Modal, Field, Select, Input, cx } from '../components/ui.jsx'

const COLORS = ['#7a5632', '#2f7a55', '#c2a47a', '#0ea5e9', '#a855f7', '#f59e0b', '#64748b']

export default function Financials() {
  const [tab, setTab] = useState('pnl')
  const [r, setR] = useState({ from: addDays(isoDate(), -181), to: isoDate() })
  return (
    <>
      <PageHeader icon={Landmark} title="Financial Reporting" subtitle="Profit & loss, inventory valuation and turnover — computed live from the general ledger and inventory transactions" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'pnl', label: 'Profit & Loss' }, { value: 'valuation', label: 'Inventory valuation' }, { value: 'turnover', label: 'Inventory turnover' }, { value: 'gl', label: 'General ledger' }]} />
      {tab !== 'valuation' && <Card className="mb-5"><DateRange from={r.from} to={r.to} onChange={(from, to) => setR({ from, to })} /></Card>}
      {tab === 'pnl' && <PnL r={r} />}
      {tab === 'valuation' && <Valuation />}
      {tab === 'turnover' && <Turnover r={r} />}
      {tab === 'gl' && <Ledger r={r} />}
    </>
  )
}

function PnL({ r }) {
  const { data: p } = useRpcQuery('pnl', { p_from: r.from, p_to: r.to })
  const [exp, setExp] = useState(false)
  if (!p) return <Spinner />
  const L = ({ label, v, bold, indent, neg, border }) => (
    <div className={cx('flex justify-between py-1.5 text-sm', bold && 'font-semibold', border && 'border-t border-stone-300', indent && 'pl-5 text-stone-600')}>
      <span>{label}</span><span className="tabular-nums">{neg ? `(${money(v)})` : money(v)}</span>
    </div>
  )
  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <Card className="lg:col-span-2" title="Income statement" subtitle={`${r.from} → ${r.to}`} actions={<Button size="sm" variant="secondary" onClick={() => setExp(true)}><Plus className="h-3.5 w-3.5" />Record expense</Button>}>
        <L label="Gross sales" v={p.gross_sales} />
        <L label="Less: discounts" v={p.discounts} indent neg />
        <L label="Less: returns & allowances" v={p.returns} indent neg />
        <L label="Net sales" v={p.net_sales} bold border />
        <L label="Cost of goods sold" v={p.cogs} indent neg />
        <L label={`Gross profit (${pct(p.gross_margin_pct)} margin)`} v={p.gross_profit} bold border />
        <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Operating expenses</div>
        <L label="Wages" v={p.wages} indent /><L label="Rent" v={p.rent} indent /><L label="Utilities" v={p.utilities} indent /><L label="Marketing" v={p.marketing} indent />
        <L label="Production scrap" v={p.production_scrap} indent /><L label="Inventory shrinkage & adjustments" v={p.shrinkage} indent />
        {Number(p.other) !== 0 && <L label="Other" v={p.other} indent />}
        <L label="Total operating expenses" v={p.operating_expenses} border />
        <div className={cx('mt-2 flex justify-between rounded-lg px-3 py-2 text-base font-bold', p.net_income >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800')}><span>Net income</span><span>{money(p.net_income)}</span></div>
      </Card>
      <div className="space-y-5 lg:col-span-3">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Net sales" value={money0(p.net_sales)} /><Stat label="Gross margin" value={pct(p.gross_margin_pct)} /><Stat label="Net margin" value={pct(p.net_sales ? (p.net_income / p.net_sales) * 100 : null)} tone={p.net_income >= 0 ? 'good' : 'bad'} />
        </div>
        <Card title="Monthly trend">
          <div className="h-72"><ResponsiveContainer><BarChart data={p.months.map((m) => ({ ...m, profit: m.net_sales - m.cogs - m.expenses }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tickFormatter={(v) => '$' + Math.round(v / 1000) + 'k'} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => money(v)} /><Legend />
            <Bar dataKey="net_sales" name="Net sales" fill="#c2a47a" /><Bar dataKey="cogs" name="COGS" fill="#7a5632" /><Bar dataKey="expenses" name="Operating exp." fill="#94a3b8" /><Bar dataKey="profit" name="Net income" fill="#2f7a55" />
          </BarChart></ResponsiveContainer></div>
        </Card>
        <Explain title="Where these numbers come from">
          <p>Every POS sale, order fulfillment, return, receipt, production completion, adjustment and payment posts balanced debit/credit entries to the general ledger inside the same database transaction. The P&amp;L simply sums those entries for the date range — so a sale entered on any screen shows up here instantly.</p>
          <p><b>COGS</b> uses the perpetual weighted-average cost at the moment each unit ships; returns reverse it at the original cost.</p>
        </Explain>
      </div>
      <ExpenseModal open={exp} onClose={() => setExp(false)} />
    </div>
  )
}

function ExpenseModal({ open, onClose }) {
  const [f, setF] = useState({ account: 'Utilities', amount: '', memo: '' })
  const save = useAction(() => rpc('record_expense', { p_account: f.account, p_amount: Number(f.amount), p_memo: f.memo || null }), { success: 'Expense recorded', onSuccess: onClose })
  return (
    <Modal open={open} onClose={onClose} title="Record operating expense" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="Account"><Select value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })} options={['Rent', 'Wages', 'Utilities', 'Marketing', 'Other Operating Expense'].map((v) => ({ value: v, label: v }))} /></Field>
        <Field label="Amount"><Input type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Memo"><Input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

function Valuation() {
  const { data = [] } = useQuery({ queryKey: ['valuation'], queryFn: () => sel(supabase.from('v_inventory_valuation').select('*').order('value', { ascending: false })) })
  const total = data.reduce((s, r) => s + Number(r.value), 0)
  const group = (k) => Object.entries(data.reduce((a, r) => ({ ...a, [r[k]]: (a[r[k]] || 0) + Number(r.value) }), {})).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const byItem = Object.values(data.reduce((a, r) => { const x = a[r.item_id] || { ...r, qty: 0, value: 0 }; x.qty += Number(r.qty); x.value += Number(r.value); a[r.item_id] = x; return a }, {})).sort((a, b) => b.value - a.value)
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <Stat label="Total inventory value" value={money(total)} sub="On-hand qty × weighted-average cost" />
        {[['location_name', 'By location'], ['category', 'By category']].map(([k, t]) => (
          <Card key={k} title={t}><div className="flex items-center gap-3"><div className="h-36 w-36"><ResponsiveContainer><PieChart><Pie data={group(k)} dataKey="value" nameKey="name" innerRadius={35} outerRadius={65}>{group(k).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip formatter={(v) => money(v)} /></PieChart></ResponsiveContainer></div>
            <ul className="flex-1 space-y-1 text-xs">{group(k).map((g, i) => <li key={g.name} className="flex justify-between gap-2"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />{g.name}</span><b>{money0(g.value)}</b></li>)}</ul></div></Card>
        ))}
      </div>
      <Card title="Valuation by item (weighted average cost)" padded={false}>
        <Table rows={byItem} rowKey="item_id" maxHeight="60vh" columns={[
          { label: 'SKU', key: 'sku' }, { label: 'Item', key: 'name' }, { label: 'Type', key: 'item_type' },
          { label: 'Qty on hand', num: true, render: (r) => qty(r.qty) }, { label: 'Avg cost', num: true, render: (r) => money(r.avg_cost) },
          { label: 'Value', num: true, render: (r) => <b>{money(r.value)}</b> }, { label: '% of total', num: true, render: (r) => pct((r.value / total) * 100) },
        ]} footer={<tr><td className="td" colSpan={5}>Total</td><td className="td num">{money(total)}</td><td /></tr>} />
      </Card>
    </div>
  )
}

function Turnover({ r }) {
  const { data: t } = useRpcQuery('inventory_turnover', { p_from: r.from, p_to: r.to })
  if (!t) return <Spinner />
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Inventory turnover (period)" value={`${num(t.turnover, 2)}×`} sub={`${t.days} days`} />
        <Stat label="Annualized turnover" value={`${num(t.annualized_turnover, 2)}×`} sub="per year" />
        <Stat label="Days of inventory" value={num(t.days_inventory, 1)} sub="avg days to sell through" />
        <Stat label="COGS in period" value={money0(t.cogs)} />
      </div>
      <Card title="Calculation">
        <div className="grid gap-3 text-sm sm:grid-cols-4">
          <div className="rounded-lg bg-stone-50 p-3"><div className="text-xs text-stone-500">Beginning inventory ({r.from})</div><div className="text-lg font-semibold">{money(t.begin_value)}</div></div>
          <div className="rounded-lg bg-stone-50 p-3"><div className="text-xs text-stone-500">Ending inventory ({r.to})</div><div className="text-lg font-semibold">{money(t.end_value)}</div></div>
          <div className="rounded-lg bg-stone-50 p-3"><div className="text-xs text-stone-500">Average inventory</div><div className="text-lg font-semibold">{money(t.avg_value)}</div></div>
          <div className="rounded-lg bg-brand-50 p-3"><div className="text-xs text-stone-500">Turnover = COGS ÷ avg inventory</div><div className="text-lg font-semibold">{money0(t.cogs)} ÷ {money0(t.avg_value)} = {num(t.turnover, 2)}×</div></div>
        </div>
        <p className="mt-3 text-xs text-stone-500">Beginning and ending values are rebuilt from the inventory ledger: current value minus the value of every movement after that date. Annualized = turnover × 365 ÷ days in period.</p>
      </Card>
      <Card title="Turnover by category" padded={false}>
        <Table rows={t.by_category} rowKey="category" columns={[
          { label: 'Category', key: 'category' }, { label: 'Begin', num: true, render: (c) => money(c.begin) }, { label: 'End', num: true, render: (c) => money(c.end) },
          { label: 'COGS (sold)', num: true, render: (c) => money(c.cogs) }, { label: 'Turnover', num: true, render: (c) => (c.turnover == null ? '—' : `${num(c.turnover, 2)}×`) },
          { label: 'Annualized', num: true, render: (c) => (c.annualized == null ? '—' : `${num(c.annualized, 2)}×`) },
        ]} />
        <p className="px-4 py-2 text-xs text-stone-500">Raw materials don’t show COGS directly — they’re consumed into finished goods by production, then sold.</p>
      </Card>
    </div>
  )
}

function Ledger({ r }) {
  const { data = [] } = useQuery({ queryKey: ['gl', r], queryFn: () => sel(supabase.from('gl_entries').select('*').gte('ts', r.from).lte('ts', r.to + 'T23:59:59').order('id', { ascending: false }).limit(400)) })
  const bal = useQuery({ queryKey: ['tb'], queryFn: async () => {
    const rows = await sel(supabase.from('gl_entries').select('account, debit, credit'))
    const m = {}; rows.forEach((x) => { m[x.account] = (m[x.account] || 0) + Number(x.debit) - Number(x.credit) })
    return Object.entries(m).map(([account, balance]) => ({ account, balance })).sort((a, b) => a.account.localeCompare(b.account))
  } }).data || []
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Trial balance (all time)" subtitle="Debits − credits; balances to zero" padded={false}>
        <Table rows={bal} rowKey="account" dense columns={[{ label: 'Account', key: 'account' }, { label: 'Balance', num: true, render: (b) => money(b.balance) }]}
          footer={<tr><td className="td">Total</td><td className="td num">{money(bal.reduce((s, b) => s + b.balance, 0))}</td></tr>} />
      </Card>
      <Card className="lg:col-span-2" title="Journal entries (latest 400 in range)" padded={false}>
        <Table rows={data} maxHeight="70vh" dense columns={[
          { label: 'When', render: (g) => fmtDateTime(g.ts) }, { label: 'Account', key: 'account' }, { label: 'Debit', num: true, render: (g) => (Number(g.debit) ? money(g.debit) : '') },
          { label: 'Credit', num: true, render: (g) => (Number(g.credit) ? money(g.credit) : '') }, { label: 'Memo', key: 'memo' },
        ]} />
      </Card>
    </div>
  )
}
