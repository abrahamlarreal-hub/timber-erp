import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/auth.jsx'
import { configured } from './lib/supabase'
import { Spinner } from './components/ui.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import POS from './pages/POS.jsx'
import SalesOrders from './pages/SalesOrders.jsx'
import SalesOrderDetail from './pages/SalesOrderDetail.jsx'
import Returns from './pages/Returns.jsx'
import Customers from './pages/Customers.jsx'
import Inventory from './pages/Inventory.jsx'
import Items from './pages/Items.jsx'
import Labels from './pages/Labels.jsx'
import Production from './pages/Production.jsx'
import MRP from './pages/MRP.jsx'
import Purchasing from './pages/Purchasing.jsx'
import PurchaseOrderDetail from './pages/PurchaseOrderDetail.jsx'
import Suppliers from './pages/Suppliers.jsx'
import Replenishment from './pages/Replenishment.jsx'
import Financials from './pages/Financials.jsx'
import Reports from './pages/Reports.jsx'
import SettingsPage from './pages/Settings.jsx'
import About from './pages/About.jsx'
import Portal from './portal/Portal.jsx'

export default function App() {
  const { session, profile, loading, isStaff } = useAuth()
  if (!configured) return <div className="p-10 text-center">Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — see README.</div>
  if (loading) return <Spinner />
  if (!session) return <Login />
  if (!profile) return <Spinner label="Loading your profile…" />
  if (!isStaff) return <Portal />
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/pos" element={<POS />} />
        <Route path="/sales" element={<SalesOrders />} />
        <Route path="/sales/:id" element={<SalesOrderDetail />} />
        <Route path="/returns" element={<Returns />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/items" element={<Items />} />
        <Route path="/labels" element={<Labels />} />
        <Route path="/production" element={<Production />} />
        <Route path="/mrp" element={<MRP />} />
        <Route path="/purchasing" element={<Purchasing />} />
        <Route path="/purchasing/:id" element={<PurchaseOrderDetail />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/replenishment" element={<Replenishment />} />
        <Route path="/financials" element={<Financials />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  )
}
