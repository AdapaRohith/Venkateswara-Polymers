import { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import SummaryCard from '../components/SummaryCard'
import { WastageAreaChart } from '../components/Charts'
import { useToast } from '../components/Toast'
import usePersistentState from '../hooks/usePersistentState'
import api from '../utils/api'
import { inventoryTransactionsToState } from '../utils/inventory'

function toNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function formatKg(value) {
  return `${toNumber(value).toFixed(2)} kg`
}

function formatDate(value) {
  if (!value) return '-'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export default function Wastage({ user, ordersList = [] }) {
  const isOwner = user?.role === 'owner'
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [wastageRows, setWastageRows] = useState([])

  const [exporting, setExporting] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [form, setForm] = usePersistentState('vp_wastage_form', {
    date: new Date().toISOString().split('T')[0],
    order_number: '',
    gross_weight: '',
    net_weight: '',
  })

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!form.date || !form.order_number || !form.gross_weight || !form.net_weight) {
      toast.error('Please fill all required fields')
      return
    }

    if (Number(form.gross_weight) < Number(form.net_weight)) {
       toast.error('Gross weight cannot be less than net weight')
       return
    }

    try {
      setSubmitting(true)
      const payload = {
         sno: wastageRows.length + 1,
         date: form.date,
         order_number: form.order_number,
         gross_weight: Number(form.gross_weight),
         net_weight: Number(form.net_weight)
      }
      await api.post('/wastage', payload)
      toast.success('Wastage logged successfully')
      
      // Reset numeric fields
      setForm(prev => ({ ...prev, gross_weight: '', net_weight: '' }))
      
      // Refresh list
      await loadWastage({ value: false })
      
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to log wastage')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  const handleExport = async () => {
    try {
      setExporting(true)
      await fetch('https://n8n.avlokai.com/webhook-test/77d8abd5-246a-4797-8370-1ebfdb10ffec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'wastage', logs: wastageRows }),
      })
      toast.success('Logs exported successfully!')
    } catch (err) {
      console.error('Export failed', err)
      toast.error('Failed to export logs.')
    } finally {
      setExporting(false)
    }
  }

  const loadWastage = useCallback(async (cancelled = { value: false }) => {
    setLoading(true)
    setError('')

    try {
      const [transactionsRes, balancesRes] = await Promise.all([
        api.get('/inventory/transactions'),
        api.get('/inventory/balance'),
      ])

      const transactions = Array.isArray(transactionsRes.data) ? transactionsRes.data : []
      const balances = Array.isArray(balancesRes.data) ? balancesRes.data : []
      const nextState = inventoryTransactionsToState(transactions, balances)

      if (!cancelled.value) {
        setWastageRows(nextState.wastageData || [])
      }
    } catch (loadError) {
      console.error('Failed to load wastage data', loadError)
      if (!cancelled.value) {
        setError(loadError?.response?.data?.error || loadError?.message || 'Failed to load wastage data')
      }
    } finally {
      if (!cancelled.value) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const cancelled = { value: false }
    loadWastage(cancelled)

    return () => {
      cancelled.value = true
    }
  }, [loadWastage])

  const summary = useMemo(() => {
    const rows = Array.isArray(wastageRows) ? wastageRows : []
    const totalGrossWeight = rows.reduce((sum, row) => sum + toNumber(row.grossWeight), 0)
    const totalNetWeight = rows.reduce((sum, row) => sum + toNumber(row.netWeight), 0)
    const totalActualWeight = totalGrossWeight - totalNetWeight

    return {
      totalActualWeight,
      totalGrossWeight,
      totalNetWeight,
      entryCount: rows.length,
      averageActualWeight: rows.length > 0 ? totalActualWeight / rows.length : 0,
    }
  }, [wastageRows])

  const chartData = useMemo(() => {
    const dailyTotals = {}

    ;(Array.isArray(wastageRows) ? wastageRows : []).forEach((row) => {
      const date = String(row.date || '')
      if (!date) return

      dailyTotals[date] = (dailyTotals[date] || 0) + toNumber(row.actualWeight)
    })

    return Object.entries(dailyTotals)
      .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
      .map(([date, total]) => ({
        name: date,
        value: Number(toNumber(total).toFixed(2)),
      }))
  }, [wastageRows])

  const recentRows = useMemo(
    () =>
      [...(Array.isArray(wastageRows) ? wastageRows : [])]
        .sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')))
        .slice(0, 10),
    [wastageRows],
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Wastage</h2>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-5 mt-6 mb-8">
        <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">Log Wastage</h3>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Date</label>
            <input type="date" name="date" value={form.date} onChange={handleChange} required className="w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold" />
          </div>

          <div className="space-y-2 lg:col-span-1">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Order</label>
            <select name="order_number" value={form.order_number} onChange={handleChange} required className="w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold appearance-none cursor-pointer">
              <option value="">{ordersList.length > 0 ? 'Select order...' : 'No orders available'}</option>
              {ordersList.map((o) => (
                <option key={o.order_number} value={o.order_number}>{o.order_number} {o.client_name ? `(${o.client_name})` : ''}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Gross (kg)</label>
            <input type="number" name="gross_weight" value={form.gross_weight} onChange={handleChange} required step="0.01" placeholder="0.00" className="w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold" />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Net (kg)</label>
            <input type="number" name="net_weight" value={form.net_weight} onChange={handleChange} required step="0.01" placeholder="0.00" className="w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold" />
          </div>

          <div className="lg:col-span-4 flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-accent-gold px-6 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-accent-gold/90 disabled:opacity-50"
            >
              {submitting ? 'Logging...' : 'Log Wastage'}
            </button>
          </div>
        </form>
      </div>

      {isOwner && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title="Logged Wastage"
              value={loading ? 'Loading...' : formatKg(summary.totalActualWeight)}
              subtitle="Total actual wastage recorded"
              icon={(
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.108 0 00-7.5 0" />
                </svg>
              )}
            />
            <SummaryCard
              title="Gross Weight"
              value={loading ? 'Loading...' : formatKg(summary.totalGrossWeight)}
              subtitle="Total gross input on wastage logs"
              icon={(
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18m9-9H3" />
                </svg>
              )}
            />
            <SummaryCard
              title="Net Weight"
              value={loading ? 'Loading...' : formatKg(summary.totalNetWeight)}
              subtitle="Total net output tied to logs"
              icon={(
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                </svg>
              )}
            />
            <SummaryCard
              title="Average / Entry"
              value={loading ? 'Loading...' : formatKg(summary.averageActualWeight)}
              subtitle={loading ? 'Loading...' : `${summary.entryCount} wastage logs`}
              icon={(
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.5 4.5L21.75 7.5" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 7.5h5.25v5.25" />
                </svg>
              )}
            />
          </div>

          {chartData.length > 0 ? (
            <WastageAreaChart data={chartData} />
          ) : (
            <div className="rounded-xl border border-border-default bg-bg-card p-6 text-sm text-text-secondary shadow-lg shadow-black/20">
              {loading ? 'Loading wastage graph...' : 'No wastage graph data available yet.'}
            </div>
          )}
        </>
      )}

      <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
        <div className="px-6 pt-6 pb-4 flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">Recent Wastage Logs</h3>
          {isOwner && (
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || wastageRows.length === 0}
              className="rounded-lg bg-accent-gold px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-accent-gold/90 disabled:opacity-50"
            >
              {exporting ? 'Exporting...' : 'Export Logs'}
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default">
                <th className="px-6 py-4 text-left text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">
                  Date
                </th>
                <th className="px-6 py-4 text-left text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">
                  Order
                </th>
                <th className="px-6 py-4 text-right text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">
                  Gross (kg)
                </th>
                <th className="px-6 py-4 text-right text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">
                  Net (kg)
                </th>
                <th className="px-6 py-4 text-right text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">
                  Actual Wastage (kg)
                </th>
              </tr>
            </thead>
            <tbody>
              {!loading && recentRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-sm text-text-secondary/50">
                    No wastage entries logged yet.
                  </td>
                </tr>
              ) : (
                recentRows.map((row, index) => (
                  <tr
                    key={row.id ?? row.transactionId ?? `${row.date}-${index}`}
                    className={`border-b border-border-subtle transition-colors duration-150 hover:bg-white/[0.02] ${
                      index % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.01]'
                    }`}
                  >
                    <td className="px-6 py-3.5 text-text-primary/90">{formatDate(row.date)}</td>
                    <td className="px-6 py-3.5 text-text-primary/90">{row.order_number || '-'}</td>
                    <td className="px-6 py-3.5 text-right text-text-primary/90">{toNumber(row.grossWeight).toFixed(2)}</td>
                    <td className="px-6 py-3.5 text-right text-text-primary/90">{toNumber(row.netWeight).toFixed(2)}</td>
                    <td className="px-6 py-3.5 text-right font-semibold text-accent-gold">
                      {toNumber(row.actualWeight).toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
