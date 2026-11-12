import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, ShoppingCart, ClipboardList, Undo2, Boxes, Package, Factory, Truck, Building2,
  RefreshCcw, Network, Landmark, BarChart3, Users, Settings, Info, LogOut, Menu, Tag, Radio,
} from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { useRealtimeSync } from '../lib/realtime.js'
import { useToast, cx } from './ui.jsx'

const NAV = [
  { group: 'Overview', items: [{ to: '/', label: 'Action Center', icon: LayoutDashboard, end: true }] },
  { group: 'Sales', items: [
    { to: '/pos', label: 'Point of Sale', icon: ShoppingCart },
    { to: '/sales', label: 'Sales Orders', icon: ClipboardList },
    { to: '/returns', label: 'Returns & Exchanges', icon: Undo2 },
    { to: '/customers', label: 'Customers', icon: Users },
  ] },
  { group: 'Operations', items: [
    { to: '/inventory', label: 'Inventory', icon: Boxes },
    { to: '/items', label: 'Items & BOMs', icon: Package },
    { to: '/labels', label: 'Barcode Labels', icon: Tag },
    { to: '/production', label: 'Production', icon: Factory },
    { to: '/mrp', label: 'MRP', icon: Network },
  ] },
  { group: 'Supply chain', items: [
    { to: '/purchasing', label: 'Purchase Orders', icon: Truck },
    { to: '/suppliers', label: 'Suppliers & Scorecard', icon: Building2 },
    { to: '/replenishment', label: 'Replenishment (ROP/EOQ)', icon: RefreshCcw },
  ] },
  { group: 'Finance & insight', items: [
    { to: '/financials', label: 'Financials', icon: Landmark },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
  ] },
  { group: 'System', items: [
    { to: '/settings', label: 'Settings & Users', icon: Settings },
    { to: '/about', label: 'About / Tech Stack', icon: Info },
  ] },
]

export default function Layout({ children }) {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const toast = useToast()
  const nav = useNavigate()
  const status = useRealtimeSync(true, (a) => {
    if (a.user_name && a.user_name !== (profile?.full_name || profile?.email)) toast.info(`${a.user_name}: ${a.message}`)
  })

  return (
    <div className="min-h-screen lg:pl-64">
      {/* sidebar */}
      <aside className={cx('no-print fixed inset-y-0 left-0 z-40 w-64 transform overflow-y-auto bg-brand-900 text-brand-100 transition lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex items-center gap-2.5 px-5 py-5">
          <img src="/logo.svg" className="h-9 w-9" alt="" />
          <div>
            <div className="text-sm font-semibold leading-tight text-white">Timpanogos Timber</div>
            <div className="text-[11px] uppercase tracking-widest text-brand-300">ERP</div>
          </div>
        </div>
        <nav className="space-y-5 px-3 pb-6">
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-brand-400">{g.group}</div>
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} onClick={() => setOpen(false)}
                  className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm',
                    isActive ? 'bg-brand-700 font-medium text-white' : 'text-brand-200 hover:bg-brand-800 hover:text-white')}>
                  <it.icon className="h-4 w-4" />{it.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}

      {/* top bar */}
      <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-stone-200 bg-white/90 px-4 backdrop-blur">
        <button className="rounded-lg p-1.5 hover:bg-stone-100 lg:hidden" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
        <div className="flex items-center gap-1.5 text-xs" title="Realtime sync with all other users">
          <Radio className={cx('h-3.5 w-3.5', status === 'live' ? 'text-emerald-500' : 'text-amber-500')} />
          <span className={status === 'live' ? 'text-emerald-700' : 'text-amber-700'}>{status === 'live' ? 'Live — synced with all users' : 'Connecting…'}</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="text-right leading-tight">
            <div className="text-sm font-medium">{profile?.full_name || profile?.email}</div>
            <div className="text-[11px] uppercase tracking-wide text-stone-500">{profile?.role}</div>
          </div>
          <button onClick={async () => { await signOut(); nav('/') }} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100" title="Sign out"><LogOut className="h-4 w-4" /></button>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] p-4 sm:p-6">{children}</main>
    </div>
  )
}
