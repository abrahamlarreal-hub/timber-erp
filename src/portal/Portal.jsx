import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShoppingBag, LogOut, MapPin, Minus, Plus, CheckCircle2, Search } from 'lucide-react'
import { supabase, sel, rpc } from '../lib/supabase'
import { useAuth } from '../lib/auth.jsx'
import { useRealtimeSync } from '../lib/realtime.js'
import { useAction, useLocations, useSettings } from '../lib/hooks'
import { money, fmtDate, isoDate, addDays, qty } from '../lib/format'
import { productImage } from '../lib/productArt'
import { Button, Card, Badge, StatusBadge, Tabs, Select, Input, Field, Table, Spinner, Modal, cx } from '../components/ui.jsx'

export default function Portal() {
  const { profile, signOut } = useAuth()
  const status = useRealtimeSync(true)
  const [tab, setTab] = useState('shop')
  // create any repeat orders that are coming due (a week ahead)
  useEffect(() => { rpc('run_recurring_orders').catch(() => {}) }, [])
  return (
    <div className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <img src="/logo.svg" className="h-9 w-9" alt="" />
          <div><div className="font-semibold">Timpanogos Timber Co.</div><div className="text-xs text-stone-500">Order online · pick up in Provo or Lindon</div></div>
          <div className="ml-auto flex items-center gap-3">
            <span className={cx('hidden text-xs sm:inline', status === 'live' ? 'text-emerald-600' : 'text-stone-400')}>● live stock</span>
            <span className="text-sm">Hi, {profile.full_name?.split(' ')[0]}</span>
            <button onClick={signOut} className="flex items-center gap-1.5 rounded-lg border border-stone-200 px-2.5 py-1.5 text-sm text-stone-700 hover:bg-stone-100" title="Sign out"><LogOut className="h-4 w-4" /><span className="hidden sm:inline">Sign out</span></button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'shop', label: 'Shop' }, { value: 'orders', label: 'My orders' }, { value: 'repeat', label: 'Repeat orders' }]} />
        {tab === 'shop' ? <Shop onOrdered={() => setTab('orders')} /> : tab === 'orders' ? <MyOrders /> : <RepeatOrders />}
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
  const [cat, setCat] = useState('')
  const [pickup, setPickup] = useState({ loc: '', date: addDays(isoDate(), 1), payNow: false, repeat: false })
  const [promoText, setPromoText] = useState('')
  const [promo, setPromo] = useState(null) // validated promo
  const [promoErr, setPromoErr] = useState(null)
  const applyPromo = async () => {
    setPromoErr(null)
    if (!promoText.trim()) return
    const r = await rpc('check_promo', { p_code: promoText }).catch(() => ({ valid: false }))
    if (r.valid) setPromo(r); else { setPromo(null); setPromoErr('That promo code isn\'t valid.') }
  }
  const [done, setDone] = useState(null)
  const place = useAction(() => rpc('place_customer_order', {
    p_location: Number(pickup.loc || locs[locs.length - 1]?.id), p_pickup: pickup.date, p_pay_now: pickup.payNow,
    p_promo: promo?.code || null, p_repeat_monthly: pickup.repeat,
    p_lines: Object.entries(cart).filter(([, n]) => n > 0).map(([id, n]) => ({ item_id: Number(id), qty: n })),
  }), { onSuccess: (id) => { setCart({}); setDone(id); setPromo(null); setPromoText(''); setPickup((x) => ({ ...x, repeat: false })) } })
  const items = (catalog || []).filter((i) => (!q || (i.name + i.category).toLowerCase().includes(q.toLowerCase())) && (!cat || i.category === cat))
  const cats = [...new Set((catalog || []).map((i) => i.category))].sort()
  const byId = useMemo(() => Object.fromEntries((catalog || []).map((i) => [i.id, i])), [catalog])
  const lines = Object.entries(cart).filter(([, n]) => n > 0)
  const sub = lines.reduce((s, [id, n]) => s + n * Number(byId[id]?.price || 0), 0)
  const promoOff = !promo ? 0 : promo.kind === 'percent' ? sub * Number(promo.value) / 100 : Math.min(sub, Number(promo.value))
  const net = sub - promoOff
  const grand = Math.round(net * (1 + tax) * 100) / 100
  const repeatDay = Math.min(28, Number(String(pickup.date).slice(8, 10)) || 1)
  const locId = Number(pickup.loc || locs[locs.length - 1]?.id)
  if (isLoading) return <Spinner />
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="mb-3 flex gap-2">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" /><Input className="pl-9" placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select className="w-48" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="All categories" options={cats.map((c) => ({ value: c, label: c }))} />
        </div>
        {cats.filter((c) => items.some((i) => i.category === c)).map((c) => (<div key={c} className="mb-5">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-stone-500">{c}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {items.filter((i) => i.category === c).map((it) => {
            const n = cart[it.id] || 0
            return (
              <div key={it.id} className="flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
                <img src={productImage(it)} alt={it.name} className="h-40 w-full object-cover" />
                <div className="flex flex-1 flex-col p-4">
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
              </div>
            )
          })}
        </div>
        </div>))}
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
            <div className="border-t pt-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{money(sub)}</span></div>
              {promo && <div className="flex justify-between text-emerald-700"><span>Promo {promo.code.toUpperCase()} ({promo.label.split('—').pop().trim()})</span><span>−{money(promoOff)}</span></div>}
              <div className="flex justify-between text-stone-500"><span>Est. tax</span><span>{money(net * tax)}</span></div><div className="flex justify-between font-semibold"><span>Total {pickup.payNow ? '(paid now)' : '(pay at pickup)'}</span><span>{money(grand)}</span></div></div>
          </div>
        )}
        <div className="mt-4 space-y-3">
          <Field label="Pick up at"><Select value={pickup.loc || locs[locs.length - 1]?.id || ''} onChange={(e) => setPickup({ ...pickup, loc: e.target.value })} options={locs.map((l) => ({ value: l.id, label: `${l.name} — ${l.address}` }))} /></Field>
          <Field label="Pickup date"><Input type="date" min={isoDate()} value={pickup.date} onChange={(e) => setPickup({ ...pickup, date: e.target.value })} /></Field>
          <label className="flex items-start gap-2 rounded-lg border border-stone-200 p-2.5 text-sm">
            <input type="checkbox" className="mt-0.5" checked={pickup.repeat} onChange={(e) => setPickup({ ...pickup, repeat: e.target.checked })} />
            <span><b>Repeat this order every month</b><span className="block text-xs text-stone-500">Same items, ready for pickup on day {repeatDay} of each month. Pay at pickup each time; pause or cancel anytime under "Repeat orders".</span></span>
          </label>
          <div>
            <div className="label">Promo code</div>
            {promo ? (
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><span><b>{promo.code.toUpperCase()}</b> applied — {promo.label}</span><button type="button" className="text-xs underline" onClick={() => { setPromo(null); setPromoText('') }}>Remove</button></div>
            ) : (
              <div className="flex gap-2"><Input placeholder="Enter code" value={promoText} onChange={(e) => setPromoText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPromo() } }} /><Button type="button" variant="secondary" onClick={applyPromo}>Apply</Button></div>
            )}
            {promoErr && <p className="mt-1 text-xs text-red-600">{promoErr}</p>}
            {promo && pickup.repeat && <p className="mt-1 text-[11px] text-stone-500">Promo applies to this first order only.</p>}
          </div>
          <div>
            <div className="label">Payment</div>
            <div className="grid grid-cols-2 gap-2">
              {[[false, 'Pay at pickup', 'Card or cash at the store'], [true, 'Pay now', 'Card online — faster pickup']].map(([v, l, s]) => (
                <button key={l} type="button" onClick={() => setPickup({ ...pickup, payNow: v })}
                  className={cx('rounded-lg border px-3 py-2 text-left', pickup.payNow === v ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-300' : 'border-stone-200 hover:bg-stone-50')}>
                  <div className="text-sm font-medium">{l}</div><div className="text-[11px] text-stone-500">{s}</div>
                </button>))}
            </div>
            {pickup.payNow && <p className="mt-1.5 text-[11px] text-stone-500">Demo store: no card is charged — the order is recorded as paid online.</p>}
          </div>
          <Button className="w-full" size="lg" disabled={!lines.length} loading={place.isPending} onClick={() => place.mutate()}>{pickup.payNow ? `Pay ${money(grand)} & place order` : 'Place pickup order'}</Button>
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
        { label: 'Payment', render: (o) => o.status === 'Cancelled' ? (Number(o.prepaid_amount) > 0 ? <Badge color="gray">Refunded</Badge> : '') : Number(o.prepaid_amount) > 0 || o.status === 'Closed' ? <Badge color="green">Paid</Badge> : <Badge color="amber">Pay at pickup</Badge> },
        { label: 'Total', num: true, render: (o) => money(o.total) },
        { label: '', render: (o) => o.status === 'Placed' && <Button size="sm" variant="ghost" onClick={() => confirm('Cancel this order?') && cancel.mutate(o.id)}>Cancel</Button> },
      ]} />
    </Card>
  )
}

