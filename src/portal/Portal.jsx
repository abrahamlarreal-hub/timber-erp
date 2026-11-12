import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShoppingBag, LogOut, MapPin, Minus, Plus, CheckCircle2, Search } from 'lucide-react'
import { supabase, sel, rpc } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { useRealtimeSync } from '../lib/realtime.js'
import { useAction, useLocations, useSettings } from '../lib/hooks'
import { money, fmtDate, isoDate, addDays, qty } from '../lib/format'
import { Button, Card, Badge, StatusBadge, Tabs, Select, Input, Field, Table, Spinner, Modal, cx } from '../components/ui.jsx'

export default function Portal() {
  const { profile, signOut } = useAuth()
  const status = useRealtimeSync(true)
  const [tab, setTab] = useState('shop')
  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <img src="/logo.svg" className="h-9 w-9" alt="" />
          <div><div className="font-semibold">Timpanogos Timber Co.</div><div className="text-xs text-stone-500">Order online · pick up in Provo or Lindon</div></div>
          <div className="ml-auto flex items-center gap-3">
            <span className={cx('hidden text-xs sm:inline', status === 'live' ? 'text-emerald-600' : 'text-stone-400')}>● live stock</span>
            <span className="text-sm">Hi, {profile.full_name?.split(' ')[0]}</span>
            <button onClick={signOut} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'shop', label: 'Shop' }, { value: 'orders', label: 'My orders' }]} />
        {tab === 'shop' ? <Shop onOrdered={() => setTab('orders')} /> : <MyOrders />}
      </main>
    </div>
  )
}

