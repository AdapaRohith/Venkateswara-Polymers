import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../components/Toast'
import api from '../utils/api'

const emptyMachine = () => ({ gross_weight: '', tare_weight: '', size: '', note: '' })

function calcNet(gross, tare) {
  const g = parseFloat(gross)
  const t = parseFloat(tare)
  if (!Number.isFinite(g) || !Number.isFinite(t)) return null
  return Math.round((g - t) * 1000) / 1000
}

function MachineCard({ machine, values, onChange, index, firstRef }) {
  const net = calcNet(values.gross_weight, values.tare_weight)
  const isValid = net !== null && net > 0
  const isInvalid = values.gross_weight !== '' && values.tare_weight !== '' && net !== null && net <= 0

  return (
    <div
      className={`bg-bg-card rounded-2xl border transition-all duration-200 shadow-sm ${
        isInvalid
          ? 'border-red-500/50 shadow-red-500/10'
          : values.gross_weight || values.tare_weight
          ? 'border-accent-gold/40 shadow-accent-gold/5'
          : 'border-border-default'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isValid ? 'bg-green-400' : isInvalid ? 'bg-red-400' : 'bg-text-secondary/30'}`} />
          <span className="text-xs font-bold uppercase tracking-widest text-text-secondary/70">M{machine.id}</span>
        </div>
        <span className="text-sm font-semibold text-text-primary">{machine.name}</span>
      </div>

      {/* Inputs */}
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-secondary/60 mb-1.5">
              Gross (kg)
            </label>
            <input
              ref={index === 0 ? firstRef : undefined}
              type="number"
              step="0.001"
              min="0"
              value={values.gross_weight}
              onChange={e => onChange('gross_weight', e.target.value)}
              placeholder="0.000"
              className="w-full bg-bg-input text-text-primary border border-border-default rounded-lg px-3 py-2.5 text-sm font-mono focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/20 transition-all"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-secondary/60 mb-1.5">
              Tare (kg)
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={values.tare_weight}
              onChange={e => onChange('tare_weight', e.target.value)}
              placeholder="0.000"
              className="w-full bg-bg-input text-text-primary border border-border-default rounded-lg px-3 py-2.5 text-sm font-mono focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/20 transition-all"
            />
          </div>
        </div>

        {/* Net weight display */}
        <div className={`rounded-lg px-3 py-2 text-center border ${
          isValid
            ? 'bg-accent-gold/10 border-accent-gold/30 text-accent-gold'
            : isInvalid
            ? 'bg-red-500/10 border-red-500/30 text-red-400'
            : 'bg-bg-primary border-border-subtle text-text-secondary/40'
        }`}>
          <span className="text-[10px] font-semibold uppercase tracking-widest block mb-0.5">Net Weight</span>
          <span className="text-lg font-bold font-mono">
            {net !== null ? `${net.toFixed(3)} kg` : '—'}
          </span>
          {isInvalid && <span className="text-[10px] block mt-0.5">Net must be &gt; 0</span>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-secondary/60 mb-1.5">
              Size
            </label>
            <input
              type="text"
              value={values.size}
              onChange={e => onChange('size', e.target.value)}
              placeholder="optional"
              className="w-full bg-bg-input text-text-primary border border-border-default rounded-lg px-3 py-2.5 text-sm focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/20 transition-all"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-text-secondary/60 mb-1.5">
              Note
            </label>
            <input
              type="text"
              value={values.note}
              onChange={e => onChange('note', e.target.value)}
              placeholder="optional"
              className="w-full bg-bg-input text-text-primary border border-border-default rounded-lg px-3 py-2.5 text-sm focus:border-accent-gold focus:ring-1 focus:ring-accent-gold/20 transition-all"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ProductionLog({ user }) {
  const toast = useToast()
  const [machines, setMachines] = useState([])
  const [machinesLoading, setMachinesLoading] = useState(true)
  const [inputs, setInputs] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [lastBatch, setLastBatch] = useState(null)
  const [flash, setFlash] = useState(false)
  const firstRef = useRef(null)

  // Load machines once
  useEffect(() => {
    api.get('/machines')
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : []
        setMachines(list)
        const initial = {}
        list.forEach(m => { initial[m.id] = emptyMachine() })
        setInputs(initial)
      })
      .catch(() => toast.error('Failed to load machines'))
      .finally(() => setMachinesLoading(false))
  }, []) // eslint-disable-line

  const handleChange = useCallback((machineId, field, value) => {
    setInputs(prev => ({
      ...prev,
      [machineId]: { ...prev[machineId], [field]: value }
    }))
  }, [])

  const reset = useCallback(() => {
    setInputs(prev => {
      const fresh = {}
      Object.keys(prev).forEach(id => { fresh[id] = emptyMachine() })
      return fresh
    })
    setTimeout(() => firstRef.current?.focus(), 50)
  }, [])

  const handleSubmit = async () => {
    // Collect valid machine entries
    const validMachines = machines
      .map(m => {
        const v = inputs[m.id] || emptyMachine()
        const net = calcNet(v.gross_weight, v.tare_weight)
        if (!v.gross_weight && !v.tare_weight) return null // completely empty — skip
        if (net === null || net <= 0) return { invalid: true, name: m.name }
        return {
          machine_id: m.id,
          gross_weight: parseFloat(v.gross_weight),
          tare_weight: parseFloat(v.tare_weight),
          size: v.size || null,
          note: v.note || null,
        }
      })
      .filter(Boolean)

    const invalidEntries = validMachines.filter(e => e.invalid)
    if (invalidEntries.length > 0) {
      toast.error(`Invalid data for: ${invalidEntries.map(e => e.name).join(', ')}. Net must be > 0.`)
      return
    }

    const toSubmit = validMachines.filter(e => !e.invalid)
    if (toSubmit.length === 0) {
      toast.error('Enter data for at least one machine before submitting.')
      return
    }

    setSubmitting(true)
    try {
      const { data } = await api.post('/production/logs', {
        entered_by: user?.id,
        machines: toSubmit,
      })

      setLastBatch({ id: data.batch_id, count: toSubmit.length, inserted: data.inserted })
      setFlash(true)
      setTimeout(() => setFlash(false), 1500)

      toast.success(`✓ Batch #${data.batch_id} logged — ${toSubmit.length} machine${toSubmit.length !== 1 ? 's' : ''}`)
      reset()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Submission failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // Keyboard shortcut: Ctrl+Enter to submit
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (!submitting) handleSubmit()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [submitting, inputs]) // eslint-disable-line

  const hasAnyInput = machines.some(m => {
    const v = inputs[m.id] || emptyMachine()
    return v.gross_weight || v.tare_weight
  })

  const validCount = machines.filter(m => {
    const v = inputs[m.id] || emptyMachine()
    const net = calcNet(v.gross_weight, v.tare_weight)
    return net !== null && net > 0
  }).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Production Logging</h1>
          <p className="text-sm text-text-secondary mt-1">Enter data for all machines and submit as a single batch</p>
        </div>
        <div className="flex items-center gap-3">
          {hasAnyInput && (
            <button
              onClick={reset}
              className="px-4 py-2.5 text-sm font-medium text-text-secondary border border-border-default rounded-xl hover:bg-bg-card transition-all"
            >
              Clear All
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={submitting || !hasAnyInput}
            className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg ${
              flash
                ? 'bg-green-500 text-white shadow-green-500/30 scale-105'
                : 'bg-accent-gold text-white hover:bg-accent-gold-hover shadow-accent-gold/20 disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Submitting...
              </span>
            ) : flash ? (
              '✓ Submitted!'
            ) : (
              `Submit Entry${validCount > 0 ? ` (${validCount})` : ''}`
            )}
          </button>
        </div>
      </div>

      {/* Keyboard hint */}
      <div className="flex items-center gap-2 text-xs text-text-secondary/50">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
        </svg>
        Press <kbd className="px-1.5 py-0.5 bg-bg-card border border-border-default rounded text-[10px] font-mono mx-1">Ctrl + Enter</kbd> to submit quickly
      </div>

      {/* Last batch info */}
      {lastBatch && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-green-400">Last batch submitted</p>
              <p className="text-xs text-text-secondary">Batch #{lastBatch.id} · {lastBatch.count} machine{lastBatch.count !== 1 ? 's' : ''} logged</p>
            </div>
          </div>
          <button onClick={() => setLastBatch(null)} className="text-text-secondary/50 hover:text-text-secondary">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Machine Grid */}
      {machinesLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-56 bg-bg-card rounded-2xl border border-border-default animate-pulse" />
          ))}
        </div>
      ) : machines.length === 0 ? (
        <div className="rounded-2xl border border-border-default bg-bg-card p-10 text-center">
          <p className="text-text-secondary">No machines found. Please set up machines in the database.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {machines.map((machine, idx) => (
            <MachineCard
              key={machine.id}
              machine={machine}
              values={inputs[machine.id] || emptyMachine()}
              onChange={(field, val) => handleChange(machine.id, field, val)}
              index={idx}
              firstRef={firstRef}
            />
          ))}
        </div>
      )}
    </div>
  )
}
