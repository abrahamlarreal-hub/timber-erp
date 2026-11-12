import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { supabase, sel } from '../lib/supabase'
import { money, fmtDateTime, qty } from '../lib/format'
import { Button, Modal, Spinner } from './ui.jsx'
import { BarcodeSvg } from './Barcode.jsx'

export function useOrder(id) {
  return useQuery({
    enabled: !!id,
    queryKey: ['order', id],
    queryFn: async () => {
      const o = await sel(supabase.from('sales_orders').select('*, customer:customers(*), location:locations(*), lines:sales_order_lines(*, item:items(sku,name,barcode,uom))').eq('id', id).single())
      o.lines.sort((a, b) => a.id - b.id)
      return o
    },
  })
}

export function ReceiptBody({ o }) {
  return (
    <div id="receipt" className="mx-auto max-w-xs font-mono text-[12px] leading-snug text-stone-900">
      <div className="text-center">
        <div className="text-sm font-bold">TIMPANOGOS TIMBER CO.</div>
        <div>{o.location?.name}</div><div>{o.location?.address}</div>
        <div className="mt-1">{fmtDateTime(o.fulfilled_at || o.order_date)}</div>
        <div>{o.number} · Cashier: {o.created_by_name}</div>
        {o.customer && <div>Customer: {o.customer.name}</div>}
      </div>
      <div className="my-2 border-t border-dashed border-stone-400" />
      {o.lines.map((l) => (
        <div key={l.id} className="mb-1">
          <div className="flex justify-between"><span className="truncate pr-2">{l.item.name}</span><span>{money(l.qty * l.unit_price)}</span></div>
          <div className="flex justify-between text-stone-500"><span>{qty(l.qty)} @ {money(l.unit_price)}{Number(l.discount_pct) > 0 && ` −${Number(l.discount_pct)}%`}</span>{Number(l.qty_returned) > 0 && <span>returned {qty(l.qty_returned)}</span>}</div>
        </div>
      ))}
      <div className="my-2 border-t border-dashed border-stone-400" />
      <div className="flex justify-between"><span>Subtotal</span><span>{money(o.subtotal)}</span></div>
      {Number(o.discount) > 0 && <div className="flex justify-between"><span>Discounts</span><span>−{money(o.discount)}</span></div>}
      <div className="flex justify-between"><span>Sales tax</span><span>{money(o.tax)}</span></div>
      <div className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{money(o.total)}</span></div>
      <div className="flex justify-between"><span>Paid ({o.payment_method || '—'})</span><span>{money(o.total)}</span></div>
      <div className="mt-2 flex justify-center"><BarcodeSvg value={o.number} height={34} width={1.3} fontSize={10} /></div>
      <div className="mt-1 text-center">Returns within 30 days with receipt.<br />Thank you for supporting local craft!</div>
    </div>
  )
}

export function ReceiptModal({ id, onClose }) {
  const { data: o, isLoading } = useOrder(id)
  const print = () => {
    const w = window.open('', 'receipt', 'width=420,height=700')
    w.document.write(`<html><head><title>${o.number}</title><style>body{font-family:ui-monospace,monospace;font-size:12px;margin:16px} .flex{display:flex;justify-content:space-between} .text-center{text-align:center}</style></head><body>${document.getElementById('receipt').innerHTML}</body></html>`)
    w.document.close(); w.focus(); w.print()
  }
  return (
    <Modal open={!!id} onClose={onClose} title="Receipt" footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={print} disabled={!o}><Printer className="h-4 w-4" />Print</Button></>}>
      {isLoading || !o ? <Spinner /> : <ReceiptBody o={o} />}
    </Modal>
  )
}