function Shop({ onOrdered }) {
  const { data: catalog, isLoading } = useQuery({ queryKey: ['catalog'], queryFn: () => rpc('customer_catalog') })
  const locs = (useLocations().data || []).filter((l) => l.pickup)
  const tax = Number(useSettings().data?.map.tax_rate || 0.0725)
  const [cart, setCart] = useState({})
  const [q, setQ] = useState('')
  const [pickup, setPickup] = useState({ loc: '', date: addDays(isoDate(), 1) })
  const [done, setDone] = useState(null)
  const place = useAction(() => rpc('place_customer_order', {
    p_location: Number(pickup.loc || locs[locs.length - 1]?.id), p_pickup: pickup.date,
    p_lines: Object.entries(cart).filter(([, n]) => n > 0).map(([id, n]) => ({ item_id: Number(id), qty: n })),
  }), { onSuccess: (id) => { setCart({}); setDone(id) } })
  const items = (catalog || []).filter((i) => !q || (i.name + i.category).toLowerCase().includes(q.toLowerCase()))
  const byId = useMemo(() => Object.fromEntries((catalog || []).map((i) => [i.id, i])), [catalog])
  const lines = Object.entries(cart).filter(([, n]) => n > 0)
  const sub = lines.reduce((s, [id, n]) => s + n * Number(byId[id]?.price || 0), 0)
  const locId = Number(pickup.loc || locs[locs.length - 1]?.id)
  if (isLoading) return <Spinner />
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="relative mb-3"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" /><Input className="pl-9" placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((it) => {
            const n = cart[it.id] || 0
            return (
              <div key={it.id} className="flex flex-col rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="text-xs uppercase tracking-wide text-stone-500">{it.category}</div>
                <div className="font-semibold">{it.name}</div>
                <div className="mt-1 flex-1 text-sm text-stone-600">{it.description}</div>
                <div className="mt-3 space-y-1">
                  {it.stock.map((s) => (
                    <div key={s.location_id} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1 text-stone-600"><MapPin className="h-3 w-3" />{s.location}</span>
                      {Number(s.qty) > 0 ? <Badge color="green">{qty(s.qty)} in stock</Badge> : <Badge color="gray">none here</Badge>}
                    </div>
                  ))}
                  {Number(it.available) <= 0 && <div className="text-xs text-amber-700">{it.stock.some((s) => Number(s.qty) > 0) ? 'Shelf stock is reserved for earlier orders' : 'Out of stock'} — new orders ready for pickup by <b>{fmtDate(it.ready_by)}</b></div>}
                  {Number(it.available) > 0 && <div className="text-xs text-emerald-700">{qty(it.available)} available to order now</div>}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-lg font-semibold">{money(it.price)}</span>
                  {n === 0 ? <Button size="sm" onClick={() => setCart({ ...cart, [it.id]: 1 })}>Add</Button> : (
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setCart({ ...cart, [it.id]: n - 1 })}><Minus className="h-3 w-3" /></Button>
                      <span className="w-5 text-center">{n}</span>
                      <Button size="sm" variant="secondary" onClick={() => setCart({ ...cart, [it.id]: n + 1 })}><Plus className="h-3 w-3" /></Button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <Card className="self-start lg:sticky lg:top-4" title={<span className="flex items-center gap-2"><ShoppingBag className="h-4 w-4" />Pickup order</span>}>
        {lines.length === 0 ? <p className="py-6 text-center text-sm text-stone-400">Your bag is empty.</p> : (
          <div className="space-y-2">
            {lines.map(([id, n]) => {
              const it = byId[id]; const here = Number(it.stock.find((s) => s.location_id === locId)?.qty || 0)
              return (
                <div key={id} className="text-sm">
                  <div className="flex justify-between"><span>{n} × {it.name}</span><span>{money(n * it.price)}</span></div>
                  {here < n && <div className="text-xs text-amber-700">{here > 0 ? `Only ${here} at this store now` : 'Not at this store now'} — we’ll have it ready by {fmtDate(it.ready_by)}</div>}
                </div>
              )
            })}
            <div className="border-t pt-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{money(sub)}</span></div><div className="flex justify-between text-stone-500"><span>Est. tax</span><span>{money(sub * tax)}</span></div><div className="flex justify-between font-semibold"><span>Total (pay at pickup)</span><span>{money(sub * (1 + tax))}</span></div></div>
          </div>
        )}
        <div className="mt-4 space-y-3">
          <Field label="Pick up at"><Select value={pickup.loc || locs[locs.length - 1]?.id || ''} onChange={(e) => setPickup({ ...pickup, loc: e.target.value })} options={locs.map((l) => ({ value: l.id, label: `${l.name} — ${l.address}` }))} /></Field>
          <Field label="Pickup date"><Input type="date" min={isoDate()} value={pickup.date} onChange={(e) => setPickup({ ...pickup, date: e.target.value })} /></Field>
          <Button className="w-full" size="lg" disabled={!lines.length} loading={place.isPending} onClick={() => place.mutate()}>Place pickup order</Button>
        </div>
      </Card>
      <Modal open={!!done} onClose={() => { setDone(null); onOrdered() }} title="Order placed!">
        <div className="flex items-center gap-3"><CheckCircle2 className="h-10 w-10 text-emerald-600" /><p className="text-sm">Thanks! Your order is confirmed. We’ll have it ready at the store you chose — check status anytime under <b>My orders</b>.</p></div>
      </Modal>
    </div>
  )
}

function MyOrders() {
  const { data = [] } = useQuery({ queryKey: ['my_orders'], queryFn: () => sel(supabase.from('sales_orders').select('*, location:locations(name), lines:sales_order_lines(qty, unit_price, item:items(name))').order('order_date', { ascending: false })) })
  const cancel = useAction((id) => rpc('cancel_sales_order', { p_id: id, p_reason: 'Cancelled by customer' }), { success: 'Order cancelled' })
  const label = { Placed: 'Confirmed — being prepared', Fulfilled: 'Picked up', Closed: 'Complete', Cancelled: 'Cancelled' }
  return (
    <Card padded={false}>
      <Table rows={data} empty="No orders yet." columns={[
        { label: 'Order', render: (o) => <span className="font-medium">{o.number}</span> },
        { label: 'Placed', render: (o) => fmtDate(o.order_date) },
        { label: 'Pickup', render: (o) => <div><div>{o.location?.name}</div><div className="text-xs text-stone-500">{fmtDate(o.due_date)}</div></div> },
        { label: 'Items', render: (o) => o.lines.map((l) => `${qty(l.qty)}× ${l.item.name}`).join(', ') },
        { label: 'Status', render: (o) => <div><StatusBadge status={o.status} /><div className="text-xs text-stone-500">{label[o.status]}</div></div> },
        { label: 'Total', num: true, render: (o) => money(o.total) },
        { label: '', render: (o) => o.status === 'Placed' && <Button size="sm" variant="ghost" onClick={() => confirm('Cancel this order?') && cancel.mutate(o.id)}>Cancel</Button> },
      ]} />
    </Card>
  )
}
