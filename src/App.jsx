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
import { getInventoryBalances, getInventoryTransactions, inventoryTransactionsToState } from './utils/inventory'
import avlokaiLogo from '../avlokai_logo.png'

const STOCK_ISSUANCES_STORAGE_KEY = 'vp_stock_issuances'

function ProtectedRoute({ element, allowedRoles, user }) {
  if (!user) return <Navigate to="/login" />
  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={user.role === 'worker' ? '/raw-material' : '/'} />
  }
  return element
}

function App() {
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('demo_user')
    return savedUser ? JSON.parse(savedUser) : null
  })

  const [rawMaterials, setRawMaterials] = useState([])
  const [manufacturingData, setManufacturingData] = useState([])
  const [tradingData, setTradingData] = useState([])
  const [wastageData, setWastageData] = useState([])
  const [stockUsage, setStockUsage] = useState([])
  const [stockBalances, setStockBalances] = useState({})
  const [ordersList, setOrdersList] = useState([])
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
    const { data } = await api.get('/orders')
    setOrdersList(Array.isArray(data) ? data : [])
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

  const handleLogin = (userData) => {
    setUser(userData)
    localStorage.setItem('demo_user', JSON.stringify(userData))
  }

  const handleLogout = () => {
    setUser(null)
    localStorage.removeItem('demo_user')
  }

  useEffect(() => {
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
  }, [refreshInventoryData, refreshOrders])

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
                      <Route path="/orders" element={<Orders orders={ordersList} refreshOrders={refreshOrders} />} />
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
