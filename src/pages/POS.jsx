import { useMemo, useState } from 'react'
import { ShoppingCart, Minus, Plus, Trash2, CreditCard, Banknote } from 'lucide-react'
import { rpc } from '../lib/supabase'
import { useItems, useLocations, useCustomers, useInventory, useSettings, useAction } from '../lib/hooks'
import { money } from '../lib/format'
import { Button, Card, PageHeader, Select, Input, Field, Badge, cx } from '../components/ui.jsx'
import { ScanInput } from '../components/Barcode.jsx'
import { ReceiptModal } from '../components/Receipt.jsx'

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
  const [receipt, setReceipt] = useState(null)

  const stock = (id) => Number(inv.find((r) => r.item_id === id && r.location_id === locationId)?.qty || 0)
  const sellable = items.filter((i) => i.sellable && i.active && Number(i.price) > 0)
  const shown = sellable.filter((i) => !q || (i.name + i.sku).toLowerCase().includes(q.toLowerCase()))
  const add = (it) => setCart((c) => {
    const i = c.findIndex((l) => l.item_id === it.id)
    if (i >= 0) { const n = [...c]; n[i] = { ...n[i], qty: n[i].qty + 1 }; return n }
    return [...c, { item_id: it.id, qty: 1, unit_price: Number(it.price), discount_pct: 0 }]
  })
  const setQty = (id, v) => setCart((c) => c.map((l) => (l.item_id === id ? { ...l, qty: Math.max(0, v) } : l)).filter((l) => l.qty > 0))

  const t = useMemo(() => {
    const sub = cart.reduce((s, l) => s + l.qty * l.unit_price, 0)
    const d = sub * Number(disc || 0) / 100
    const tx = Math.round((sub - d) * tax * 100) / 100
    return { sub, d, tx, total: sub - d + tx }
  }, [cart, disc, tax])

  const checkout = useAction((method) => rpc('pos_checkout', {
    p_customer: cust ? Number(cust) : null, p_location: locationId, p_lines: cart, p_discount_pct: Number(disc || 0), p_payment_method: method,
  }), { success: 'Sale completed — inventory, revenue and COGS posted', onSuccess: (id) => { setReceipt(id); setCart([]); setDisc(0); setCust('') } })

  const byId = Object.fromEntries(items.map((i) => [i.id, i]))
  const short = cart.some((l) => l.qty > stock(l.item_id))
  return (
    <>
      <PageHeader icon={ShoppingCart} title="Point of Sale" subtitle="Scan or tap products. Completing a sale reduces inventory and records revenue and cost of goods sold."
        actions={<Select value={loc || retail?.id || ''} onChange={(e) => setLoc(e.target.value)} options={locs.filter((l) => l.kind !== 'quarantine').map((l) => ({ value: l.id, label: l.name }))} className="w-60" />} />
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-3 lg:col-span-3">
          <ScanInput items={sellable} onItem={add} autoFocus continuous captureGlobal placeholder="Scan barcode (USB scanner or camera) or type SKU + Enter" />
          <Input placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {shown.map((it) => {
              const s = stock(it.id)
              return (
                <button key={it.id} onClick={() => add(it)} disabled={s <= 0}
                  className={cx('rounded-xl border bg-white p-3 text-left shadow-sm transition hover:border-brand-400 hover:shadow disabled:opacity-40')}>
                  <div className="text-xs text-stone-500">{it.category}</div>
                  <div className="mt-0.5 line-clamp-2 min-h-[2.5rem] text-sm font-medium">{it.name}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-semibold">{money(it.price)}</span>
                    <Badge color={s <= 0 ? 'red' : s < 5 ? 'amber' : 'green'}>{s} here</Badge>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
        <Card className="lg:col-span-2 self-start lg:sticky lg:top-20" title={`Cart (${cart.reduce((s, l) => s + l.qty, 0)} items)`}>
          <div className="space-y-2">
            {cart.length === 0 && <p className="py-8 text-center text-sm text-stone-400">Scan an item to start a sale.</p>}
            {cart.map((l) => {
              const it = byId[l.item_id]; const over = l.qty > stock(l.item_id)
              return (
                <div key={l.item_id} className="flex items-center gap-2 rounded-lg border border-stone-100 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{it?.name}</div>
                    <div className={cx('text-xs', over ? 'text-red-600' : 'text-stone-500')}>{money(l.unit_price)} · {stock(l.item_id)} in stock{over && ' — not enough!'}</div>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setQty(l.item_id, l.qty - 1)}><Minus className="h-3 w-3" /></Button>
                  <span className="w-6 text-center text-sm tabular-nums">{l.qty}</span>
                  <Button size="sm" variant="secondary" onClick={() => setQty(l.item_id, l.qty + 1)}><Plus className="h-3 w-3" /></Button>
                  <span className="w-20 text-right text-sm font-medium tabular-nums">{money(l.qty * l.unit_price)}</span>
                  <button onClick={() => setQty(l.item_id, 0)} className="text-stone-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              )
            })}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Customer (optional)"><Select placeholder="Walk-in" value={cust} onChange={(e) => setCust(e.target.value)} options={customers.map((c) => ({ value: c.id, label: c.name }))} /></Field>
            <Field label="Discount %"><Input type="number" min="0" max="100" value={disc} onChange={(e) => setDisc(e.target.value)} /></Field>
          </div>
          <dl className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-stone-500">Subtotal</dt><dd className="tabular-nums">{money(t.sub)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Discount</dt><dd className="tabular-nums">−{money(t.d)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Sales tax ({(tax * 100).toFixed(2)}%)</dt><dd className="tabular-nums">{money(t.tx)}</dd></div>
            <div className="flex justify-between border-t border-stone-200 pt-2 text-lg font-semibold"><dt>Total</dt><dd className="tabular-nums">{money(t.total)}</dd></div>
          </dl>
          {short && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">Not enough stock at this location for one or more lines — transfer stock in or reduce the quantity.</p>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button size="lg" variant="success" disabled={!cart.length || short} loading={checkout.isPending} onClick={() => checkout.mutate('Card')}><CreditCard className="h-4 w-4" />Card</Button>
            <Button size="lg" variant="secondary" disabled={!cart.length || short} loading={checkout.isPending} onClick={() => checkout.mutate('Cash')}><Banknote className="h-4 w-4" />Cash</Button>
          </div>
        </Card>
      </div>
      <ReceiptModal id={receipt} onClose={() => setReceipt(null)} />
    </>
  )
}
