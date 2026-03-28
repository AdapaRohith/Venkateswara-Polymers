import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../components/Toast'
import DataTable from '../components/DataTable'
import SessionSetup from '../components/SessionSetup'
import SessionActive from '../components/SessionActive'
import {
  MAX_SESSION_MATERIALS,
  endProductionSession,
  fetchMachines,
  fetchProductionSessionHistory,
  findActiveProductionSession,
  logProductionEntry,
  startProductionSession,
} from '../utils/productionSession'
import { buildStockBatches, formatKg } from '../utils/stock'

const createEmptyMaterial = () => ({
  stockId: '',
  quantity: '',
})

function toNumber(value) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : 0
}

function validateSetupForm(form, materialOptions) {
  const errors = {}

  if (!form.machineId) {
    errors.machineId = 'Machine is required.'
  }

  if (!form.workerId.trim()) {
    errors.workerId = 'Worker is required.'
  }

  if (form.materials.length === 0) {
    errors.materials = 'At least one raw material is required.'
  }

  if (form.materials.length > MAX_SESSION_MATERIALS) {
    errors.materials = `You can select a maximum of ${MAX_SESSION_MATERIALS} materials.`
  }

  const selectedIds = new Set()

  form.materials.forEach((material, index) => {
    const stockKey = `material_${index}_stockId`
    const quantityKey = `material_${index}_quantity`
    const selectedOption = materialOptions.find((option) => String(option.id) === String(material.stockId))

    if (!material.stockId) {
      errors[stockKey] = 'Choose a material batch.'
    } else if (selectedIds.has(String(material.stockId))) {
      errors[stockKey] = 'Each material batch can be selected only once.'
    } else {
      selectedIds.add(String(material.stockId))
    }

    const quantity = toNumber(material.quantity)
    if (!material.quantity || quantity <= 0) {
      errors[quantityKey] = 'Quantity must be greater than zero.'
    } else if (selectedOption && quantity > selectedOption.availableToIssue) {
      errors[quantityKey] = `Quantity exceeds available stock of ${selectedOption.availableToIssue.toFixed(2)} kg.`
    }
  })

  return errors
}

function validateLogForm(grossWeight, tareWeight) {
  if (grossWeight === '' || tareWeight === '') {
    return 'Gross and tare weight are required.'
  }

  const gross = toNumber(grossWeight)
  const tare = toNumber(tareWeight)

  if (gross < 0 || tare < 0) {
    return 'Weights cannot be negative.'
  }

  if (gross <= tare) {
    return 'Gross weight must be greater than tare weight.'
  }

  return ''
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

function SummaryModal({ summary, onClose }) {
  if (!summary) return null

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/65 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border border-border-default bg-bg-card p-6 shadow-2xl shadow-black/40 md:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent-gold">Batch Complete</p>
        <h2 className="mt-3 text-2xl font-semibold text-text-primary">Session reconciled successfully.</h2>
        <div className="mt-6 grid gap-4">
          <div className="rounded-2xl border border-border-default bg-bg-input/30 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-secondary/60">Total Produced</p>
            <p className="mt-2 text-2xl font-semibold text-accent-gold">{summary.totalOutput.toFixed(2)} kg</p>
          </div>
          <div className="rounded-2xl border border-border-default bg-bg-input/30 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-secondary/60">Total Waste</p>
            <p className="mt-2 text-2xl font-semibold text-red-400">{summary.totalWaste.toFixed(2)} kg</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-2xl bg-accent-gold px-5 py-4 text-sm font-semibold text-black transition-colors hover:bg-accent-gold-hover"
        >
          Back To Setup
        </button>
      </div>
    </div>
  )
}

