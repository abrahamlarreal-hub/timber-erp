import { useState } from 'react'
import { useAuth } from '../lib/auth.jsx'
import { Button, Field, Input } from '../components/ui.jsx'

const DEMO = [
  ['Manager', 'manager@timpanogostimber.com'],
  ['Sales associate', 'sales@timpanogostimber.com'],
  ['Production lead', 'shop@timpanogostimber.com'],
  ['Customer', 'emily.carter@example.com'],
]

export default function Login() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('in')
  const [f, setF] = useState({ email: '', password: '', full_name: '', phone: '', access_code: '' })
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault(); setErr(null); setMsg(null); setBusy(true)
    const res = mode === 'in'
      ? await signIn(f.email, f.password)
      : await signUp(f.email, f.password, { full_name: f.full_name, phone: f.phone, access_code: f.access_code || undefined })
    setBusy(false)
    if (res.error) setErr(res.error.message.includes('Database error') ? 'Sign-up failed — check the employee access code (leave blank for a customer account).' : res.error.message)
    else if (mode === 'up' && !res.data.session) setMsg('Account created. Check your email to confirm, then sign in.')
  }

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-1/2 flex-col justify-between bg-brand-900 p-12 text-brand-100 lg:flex"
           style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(194,164,122,.25), transparent 50%), repeating-linear-gradient(100deg, rgba(255,255,255,.03) 0 2px, transparent 2px 14px)' }}>
        <div className="flex items-center gap-3"><img src="/logo.svg" className="h-10 w-10" alt="" /><span className="text-lg font-semibold text-white">Timpanogos Timber Co.</span></div>
        <div>
          <h1 className="text-4xl font-semibold leading-tight text-white">Handcrafted in Utah Valley.<br />Run on one system.</h1>
          <p className="mt-4 max-w-md text-brand-200">Point of sale, inventory, production, purchasing, MRP and financials — connected in real time, from the workshop floor to the P&amp;L.</p>
        </div>
        <p className="text-xs text-brand-400">Orem Workshop · Lindon Warehouse · Provo Center Street Store</p>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold">{mode === 'in' ? 'Sign in' : 'Create an account'}</h2>
          <p className="mt-1 text-sm text-stone-500">{mode === 'in' ? 'Employees and customers use the same sign-in.' : 'Customers: leave the access code blank. Employees: enter the code from your manager.'}</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === 'up' && <Field label="Full name"><Input required value={f.full_name} onChange={set('full_name')} /></Field>}
            <Field label="Email"><Input type="email" required value={f.email} onChange={set('email')} autoComplete="email" /></Field>
            <Field label="Password"><Input type="password" required minLength={6} value={f.password} onChange={set('password')} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></Field>
            {mode === 'up' && <>
              <Field label="Phone (optional)"><Input value={f.phone} onChange={set('phone')} /></Field>
              <Field label="Employee access code (optional)"><Input value={f.access_code} onChange={set('access_code')} /></Field>
            </>}
            {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
            {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}
            <Button className="w-full" size="lg" loading={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</Button>
          </form>
          <button className="mt-4 text-sm text-brand-700 hover:underline" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr(null) }}>
            {mode === 'in' ? 'New customer or employee? Create an account' : 'Already have an account? Sign in'}
          </button>
          {mode === 'in' && (
            <div className="mt-8 rounded-xl border border-stone-200 bg-white p-3">
              <div className="label">Demo logins (password Timber2026!)</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {DEMO.map(([role, email]) => (
                  <button key={email} onClick={() => setF({ ...f, email, password: 'Timber2026!' })}
                    className="rounded-lg border border-stone-200 px-2 py-1.5 text-left text-xs hover:border-brand-400 hover:bg-brand-50">
                    <div className="font-medium">{role}</div><div className="truncate text-stone-500">{email}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
