import { useEffect, useMemo, useState } from 'react'
import DataTable from '../components/DataTable'
import InputWithCamera from '../components/InputWithCamera'
import { SectionBarChart } from '../components/Charts'
import { useToast } from '../components/Toast'
import usePersistentState from '../hooks/usePersistentState'
import api from '../utils/api'
import { buildStockBatches, buildStockIssuances, formatKg } from '../utils/stock'
import { deleteInventoryTransaction } from '../utils/inventory'

const MATERIAL_SOURCE_LIMIT = 3

const getTodayDate = () => new Date().toISOString().split('T')[0]
const createEmptyMaterialSource = () => ({ stockId: '', issuanceId: '', quantityUsed: '' })
const createInitialMaterialSources = () =>
  Array.from({ length: MATERIAL_SOURCE_LIMIT }, () => createEmptyMaterialSource())
const createEmptyRoll = () => ({
  id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  machine_id: '',
  quantity_kg: '',
})

const toNumber = (value) => {
  const parsed = parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeIssuance = (item, index) => {
  const remainingKg = toNumber(
    item.remaining_kg ??
      item.remainingInKg ??
      item.remainingKg ??
      item.remaining ??
      item.available_kg ??
      item.availableKg,
  )
  const quantityKg = toNumber(item.quantity_kg ?? item.quantityInKg ?? item.quantity ?? item.quantity_used)
  const issuanceId = item.issuance_id ?? item.issuanceId ?? item.id ?? `issuance_${index}`
  const sourceLabel =
    item.fromStockLabel ??
    item.from_stock_label ??
    item.stock_label ??
    item.stockLabel ??
    item.material_name ??
    item.materialName ??
    item.label ??
    item.batch_name ??
    item.batchName ??
    `Issuance ${issuanceId}`

  return {
    ...item,
    id: issuanceId,
    issuance_id: issuanceId,
    remainingKg: remainingKg || quantityKg,
    label: sourceLabel,
  }
}

const normalizeMachine = (item, index) => {
  const machineId = item.machine_id ?? item.machineId ?? item.id ?? `machine_${index}`
  const machineLabel =
    item.machine_name ??
    item.machineName ??
    item.name ??
    item.code ??
    item.machine_code ??
    item.machineCode ??
    `Machine ${machineId}`

  return {
    ...item,
    id: machineId,
    machine_id: machineId,
    label: machineLabel,
  }
}

const columns = [
  { key: 'sno', label: 'S.No' },
  { key: 'date', label: 'Date' },
  { key: 'order_number', label: 'Order' },
  { key: 'grossWeight', label: 'Gross Weight', render: (value) => Number(value).toFixed(2) },
  { key: 'tareWeight', label: 'Tare Weight', render: (value) => Number(value).toFixed(2) },
  { key: 'netWeight', label: 'Net Weight', render: (value) => Number(value).toFixed(2) },
  { key: 'materialUsed', label: 'Material Used', render: (value) => (value ? Number(value).toFixed(2) : '-') },
  { key: 'materialSourcesSummary', label: 'Raw Materials' },
  { key: 'sizeMic', label: 'Size & Mic' },
]

export default function Manufacturing({
  user,
  data,
  rawMaterials = [],
  stockUsage = [],
  stockIssuances = [],
  stockBalances = {},
  ordersList = [],
  refreshInventoryData,
}) {
  const toast = useToast()
  const isWorker = user?.role === 'worker'

  const [form, setForm] = usePersistentState(`vp_manufacturing_form_${isWorker ? 'worker' : 'owner'}`, {
    date: getTodayDate(),
    order_number: '',
    grossWeight: '',
    tareWeight: '',
    sizeMic: '',
    note: '',
    materialSources: createInitialMaterialSources(),
  })
  const [rolls, setRolls] = useState(() => [createEmptyRoll()])
  const [submitting, setSubmitting] = useState(false)
  const [workerIssuances, setWorkerIssuances] = useState([])
  const [machines, setMachines] = useState([])
  const [referenceLoading, setReferenceLoading] = useState(false)
  const [referenceError, setReferenceError] = useState('')
  const [inlineErrors, setInlineErrors] = useState({})
  const [filterBrand, setFilterBrand] = usePersistentState(`vp_manufacturing_filter_brand_${isWorker ? 'worker' : 'owner'}`, '')
  const [filterCode, setFilterCode] = usePersistentState(`vp_manufacturing_filter_code_${isWorker ? 'worker' : 'owner'}`, '')
  const workerId = user?.worker_id ?? user?.workerId ?? user?.id ?? user?.email ?? ''

  const uniqueBrands = useMemo(
    () => [...new Set(rawMaterials.map((item) => item.brandName).filter(Boolean))].sort(),
    [rawMaterials],
  )
  const uniqueCodes = useMemo(
    () => [...new Set(rawMaterials.map((item) => item.codeName).filter(Boolean))].sort(),
    [rawMaterials],
  )

  const stockBatches = useMemo(
    () => buildStockBatches(rawMaterials, stockUsage, stockIssuances, stockBalances),
    [rawMaterials, stockBalances, stockUsage, stockIssuances],
  )
  const stockIssuanceRows = useMemo(
    () => buildStockIssuances(stockIssuances, rawMaterials, stockUsage, stockBalances),
    [stockBalances, stockIssuances, rawMaterials, stockUsage],
  )

  const availableOwnerBatches = useMemo(() => {
    return stockBatches.filter((batch) => {
      if (batch.availableToIssue <= 0) return false
      if (filterBrand && batch.brandName !== filterBrand) return false
      if (filterCode && batch.codeName !== filterCode) return false
      return true
    })
  }, [filterBrand, filterCode, stockBatches])

  const availableIssuances = useMemo(() => {
    const sourceRows = isWorker ? workerIssuances : stockIssuanceRows
    return sourceRows.filter((issuance) => {
      const remainingStock = issuance.remainingKg ?? issuance.remainingInKg ?? 0
      if (remainingStock <= 0) return false
      if (filterBrand && issuance.brandName !== filterBrand) return false
      if (filterCode && issuance.codeName !== filterCode) return false
      return true
    })
  }, [filterBrand, filterCode, isWorker, stockIssuanceRows, workerIssuances])

  const selectedOwnerSources = form.materialSources.map((source) =>
    stockBatches.find((batch) => String(batch.id) === String(source.stockId)),
  )
  const selectedWorkerSources = form.materialSources.map((source) =>
    availableIssuances.find((issuance) => String(issuance.id) === String(source.issuanceId)),
  )

  const workerBlocked = isWorker && (!workerId || referenceLoading || availableIssuances.length === 0)
  const netWeight = (parseFloat(form.grossWeight) || 0) - (parseFloat(form.tareWeight) || 0)
  const totalMaterialUsed = useMemo(
    () => form.materialSources.reduce((sum, source) => sum + (parseFloat(source.quantityUsed) || 0), 0),
    [form.materialSources],
  )
  const totalOutput = useMemo(
    () => rolls.reduce((sum, roll) => sum + toNumber(roll.quantity_kg), 0),
    [rolls],
  )
  const selectedIssuance = availableIssuances.find(
    (issuance) => String(issuance.id) === String(form.materialSources[0]?.issuanceId),
  )
  const selectedIssuanceRemaining = selectedIssuance?.remainingKg ?? 0

  const totalEntries = data.length
  const totalNetWeight = data.reduce((sum, item) => sum + (item.netWeight || 0), 0)
  const today = getTodayDate()
  const todayEntries = data.filter((item) => item.date === today)
  const todayCount = todayEntries.length
  const todayNet = todayEntries.reduce((sum, item) => sum + (item.netWeight || 0), 0)
  const currentPhysicalStock = stockBatches.reduce((sum, batch) => sum + batch.physicalRemaining, 0)

  const chartData = useMemo(() => {
    const map = {}
    data.forEach((entry) => {
      if (!map[entry.date]) map[entry.date] = 0
      map[entry.date] += entry.netWeight || 0
    })

    return Object.entries(map)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([dateValue, value]) => ({ name: dateValue, value }))
  }, [data])
  const hasOrders = ordersList.length > 0
  const orderSelectPlaceholder = hasOrders ? 'Select order...' : 'No active orders available'
  const orderHelperText = hasOrders
    ? 'Choose an active order for this manufacturing entry.'
    : 'No active orders are available. Create one in Orders or reopen an existing one.'
  const sourceHelperText = useMemo(() => {
    if (isWorker) {
      if (availableIssuances.length > 0) {
        return 'Choose from issued stock that still has remaining balance.'
      }
      if (!workerId) {
        return 'Worker session is missing an id. Sign in again to load issued stock.'
      }
      if (!referenceLoading && workerIssuances.length === 0) {
        return 'No issued stock exists yet. Ask admin to issue stock first.'
      }
      if (filterBrand || filterCode) {
        return 'No issued stock matches the current brand/code filters.'
      }
      return 'All issued stock has already been consumed.'
    }

    if (availableOwnerBatches.length > 0) {
      return 'Choose from stock batches that still have free balance.'
    }
    if (stockBatches.length === 0) {
      return 'No raw material stock exists yet. Add raw material first.'
    }
    if (filterBrand || filterCode) {
      return 'No stock batch matches the current brand/code filters.'
    }
    return 'All stock batches are fully used or already reserved.'
  }, [availableIssuances.length, availableOwnerBatches.length, filterBrand, filterCode, isWorker, referenceLoading, stockBatches.length, workerId, workerIssuances.length])

  useEffect(() => {
    if (!isWorker || !workerId) {
      if (isWorker && !workerId) {
        setReferenceError('Worker session is missing an id, so issued stock cannot be loaded.')
      }
      return
    }

    const loadReferenceData = async () => {
      setReferenceLoading(true)
      setReferenceError('')

      try {
        const [stockResponse, machinesResponse] = await Promise.all([
          api.get(`/worker/stock/${encodeURIComponent(workerId)}`),
          api.get('/machines'),
        ])

        const nextIssuances = Array.isArray(stockResponse.data)
          ? stockResponse.data.map(normalizeIssuance)
          : []
        const nextMachines = Array.isArray(machinesResponse.data)
          ? machinesResponse.data.map(normalizeMachine)
          : []

        setWorkerIssuances(nextIssuances)
        setMachines(nextMachines)
      } catch (error) {
        console.error('Failed to load manufacturing references', error)
        setReferenceError(error.response?.data?.error || 'Failed to load issued stock or machines')
      } finally {
        setReferenceLoading(false)
      }
    }

    loadReferenceData()
  }, [isWorker, workerId])

  useEffect(() => {
    setRolls((prev) =>
      prev.map((roll) =>
        roll.machine_id || machines.length === 0
          ? roll
          : {
              ...roll,
              machine_id: '',
            },
      ),
    )
  }, [machines])

  const handleChange = (event) => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleMaterialSourceChange = (index, field, value) => {
    setForm((prev) => ({
      ...prev,
      materialSources: prev.materialSources.map((source, sourceIndex) =>
        sourceIndex === index
          ? {
              ...source,
              [field]: value,
            }
          : source,
      ),
    }))
  }

  const resetForm = () => {
    setForm({
      date: getTodayDate(),
      order_number: '',
      grossWeight: '',
      tareWeight: '',
      sizeMic: '',
      note: '',
      materialSources: createInitialMaterialSources(),
    })
    setRolls([createEmptyRoll()])
    setInlineErrors({})
  }

  const resetMaterialSources = () => {
    setForm((prev) => ({
      ...prev,
      materialSources: createInitialMaterialSources(),
    }))
  }

  const addRoll = () => {
    setRolls((prev) => [...prev, createEmptyRoll()])
  }

  const updateRoll = (rollId, field, value) => {
    setRolls((prev) =>
      prev.map((roll) => (roll.id === rollId ? { ...roll, [field]: value } : roll)),
    )
  }

  const removeRoll = (rollId) => {
    setRolls((prev) => {
      const nextRolls = prev.filter((roll) => roll.id !== rollId)
      return nextRolls.length > 0 ? nextRolls : [createEmptyRoll()]
    })
  }

  const prefillFromNetWeight = () => {
    if (netWeight <= 0) return
    setRolls((prev) => {
      if (prev.length === 0) {
        return [{ ...createEmptyRoll(), quantity_kg: netWeight.toFixed(2) }]
      }

      const [firstRoll, ...rest] = prev
      return [{ ...firstRoll, quantity_kg: netWeight.toFixed(2) }, ...rest]
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setInlineErrors({})

    if (!form.order_number || !form.date || !form.grossWeight || !form.tareWeight) {
      toast.error('Please fill all required fields')
      return
    }

    const gross = parseFloat(form.grossWeight)
    const tare = parseFloat(form.tareWeight)
    if (gross < tare) {
      toast.error('Gross weight must be greater than or equal to tare weight')
      return
    }

    const sourceOne = form.materialSources[0]
    const nextErrors = {}

    if (!isWorker) {
      nextErrors.reference = 'This production logging flow requires a worker session.'
    }

    if (isWorker && !workerId) {
      nextErrors.reference = 'Worker session is missing an id. Sign in again before logging production.'
    }

    if (isWorker && !sourceOne?.issuanceId) {
      nextErrors.issuance = 'Raw material source 1 is required.'
    }

    const cleanedRolls = rolls
      .map((roll) => ({
        machine_id: roll.machine_id,
        quantity_kg: toNumber(roll.quantity_kg),
      }))
      .filter((roll) => roll.machine_id || roll.quantity_kg > 0)

    if (cleanedRolls.length === 0) {
      nextErrors.rolls = 'At least one roll output is required.'
    } else if (cleanedRolls.some((roll) => !roll.machine_id || roll.quantity_kg <= 0)) {
      nextErrors.rolls = 'Each roll must include a machine and a quantity greater than zero.'
    }

    if (selectedIssuance && totalOutput > selectedIssuance.remainingKg) {
      nextErrors.totalOutput = `Total output cannot exceed remaining stock of ${formatKg(selectedIssuance.remainingKg)}.`
    }

    if (Object.keys(nextErrors).length > 0) {
      setInlineErrors(nextErrors)
      toast.error('Please correct the highlighted fields')
      return
    }

    setSubmitting(true)

    try {
      await api.post('/production/log-rolls', {
        issuance_id: sourceOne.issuanceId,
        worker_id: workerId,
        order_number: form.order_number,
        rolls: cleanedRolls,
        note: form.note?.trim() || undefined,
        created_by: user?.name || user?.email || undefined,
      })

      if (isWorker && workerId) {
        const { data: refreshedStock } = await api.get(`/worker/stock/${encodeURIComponent(workerId)}`)
        setWorkerIssuances(Array.isArray(refreshedStock) ? refreshedStock.map(normalizeIssuance) : [])
      }
      await refreshInventoryData?.()
    } catch (error) {
      console.error('Failed to save manufacturing entry', error)
      toast.error(error.response?.data?.error || 'Failed to save manufacturing entry')
      setSubmitting(false)
      return
    }

    toast.success('Manufacturing entry added')
    resetForm()
    setSubmitting(false)
  }

  const handleDelete = async (entryId) => {
    const entry = data.find((item) => item.id === entryId)
    const transactionId = entry?.transactionId || entry?.id
    if (!transactionId) return

    const linkedTransactionIds = stockUsage
      .filter(
        (usage) =>
          String(usage.linkedEntryId) === String(transactionId) &&
          String(usage.transactionId || usage.id) !== String(transactionId) &&
          usage.source === 'Manufacturing',
      )
      .map((usage) => usage.transactionId || usage.id)

    try {
      await Promise.all([transactionId, ...linkedTransactionIds].map((id) => deleteInventoryTransaction(api, id)))
      await refreshInventoryData?.()
      toast.success('Entry deleted')
    } catch (error) {
      console.error('Failed to delete manufacturing entry', error)
      toast.error('Failed to delete manufacturing entry')
    }
  }

  const inputClass =
    'w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30'

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Manufacturing</h2>
        <p className="text-sm text-text-secondary mt-1">
          {isWorker
            ? 'Log manufactured rolls using issued raw material stock'
            : 'Log manufactured rolls using up to 3 raw material sources'}
        </p>
      </div>

      {!isWorker && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
              <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Total Entries</p>
              <p className="text-3xl font-semibold text-text-primary">{totalEntries}</p>
            </div>
            <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
              <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Total Net Weight</p>
              <p className="text-3xl font-semibold text-accent-gold">{totalNetWeight.toFixed(2)}</p>
            </div>
            <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500/80 via-emerald-500/40 to-transparent" />
              <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Current Stock</p>
              <p className="text-3xl font-semibold text-emerald-400">{formatKg(currentPhysicalStock)}</p>
            </div>
            <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500/80 via-emerald-500/40 to-transparent" />
              <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Today's Entries</p>
              <p className="text-3xl font-semibold text-text-primary">{todayCount}</p>
              <p className="text-xs text-text-secondary/50 mt-1">{todayNet.toFixed(2)} net</p>
            </div>
          </div>

          {chartData.length > 0 && (
            <SectionBarChart data={chartData} title="Daily Manufacturing Output" color="#f59e0b" />
          )}
        </>
      )}

      <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6">
        <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">
          Add Manufacturing Entry
        </h3>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Date</label>
            <InputWithCamera type="date" name="date" value={form.date} onChange={handleChange} required />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Order</label>
            <select
              name="order_number"
              value={form.order_number}
              onChange={handleChange}
              className={`${inputClass} appearance-none cursor-pointer`}
              required
            >
              <option value="">{orderSelectPlaceholder}</option>
              {ordersList.map((order) => (
                <option key={order.order_number} value={order.order_number}>
                  {order.order_number} {order.client_name ? `(${order.client_name})` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-text-secondary/60">{orderHelperText}</p>
          </div>

          {!isWorker && (
            <>
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Filter by Brand</label>
                <select
                  value={filterBrand}
                  onChange={(event) => {
                    setFilterBrand(event.target.value)
                    resetMaterialSources()
                  }}
                  className={`${inputClass} cursor-pointer`}
                >
                  <option value="">All Brands</option>
                  {uniqueBrands.map((brand) => (
                    <option key={brand} value={brand}>{brand}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Filter by Code</label>
                <select
                  value={filterCode}
                  onChange={(event) => {
                    setFilterCode(event.target.value)
                    resetMaterialSources()
                  }}
                  className={`${inputClass} cursor-pointer`}
                >
                  <option value="">All Codes</option>
                  {uniqueCodes.map((code) => (
                    <option key={code} value={code}>{code}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="space-y-4 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Raw Material Sources</label>
              <span className="text-[11px] text-text-secondary/60">Source 1 is required. Sources 2 and 3 are optional.</span>
            </div>
            {referenceError && (
              <p className="text-[11px] text-red-400">{referenceError}</p>
            )}
            {inlineErrors.issuance && (
              <p className="text-[11px] text-red-400">{inlineErrors.issuance}</p>
            )}

            {form.materialSources.map((source, index) => {
              const sourceNumber = index + 1
              const selectedOwnerSource = selectedOwnerSources[index]
              const selectedWorkerSource = selectedWorkerSources[index]

              return (
                <div key={sourceNumber} className="rounded-xl border border-border-default/80 bg-bg-input/40 p-4">
                  <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_160px] gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">
                        {isWorker ? `Issued Raw Material ${sourceNumber}` : `Raw Material ${sourceNumber}`}
                      </label>
                      <select
                        value={isWorker ? source.issuanceId : source.stockId}
                        onChange={(event) => handleMaterialSourceChange(index, isWorker ? 'issuanceId' : 'stockId', event.target.value)}
                        className={`${inputClass} cursor-pointer`}
                        required={sourceNumber === 1}
                      >
                        <option value="">
                          {isWorker
                            ? (availableIssuances.length > 0 ? 'Select source...' : 'No issued stock available')
                            : (availableOwnerBatches.length > 0 ? 'Select source...' : 'No stock available')}
                        </option>
                        {(isWorker ? availableIssuances : availableOwnerBatches).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.fromStockLabel || item.label} - {formatKg(item.remainingKg ?? item.remainingInKg ?? item.availableToIssue)} available
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-text-secondary/60">
                        {!selectedWorkerSource && !selectedOwnerSource && !source.issuanceId && !source.stockId
                          ? sourceHelperText
                          : isWorker
                          ? selectedWorkerSource
                            ? `${selectedWorkerSource.label} has ${formatKg(selectedWorkerSource.remainingKg)} remaining`
                            : 'Choose an issued stock allocation for this source'
                          : selectedOwnerSource
                            ? `${selectedOwnerSource.label} has ${formatKg(selectedOwnerSource.availableToIssue)} free`
                            : 'Choose a stock batch for this source'}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Used (kg)</label>
                      <InputWithCamera
                        type="number"
                        value={source.quantityUsed}
                        onChange={(event) => handleMaterialSourceChange(index, 'quantityUsed', event.target.value)}
                        step="0.01"
                        placeholder="0.00"
                        required={sourceNumber === 1}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Gross Weight</label>
            <InputWithCamera type="number" name="grossWeight" value={form.grossWeight} onChange={handleChange} step="0.01" placeholder="0.00" required />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Tare Weight</label>
            <InputWithCamera type="number" name="tareWeight" value={form.tareWeight} onChange={handleChange} step="0.01" placeholder="0.00" required />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">
              Net Weight <span className="text-accent-gold/70">(auto)</span>
            </label>
            <div className="w-full bg-bg-input text-accent-gold border border-gray-700 rounded-lg px-4 py-2.5 text-sm font-semibold">
              {netWeight.toFixed(2)}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">
              Total Material Used <span className="text-accent-gold/70">(auto)</span>
            </label>
            <div className="w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm font-semibold">
              {totalMaterialUsed.toFixed(2)} kg
            </div>
          </div>

          <div className="space-y-4 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">ROLL OUTPUTS</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={prefillFromNetWeight}
                  className="text-[11px] font-medium text-accent-gold hover:text-accent-gold-hover transition-colors"
                >
                  Use Net Weight
                </button>
                <button
                  type="button"
                  onClick={addRoll}
                  className="text-[11px] font-medium text-accent-gold hover:text-accent-gold-hover transition-colors"
                >
                  + Add Roll
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-border-default/80 bg-bg-input/40 p-4 space-y-4">
              {rolls.map((roll) => (
                <div key={roll.id} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_160px_88px] gap-4 items-end">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">
                      Machine
                    </label>
                    <select
                      value={roll.machine_id}
                      onChange={(event) => updateRoll(roll.id, 'machine_id', event.target.value)}
                      className={`${inputClass} cursor-pointer`}
                    >
                      <option value="">
                        {referenceLoading ? 'Loading machines...' : machines.length > 0 ? 'Select machine...' : 'No machines available'}
                      </option>
                      {machines.map((machine) => (
                        <option key={machine.id} value={machine.machine_id}>
                          {machine.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">
                      Quantity (kg)
                    </label>
                    <InputWithCamera
                      type="number"
                      value={roll.quantity_kg}
                      onChange={(event) => updateRoll(roll.id, 'quantity_kg', event.target.value)}
                      step="0.01"
                      placeholder="0.00"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => removeRoll(roll.id)}
                    className="h-[42px] rounded-lg border border-gray-700 px-3 text-sm text-text-secondary hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">
                    Total Output <span className="text-accent-gold/70">(auto)</span>
                  </label>
                  <div className="w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm font-semibold">
                    {totalOutput.toFixed(2)} kg
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">
                    Remaining Stock
                  </label>
                  <div className="w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm font-semibold">
                    {selectedIssuance ? formatKg(selectedIssuanceRemaining) : 'Select source 1'}
                  </div>
                </div>
              </div>

              {inlineErrors.rolls && <p className="text-[11px] text-red-400">{inlineErrors.rolls}</p>}
              {inlineErrors.totalOutput && <p className="text-[11px] text-red-400">{inlineErrors.totalOutput}</p>}
              {inlineErrors.reference && <p className="text-[11px] text-red-400">{inlineErrors.reference}</p>}
            </div>
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Size & Mic</label>
            <InputWithCamera type="text" name="sizeMic" value={form.sizeMic} onChange={handleChange} placeholder="e.g. 12mm / 3.5 mic" />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Note</label>
            <InputWithCamera type="text" name="note" value={form.note} onChange={handleChange} placeholder="Optional note" />
          </div>

          <div className="flex items-end md:col-span-2">
            <button type="submit" disabled={submitting || workerBlocked} className="w-full bg-accent-gold text-black font-semibold py-2.5 rounded-lg text-sm transition-all duration-200 hover:bg-accent-gold-hover active:scale-[0.98] disabled:opacity-50">
              {submitting ? 'Logging...' : 'Add Entry'}
            </button>
          </div>
        </form>
      </div>

      {!isWorker && (
        <DataTable columns={columns} data={data} emptyMessage="No manufacturing entries yet." onDelete={user?.role === 'owner' ? handleDelete : undefined} />
      )}
    </div>
  )
}
