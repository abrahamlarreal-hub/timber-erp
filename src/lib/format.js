const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

export const money = (v) => (v === null || v === undefined || v === '' ? '—' : usd.format(Number(v)))
export const money0 = (v) => (v === null || v === undefined || v === '' ? '—' : usd0.format(Number(v)))
export const num = (v, d = 0) => {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  return n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : Math.min(d, 2), maximumFractionDigits: d })
}
export const qty = (v) => num(v, 2)
export const pct = (v, d = 1) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(d)}%`)

// dates: database dates are 'YYYY-MM-DD' (Mountain time business dates)
export const fmtDate = (d) => {
  if (!d) return '—'
  const dt = typeof d === 'string' && d.length === 10 ? new Date(d + 'T12:00:00') : new Date(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
export const fmtShort = (d) => {
  if (!d) return '—'
  const dt = typeof d === 'string' && d.length === 10 ? new Date(d + 'T12:00:00') : new Date(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')
export const isoDate = (dt = new Date()) => {
  const z = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
  return z.toISOString().slice(0, 10)
}
export const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDate(d)
}
export const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000)
