import { useEffect, useMemo, useState } from 'react'
import api from '../utils/api'

function formatKg(kg) {
  if (kg === undefined || kg === null) return '0.00 kg'
  if (Math.abs(kg) >= 1000) return `${(kg / 1000).toFixed(2)} tons`
  return `${kg.toFixed(2)} kg`
}

function getStatusBadge(status) {
  const statusMap = {
    active: 'bg-amber-500/15 text-amber-400',
    completed: 'bg-emerald-500/15 text-emerald-400',
    cancelled: 'bg-red-500/15 text-red-400',
  }

  return statusMap[(status || '').toLowerCase()] || 'bg-gray-500/15 text-gray-400'
}

export default function LogHistory({
  rawMaterials = [],
  manufacturingData = [],
  tradingData = [],
  wastageData = [],
  stockUsage = [],
}) {
  const [date, setDate] = useState('')
  const [orders, setOrders] = useState([])

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const { data } = await api.get('/orders')
        setOrders(data)
      } catch (error) {
        console.error('Failed to load orders:', error)
      }
    }

    fetchOrders()
  }, [])

  const getOrderStatus = (orderNumber) => {
    if (orderNumber === '—') return null
    const order = orders.find((item) => item.order_number === orderNumber)
    return order?.status || null
  }

  const allEntries = useMemo(() => {
    const entries = []

    rawMaterials.forEach((item) => {
      entries.push({
        id: item.id,
        section: 'Raw Material',
        date: item.date,
        order_number: item.order_number || '—',
        grossWeight: item.grossWeight,
        tareWeight: item.tareWeight,
        netWeight: item.netWeight,
        sizeMic: item.sizeMic || '',
      })
    })

    manufacturingData.forEach((item) => {
      entries.push({
        id: item.id,
        section: 'Manufacturing',
        date: item.date,
        order_number: item.order_number || '—',
        grossWeight: item.grossWeight,
        tareWeight: item.tareWeight,
        netWeight: item.netWeight,
        sizeMic: item.sizeMic || '',
      })
    })

    tradingData.forEach((item) => {
      entries.push({
        id: item.id,
        section: 'Trading',
        date: item.date,
        order_number: item.order_number || '—',
        grossWeight: item.netWeight,
        tareWeight: 0,
        netWeight: item.netWeight,
        sizeMic: item.sizeMic || '',
        rate: item.rate,
        totalValue: item.totalValue,
        type: item.type,
      })
    })

    wastageData.forEach((item) => {
      entries.push({
        id: item.id,
        section: 'Wastage',
        date: item.date,
        order_number: item.order_number || '—',
        grossWeight: item.grossWeight,
        tareWeight: item.netWeight,
        netWeight: item.actualWeight || item.grossWeight - item.netWeight,
        sizeMic: '',
      })
    })

    stockUsage.forEach((item) => {
      entries.push({
        id: item.id,
        section: 'Stock Usage',
        date: item.date,
        order_number: '—',
        grossWeight: 0,
        tareWeight: 0,
        netWeight: item.quantityInKg,
        sizeMic: '',
        stockBatch: item.fromStockLabel,
        beforeBalance: item.beforeBalance,
        afterBalance: item.afterBalance,
        source: item.source || 'Manual',
      })
    })

    return entries
  }, [manufacturingData, rawMaterials, stockUsage, tradingData, wastageData])

  const filtered = useMemo(() => {
    if (!date) return allEntries
    return allEntries.filter((item) => item.date === date)
  }, [allEntries, date])

  const grouped = useMemo(() => {
    const map = {}
    filtered.forEach((item) => {
      if (!map[item.section]) map[item.section] = []
      map[item.section].push(item)
    })
    return map
  }, [filtered])

  const sectionOrder = ['Raw Material', 'Manufacturing', 'Trading', 'Wastage', 'Stock Usage']

  const sectionColors = {
    'Raw Material': 'bg-blue-500/15 text-blue-400',
    Manufacturing: 'bg-accent-gold/15 text-accent-gold',
    Trading: 'bg-emerald-500/15 text-emerald-400',
    Wastage: 'bg-red-500/15 text-red-400',
    'Stock Usage': 'bg-violet-500/15 text-violet-400',
  }

  const inputClass =
    'bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold'

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Log History</h2>
          <p className="mt-1 text-sm text-text-secondary">
            View records from Raw Material, Manufacturing, Trading, Wastage, and Stock Usage sections.
          </p>
        </div>

        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Filter by Date</label>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className={inputClass}
            />
          </div>

          {date && (
            <button onClick={() => setDate('')} className="pb-2.5 text-xs text-accent-gold hover:underline">
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3 lg:grid-cols-5">
        {sectionOrder.map((section) => (
          <div key={section} className="relative overflow-hidden rounded-xl border border-border-default bg-bg-card p-6 shadow-lg shadow-black/30">
            <div className="absolute left-0 right-0 top-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
            <p className="mb-1 text-xs font-medium uppercase tracking-widest text-text-secondary/70">{section}</p>
            <p className="text-3xl font-semibold text-text-primary">{(grouped[section] || []).length}</p>
            <p className="mt-1 text-xs text-text-secondary/50">entries{date ? ` on ${date}` : ''}</p>
          </div>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="overflow-hidden rounded-xl border border-border-default bg-bg-card shadow-lg shadow-black/30">
          <p className="py-12 text-center text-sm text-text-secondary/50">
            No records found{date ? ` for ${date}` : ''}. Add entries in the respective sections first.
          </p>
        </div>
      ) : (
        sectionOrder.map((section) => {
          const rows = grouped[section]
          if (!rows || rows.length === 0) return null

          if (section === 'Stock Usage') {
            return (
              <div key={section} className="overflow-hidden rounded-xl border border-border-default bg-bg-card shadow-lg shadow-black/30">
                <div className="flex items-center gap-3 border-b border-border-default px-6 py-4">
                  <span className={`rounded px-2.5 py-1 text-xs font-medium ${sectionColors[section]}`}>
                    {section}
                  </span>
                  <h3 className="text-sm font-medium uppercase tracking-widest text-text-secondary/70">
                    - {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
                  </h3>
                </div>

                <div className="space-y-2 px-4 pb-4 pt-2">
                  {rows.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-start gap-3 rounded-lg border border-border-default/50 bg-white/[0.01] px-4 py-3 transition-colors hover:bg-white/[0.03]"
                    >
                      <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-400" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-relaxed text-text-primary">
                          <span className="font-semibold text-violet-400">{formatKg(row.netWeight)}</span>{' '}
                          used from stock{' '}
                          <span className="font-medium text-accent-gold">({row.stockBatch})</span>
                          {row.source && row.source !== 'Manual' && (
                            <span className={`ml-2 rounded px-2 py-0.5 text-[10px] font-medium ${row.source === 'Manufacturing' ? 'bg-accent-gold/15 text-accent-gold' : 'bg-red-500/15 text-red-400'}`}>
                              {row.source}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-text-secondary/60">
                          {formatKg(row.beforeBalance)} → {formatKg(row.afterBalance)} remaining
                        </p>
                        <p className="mt-1 text-[10px] text-text-secondary/40">{row.date}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          }

          return (
            <div key={section} className="overflow-hidden rounded-xl border border-border-default bg-bg-card shadow-lg shadow-black/30">
              <div className="flex items-center gap-3 border-b border-border-default px-6 py-4">
                <span className={`rounded px-2.5 py-1 text-xs font-medium ${sectionColors[section]}`}>
                  {section}
                </span>
                <h3 className="text-sm font-medium uppercase tracking-widest text-text-secondary/70">
                  - {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">S.No</th>
                      <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">Date</th>
                      {section !== 'Raw Material' && (
                        <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">Order &amp; Status</th>
                      )}
                      <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">Gross</th>
                      <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">Tare</th>
                      <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">Net</th>
                      {section === 'Trading' && (
                        <>
                          <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">Rate</th>
                          <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">Total</th>
                          <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">Type</th>
                        </>
                      )}
                      <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">Size &amp; Mic</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr
                        key={row.id}
                        className={`border-b border-border-subtle transition-colors hover:bg-white/[0.02] ${index % 2 === 0 ? '' : 'bg-white/[0.01]'}`}
                      >
                        <td className="px-6 py-3 text-text-secondary">{index + 1}</td>
                        <td className="px-6 py-3 text-text-primary/90">{row.date}</td>
                        {section !== 'Raw Material' && (
                          <td className="px-6 py-3 font-medium text-text-primary/90">
                            <div className="flex flex-wrap items-center gap-2">
                              <span>{row.order_number}</span>
                              {getOrderStatus(row.order_number) && (
                                <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${getStatusBadge(getOrderStatus(row.order_number))}`}>
                                  {getOrderStatus(row.order_number)}
                                </span>
                              )}
                            </div>
                          </td>
                        )}
                        <td className="px-6 py-3 text-text-primary/90">{Number(row.grossWeight).toFixed(2)}</td>
                        <td className="px-6 py-3 text-text-primary/90">{Number(row.tareWeight).toFixed(2)}</td>
                        <td className="px-6 py-3 font-medium text-accent-gold">{Number(row.netWeight).toFixed(2)}</td>
                        {section === 'Trading' && (
                          <>
                            <td className="px-6 py-3 text-text-primary/90">₹{Number(row.rate).toFixed(2)}</td>
                            <td className="px-6 py-3 text-text-primary/90">
                              ₹{Number(row.totalValue).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-6 py-3">
                              <span className={`rounded px-2 py-0.5 text-xs font-medium ${row.type === 'Buy' ? 'bg-accent-gold/15 text-accent-gold' : 'bg-emerald-500/15 text-emerald-400'}`}>
                                {row.type}
                              </span>
                            </td>
                          </>
                        )}
                        <td className="px-6 py-3 text-text-secondary">{row.sizeMic || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}