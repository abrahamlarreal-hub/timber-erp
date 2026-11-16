// Demand forecasting — pure functions so every number is reproducible from
// the weekly history pulled from the database.

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)

// Each model: fit(history, params) -> { next(h) } giving the forecast h weeks ahead
export const MODELS = {
  ma: {
    label: 'Moving average', short: 'Moving avg',
    fit: (y, p) => { const n = Math.max(1, Math.min(p.n, y.length)); const v = mean(y.slice(-n)); return { next: () => v } },
  },
  ses: {
    label: 'Exponential smoothing', short: 'Exp. smoothing',
    fit: (y, p) => { let l = y[0] ?? 0; for (let t = 1; t < y.length; t++) l = p.alpha * y[t] + (1 - p.alpha) * l; return { next: () => l } },
  },
  seasonal: {
    label: 'Seasonal (wedding & holiday calendar)', short: 'Seasonal',
    // remove the seasonal calendar from history, smooth the underlying level, then put the calendar back on future weeks
    fit: (y, p) => {
      const idx = (iso) => { if (!iso || !p.season) return 1; const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + 3); return Number(p.season[d.getMonth()]) || 1 }
      const wk = p.weekStarts || []
      const ds = y.map((v, t) => v / idx(wk[t]))
      let l = mean(ds.slice(0, 4)); for (let t = 4; t < ds.length; t++) l = p.alpha * ds[t] + (1 - p.alpha) * l
      const last = wk[y.length - 1]
      return { next: (h) => { if (!last) return l; const d = new Date(last + 'T12:00:00'); d.setDate(d.getDate() + 7 * h); return l * idx(d.toISOString().slice(0, 10)) } }
    },
  },
  holt: {
    label: 'Trend (Holt)', short: 'Trend',
    fit: (y, p) => {
      if (y.length < 8) { const v = mean(y); return { next: () => v } }
      let l = mean(y.slice(0, 4)); let b = (mean(y.slice(4, 8)) - l) / 4
      for (let t = 4; t < y.length; t++) {
        const prev = l
        l = p.alpha * y[t] + (1 - p.alpha) * (l + b)
        b = p.beta * (l - prev) + (1 - p.beta) * b
      }
      return { next: (h) => l + h * b, trend: b }
    },
  },
}

// One-step-ahead back-test over the last `k` weeks: for each week, fit on
// everything before it and compare the forecast with what actually happened.
export function backtest(y, model, p, k = 8) {
  const errs = []; const fitted = []
  for (let t = Math.max(8, y.length - k); t < y.length; t++) {
    const f = Math.max(0, MODELS[model].fit(y.slice(0, t), p).next(1))
    fitted.push({ t, f })
    errs.push({ a: y[t], e: y[t] - f })
  }
  const mad = mean(errs.map((x) => Math.abs(x.e)))
  const rmse = Math.sqrt(mean(errs.map((x) => x.e * x.e)))
  const nz = errs.filter((x) => x.a > 0)
  const mape = nz.length ? mean(nz.map((x) => Math.abs(x.e) / x.a)) * 100 : null
  const bias = mean(errs.map((x) => -x.e)) // + = forecast too high
  return { mad, rmse, mape, bias, fitted }
}

export function forecastItem(y, { method = 'auto', horizon = 8, params }) {
  const candidates = method === 'auto' ? Object.keys(MODELS) : [method]
  const scored = candidates.map((m) => ({ m, bt: backtest(y, m, params) })).sort((a, b) => a.bt.mad - b.bt.mad)
  const best = scored[0]
  const fit = MODELS[best.m].fit(y, params)
  const fc = Array.from({ length: horizon }, (_, i) => Math.max(0, fit.next(i + 1)))
  const recent = mean(y.slice(-4)); const prior = mean(y.slice(-8, -4))
  return {
    method: best.m, ...best.bt, forecast: fc, total: fc.reduce((s, x) => s + x, 0),
    weekly: mean(fc.slice(0, 4)), recent, change: prior > 0 ? ((recent - prior) / prior) * 100 : null,
    // 80% prediction interval from back-test error
    band: 1.28 * best.bt.rmse,
    accuracy: best.bt.mape == null ? null : Math.max(0, 100 - best.bt.mape),
  }
}
