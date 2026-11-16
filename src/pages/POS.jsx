import { useMemo, useState } from 'react'
import { ShoppingCart, Minus, Plus, Trash2, CreditCard, Banknote, Store, Percent } from 'lucide-react'
import { rpc } from '../lib/supabase'
import { useItems, useLocations, useCustomers, useInventory, useSettings, useAction } from '../lib/hooks'
import { money, isoDate, addDays, fmtDate } from '../lib/format'
import { Button, Card, PageHeader, Select, Input, Field, Badge, Modal, cx } from '../components/ui.jsx'
import { useNavigate } from 'react-router-dom'
import { ScanInput } from '../components/Barcode.jsx'
import { productImage } from '../lib/productArt'
import { ReceiptModal } from '../components/Receipt.jsx'
import PickupCheckout from '../components/PickupCheckout.jsx'
import { useQuery } from '@tanstack/react-query'
import { supabase, sel } from '../lib/supabase'

export default function POS() {
  const items = useItems().data || []
  const locs = useLocations().data || []
  const customers = useCustomers().data || []
  const inv = useInventory().data || []
  const tax = Number(useSettings().data?.map.tax_rate || 0)
  const retail = locs.find((l) => l.kind === 'retail')
  const [loc, setLoc] = useState('')
  const locationId = Number(loc || retail?.id)
  const [cart, setCart] = useState([])
  const [disc, setDisc] = useState(0)
  const [cust, setCust] = useState('')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [pickup, setPickup] = useState(null) // {date}
  const [discOpen, setDiscOpen] = useState(null) // item_id with discount editor open
  const nav = useNavigate()
  const [pickList, setPickList] = useState(false)
  const [pickOrder, setPickOrder] = useState(null)
  const pickups = useQuery({
    enabled: !!locationId, queryKey: ['pickups', locationId],
    queryFn: () => sel(supabase.from('sales_orders').select('id, number, due_date, total, prepaid_amount, payment_method, source, customer:customers(name), lines:sales_order_lines(qty, item:items(name))')
      .eq('status', 'Placed').eq('location_id', locationId).or('source.eq.WEB,payment_method.eq."Pay at pickup",prepaid_amount.gt.0').order('due_date')),
  }).data || []
  const [pq, setPq] = useState('')

  const stock = (id) => Number(inv.find((r) => r.item_id === id && r.location_id === locationId)?.qty || 0)
  const sellable = items.filter((i) => i.sellable && i.active && Number(i.price) > 0)
  const cats = [...new Set(sellable.map((i) => i.category))].sort()
  const shown = sellable.filter((i) => (!q || (i.name + i.sku).toLowerCase().includes(q.toLowerCase())) && (!cat || i.category === cat))
  const groups = cats.filter((c) => shown.some((i) => i.category === c))
  const add = (it) => setCart((c) => {
    const i = c.findIndex((l) => l.item_id === it.id)
    if (i >= 0) { const n = [...c]; n[i] = { ...n[i], qty: n[i].qty + 1 }; return n }
    return [...c, { item_id: it.id, qty: 1, unit_price: Number(it.price), discount_pct: 0 }]
  })
  const setQty = (id, v) => setCart((c) => c.map((l) => (l.item_id === id ? { ...l, qty: Math.max(0, v) } : l)).filter((l) => l.qty > 0))
  const setLineDisc = (id, v) => setCart((c) => c.map((l) => (l.item_id === id ? { ...l, discount_pct: Math.min(100, Math.max(0, Number(v) || 0)) } : l)))
  const lineNet = (l) => l.qty * l.unit_price * (1 - Number(l.discount_pct || 0) / 100)

  const t = useMemo(() => {
    const sub = cart.reduce((s, l) => s + l.qty * l.unit_price, 0)
    const afterLines = cart.reduce((s, l) => s + lineNet(l), 0)
    const lineD = sub - afterLines
    const orderD = afterLines * Number(disc || 0) / 100
    const net = afterLines - orderD
    const tx = Math.round(net * tax * 100) / 100
    return { sub, lineD, orderD, d: lineD + orderD, tx, total: net + tx }
  }, [cart, disc, tax])

  const checkout = useAction((method) => rpc('pos_checkout', {
    p_customer: cust ? Number(cust) : null, p_location: locationId, p_lines: cart, p_discount_pct: Number(disc || 0), p_payment_method: method,
  }), { success: 'Sale completed — inventory, revenue and COGS posted', onSuccess: (id) => { setReceipt(id); setCart([]); setDisc(0); setCust('') } })
  const reserve = useAction(() => rpc('pos_reserve_for_pickup', {
    p_customer: Number(cust), p_location: locationId, p_lines: cart, p_discount_pct: Number(disc || 0), p_pickup: pickup.date,
  }), { success: 'Reserved for pickup — the customer pays when they collect it', onSuccess: (id) => { setPickup(null); setCart([]); setDisc(0); setCust(''); nav(`/sales/${id}`) } })

  const byId = Object.fromEntries(items.map((i) => [i.id, i]))
  const short = cart.some((l) => l.qty > stock(l.item_id))
  return (
    <>
      <PageHeader icon={ShoppingCart} title="Point of Sale" subtitle="Scan or tap products. Completing a sale reduces inventory and records revenue and cost of goods sold."
        actions={<><Button variant="secondary" onClick={() => setPickList(true)}><Store className="h-4 w-4" />Pickups waiting <Badge color={pickups.length ? 'amber' : 'gray'}>{pickups.length}</Badge></Button><Select value={loc || retail?.id || ''} onChange={(e) => setLoc(e.target.value)} options={locs.filter((l) => l.kind !== 'quarantine').map((l) => ({ value: l.id, label: l.name }))} className="w-60" /></>} />
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          <ScanInput items={sellable} onItem={add} autoFocus continuous captureGlobal placeholder="Scan barcode (USB scanner or camera) or type SKU + Enter" />
          <div className="flex gap-2">
            <Input placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select className="w-52" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="All product groups"
              options={cats.map((c) => ({ value: c, label: `${c} (${sellable.filter((i) => i.category === c).length})` }))} />
          </div>
          {groups.map((g) => (<div key={g}>
          <div className="mb-1.5 mt-2 text-xs font-semibold uppercase tracking-wider text-stone-500">{g}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {shown.filter((i) => i.category === g).map((it) => {
              const s = stock(it.id)
              return (
                <button key={it.id} onClick={() => add(it)} disabled={s <= 0}
                  className={cx('overflow-hidden rounded-xl border bg-white text-left shadow-sm transition hover:border-brand-400 hover:shadow disabled:opacity-40')}>
                  <img src={productImage(it)} alt="" className="h-24 w-full object-cover" />
                  <div className="p-3 pt-2">
                  <div className="mt-0.5 line-clamp-2 min-h-[2.5rem] text-sm font-medium">{it.name}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-semibold">{money(it.price)}</span>
                    <Badge color={s <= 0 ? 'red' : s < 5 ? 'amber' : 'green'}>{s} here</Badge>
                  </div>
                  </div>
                </button>
              )
            })}
          </div>
          </div>))}
        </div>
        <Card className="lg:col-span-2 self-start lg:sticky lg:top-20" title={`Cart (${cart.reduce((s, l) => s + l.qty, 0)} items)`}>
          <div className="space-y-2">
            {cart.length === 0 && <p className="py-8 text-center text-sm text-stone-400">Scan an item to start a sale.</p>}
            {cart.map((l) => {
              const it = byId[l.item_id]; const over = l.qty > stock(l.item_id)
              return (
                <div key={l.item_id}>
                <div className="flex items-center gap-2 rounded-lg border border-stone-100 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><img src={productImage(it)} alt="" className="h-8 w-10 shrink-0 rounded object-cover" /><div className="truncate text-sm font-medium">{it?.name}</div></div>
                    <div className={cx('text-xs', over ? 'text-red-600' : 'text-stone-500')}>{money(l.unit_price)} · {stock(l.item_id)} in stock{over && ' — not enough!'}</div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setQty(l.item_id, l.qty - 1)}><Minus className="h-3 w-3" /></Button>
                  <span className="w-6 text-center text-sm tabular-nums">{l.qty}</span>
                  <Button size="sm" variant="secondary" onClick={() => setQty(l.item_id, l.qty + 1)}><Plus className="h-3 w-3" /></Button>
                  <div className="w-20 text-right tabular-nums">
                    {Number(l.discount_pct) > 0 && <div className="text-[11px] text-stone-400 line-through">{money(l.qty * l.unit_price)}</div>}
                    <div className="text-sm font-medium">{money(lineNet(l))}</div>
                  </div>
                  <button title="Discount this item" onClick={() => setDiscOpen(discOpen === l.item_id ? null : l.item_id)} className={cx('rounded p-1', Number(l.discount_pct) > 0 ? 'bg-amber-100 text-amber-800' : 'text-stone-400 hover:text-brand-700')}><Percent className="h-4 w-4" /></button>
                  <button onClick={() => setQty(l.item_id, 0)} className="text-stone-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
                {(discOpen === l.item_id || Number(l.discount_pct) > 0) && (
                  <div className="-mt-1 flex flex-wrap items-center gap-1.5 rounded-b-lg border border-t-0 border-stone-100 bg-amber-50/50 px-2 py-1.5 text-xs">
                    <span className="text-stone-600">Item discount:</span>
                    {[0, 10, 15, 20, 25].map((v) => (
                      <button key={v} onClick={() => setLineDisc(l.item_id, v)} className={cx('rounded px-1.5 py-0.5', Number(l.discount_pct) === v ? 'bg-amber-600 text-white' : 'bg-white ring-1 ring-stone-200 hover:bg-amber-100')}>{v === 0 ? 'None' : `${v}%`}</button>))}
                    <input type="number" min="0" max="100" value={l.discount_pct} onChange={(e) => setLineDisc(l.item_id, e.target.value)} className="w-14 rounded border border-stone-300 px-1 py-0.5" />%
                    {Number(l.discount_pct) > 0 && <span className="ml-auto text-amber-800">−{money(l.qty * l.unit_price - lineNet(l))}</span>}
                  </div>
                )}
                </div>
              )
            })}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Customer (optional)"><Select placeholder="Walk-in" value={cust} onChange={(e) => setCust(e.target.value)} options={customers.map((c) => ({ value: c.id, label: c.name }))} /></Field>
            <Field label="Whole-order discount %"><Input type="number" min="0" max="100" value={disc} onChange={(e) => setDisc(e.target.value)} /></Field>
          </div>
          <dl className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-stone-500">Subtotal</dt><dd className="tabular-nums">{money(t.sub)}</dd></div>
            {t.lineD > 0.004 && <div className="flex justify-between"><dt className="text-stone-500">Item discounts</dt><dd className="tabular-nums">−{money(t.lineD)}</dd></div>}
            <div className="flex justify-between"><dt className="text-stone-500">{t.lineD > 0.004 ? 'Order discount' : 'Discount'}</dt><dd className="tabular-nums">−{money(t.orderD)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Sales tax ({(tax * 100).toFixed(2)}%)</dt><dd className="tabular-nums">{money(t.tx)}</dd></div>
            <div className="flex justify-between border-t border-stone-200 pt-2 text-lg font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(t.total)}</dd></div>
          </dl>
          {short && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">Not enough stock at this location for one or more lines — transfer stock in or reduce the quantity.</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button size="lg" variant="success" disabled={!cart.length || short} loading={checkout.isPending} onClick={() => checkout.mutate('Card')}><CreditCard className="h-4 w-4" />Card</Button>
            <Button size="lg" variant="secondary" disabled={!cart.length || short} loading={checkout.isPending} onClick={() => checkout.mutate('Cash')}><Banknote className="h-4 w-4" />Cash</Button>
            <Button className="col-span-2" variant="secondary" disabled={!cart.length} onClick={() => setPickup({ date: addDays(isoDate(), 1) })}><Store className="h-4 w-4" />Pay at pickup (reserve for later)</Button>
          </div>
        </Card>
      </div>
      <ReceiptModal id={receipt} onClose={() => setReceipt(null)} />
      <Modal open={pickList} onClose={() => setPickList(false)} title={`Pickups waiting at ${locs.find((l) => l.id === locationId)?.name || ''}`} wide>
        <Input placeholder="Search customer or order number…" value={pq} onChange={(e) => setPq(e.target.value)} className="mb-3" autoFocus />
        {pickups.filter((o) => !pq || `${o.number} ${o.customer?.name}`.toLowerCase().includes(pq.toLowerCase())).map((o) => (
          <button key={o.id} onClick={() => { setPickList(false); setPickOrder(o.id) }} className="mb-2 flex w-full items-center gap-3 rounded-lg border border-stone-200 p-3 text-left hover:border-brand-400 hover:bg-brand-50">
            <div className="flex-1">
              <div className="font-medium">{o.customer?.name} <span className="text-xs text-stone-500">· {o.number} · for {fmtDate(o.due_date)}</span></div>
              <div className="text-xs text-stone-500">{o.lines.map((l) => `${Number(l.qty)}× ${l.item.name}`).join(', ')}</div>
            </div>
            {Number(o.prepaid_amount) > 0 ? <Badge color="green">Paid online</Badge> : <Badge color="amber">Due {money(o.total)}</Badge>}
          </button>))}
        {pickups.length === 0 && <p className="py-6 text-center text-sm text-stone-400">No pickup orders waiting at this location.</p>}
      </Modal>
      {pickOrder && <PickupCheckout orderId={pickOrder} onClose={() => setPickOrder(null)} />}
      <Modal open={!!pickup} onClose={() => setPickup(null)} title="Reserve for pickup — pay later"
        footer={<><Button variant="secondary" onClick={() => setPickup(null)}>Cancel</Button><Button disabled={!cust} loading={reserve.isPending} onClick={() => reserve.mutate()}>Reserve {money(t.total)}</Button></>}>
        <div className="space-y-3 text-sm">
          <p className="text-stone-600">Creates a pickup order instead of a sale. Nothing is charged now. Inventory and revenue post when the customer collects it; their payment is recorded then.</p>
          <Field label="Customer (required)"><Select placeholder="Choose…" value={cust} onChange={(e) => setCust(e.target.value)} options={customers.map((c) => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="Pickup date"><Input type="date" min={isoDate()} value={pickup?.date || ''} onChange={(e) => setPickup({ date: e.target.value })} /></Field>
          <p className="text-xs text-stone-500">Pickup at {locs.find((l) => l.id === locationId)?.name} on {fmtDate(pickup?.date)}. Total due at pickup {money(t.total)}.</p>
        </div>
      </Modal>
    </>
  )
}
