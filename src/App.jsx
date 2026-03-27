import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import api from './utils/api'
import { ToastProvider } from './components/Toast'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import RawMaterial from './pages/RawMaterial'
import Manufacturing from './pages/Manufacturing'
import Trading from './pages/Trading'
import Wastage from './pages/Wastage'
import LogHistory from './pages/LogHistory'
import Stocks from './pages/Stocks'
import Login from './components/ui/animated-characters-login-page.jsx'
import Users from './pages/Users'
import Orders from './pages/Orders'
import WorkerHome from './pages/WorkerHome'
import ProductionTracker from './pages/ProductionTracker'
import usePersistentState from './hooks/usePersistentState'
import { getInventoryBalances, getInventoryTransactions, inventoryTransactionsToState } from './utils/inventory'
import avlokaiLogo from '../avlokai_logo.png'

const STOCK_ISSUANCES_STORAGE_KEY = 'vp_stock_issuances'
const PRODUCTION_TRACKER_STORAGE_KEY = 'vp_production_tracker_entries'
const AUTH_TOKEN_KEY = 'token'
const AUTH_USER_ID_KEY = 'user_id'
const AUTH_ROLE_KEY = 'role'

const loadStoredUser = () => {
  const token = localStorage.getItem(AUTH_TOKEN_KEY)
  const role = localStorage.getItem(AUTH_ROLE_KEY)
  const userId = localStorage.getItem(AUTH_USER_ID_KEY)

  if (token && role && userId) {
    return {
      token,
      role,
      id: userId,
    }
  }

  if (token || role || userId) {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_ROLE_KEY)
    localStorage.removeItem(AUTH_USER_ID_KEY)
  }

  return null
}

function ProtectedRoute({ element, allowedRoles, user }) {
  if (!user) return <Navigate to="/login" />
  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === 'worker' ? '/worker-home' : '/'} />
  }
  return element
}

function App() {
  const [user, setUser] = useState(() => {
    try {
      localStorage.removeItem('demo_user')
    } catch (error) {
      console.warn('Failed to clear demo user data', error)
    }
    return loadStoredUser()
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

  const [productionTrackerEntries, setProductionTrackerEntries] = usePersistentState(PRODUCTION_TRACKER_STORAGE_KEY, [])

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
    if (!authData?.token || !authData?.user_id || !authData?.role) {
      console.error('Invalid authentication payload received', authData)
      return
    }

    localStorage.setItem(AUTH_TOKEN_KEY, authData.token)
    localStorage.setItem(AUTH_USER_ID_KEY, String(authData.user_id))
    localStorage.setItem(AUTH_ROLE_KEY, authData.role)

    const normalizedUser = {
      token: authData.token,
      role: authData.role,
      id: String(authData.user_id),
      name: authData.name || authData.user?.name || '',
      email: authData.email || authData.user?.email || '',
    }

    setUser(normalizedUser)
    hasLoadedFromServerRef.current = false
  }

  const handleLogout = () => {
    setUser(null)
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_USER_ID_KEY)
    localStorage.removeItem(AUTH_ROLE_KEY)
    localStorage.removeItem('demo_user')
    hasLoadedFromServerRef.current = false
  }

  useEffect(() => {
    if (!user) return
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
              !user ? (
                <Navigate to="/login" />
              ) : (
                <div className="flex min-h-screen bg-bg-primary relative">
                  <div className="fixed inset-0 pointer-events-none z-0">
                    <div className="absolute inset-0 flex items-center justify-center opacity-10">
                      <img
                        src={avlokaiLogo}
                        alt="AvlokAI watermark"
                        className="w-[440px] max-w-[68vw] rotate-[-18deg] object-contain"
                      />
                    </div>
                  </div>

                  <Sidebar user={user} onLogout={handleLogout} />
                  <main className="flex-1 ml-0 lg:ml-64 pt-18 lg:pt-0 p-4 lg:p-8 overflow-auto relative z-10">
                    <Routes>
                      <Route
                        path="/"
                        element={
                          user?.role === 'worker' ? (
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
                        path="/production-tracker"
                        element={<ProductionTracker user={user} setProductionTrackerEntries={setProductionTrackerEntries} />}
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
                        element={
                          <Manufacturing
                            user={user}
                            data={manufacturingData}
                            setData={setManufacturingData}
                            rawMaterials={rawMaterials}
                            stockUsage={stockUsage}
                            stockIssuances={stockIssuances}
                            stockBalances={stockBalances}
                            setStockUsage={setStockUsage}
                            ordersList={activeOrdersList}
                            refreshInventoryData={refreshInventoryData}
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
                                productionTrackerEntries={productionTrackerEntries}
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
                    <div className="mt-16 pt-8 border-t border-border-default text-center text-text-secondary/50 text-xs relative z-10">
                      <div className="mb-3 flex justify-center">
                        <img
                          src={avlokaiLogo}
                          alt="AvlokAI"
                          className="h-14 w-auto object-contain opacity-80"
                        />
                      </div>
                      <p>
                        © 2026 AvlokAI ·{' '}
                        <a
                          href="https://avlokai.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-accent-gold transition-colors"
                        >
                          avlokai.com
                        </a>
                      </p>
                    </div>
                  </main>
                </div>
              )
            }
          />
        </Routes>
      </Router>
    </ToastProvider>
  )
}

export default App
