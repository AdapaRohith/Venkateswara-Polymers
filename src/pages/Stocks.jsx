import { useMemo } from 'react'
import { SectionBarChart } from '../components/Charts'
import InputWithCamera from '../components/InputWithCamera'
import { useToast } from '../components/Toast'
import usePersistentState from '../hooks/usePersistentState'
import api from '../utils/api'
import { buildStockBatches, buildStockIssuances, formatKg, getNextStockId, toKg } from '../utils/stock'
import {
  createInventoryTransaction,
  deleteInventoryTransaction,
  ensureInventoryBalance,
  INVENTORY_NOTE_CATEGORIES,
  INVENTORY_TRANSACTION_TYPES,
  makeInventoryTransaction,
} from '../utils/inventory'

const getTodayDate = () => new Date().toISOString().split('T')[0]

function getIssueStatusClass(status) {
  if (status === 'Closed') return 'bg-red-500/10 text-red-400'
  if (status === 'In Use') return 'bg-amber-500/10 text-amber-400'
  return 'bg-emerald-500/10 text-emerald-400'
}

export default function Stocks({
  user,
  rawMaterials,
  stockUsage,
  stockIssuances,
  stockBalances = {},
  refreshInventoryData,
}) {
  const toast = useToast()
  const isOwner = user?.role === 'owner'

  const [filterBrand, setFilterBrand] = usePersistentState('vp_stocks_filter_brand', '')
  const [filterCode, setFilterCode] = usePersistentState('vp_stocks_filter_code', '')
  const [usageForm, setUsageForm] = usePersistentState('vp_stocks_usage_form', {
    date: getTodayDate(),
    quantityUsed: '',
    quantityUnit: 'kg',
    fromStockId: '',
  })
  const [issuanceForm, setIssuanceForm] = usePersistentState('vp_stocks_issuance_form', {
    date: getTodayDate(),
    quantityIssued: '',
    quantityUnit: 'kg',
    fromStockId: '',
    note: '',
  })

  const stockBatches = useMemo(
    () => buildStockBatches(rawMaterials, stockUsage, stockIssuances, stockBalances),
    [rawMaterials, stockBalances, stockUsage, stockIssuances],
  )
  const stockIssuanceRows = useMemo(
    () => buildStockIssuances(stockIssuances, rawMaterials, stockUsage, stockBalances),
    [stockBalances, stockIssuances, rawMaterials, stockUsage],
  )

  const uniqueBrands = useMemo(
    () => [...new Set(rawMaterials.map((item) => item.brandName).filter(Boolean))].sort(),
    [rawMaterials],
  )
  const uniqueCodes = useMemo(
    () => [...new Set(rawMaterials.map((item) => item.codeName).filter(Boolean))].sort(),
    [rawMaterials],
  )

  const filteredBatches = useMemo(() => {
    return stockBatches.filter((batch) => {
      if (filterBrand && batch.brandName !== filterBrand) return false
      if (filterCode && batch.codeName !== filterCode) return false
      return true
    })
  }, [filterBrand, filterCode, stockBatches])

  const issuableBatches = filteredBatches.filter((batch) => batch.availableToIssue > 0)
  const selectedUsageBatch = stockBatches.find((batch) => String(batch.id) === String(usageForm.fromStockId))
  const selectedIssuanceBatch = stockBatches.find((batch) => String(batch.id) === String(issuanceForm.fromStockId))
  const stockSelectPlaceholder = issuableBatches.length > 0 ? 'Select stock batch...' : 'No free stock available'
  const stockSelectHelper = issuableBatches.length > 0
    ? 'Only stock with free balance is shown here.'
    : stockBatches.length === 0
      ? 'No stock batches exist yet. Add raw material first.'
      : (filterBrand || filterCode)
        ? 'No stock batch matches the current brand/code filters.'
        : 'All stock is either already used or reserved in issued balances.'

  const totalStockIn = stockBatches.reduce((sum, batch) => sum + batch.initialQty, 0)
  const totalUsed = stockBatches.reduce((sum, batch) => sum + batch.totalUsed, 0)
  const totalIssuedOutstanding = stockBatches.reduce((sum, batch) => sum + batch.issuedOutstanding, 0)
  const totalFreeStock = stockBatches.reduce((sum, batch) => sum + batch.availableToIssue, 0)

  const chartData = useMemo(
    () => filteredBatches.map((batch) => ({ name: batch.date, value: batch.availableToIssue / 1000 })),
    [filteredBatches],
  )
  const currentWorkerIssuance = stockIssuanceRows.find((issuance) => issuance.remainingInKg > 0) || null

  const handleUsageChange = (event) => {
    const { name, value } = event.target
    setUsageForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleIssuanceChange = (event) => {
    const { name, value } = event.target
    setIssuanceForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmitUsage = async (event) => {
    event.preventDefault()

    if (!usageForm.date || !usageForm.quantityUsed || !usageForm.fromStockId) {
      toast.error('Select a stock batch and quantity')
      return
    }

    const quantityInKg = toKg(usageForm.quantityUsed, usageForm.quantityUnit)
    if (quantityInKg <= 0) {
      toast.error('Usage quantity must be greater than zero')
      return
    }

    if (!selectedUsageBatch) {
      toast.error('Selected stock batch not found')
      return
    }

    if (quantityInKg > selectedUsageBatch.availableToIssue) {
      toast.error(`Only ${formatKg(selectedUsageBatch.availableToIssue)} is free for direct usage`)
      return
    }

    try {
      const { ok, balance } = await ensureInventoryBalance(api, selectedUsageBatch.id, quantityInKg)
      if (!ok) {
        toast.error(`Only ${formatKg(balance)} is currently available for this stock`)
        return
      }

      await createInventoryTransaction(
        api,
        makeInventoryTransaction({
          stockId: selectedUsageBatch.id,
          transactionType: INVENTORY_TRANSACTION_TYPES.ADJUSTMENT,
          direction: 'OUT',
          quantityInKg,
          metadata: {
            category: INVENTORY_NOTE_CATEGORIES.DIRECT_USAGE,
            date: usageForm.date,
            quantityUsed: Number(usageForm.quantityUsed),
            quantityUnit: usageForm.quantityUnit,
            fromStockLabel: selectedUsageBatch.label,
            beforeBalance: selectedUsageBatch.physicalRemaining,
            afterBalance: selectedUsageBatch.physicalRemaining - quantityInKg,
            logMessage: `${formatKg(quantityInKg)} used directly from stock (${selectedUsageBatch.label})`,
            source: 'Manual',
          },
        }),
      )
      await refreshInventoryData?.()
    } catch (error) {
      console.error('Failed to save stock usage entry', error)
      toast.error(error.response?.data?.error || 'Failed to save direct stock usage')
      return
    }

    setUsageForm({ date: getTodayDate(), quantityUsed: '', quantityUnit: 'kg', fromStockId: '' })
    toast.success('Direct stock usage logged')
  }

  const handleIssueStock = async (event) => {
    event.preventDefault()

    if (!issuanceForm.date || !issuanceForm.quantityIssued || !issuanceForm.fromStockId) {
      toast.error('Select a stock batch and quantity to issue')
      return
    }

    const quantityInKg = toKg(issuanceForm.quantityIssued, issuanceForm.quantityUnit)
    if (quantityInKg <= 0) {
      toast.error('Issued quantity must be greater than zero')
      return
    }

    if (!selectedIssuanceBatch) {
      toast.error('Selected stock batch not found')
      return
    }

    if (quantityInKg > selectedIssuanceBatch.availableToIssue) {
      toast.error(`Only ${formatKg(selectedIssuanceBatch.availableToIssue)} can still be issued`)
      return
    }

    try {
      const { ok, balance } = await ensureInventoryBalance(api, selectedIssuanceBatch.id, quantityInKg)
      if (!ok) {
        toast.error(`Only ${formatKg(balance)} is currently available for this stock`)
        return
      }

      const issuedStockId = getNextStockId({
        stockBalances,
        collections: [rawMaterials, stockIssuanceRows],
      })
      const issuedBy = user?.name || user?.email || 'Owner'

      const sourceTransaction = await createInventoryTransaction(
        api,
        makeInventoryTransaction({
          stockId: selectedIssuanceBatch.id,
          transactionType: INVENTORY_TRANSACTION_TYPES.ISSUE,
          direction: 'OUT',
          quantityInKg,
          metadata: {
            category: INVENTORY_NOTE_CATEGORIES.ISSUANCE_SOURCE,
            date: issuanceForm.date,
            issuedStockId,
            sourceStockId: selectedIssuanceBatch.id,
            sourceStockLabel: selectedIssuanceBatch.label,
            brandName: selectedIssuanceBatch.brandName || '',
            codeName: selectedIssuanceBatch.codeName || '',
            quantityIssued: Number(issuanceForm.quantityIssued),
            quantityUnit: issuanceForm.quantityUnit,
            note: issuanceForm.note.trim(),
            issuedBy,
          },
        }),
      )

      await createInventoryTransaction(
        api,
        makeInventoryTransaction({
          stockId: issuedStockId,
          transactionType: INVENTORY_TRANSACTION_TYPES.ADJUSTMENT,
          direction: 'IN',
          quantityInKg,
          metadata: {
            category: INVENTORY_NOTE_CATEGORIES.ISSUED_STOCK,
            date: issuanceForm.date,
            sourceTransactionId: sourceTransaction.id,
            sourceStockId: selectedIssuanceBatch.id,
            sourceStockLabel: selectedIssuanceBatch.label,
            brandName: selectedIssuanceBatch.brandName || '',
            codeName: selectedIssuanceBatch.codeName || '',
            quantityIssued: Number(issuanceForm.quantityIssued),
            quantityUnit: issuanceForm.quantityUnit,
            note: issuanceForm.note.trim(),
            issuedBy,
          },
        }),
      )

      await refreshInventoryData?.()
    } catch (error) {
      console.error('Failed to issue stock', error)
      toast.error(error.response?.data?.error || 'Failed to issue stock')
      return
    }

    setIssuanceForm({ date: getTodayDate(), quantityIssued: '', quantityUnit: 'kg', fromStockId: '', note: '' })
    toast.success('Stock issued for worker manufacturing')
  }

  const handleDeleteUsage = async (usageId) => {
    const target = stockUsage.find((entry) => entry.id === usageId)
    if (target?.source && target.source !== 'Manual') {
      toast.error('Delete manufacturing or wastage records from their own pages')
      return
    }

    try {
      await deleteInventoryTransaction(api, target?.transactionId || target?.id)
      await refreshInventoryData?.()
      toast.success('Manual stock usage removed')
    } catch (error) {
      console.error('Failed to delete stock usage entry', error)
      toast.error('Failed to delete stock usage entry')
    }
  }

  const handleDeleteIssuance = async (issuanceId) => {
    const issuance = stockIssuanceRows.find((entry) => entry.id === issuanceId)
    if (!issuance) return

    if (issuance.usedInKg > 0) {
      toast.error('This issued stock has already been used and cannot be removed')
      return
    }

    try {
      const transactionIds = [issuance.transactionId || issuance.id, issuance.sourceTransactionId].filter(Boolean)
      await Promise.all(transactionIds.map((transactionId) => deleteInventoryTransaction(api, transactionId)))
      await refreshInventoryData?.()
      toast.success('Issued stock removed')
    } catch (error) {
      console.error('Failed to delete issued stock entry', error)
      toast.error('Failed to delete issued stock entry')
    }
  }

  const handlePrintIssuedStock = (issuanceId) => {
    const issuance = stockIssuanceRows.find((entry) => entry.id === issuanceId)
    if (!issuance) {
      toast.error('Issued stock record not found')
      return
    }

    const printWindow = window.open('', '_blank', 'width=900,height=700')
    if (!printWindow) return

    const escapeHtml = (value) => String(value ?? '-')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

    printWindow.document.write(`
      <html>
        <head>
          <title>Issued Stock Slip</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #1f2937; background: #ffffff; }
            .sheet { border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; max-width: 720px; }
            .title { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
            .subtitle { font-size: 12px; color: #6b7280; margin: 0 0 24px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 28px; }
            .label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; }
            .value { font-size: 16px; font-weight: 600; color: #111827; }
          </style>
        </head>
        <body>
          <div class="sheet">
            <h1 class="title">Issued Stock Slip</h1>
            <p class="subtitle">Venkateswara Polymers</p>

            <div class="grid">
              <div>
                <div class="label">Issued Weight</div>
                <div class="value">${escapeHtml(formatKg(issuance.quantityInKg))}</div>
              </div>
              <div>
                <div class="label">Stock Name</div>
                <div class="value">${escapeHtml(issuance.fromStockLabel)}</div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `)

    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
    printWindow.close()
  }

  const inputClass =
    'w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30'
  const selectClass =
    'bg-bg-input text-text-primary border border-gray-700 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold shrink-0 appearance-none cursor-pointer text-center'

  if (!isOwner) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Issued Stock</h2>
          <p className="text-sm text-text-secondary mt-1">
            This stock is assigned by admin and is used automatically in your manufacturing form.
          </p>
        </div>

        <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Current Issued Stock</label>
              <div className="w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-3 text-sm">
                {currentWorkerIssuance
                  ? `${currentWorkerIssuance.fromStockLabel} - ${formatKg(currentWorkerIssuance.remainingInKg)} remaining`
                  : 'No issued stock available'}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Instruction</label>
              <div className="w-full bg-bg-input text-text-secondary border border-gray-700 rounded-lg px-4 py-3 text-sm">
                To switch stock, request a new issue from the admin panel. Worker accounts cannot change stock manually.
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Stocks</h2>
        <p className="text-sm text-text-secondary mt-1">
          {isOwner
            ? 'Issue stock to workers and keep reserved stock separate from direct usage'
            : 'Workers can manufacture only with stock that has been issued first'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500/80 via-emerald-500/40 to-transparent" />
          <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Total Stock In</p>
          <p className="text-3xl font-semibold text-emerald-400">{formatKg(totalStockIn)}</p>
        </div>
        <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-red-500/80 via-red-500/40 to-transparent" />
          <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Physically Used</p>
          <p className="text-3xl font-semibold text-red-400">{formatKg(totalUsed)}</p>
        </div>
        <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-500/80 via-amber-500/40 to-transparent" />
          <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Issued To Workers</p>
          <p className="text-3xl font-semibold text-amber-400">{formatKg(totalIssuedOutstanding)}</p>
        </div>
        <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
          <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Free Stock</p>
          <p className="text-3xl font-semibold text-accent-gold">{formatKg(totalFreeStock)}</p>
        </div>
      </div>

      {chartData.length > 0 && (
        <SectionBarChart data={chartData} title="Free Stock Available for Issue (tons)" color="#f59e0b" />
      )}

      <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Filter by Brand</label>
            <select
              value={filterBrand}
              onChange={(event) => {
                setFilterBrand(event.target.value)
                setUsageForm((prev) => ({ ...prev, fromStockId: '' }))
                setIssuanceForm((prev) => ({ ...prev, fromStockId: '' }))
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
                setUsageForm((prev) => ({ ...prev, fromStockId: '' }))
                setIssuanceForm((prev) => ({ ...prev, fromStockId: '' }))
              }}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">All Codes</option>
              {uniqueCodes.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">Stock Batches</h3>
          <p className="text-xs text-text-secondary/50 mt-1">
            Physical balance is the actual stock left. Free balance is what can still be issued or used directly.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-border-default bg-white/[0.02]">
                <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">#</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Date</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Brand</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Code</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Initial</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Used</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Issued</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Free</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Physical</th>
              </tr>
            </thead>
            <tbody>
              {filteredBatches.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-10 text-center text-text-secondary/50">
                    No stock batches match the current filters.
                  </td>
                </tr>
              ) : (
                filteredBatches.map((batch, index) => (
                  <tr key={batch.id} className="border-b border-border-default/50 hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-3 text-text-secondary">{index + 1}</td>
                    <td className="px-6 py-3 text-text-primary font-medium">{batch.date}</td>
                    <td className="px-6 py-3 text-text-primary">{batch.brandName || '-'}</td>
                    <td className="px-6 py-3 text-text-secondary">{batch.codeName || '-'}</td>
                    <td className="px-6 py-3 text-right text-emerald-400">{formatKg(batch.initialQty)}</td>
                    <td className="px-6 py-3 text-right text-red-400">{formatKg(batch.totalUsed)}</td>
                    <td className="px-6 py-3 text-right text-amber-400">{formatKg(batch.issuedOutstanding)}</td>
                    <td className="px-6 py-3 text-right text-accent-gold font-semibold">{formatKg(batch.availableToIssue)}</td>
                    <td className="px-6 py-3 text-right text-text-primary">{formatKg(batch.physicalRemaining)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isOwner ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6">
            <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">Issue Stock To Workers</h3>
            <form onSubmit={handleIssueStock} className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Date</label>
                <InputWithCamera type="date" name="date" value={issuanceForm.date} onChange={handleIssuanceChange} required />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">From Stock Batch</label>
                <select
                  name="fromStockId"
                  value={issuanceForm.fromStockId}
                  onChange={handleIssuanceChange}
                  className={`${inputClass} cursor-pointer`}
                  required
                >
                  <option value="">{stockSelectPlaceholder}</option>
                  {issuableBatches.map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.label} - {formatKg(batch.availableToIssue)} free
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-text-secondary/60">{stockSelectHelper}</p>
                {selectedIssuanceBatch && (
                  <p className="text-[11px] text-amber-400/80">
                    {formatKg(selectedIssuanceBatch.availableToIssue)} can still be issued from this batch.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Quantity To Issue</label>
                <div className="flex gap-2">
                  <InputWithCamera
                    type="text"
                    inputMode="decimal"
                    name="quantityIssued"
                    value={issuanceForm.quantityIssued}
                    onChange={handleIssuanceChange}
                    placeholder="0.00"
                    className="flex-1"
                    required
                  />
                  <select name="quantityUnit" value={issuanceForm.quantityUnit} onChange={handleIssuanceChange} className={`${selectClass} w-24`}>
                    <option value="kg">kg</option>
                    <option value="tons">tons</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Note</label>
                <InputWithCamera type="text" name="note" value={issuanceForm.note} onChange={handleIssuanceChange} placeholder="Optional note for the worker" />
              </div>
              <button type="submit" className="w-full bg-accent-gold text-black font-semibold py-2.5 rounded-lg text-sm transition-all duration-200 hover:bg-accent-gold-hover active:scale-[0.98]">
                Issue Stock
              </button>
              <p className="text-[11px] text-text-secondary/50">
                Issued stock is now written into the shared inventory ledger.
              </p>
            </form>
          </div>

          <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6">
            <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">Log Direct Usage</h3>
            <form onSubmit={handleSubmitUsage} className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Date</label>
                <InputWithCamera type="date" name="date" value={usageForm.date} onChange={handleUsageChange} required />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">From Stock Batch</label>
                <select
                  name="fromStockId"
                  value={usageForm.fromStockId}
                  onChange={handleUsageChange}
                  className={`${inputClass} cursor-pointer`}
                  required
                >
                  <option value="">{issuableBatches.length > 0 ? 'Select free stock batch...' : 'No free stock available'}</option>
                  {issuableBatches.map((batch) => (
                    <option key={batch.id} value={batch.id}>
                      {batch.label} - {formatKg(batch.availableToIssue)} free
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-text-secondary/60">{stockSelectHelper}</p>
                {selectedUsageBatch && (
                  <p className="text-[11px] text-emerald-400/80">
                    {formatKg(selectedUsageBatch.availableToIssue)} is free for direct use.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Quantity Used</label>
                <div className="flex gap-2">
                  <InputWithCamera
                    type="text"
                    inputMode="decimal"
                    name="quantityUsed"
                    value={usageForm.quantityUsed}
                    onChange={handleUsageChange}
                    placeholder="0.00"
                    className="flex-1"
                    required
                  />
                  <select name="quantityUnit" value={usageForm.quantityUnit} onChange={handleUsageChange} className={`${selectClass} w-24`}>
                    <option value="kg">kg</option>
                    <option value="tons">tons</option>
                  </select>
                </div>
              </div>
              <button type="submit" className="w-full bg-emerald-500/85 text-white font-semibold py-2.5 rounded-lg text-sm transition-all duration-200 hover:bg-emerald-500 active:scale-[0.98]">
                Log Direct Usage
              </button>
              <p className="text-[11px] text-text-secondary/50">
                Reserved stock cannot be used here. Workers must consume from issued balances in Manufacturing.
              </p>
            </form>
          </div>
        </div>
      ) : (
        <div className="bg-bg-card rounded-xl border border-amber-500/20 shadow-lg shadow-black/30 p-6">
          <h3 className="text-sm font-medium text-amber-400 tracking-widest uppercase mb-2">Worker Rule</h3>
          <p className="text-sm text-text-secondary">
            Direct stock logging is disabled for worker accounts. Use the Manufacturing page and select only issued stock.
          </p>
        </div>
      )}

      <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">Issued Stock Register</h3>
          <p className="text-xs text-text-secondary/50 mt-1">Workers can consume only these issued balances in Manufacturing.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-border-default bg-white/[0.02]">
                <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">#</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Date</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Stock Batch</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Issued</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Used</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Remaining</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Status</th>
                {isOwner && <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-widest uppercase">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {stockIssuanceRows.length === 0 ? (
                <tr>
                  <td colSpan={isOwner ? 8 : 7} className="px-6 py-10 text-center text-text-secondary/50">
                    No stock has been issued yet.
                  </td>
                </tr>
              ) : (
                stockIssuanceRows.map((issuance) => (
                  <tr key={issuance.id} className="border-b border-border-default/50 hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-3 text-text-secondary">{issuance.sno}</td>
                    <td className="px-6 py-3 text-text-primary font-medium">{issuance.date}</td>
                    <td className="px-6 py-3 text-text-primary">
                      <div>{issuance.fromStockLabel}</div>
                      {issuance.note && <div className="text-[11px] text-text-secondary/60 mt-1">{issuance.note}</div>}
                    </td>
                    <td className="px-6 py-3 text-right text-amber-400">{formatKg(issuance.quantityInKg)}</td>
                    <td className="px-6 py-3 text-right text-red-400">{formatKg(issuance.usedInKg)}</td>
                    <td className="px-6 py-3 text-right text-accent-gold font-semibold">{formatKg(issuance.remainingInKg)}</td>
                    <td className="px-6 py-3 text-right">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${getIssueStatusClass(issuance.status)}`}>
                        {issuance.status}
                      </span>
                    </td>
                    {isOwner && (
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => handlePrintIssuedStock(issuance.id)}
                            className="text-accent-gold hover:text-accent-gold-hover transition-colors"
                          >
                            Print
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteIssuance(issuance.id)}
                            className="text-red-400/60 hover:text-red-400 transition-colors disabled:opacity-30"
                            disabled={issuance.usedInKg > 0}
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">Usage Log History</h3>
        </div>
        {stockUsage.length === 0 ? (
          <div className="px-6 pb-8 text-center text-text-secondary/50 text-sm">No stock usage logged yet.</div>
        ) : (
          <div className="px-4 pb-4 space-y-2">
            {[...stockUsage].reverse().map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-3 px-4 py-3 rounded-lg border border-border-default/50 bg-white/[0.01] hover:bg-white/[0.03] transition-colors group"
              >
                <div className="mt-1.5 w-2 h-2 rounded-full bg-red-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary leading-relaxed">
                    <span className="font-semibold text-red-400">{formatKg(entry.quantityInKg)}</span>
                    {' '}used from stock{' '}
                    <span className="font-medium text-accent-gold">({entry.fromStockLabel})</span>
                    {entry.issuanceId && (
                      <span className="ml-2 text-[10px] font-semibold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">
                        Issued stock
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-text-secondary/60 mt-0.5">
                    {formatKg(entry.beforeBalance)} to {formatKg(entry.afterBalance)} physical balance
                  </p>
                  {entry.issuanceId && (
                    <p className="text-[11px] text-amber-400/80 mt-1">
                      Issued balance: {formatKg(entry.issueBalanceBefore)} to {formatKg(entry.issueBalanceAfter)}
                    </p>
                  )}
                  <p className="text-[10px] text-text-secondary/40 mt-1">{entry.date} | {entry.source || 'Manual'}</p>
                </div>
                {isOwner && (!entry.source || entry.source === 'Manual') && (
                  <button
                    onClick={() => handleDeleteUsage(entry.id)}
                    className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 p-1 rounded transition-all"
                    title="Delete entry"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
