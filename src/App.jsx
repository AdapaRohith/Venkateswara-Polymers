import { useCallback, useEffect, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ToastProvider } from './components/Toast'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import RawMaterial from './pages/RawMaterial'
import Wastage from './pages/Wastage'
import Login from './components/ui/animated-characters-login-page.jsx'
import Users from './pages/Users'
import Orders from './pages/Orders'
import Production from './pages/Production'
import MaterialMovement from './pages/MaterialMovement'
import ProductionOrders from './pages/ProductionOrders'
import Fulfillment from './pages/Fulfillment'
import MachineReports from './pages/MachineReports'
import Trading from './pages/Trading'
import IssueReports from './pages/IssueReports'
import { getOrders } from './utils/orders'

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

  if (!user) return <Navigate to="/login" />

  return (
    <div className="flex min-h-screen bg-bg-primary">
      <Sidebar user={user} onLogout={handleLogout} />

      <main className="flex-1 ml-0 lg:ml-64 pt-14 lg:pt-0 min-h-screen">
        <div className="max-w-[1600px] mx-auto px-4 pb-28 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pb-10 lg:pt-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
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
                  path="/trading"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['owner']}
                      element={<Trading />}
                    />
                  }
                />
                <Route
                  path="/production-log"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['owner', 'worker']}
                      element={<Production user={user} />}
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
                      element={<Wastage user={user} />}
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
                <Route
                  path="/issue-reports"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['owner']}
                      element={<IssueReports />}
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

          <footer className="mt-12 border-t border-border-default pt-6 text-center">
            <p className="text-[11px] text-text-secondary/50">
              © 2026 Venkateswara Polymers · Built by{' '}
              <a href="https://avlokai.com" target="_blank" rel="noopener noreferrer" className="text-accent-gold/60 hover:text-accent-gold transition-colors font-semibold">
                AvlokAI
              </a>
            </p>
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
  const [ordersLoading, setOrdersLoading] = useState(false)

  const refreshOrders = useCallback(async () => {
    setOrdersLoading(true)
    try {
      const orders = await getOrders()
      setOrdersList(orders)
      return orders
    } catch {
      setOrdersList([])
      return []
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
    setUser(u)
  }

  const handleLogout = () => {
    setUser(null)
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_USER_ID_KEY)
    localStorage.removeItem(AUTH_ROLE_KEY)
    localStorage.removeItem('demo_user')
  }

  useEffect(() => {
    if (!user) return
    refreshOrders().catch(() => {})
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
