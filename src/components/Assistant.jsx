import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles, X, Send, Zap, ListChecks, RotateCcw, CheckCircle2, Loader2, Info } from 'lucide-react'
import { supabase, rpc, sel } from '../lib/supabase'
import { useAction } from '../lib/hooks'
import { money, money0, num, fmtShort, isoDate, addDays } from '../lib/format'
import { Button, Badge, cx } from './ui.jsx'

// ---------- tiny markdown renderer (bold, bullets, headings, paragraphs) ----------
function Md({ text }) {
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={`${k}-${i}`}>{p.slice(2, -2)}</b> : <span key={`${k}-${i}`}>{p}</span>))
  const out = []; let list = null
  String(text || '').split('\n').forEach((raw, i) => {
    const line = raw.trimEnd()
    const m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/)
    if (m) { list = list || []; list.push(<li key={i}>{inline(m[1], i)}</li>); return }
    if (list) { out.push(<ul key={`u${i}`} className="my-1 list-disc space-y-0.5 pl-5">{list}</ul>); list = null }
    if (!line.trim()) return
    const h = line.match(/^#{1,4}\s+(.*)/)
    out.push(h ? <div key={i} className="mt-2 font-semibold">{inline(h[1], i)}</div> : <p key={i} className="my-1">{inline(line, i)}</p>)
  })
  if (list) out.push(<ul key="ulast" className="my-1 list-disc space-y-0.5 pl-5">{list}</ul>)
  return <div className="text-sm leading-relaxed">{out}</div>
}

// ---------- proposal card: nothing is created until a person approves ----------
function Proposal({ p }) {
  const nav = useNavigate()
  const [done, setDone] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const approve = useAction(() => rpc('create_suggested_orders', {
    p_lines: p.lines.map((l) => ({ item_id: l.item_id, qty: Number(l.qty), need_date: l.need_date })), p_source: 'Assistant',
  }), { success: 'Orders created', onSuccess: setDone })
  if (dismissed) return <p className="text-xs text-stone-400">Proposal dismissed.</p>
  return (
    <div className="mt-2 rounded-lg border border-brand-200 bg-brand-50/60 p-2.5 text-xs">
      <div className="mb-1 font-semibold text-brand-800">Proposed orders — needs your approval</div>
      {p.reason && <div className="mb-1.5 text-stone-600">{p.reason}</div>}
      <table className="w-full">
        <tbody>{p.lines.map((l, i) => (
          <tr key={i} className="border-t border-brand-100">
            <td className="py-1"><Badge color={l.action === 'Buy' ? 'blue' : 'brown'}>{l.action}</Badge></td>
            <td className="py-1 pl-1">{l.name}<div className="text-stone-500">{l.supplier}{l.need_date ? ` · need ${fmtShort(l.need_date)}` : ''}</div></td>
            <td className="py-1 text-right tabular-nums">{num(l.qty)} {l.uom}</td>
            <td className="py-1 pl-2 text-right tabular-nums text-stone-500">{money0(l.est_cost)}</td>
          </tr>))}
        </tbody>
      </table>
      {done ? (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Created:
          {[...done.purchase_orders, ...done.production_orders].map((n) => (
            <button key={n} className="underline" onClick={() => nav(n.startsWith('PO') ? '/purchasing' : '/production')}>{n}</button>))}
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button size="sm" loading={approve.isPending} onClick={() => approve.mutate()}><CheckCircle2 className="h-3.5 w-3.5" />Approve & create</Button>
          <Button size="sm" variant="secondary" onClick={() => setDismissed(true)}>Dismiss</Button>
        </div>
      )}
    </div>
  )
}