export default function ProductionSession({
  user,
  rawMaterials = [],
  stockUsage = [],
  stockIssuances = [],
  stockBalances = {},
  refreshInventoryData,
}) {
  const toast = useToast()
  const isOwner = user?.role === 'owner'
  const [machines, setMachines] = useState([])
  const [loadingBootstrap, setLoadingBootstrap] = useState(true)
  const [busyState, setBusyState] = useState({
    start: false,
    log: false,
    end: false,
  })
  const [pageError, setPageError] = useState('')
  const [summary, setSummary] = useState(null)
  const [setupForm, setSetupForm] = useState({
    machineId: '',
    workerId: '',
    materials: [createEmptyMaterial()],
  })
  const [setupErrors, setSetupErrors] = useState({})
  const [entryForm, setEntryForm] = useState({
    grossWeight: '',
    tareWeight: '',
  })
  const [sessionState, setSessionState] = useState({
    session: null,
    materials: [],
    logs: [],
    totalOutput: 0,
  })
  const [historyRows, setHistoryRows] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historyFilters, setHistoryFilters] = useState({
    sessionId: '',
    machineId: '',
    worker: '',
    status: 'all',
    dateFrom: '',
    dateTo: '',
  })

  const materialOptions = useMemo(
    () =>
      buildStockBatches(rawMaterials, stockUsage, stockIssuances, stockBalances)
        .filter((batch) => batch.availableToIssue > 0)
        .sort((left, right) => String(right.date || '').localeCompare(String(left.date || ''))),
    [rawMaterials, stockBalances, stockIssuances, stockUsage],
  )

  const netWeightPreview = Math.max(
    toNumber(entryForm.grossWeight) - toNumber(entryForm.tareWeight),
    0,
  )

  const loadOwnerHistory = async ({ showSpinner = true } = {}) => {
    if (!isOwner) return

    if (showSpinner) setHistoryLoading(true)
    setHistoryError('')

    try {
      const rows = await fetchProductionSessionHistory({ limit: 1000 })
      setHistoryRows(rows)
    } catch (error) {
      console.error('Failed to load production session history', error)
      setHistoryError(error?.response?.data?.error || 'Failed to load production session history.')
    } finally {
      if (showSpinner) setHistoryLoading(false)
    }
  }

  const updateHistoryFilter = (field, value) => {
    setHistoryFilters((prev) => ({ ...prev, [field]: value }))
  }

  const resetHistoryFilters = () => {
    setHistoryFilters({
      sessionId: '',
      machineId: '',
      worker: '',
      status: 'all',
      dateFrom: '',
      dateTo: '',
    })
  }

  useEffect(() => {
    let mounted = true

    const bootstrap = async () => {
      setLoadingBootstrap(true)
      setPageError('')

      try {
        const loadedMachines = await fetchMachines()
        if (!mounted) return

        setMachines(loadedMachines)

        // Backend exposes active session lookup per machine, so bootstrap checks each known machine.
        const activeSession = await findActiveProductionSession(loadedMachines)
        if (!mounted) return

        if (activeSession) {
          setSessionState(activeSession)
          setSetupForm((prev) => ({
            ...prev,
            machineId: activeSession.session.machineId ? String(activeSession.session.machineId) : '',
            workerId: activeSession.session.workerName || activeSession.session.workerId || '',
          }))
        }
      } catch (error) {
        console.error('Failed to initialize production session page', error)
        if (mounted) {
          setPageError(error.response?.data?.error || 'Failed to load production session data.')
        }
      } finally {
        if (mounted) {
          setLoadingBootstrap(false)
        }
      }
    }

    bootstrap()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!isOwner) return

    let mounted = true

    const loadHistory = async () => {
      setHistoryLoading(true)
      setHistoryError('')
      try {
        const rows = await fetchProductionSessionHistory({ limit: 1000 })
        if (!mounted) return
        setHistoryRows(rows)
      } catch (error) {
        console.error('Failed to load production session history', error)
        if (!mounted) return
        setHistoryError(error?.response?.data?.error || 'Failed to load production session history.')
      } finally {
        if (mounted) {
          setHistoryLoading(false)
        }
      }
    }

    loadHistory()

    return () => {
      mounted = false
    }
  }, [isOwner])

  const isBusy = busyState.start || busyState.log || busyState.end

  const filteredHistory = useMemo(() => {
    const sessionIdFilter = historyFilters.sessionId.trim().toLowerCase()
    const machineIdFilter = historyFilters.machineId.trim()
    const workerFilter = historyFilters.worker.trim().toLowerCase()
    const statusFilter = historyFilters.status
    const dateFromFilter = historyFilters.dateFrom
    const dateToFilter = historyFilters.dateTo

    const fromDate = dateFromFilter ? new Date(`${dateFromFilter}T00:00:00`) : null
    const toDate = dateToFilter ? new Date(`${dateToFilter}T23:59:59.999`) : null

    return historyRows.filter((row) => {
      if (sessionIdFilter && !String(row.id ?? '').toLowerCase().includes(sessionIdFilter)) {
        return false
      }

      if (machineIdFilter && String(row.machineId ?? '') !== machineIdFilter) {
        return false
      }

      if (workerFilter) {
        const workerText = `${row.workerId ?? ''} ${row.workerName ?? ''} ${row.workerEmail ?? ''}`.toLowerCase()
        if (!workerText.includes(workerFilter)) {
          return false
        }
      }

      if (statusFilter && statusFilter !== 'all' && String(row.status ?? '').toLowerCase() !== statusFilter) {
        return false
      }

      if (fromDate || toDate) {
        const startedAt = new Date(row.startedAt)
        if (Number.isNaN(startedAt.getTime())) return false
        if (fromDate && startedAt < fromDate) return false
        if (toDate && startedAt > toDate) return false
      }

      return true
    })
  }, [historyFilters, historyRows])

  const historyColumns = [
    { key: 'id', label: 'Session ID' },
    {
      key: 'startedAt',
      label: 'Started At',
      render: (value) => formatDateTime(value),
    },
    {
      key: 'completedAt',
      label: 'Completed At',
      render: (value) => formatDateTime(value),
    },
    { key: 'machineName', label: 'Machine' },
    {
      key: 'worker',
      label: 'Worker',
      render: (_, row) => row.workerName || row.workerId || '—',
    },
    {
      key: 'status',
      label: 'Status',
      render: (value) => {
        const normalized = String(value || 'active').toLowerCase()
        const toneClass =
          normalized === 'completed'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
            : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
        return (
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold uppercase ${toneClass}`}>
            {normalized}
          </span>
        )
      },
    },
    {
      key: 'totalAllocatedKg',
      label: 'Allocated',
      render: (value) => formatKg(value),
    },
    {
      key: 'totalOutputKg',
      label: 'Produced',
      render: (value) => formatKg(value),
    },
    {
      key: 'totalWasteKg',
      label: 'Waste',
      render: (value) => formatKg(value),
    },
    {
      key: 'logEntries',
      label: 'Logs',
      render: (value) => String(value ?? 0),
    },
  ]

  const resetToSetup = () => {
    setSessionState({
      session: null,
      materials: [],
      logs: [],
      totalOutput: 0,
    })
    setSetupForm({
      machineId: '',
      workerId: '',
      materials: [createEmptyMaterial()],
    })
    setSetupErrors({})
    setEntryForm({
      grossWeight: '',
      tareWeight: '',
    })
    setPageError('')
  }

  const handleAddMaterial = () => {
    setSetupForm((prev) => {
      if (prev.materials.length >= MAX_SESSION_MATERIALS) return prev
      return {
        ...prev,
        materials: [...prev.materials, createEmptyMaterial()],
      }
    })
  }

  const handleRemoveMaterial = (index) => {
    setSetupForm((prev) => {
      const nextMaterials = prev.materials.filter((_, currentIndex) => currentIndex !== index)

      return {
        ...prev,
        materials: nextMaterials.length > 0 ? nextMaterials : [createEmptyMaterial()],
      }
    })
  }

  const handleStartSession = async (event) => {
    event.preventDefault()
    setPageError('')

    const nextErrors = validateSetupForm(setupForm, materialOptions)
    setSetupErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      toast.error(nextErrors.materials || 'Please fix the highlighted session setup fields.')
      return
    }

    setBusyState((prev) => ({ ...prev, start: true }))

    try {
      const nextSession = await startProductionSession(
        {
          machine_id: Number(setupForm.machineId),
          worker_id: setupForm.workerId.trim(),
          materials: setupForm.materials.map((material) => ({
            stock_id: Number(material.stockId),
            quantity: toNumber(material.quantity),
          })),
        },
        machines,
      )

      setSessionState(nextSession)
      setEntryForm({
        grossWeight: '',
        tareWeight: '',
      })
      await refreshInventoryData?.()
      await loadOwnerHistory({ showSpinner: false })
      toast.success('Production session started.')
    } catch (error) {
      console.error('Failed to start production session', error)
      const message = error.response?.data?.error || 'Failed to start production session.'
      setPageError(message)
      toast.error(message)
    } finally {
      setBusyState((prev) => ({ ...prev, start: false }))
    }
  }

  const handleAddEntry = async (event) => {
    event.preventDefault()
    setPageError('')

    const validationError = validateLogForm(entryForm.grossWeight, entryForm.tareWeight)
    if (validationError) {
      setPageError(validationError)
      toast.error(validationError)
      return
    }

    setBusyState((prev) => ({ ...prev, log: true }))

    try {
      const nextSession = await logProductionEntry(
        {
          session_id: Number(sessionState.session.id),
          worker_id: sessionState.session.workerId || sessionState.session.workerName || setupForm.workerId.trim(),
          gross_weight: toNumber(entryForm.grossWeight),
          tare_weight: toNumber(entryForm.tareWeight),
        },
        machines,
      )

      setSessionState(nextSession)
      setEntryForm({
        grossWeight: '',
        tareWeight: '',
      })
      await refreshInventoryData?.()
      await loadOwnerHistory({ showSpinner: false })
      toast.success('Production entry added.')
    } catch (error) {
      console.error('Failed to add production entry', error)
      const message = error.response?.data?.error || 'Failed to add production entry.'
      setPageError(message)
      toast.error(message)
    } finally {
      setBusyState((prev) => ({ ...prev, log: false }))
    }
  }

  const handleComplete = async () => {
    if (!sessionState.session?.id) return

    setBusyState((prev) => ({ ...prev, end: true }))
    setPageError('')

    try {
      const result = await endProductionSession(Number(sessionState.session.id))
      await refreshInventoryData?.()
      await loadOwnerHistory({ showSpinner: false })
      setSummary({
        totalOutput: result.totalOutput,
        totalWaste: result.totalWaste,
      })
      toast.success('Production session completed.')
      resetToSetup()
    } catch (error) {
      console.error('Failed to complete production session', error)
      const message = error.response?.data?.error || 'Failed to complete production session.'
      setPageError(message)
      toast.error(message)
    } finally {
      setBusyState((prev) => ({ ...prev, end: false }))
    }
  }

  return (
    <>
      <div className="space-y-8">
        <div className="rounded-[32px] border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20 md:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent-gold">Production Console</p>
          <h1 className="mt-3 text-4xl font-semibold text-text-primary">One session. Continuous logging. Automatic reconciliation.</h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-text-secondary">
            The old manufacturing entry and production tracker flows are merged here. Start once, log throughout the run, watch stock move live, and close the batch with waste calculated from the remaining balance.
          </p>
        </div>

        {loadingBootstrap ? (
          <div className="rounded-[28px] border border-border-default bg-bg-card px-6 py-16 text-center text-sm text-text-secondary shadow-lg shadow-black/20">
            Loading machines and checking for active production sessions...
          </div>
        ) : sessionState.session ? (
          <SessionActive
            session={sessionState.session}
            materials={sessionState.materials}
            logs={sessionState.logs}
            totalOutput={sessionState.totalOutput}
            grossWeight={entryForm.grossWeight}
            tareWeight={entryForm.tareWeight}
            netWeight={netWeightPreview}
            loading={isBusy}
            error={pageError}
            onGrossWeightChange={(value) => setEntryForm((prev) => ({ ...prev, grossWeight: value }))}
            onTareWeightChange={(value) => setEntryForm((prev) => ({ ...prev, tareWeight: value }))}
            onAddEntry={handleAddEntry}
            onComplete={handleComplete}
          />
        ) : (
          <SessionSetup
            machines={machines}
            materialOptions={materialOptions}
            form={setupForm}
            validationErrors={setupErrors}
            loading={isBusy}
            error={pageError}
            onFieldChange={(field, value) => setSetupForm((prev) => ({ ...prev, [field]: value }))}
            onMaterialChange={(index, value) =>
              setSetupForm((prev) => ({
                ...prev,
                materials: prev.materials.map((material, currentIndex) =>
                  currentIndex === index
                    ? {
                        ...material,
                        stockId: value,
                      }
                    : material,
                ),
              }))
            }
            onMaterialQuantityChange={(index, value) =>
              setSetupForm((prev) => ({
                ...prev,
                materials: prev.materials.map((material, currentIndex) =>
                  currentIndex === index
                    ? {
                        ...material,
                        quantity: value,
                      }
                    : material,
                ),
              }))
            }
            onAddMaterial={handleAddMaterial}
            onRemoveMaterial={handleRemoveMaterial}
            onSubmit={handleStartSession}
          />
        )}

        {isOwner && (
          <section className="space-y-6 rounded-[28px] border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20 md:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent-gold">Owner View</p>
                <h2 className="mt-2 text-2xl font-semibold text-text-primary">Production Session History</h2>
                <p className="mt-2 text-sm text-text-secondary">
                  Filter completed and active sessions by ID, date, machine, worker, and status.
                </p>
              </div>
              <button
                type="button"
                onClick={() => loadOwnerHistory()}
                className="rounded-xl border border-border-default px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
              >
                Refresh History
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">Session ID</label>
                <input
                  type="text"
                  value={historyFilters.sessionId}
                  onChange={(event) => updateHistoryFilter('sessionId', event.target.value)}
                  placeholder="e.g. 102"
                  className="w-full rounded-xl border border-border-default bg-bg-input px-4 py-3 text-sm text-text-primary"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">Machine</label>
                <select
                  value={historyFilters.machineId}
                  onChange={(event) => updateHistoryFilter('machineId', event.target.value)}
                  className="w-full cursor-pointer rounded-xl border border-border-default bg-bg-input px-4 py-3 text-sm text-text-primary"
                >
                  <option value="">All machines</option>
                  {machines.map((machine) => (
                    <option key={machine.id} value={machine.id}>
                      {machine.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">Worker</label>
                <input
                  type="text"
                  value={historyFilters.worker}
                  onChange={(event) => updateHistoryFilter('worker', event.target.value)}
                  placeholder="ID / name / email"
                  className="w-full rounded-xl border border-border-default bg-bg-input px-4 py-3 text-sm text-text-primary"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">Status</label>
                <select
                  value={historyFilters.status}
                  onChange={(event) => updateHistoryFilter('status', event.target.value)}
                  className="w-full cursor-pointer rounded-xl border border-border-default bg-bg-input px-4 py-3 text-sm text-text-primary"
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">Date From</label>
                <input
                  type="date"
                  value={historyFilters.dateFrom}
                  onChange={(event) => updateHistoryFilter('dateFrom', event.target.value)}
                  className="w-full rounded-xl border border-border-default bg-bg-input px-4 py-3 text-sm text-text-primary"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">Date To</label>
                <input
                  type="date"
                  value={historyFilters.dateTo}
                  onChange={(event) => updateHistoryFilter('dateTo', event.target.value)}
                  className="w-full rounded-xl border border-border-default bg-bg-input px-4 py-3 text-sm text-text-primary"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-text-secondary">
                Showing <span className="font-semibold text-text-primary">{filteredHistory.length}</span> of{' '}
                <span className="font-semibold text-text-primary">{historyRows.length}</span> sessions
              </p>
              <button
                type="button"
                onClick={resetHistoryFilters}
                className="rounded-xl border border-border-default px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
              >
                Clear Filters
              </button>
            </div>

            {historyError && (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {historyError}
              </div>
            )}

            {historyLoading ? (
              <div className="rounded-2xl border border-border-default bg-bg-input/25 px-6 py-14 text-center text-sm text-text-secondary">
                Loading production session history...
              </div>
            ) : (
              <DataTable
                columns={historyColumns}
                data={filteredHistory}
                emptyMessage="No production sessions found for the selected filters."
              />
            )}
          </section>
        )}
      </div>

      <SummaryModal summary={summary} onClose={() => setSummary(null)} />
    </>
  )
}
