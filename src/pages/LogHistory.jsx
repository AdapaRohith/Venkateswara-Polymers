import { useEffect, useMemo, useState } from 'react'
import { SectionBarChart } from '../components/Charts'
import EditEntryModal from '../components/EditEntryModal'
import { useToast } from '../components/Toast'
import api from '../utils/api'
import {
  bulkDeleteFloorTransactions,
  deleteFloorTransaction,
  updateFloorTransaction,
} from '../utils/logActions'

function toNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
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

export default function LogHistory() {
  const toast = useToast()
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [exporting, setExporting] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [editingRow, setEditingRow] = useState(null)
  const [editForm, setEditForm] = useState({
    material_name: '',
    quantity_kg: '',
    direction: 'OUT',
    movement_type: 'FLOOR_TRANSFER',
    note: '',
  })
  const [savingEdit, setSavingEdit] = useState(false)

  const handleExport = async () => {
    try {
      setExporting(true)
      await fetch('https://n8n.avlokai.com/webhook-test/77d8abd5-246a-4797-8370-1ebfdb10ffec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, logs: filtered }),
      })
      toast.success('Logs exported successfully!')
    } catch (err) {
      console.error('Export failed', err)
      toast.error('Failed to export logs.')
    } finally {
      setExporting(false)
    }
  }

  const fetchRows = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/floor/transactions')
      const items = Array.isArray(data) ? data : data?.data || []
      setRows(items)
    } catch (err) {
      console.error('Failed to load floor transactions', err)
      setError(err?.response?.data?.error || err?.message || 'Failed to load floor transactions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRows().catch(() => {})
  }, [])

  const filtered = useMemo(() => {
    if (!date) return rows
    return (rows || []).filter((row) => String(row.created_at || row.createdAt || '').slice(0, 10) === date)
  }, [date, rows])

  const selectableRows = useMemo(
    () => filtered.filter((row) => String(row.movement_type || '').toUpperCase() !== 'CONSUMPTION'),
    [filtered],
  )
  const allSelected = selectableRows.length > 0 && selectableRows.every((row) => selectedIds.includes(row.id))

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : selectableRows.map((row) => row.id))
  }

  const toggleOne = (rowId) => {
    setSelectedIds((previous) =>
      previous.includes(rowId) ? previous.filter((id) => id !== rowId) : [...previous, rowId],
    )
  }

  const handleDeleteOne = async (rowId) => {
    if (!window.confirm('Delete this floor transaction?')) return

    try {
      await deleteFloorTransaction(rowId)
      setSelectedIds((previous) => previous.filter((id) => id !== rowId))
      await fetchRows()
      toast.success('Transaction deleted')
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to delete transaction')
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) return
    if (!window.confirm(`Delete ${selectedIds.length} selected floor transactions?`)) return

    try {
      await bulkDeleteFloorTransactions(selectedIds)
      setSelectedIds([])
      await fetchRows()
      toast.success('Selected transactions deleted')
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to delete selected transactions')
    }
  }

  const openEditModal = (row) => {
    setEditingRow(row)
    setEditForm({
      material_name: row.material_name || '',
      quantity_kg: toNumber(row.quantity_kg).toFixed(2),
      direction: row.direction || 'OUT',
      movement_type: row.movement_type || 'FLOOR_TRANSFER',
      note: row.note || '',
    })
  }

  const handleSaveEdit = async () => {
    if (!editingRow) return

    try {
      setSavingEdit(true)
      await updateFloorTransaction(editingRow.id, {
        material_name: editForm.material_name,
        quantity_kg: toNumber(editForm.quantity_kg),
        direction: editForm.direction,
        movement_type: editForm.movement_type,
        note: editForm.note,
      })
      setEditingRow(null)
      await fetchRows()
      toast.success('Transaction updated')
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update transaction')
    } finally {
      setSavingEdit(false)
    }
  }

  const dailyMovementChart = useMemo(() => {
    const daily = {}
    ;(Array.isArray(rows) ? rows : []).forEach((row) => {
      const d = String(row.created_at || row.createdAt || '').slice(0, 10)
      if (!d) return
      daily[d] = (daily[d] || 0) + toNumber(row.quantity_kg)
    })

    return Object.entries(daily)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({ name: d, value: toNumber(v) / 1000 }))
  }, [rows])

  const inputClass =
    'bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Log History</h2>
        </div>

        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Filter by Date</label>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
          </div>

          {date && (
            <button
              type="button"
              onClick={() => setDate('')}
              className="rounded-lg border border-border-default px-4 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {dailyMovementChart.length > 0 && (
        <SectionBarChart data={dailyMovementChart} title="Daily Floor Movement (tons)" color="#a78bfa" />
      )}

      <div className="rounded-[28px] border border-border-default bg-bg-card shadow-lg shadow-black/30">
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="rounded px-2.5 py-1 text-xs font-medium bg-accent-gold/15 text-accent-gold">
              Floor Transactions
            </span>
            <h3 className="text-sm font-medium uppercase tracking-widest text-text-secondary/70">
              - {loading ? 'Loading…' : `${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}`}
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleDeleteSelected}
              disabled={selectedIds.length === 0}
              className="rounded-lg border border-red-500/30 px-4 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              Delete Selected ({selectedIds.length})
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || filtered.length === 0}
              className="rounded-lg bg-accent-gold px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-accent-gold/90 disabled:opacity-50"
            >
              {exporting ? 'Exporting...' : 'Export Logs'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default">
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 accent-accent-gold"
                    aria-label="Select all floor transactions"
                  />
                </th>
                <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">
                  Material
                </th>
                <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">
                  Type
                </th>
                <th className="px-6 py-3 text-right text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">
                  Qty (kg)
                </th>
                <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">
                  Direction
                </th>
                <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">
                  Time
                </th>
                <th className="px-6 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-text-secondary/60">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-text-secondary/50 text-sm">
                    Loading floor transactions…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-text-secondary/50 text-sm">
                    No transactions found.
                  </td>
                </tr>
              ) : (
                filtered.map((row, index) => (
                  <tr
                    key={row.id ?? index}
                    className={`border-b border-border-subtle transition-colors hover:bg-white/[0.02] ${
                      index % 2 === 0 ? '' : 'bg-white/[0.01]'
                    }`}
                  >
                    <td className="px-4 py-3">
                      {String(row.movement_type || '').toUpperCase() !== 'CONSUMPTION' ? (
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(row.id)}
                          onChange={() => toggleOne(row.id)}
                          className="h-4 w-4 accent-accent-gold"
                          aria-label={`Select transaction ${row.id}`}
                        />
                      ) : (
                        <span className="text-[10px] text-text-secondary/40">Locked</span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-text-primary/90">{row.material_name || `Material ${row.material_type_id}`}</td>
                    <td className="px-6 py-3 text-text-primary/90">{row.movement_type || row.transaction_type || '—'}</td>
                    <td className="px-6 py-3 text-right font-medium text-accent-gold">{toNumber(row.quantity_kg).toFixed(2)}</td>
                    <td className="px-6 py-3 text-text-primary/90">{row.direction || '—'}</td>
                    <td className="px-6 py-3 text-text-secondary">{formatDateTime(row.created_at || row.createdAt)}</td>
                    <td className="px-6 py-3">
                      {String(row.movement_type || '').toUpperCase() === 'CONSUMPTION' ? (
                        <span className="text-[10px] text-text-secondary/40">Edit in Production</span>
                      ) : (
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
                            className="text-xs font-semibold text-blue-300 transition-colors hover:text-blue-200"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteOne(row.id)}
                            className="text-xs font-semibold text-red-300 transition-colors hover:text-red-200"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <EditEntryModal
        open={Boolean(editingRow)}
        title="Edit Floor Transaction"
        values={editForm}
        onChange={(name, value) => setEditForm((previous) => ({ ...previous, [name]: value }))}
        onClose={() => {
          if (savingEdit) return
          setEditingRow(null)
        }}
        onSubmit={handleSaveEdit}
        submitting={savingEdit}
        fields={[
          { name: 'material_name', label: 'Material Name', type: 'text', required: true },
          { name: 'quantity_kg', label: 'Quantity (kg)', type: 'number', step: '0.01', min: '0.01', required: true },
          {
            name: 'direction',
            label: 'Direction',
            type: 'select',
            required: true,
            options: [
              { value: 'IN', label: 'IN' },
              { value: 'OUT', label: 'OUT' },
            ],
          },
          {
            name: 'movement_type',
            label: 'Movement Type',
            type: 'select',
            required: true,
            options: [
              { value: 'INWARD', label: 'INWARD' },
              { value: 'FLOOR_TRANSFER', label: 'FLOOR_TRANSFER' },
              { value: 'ADJUSTMENT', label: 'ADJUSTMENT' },
            ],
          },
          { name: 'note', label: 'Note', type: 'textarea', placeholder: 'Optional note' },
        ]}
      />
    </div>
  )
}