// ---------- Quick answers: rule-based, free, computed from live data ----------
const today = () => isoDate()
const QUICK = [
  {
    q: 'What needs my attention today?',
    run: async () => {
      const d = await rpc('dashboard')
      const order = { high: 0, medium: 1, low: 2 }
      const a = [...d.alerts].sort((x, y) => order[x.severity] - order[y.severity]).slice(0, 7)
      return { text: `**${d.alerts.filter((x) => x.severity === 'high').length} urgent** and **${d.alerts.filter((x) => x.severity === 'medium').length} for today**:\n${a.map((x) => `- ${x.title}`).join('\n')}` }
    },
  },
  {
    q: 'What should I reorder?',
    run: async () => {
      const rows = (await sel(supabase.from('v_inventory_policy').select('item_id,sku,name,uom,is_made,supplier_name,position,reorder_point,suggested_qty,unit_cost,order_by_date').eq('needs_reorder', true))) || []
      if (!rows.length) return { text: 'Nothing is at or below its reorder point right now.' }
      return {
        text: `**${rows.length} item(s)** are at or below their reorder point (position ≤ ROP). Suggested quantities are EOQ:\n${rows.map((r) => `- **${r.name}** — ${num(r.suggested_qty)} ${r.uom} (${r.is_made ? 'build' : r.supplier_name}); position ${num(r.position)} vs ROP ${r.reorder_point}`).join('\n')}`,
        proposal: { reason: 'Items at or below reorder point (continuous review, EOQ quantities).', lines: rows.map((r) => ({ item_id: r.item_id, sku: r.sku, name: r.name, uom: r.uom, qty: Number(r.suggested_qty), action: r.is_made ? 'Build' : 'Buy', supplier: r.is_made ? 'Orem Workshop' : r.supplier_name, est_cost: Number(r.suggested_qty) * Number(r.unit_cost), need_date: null })) },
      }
    },
  },
  {
    q: 'What does MRP say to buy or build?',
    run: async () => {
      const p = await rpc('mrp_plan', { p_weeks: 4 })
      if (!p.orders.length) return { text: 'MRP shows no shortages in the next 4 weeks — on-hand stock and open orders cover all confirmed sales orders.' }
      const late = p.orders.filter((o) => o.past_due)
      return {
        text: `MRP found **${p.orders.length} planned order(s)** for confirmed sales orders over the next 4 weeks${late.length ? `, **${late.length} already past their order-by date (expedite)**` : ''}:\n${p.orders.map((o) => `- ${o.action} **${num(o.qty)} ${o.uom} ${o.name}** — need ${fmtShort(o.need_date)}, order by ${fmtShort(o.order_by)}${o.past_due ? ' ⚠️' : ''}`).join('\n')}`,
        proposal: { reason: 'MRP planned orders (lot-for-lot, offset by lead time).', lines: p.orders.map((o) => ({ item_id: o.item_id, sku: o.sku, name: o.name, uom: o.uom, qty: Number(o.qty), action: o.action, supplier: o.supplier_name || 'Orem Workshop', est_cost: o.qty * o.unit_cost, need_date: o.need_date })) },
      }
    },
  },
  {
    q: "What's backordered and when will it be available?",
    run: async () => {
      const rows = (await sel(supabase.from('v_inventory_policy').select('name,uom,backordered_qty,backorder_eta,on_order').gt('backordered_qty', 0))) || []
      return { text: rows.length ? `**${rows.length} item(s)** can't cover orders that are due now:\n${rows.map((r) => `- **${r.name}** — ${num(r.backordered_qty)} ${r.uom} short, est. available **${fmtShort(r.backorder_eta)}** (${num(r.on_order)} on order)`).join('\n')}` : 'Nothing is backordered — all orders due now can be filled from stock.' }
    },
  },
  {
    q: 'Which purchase orders are late?',
    run: async () => {
      const rows = (await sel(supabase.from('purchase_orders').select('number,expected_date,supplier:suppliers(name)').in('status', ['Sent', 'Partially Received']).lt('expected_date', today()).order('expected_date'))) || []
      return { text: rows.length ? `**${rows.length} PO(s)** are past their expected date:\n${rows.map((r) => `- **${r.number}** from ${r.supplier.name} — expected ${fmtShort(r.expected_date)}`).join('\n')}\nCall the supplier to expedite; late deliveries also lower their scorecard.` : 'No purchase orders are late. 👍' }
    },
  },
  {
    q: 'Which suppliers should we watch or replace?',
    run: async () => {
      const rows = (await sel(supabase.from('v_supplier_scorecard').select('name,score,rating,on_time_pct,fill_pct,avg_actual_lead,quoted_lead_days').order('score'))) || []
      const bad = rows.filter((r) => r.rating === 'Replace' || r.rating === 'Watch')
      return { text: bad.length ? bad.map((r) => `- **${r.name}** — ${r.rating} (score ${r.score}): on-time ${num(r.on_time_pct, 1)}%, fill ${num(r.fill_pct, 1)}%, lead time ${num(r.avg_actual_lead, 1)}d vs ${r.quoted_lead_days}d quoted`).join('\n') : 'All suppliers are rated Keep.' }
    },
  },
  {
    q: 'How are sales this month vs last month?',
    run: async () => {
      const t = today(); const first = t.slice(0, 8) + '01'
      const lmFirst = addDays(first, -1).slice(0, 8) + '01'; const day = Number(t.slice(8))
      const lmSame = addDays(lmFirst, day - 1)
      const [a, b] = await Promise.all([rpc('sales_report', { p_from: first, p_to: t, p_grain: 'month' }), rpc('sales_report', { p_from: lmFirst, p_to: lmSame, p_grain: 'month' })])
      const sum = (r) => r.series.reduce((s, x) => s + Number(x.net_sales), 0)
      const gp = (r) => r.series.reduce((s, x) => s + Number(x.gross_profit), 0)
      const x = sum(a), y = sum(b)
      return { text: `Month to date (${day} days): **${money0(x)}** net sales, **${money0(gp(a))}** gross profit.\nSame period last month: **${money0(y)}** → ${y ? `**${num(((x - y) / y) * 100, 0)}%** ${x >= y ? 'up' : 'down'}` : 'n/a'}.\nTop sellers this month:\n${a.top_items.slice(0, 3).map((i) => `- ${i.name} — ${money0(i.revenue)}`).join('\n')}` }
    },
  },
  {
    q: "What's our cash outlook?",
    run: async () => {
      const f = await rpc('cash_forecast', { p_weeks: 8 })
      const last = f.weeks[f.weeks.length - 1]
      return { text: `Cash today **${money0(f.opening_cash)}**. Projected in 8 weeks: **${money0(last.ending)}**; lowest point **${money0(f.lowest_balance)}**${f.lowest_week ? ` (week ${f.lowest_week})` : ''}.\n- Customers owe us ${money0(f.receivables_open)}\n- We owe suppliers ${money0(f.payables_open)}\n- Payroll about ${money0(f.assumptions.weekly_payroll)}/week` }
    },
  },
  {
    q: 'How is production quality (last 30 days)?',
    run: async () => {
      const r = await rpc('production_report', { p_from: addDays(today(), -29), p_to: today() })
      const m = r.metrics || {}
      const top = (r.by_reason || []).sort((a, b) => b.scrap_cost - a.scrap_cost)[0]
      return { text: `${m.orders_completed} orders completed, **${num(m.units_good)} good units**.\n- Yield **${num(m.yield_pct, 1)}%**, first-pass yield ${num(m.first_pass_yield_pct, 1)}%\n- Scrap rate **${num(m.scrap_rate_pct, 2)}%** (${money(m.scrap_cost)})\n- On-time completion ${num(m.on_time_pct, 0)}%, avg cycle ${num(m.avg_cycle_hours, 1)} h${top ? `\nBiggest quality issue: **${top.reason}** (${top.description}).` : ''}` }
    },
  },
]