function RepeatOrders() {
  const { data = [] } = useQuery({ queryKey: ['my_recurring'], queryFn: () => sel(supabase.from('recurring_orders').select('*, location:locations(name)').order('id')) })
  const items = useQuery({ queryKey: ['catalog'], queryFn: () => rpc('customer_catalog') }).data || []
  const name = (id) => items.find((i) => i.id === id)?.name || `Item ${id}`
  const price = (id) => Number(items.find((i) => i.id === id)?.price || 0)
  const upd = useAction((args) => rpc('update_recurring', args), { success: 'Repeat order updated' })
  return (
    <div className="space-y-3">
      {data.length === 0 && <Card><p className="py-6 text-center text-sm text-stone-500">No repeat orders yet. In the Shop, tick <b>"Repeat this order every month"</b> when you place an order.</p></Card>}
      {data.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-semibold">Every month on day {r.day_of_month} · {r.location?.name}</div>
              <div className="text-sm text-stone-600">{r.lines.map((l) => `${Number(l.qty)}× ${name(l.item_id)}`).join(', ')}</div>
              <div className="mt-1 text-xs text-stone-500">About {money(r.lines.reduce((s, l) => s + Number(l.qty) * price(l.item_id), 0))} + tax each month · pay at pickup</div>
            </div>
            <div className="text-right">
              {r.active ? <Badge color="green">Active</Badge> : <Badge color="gray">Paused</Badge>}
              <div className="mt-1 text-sm">Next pickup: <b>{r.active ? fmtDate(r.next_date) : '—'}</b></div>
              <div className="text-[11px] text-stone-400">Your order is created a week ahead so it's ready on time.</div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3 text-sm">
            <span className="text-stone-500">Change day:</span>
            <Select className="w-24 py-1" value={r.day_of_month} onChange={(e) => upd.mutate({ p_id: r.id, p_day: Number(e.target.value) })} options={Array.from({ length: 28 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))} />
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => upd.mutate({ p_id: r.id, p_active: !r.active })}>{r.active ? 'Pause' : 'Resume'}</Button>
              <Button size="sm" variant="ghost" onClick={() => confirm('Cancel this repeat order? Orders already created stay in My orders.') && upd.mutate({ p_id: r.id, p_cancel: true })}>Cancel repeat</Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
