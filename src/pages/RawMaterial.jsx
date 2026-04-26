import { useCallback, useEffect, useMemo, useState } from 'react'
import DataTable from '../components/DataTable'
import EditEntryModal from '../components/EditEntryModal'
import InputWithCamera from '../components/InputWithCamera'
import { useToast } from '../components/Toast'
import usePersistentState from '../hooks/usePersistentState'
import api from '../utils/api'
import { exportSingleSheet } from '../utils/exportToExcel'
import {
  bulkDeleteRawMaterialBatches,
  deleteRawMaterialBatch,
  updateRawMaterialBatch,
} from '../utils/logActions'

const ExcelIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
)

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

  const [exporting, setExporting] = useState(false)
  const [showAddMaterial, setShowAddMaterial] = useState(false)
  const [newMaterialName, setNewMaterialName] = useState('')
  const [submittingMaterial, setSubmittingMaterial] = useState(false)

  const handleExport = () => {
    const rows = batches.map((b) => ({
      date: new Date(b.created_at).toLocaleString(),
      material_name: b.material_name,
      quantity_kg: toNumber(b.quantity_kg).toFixed(2),
      added_by: b.created_by_name || '',
      note: b.note || '',
    }))
    exportSingleSheet({
      filename: `Raw_Material_Batches_${new Date().toISOString().slice(0, 10)}`,
      rows,
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'material_name', label: 'Material Name' },
        { key: 'quantity_kg', label: 'Quantity (kg)' },
        { key: 'added_by', label: 'Added By' },
        { key: 'note', label: 'Note' },
      ],
    })
    toast.success('Batch history exported to Excel')
  }

  const handleExportTotals = () => {
    const rows = tableData.map((r) => ({
      material_name: r.material_name,
      total_quantity_kg: toNumber(r.total_quantity_kg).toFixed(2),
    }))
    exportSingleSheet({
      filename: `Raw_Material_Totals_${new Date().toISOString().slice(0, 10)}`,
      rows,
      columns: [
        { key: 'material_name', label: 'Material Name' },
        { key: 'total_quantity_kg', label: 'Total Quantity (kg)' },
      ],
    })
    toast.success('Raw material totals exported to Excel')
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

  useEffect(() => {
    console.info('[RawMaterial] mounted')
  }, [])

  const [addForm, setAddForm] = usePersistentState('vp_raw_material_add_form', {
    material_name: '',
    quantity: '',
    quantityUnit: 'kg',
    note: '',
  })

  const [batches, setBatches] = useState([])
  const [loadingBatches, setLoadingBatches] = useState(true)
  const [batchesError, setBatchesError] = useState('')
  const [selectedBatchIds, setSelectedBatchIds] = useState([])
  const [editingBatch, setEditingBatch] = useState(null)
  const [editBatchForm, setEditBatchForm] = useState({
    material_name: '',
    quantity_kg: '',
    note: '',
  })
  const [savingBatchEdit, setSavingBatchEdit] = useState(false)

  const refreshRawTotals = useCallback(async () => {
    console.info('[RawMaterial] calling GET /raw-material/totals')
    setLoadingTotals(true)
    setTotalsError('')
    try {
      const { data } = await api.get('/raw-material/totals')
      setRawTotals(Array.isArray(data) ? data : data?.data || [])
    } catch (error) {
      console.error('Failed to load raw material totals', error)
      setTotalsError(error?.response?.data?.error || 'Failed to load raw material totals')
    } finally {
      setLoadingTotals(false)
    }
  }, [])

  const refreshMaterialOptions = useCallback(async () => {
    console.info('[RawMaterial] calling GET /raw-material/options')
    setLoadingMaterialOptions(true)
    setMaterialOptionsError('')
    try {
      const { data } = await api.get('/raw-material/options')
      setMaterialOptions(Array.isArray(data) ? data : data?.data || [])
    } catch (error) {
      console.error('Failed to load raw material options', error)
      setMaterialOptionsError(error?.response?.data?.error || 'Failed to load raw material options')
    } finally {
      setLoadingMaterialOptions(false)
    }
  }, [])

  const refreshBatches = useCallback(async () => {
    console.info('[RawMaterial] calling GET /raw-material/batches')
    setLoadingBatches(true)
    setBatchesError('')
    try {
      const { data } = await api.get('/raw-material/batches')
      setBatches(Array.isArray(data) ? data : data?.data || [])
    } catch (error) {
      console.error('Failed to load raw material batches', error)
      setBatchesError(error?.response?.data?.error || 'Failed to load batches')
    } finally {
      setLoadingBatches(false)
    }
  }, [])

  const handleDeleteBatch = async (batchId) => {
    if (!window.confirm('Delete this raw material batch?')) return

    try {
      await deleteRawMaterialBatch(batchId)
      await Promise.allSettled([refreshRawTotals(), refreshBatches()])
      setSelectedBatchIds((previous) => previous.filter((id) => id !== batchId))
      toast.success('Batch deleted')
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Failed to delete batch')
    }
  }

  const handleBulkDeleteBatches = async () => {
    if (selectedBatchIds.length === 0) return
    if (!window.confirm(`Delete ${selectedBatchIds.length} selected batch entries?`)) return

    try {
      await bulkDeleteRawMaterialBatches(selectedBatchIds)
      setSelectedBatchIds([])
      await Promise.allSettled([refreshRawTotals(), refreshBatches()])
      toast.success('Selected batches deleted')
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Failed to delete selected batches')
    }
  }

  const openEditBatch = (batch) => {
    setEditingBatch(batch)
    setEditBatchForm({
      material_name: batch.material_name || '',
      quantity_kg: toNumber(batch.quantity_kg).toFixed(2),
      note: batch.note || '',
    })
  }

  const handleSaveBatchEdit = async () => {
    if (!editingBatch) return

    try {
      setSavingBatchEdit(true)
      await updateRawMaterialBatch(editingBatch.id, {
        material_name: editBatchForm.material_name,
        quantity_kg: toNumber(editBatchForm.quantity_kg),
        note: editBatchForm.note,
      })
      setEditingBatch(null)
      await Promise.allSettled([refreshRawTotals(), refreshBatches(), refreshMaterialOptions()])
      toast.success('Batch updated')
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Failed to update batch')
    } finally {
      setSavingBatchEdit(false)
    }
  }

  useEffect(() => {
    // Load immediately
    refreshRawTotals().catch(() => {})
    refreshMaterialOptions().catch(() => {})
    refreshBatches().catch(() => {})
    
    // Poll every 50 seconds
    const pollInterval = setInterval(() => {
      refreshRawTotals().catch(() => {})
      refreshMaterialOptions().catch(() => {})
      refreshBatches().catch(() => {})
    }, 50000)
    
    return () => clearInterval(pollInterval)
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
        note: addForm.note?.trim() || '',
      })

      await Promise.allSettled([refreshRawTotals(), refreshMaterialOptions(), refreshBatches()])
      toast.success('Raw material added')
      setAddForm((previous) => ({ ...previous, quantity: '', note: '' }))
    } catch (error) {
      console.error('Failed to add raw material', error)
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
      </div>

      <DataTable
        title="Raw Material Totals"
        columns={columns}
        data={tableData}
        emptyMessage={loadingTotals ? 'Loading raw material totals...' : 'No raw materials yet.'}
        rightAction={
          tableData.length > 0 ? (
            <button type="button" onClick={handleExportTotals} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all">
              <ExcelIcon /> Export Excel
            </button>
          ) : null
        }
      />

      <div className="pt-6 border-t border-border-default space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-xl font-semibold text-text-primary tracking-tight">Batch History</h3>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleBulkDeleteBatches}
              disabled={selectedBatchIds.length === 0}
              className="rounded-lg border border-red-500/30 px-4 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              Delete Selected ({selectedBatchIds.length})
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={batches.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
            >
              <ExcelIcon /> Export Excel
            </button>
          </div>
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
          onDelete={handleDeleteBatch}
          onEdit={openEditBatch}
          selectedIds={selectedBatchIds}
          onSelectedIdsChange={setSelectedBatchIds}
        />
      </div>

      <EditEntryModal
        open={Boolean(editingBatch)}
        title="Edit Raw Material Batch"
        values={editBatchForm}
        onChange={(name, value) => setEditBatchForm((previous) => ({ ...previous, [name]: value }))}
        onClose={() => {
          if (savingBatchEdit) return
          setEditingBatch(null)
        }}
        onSubmit={handleSaveBatchEdit}
        submitting={savingBatchEdit}
        fields={[
          {
            name: 'material_name',
            label: 'Material Name',
            type: 'select',
            required: true,
            options: [
              { value: '', label: loadingMaterialOptions ? 'Loading materials...' : 'Select material' },
              ...(materialOptions || []).map((option) => ({
                value: option.material_name,
                label: option.material_name,
              })),
            ],
          },
          {
            name: 'quantity_kg',
            label: 'Quantity (kg)',
            type: 'number',
            step: '0.01',
            min: '0.01',
            required: true,
          },
          {
            name: 'note',
            label: 'Note',
            type: 'textarea',
            placeholder: 'Optional note',
          },
        ]}
      />

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
    </div>
  )
}
