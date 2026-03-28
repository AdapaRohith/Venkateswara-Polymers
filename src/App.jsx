import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import api from './utils/api'
import { ToastProvider } from './components/Toast'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import RawMaterial from './pages/RawMaterial'
import Production from './pages/Production'
import ProductionSession from './pages/ProductionSession'
import Trading from './pages/Trading'
import Wastage from './pages/Wastage'
import LogHistory from './pages/LogHistory'
import Stocks from './pages/Stocks'
import Login from './components/ui/animated-characters-login-page.jsx'
import Users from './pages/Users'
import Orders from './pages/Orders'
import WorkerHome from './pages/WorkerHome'
import { getInventoryBalances, getInventoryTransactions, inventoryTransactionsToState } from './utils/inventory'
import avlokaiLogo from '../avlokai_logo.png'

const STOCK_ISSUANCES_STORAGE_KEY = 'vp_stock_issuances'
const AUTH_TOKEN_KEY = 'token'
const AUTH_USER_ID_KEY = 'user_id'
const AUTH_ROLE_KEY = 'role'

function normalizeRole(role) {
  return String(role || '').trim().toLowerCase()
}

function ProtectedRoute({ element, allowedRoles, user }) {
  const userRole = normalizeRole(user?.role)
  const normalizedAllowedRoles = (Array.isArray(allowedRoles) ? allowedRoles : []).map((role) =>
    normalizeRole(role),
  )

  if (!user) return <Navigate to="/login" />
  if (!normalizedAllowedRoles.includes(userRole)) {
    return <Navigate to={userRole === 'worker' ? '/worker-home' : '/'} />
  }
  return element
}

