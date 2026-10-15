import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import DataTable from '../components/DataTable'
import Pictogram from '../components/Pictogram'
import { useToast } from '../components/Toast'
import api from '../utils/api'
import { formatDateTime as formatDateTimeIST, todayIST } from '../utils/datetime'
import { exportSingleSheet } from '../utils/exportToExcel'
import { formatWeight } from '../utils/units'
import { LOCATIONS, formatBusinessDate } from '../utils/ipms'
import { ShiftBadge } from '../components/ipms/Kit'
import {
  activityActionLabel,
  activityRowActions,
  serializeActivityFilters,
} from '../utils/stockLedger'


const SOURCE_LABELS = {
  RAW_INPUT: 'Raw Input',
  FLOOR_TRANSFER: 'Floor Transfer',
  PRODUCTION: 'Production',
  WASTAGE: 'Wastage',
  MANUAL_ADJUSTMENT: 'Adjustment',
  STOCK_TRANSFER: 'Stock Transfer',
  STOCK_RETURN: 'Return',
}

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const kg = (value) => formatWeight(value)

function impactText(opening, delta, closing) {
  const start = numberOrNull(opening)
  const change = numberOrNull(delta)
  const end = numberOrNull(closing)
  if (start === null && change === null && end === null) return 'No stock change'
  if (!change) return `${kg(end ?? start)} (no change)`
  return `${kg(start)} → ${formatWeight(change, { signed: true })} → ${kg(end)}`
}

function ActivityBadge({ row }) {
  const label = activityActionLabel(row.source_domain, row.action)
  const tone = row.action === 'REVERSE'
    ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
    : row.action === 'LEGACY'
      ? 'border-slate-500/30 bg-slate-500/10 text-slate-300'
      : row.source_domain === 'STOCK_RETURN'
        ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
        : row.source_domain === 'PRODUCTION'
        ? 'border-orange-500/30 bg-orange-500/10 text-orange-300'
        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>
}

