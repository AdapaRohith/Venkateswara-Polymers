import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../components/Toast'
import { TrendLineChart } from '../components/Charts'
import api from '../utils/api'

function toNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function formatKg(kg) {
  const numericValue = toNumber(kg)
  if (Math.abs(numericValue) >= 1000) return `${(numericValue / 1000).toFixed(2)} tons`
  return `${numericValue.toFixed(2)} kg`
}

function formatDateTime(value) {
  if (!value) return '—'

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)

  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ProductionSession() {
  const toast = useToast()

  const [activeSession, setActiveSession] = useState(null)
  const [machineId, setMachineId] = useState("")
  const [grossWeight, setGrossWeight] = useState("")
  const [tareWeight, setTareWeight] = useState("")
  const [floorStock, setFloorStock] = useState([])
  const [loading, setLoading] = useState(false)
  
  // Keep logs to not break UI logic existing
  const [logs, setLogs] = useState([])

  const refreshFloorStock = async () => {
    try {
      const { data } = await api.get('/floor/stock')
      setFloorStock(data)
    } catch (err) {
      console.error(err.response?.data || err)
    }
  }

  const checkActiveSession = async () => {
    try {
      const storedSessionId = localStorage.getItem('production_session_id')
      if (storedSessionId) {
        const { data } = await api.get(`/production/active-v2?session_id=${storedSessionId}`)
        if (data) {
          setActiveSession(data)
          setMachineId(data.machine_id)
        } else {
          localStorage.removeItem('production_session_id')
        }
      }
    } catch (err) {
      console.error(err.response?.data || err)
    }
  }

  useEffect(() => {
    checkActiveSession()
    refreshFloorStock()
  }, [])

  const floorTotalKg = useMemo(
    () => (Array.isArray(floorStock) ? floorStock : []).reduce((sum, row) => sum + toNumber(row.total_quantity_kg), 0),
    [floorStock],
  )

  const netPreview = useMemo(() => Math.max(toNumber(grossWeight) - toNumber(tareWeight), 0), [grossWeight, tareWeight])

  const sessionTrendData = useMemo(() => {
    const ordered = (Array.isArray(logs) ? logs : []).slice().reverse()
    let cumulative = 0
    return ordered.map((row, index) => {
      cumulative += toNumber(row.netWeight)
      return {
        label: `#${index + 1}`,
        value: Number(cumulative.toFixed(2)),
      }
    })
  }, [logs])

  const canLog = Boolean(activeSession) && !loading && String(grossWeight) !== '' && String(tareWeight) !== '' && toNumber(grossWeight) > toNumber(tareWeight)

  const inputClass =
    'w-full rounded-xl border border-border-default bg-bg-input px-4 py-3 text-sm text-text-primary transition-colors focus:border-accent-gold disabled:cursor-not-allowed disabled:opacity-60'

  const handleStart = async () => {
    if (loading) return
    if (!machineId) {
      toast.error('Please select a machine')
      return
    }
    
    setLoading(true)
    try {
      const { data } = await api.post('/production/start-v2', { machine_id: Number(machineId) })
      setActiveSession(data)
      localStorage.setItem('production_session_id', data.id)
      toast.success('Session started')
      setLogs([])
    } catch (error) {
      console.error(error.response?.data || error)
      toast.error(error?.response?.data?.error || 'Failed to start session')
    } finally {
      setLoading(false)
    }
  }

  const handleLog = async (event) => {
    event.preventDefault()

    if (!activeSession) {
      toast.error('Start a session first')
      return
    }

    const gross = toNumber(grossWeight)
    const tare = toNumber(tareWeight)
    if (gross <= tare) {
      toast.error('Gross weight must be greater than tare weight')
      return
    }

    setLoading(true)
    try {
      const { data } = await api.post('/production/log-v2', {
        session_id: activeSession.id,
        gross_weight: gross,
        tare_weight: tare,
      })

      setLogs((previous) => [
        {
          id: data?.id ?? `${Date.now()}`,
          grossWeight: gross,
          tareWeight: tare,
          netWeight: toNumber(data?.net_weight ?? data?.netWeight, Math.max(gross - tare, 0)),
          createdAt: data?.created_at ?? data?.createdAt ?? new Date().toISOString(),
        },
        ...previous,
      ])

      setGrossWeight('')
      setTareWeight('')
      toast.success('Entry logged')
      await refreshFloorStock()
    } catch (error) {
      console.error(error.response?.data || error)
      toast.error(error?.response?.data?.error || 'Failed to log entry')
    } finally {
      setLoading(false)
    }
  }

  const handleEnd = async () => {
    if (!activeSession || loading) return
    setLoading(true)
    try {
      await api.post('/production/end-v2', { session_id: activeSession.id })
      setActiveSession(null)
      setMachineId('')
      localStorage.removeItem('production_session_id')
      setLogs([])
      setGrossWeight('')
      setTareWeight('')
      toast.success('Session ended')
      await refreshFloorStock()
    } catch (error) {
      console.error(error.response?.data || error)
      toast.error(error?.response?.data?.error || 'Failed to end session')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {!activeSession ? (
        <section className="space-y-6 rounded-[28px] border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20 md:p-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent-gold">Session Setup</p>
              <h2 className="mt-3 text-3xl font-semibold text-text-primary">Start a production run.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
                Floor materials are pooled. Start a session to log production on a specific machine.
              </p>
            </div>
            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">Machine</label>
                <select 
                  value={machineId} 
                  onChange={(e) => setMachineId(e.target.value)} 
                  className={inputClass}
                  style={{ minWidth: '150px' }}
                >
                  <option value="">Select...</option>
                  {[1, 2, 3, 4, 5].map(m => (
                    <option key={m} value={m}>Machine {m}</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={handleStart}
                disabled={loading || !machineId}
                className="rounded-2xl bg-accent-gold px-5 py-3.5 text-sm font-semibold text-black transition-colors hover:bg-accent-gold-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'Starting...' : 'Start Session'}
              </button>
            </div>
          </div>
          <div className="rounded-2xl border border-border-default bg-bg-input/30 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-secondary/60">Current Floor Stock</p>
            <p className="mt-2 text-2xl font-semibold text-text-primary">{formatKg(floorTotalKg)}</p>
            <p className="mt-2 text-sm text-text-secondary">Available pooled material on the floor right now.</p>
          </div>
        </section>
      ) : (
        <div className="space-y-6">
          <section className="overflow-hidden rounded-[28px] border border-border-default bg-bg-card shadow-lg shadow-black/20">
            <div className="bg-[radial-gradient(circle_at_top_left,_rgba(25,178,179,0.22),_transparent_45%),linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0))] px-6 py-7 md:px-8">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent-gold">Production Session</p>
                  <h1 className="mt-3 text-3xl font-semibold text-text-primary">Machine: {activeSession.machine_id}</h1>
                  <p className="mt-3 text-sm leading-6 text-text-secondary">
                    Session ID: {activeSession.id} <br />
                    Log entries to consume from the floor pool. End the session when finished.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleEnd}
                  disabled={loading}
                  className="rounded-2xl border border-red-500/25 bg-red-500/10 px-5 py-3 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Processing...' : 'End Session'}
                </button>
              </div>
            </div>

            <div className="grid gap-4 border-t border-border-default bg-bg-input/15 px-6 py-5 md:grid-cols-3 md:px-8">
              <div className="rounded-2xl border border-border-default bg-bg-card/80 p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-secondary/60">Current Floor Stock</p>
                <p className="mt-2 text-2xl font-semibold text-accent-gold">{formatKg(floorTotalKg)}</p>
              </div>
              <div className="rounded-2xl border border-border-default bg-bg-card/80 p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-secondary/60">Entries Logged</p>
                <p className="mt-2 text-2xl font-semibold text-text-primary">{String(logs.length)}</p>
              </div>
              <div className="rounded-2xl border border-border-default bg-bg-card/80 p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-secondary/60">Net Preview</p>
                <p className="mt-2 text-2xl font-semibold text-emerald-400">{formatKg(netPreview)}</p>
              </div>
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div className="rounded-[28px] border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20 md:p-8">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary/70">Current Floor Stock</p>
                <h2 className="mt-2 text-xl font-semibold text-text-primary">Live pooled balances</h2>
              </div>

              <div className="mt-6 overflow-x-auto rounded-2xl border border-border-default bg-bg-input/15">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">
                        Material Name
                      </th>
                      <th className="px-6 py-3 text-right text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">
                        Qty (kg)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(floorStock || []).length === 0 ? (
                      <tr>
                        <td colSpan={2} className="px-6 py-10 text-center text-sm text-text-secondary/50">
                          No floor stock yet.
                        </td>
                      </tr>
                    ) : (
                      (floorStock || []).map((row, index) => (
                        <tr
                          key={row.material_type_id ?? index}
                          className={`border-b border-border-subtle transition-colors hover:bg-white/[0.02] ${
                            index % 2 === 0 ? '' : 'bg-white/[0.01]'
                          }`}
                        >
                          <td className="px-6 py-3 text-text-primary/90">{row.material_name}</td>
                          <td className="px-6 py-3 text-right font-semibold text-accent-gold">
                            {toNumber(row.total_quantity_kg).toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[28px] border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20 md:p-8">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary/70">Log Entry</p>
                  <h2 className="mt-2 text-xl font-semibold text-text-primary">Gross / tare logging</h2>
                  <p className="mt-3 text-sm leading-6 text-text-secondary">
                    Net weight is calculated from gross - tare.
                  </p>
                </div>

                <form onSubmit={handleLog} className="mt-6 space-y-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">Gross Weight</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={grossWeight}
                        onChange={(event) => setGrossWeight(event.target.value)}
                        className={inputClass}
                        placeholder="0.00"
                        disabled={loading}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">Tare Weight</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={tareWeight}
                        onChange={(event) => setTareWeight(event.target.value)}
                        className={inputClass}
                        placeholder="0.00"
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-accent-gold/20 bg-accent-gold/10 p-4">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-accent-gold/80">Net Weight Preview</p>
                    <p className="mt-2 text-3xl font-semibold text-accent-gold">{netPreview > 0 ? formatKg(netPreview) : '0.00 kg'}</p>
                  </div>

                  <button
                    type="submit"
                    disabled={!canLog}
                    className="w-full rounded-2xl bg-accent-gold px-5 py-4 text-sm font-semibold text-black transition-colors hover:bg-accent-gold-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? 'Saving Entry...' : 'Add Entry'}
                  </button>
                </form>
              </div>

              <div className="rounded-[28px] border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20 md:p-8">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary/70">Session Log</p>
                  <h2 className="mt-2 text-xl font-semibold text-text-primary">Recent entries</h2>
                </div>

                <div className="mt-6 overflow-x-auto rounded-2xl border border-border-default bg-bg-input/15">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border-default">
                        <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">Time</th>
                        <th className="px-6 py-3 text-right text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">Gross</th>
                        <th className="px-6 py-3 text-right text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">Tare</th>
                        <th className="px-6 py-3 text-right text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-6 py-10 text-center text-sm text-text-secondary/50">
                            No entries logged yet.
                          </td>
                        </tr>
                      ) : (
                        logs.map((row, index) => (
                          <tr
                            key={row.id ?? index}
                            className={`border-b border-border-subtle transition-colors hover:bg-white/[0.02] ${
                              index % 2 === 0 ? '' : 'bg-white/[0.01]'
                            }`}
                          >
                            <td className="px-6 py-3 text-text-primary/90">{formatDateTime(row.createdAt)}</td>
                            <td className="px-6 py-3 text-right text-text-primary/90">{toNumber(row.grossWeight).toFixed(2)}</td>
                            <td className="px-6 py-3 text-right text-text-primary/90">{toNumber(row.tareWeight).toFixed(2)}</td>
                            <td className="px-6 py-3 text-right font-semibold text-accent-gold">{toNumber(row.netWeight).toFixed(2)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {sessionTrendData.length > 0 && (
                <TrendLineChart
                  data={sessionTrendData}
                  title="Session Output Trend (kg)"
                  color="#a78bfa"
                  gradientId="gradSessionOut"
                />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
