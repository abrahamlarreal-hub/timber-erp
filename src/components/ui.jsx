import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import clsx from 'clsx'
import { X, CheckCircle2, AlertTriangle, Info, Loader2 } from 'lucide-react'

export const cx = clsx

export function Button({ variant = 'primary', size = 'md', className, loading, children, ...props }) {
  const styles = {
    primary: 'bg-brand-700 text-white hover:bg-brand-800 shadow-sm',
    secondary: 'bg-white text-stone-700 border border-stone-300 hover:bg-stone-50 shadow-sm',
    success: 'bg-pine-600 text-white hover:bg-pine-700 shadow-sm',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
    ghost: 'text-stone-600 hover:bg-stone-100',
    link: 'text-brand-700 hover:underline px-0 py-0',
  }
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-3.5 py-2 text-sm', lg: 'px-5 py-3 text-base' }
  return (
    <button
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant], variant !== 'link' && sizes[size], className)}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Card({ title, subtitle, actions, className, children, padded = true }) {
  return (
    <div className={cx('rounded-xl border border-stone-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <div>
            {title && <h3 className="text-sm font-semibold">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-stone-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </div>
  )
}

export function PageHeader({ title, subtitle, actions, icon: Icon }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        {Icon && <div className="rounded-xl bg-brand-100 p-2.5 text-brand-700"><Icon className="h-5 w-5" /></div>}
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-stone-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
    </div>
  )
}

const badgeColors = {
  gray: 'bg-stone-100 text-stone-700 ring-stone-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  brown: 'bg-brand-50 text-brand-700 ring-brand-200',
}
export function Badge({ color = 'gray', children, className }) {
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', badgeColors[color], className)}>{children}</span>
}

const STATUS_COLORS = {
  Placed: 'blue', Fulfilled: 'violet', Closed: 'green', Cancelled: 'gray',
  Draft: 'gray', Sent: 'blue', 'Partially Received': 'amber', Received: 'violet',
  Planned: 'gray', 'In Progress': 'amber', Completed: 'green',
  Keep: 'green', Watch: 'amber', Replace: 'red', New: 'gray',
  Overdue: 'red', 'Due soon': 'amber', Open: 'blue', 'Paid on time': 'green', 'Paid late': 'amber',
  Return: 'amber', Exchange: 'violet', Buy: 'blue', Build: 'brown',
}
export const StatusBadge = ({ status }) => <Badge color={STATUS_COLORS[status] || 'gray'}>{status}</Badge>

export function Stat({ label, value, sub, tone, icon: Icon, onClick }) {
  const tones = { good: 'text-emerald-700', bad: 'text-red-600', warn: 'text-amber-700' }
  return (
    <div onClick={onClick} className={cx('rounded-xl border border-stone-200 bg-white p-4 shadow-sm', onClick && 'cursor-pointer hover:border-brand-300')}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
        {Icon && <Icon className="h-4 w-4 text-stone-400" />}
      </div>
      <div className={cx('mt-1.5 text-2xl font-semibold tabular-nums', tones[tone])}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-stone-500">{sub}</div>}
    </div>
  )
}

export function Field({ label, hint, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  )
}

export const Input = (props) => <input {...props} className={cx('input', props.className)} />
export const Textarea = (props) => <textarea {...props} className={cx('input', props.className)} />
export function Select({ options = [], placeholder, className, ...props }) {
  return (
    <select {...props} className={cx('input pr-8', className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

export function Modal({ open, onClose, title, children, footer, wide, size }) {
  useEffect(() => {
    if (!open) return
    const h = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  const w = size === 'xl' ? 'max-w-5xl' : wide ? 'max-w-3xl' : 'max-w-lg'
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/40 p-4 pt-[6vh] backdrop-blur-[1px]" onMouseDown={onClose}>
      <div className={cx('w-full rounded-2xl bg-white shadow-2xl', w)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-stone-400 hover:bg-stone-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-stone-100 bg-stone-50 px-5 py-3 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  )
}

export function Table({ columns, rows, empty = 'Nothing to show', onRowClick, rowKey = 'id', footer, dense, maxHeight }) {
  return (
    <div className={cx('overflow-auto', maxHeight && 'relative')} style={maxHeight ? { maxHeight } : undefined}>
      <table className="min-w-full divide-y divide-stone-100">
        <thead className="sticky top-0 z-[1] bg-stone-50">
          <tr>{columns.map((c, i) => <th key={i} className={cx('th', c.num && 'text-right', c.className)}>{c.label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-stone-100 bg-white">
          {(!rows || rows.length === 0) && (
            <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-stone-400">{empty}</td></tr>
          )}
          {rows?.map((r, ri) => (
            <tr key={r[rowKey] ?? ri} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cx(onRowClick && 'cursor-pointer hover:bg-brand-50/50', r._rowClass)}>
              {columns.map((c, i) => (
                <td key={i} className={cx('td', dense && 'py-1.5', c.num && 'num', c.tdClass)}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot className="bg-stone-50 font-semibold">{footer}</tfoot>}
      </table>
    </div>
  )
}

export const Spinner = ({ label = 'Loading…' }) => (
  <div className="flex items-center justify-center gap-2 py-10 text-sm text-stone-500"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>
)

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-stone-200 no-print">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
            value === t.value ? 'border-brand-600 text-brand-800' : 'border-transparent text-stone-500 hover:text-stone-800')}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Explain({ title = 'How this is calculated', children }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-sky-100 bg-sky-50/60 text-sm text-sky-900">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left font-medium">
        <Info className="h-4 w-4" /> {title} <span className="ml-auto text-xs text-sky-600">{open ? 'hide' : 'show'}</span>
      </button>
      {open && <div className="space-y-1.5 px-3 pb-3 text-[13px] leading-relaxed">{children}</div>}
    </div>
  )
}

// ---------- toasts ----------
const ToastCtx = createContext(null)
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((kind, msg, ttl = 4500) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, kind, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl)
  }, [])
  const api = {
    success: (m) => push('success', m),
    error: (m) => push('error', m, 7000),
    info: (m) => push('info', m),
  }
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2 no-print">
        {toasts.map((t) => (
          <div key={t.id} className={cx('flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm shadow-lg',
            t.kind === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
            t.kind === 'error' && 'border-red-200 bg-red-50 text-red-900',
            t.kind === 'info' && 'border-stone-200 bg-white text-stone-800')}>
            {t.kind === 'success' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            {t.kind === 'error' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
            {t.kind === 'info' && <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

export function DateRange({ from, to, onChange, presets = true }) {
  const today = new Date()
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const set = (days) => { const f = new Date(today); f.setDate(f.getDate() - days + 1); onChange(iso(f), iso(today)) }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="date" className="input w-auto py-1.5" value={from} onChange={(e) => onChange(e.target.value, to)} />
      <span className="text-stone-400">to</span>
      <input type="date" className="input w-auto py-1.5" value={to} onChange={(e) => onChange(from, e.target.value)} />
      {presets && [['7D', 7], ['30D', 30], ['90D', 90], ['6M', 182]].map(([l, n]) => (
        <Button key={l} size="sm" variant="secondary" onClick={() => set(n)}>{l}</Button>
      ))}
    </div>
  )
}
