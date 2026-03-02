import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { ToastProvider } from './components/Toast'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import RawMaterial from './pages/RawMaterial'
import Manufacturing from './pages/Manufacturing'
import Trading from './pages/Trading'
import Wastage from './pages/Wastage'
import LogHistory from './pages/LogHistory'

function App() {
  const [rawMaterials, setRawMaterials] = useState([])
  const [manufacturingData, setManufacturingData] = useState([])
  const [tradingData, setTradingData] = useState([])

  return (
    <ToastProvider>
      <Router>
        <div className="flex min-h-screen bg-bg-primary">
          <Sidebar />
          <main className="flex-1 ml-64 p-8 overflow-auto">
            <Routes>
              <Route
                path="/"
                element={
                  <Dashboard
                    rawMaterials={rawMaterials}
                    manufacturingData={manufacturingData}
                    tradingData={tradingData}
                  />
                }
              />
              <Route
                path="/raw-material"
                element={<RawMaterial data={rawMaterials} setData={setRawMaterials} />}
              />
              <Route
                path="/manufacturing"
                element={<Manufacturing data={manufacturingData} setData={setManufacturingData} />}
              />
              <Route
                path="/trading"
                element={<Trading data={tradingData} setData={setTradingData} />}
              />
              <Route
                path="/wastage"
                element={
                  <Wastage
                    rawMaterials={rawMaterials}
                    manufacturingData={manufacturingData}
                    tradingData={tradingData}
                  />
                }
              />
              <Route path="/log-history" element={<LogHistory />} />
            </Routes>
          </main>
        </div>
      </Router>
    </ToastProvider>
  )
}

export default App
