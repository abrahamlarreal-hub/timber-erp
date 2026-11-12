import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { LayoutDashboard, AlertTriangle, AlertCircle, CircleDot, DollarSign, Boxes, ClipboardList, Truck, Factory, ShieldAlert, Activity } from 'lucide-react'
import { supabase, sel } from '../lib/supabase'
import { useRpcQuery } from '../lib/hooks'
import { money, money0, fmtShort, fmtDateTime, num, pct } from '../lib/format'
import { Card, PageHeader, Stat, Spinner, Badge, cx } from '../components/ui.jsx'

const SEV = {
  high: { icon: AlertTriangle, cls: 'border-red-200 bg-red-50/60', ic: 'text-red-600', label: 'Urgent' },
  medium: { icon: AlertCircle, cls: 'border-amber-200 bg-amber-50/60', ic: 'text-amber-600', label: 'Today' },
  low: { icon: CircleDot, cls: 'border-stone-200 bg-white', ic: 'text-stone-400', label: 'FYI' },
}

export default function Dashboard() {
  const nav = useNavigate()
  const { data, isLoading } = useRpcQuery('dashboard')
  const feed = useQuery({
    queryKey: ['activity'],
    queryFn: () => sel(supabase.from('activity_log').select('*').order('ts', { ascending: false }).limit(14)),
  })
  if (isLoading || !data) return <Spinner />
  const k = data.kpis
  const gm = k.mtd_net_sales > 0 ? ((k.mtd_net_sales - k.mtd_cogs) / k.mtd_net_sales) * 100 : null
  const order = { high: 0, medium: 1, low: 2 }
  const alerts = [...data.alerts].sort((a, b) => order[a.severity] - order[b.severity])

  return (
    <>
      <PageHeader icon={LayoutDashboard} title="Action Center"
        subtitle={`Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'} — here is what needs attention today, prioritized from live data across every module.`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Sales today" value={money0(k.today_sales)} sub={`${k.today_orders} orders`} icon={DollarSign} onClick={() => nav('/reports')} />
        <Stat label="Net sales MTD" value={money0(k.mtd_net_sales)} sub={`Gross margin ${pct(gm)}`} icon={DollarSign} onClick={() => nav('/financials')} />
        <Stat label="Inventory value" value={money0(k.inventory_value)} sub="Weighted avg cost" icon={Boxes} onClick={() => nav('/financials')} />
        <Stat label="Open sales orders" value={k.open_sales_orders} sub={money0(k.open_sales_value)} icon={ClipboardList} onClick={() => nav('/sales')} />
        <Stat label="Below reorder point" value={k.below_rop} tone={k.below_rop ? 'warn' : 'good'} sub={`${k.backordered_items} item(s) backordered`} icon={ShieldAlert} onClick={() => nav('/replenishment')} />
        <Stat label="Open POs" value={k.open_pos} tone={k.late_pos ? 'bad' : undefined} sub={`${k.late_pos} late · ${money0(k.payables_due_7)} due in 7d`} icon={Truck} onClick={() => nav('/purchasing')} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Today's priorities" subtitle="Generated automatically from backorders, reorder points, late POs, payables, quality holds and due orders">
          {alerts.length === 0 && <p className="py-6 text-center text-sm text-stone-500">All clear — nothing needs attention.</p>}
          <div className="space-y-2">
            {alerts.map((a, i) => {
              const s = SEV[a.severity] || SEV.low
              return (
                <button key={i} onClick={() => a.link && nav(a.link)} className={cx('flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left hover:shadow-sm', s.cls)}>
                  <s.icon className={cx('mt-0.5 h-4 w-4 shrink-0', s.ic)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{a.title}</div>
                    <div className="text-xs text-stone-600">{a.detail}</div>
                  </div>
                  <Badge color={a.severity === 'high' ? 'red' : a.severity === 'medium' ? 'amber' : 'gray'}>{s.label}</Badge>
                </button>
              )
            })}
          </div>
        </Card>

        <div className="space-y-5">
          <Card title="Shop floor">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><div className="text-2xl font-semibold">{k.wip_orders}</div><div className="text-xs text-stone-500">In progress</div></div>
              <div><div className="text-2xl font-semibold">{k.planned_orders}</div><div className="text-xs text-stone-500">Planned</div></div>
              <div><div className="text-2xl font-semibold">{num(k.quality_hold_units)}</div><div className="text-xs text-stone-500">On quality hold</div></div>
            </div>
            <button onClick={() => nav('/production')} className="mt-3 flex w-full items-center justify-center gap-1 text-sm text-brand-700 hover:underline"><Factory className="h-4 w-4" />Open production</button>
          </Card>
          <Card title="Live activity" subtitle="Every user's actions, as they happen" actions={<Activity className="h-4 w-4 text-emerald-500" />}>
            <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
              {feed.data?.map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                  <div><span className="font-medium">{a.user_name}</span> <span className="text-stone-600">{a.message}</span>
                    <div className="text-[11px] text-stone-400">{fmtDateTime(a.ts)}</div></div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card className="mt-5" title="Net sales — last 30 days" subtitle="Fulfilled sales from POS, sales orders and the customer portal">
        <div className="h-64">
          <ResponsiveContainer>
            <AreaChart data={data.trend}>
              <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#946c3e" stopOpacity={0.35} /><stop offset="100%" stopColor="#946c3e" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" tickFormatter={fmtShort} tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => '$' + Math.round(v / 100) / 10 + 'k'} tick={{ fontSize: 11 }} width={50} />
              <Tooltip formatter={(v) => money(v)} labelFormatter={fmtShort} />
              <Area type="monotone" dataKey="net" stroke="#7a5632" strokeWidth={2} fill="url(#g)" name="Net sales" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </>
  )
}
