import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import api from './utils/api'
import { ToastProvider } from './components/Toast'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import RawMaterial from './pages/RawMaterial'
import Wastage from './pages/Wastage'
import Login from './components/ui/animated-characters-login-page.jsx'
import Users from './pages/Users'
import Orders from './pages/Orders'
import ProductionLog from './pages/ProductionLog'
import MaterialMovement from './pages/MaterialMovement'
import ProductionOrders from './pages/ProductionOrders'
import Fulfillment from './pages/Fulfillment'
import MachineReports from './pages/MachineReports'
import avlokaiLogo from '../avlokai_logo.png'

const AUTH_TOKEN_KEY = 'token'
const AUTH_USER_ID_KEY = 'user_id'
const AUTH_ROLE_KEY = 'role'

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase()
}

function ProtectedRoute({ element, allowedRoles, user }) {
  const userRole = normalizeRole(user?.role)
  const normalizedAllowedRoles = (Array.isArray(allowedRoles) ? allowedRoles : []).map(normalizeRole)
  if (!user) return <Navigate to="/login" />
  if (!normalizedAllowedRoles.includes(userRole)) {
    return <Navigate to={userRole === 'worker' ? '/production-log' : '/'} />
  }
  return element
}

function AnimatedRoutes({ user, handleLogout, ordersList, ordersLoading, refreshOrders }) {
  const location = useLocation()
  const userRole = normalizeRole(user?.role)
  const activeOrdersList = ordersList.filter(o => {
    const s = String(o.status || 'active').toLowerCase()
    return s !== 'completed' && s !== 'cancelled'
  })

  if (!user) return <Navigate to="/login" />

  return (
    <div className="flex min-h-screen bg-bg-primary relative overflow-hidden transition-colors duration-500">
      {/* Background watermark */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.03]">
          <img src={avlokaiLogo} alt="" className="w-[800px] max-w-none rotate-[-12deg] grayscale" />
        </div>
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-primary/5 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[120px]" />
      </div>

      <Sidebar user={user} onLogout={handleLogout} />

      <main className="flex-1 ml-0 lg:ml-64 pt-16 lg:pt-0 min-h-screen relative z-10">
        <div className="max-w-[1600px] mx-auto px-4 pb-28 pt-4 sm:px-6 sm:pt-6 lg:px-10 lg:pb-12 lg:pt-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="min-w-0"
            >
              <Routes location={location}>
                {/* Root */}
                <Route
                  path="/"
                  element={
                    userRole === 'worker'
                      ? <Navigate to="/production-log" />
                      : <ProtectedRoute user={user} allowedRoles={['owner']} element={<Dashboard />} />
                  }
                />

                {/* ─── Core Operations ─── */}
                <Route
                  path="/production-log"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['owner', 'worker']}
                      element={<ProductionLog user={user} />}
                    />
                  }
                />
                <Route
                  path="/materials"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['owner', 'worker']}
                      element={<MaterialMovement />}
                    />
                  }
                />
                <Route
                  path="/wastage"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['owner', 'worker']}
                      element={<Wastage user={user} ordersList={activeOrdersList} />}
                    />
                  }
                />

                {/* ─── Orders ─── */}
                <Route
                  path="/production-orders"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['owner']}
                      element={<ProductionOrders />}
                    />
                  }
                />
                <Route
                  path="/fulfillment"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['owner']}
                      element={<Fulfillment />}
                    />
                  }
                />

                {/* ─── Reports & Data ─── */}
                <Route
                  path="/reports"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['owner']}
                      element={<MachineReports />}
                    />
                  }
                />
                <Route
                  path="/raw-material"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['owner']}
                      element={<RawMaterial user={user} />}
                    />
                  }
                />
                <Route
                  path="/users"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['owner']}
                      element={<Users />}
                    />
                  }
                />

                {/* Legacy / kept routes */}
                <Route path="/orders" element={<Orders user={user} orders={ordersList} loading={ordersLoading} refreshOrders={refreshOrders} />} />

                {/* Catch-all */}
                <Route path="*" element={<Navigate to={userRole === 'worker' ? '/production-log' : '/'} />} />
              </Routes>
            </motion.div>
          </AnimatePresence>

          <footer className="mt-16 border-t border-border-default/50 pt-10 text-center relative z-10">
            <div className="flex flex-col items-center gap-4">
              <img src={avlokaiLogo} alt="AvlokAI" className="h-9 w-auto object-contain opacity-20 grayscale hover:opacity-100 hover:grayscale-0 transition-all duration-700" />
              <div className="space-y-1">
                <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-text-secondary/40">Precision Polymer Tracking System</p>
                <p className="text-[11px] text-text-secondary/60">
                  © 2026 Venkateswara Polymers · Engineered by{' '}
                  <a href="https://avlokai.com" target="_blank" rel="noopener noreferrer" className="text-primary/60 hover:text-primary font-bold">
                    AvlokAI
                  </a>
                </p>
              </div>
            </div>
          </footer>
        </div>
      </main>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(() => {
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY)
      const savedUser = localStorage.getItem('demo_user')
      if (!savedUser) return null
      const parsedUser = JSON.parse(savedUser)
      if (!parsedUser?.role) { localStorage.removeItem('demo_user'); return null }
      if (!token && !parsedUser?.token) { localStorage.removeItem('demo_user'); return null }
      if (!token && parsedUser?.token) localStorage.setItem(AUTH_TOKEN_KEY, parsedUser.token)
      if (parsedUser?.id != null) localStorage.setItem(AUTH_USER_ID_KEY, String(parsedUser.id))
      if (parsedUser?.role) localStorage.setItem(AUTH_ROLE_KEY, parsedUser.role)
      return parsedUser
    } catch {
      localStorage.removeItem('demo_user')
      return null
    }
  })

  const [ordersList, setOrdersList] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const hasLoadedRef = useRef(false)

  const refreshOrders = useCallback(async () => {
    setOrdersLoading(true)
    try {
      const { data } = await api.get('/orders')
      setOrdersList(Array.isArray(data) ? data : [])
    } finally {
      setOrdersLoading(false)
    }
  }, [])

  const handleLogin = authData => {
    const token = authData?.token
    const role = normalizeRole(authData?.role)
    const id = authData?.user_id ?? authData?.id
    if (!token || !role || id == null) return

    const u = { id: String(id), role, name: authData?.name ?? '', email: authData?.email ?? '', token }
    localStorage.setItem(AUTH_TOKEN_KEY, token)
    localStorage.setItem(AUTH_USER_ID_KEY, String(id))
    localStorage.setItem(AUTH_ROLE_KEY, role)
    localStorage.setItem('demo_user', JSON.stringify(u))
    hasLoadedRef.current = false
    setUser(u)
  }

  const handleLogout = () => {
    hasLoadedRef.current = false
    setUser(null)
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_USER_ID_KEY)
    localStorage.removeItem(AUTH_ROLE_KEY)
    localStorage.removeItem('demo_user')
  }

  useEffect(() => {
    if (!user || hasLoadedRef.current) return
    hasLoadedRef.current = true
    refreshOrders().catch(console.warn)
  }, [user, refreshOrders])

  return (
    <ToastProvider>
      <Router>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" /> : <Login onLogin={handleLogin} />} />
          <Route
            path="/*"
            element={
              <AnimatedRoutes
                user={user}
                handleLogout={handleLogout}
                ordersList={ordersList}
                ordersLoading={ordersLoading}
                refreshOrders={refreshOrders}
              />
            }
          />
        </Routes>
      </Router>
    </ToastProvider>
  )
}

export default App