const STARTERS = [
  'What needs my attention today, and what should I do first?',
  'Plan purchasing and production for all confirmed orders. Propose the orders.',
  'Why is the gift set backordered and when can we fill it?',
  'Which supplier should we replace, and what would it cost us to keep them?',
  'Can we afford to buy everything MRP suggests this month?',
]

export default function Assistant() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('quick')
  const [msgs, setMsgs] = useState([]) // {role:'user'|'assistant', text, proposal(s), kind, tools}
  const [history, setHistory] = useState([]) // exact API history for AI follow-ups
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [aiStatus, setAiStatus] = useState(null) // null | 'not_configured' | 'ok'
  const end = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  const quick = async (item) => {
    setMsgs((m) => [...m, { role: 'user', text: item.q, kind: 'quick' }]); setBusy(true)
    try { const r = await item.run(); setMsgs((m) => [...m, { role: 'assistant', kind: 'quick', text: r.text, proposals: r.proposal ? [r.proposal] : [] }]) }
    catch (e) { setMsgs((m) => [...m, { role: 'assistant', kind: 'error', text: e.message }]) }
    setBusy(false)
  }

  const ask = async (question) => {
    const qText = question.trim(); if (!qText || busy) return
    setInput(''); setMsgs((m) => [...m, { role: 'user', text: qText, kind: 'ai' }]); setBusy(true)
    const { data, error } = await supabase.functions.invoke('ask-timber', { body: { question: qText, history } })
    setBusy(false)
    if (error) {
      let info = { message: error.message }
      try { info = await error.context.json() } catch { /* not JSON */ }
      if (info.error === 'not_configured' || error.context?.status === 404) setAiStatus('not_configured')
      setMsgs((m) => [...m, { role: 'assistant', kind: 'error', text: info.error === 'not_configured' || error.context?.status === 404
        ? 'AI mode isn\'t switched on yet — it needs an Anthropic API key (see About / Tech Stack → "Turn on AI mode"). Quick answers work without it.'
        : info.message || 'The assistant had a problem. Try again.' }])
      return
    }
    setAiStatus('ok')
    setHistory(data.history || [])
    setMsgs((m) => [...m, { role: 'assistant', kind: 'ai', text: data.answer, proposals: data.proposals || [], tools: [...new Set(data.tools || [])] }])
  }

  const reset = () => { setMsgs([]); setHistory([]) }
  const TOOL_LABEL = { get_overview: 'Action Center', get_inventory_status: 'inventory policy', get_stock_by_location: 'stock by location', get_mrp_plan: 'MRP', get_supplier_scorecard: 'supplier scorecard', get_open_purchase_orders: 'purchase orders', get_open_sales_orders: 'sales orders', get_financials: 'P&L', get_cash_forecast: 'cash forecast', get_sales_report: 'sales report', get_demand_history: 'demand history', get_production: 'production', propose_orders: 'order proposal' }

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} className="no-print fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-brand-800 px-4 py-3 text-sm font-medium text-white shadow-xl hover:bg-brand-900">
          <Sparkles className="h-4 w-4" />Ask Timber
        </button>
      )}
      {open && (
        <div className="no-print fixed inset-y-0 right-0 z-50 flex w-full max-w-[440px] flex-col border-l border-stone-200 bg-white shadow-2xl">
          <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-3">
            <div className="rounded-lg bg-brand-100 p-1.5 text-brand-700"><Sparkles className="h-4 w-4" /></div>
            <div className="flex-1"><div className="text-sm font-semibold">Ask Timber</div><div className="text-[11px] text-stone-500">Answers from live ERP data</div></div>
            <button title="New conversation" onClick={reset} className="rounded p-1.5 text-stone-400 hover:bg-stone-100"><RotateCcw className="h-4 w-4" /></button>
            <button onClick={() => setOpen(false)} className="rounded p-1.5 text-stone-400 hover:bg-stone-100"><X className="h-5 w-5" /></button>
          </div>
          <div className="grid grid-cols-2 gap-1 border-b border-stone-100 p-2">
            {[['quick', 'Quick answers', 'Free · rule-based', ListChecks], ['ai', 'Ask AI', 'Claude Opus 5.5 · any question', Zap]].map(([k, l, s, Icon]) => (
              <button key={k} onClick={() => setMode(k)} className={cx('rounded-lg px-3 py-2 text-left', mode === k ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-stone-50')}>
                <div className="flex items-center gap-1.5 text-sm font-medium"><Icon className="h-3.5 w-3.5" />{l}</div><div className="text-[11px] text-stone-500">{s}</div>
              </button>))}
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {msgs.length === 0 && (mode === 'quick' ? (
              <p className="text-xs text-stone-500">Pick a question. Each answer is computed instantly from the database with fixed rules — no AI, no cost.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-stone-500">Ask anything about the business in plain English. The AI looks up live data with read-only tools and can <b>propose</b> purchase/production orders — nothing is created until you approve.</p>
                {aiStatus === 'not_configured' && <p className="flex gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-800"><Info className="h-3.5 w-3.5 shrink-0" />AI mode needs an Anthropic API key — see About / Tech Stack.</p>}
                {STARTERS.map((s) => <button key={s} onClick={() => ask(s)} className="block w-full rounded-lg border border-stone-200 px-3 py-2 text-left text-xs hover:border-brand-300 hover:bg-brand-50">{s}</button>)}
              </div>
            ))}
            {msgs.map((m, i) => m.role === 'user' ? (
              <div key={i} className="ml-8 rounded-xl rounded-br-sm bg-brand-700 px-3 py-2 text-sm text-white">{m.text}</div>
            ) : (
              <div key={i} className={cx('mr-4 rounded-xl rounded-bl-sm px-3 py-2', m.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-stone-100')}>
                {m.kind === 'error' ? <p className="text-sm">{m.text}</p> : <Md text={m.text} />}
                {m.proposals?.map((p, j) => <Proposal key={j} p={p} />)}
                {m.kind !== 'error' && <div className="mt-1.5 text-[10px] text-stone-400">{m.kind === 'quick' ? 'Rule-based answer · computed from live data' : `AI answer · looked at: ${(m.tools || []).map((t) => TOOL_LABEL[t] || t).join(', ') || 'no tools'}`}</div>}
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 text-xs text-stone-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />{mode === 'ai' ? 'Checking the ERP…' : 'Calculating…'}</div>}
            <div ref={end} />
          </div>

          {mode === 'quick' ? (
            <div className="max-h-56 space-y-1 overflow-y-auto border-t border-stone-100 p-2">
              {QUICK.map((it) => <button key={it.q} disabled={busy} onClick={() => quick(it)} className="block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-brand-50 disabled:opacity-50">{it.q}</button>)}
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); ask(input) }} className="flex gap-2 border-t border-stone-100 p-3">
              <input className="input" placeholder="Ask about inventory, MRP, suppliers, cash…" value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} />
              <Button disabled={busy || !input.trim()}><Send className="h-4 w-4" /></Button>
            </form>
          )}
        </div>
      )}
    </>
  )
}
