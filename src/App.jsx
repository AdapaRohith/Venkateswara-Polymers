import { useEffect, useRef, useState } from 'react'
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
import avlokaiLogo from '../avlokai_logo.png'

// Protected Route Component - checks user role before rendering
function ProtectedRoute({ element, allowedRoles, user }) {
  if (!user) return <Navigate to="/login" />
  if (!allowedRoles.includes(user.role)) {
    // Redirect to first allowed page based on role
    return <Navigate to={user.role === 'worker' ? '/raw-material' : '/'} />
  }
  return element
}



function App() {
  const [user, setUser] = useState(() => {
    const savedUser = localStorage.getItem('demo_user')
    return savedUser ? JSON.parse(savedUser) : null
  })

  const handleLogin = (userData) => {
    setUser(userData)
    localStorage.setItem('demo_user', JSON.stringify(userData))
  }

  const handleLogout = () => {
    setUser(null)
    localStorage.removeItem('demo_user')
  }

  const [rawMaterials, setRawMaterials] = useState([])
  const [manufacturingData, setManufacturingData] = useState([])
  const [tradingData, setTradingData] = useState([])
  const [wastageData, setWastageData] = useState([])

  // Stock usage entries — manual daily tracking of raw material consumed (per batch)
  const [stockUsage, setStockUsage] = useState([])

  const [usersList, setUsersList] = useState([])
  const [ordersList, setOrdersList] = useState([])

  // Filter orders to exclude completed/cancelled ones for selection
  const activeOrdersList = ordersList.filter(o => o.status !== 'completed' && o.status !== 'cancelled')

  const hasLoadedFromServerRef = useRef(false)

  useEffect(() => {
    if (hasLoadedFromServerRef.current) return
    hasLoadedFromServerRef.current = true

    const loadAll = async () => {
      const results = await Promise.allSettled([
        api.get('/raw-materials'),
        api.get('/manufacturing'),
        api.get('/trading'),
        api.get('/wastage'),
        api.get('/stock-usage'),
        api.get('/orders'),
      ])

      const [rm, mfg, tr, ws, su, ord] = results
      
      // Better data handling - support both array and { data: array } formats
      const processData = (result) => {
        if (result.status !== 'fulfilled') {
          console.warn('API call rejected:', result.reason)
          return null
        }
        const responseData = result.value?.data
        if (Array.isArray(responseData)) return responseData
        if (responseData?.data && Array.isArray(responseData.data)) return responseData.data
        console.warn('Invalid data format:', responseData)
        return null
      }

      const rmData = processData(rm)
      const mfgData = processData(mfg)
      const trData = processData(tr)
      const wsData = processData(ws)
      const suData = processData(su)
      const ordData = processData(ord)

      if (rmData) setRawMaterials(rmData)
      if (mfgData) setManufacturingData(mfgData)
      if (trData) setTradingData(trData)
      if (wsData) setWastageData(wsData)
      if (suData) setStockUsage(suData)
      if (ordData) setOrdersList(ordData)

      console.log('Loaded data:', { rmData, mfgData, trData, wsData, suData, ordData })
    }

    loadAll().catch((err) => console.error('Failed to load initial data', err))
  }, [])



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
                  {/* Watermark */}
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
                        element={<RawMaterial user={user} data={rawMaterials} setData={setRawMaterials} />}
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
                            setStockUsage={setStockUsage}
                            ordersList={activeOrdersList}
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
                                setWastageData={setWastageData}
                                stockUsage={stockUsage}
                                setStockUsage={setStockUsage}
                              />
                            }
                          />
                        }
                      />
                      <Route path="/log-history" element={
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
                      } />

                      <Route
                        path="/stocks"
                        element={
                          <Stocks
                            rawMaterials={rawMaterials}
                            stockUsage={stockUsage}
                            setStockUsage={setStockUsage}
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
                        path="/orders"
                        element={<Orders />}
                      />
                    </Routes>
                    {/* Footer */}
                    <div className="mt-16 pt-8 border-t border-border-default text-center text-text-secondary/50 text-xs relative z-10">
                      <div className="mb-3 flex justify-center">
                        <img
                          src={avlokaiLogo}
                          alt="AvlokAI"
                          className="h-14 w-auto object-contain opacity-80"
                        />
                      </div>
                      <p>© 2026 AvlokAI • <a href="https://avlokai.com" target="_blank" rel="noopener noreferrer" className="hover:text-accent-gold transition-colors">avlokai.com</a></p>
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
