import { useMemo, useState } from 'react'
import DataTable from '../components/DataTable'
import InputWithCamera from '../components/InputWithCamera'
import { SectionBarChart } from '../components/Charts'
import { useToast } from '../components/Toast'
import api from '../utils/api'
import { buildStockBatches, buildStockIssuances, formatKg } from '../utils/stock'
import {
  createInventoryTransaction,
  deleteInventoryTransaction,
  ensureInventoryBalance,
  INVENTORY_NOTE_CATEGORIES,
  INVENTORY_TRANSACTION_TYPES,
  makeInventoryTransaction,
} from '../utils/inventory'

const MATERIAL_SOURCE_LIMIT = 3

const getTodayDate = () => new Date().toISOString().split('T')[0]
const createEmptyMaterialSource = () => ({ stockId: '', issuanceId: '', quantityUsed: '' })
const createInitialMaterialSources = () =>
  Array.from({ length: MATERIAL_SOURCE_LIMIT }, () => createEmptyMaterialSource())

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

  const [form, setForm] = useState({
    date: getTodayDate(),
    order_number: '',
    grossWeight: '',
    tareWeight: '',
    sizeMic: '',
    materialSources: createInitialMaterialSources(),
  })
  const [submitting, setSubmitting] = useState(false)
  const [filterBrand, setFilterBrand] = useState('')
  const [filterCode, setFilterCode] = useState('')

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
    return stockIssuanceRows.filter((issuance) => {
      if (issuance.remainingInKg <= 0) return false
      if (filterBrand && issuance.brandName !== filterBrand) return false
      if (filterCode && issuance.codeName !== filterCode) return false
      return true
    })
  }, [filterBrand, filterCode, stockIssuanceRows])

  const selectedOwnerSources = form.materialSources.map((source) =>
    stockBatches.find((batch) => String(batch.id) === String(source.stockId)),
  )
  const selectedWorkerSources = form.materialSources.map((source) =>
    stockIssuanceRows.find((issuance) => String(issuance.id) === String(source.issuanceId)),
  )

  const workerBlocked = isWorker && availableIssuances.length === 0
  const netWeight = (parseFloat(form.grossWeight) || 0) - (parseFloat(form.tareWeight) || 0)
  const totalMaterialUsed = useMemo(
    () => form.materialSources.reduce((sum, source) => sum + (parseFloat(source.quantityUsed) || 0), 0),
    [form.materialSources],
  )

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
      materialSources: createInitialMaterialSources(),
    })
  }

  const resetMaterialSources = () => {
    setForm((prev) => ({
      ...prev,
      materialSources: createInitialMaterialSources(),
    }))
  }

  const buildMaterialSourcesForSubmit = () => {
    return form.materialSources.map((source, index) => {
      const quantityUsed = parseFloat(source.quantityUsed)

      if (isWorker) {
        const issuance = stockIssuanceRows.find((item) => String(item.id) === String(source.issuanceId))
        const batch = issuance
          ? stockBatches.find((item) => String(item.id) === String(issuance.fromStockId))
          : null

        return {
          slot: index + 1,
          selectionId: source.issuanceId,
          quantityUsed,
          issuance,
          batch,
          balanceStockId: issuance ? issuance.issuedStockId || issuance.stockId : null,
          displayLabel: issuance ? `${issuance.fromStockLabel} (Issued)` : '',
          sourceStockId: batch?.id ?? '',
          beforeBalance: issuance?.remainingInKg ?? null,
          afterBalance: issuance ? issuance.remainingInKg - quantityUsed : null,
          issueBalanceBefore: issuance?.remainingInKg ?? null,
          issueBalanceAfter: issuance ? issuance.remainingInKg - quantityUsed : null,
        }
      }

      const batch = stockBatches.find((item) => String(item.id) === String(source.stockId))
      return {
        slot: index + 1,
        selectionId: source.stockId,
        quantityUsed,
        issuance: null,
        batch,
        balanceStockId: batch?.id ?? null,
        displayLabel: batch?.label || '',
        sourceStockId: batch?.id ?? '',
        beforeBalance: batch?.physicalRemaining ?? null,
        afterBalance: batch ? batch.physicalRemaining - quantityUsed : null,
        issueBalanceBefore: null,
        issueBalanceAfter: null,
      }
    })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

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

    const net = gross - tare
    const sourceEntries = buildMaterialSourcesForSubmit()

    for (const sourceEntry of sourceEntries) {
      const hasSelection = Boolean(sourceEntry.selectionId)
      const hasQuantity = Boolean(sourceEntry.quantityUsed)
      const isRequiredSource = sourceEntry.slot === 1

      if (isRequiredSource && (!hasSelection || !hasQuantity)) {
        toast.error('Raw material source 1 is required')
        return
      }

      if (!isRequiredSource && (hasSelection || hasQuantity) && (!hasSelection || !hasQuantity)) {
        toast.error(`Complete both stock and quantity for raw material source ${sourceEntry.slot}`)
        return
      }

      if (hasQuantity && sourceEntry.quantityUsed <= 0) {
        toast.error(`Raw material source ${sourceEntry.slot} quantity must be greater than zero`)
        return
      }
    }

    const activeSources = sourceEntries.filter((sourceEntry) => sourceEntry.selectionId && sourceEntry.quantityUsed)
    const uniqueSelectionIds = new Set(activeSources.map((sourceEntry) => String(sourceEntry.selectionId)))
    if (uniqueSelectionIds.size !== activeSources.length) {
      toast.error('Please choose different raw materials for each source')
      return
    }

    const materialUsed = activeSources.reduce((sum, sourceEntry) => sum + sourceEntry.quantityUsed, 0)
    if (materialUsed < net) {
      toast.error('Total raw material used cannot be less than net weight output')
      return
    }

    for (const sourceEntry of activeSources) {
      if (isWorker) {
        if (!sourceEntry.issuance) {
          toast.error(`Issued stock for source ${sourceEntry.slot} was not found`)
          return
        }
        if (sourceEntry.quantityUsed > sourceEntry.issuance.remainingInKg) {
          toast.error(`Only ${formatKg(sourceEntry.issuance.remainingInKg)} remains in issued source ${sourceEntry.slot}`)
          return
        }
      } else {
        if (!sourceEntry.batch) {
          toast.error(`Stock batch for source ${sourceEntry.slot} was not found`)
          return
        }
        if (sourceEntry.quantityUsed > sourceEntry.batch.availableToIssue) {
          toast.error(`Only ${formatKg(sourceEntry.batch.availableToIssue)} is free in source ${sourceEntry.slot}`)
          return
        }
      }
    }

    setSubmitting(true)

    for (const sourceEntry of activeSources) {
      try {
        const { ok, balance } = await ensureInventoryBalance(api, sourceEntry.balanceStockId, sourceEntry.quantityUsed)
        if (!ok) {
          toast.error(`Only ${formatKg(balance)} is currently available for raw material source ${sourceEntry.slot}`)
          setSubmitting(false)
          return
        }
      } catch (error) {
        console.error('Failed to validate stock balance', error)
        toast.error('Unable to verify stock balance right now')
        setSubmitting(false)
        return
      }
    }

    const materialSourcesMetadata = activeSources.map((sourceEntry) => ({
      slot: sourceEntry.slot,
      sourceLabel: sourceEntry.displayLabel,
      quantityUsed: sourceEntry.quantityUsed,
      stockId: sourceEntry.balanceStockId,
      sourceStockId: sourceEntry.sourceStockId,
      issuanceId: sourceEntry.issuance?.id ?? null,
    }))

    try {
      const [primarySource, ...additionalSources] = activeSources
      const primaryTransaction = await createInventoryTransaction(
        api,
        makeInventoryTransaction({
          stockId: primarySource.balanceStockId,
          transactionType: INVENTORY_TRANSACTION_TYPES.MANUFACTURING,
          direction: 'OUT',
          quantityInKg: primarySource.quantityUsed,
          metadata: {
            category: INVENTORY_NOTE_CATEGORIES.MANUFACTURING,
            date: form.date,
            order_number: form.order_number,
            grossWeight: gross,
            tareWeight: tare,
            netWeight: net,
            materialUsed,
            quantityUsed: primarySource.quantityUsed,
            quantityUnit: 'kg',
            sizeMic: form.sizeMic,
            source: 'Manufacturing',
            fromStockLabel: primarySource.displayLabel,
            beforeBalance: primarySource.beforeBalance,
            afterBalance: primarySource.afterBalance,
            sourceStockId: primarySource.sourceStockId,
            issuanceId: primarySource.issuance?.id ?? null,
            issueBalanceBefore: primarySource.issueBalanceBefore,
            issueBalanceAfter: primarySource.issueBalanceAfter,
            materialSources: materialSourcesMetadata,
            logMessage:
              activeSources.length > 1
                ? `${formatKg(materialUsed)} used for Manufacturing (${form.order_number}) from ${activeSources.length} raw material sources`
                : `${formatKg(materialUsed)} used for Manufacturing (${form.order_number}) from ${primarySource.displayLabel || 'selected stock'}`,
          },
        }),
      )

      for (const sourceEntry of additionalSources) {
        await createInventoryTransaction(
          api,
          makeInventoryTransaction({
            stockId: sourceEntry.balanceStockId,
            transactionType: INVENTORY_TRANSACTION_TYPES.ADJUSTMENT,
            direction: 'OUT',
            quantityInKg: sourceEntry.quantityUsed,
            metadata: {
              category: INVENTORY_NOTE_CATEGORIES.MANUFACTURING_COMPONENT,
              date: form.date,
              order_number: form.order_number,
              quantityUsed: sourceEntry.quantityUsed,
              quantityUnit: 'kg',
              source: 'Manufacturing',
              fromStockLabel: sourceEntry.displayLabel,
              beforeBalance: sourceEntry.beforeBalance,
              afterBalance: sourceEntry.afterBalance,
              sourceStockId: sourceEntry.sourceStockId,
              issuanceId: sourceEntry.issuance?.id ?? null,
              issueBalanceBefore: sourceEntry.issueBalanceBefore,
              issueBalanceAfter: sourceEntry.issueBalanceAfter,
              linkedEntryId: primaryTransaction.id,
              logMessage: `${formatKg(sourceEntry.quantityUsed)} used for Manufacturing (${form.order_number}) from source ${sourceEntry.slot} (${sourceEntry.displayLabel})`,
            },
          }),
        )
      }

      await refreshInventoryData?.()
    } catch (error) {
      console.error('Failed to save manufacturing transaction', error)
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
            ? 'Log manufactured rolls using up to 3 issued raw material sources'
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
              <option value="">Select order...</option>
              {ordersList.map((order) => (
                <option key={order.order_number} value={order.order_number}>
                  {order.order_number} {order.client_name ? `(${order.client_name})` : ''}
                </option>
              ))}
            </select>
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
                        <option value="">Select source...</option>
                        {(isWorker ? availableIssuances : availableOwnerBatches).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.fromStockLabel || item.label} - {formatKg(item.remainingInKg ?? item.availableToIssue)} available
                          </option>
                        ))}
                      </select>
                      <p className="text-[11px] text-text-secondary/60">
                        {isWorker
                          ? selectedWorkerSource
                            ? `${selectedWorkerSource.fromStockLabel} has ${formatKg(selectedWorkerSource.remainingInKg)} remaining`
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
            {totalMaterialUsed > netWeight && netWeight > 0 && (
              <p className="text-[10px] text-red-400/70">
                Wastage: {(totalMaterialUsed - netWeight).toFixed(2)} kg
              </p>
            )}
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Size & Mic</label>
            <InputWithCamera type="text" name="sizeMic" value={form.sizeMic} onChange={handleChange} placeholder="e.g. 12mm / 3.5 mic" />
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
