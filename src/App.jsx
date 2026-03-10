import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { ToastProvider } from './components/Toast'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import RawMaterial from './pages/RawMaterial'
import Manufacturing from './pages/Manufacturing'
import Trading from './pages/Trading'
import Wastage from './pages/Wastage'
import LogHistory from './pages/LogHistory'
import Stocks from './pages/Stocks'
import { fetchAllRolls } from './utils/api'

// Helper: returns YYYY-MM-DD string for N days ago from today
function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

function App() {
  const [rawMaterials, setRawMaterials] = useState([
    { id: 1, sno: 1, date: daysAgo(6), quantityReceived: 10, quantityUnit: 'tons', quantityInKg: 10000, quantityDisplay: '10 tons', grossWeight: 520, tareWeight: 45, netWeight: 475, sizeMic: '12mm / 3.5 mic' },
    { id: 2, sno: 2, date: daysAgo(6), quantityReceived: 8, quantityUnit: 'tons', quantityInKg: 8000, quantityDisplay: '8 tons', grossWeight: 610, tareWeight: 55, netWeight: 555, sizeMic: '10mm / 3.0 mic' },
    { id: 3, sno: 3, date: daysAgo(5), quantityReceived: 10, quantityUnit: 'tons', quantityInKg: 10000, quantityDisplay: '10 tons', grossWeight: 480, tareWeight: 40, netWeight: 440, sizeMic: '14mm / 4.0 mic' },
    { id: 4, sno: 4, date: daysAgo(4), quantityReceived: 12, quantityUnit: 'tons', quantityInKg: 12000, quantityDisplay: '12 tons', grossWeight: 700, tareWeight: 60, netWeight: 640, sizeMic: '12mm / 3.5 mic' },
    { id: 5, sno: 5, date: daysAgo(3), quantityReceived: 10, quantityUnit: 'tons', quantityInKg: 10000, quantityDisplay: '10 tons', grossWeight: 550, tareWeight: 50, netWeight: 500, sizeMic: '8mm / 2.5 mic' },
    { id: 6, sno: 6, date: daysAgo(3), quantityReceived: 5, quantityUnit: 'tons', quantityInKg: 5000, quantityDisplay: '5 tons', grossWeight: 430, tareWeight: 35, netWeight: 395, sizeMic: '10mm / 3.0 mic' },
    { id: 7, sno: 7, date: daysAgo(2), quantityReceived: 10, quantityUnit: 'tons', quantityInKg: 10000, quantityDisplay: '10 tons', grossWeight: 590, tareWeight: 48, netWeight: 542, sizeMic: '14mm / 4.0 mic' },
    { id: 8, sno: 8, date: daysAgo(1), quantityReceived: 10, quantityUnit: 'tons', quantityInKg: 10000, quantityDisplay: '10 tons', grossWeight: 660, tareWeight: 52, netWeight: 608, sizeMic: '10mm / 3.0 mic' },
    { id: 9, sno: 9, date: daysAgo(0), quantityReceived: 8, quantityUnit: 'tons', quantityInKg: 8000, quantityDisplay: '8 tons', grossWeight: 510, tareWeight: 42, netWeight: 468, sizeMic: '8mm / 2.5 mic' },
    { id: 10, sno: 10, date: daysAgo(0), quantityReceived: 10, quantityUnit: 'tons', quantityInKg: 10000, quantityDisplay: '10 tons', grossWeight: 720, tareWeight: 65, netWeight: 655, sizeMic: '12mm / 3.5 mic' },
  ])
  const [manufacturingData, setManufacturingData] = useState([
    { id: 101, sno: 1, date: daysAgo(6), order_number: 'ORD-001', grossWeight: 350, tareWeight: 38, netWeight: 312, sizeMic: '12mm / 3.5 mic' },
    { id: 102, sno: 2, date: daysAgo(5), order_number: 'ORD-001', grossWeight: 380, tareWeight: 44, netWeight: 336, sizeMic: '10mm / 3.0 mic' },
    { id: 103, sno: 3, date: daysAgo(4), order_number: 'ORD-002', grossWeight: 310, tareWeight: 32, netWeight: 278, sizeMic: '14mm / 4.0 mic' },
    { id: 104, sno: 4, date: daysAgo(4), order_number: 'ORD-002', grossWeight: 360, tareWeight: 50, netWeight: 310, sizeMic: '12mm / 3.5 mic' },
    { id: 105, sno: 5, date: daysAgo(3), order_number: 'ORD-003', grossWeight: 340, tareWeight: 40, netWeight: 300, sizeMic: '8mm / 2.5 mic' },
    { id: 106, sno: 6, date: daysAgo(2), order_number: 'ORD-003', grossWeight: 330, tareWeight: 46, netWeight: 284, sizeMic: '10mm / 3.0 mic' },
    { id: 107, sno: 7, date: daysAgo(1), order_number: 'ORD-004', grossWeight: 370, tareWeight: 48, netWeight: 322, sizeMic: '14mm / 4.0 mic' },
    { id: 108, sno: 8, date: daysAgo(1), order_number: 'ORD-004', grossWeight: 355, tareWeight: 55, netWeight: 300, sizeMic: '12mm / 3.5 mic' },
    { id: 109, sno: 9, date: daysAgo(0), order_number: 'ORD-005', grossWeight: 320, tareWeight: 36, netWeight: 284, sizeMic: '8mm / 2.5 mic' },
    { id: 110, sno: 10, date: daysAgo(0), order_number: 'ORD-005', grossWeight: 387, tareWeight: 58, netWeight: 329, sizeMic: '10mm / 3.0 mic' },
  ])
  const [tradingData, setTradingData] = useState([
    { id: 201, sno: 1, date: daysAgo(6), order_number: 'ORD-001', netWeight: 150, rate: 85, totalValue: 12750, sizeMic: '12mm / 3.5 mic', type: 'Buy' },
    { id: 202, sno: 2, date: daysAgo(5), order_number: 'ORD-001', netWeight: 120, rate: 90, totalValue: 10800, sizeMic: '10mm / 3.0 mic', type: 'Sell' },
    { id: 203, sno: 3, date: daysAgo(4), order_number: 'ORD-002', netWeight: 160, rate: 82, totalValue: 13120, sizeMic: '14mm / 4.0 mic', type: 'Buy' },
    { id: 204, sno: 4, date: daysAgo(3), order_number: 'ORD-002', netWeight: 130, rate: 88, totalValue: 11440, sizeMic: '12mm / 3.5 mic', type: 'Sell' },
    { id: 205, sno: 5, date: daysAgo(3), order_number: 'ORD-003', netWeight: 140, rate: 78, totalValue: 10920, sizeMic: '8mm / 2.5 mic', type: 'Buy' },
    { id: 206, sno: 6, date: daysAgo(2), order_number: 'ORD-003', netWeight: 155, rate: 92, totalValue: 14260, sizeMic: '10mm / 3.0 mic', type: 'Sell' },
    { id: 207, sno: 7, date: daysAgo(1), order_number: 'ORD-004', netWeight: 145, rate: 80, totalValue: 11600, sizeMic: '14mm / 4.0 mic', type: 'Buy' },
    { id: 208, sno: 8, date: daysAgo(1), order_number: 'ORD-004', netWeight: 110, rate: 95, totalValue: 10450, sizeMic: '12mm / 3.5 mic', type: 'Sell' },
    { id: 209, sno: 9, date: daysAgo(0), order_number: 'ORD-005', netWeight: 135, rate: 84, totalValue: 11340, sizeMic: '8mm / 2.5 mic', type: 'Buy' },
    { id: 210, sno: 10, date: daysAgo(0), order_number: 'ORD-005', netWeight: 125, rate: 91, totalValue: 11375, sizeMic: '10mm / 3.0 mic', type: 'Sell' },
  ])
  const [wastageData, setWastageData] = useState([
    { id: 301, sno: 1, date: daysAgo(6), order_number: 'ORD-001', grossWeight: 50, netWeight: 12, actualWeight: 38 },
    { id: 302, sno: 2, date: daysAgo(5), order_number: 'ORD-001', grossWeight: 45, netWeight: 10, actualWeight: 35 },
    { id: 303, sno: 3, date: daysAgo(4), order_number: 'ORD-002', grossWeight: 60, netWeight: 15, actualWeight: 45 },
    { id: 304, sno: 4, date: daysAgo(4), order_number: 'ORD-002', grossWeight: 38, netWeight: 8, actualWeight: 30 },
    { id: 305, sno: 5, date: daysAgo(3), order_number: 'ORD-003', grossWeight: 55, netWeight: 14, actualWeight: 41 },
    { id: 306, sno: 6, date: daysAgo(2), order_number: 'ORD-003', grossWeight: 42, netWeight: 11, actualWeight: 31 },
    { id: 307, sno: 7, date: daysAgo(1), order_number: 'ORD-004', grossWeight: 48, netWeight: 13, actualWeight: 35 },
    { id: 308, sno: 8, date: daysAgo(1), order_number: 'ORD-004', grossWeight: 65, netWeight: 18, actualWeight: 47 },
    { id: 309, sno: 9, date: daysAgo(0), order_number: 'ORD-005', grossWeight: 52, netWeight: 12, actualWeight: 40 },
    { id: 310, sno: 10, date: daysAgo(0), order_number: 'ORD-005', grossWeight: 58, netWeight: 16, actualWeight: 42 },
  ])

  // Stock usage entries — manual daily tracking of raw material consumed (per batch)
  const [stockUsage, setStockUsage] = useState([
    { id: 401, sno: 1, date: daysAgo(6), quantityUsed: 4500, quantityUnit: 'kg', quantityInKg: 4500, fromStockId: 1, fromStockLabel: `${daysAgo(6)} — 10 tons`, beforeBalance: 10000, afterBalance: 5500, logMessage: '' },
    { id: 402, sno: 2, date: daysAgo(5), quantityUsed: 3000, quantityUnit: 'kg', quantityInKg: 3000, fromStockId: 1, fromStockLabel: `${daysAgo(6)} — 10 tons`, beforeBalance: 5500, afterBalance: 2500, logMessage: '' },
    { id: 403, sno: 3, date: daysAgo(4), quantityUsed: 2500, quantityUnit: 'kg', quantityInKg: 2500, fromStockId: 1, fromStockLabel: `${daysAgo(6)} — 10 tons`, beforeBalance: 2500, afterBalance: 0, logMessage: '' },
    { id: 404, sno: 4, date: daysAgo(4), quantityUsed: 2500, quantityUnit: 'kg', quantityInKg: 2500, fromStockId: 2, fromStockLabel: `${daysAgo(6)} — 8 tons`, beforeBalance: 8000, afterBalance: 5500, logMessage: '' },
    { id: 405, sno: 5, date: daysAgo(3), quantityUsed: 3, quantityUnit: 'tons', quantityInKg: 3000, fromStockId: 3, fromStockLabel: `${daysAgo(5)} — 10 tons`, beforeBalance: 10000, afterBalance: 7000, logMessage: '' },
    { id: 406, sno: 6, date: daysAgo(2), quantityUsed: 4000, quantityUnit: 'kg', quantityInKg: 4000, fromStockId: 4, fromStockLabel: `${daysAgo(4)} — 12 tons`, beforeBalance: 12000, afterBalance: 8000, logMessage: '' },
    { id: 407, sno: 7, date: daysAgo(1), quantityUsed: 2000, quantityUnit: 'kg', quantityInKg: 2000, fromStockId: 2, fromStockLabel: `${daysAgo(6)} — 8 tons`, beforeBalance: 5500, afterBalance: 3500, logMessage: '' },
  ])

  // Load backend rolls on mount and populate section states
  useEffect(() => {
    fetchAllRolls()
      .then((allRolls) => {
        // Populate manufacturing data from backend
        if (allRolls.manufactured.length > 0) {
          setManufacturingData((prev) => {
            const existingIds = new Set(prev.map((p) => p.id))
            const newEntries = allRolls.manufactured
              .filter((r) => !existingIds.has(r.id))
              .map((r, idx) => ({
                id: r.id,
                sno: prev.length + idx + 1,
                date: r.entry_date || '',
                order_number: r.order_number || '—',
                grossWeight: Number(r.gross_weight),
                tareWeight: Number(r.net_weight),
                netWeight: Number(r.gross_weight) - Number(r.net_weight),
                sizeMic: '',
              }))
            const merged = [...prev, ...newEntries]
            return merged.map((item, idx) => ({ ...item, sno: idx + 1 }))
          })
        }

        // Populate trading data from backend
        if (allRolls.trading.length > 0) {
          setTradingData((prev) => {
            const existingIds = new Set(prev.map((p) => p.id))
            const newEntries = allRolls.trading
              .filter((r) => !existingIds.has(r.id))
              .map((r, idx) => ({
                id: r.id,
                sno: prev.length + idx + 1,
                date: r.entry_date || '',
                order_number: r.order_number || '—',
                netWeight: Number(r.gross_weight),
                rate: 0,
                totalValue: 0,
                sizeMic: '',
                type: 'Buy',
              }))
            const merged = [...prev, ...newEntries]
            return merged.map((item, idx) => ({ ...item, sno: idx + 1 }))
          })
        }

        // Populate wastage data from backend
        if (allRolls.waste.length > 0) {
          setWastageData((prev) => {
            const existingIds = new Set(prev.map((p) => p.id))
            const newEntries = allRolls.waste
              .filter((r) => !existingIds.has(r.id))
              .map((r, idx) => ({
                id: r.id,
                sno: prev.length + idx + 1,
                date: r.entry_date || '',
                order_number: r.order_number || '—',
                grossWeight: Number(r.gross_weight),
                netWeight: Number(r.net_weight),
                actualWeight: Number(r.gross_weight) - Number(r.net_weight),
              }))
            const merged = [...prev, ...newEntries]
            return merged.map((item, idx) => ({ ...item, sno: idx + 1 }))
          })
        }
      })
      .catch(() => { })
  }, [])

  return (
    <ToastProvider>
      <Router>
        <div className="flex min-h-screen bg-bg-primary">
          <Sidebar />
          <main className="flex-1 ml-0 lg:ml-64 pt-18 lg:pt-0 p-4 lg:p-8 overflow-auto">
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
                element={
                  <Manufacturing
                    data={manufacturingData}
                    setData={setManufacturingData}
                    rawMaterials={rawMaterials}
                    stockUsage={stockUsage}
                    setStockUsage={setStockUsage}
                  />
                }
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
                    wastageData={wastageData}
                    setWastageData={setWastageData}
                    stockUsage={stockUsage}
                    setStockUsage={setStockUsage}
                  />
                }
              />
              <Route path="/log-history" element={
                <LogHistory
                  rawMaterials={rawMaterials}
                  manufacturingData={manufacturingData}
                  tradingData={tradingData}
                  wastageData={wastageData}
                  stockUsage={stockUsage}
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
            </Routes>
          </main>
        </div>
      </Router>
    </ToastProvider>
  )
}

export default App
