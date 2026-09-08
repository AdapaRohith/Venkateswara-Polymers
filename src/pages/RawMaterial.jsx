import { useCallback, useEffect, useMemo, useState } from 'react'
import useSSE from '../hooks/useSSE'
import DataTable from '../components/DataTable'
import InputWithCamera from '../components/InputWithCamera'
import Pictogram from '../components/Pictogram'
import { useToast } from '../components/Toast'
import usePersistentState from '../hooks/usePersistentState'
import api from '../utils/api'
import { formatDate, formatTime, todayIST } from '../utils/datetime'

function toNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function formatKg(kg) {
  const numericValue = toNumber(kg)
  if (Math.abs(numericValue) >= 1000) return `${(numericValue / 1000).toFixed(2)} tons`
  return `${numericValue.toFixed(2)} kg`
}

const columns = [
  { key: 'material_name', label: 'Material', icon: 'material' },
  {
    key: 'total_quantity_kg',
    label: 'In Stock',
    icon: 'stock',
    render: (value) => (
      <span className="font-mono tabular-nums">{toNumber(value).toFixed(2)} kg</span>
    ),
  },
]

const batchColumns = [
  { key: 'created_at', label: 'Date', icon: 'date', render: (val) => formatDate(val) },
  {
    key: 'created_at_time',
    label: 'Time',
    icon: 'clock',
    render: (_val, row) => (
      <span className="text-text-secondary">{formatTime(row.created_at)}</span>
    ),
  },
  { key: 'material_name', label: 'Material', icon: 'material' },
  {
    key: 'quantity_kg',
    label: 'Quantity',
    icon: 'weight',
    render: (value) => (
      <span className="font-mono tabular-nums">{toNumber(value).toFixed(2)} kg</span>
    ),
  },
  { key: 'created_by_name', label: 'Added By', icon: 'person' },
  { key: 'note', label: 'Note', icon: 'note' },
]