export default function StockActivity() {
  const navigate = useNavigate()
  const toast = useToast()
  const [items, setItems] = useState([])
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState({ limit: 100, offset: 0, total: 0 })
  const [filters, setFilters] = useState({
    dateFrom: '', dateTo: '', materialId: '', sourceDomain: '', action: '', operatorId: '',
    shift: '', location: '', includeReturns: '',
  })
  const [appliedFilters, setAppliedFilters] = useState(filters)

  const loadActivity = useCallback(async (nextOffset = 0) => {
    setLoading(true)
    try {
      const query = serializeActivityFilters({
        ...appliedFilters,
        limit: pagination.limit,
        offset: nextOffset,
      })
      const { data } = await api.get(`/stock/activity?${query}`)
      setItems(Array.isArray(data?.items) ? data.items : [])
      setPagination((current) => ({
        ...current,
        ...(data?.pagination || {}),
        offset: nextOffset,
      }))
    } catch (error) {
      toast.error(error?.response?.data?.detail || 'Could not load Stock Activity')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [appliedFilters, pagination.limit, toast])

  useEffect(() => {
    loadActivity(0)
  }, [loadActivity])

  useEffect(() => {
    api.get('/raw-material/options')
      .then(({ data }) => setMaterials(Array.isArray(data) ? data : []))
      .catch(() => setMaterials([]))
  }, [])

  const rows = useMemo(() => items.map((row) => ({
    ...row,
    happened_at: row.occurred_at,
    source_label: SOURCE_LABELS[row.source_domain] || row.source_domain,
    warehouse_impact: impactText(row.warehouse_opening_kg, row.warehouse_delta_kg, row.warehouse_closing_kg),
    floor_impact: impactText(row.floor_opening_kg, row.floor_delta_kg, row.floor_closing_kg),
    first_floor_impact: impactText(row.first_floor_opening_kg, row.first_floor_delta_kg, row.first_floor_closing_kg),
    machine_impact: row.machine_id
      ? `${row.machine_name || `Machine ${row.machine_id}`}: ${impactText(row.machine_opening_kg, row.machine_delta_kg, row.machine_closing_kg)}`
      : 'No machine change',
    route: [row.from_location, row.to_location].filter(Boolean).map((l) => LOCATIONS[l]?.label || l).join(' → '),
    plant_impact: impactText(row.plant_opening_kg, row.plant_delta_kg, row.plant_closing_kg),
  })), [items])

  const viewEntry = (row) => {
    const [action] = activityRowActions({ entryPath: row.entry_path, sourceId: row.source_id })
    if (!action) return
    navigate(action.path, {
      state: {
        flashDate: String(row.occurred_at || '').slice(0, 10),
        entryId: action.sourceId,
      },
    })
  }

  const columns = [
    { key: 'happened_at', label: 'When', icon: 'clock', render: (value) => formatDateTimeIST(value, '—') },
    {
      key: 'business_date', label: 'Business Day · Shift', icon: 'date',
      render: (value, row) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {formatBusinessDate(value, { weekday: false })} <ShiftBadge shift={row.shift} />
        </span>
      ),
    },
    { key: 'action', label: 'What Happened', icon: 'stock', render: (_value, row) => <ActivityBadge row={row} /> },
    { key: 'source_label', label: 'Source', icon: 'note', render: (value, row) => (
      <span>{value}{row.route && <span className="block text-xs text-text-secondary">{row.route}</span>}</span>
    ) },
    { key: 'material_name', label: 'Material', icon: 'material', render: (value) => value || 'Not material-specific' },
    { key: 'quantity_kg', label: 'Quantity', icon: 'weight', render: (value) => kg(value) },
    { key: 'warehouse_impact', label: 'Warehouse: Opening → Change → Closing', icon: 'stock' },
    { key: 'floor_impact', label: 'Ground Floor: Opening → Change → Closing', icon: 'production' },
    { key: 'first_floor_impact', label: 'First Floor: Opening → Change → Closing', icon: 'production' },
    { key: 'machine_impact', label: 'Machine: Opening → Change → Closing', icon: 'production' },
    { key: 'plant_impact', label: 'Plant Total: Opening → Change → Closing', icon: 'dashboard' },
    { key: 'created_by_name', label: 'Operator', icon: 'person', render: (value) => value || 'System / legacy' },
    { key: 'reverses_activity_id', label: 'Linked Reversal', icon: 'history', render: (value) => value ? `Reverses activity #${value}` : '—' },
    {
      key: 'view_entry', label: 'Entry', icon: 'view',
      render: (_value, row) => activityRowActions({ entryPath: row.entry_path, sourceId: row.source_id }).length > 0 ? (
        <button type="button" onClick={() => viewEntry(row)} className="rounded-lg border border-border-default px-2.5 py-1 text-xs font-semibold text-accent-gold hover:bg-accent-gold/10">
          View Entry
        </button>
      ) : <span className="text-xs text-text-secondary/60">Read-only record</span>,
    },
  ]

  const exportRows = () => {
    exportSingleSheet({
      filename: `Stock_Activity_${todayIST()}`,
      rows: rows.map((row) => ({
        when: formatDateTimeIST(row.occurred_at, ''),
        action: activityActionLabel(row.source_domain, row.action),
        source: row.source_label,
        material: row.material_name || '',
        quantity: Number(row.quantity_kg || 0).toFixed(2),
        warehouse: row.warehouse_impact,
        floor: row.floor_impact,
        first_floor: row.first_floor_impact,
        machine: row.machine_impact,
        business_day: row.business_date,
        shift: row.shift || '',
        plant: row.plant_impact,
        operator: row.created_by_name || 'System / legacy',
        reason: row.reason || '',
      })),
      columns: [
        { key: 'when', label: 'When' }, { key: 'action', label: 'What Happened' },
        { key: 'source', label: 'Source' }, { key: 'material', label: 'Material' },
        { key: 'quantity', label: 'Quantity (kg)' }, { key: 'warehouse', label: 'Warehouse Impact' },
        { key: 'business_day', label: 'Business Day' }, { key: 'shift', label: 'Shift' },
        { key: 'floor', label: 'Ground Floor Impact' }, { key: 'first_floor', label: 'First Floor Impact' },
        { key: 'machine', label: 'Machine Impact' }, { key: 'plant', label: 'Plant Total Impact' },
        { key: 'operator', label: 'Operator' }, { key: 'reason', label: 'Reason' },
      ],
    })
  }

  const inputClass = 'rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent-gold'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-text-primary">
            <Pictogram name="history" size={20} className="text-accent-gold" />
            Stock Activity
          </h1>
          <p className="mt-1 text-sm text-text-secondary">Read-only proof of every stock change. Edit or delete entries only on their source page.</p>
        </div>
        <button type="button" onClick={exportRows} disabled={rows.length === 0} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-400 disabled:opacity-40">
          Export visible activity
        </button>
      </div>

      <form
        onSubmit={(event) => { event.preventDefault(); setPagination((current) => ({ ...current, offset: 0 })); setAppliedFilters(filters) }}
        className="grid gap-3 rounded-xl border border-border-default bg-bg-card p-4 md:grid-cols-3 xl:grid-cols-6"
      >
        <input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} className={inputClass} aria-label="From date" />
        <input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} className={inputClass} aria-label="To date" />
        <select value={filters.materialId} onChange={(event) => setFilters((current) => ({ ...current, materialId: event.target.value }))} className={inputClass} aria-label="Material">
          <option value="">All materials</option>
          {materials.map((material) => <option key={material.id ?? material.material_name} value={material.id}>{material.material_name}</option>)}
        </select>
        <select value={filters.sourceDomain} onChange={(event) => setFilters((current) => ({ ...current, sourceDomain: event.target.value }))} className={inputClass} aria-label="Source">
          <option value="">All sources</option>
          {Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={filters.action} onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value }))} className={inputClass} aria-label="Action">
          <option value="">All actions</option>
          <option value="CREATE">Created</option><option value="UPDATE">Corrected</option><option value="REVERSE">Reversed</option><option value="LEGACY">Legacy</option>
        </select>
        <select value={filters.shift} onChange={(event) => setFilters((current) => ({ ...current, shift: event.target.value }))} className={inputClass} aria-label="Shift">
          <option value="">Both shifts</option><option value="AM">AM · Morning</option><option value="PM">PM · Night</option>
        </select>
        <select value={filters.location} onChange={(event) => setFilters((current) => ({ ...current, location: event.target.value }))} className={inputClass} aria-label="Location">
          <option value="">All locations</option>
          {['WAREHOUSE', 'GROUND_FLOOR', 'FIRST_FLOOR', 'MACHINE'].map((loc) => <option key={loc} value={loc}>{LOCATIONS[loc].label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={filters.includeReturns === '1'} onChange={(event) => setFilters((current) => ({ ...current, includeReturns: event.target.checked ? '1' : '' }))} />
          Include returned stock
        </label>
        <div className="flex gap-2">
          <input type="number" min="1" value={filters.operatorId} onChange={(event) => setFilters((current) => ({ ...current, operatorId: event.target.value }))} placeholder="Operator ID" className={`${inputClass} min-w-0 flex-1`} />
          <button type="submit" className="rounded-lg bg-accent-gold px-4 py-2 text-sm font-semibold text-black">Apply</button>
        </div>
      </form>

      <DataTable
        title="Read-only Activity"
        titleIcon="history"
        columns={columns}
        data={rows}
        groupByDate="occurred_at"
        emptyMessage={loading ? 'Loading Stock Activity...' : 'No activity matches these filters.'}
      />

      <div className="flex items-center justify-between rounded-lg border border-border-default bg-bg-card px-3 py-2 text-sm text-text-secondary">
        <span>{pagination.total} records · showing {rows.length}</span>
        <div className="flex gap-2">
          <button type="button" disabled={pagination.offset <= 0 || loading} onClick={() => loadActivity(Math.max(0, pagination.offset - pagination.limit))} className="rounded border border-border-default px-3 py-1 disabled:opacity-40">Previous</button>
          <button type="button" disabled={pagination.offset + pagination.limit >= pagination.total || loading} onClick={() => loadActivity(pagination.offset + pagination.limit)} className="rounded border border-border-default px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  )
}
