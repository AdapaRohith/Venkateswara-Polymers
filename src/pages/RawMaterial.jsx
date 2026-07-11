import { useCallback, useEffect, useMemo, useState } from 'react'
import useSSE from '../hooks/useSSE'
import DataTable from '../components/DataTable'
import InputWithCamera from '../components/InputWithCamera'
import TolerancePanel from '../components/TolerancePanel'
import { useToast } from '../components/Toast'
import usePersistentState from '../hooks/usePersistentState'
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

const columns = [
  { key: 'material_name', label: 'Material Name' },
  { key: 'total_quantity_kg', label: 'Total Quantity (kg)', render: (value) => toNumber(value).toFixed(2) },
]

const batchColumns = [
  { 
    key: 'created_at', 
    label: 'Date', 
    render: (val) => new Date(val).toLocaleString() 
  },
  { key: 'material_name', label: 'Material Name' },
  { key: 'quantity_kg', label: 'Quantity (kg)', render: (value) => toNumber(value).toFixed(2) },
  { key: 'created_by_name', label: 'Added By' },
  { key: 'note', label: 'Note' },
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
  const [lastTolerance, setLastTolerance] = useState(null)

  const [exporting, setExporting] = useState(false)
  const [showAddMaterial, setShowAddMaterial] = useState(false)
  const [newMaterialName, setNewMaterialName] = useState('')
  const [submittingMaterial, setSubmittingMaterial] = useState(false)
  const [deletingBatchId, setDeletingBatchId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)  // { id, materialName, quantityKg }

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

  useEffect(() => {
    console.info('[RawMaterial] mounted')
  }, [])

  const [addForm, setAddForm] = usePersistentState('vp_raw_material_add_form', {
    material_name: '',
    quantity: '',
    expectedQuantity: '',
    quantityUnit: 'kg',
    note: '',
  })

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
    const expectedQty = toNumber(addForm.expectedQuantity)
    const expectedQtyInKg = expectedQty > 0
      ? (addForm.quantityUnit === 'tons' ? expectedQty * 1000 : expectedQty)
      : undefined

    setSubmittingAdd(true)
    try {
      console.info('[RawMaterial] calling POST /raw-material/add')
      const { data } = await api.post('/raw-material/add', {
        material_name: addForm.material_name.trim(),
        quantity_kg: qtyInKg,
        expected_quantity_kg: expectedQtyInKg,
        note: addForm.note?.trim() || '',
      })

      setLastTolerance(data?.tolerance ? {
        ...data.tolerance,
        expected: expectedQtyInKg || qtyInKg,
        actual: qtyInKg,
      } : null)
      await Promise.allSettled([refreshRawTotals(), refreshMaterialOptions(), refreshBatches()])
      if (data?.tolerance?.tolerance_status === 'BREACH') {
        toast.warning('Raw material added with tolerance breach')
      } else {
        toast.success('Raw material added')
      }
      setAddForm((previous) => ({ ...previous, quantity: '', expectedQuantity: '', note: '' }))
    } catch (error) {
      console.error('Failed to add raw material', error)
      const strictDetails = error?.response?.data?.details
      if (strictDetails) {
        setLastTolerance({
          ...strictDetails,
          expected: expectedQtyInKg || qtyInKg,
          actual: qtyInKg,
        })
      }
      toast.error(error?.response?.data?.error || 'Failed to add raw material')
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
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Raw Material</h2>
      </div>

      {totalsError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {totalsError}
        </div>
      )}

      {materialOptionsError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {materialOptionsError}
        </div>
      )}

      {!isWorker && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative overflow-hidden rounded-xl border border-border-default bg-bg-card p-5 shadow-lg shadow-black/30">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
            <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Material Types</p>
            <p className="text-3xl font-semibold text-text-primary">{totalTypes}</p>
          </div>
          <div className="relative overflow-hidden rounded-xl border border-border-default bg-bg-card p-5 shadow-lg shadow-black/30">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
            <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Total Raw Material</p>
            <p className="text-3xl font-semibold text-accent-gold">{formatKg(totalQtyKg)}</p>
          </div>
        </div>
      )}

      <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-5">
        <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">Add / Update Raw Material</h3>
        <form onSubmit={handleSubmitAdd} className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Material Name</label>
              <button
                type="button"
                onClick={() => setShowAddMaterial(true)}
                className="text-xs font-semibold text-accent-gold hover:text-accent-gold-hover transition-colors"
              >
                + Add Item
              </button>
            </div>
            <select
              name="material_name"
              value={addForm.material_name}
              onChange={handleAddChange}
              className="bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold w-full"
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

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Note (Optional)</label>
            <input
              type="text"
              name="note"
              value={addForm.note}
              onChange={handleAddChange}
              placeholder="E.g., Batch #1234 or Supplier ABC"
              className="bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold w-full"
              disabled={submittingAdd}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Quantity</label>
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

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Expected Quantity</label>
            <InputWithCamera
              type="text"
              inputMode="decimal"
              name="expectedQuantity"
              value={addForm.expectedQuantity}
              onChange={handleAddChange}
              placeholder="Optional"
              className="w-full"
              disabled={submittingAdd}
            />
          </div>

          <div className="flex items-end md:col-span-2">
            <button
              type="submit"
              disabled={submittingAdd || loadingMaterialOptions || materialOptions.length === 0}
              className="w-full bg-accent-gold text-black font-semibold py-2.5 rounded-lg text-sm transition-all duration-200 hover:bg-accent-gold-hover active:scale-[0.98] disabled:opacity-50"
            >
              {submittingAdd ? 'Submitting...' : 'Add Raw Material'}
            </button>
          </div>
        </form>
        <div className="mt-5">
          <TolerancePanel
            tolerance={lastTolerance}
            title="Raw Material Tolerance"
            context={addForm.material_name || 'Last raw material entry'}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={tableData}
        emptyMessage={loadingTotals ? 'Loading raw material totals...' : 'No raw materials yet.'}
      />

      <div className="pt-6 border-t border-border-default space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-xl font-semibold text-text-primary tracking-tight">Batch History</h3>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || batches.length === 0}
            className="rounded-lg bg-accent-gold px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-accent-gold/90 disabled:opacity-50"
          >
            {exporting ? 'Exporting...' : 'Export Logs'}
          </button>
        </div>
        {batchesError && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {batchesError}
          </div>
        )}
        <DataTable
          columns={batchColumns}
          data={batches}
          emptyMessage={loadingBatches ? 'Loading batches...' : 'No raw material batches found.'}
          onDelete={promptDelete}
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
    </div>
  )
}
