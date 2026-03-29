import { useCallback, useEffect, useMemo, useState } from 'react'
import { SectionBarChart } from '../components/Charts'
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

export default function Stocks({ floorStock = [], refreshFloorStock }) {
  const toast = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [rawTotals, setRawTotals] = useState([])
  const [rawTotalsLoading, setRawTotalsLoading] = useState(true)
  const [rawTotalsError, setRawTotalsError] = useState('')

  const [issueForm, setIssueForm] = usePersistentState('vp_floor_issue_form', {
    material_name: '',
    quantity: '',
    quantityUnit: 'kg',
  })

  useEffect(() => {
    if (typeof issueForm?.material_name === 'string' && typeof issueForm?.quantityUnit === 'string') return

    setIssueForm((previous) => ({
      material_name: typeof previous?.material_name === 'string' ? previous.material_name : '',
      quantity: typeof previous?.quantity === 'string' ? previous.quantity : '',
      quantityUnit: typeof previous?.quantityUnit === 'string' ? previous.quantityUnit : 'kg',
    }))
  }, [issueForm, setIssueForm])

  const refreshRawTotals = useCallback(async () => {
    setRawTotalsLoading(true)
    setRawTotalsError('')
    try {
      const { data } = await api.get('/raw-material/totals')
      setRawTotals(Array.isArray(data) ? data : data?.data || [])
    } catch (error) {
      console.error('Failed to load raw material totals for Stocks page', error)
      setRawTotalsError(error?.response?.data?.error || 'Failed to load raw material totals')
    } finally {
      setRawTotalsLoading(false)
    }
  }, [])

  useEffect(() => {
    Promise.allSettled([refreshFloorStock?.(), refreshRawTotals()]).catch(() => {})
  }, [refreshFloorStock, refreshRawTotals])

  const totalAvailableKg = useMemo(
    () => (Array.isArray(floorStock) ? floorStock : []).reduce((sum, row) => sum + toNumber(row.total_quantity_kg), 0),
    [floorStock],
  )

  const stockChartData = useMemo(
    () =>
      (Array.isArray(floorStock) ? floorStock : []).map((row) => ({
        name: row.material_name || `Material ${row.material_type_id}`,
        value: toNumber(row.total_quantity_kg) / 1000,
      })),
    [floorStock],
  )

  const rawMaterialOptions = useMemo(
    () =>
      (Array.isArray(rawTotals) ? rawTotals : [])
        .filter((row) => toNumber(row.total_quantity_kg) > 0)
        .sort((a, b) => String(a.material_name || '').localeCompare(String(b.material_name || ''))),
    [rawTotals],
  )

  const handleChange = (event) => {
    const { name, value } = event.target
    setIssueForm((previous) => ({ ...previous, [name]: value }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    if (!issueForm.material_name?.trim()) {
      toast.error('Please select a raw material')
      return
    }

    const qty = toNumber(issueForm.quantity)
    if (qty <= 0) {
      toast.error('Quantity must be greater than zero')
      return
    }

    const qtyInKg = issueForm.quantityUnit === 'tons' ? qty * 1000 : qty

    setSubmitting(true)
    try {
      await api.post('/floor/issue-from-raw', {
        material_name: issueForm.material_name.trim(),
        quantity_kg: qtyInKg,
      })

      await Promise.allSettled([refreshFloorStock?.(), refreshRawTotals()])
      toast.success('Issued to floor')

      setIssueForm((previous) => ({
        ...previous,
        quantity: '',
      }))
    } catch (error) {
      console.error('Failed to issue stock from raw to floor', error)
      toast.error(error?.response?.data?.error || 'Failed to issue stock to floor')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold'

  const selectClass =
    'bg-bg-input text-text-primary border border-gray-700 rounded-lg px-3 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold w-24 shrink-0 appearance-none cursor-pointer text-center'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Floor Stock</h2>
      </div>

      {rawTotalsError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {rawTotalsError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden group transition-all duration-300 hover:border-accent-gold/30">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
          <div className="space-y-3">
            <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70">Material Types</p>
            <p className="text-3xl font-semibold text-text-primary tracking-tight">{(floorStock || []).length}</p>
            <p className="text-xs text-text-secondary">Active materials on floor</p>
          </div>
        </div>
        <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden group transition-all duration-300 hover:border-accent-gold/30">
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
          <div className="space-y-3">
            <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70">Total Available</p>
            <p className="text-3xl font-semibold text-text-primary tracking-tight">{formatKg(totalAvailableKg)}</p>
            <p className="text-xs text-text-secondary">Pooled floor balance</p>
          </div>
        </div>
      </div>

      <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-5">
        <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">
          Issue From Raw To Floor
        </h3>
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Raw Material</label>
            <select
              name="material_name"
              value={issueForm.material_name}
              onChange={handleChange}
              className={inputClass}
              required
              disabled={submitting || rawTotalsLoading || rawMaterialOptions.length === 0}
            >
              <option value="">{rawTotalsLoading ? 'Loading raw materials...' : 'Select raw material'}</option>
              {rawMaterialOptions.map((row) => (
                <option key={row.material_name} value={row.material_name}>
                  {`${row.material_name} (${toNumber(row.total_quantity_kg).toFixed(2)} kg available)`}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Quantity</label>
            <div className="flex gap-2">
              <InputWithCamera
                type="text"
                inputMode="decimal"
                name="quantity"
                value={issueForm.quantity}
                onChange={handleChange}
                placeholder="0.00"
                className="flex-1"
                required
                disabled={submitting}
              />
              <select
                name="quantityUnit"
                value={issueForm.quantityUnit}
                onChange={handleChange}
                className={selectClass}
                disabled={submitting}
              >
                <option value="kg">kg</option>
                <option value="tons">tons</option>
              </select>
            </div>
          </div>

          <div className="flex items-end md:col-span-2">
            <button
              type="submit"
              disabled={submitting || rawTotalsLoading || rawMaterialOptions.length === 0}
              className="w-full bg-accent-gold text-black font-semibold py-2.5 rounded-lg text-sm transition-all duration-200 hover:bg-accent-gold-hover active:scale-[0.98] disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Issue To Floor'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">Current Floor Stock</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default">
                <th className="text-left px-6 py-4 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">
                  Material Name
                </th>
                <th className="text-right px-6 py-4 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60">
                  Available Quantity (kg)
                </th>
              </tr>
            </thead>
            <tbody>
              {(floorStock || []).length === 0 ? (
                <tr>
                  <td colSpan={2} className="text-center py-12 text-text-secondary/50 text-sm">
                    No floor stock yet.
                  </td>
                </tr>
              ) : (
                (floorStock || []).map((row, idx) => (
                  <tr
                    key={row.material_type_id ?? idx}
                    className={`border-b border-border-subtle transition-colors duration-150 hover:bg-white/[0.02] ${
                      idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.01]'
                    }`}
                  >
                    <td className="px-6 py-3.5 text-text-primary/90 font-normal">
                      {row.material_name || `Material ${row.material_type_id}`}
                    </td>
                    <td className="px-6 py-3.5 text-right text-accent-gold font-semibold">
                      {toNumber(row.total_quantity_kg).toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {stockChartData.length > 0 && (
        <SectionBarChart data={stockChartData} title="Floor Stock Breakdown (tons)" color="#60a5fa" />
      )}
    </div>
  )
}