function AnimatedRoutes({ 
  user, 
  handleLogout, 
  rawMaterials, 
  manufacturingData, 
  tradingData, 
  wastageData, 
  stockUsage, 
  stockIssuances, 
  stockBalances, 
  activeOrdersList, 
  refreshInventoryData, 
  ordersList, 
  ordersLoading, 
  refreshOrders,
  setTradingData,
  setWastageData,
  setStockUsage
}) {
  const location = useLocation()
  const userRole = normalizeRole(user?.role)

  if (!user) return <Navigate to="/login" />

  return (
    <div className="flex min-h-screen bg-bg-primary relative overflow-hidden transition-colors duration-500">
      {/* Refined Background Watermark */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.03] dark:opacity-[0.02]">
          <img
            src={avlokaiLogo}
            alt="Watermark"
            className="w-[800px] max-w-none rotate-[-12deg] grayscale"
          />
        </div>
        {/* Subtle Ambient Glows */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-primary/5 rounded-full blur-[100px]" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[120px]" />
      </div>

      <Sidebar user={user} onLogout={handleLogout} />
      
      <main className="flex-1 ml-0 lg:ml-72 pt-16 lg:pt-0 min-h-screen relative z-10">
        <div className="max-w-[1600px] mx-auto px-4 pb-28 pt-4 sm:px-6 sm:pt-6 lg:px-12 lg:pb-12 lg:pt-12">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              className="min-w-0"
            >
              <Routes location={location}>
                <Route
                  path="/"
                  element={
                    userRole === 'worker' ? (
                      <Navigate to="/worker-home" />
                    ) : (
                      <ProtectedRoute
                        user={user}
                        allowedRoles={['owner']}
                        element={
                          <Dashboard
                            rawMaterials={rawMaterials}
                            manufacturingData={manufacturingData}
                            tradingData={tradingData}
                          />
                        }
                      />
                    )
                  }
                />
                <Route
                  path="/worker-home"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['worker']}
                      element={<WorkerHome stockIssuances={stockIssuances} ordersList={activeOrdersList} />}
                    />
                  }
                />
                <Route
                  path="/raw-material"
                  element={
                    <RawMaterial
                      user={user}
                      data={rawMaterials}
                      stockBalances={stockBalances}
                      refreshInventoryData={refreshInventoryData}
                    />
                  }
                />
                <Route
                  path="/manufacturing"
                  element={<Production />}
                />
                <Route
                  path="/production-session"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['owner', 'worker']}
                      element={
                        <ProductionSession
                          user={user}
                          rawMaterials={rawMaterials}
                          stockUsage={stockUsage}
                          stockIssuances={stockIssuances}
                          stockBalances={stockBalances}
                          refreshInventoryData={refreshInventoryData}
                        />
                      }
                    />
                  }
                />
                <Route
                  path="/trading"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['owner']}
                      element={<Trading data={tradingData} setData={setTradingData} ordersList={activeOrdersList} />}
                    />
                  }
                />
                <Route
                  path="/wastage"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['owner']}
                      element={
                        <Wastage
                          rawMaterials={rawMaterials}
                          manufacturingData={manufacturingData}
                          wastageData={wastageData}
                          ordersList={activeOrdersList}
                          setWastageData={setWastageData}
                          stockUsage={stockUsage}
                          stockIssuances={stockIssuances}
                          stockBalances={stockBalances}
                          setStockUsage={setStockUsage}
                          refreshInventoryData={refreshInventoryData}
                          refreshOrders={refreshOrders}
                        />
                      }
                    />
                  }
                />
                <Route
                  path="/log-history"
                  element={
                    <ProtectedRoute
                      user={user}
                      allowedRoles={['owner']}
                      element={
                        <LogHistory
                          user={user}
                          rawMaterials={rawMaterials}
                          manufacturingData={manufacturingData}
                          tradingData={tradingData}
                          wastageData={wastageData}
                          stockUsage={stockUsage}
                        />
                      }
                    />
                  }
                />

                <Route
                  path="/stocks"
                  element={
                    <Stocks
                      user={user}
                      rawMaterials={rawMaterials}
                      stockUsage={stockUsage}
                      stockIssuances={stockIssuances}
                      stockBalances={stockBalances}
                      refreshInventoryData={refreshInventoryData}
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
                <Route path="/orders" element={<Orders user={user} orders={ordersList} loading={ordersLoading} refreshOrders={refreshOrders} />} />
              </Routes>
            </motion.div>
          </AnimatePresence>

          <footer className="mt-16 border-t border-border-default/50 pt-10 text-center relative z-10 sm:mt-24 sm:pt-12">
            <div className="flex flex-col items-center gap-6">
               <img
                src={avlokaiLogo}
                alt="AvlokAI"
                className="h-10 w-auto object-contain opacity-20 grayscale hover:opacity-100 hover:grayscale-0 transition-all duration-700"
              />
              <div className="space-y-2">
                <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-text-secondary/40">
                  Precision Polymer Tracking System
                </p>
                <p className="text-[11px] text-text-secondary/60">
                  © 2026 Venkateswara Polymers · Engineered by{' '}
                  <a
                    href="https://avlokai.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary/60 hover:text-primary transition-colors font-bold"
                  >
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
      if (!parsedUser?.role) {
        localStorage.removeItem('demo_user')
        return null
      }

      if (!token && !parsedUser?.token) {
        localStorage.removeItem('demo_user')
        return null
      }

      if (!token && parsedUser?.token) {
        localStorage.setItem(AUTH_TOKEN_KEY, parsedUser.token)
      }
      if (parsedUser?.id !== undefined && parsedUser?.id !== null) {
        localStorage.setItem(AUTH_USER_ID_KEY, String(parsedUser.id))
      }
      if (parsedUser?.role) {
        localStorage.setItem(AUTH_ROLE_KEY, parsedUser.role)
      }

      return parsedUser
    } catch (error) {
      console.error('Failed to read saved user session', error)
      localStorage.removeItem('demo_user')
      return null
    }
  })

  const [rawMaterials, setRawMaterials] = useState([])
  const [manufacturingData, setManufacturingData] = useState([])
  const [tradingData, setTradingData] = useState([])
  const [wastageData, setWastageData] = useState([])
  const [stockUsage, setStockUsage] = useState([])
  const [stockBalances, setStockBalances] = useState({})
  const [ordersList, setOrdersList] = useState([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [stockIssuances, setStockIssuances] = useState(() => {
    try {
      const saved = localStorage.getItem(STOCK_ISSUANCES_STORAGE_KEY)
      return saved ? JSON.parse(saved) : []
    } catch (error) {
      console.error('Failed to load saved stock issuances', error)
      return []
    }
  })

  const activeOrdersList = ordersList.filter((order) => {
    const normalizedStatus = String(order.status || 'active').toLowerCase()
    return normalizedStatus !== 'completed' && normalizedStatus !== 'cancelled'
  })
  const hasLoadedFromServerRef = useRef(false)

  const refreshOrders = useCallback(async () => {
    setOrdersLoading(true)
    try {
      const { data } = await api.get('/orders')
      setOrdersList(Array.isArray(data) ? data : [])
    } finally {
      setOrdersLoading(false)
    }
  }, [])

  const refreshInventoryData = useCallback(async () => {
    const [transactions, balances] = await Promise.all([
      getInventoryTransactions(api),
      getInventoryBalances(api),
    ])

    const inventoryState = inventoryTransactionsToState(transactions, balances)
    setRawMaterials(inventoryState.rawMaterials)
    setManufacturingData(inventoryState.manufacturingData)
    setWastageData(inventoryState.wastageData)
    setStockUsage(inventoryState.stockUsage)
    setStockIssuances(inventoryState.stockIssuances)
    setStockBalances(inventoryState.stockBalances)
  }, [])

  const handleLogin = (authData) => {
    const token = authData?.token
    const role = normalizeRole(authData?.role)
    const id = authData?.user_id ?? authData?.id

    if (!token || !role || id === undefined || id === null) {
      console.error('Invalid login response payload', authData)
      return
    }

    const normalizedUser = {
      id: String(id),
      role,
      name: authData?.name ?? '',
      email: authData?.email ?? '',
      token,
    }

    localStorage.setItem(AUTH_TOKEN_KEY, token)
    localStorage.setItem(AUTH_USER_ID_KEY, String(id))
    localStorage.setItem(AUTH_ROLE_KEY, role)
    localStorage.setItem('demo_user', JSON.stringify(normalizedUser))

    hasLoadedFromServerRef.current = false
    setUser(normalizedUser)
  }

  const handleLogout = () => {
    hasLoadedFromServerRef.current = false
    setUser(null)
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_USER_ID_KEY)
    localStorage.removeItem(AUTH_ROLE_KEY)
    localStorage.removeItem('demo_user')
  }

  useEffect(() => {
    if (!user) {
      hasLoadedFromServerRef.current = false
      return
    }

    if (hasLoadedFromServerRef.current) return
    hasLoadedFromServerRef.current = true

    const loadAll = async () => {
      const results = await Promise.allSettled([
        refreshInventoryData(),
        refreshOrders(),
      ])

      const [inventoryResult, ordersResult] = results

      if (inventoryResult.status !== 'fulfilled') {
        console.warn('Failed to load inventory data:', inventoryResult.reason)
      }
      if (ordersResult.status !== 'fulfilled') {
        console.warn('Failed to load orders:', ordersResult.reason)
      }
    }

    loadAll().catch((error) => console.error('Failed to load initial data', error))
  }, [user, refreshInventoryData, refreshOrders])

  useEffect(() => {
    try {
      localStorage.setItem(STOCK_ISSUANCES_STORAGE_KEY, JSON.stringify(stockIssuances))
    } catch (error) {
      console.error('Failed to persist stock issuances', error)
    }
  }, [stockIssuances])

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
                rawMaterials={rawMaterials}
                manufacturingData={manufacturingData}
                tradingData={tradingData}
                wastageData={wastageData}
                stockUsage={stockUsage}
                stockIssuances={stockIssuances}
                stockBalances={stockBalances}
                activeOrdersList={activeOrdersList}
                refreshInventoryData={refreshInventoryData}
                ordersList={ordersList}
                ordersLoading={ordersLoading}
                refreshOrders={refreshOrders}
                setTradingData={setTradingData}
                setWastageData={setWastageData}
                setStockUsage={setStockUsage}
              />
            }
          />
        </Routes>
      </Router>
    </ToastProvider>
  )
}

export default App
