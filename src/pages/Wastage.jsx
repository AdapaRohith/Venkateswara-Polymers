import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import SummaryCard from '../components/SummaryCard'
import { WastageAreaChart } from '../components/Charts'
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

export default function Wastage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [wastageRows, setWastageRows] = useState([])

  useEffect(() => {
    let cancelled = false

    const loadWastage = async () => {
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

        if (!cancelled) {
          setWastageRows(nextState.wastageData || [])
        }
      } catch (loadError) {
        console.error('Failed to load wastage data', loadError)
        if (!cancelled) {
          setError(loadError?.response?.data?.error || loadError?.message || 'Failed to load wastage data')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadWastage()

    return () => {
      cancelled = true
    }
  }, [])

  const summary = useMemo(() => {
    const rows = Array.isArray(wastageRows) ? wastageRows : []
    const totalActualWeight = rows.reduce((sum, row) => sum + toNumber(row.actualWeight), 0)
    const totalGrossWeight = rows.reduce((sum, row) => sum + toNumber(row.grossWeight), 0)
    const totalNetWeight = rows.reduce((sum, row) => sum + toNumber(row.netWeight), 0)

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

      <div className="rounded-[28px] border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent-gold">Active Tracking</p>
        <h2 className="mt-3 text-3xl font-semibold text-text-primary">Wastage is live again.</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
          Review logged wastage, track daily loss trends, and jump directly into floor stock or production session from here.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Link
            to="/stocks"
            className="block rounded-2xl border border-border-default bg-bg-input/15 px-5 py-4 text-sm font-semibold text-text-primary transition-colors hover:bg-white/[0.02]"
          >
            View Floor Stock
          </Link>
          <Link
            to="/production-session"
            className="block rounded-2xl border border-border-default bg-bg-input/15 px-5 py-4 text-sm font-semibold text-text-primary transition-colors hover:bg-white/[0.02]"
          >
            Go To Production Session
          </Link>
        </div>
      </div>

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

      <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">Recent Wastage Logs</h3>
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