export default function RawMaterial({ user }) {
  const toast = useToast()
  const isWorker = user?.role === 'worker'
  const [submittingAdd, setSubmittingAdd] = useState(false)
  const [loadingTotals, setLoadingTotals] = useState(true)
  const [totalsError, setTotalsError] = useState('')
  const [rawTotals, setRawTotals] = useState([])
  const [materialOptions, setMaterialOptions] = useState([])
  const [loadingMaterialOptions, setLoadingMaterialOptions] = useState(true)
  const [materialOptionsError, setMaterialOptionsError] = useState('')

  const [exporting, setExporting] = useState(false)
  const [showAddMaterial, setShowAddMaterial] = useState(false)
  const [newMaterialName, setNewMaterialName] = useState('')
  const [submittingMaterial, setSubmittingMaterial] = useState(false)
  const [deletingBatchId, setDeletingBatchId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)  // { id, materialName, quantityKg }
  const [editTotal, setEditTotal] = useState(null)  // { materialName, currentTotal }
  const [editQuantity, setEditQuantity] = useState('')
  const [submittingEdit, setSubmittingEdit] = useState(false)

  const handleExport = async () => {
    try {
      setExporting(true)
      await fetch('https://n8n.avlokai.com/webhook-test/77d8abd5-246a-4797-8370-1ebfdb10ffec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'raw_material_batches', logs: batches }),
      })
      toast.success('Logs exported successfully!')
    } catch (err) {
      console.error('Export failed', err)
      toast.error('Failed to export logs.')
    } finally {
      setExporting(false)
    }
  }

  const handleAddNewMaterial = async () => {
    if (!newMaterialName?.trim()) {
      toast.error('Material name is required')
      return
    }

    setSubmittingMaterial(true)
    try {
      const response = await api.post('/materials', {
        name: newMaterialName.trim(),
      })

      // Response: { id: 1, name: "Material Name" }
      const newMaterial = response.data

      // Refresh dropdown so new material appears
      await refreshMaterialOptions()

      // Auto-select the newly added material by name
      setAddForm((previous) => ({ ...previous, material_name: newMaterial.name }))
      setNewMaterialName('')
      setShowAddMaterial(false)
      toast.success('Material added successfully!')
    } catch (error) {
      console.error('Failed to add material', error)
      toast.error(error?.response?.data?.error || 'Failed to add material')
    } finally {
      setSubmittingMaterial(false)
    }
  }

  const handleDeleteBatch = async (batchId) => {
    setDeletingBatchId(batchId)
    try {
      await api.delete(`/raw-material/batches/${batchId}`)
      toast.success('Raw material batch deleted. Stock total has been consolidated.')
      await Promise.allSettled([refreshRawTotals(), refreshMaterialOptions(), refreshBatches()])
    } catch (error) {
      console.error('Failed to delete batch', error)
      toast.error(error?.response?.data?.error || error?.response?.data?.detail || 'Failed to delete batch')
    } finally {
      setDeletingBatchId(null)
      setConfirmDelete(null)
    }
  }

  const promptDelete = (row) => {
    setConfirmDelete({
      id: row.id,
      materialName: row.material_name,
      quantityKg: toNumber(row.quantity_kg).toFixed(2),
    })
  }

  const openEditTotal = (row) => {
    setEditTotal({
      materialName: row.material_name,
      currentTotal: toNumber(row.total_quantity_kg),
    })
    setEditQuantity('')
  }

  const handleEditTotal = async () => {
    const qty = toNumber(editQuantity)
    if (qty <= 0) {
      toast.error('Quantity must be greater than zero')
      return
    }
    setSubmittingEdit(true)
    try {
      await api.post('/raw-material/add', {
        material_name: editTotal.materialName,
        quantity_kg: qty,
        note: 'Manual stock adjustment',
      })
      toast.success(`Added ${qty.toFixed(2)} kg to ${editTotal.materialName}. Total is now ${(editTotal.currentTotal + qty).toFixed(2)} kg.`)
      await Promise.allSettled([refreshRawTotals(), refreshMaterialOptions(), refreshBatches()])
      setEditTotal(null)
    } catch (error) {
      console.error('Failed to adjust stock', error)
      toast.error(error?.response?.data?.error || error?.response?.data?.detail || 'Failed to adjust stock')
    } finally {
      setSubmittingEdit(false)
    }
  }

  useEffect(() => {
    console.info('[RawMaterial] mounted')
  }, [])

  const [addForm, setAddForm] = usePersistentState('vp_raw_material_add_form', {
    material_name: '',
    quantity: '',
    date: '',
    quantityUnit: 'kg',
    note: '',
  })

  // A stock entry is often keyed in a day or two after the lorry arrived, so the
  // date is part of the entry rather than whenever someone got to the computer.
  // Empty means today, which is the common case.
  const entryDate = addForm.date || todayIST()

  const [batches, setBatches] = useState([])
  const [loadingBatches, setLoadingBatches] = useState(true)
  const [batchesError, setBatchesError] = useState('')

  const refreshRawTotals = useCallback(async (silent = false) => {
    console.info('[RawMaterial] calling GET /raw-material/totals')
    if (!silent) setLoadingTotals(true)
    setTotalsError('')
    try {
      const { data } = await api.get('/raw-material/totals')
      setRawTotals(Array.isArray(data) ? data : data?.data || [])
    } catch (error) {
      console.error('Failed to load raw material totals', error)
      setTotalsError(error?.response?.data?.error || 'Failed to load raw material totals')
    } finally {
      if (!silent) setLoadingTotals(false)
    }
  }, [])

  const refreshMaterialOptions = useCallback(async (silent = false) => {
    console.info('[RawMaterial] calling GET /raw-material/options')
    if (!silent) setLoadingMaterialOptions(true)
    setMaterialOptionsError('')
    try {
      const { data } = await api.get('/raw-material/options')
      setMaterialOptions(Array.isArray(data) ? data : data?.data || [])
    } catch (error) {
      console.error('Failed to load raw material options', error)
      setMaterialOptionsError(error?.response?.data?.error || 'Failed to load raw material options')
    } finally {
      if (!silent) setLoadingMaterialOptions(false)
    }
  }, [])

  const refreshBatches = useCallback(async (silent = false) => {
    console.info('[RawMaterial] calling GET /raw-material/batches')
    if (!silent) setLoadingBatches(true)
    setBatchesError('')
    try {
      const { data } = await api.get('/raw-material/batches')
      setBatches(Array.isArray(data) ? data : data?.data || [])
    } catch (error) {
      console.error('Failed to load raw material batches', error)
      setBatchesError(error?.response?.data?.error || 'Failed to load batches')
    } finally {
      if (!silent) setLoadingBatches(false)
    }
  }, [])

  useSSE(['raw_material'], () => {
    refreshRawTotals(true).catch(() => {})
    refreshMaterialOptions(true).catch(() => {})
    refreshBatches(true).catch(() => {})
  })

  useEffect(() => {
    refreshRawTotals().catch(() => {})
    refreshMaterialOptions().catch(() => {})
    refreshBatches().catch(() => {})
  }, [refreshMaterialOptions, refreshRawTotals, refreshBatches])

  const handleAddChange = (event) => {
    const { name, value } = event.target
    setAddForm((previous) => ({ ...previous, [name]: value }))
  }

  const handleSubmitAdd = async (event) => {
    event.preventDefault()

    if (!addForm.material_name?.trim()) {
      toast.error('Material name is required')
      return
    }

    const qty = toNumber(addForm.quantity)
    if (qty <= 0) {
      toast.error('Quantity must be greater than zero')
      return
    }

    const qtyInKg = addForm.quantityUnit === 'tons' ? qty * 1000 : qty

    setSubmittingAdd(true)
    try {
      console.info('[RawMaterial] calling POST /raw-material/add')
      await api.post('/raw-material/add', {
        material_name: addForm.material_name.trim(),
        quantity_kg: qtyInKg,
        date: entryDate,
        note: addForm.note?.trim() || '',
      })

      await Promise.allSettled([refreshRawTotals(), refreshMaterialOptions(), refreshBatches()])
      toast.success(`Added ${qtyInKg.toFixed(2)} kg of ${addForm.material_name.trim()} on ${formatDate(entryDate)}`)
      setAddForm((previous) => ({ ...previous, quantity: '', note: '' }))
    } catch (error) {
      console.error('Failed to add raw material', error)
      toast.error(error?.response?.data?.error || error?.response?.data?.detail || 'Failed to add raw material')
    } finally {
      setSubmittingAdd(false)
    }
  }

  const selectClass =
    'bg-bg-input text-text-primary border border-gray-700 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold w-24 shrink-0 appearance-none cursor-pointer text-center'

  const totalTypes = (Array.isArray(rawTotals) ? rawTotals : []).length
  const totalQtyKg = useMemo(
    () => (Array.isArray(rawTotals) ? rawTotals : []).reduce((sum, row) => sum + toNumber(row.total_quantity_kg), 0),
    [rawTotals],
  )

  const tableData = (Array.isArray(rawTotals) ? rawTotals : []).map((row, index) => ({
    ...row,
    id: row.material_name ?? index,
  }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-text-primary">
          <Pictogram name="material" size={20} className="text-accent-gold" />
          Raw Material
        </h2>
        {!isWorker && (
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-card px-3 py-1.5">
              <Pictogram name="material" size={14} className="text-text-secondary/70" />
              <span className="text-text-secondary">Items</span>
              <span className="font-semibold text-text-primary tabular-nums">{totalTypes}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-card px-3 py-1.5">
              <Pictogram name="stock" size={14} className="text-text-secondary/70" />
              <span className="text-text-secondary">In Stock</span>
              <span className="font-semibold text-accent-gold tabular-nums">{formatKg(totalQtyKg)}</span>
            </span>
          </div>
        )}
      </div>

      {totalsError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {totalsError}
        </div>
      )}

      {materialOptionsError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {materialOptionsError}
        </div>
      )}

      <div className="bg-bg-card rounded-lg border border-border-default p-4">
        <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary">
          <Pictogram name="add" size={14} />
          Add Raw Material
        </h3>
        <form onSubmit={handleSubmitAdd} className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="space-y-1.5 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-secondary">
                <Pictogram name="material" size={13} className="text-text-secondary/70" />
                Material
              </label>
              <button
                type="button"
                onClick={() => setShowAddMaterial(true)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-accent-gold transition-colors hover:text-accent-gold-hover"
              >
                <Pictogram name="add" size={12} />
                New
              </button>
            </div>
            <select
              name="material_name"
              value={addForm.material_name}
              onChange={handleAddChange}
              className="w-full rounded-lg border border-gray-700 bg-bg-input px-3 py-2 text-sm text-text-primary transition-colors duration-200 focus:border-accent-gold"
              disabled={submittingAdd || loadingMaterialOptions || materialOptions.length === 0}
              required
            >
              <option value="">
                {loadingMaterialOptions ? 'Loading materials...' : 'Select material name'}
              </option>
              {(Array.isArray(materialOptions) ? materialOptions : []).map((row) => (
                <option key={row.material_name} value={row.material_name}>
                  {row.material_name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-secondary">
              <Pictogram name="date" size={13} className="text-text-secondary/70" />
              Date
            </label>
            <input
              type="date"
              name="date"
              value={entryDate}
              max={todayIST()}
              onChange={handleAddChange}
              className="w-full rounded-lg border border-gray-700 bg-bg-input px-3 py-2 text-sm text-text-primary transition-colors duration-200 focus:border-accent-gold"
              disabled={submittingAdd}
            />
          </div>

          <div className="space-y-1.5">
            <label className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-secondary">
              <Pictogram name="weight" size={13} className="text-text-secondary/70" />
              Quantity
            </label>
            <div className="flex gap-2">
              <InputWithCamera
                type="text"
                inputMode="decimal"
                name="quantity"
                value={addForm.quantity}
                onChange={handleAddChange}
                placeholder="0.00"
                className="flex-1"
                required
                disabled={submittingAdd}
              />
              <select
                name="quantityUnit"
                value={addForm.quantityUnit}
                onChange={handleAddChange}
                className={selectClass}
                disabled={submittingAdd}
              >
                <option value="kg">kg</option>
                <option value="tons">tons</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5 md:col-span-3">
            <label className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-secondary">
              <Pictogram name="note" size={13} className="text-text-secondary/70" />
              Note (Optional)
            </label>
            <input
              type="text"
              name="note"
              value={addForm.note}
              onChange={handleAddChange}
              placeholder="E.g., Batch #1234 or Supplier ABC"
              className="w-full rounded-lg border border-gray-700 bg-bg-input px-3 py-2 text-sm text-text-primary transition-colors duration-200 focus:border-accent-gold"
              disabled={submittingAdd}
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={submittingAdd || loadingMaterialOptions || materialOptions.length === 0}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent-gold py-2 text-sm font-semibold text-black transition-all duration-200 hover:bg-accent-gold-hover active:scale-[0.98] disabled:opacity-50"
            >
              <Pictogram name="add" size={15} />
              {submittingAdd ? 'Saving...' : 'Add'}
            </button>
          </div>
        </form>
      </div>

      <DataTable
        title="Stock On Hand"
        titleIcon="stock"
        columns={columns}
        data={tableData}
        emptyMessage={loadingTotals ? 'Loading raw material totals...' : 'No raw materials yet.'}
        onEdit={openEditTotal}
      />

      <div className="space-y-2">
        {batchesError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {batchesError}
          </div>
        )}
        <DataTable
          title="Entries By Date"
          titleIcon="date"
          columns={batchColumns}
          data={batches}
          groupByDate="created_at"
          emptyMessage={loadingBatches ? 'Loading entries...' : 'No raw material entries found.'}
          onDelete={promptDelete}
          rightAction={(
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || batches.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-default px-2.5 py-1 text-xs font-semibold text-text-secondary transition-colors hover:text-accent-gold disabled:opacity-50"
            >
              <Pictogram name="export" size={13} />
              {exporting ? 'Exporting...' : 'Export'}
            </button>
          )}
        />
      </div>

      {showAddMaterial && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-bg-card rounded-2xl border border-border-default shadow-2xl max-w-md w-full p-6 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">Add New Material</h3>
              <p className="text-sm text-text-secondary mt-1">Enter the name of the new raw material item</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Material Name</label>
              <input
                type="text"
                value={newMaterialName}
                onChange={(e) => setNewMaterialName(e.target.value)}
                placeholder="E.g., Plastic Resin, Steel Wire..."
                className="bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold w-full"
                disabled={submittingMaterial}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddNewMaterial()
                  }
                }}
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowAddMaterial(false)
                  setNewMaterialName('')
                }}
                disabled={submittingMaterial}
                className="flex-1 rounded-lg border border-gray-700 px-4 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-input/50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddNewMaterial}
                disabled={submittingMaterial || !newMaterialName.trim()}
                className="flex-1 rounded-lg bg-accent-gold px-4 py-2.5 text-sm font-semibold text-black transition-all hover:bg-accent-gold-hover active:scale-[0.98] disabled:opacity-50"
              >
                {submittingMaterial ? 'Adding...' : 'Add Material'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-bg-card rounded-2xl border border-border-default shadow-2xl max-w-md w-full p-6 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">Delete Raw Material Batch</h3>
              <p className="text-sm text-text-secondary mt-1">
                This will permanently delete this batch entry and deduct its quantity from the total stock.
                Other entries will remain unchanged.
              </p>
            </div>

            <div className="rounded-lg border border-border-default bg-bg-primary/40 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Material</span>
                <span className="text-text-primary font-medium">{confirmDelete.materialName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Quantity</span>
                <span className="text-red-400 font-semibold">{confirmDelete.quantityKg} kg</span>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={deletingBatchId !== null}
                className="flex-1 rounded-lg border border-gray-700 px-4 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-input/50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDeleteBatch(confirmDelete.id)}
                disabled={deletingBatchId !== null}
                className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-red-700 active:scale-[0.98] disabled:opacity-50"
              >
                {deletingBatchId === confirmDelete.id ? 'Deleting...' : 'Delete Batch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editTotal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-bg-card rounded-2xl border border-border-default shadow-2xl max-w-md w-full p-6 space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">Edit Stock Total</h3>
              <p className="text-sm text-text-secondary mt-1">
                Add stock to <strong>{editTotal.materialName}</strong>. This creates a new batch entry — use the delete button on batch entries to reduce stock.
              </p>
            </div>

            <div className="rounded-lg border border-border-default bg-bg-primary/40 p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Current Total</span>
                <span className="text-text-primary font-semibold">{editTotal.currentTotal.toFixed(2)} kg</span>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Quantity to Add (kg)</label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  value={editQuantity}
                  onChange={(e) => setEditQuantity(e.target.value)}
                  placeholder="Enter quantity to add..."
                  className="bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm w-full transition-colors duration-200 focus:border-accent-gold"
                  disabled={submittingEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEditTotal()
                  }}
                  autoFocus
                />
              </div>
              {editQuantity && toNumber(editQuantity) > 0 && (
                <div className="flex justify-between text-sm pt-1 border-t border-border-subtle">
                  <span className="text-text-secondary">New Total</span>
                  <span className="text-accent-gold font-semibold">
                    {(editTotal.currentTotal + toNumber(editQuantity)).toFixed(2)} kg
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setEditTotal(null); setEditQuantity('') }}
                disabled={submittingEdit}
                className="flex-1 rounded-lg border border-gray-700 px-4 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:bg-bg-input/50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEditTotal}
                disabled={submittingEdit || toNumber(editQuantity) <= 0}
                className="flex-1 rounded-lg bg-accent-gold px-4 py-2.5 text-sm font-semibold text-black transition-all hover:bg-accent-gold-hover active:scale-[0.98] disabled:opacity-50"
              >
                {submittingEdit ? 'Saving...' : 'Add Stock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
