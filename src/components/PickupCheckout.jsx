import { useEffect, useMemo, useState } from 'react'
import { CreditCard, Banknote, PackageCheck } from 'lucide-react'
import { rpc } from '../lib/supabase'
import { useAction, useSettings, useInventory } from '../lib/hooks'
import { money, qty, fmtDate } from '../lib/format'
import { productImage } from '../lib/productArt'
import { Button, Modal, Input, Badge, cx } from './ui.jsx'
import { useOrder, ReceiptModal } from './Receipt.jsx'

// Customer collects a pickup order: adjust discounts, take Card/Cash, hand over.
export default function PickupCheckout({ orderId, onClose, onDone }) {
  const { data: o } = useOrder(orderId)
  const tax = Number(useSettings().data?.map.tax_rate || 0)
  const inv = useInventory().data || []
  const [lines, setLines] = useState({})
  const [disc, setDisc] = useState(0)
  const [receipt, setReceipt] = useState(null)
  useEffect(() => {
    if (o) { setLines(Object.fromEntries(o.lines.map((l) => [l.id, Number(l.discount_pct)]))); setDisc(Number(o.discount_pct)) }
  }, [o?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const prepaid = Number(o?.prepaid_amount || 0) > 0
  const t = useMemo(() => {
    if (!o) return null
    const gross = o.lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0)
    const afterLines = o.lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price) * (1 - Number(lines[l.id] || 0) / 100), 0)
    const net = afterLines * (1 - Number(disc || 0) / 100)
    const tx = Math.round(net * tax * 100) / 100
    return { gross, discount: gross - net, tx, total: net + tx }
  }, [o, lines, disc, tax])

  const pay = useAction((method) => rpc('checkout_pickup', {
    p_id: orderId, p_payment_method: method, p_discount_pct: Number(disc || 0),
    p_lines: Object.entries(lines).map(([id, d]) => ({ line_id: Number(id), discount_pct: Number(d || 0) })),
  }), { success: (_, m) => (m === 'Prepaid' ? 'Order handed over — it was already paid online' : `Paid by ${m.toLowerCase()} — order picked up`), onSuccess: (id) => setReceipt(id) })

  if (!orderId) return null
  if (receipt) return <ReceiptModal id={receipt} onClose={() => { setReceipt(null); onDone?.(); onClose() }} />
  const stockAt = (itemId) => Number(inv.find((r) => r.item_id === itemId && r.location_id === o?.location_id)?.qty || 0)
  const short = o?.lines.some((l) => stockAt(l.item_id) < Number(l.qty))

  return (
    <Modal open onClose={onClose} wide title={o ? `Pickup checkout — ${o.number}` : 'Pickup checkout'}
      footer={o && (prepaid ? (
        <Button size="lg" variant="success" disabled={short} loading={pay.isPending} onClick={() => pay.mutate('Prepaid')}><PackageCheck className="h-4 w-4" />Hand over order (paid online)</Button>
      ) : (<>
        <Button size="lg" variant="success" disabled={short} loading={pay.isPending} onClick={() => pay.mutate('Card')}><CreditCard className="h-4 w-4" />Card {money(t?.total)}</Button>
        <Button size="lg" variant="secondary" disabled={short} loading={pay.isPending} onClick={() => pay.mutate('Cash')}><Banknote className="h-4 w-4" />Cash {money(t?.total)}</Button>
      </>))}>
      {!o ? null : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div><b>{o.customer?.name}</b> · pickup at {o.location?.name} · requested {fmtDate(o.due_date)}</div>
            {prepaid ? <Badge color="green">Paid online {money(o.prepaid_amount)}</Badge> : <Badge color="amber">Pay at pickup</Badge>}
          </div>
          <div className="divide-y divide-stone-100 rounded-lg border border-stone-200">
            {o.lines.map((l) => {
              const d = Number(lines[l.id] || 0); const gross = Number(l.qty) * Number(l.unit_price); const have = stockAt(l.item_id)
              return (
                <div key={l.id} className="flex flex-wrap items-center gap-2 p-2">
                  <img src={productImage(l.item)} alt="" className="h-9 w-12 rounded object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{l.item.name}</div>
                    <div className={cx('text-xs', have < Number(l.qty) ? 'font-semibold text-red-600' : 'text-stone-500')}>{qty(l.qty)} × {money(l.unit_price)} · {qty(have)} on the shelf here{have < Number(l.qty) && ' — not enough, transfer stock first'}</div>
                  </div>
                  {!prepaid && (
                    <div className="flex items-center gap-1 text-xs">
                      {[0, 10, 15, 20].map((v) => (
                        <button key={v} onClick={() => setLines({ ...lines, [l.id]: v })} className={cx('rounded px-1.5 py-0.5', d === v ? 'bg-amber-600 text-white' : 'bg-white ring-1 ring-stone-200 hover:bg-amber-50')}>{v ? `${v}%` : 'None'}</button>))}
                      <input type="number" min="0" max="100" value={d} onChange={(e) => setLines({ ...lines, [l.id]: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} className="w-12 rounded border border-stone-300 px-1 py-0.5" />%
                    </div>
                  )}
                  <div className="w-20 text-right text-sm tabular-nums">
                    {d > 0 && <div className="text-[11px] text-stone-400 line-through">{money(gross)}</div>}
                    <div className="font-medium">{money(gross * (1 - d / 100))}</div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            {!prepaid ? (
              <label className="text-sm"><span className="label">Whole-order discount %</span><Input type="number" min="0" max="100" value={disc} onChange={(e) => setDisc(e.target.value)} className="w-28" /></label>
            ) : <p className="text-xs text-stone-500">Already paid online, so the price can't change here. Use Returns for any refund.</p>}
            <dl className="min-w-[220px] space-y-0.5 text-sm">
              <div className="flex justify-between"><dt className="text-stone-500">Subtotal</dt><dd className="tabular-nums">{money(t.gross)}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">Discounts</dt><dd className="tabular-nums">−{money(prepaid ? o.discount : t.discount)}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-500">Sales tax</dt><dd className="tabular-nums">{money(prepaid ? o.tax : t.tx)}</dd></div>
              <div className="flex justify-between border-t pt-1 text-base font-semibold"><dt>{prepaid ? 'Paid online' : 'Due now'}</dt><dd className="tabular-nums">{money(prepaid ? o.total : t.total)}</dd></div>
            </dl>
          </div>
        </div>
      )}
    </Modal>
  )
}
