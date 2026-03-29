import { useCallback, useEffect, useMemo, useState } from 'react'
import DataTable from '../components/DataTable'
import InputWithCamera from '../components/InputWithCamera'
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
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Material Name</label>
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
        columns={columns}
        data={tableData}
        emptyMessage={loadingTotals ? 'Loading raw material totals...' : 'No raw materials yet.'}
      />

      <div className="pt-6 border-t border-border-default space-y-4">
        <h3 className="text-xl font-semibold text-text-primary tracking-tight">Batch History</h3>
        {batchesError && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {batchesError}
          </div>
        )}
        <DataTable
          columns={batchColumns}
          data={batches}
          emptyMessage={loadingBatches ? 'Loading batches...' : 'No raw material batches found.'}
        />
      </div>
    </div>
  )
}
