import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSSE from '../hooks/useSSE'
import EditEntryModal from '../components/EditEntryModal'
import { useToast } from '../components/Toast'
import api from '../utils/api'
import { exportMultiSheet, exportSingleSheet } from '../utils/exportToExcel'
import {
  bulkDeleteProductionLogs,
  deleteProductionLog,
  updateProductionLog,
} from '../utils/logActions'

const ExcelIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
)

function formatDate(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateTime(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

export default function MachineReports() {
  const toast = useToast()
  const [report, setReport] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({
    date_from: new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0],
    date_to: new Date().toISOString().split('T')[0],
    machine_id: '',
  })
  const [applied, setApplied] = useState(null)
  const [detailLogs, setDetailLogs] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [materialOptions, setMaterialOptions] = useState([])
  const [machineOptions, setMachineOptions] = useState([])
  const [selectedLogIds, setSelectedLogIds] = useState([])
  const [selectedSizeIds, setSelectedSizeIds] = useState([])
  const [sizeFilter, setSizeFilter] = useState('')
  const [machineFilter, setMachineFilter] = useState('')
  const [sizeSearch, setSizeSearch] = useState('')
  const [sizeMachineDropdown, setSizeMachineDropdown] = useState('')
  const [editingLog, setEditingLog] = useState(null)
  const [editForm, setEditForm] = useState({
    machine_id: '',
    material_id: '',
    size: '',
    worker_name: '',
    gross_weight: '',
    tare_weight: '',
  })
  const [savingEdit, setSavingEdit] = useState(false)

  // Ref to store the hash of the last fetched data so we only re-render on actual changes
  const lastDataHash = useRef('')

  const buildParams = useCallback(() => {
    const params = new URLSearchParams()
    if (filters.date_from) params.append('date_from', filters.date_from)
    if (filters.date_to) params.append('date_to', filters.date_to)
    if (filters.machine_id) params.append('machine_id', filters.machine_id)
    return params.toString()
  }, [filters])

  // Full load with loading spinners – used for initial load and manual "Generate Report"
  const loadReport = async () => {
    setLoading(true)
    setDetailLoading(true)
    setError('')

    try {
      const qs = buildParams()
      const [reportRes, logsRes, floorStockRes, machinesRes] = await Promise.allSettled([
        api.get(`/reports/machines?${qs}`),
        api.get(`/production/logs?${qs}`),
        api.get('/floor/stock'),
        api.get('/machines'),
      ])

      const newReport = reportRes.status === 'fulfilled' ? (Array.isArray(reportRes.value.data) ? reportRes.value.data : []) : []
      const newLogs = logsRes.status === 'fulfilled' ? (Array.isArray(logsRes.value.data) ? logsRes.value.data : []) : []
      const newMaterials = floorStockRes.status === 'fulfilled' ? (Array.isArray(floorStockRes.value.data) ? floorStockRes.value.data : []) : []
      const newMachines = machinesRes.status === 'fulfilled' ? (Array.isArray(machinesRes.value.data) ? machinesRes.value.data : []) : []

      // Store hash for future poll comparisons
      lastDataHash.current = JSON.stringify({ r: newReport, l: newLogs })

      setReport(newReport)
      setDetailLogs(newLogs)
      setMaterialOptions(newMaterials)
      setMachineOptions(newMachines)
      setApplied({ ...filters })
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load report')
    } finally {
      setLoading(false)
      setDetailLoading(false)
    }
  }

  // Silent background poll – no loading spinners, only updates state when data has changed
  const pollForUpdates = useCallback(async () => {
    try {
      const qs = buildParams()
      const [reportRes, logsRes, floorStockRes, machinesRes] = await Promise.allSettled([
        api.get(`/reports/machines?${qs}`),
        api.get(`/production/logs?${qs}`),
        api.get('/floor/stock'),
        api.get('/machines'),
      ])

      const newReport = reportRes.status === 'fulfilled' ? (Array.isArray(reportRes.value.data) ? reportRes.value.data : []) : undefined
      const newLogs = logsRes.status === 'fulfilled' ? (Array.isArray(logsRes.value.data) ? logsRes.value.data : []) : undefined

      // Only update if the core data (report + logs) has actually changed
      const newHash = JSON.stringify({ r: newReport, l: newLogs })
      if (newHash === lastDataHash.current) return // no change — skip re-render

      lastDataHash.current = newHash

      if (newReport !== undefined) setReport(newReport)
      if (newLogs !== undefined) setDetailLogs(newLogs)

      const newMaterials = floorStockRes.status === 'fulfilled' ? (Array.isArray(floorStockRes.value.data) ? floorStockRes.value.data : []) : undefined
      const newMachines = machinesRes.status === 'fulfilled' ? (Array.isArray(machinesRes.value.data) ? machinesRes.value.data : []) : undefined
      if (newMaterials !== undefined) setMaterialOptions(newMaterials)
      if (newMachines !== undefined) setMachineOptions(newMachines)
    } catch {
      // Silent fail on background poll — don't disturb the user
    }
  }, [buildParams])

  useEffect(() => {
    loadReport()
  }, []) // eslint-disable-line

  useSSE(['production'], pollForUpdates)

  const totalEntries = report.reduce((sum, row) => sum + toNumber(row.total_entries), 0)
  const totalNet = report.reduce((sum, row) => sum + toNumber(row.total_net_weight_kg), 0)
  const totalGross = report.reduce((sum, row) => sum + toNumber(row.total_gross_weight_kg), 0)
  const maxNet = Math.max(...report.map((row) => toNumber(row.total_net_weight_kg)), 0)
  // ── Filter options extracted from data ──
  const availableSizes = useMemo(() => [...new Set(detailLogs.map((e) => e.size || '(No Size)'))].sort(), [detailLogs])
  const availableMachines = useMemo(() => {
    const map = new Map()
    for (const e of detailLogs) {
      const id = e.machine_id
      if (!map.has(id)) map.set(id, e.machine_name || `Machine ${id}`)
    }
    return [...map.entries()].map(([id, name]) => ({ id: String(id), name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [detailLogs])

  // ── Filtered detail logs ──
  const filteredLogs = useMemo(() => {
    let result = detailLogs
    if (sizeFilter) result = result.filter((e) => (e.size || '(No Size)') === sizeFilter)
    if (machineFilter) result = result.filter((e) => String(e.machine_id) === machineFilter)
    return result
  }, [detailLogs, sizeFilter, machineFilter])

  const allSelected = filteredLogs.length > 0 && filteredLogs.every((row) => selectedLogIds.includes(row.id))

  // ── Size-based totals ──
  const sizeTotals = useMemo(() => {
    const sizeMap = {}
    for (const entry of filteredLogs) {
      const sizeKey = entry.size || '(No Size)'
      if (!sizeMap[sizeKey]) sizeMap[sizeKey] = { size: sizeKey, entries: 0, gross: 0, tare: 0, net: 0, machineSet: new Set() }
      sizeMap[sizeKey].entries += 1
      sizeMap[sizeKey].gross += toNumber(entry.gross_weight)
      sizeMap[sizeKey].tare += toNumber(entry.tare_weight)
      sizeMap[sizeKey].net += toNumber(entry.net_weight, Math.max(toNumber(entry.gross_weight) - toNumber(entry.tare_weight), 0))
      const machineName = entry.machine_name || `Machine ${entry.machine_id}`
      if (machineName) sizeMap[sizeKey].machineSet.add(machineName)
    }
    return Object.values(sizeMap)
      .map((s) => ({ ...s, machines: [...s.machineSet].sort().join(', ') }))
      .sort((a, b) => b.net - a.net)
  }, [filteredLogs])

  // ── Unique machines across all size totals (for the dropdown) ──
  const sizeMachineOptions = useMemo(() => {
    const machSet = new Set()
    for (const s of sizeTotals) {
      for (const m of s.machineSet) machSet.add(m)
    }
    return [...machSet].sort()
  }, [sizeTotals])

  // ── Filtered size totals (search input + machine dropdown) ──
  const filteredSizeTotals = useMemo(() => {
    let result = sizeTotals
    if (sizeSearch) {
      const q = sizeSearch.toLowerCase()
      result = result.filter((s) => s.size.toLowerCase().includes(q))
    }
    if (sizeMachineDropdown) {
      result = result.filter((s) => s.machineSet.has(sizeMachineDropdown))
    }
    return result
  }, [sizeTotals, sizeSearch, sizeMachineDropdown])

  const allSizesSelected = filteredSizeTotals.length > 0 && filteredSizeTotals.every((s) => selectedSizeIds.includes(s.size))

  // ── Export handlers ──
  const handleExportMachineBreakdown = () => {
    const rows = report.map((row) => ({
      machine: row.machine_name || `Machine ${row.machine_id}`,
      entries: toNumber(row.total_entries),
      net_kg: toNumber(row.total_net_weight_kg).toFixed(3),
      gross_kg: toNumber(row.total_gross_weight_kg).toFixed(3),
      tare_kg: toNumber(row.total_tare_weight_kg).toFixed(3),
    }))
    exportSingleSheet({
      filename: `Machine_Breakdown_${new Date().toISOString().slice(0, 10)}`,
      rows,
      columns: [
        { key: 'machine', label: 'Machine' },
        { key: 'entries', label: 'Entries' },
        { key: 'net_kg', label: 'Net Output (kg)' },
        { key: 'gross_kg', label: 'Gross (kg)' },
        { key: 'tare_kg', label: 'Tare (kg)' },
      ],
      totalRow: { machine: 'TOTAL', entries: totalEntries, net_kg: totalNet.toFixed(3), gross_kg: totalGross.toFixed(3), tare_kg: '' },
    })
  }

  const handleExportSizeTotals = (onlySelected = false) => {
    const selectedSizes = onlySelected ? sizeTotals.filter((s) => selectedSizeIds.includes(s.size)) : sizeTotals
    if (selectedSizes.length === 0) return

    // Collect the size keys we're exporting
    const sizeKeys = new Set(selectedSizes.map((s) => s.size))

    // Get every individual log entry matching those sizes
    const matchingLogs = filteredLogs.filter((entry) => {
      const entrySize = entry.size || '(No Size)'
      return sizeKeys.has(entrySize)
    })

    if (matchingLogs.length === 0) return

    const rows = matchingLogs.map((entry) => ({
      time: formatDateTime(entry.created_at),
      machine: entry.machine_name || `Machine ${entry.machine_id}`,
      material: entry.material_name || `Material ${entry.material_id || '-'}`,
      size: entry.size || '-',
      worker: entry.worker_name || '-',
      gross: toNumber(entry.gross_weight).toFixed(2),
      tare: toNumber(entry.tare_weight).toFixed(2),
      net: toNumber(entry.net_weight, Math.max(toNumber(entry.gross_weight) - toNumber(entry.tare_weight), 0)).toFixed(2),
    }))

    // Calculate totals for the last row
    const totGross = matchingLogs.reduce((sum, e) => sum + toNumber(e.gross_weight), 0)
    const totTare = matchingLogs.reduce((sum, e) => sum + toNumber(e.tare_weight), 0)
    const totNet = matchingLogs.reduce((sum, e) => sum + toNumber(e.net_weight, Math.max(toNumber(e.gross_weight) - toNumber(e.tare_weight), 0)), 0)

    exportSingleSheet({
      filename: `Size_Report_${onlySelected ? 'Selected_' : ''}${new Date().toISOString().slice(0, 10)}`,
      rows,
      columns: [
        { key: 'time', label: 'Time' },
        { key: 'machine', label: 'Machine' },
        { key: 'material', label: 'Material' },
        { key: 'size', label: 'Size' },
        { key: 'worker', label: 'Worker' },
        { key: 'gross', label: 'Gross (kg)' },
        { key: 'tare', label: 'Tare (kg)' },
        { key: 'net', label: 'Net (kg)' },
      ],
      totalRow: {
        time: 'TOTAL',
        machine: '',
        material: '',
        size: `${matchingLogs.length} entries`,
        worker: '',
        gross: totGross.toFixed(2),
        tare: totTare.toFixed(2),
        net: totNet.toFixed(2),
      },
    })
  }

  const handleExportProductionHistory = (onlySelected = false) => {
    const source = onlySelected ? filteredLogs.filter((e) => selectedLogIds.includes(e.id)) : filteredLogs
    if (source.length === 0) return
    const rows = source.map((entry) => ({
      time: formatDateTime(entry.created_at),
      machine: entry.machine_name || `Machine ${entry.machine_id}`,
      material: entry.material_name || `Material ${entry.material_id || '-'}`,
      size: entry.size || '-',
      worker: entry.worker_name || '-',
      gross: toNumber(entry.gross_weight).toFixed(2),
      tare: toNumber(entry.tare_weight).toFixed(2),
      net: toNumber(entry.net_weight, Math.max(toNumber(entry.gross_weight) - toNumber(entry.tare_weight), 0)).toFixed(2),
    }))
    exportSingleSheet({
      filename: `Production_History_${onlySelected ? 'Selected_' : ''}${new Date().toISOString().slice(0, 10)}`,
      rows,
      columns: [
        { key: 'time', label: 'Time' },
        { key: 'machine', label: 'Machine' },
        { key: 'material', label: 'Material' },
        { key: 'size', label: 'Size' },
        { key: 'worker', label: 'Worker' },
        { key: 'gross', label: 'Gross (kg)' },
        { key: 'tare', label: 'Tare (kg)' },
        { key: 'net', label: 'Net (kg)' },
      ],
    })
  }

  const handleExportFullReport = () => {
    const machineRows = report.map((row) => ({
      machine: row.machine_name || `Machine ${row.machine_id}`,
      entries: toNumber(row.total_entries),
      net_kg: toNumber(row.total_net_weight_kg).toFixed(3),
      gross_kg: toNumber(row.total_gross_weight_kg).toFixed(3),
      tare_kg: toNumber(row.total_tare_weight_kg).toFixed(3),
    }))
    const sizeRows = sizeTotals.map((s) => ({ size: s.size, machines: s.machines, entries: s.entries, net_kg: s.net.toFixed(3), gross_kg: s.gross.toFixed(3), tare_kg: s.tare.toFixed(3) }))
    const historyRows = detailLogs.map((entry) => ({
      time: formatDateTime(entry.created_at),
      machine: entry.machine_name || `Machine ${entry.machine_id}`,
      material: entry.material_name || `Material ${entry.material_id || '-'}`,
      size: entry.size || '-',
      worker: entry.worker_name || '-',
      gross: toNumber(entry.gross_weight).toFixed(2),
      tare: toNumber(entry.tare_weight).toFixed(2),
      net: toNumber(entry.net_weight, Math.max(toNumber(entry.gross_weight) - toNumber(entry.tare_weight), 0)).toFixed(2),
    }))
    exportMultiSheet({
      filename: `Machine_Full_Report_${new Date().toISOString().slice(0, 10)}`,
      sheets: [
        { sheetName: 'Machine Breakdown', rows: machineRows, columns: [{ key: 'machine', label: 'Machine' }, { key: 'entries', label: 'Entries' }, { key: 'net_kg', label: 'Net Output (kg)' }, { key: 'gross_kg', label: 'Gross (kg)' }, { key: 'tare_kg', label: 'Tare (kg)' }], totalRow: { machine: 'TOTAL', entries: totalEntries, net_kg: totalNet.toFixed(3), gross_kg: totalGross.toFixed(3), tare_kg: '' } },
        { sheetName: 'Size Totals', rows: sizeRows, columns: [{ key: 'size', label: 'Size' }, { key: 'machines', label: 'Machine(s)' }, { key: 'entries', label: 'Total Entries' }, { key: 'net_kg', label: 'Total Net (kg)' }, { key: 'gross_kg', label: 'Total Gross (kg)' }, { key: 'tare_kg', label: 'Total Tare (kg)' }] },
        { sheetName: 'Production History', rows: historyRows, columns: [{ key: 'time', label: 'Time' }, { key: 'machine', label: 'Machine' }, { key: 'material', label: 'Material' }, { key: 'size', label: 'Size' }, { key: 'worker', label: 'Worker' }, { key: 'gross', label: 'Gross (kg)' }, { key: 'tare', label: 'Tare (kg)' }, { key: 'net', label: 'Net (kg)' }] },
      ],
    })
    toast.success('Full report exported to Excel')
  }

  const toggleAll = () => {
    setSelectedLogIds(allSelected ? [] : filteredLogs.map((row) => row.id))
  }

  const toggleOne = (rowId) => {
    setSelectedLogIds((previous) =>
      previous.includes(rowId) ? previous.filter((id) => id !== rowId) : [...previous, rowId],
    )
  }

  const toggleAllSizes = () => {
    setSelectedSizeIds(allSizesSelected ? [] : filteredSizeTotals.map((s) => s.size))
  }

  const toggleOneSize = (sizeKey) => {
    setSelectedSizeIds((prev) =>
      prev.includes(sizeKey) ? prev.filter((k) => k !== sizeKey) : [...prev, sizeKey],
    )
  }

  const handleDeleteOne = async (logId) => {
    if (!window.confirm('Delete this production log?')) return

    try {
      await deleteProductionLog(logId)
      setSelectedLogIds((previous) => previous.filter((id) => id !== logId))
      await loadReport()
      toast.success('Production log deleted')
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to delete production log')
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedLogIds.length === 0) return
    if (!window.confirm(`Delete ${selectedLogIds.length} selected production logs?`)) return

    try {
      await bulkDeleteProductionLogs(selectedLogIds)
      setSelectedLogIds([])
      await loadReport()
      toast.success('Selected production logs deleted')
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to delete selected production logs')
    }
  }

  const openEditModal = (entry) => {
    setEditingLog(entry)
    setEditForm({
      machine_id: String(entry.machine_id || ''),
      material_id: String(entry.material_id || ''),
      size: entry.size || '',
      worker_name: entry.worker_name || '',
      gross_weight: toNumber(entry.gross_weight).toFixed(2),
      tare_weight: toNumber(entry.tare_weight).toFixed(2),
    })
  }

  const handleSaveEdit = async () => {
    if (!editingLog) return

    try {
      setSavingEdit(true)
      await updateProductionLog(editingLog.id, {
        machine_id: toNumber(editForm.machine_id),
        material_type_id: toNumber(editForm.material_id),
        size: editForm.size,
        worker_name: editForm.worker_name,
        gross_weight: toNumber(editForm.gross_weight),
        tare_weight: toNumber(editForm.tare_weight),
      })
      setEditingLog(null)
      await loadReport()
      toast.success('Production log updated')
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update production log')
    } finally {
      setSavingEdit(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-text-primary tracking-tight">Machine Reports</h1>
        <p className="text-sm text-text-secondary mt-1">Production output and production history by machine for a date range</p>
      </div>

      <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">Date From</label>
            <input
              type="date"
              value={filters.date_from}
              onChange={(event) => setFilters((previous) => ({ ...previous, date_from: event.target.value }))}
              className="bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">Date To</label>
            <input
              type="date"
              value={filters.date_to}
              onChange={(event) => setFilters((previous) => ({ ...previous, date_to: event.target.value }))}
              className="bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-widest text-text-secondary/70 mb-2">Machine</label>
            <select
              value={filters.machine_id}
              onChange={(event) => setFilters((previous) => ({ ...previous, machine_id: event.target.value }))}
              className="bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm focus:border-accent-gold transition-all min-w-40"
            >
              <option value="">All machines</option>
              {machineOptions.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.name || `Machine ${machine.id}`}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={loadReport}
            disabled={loading}
            className="px-6 py-2.5 rounded-xl bg-accent-gold text-white text-sm font-bold hover:bg-accent-gold-hover shadow-sm transition-all disabled:opacity-40"
          >
            {loading ? 'Loading...' : 'Generate Report'}
          </button>
        </div>
        {applied && (
          <p className="text-[11px] text-text-secondary/50 mt-3">
            Showing: {formatDate(applied.date_from)} - {formatDate(applied.date_to)}
            {applied.machine_id ? ` · Machine ${applied.machine_id}` : ' · All machines'}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {!loading && report.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: 'Total Entries', value: totalEntries.toLocaleString(), icon: '📋' },
            { label: 'Total Net Output', value: `${totalNet.toFixed(2)} kg`, icon: '⚖️' },
            { label: 'Total Gross', value: `${totalGross.toFixed(2)} kg`, icon: '📦' },
          ].map((card) => (
            <div key={card.label} className="bg-bg-card rounded-2xl border border-border-default shadow-sm p-5">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">{card.icon}</span>
                <span className="text-xs font-semibold uppercase tracking-widest text-text-secondary/60">{card.label}</span>
              </div>
              <p className="text-2xl font-bold text-text-primary font-mono">{card.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between gap-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60">Machine Output Breakdown</h2>
          <div className="flex items-center gap-2">
            {report.length > 0 && (
              <button type="button" onClick={handleExportMachineBreakdown} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all">
                <ExcelIcon /> Export
              </button>
            )}
            {report.length > 0 && detailLogs.length > 0 && (
              <button type="button" onClick={handleExportFullReport} className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25 transition-all">
                <ExcelIcon /> Full Report
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="divide-y divide-border-subtle">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="flex items-center gap-4 px-6 py-4">
                <div className="h-4 w-24 bg-bg-primary rounded animate-pulse" />
                <div className="h-4 flex-1 bg-bg-primary rounded animate-pulse" />
                <div className="h-4 w-20 bg-bg-primary rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : report.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-text-secondary text-sm">No data for this date range.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle bg-bg-primary/50">
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Machine</th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Entries</th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Net Output (kg)</th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Gross (kg)</th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Tare (kg)</th>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Bar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {report
                  .sort((a, b) => toNumber(b.total_net_weight_kg) - toNumber(a.total_net_weight_kg))
                  .map((row) => {
                    const net = toNumber(row.total_net_weight_kg)
                    const barWidth = maxNet > 0 ? (net / maxNet) * 100 : 0
                    const hasData = toNumber(row.total_entries) > 0

                    return (
                      <tr key={row.machine_id} className={`hover:bg-white/[0.02] transition-colors ${!hasData ? 'opacity-40' : ''}`}>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${hasData ? 'bg-accent-gold' : 'bg-text-secondary/20'}`} />
                            <span className="font-semibold text-text-primary">{row.machine_name || `Machine ${row.machine_id}`}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-text-secondary">{toNumber(row.total_entries)}</td>
                        <td className="px-6 py-4 text-right font-mono font-bold text-accent-gold">{net.toFixed(3)}</td>
                        <td className="px-6 py-4 text-right font-mono text-text-secondary/80">{toNumber(row.total_gross_weight_kg).toFixed(3)}</td>
                        <td className="px-6 py-4 text-right font-mono text-text-secondary/60">{toNumber(row.total_tare_weight_kg).toFixed(3)}</td>
                        <td className="px-6 py-4">
                          <div className="w-32 h-2 bg-bg-primary rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent-gold rounded-full transition-all duration-700"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-default bg-bg-primary/30">
                  <td className="px-6 py-3 text-xs font-bold uppercase tracking-wide text-text-secondary/60">Total</td>
                  <td className="px-6 py-3 text-right font-mono font-bold text-text-primary">{totalEntries}</td>
                  <td className="px-6 py-3 text-right font-mono font-bold text-accent-gold">{totalNet.toFixed(3)}</td>
                  <td className="px-6 py-3 text-right font-mono font-bold text-text-secondary/80">{totalGross.toFixed(3)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ── Size Totals Table ── */}
      {!loading && sizeTotals.length > 0 && (
        <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center">
                <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                </svg>
              </div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60">Size Totals</h2>
              <span className="text-[10px] text-text-secondary/40 font-mono">{filteredSizeTotals.length} of {sizeTotals.length}</span>
            </div>
           <div className="flex items-center gap-3">
              <button type="button" onClick={() => handleExportSizeTotals(false)} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all">
                <ExcelIcon /> Export All
              </button>
              {selectedSizeIds.length > 0 && (
                <button type="button" onClick={() => handleExportSizeTotals(true)} className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-400 hover:bg-cyan-500/20 transition-all">
                  <ExcelIcon /> Export Selected ({selectedSizeIds.length})
                </button>
              )}
            </div>
          </div>
          {/* ── Size Totals Search Bar ── */}
          <div className="px-6 py-3 border-b border-border-subtle bg-bg-primary/30 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-secondary/40" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                value={sizeSearch}
                onChange={(e) => setSizeSearch(e.target.value)}
                placeholder="Search by size..."
                className="w-full bg-bg-input text-text-primary border border-border-default rounded-lg pl-9 pr-3 py-2 text-xs focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/20 transition-all placeholder:text-text-secondary/30"
              />
              {sizeSearch && (
                <button
                  type="button"
                  onClick={() => setSizeSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary/40 hover:text-text-secondary transition-colors"
                  aria-label="Clear search"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <select
              value={sizeMachineDropdown}
              onChange={(e) => setSizeMachineDropdown(e.target.value)}
              className="bg-bg-input text-text-primary border border-border-default rounded-lg px-3 py-2 text-xs focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/20 transition-all min-w-[160px]"
            >
              <option value="">All Machines</option>
              {sizeMachineOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            {(sizeSearch || sizeMachineDropdown) && (
              <button
                type="button"
                onClick={() => { setSizeSearch(''); setSizeMachineDropdown('') }}
                className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle bg-bg-primary/50">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">
                    <input type="checkbox" checked={allSizesSelected} onChange={toggleAllSizes} className="h-4 w-4 accent-cyan-400" aria-label="Select all sizes" />
                  </th>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Size</th>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Machine(s)</th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Total Entries</th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Total Net (kg)</th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Total Gross (kg)</th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Total Tare (kg)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filteredSizeTotals.map((s) => (
                  <tr key={s.size} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-4">
                      <input type="checkbox" checked={selectedSizeIds.includes(s.size)} onChange={() => toggleOneSize(s.size)} className="h-4 w-4 accent-cyan-400" aria-label={`Select size ${s.size}`} />
                    </td>
                    <td className="px-6 py-4 font-semibold text-text-primary">{s.size}</td>
                    <td className="px-6 py-4 text-text-secondary/80 text-xs">{s.machines}</td>
                    <td className="px-6 py-4 text-right font-mono text-text-secondary">{s.entries}</td>
                    <td className="px-6 py-4 text-right font-mono font-bold text-cyan-400">{s.net.toFixed(3)}</td>
                    <td className="px-6 py-4 text-right font-mono text-text-secondary/80">{s.gross.toFixed(3)}</td>
                    <td className="px-6 py-4 text-right font-mono text-text-secondary/60">{s.tare.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border-default bg-bg-primary/30">
                  <td className="px-4 py-3" />
                  <td className="px-6 py-3 text-xs font-bold uppercase tracking-wide text-text-secondary/60">Total</td>
                  <td className="px-6 py-3" />
                  <td className="px-6 py-3 text-right font-mono font-bold text-text-primary">{filteredSizeTotals.reduce((s, r) => s + r.entries, 0)}</td>
                  <td className="px-6 py-3 text-right font-mono font-bold text-cyan-400">{filteredSizeTotals.reduce((s, r) => s + r.net, 0).toFixed(3)}</td>
                  <td className="px-6 py-3 text-right font-mono font-bold text-text-secondary/80">{filteredSizeTotals.reduce((s, r) => s + r.gross, 0).toFixed(3)}</td>
                  <td className="px-6 py-3 text-right font-mono font-bold text-text-secondary/60">{filteredSizeTotals.reduce((s, r) => s + r.tare, 0).toFixed(3)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="bg-bg-card rounded-2xl border border-border-default shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/15 flex items-center justify-center">
              <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
            </div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-text-secondary/60">Production History</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-text-secondary/40 font-mono">{detailLogs.length} entries</span>
            <button
              type="button"
              onClick={handleDeleteSelected}
              disabled={selectedLogIds.length === 0}
              className="rounded-lg border border-red-500/30 px-4 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              Delete Selected ({selectedLogIds.length})
            </button>
            {detailLogs.length > 0 && (
              <button type="button" onClick={handleExportProductionHistory} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all">
                <ExcelIcon /> Export
              </button>
            )}
          </div>
        </div>

        {detailLoading ? (
          <div className="divide-y divide-border-subtle">
            {[...Array(5)].map((_, index) => (
              <div key={index} className="flex items-center gap-4 px-6 py-4">
                <div className="h-4 w-20 bg-bg-primary rounded animate-pulse" />
                <div className="h-4 flex-1 bg-bg-primary rounded animate-pulse" />
                <div className="h-4 w-16 bg-bg-primary rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : detailLogs.length === 0 ? (
          <div className="py-14 text-center">
            <p className="text-text-secondary/50 text-sm">No production entries found for this date range.</p>
            <p className="text-text-secondary/30 text-xs mt-1">Log entries from the Production page will appear here.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle bg-bg-primary/50">
                  <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="h-4 w-4 accent-accent-gold"
                      aria-label="Select all production rows"
                    />
                  </th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Time</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Machine</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Material</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Size</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Worker</th>
                  <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Gross (kg)</th>
                  <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Tare (kg)</th>
                  <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Net (kg)</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-widest text-text-secondary/50">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {detailLogs.map((entry, index) => {
                  const gross = toNumber(entry.gross_weight)
                  const tare = toNumber(entry.tare_weight)
                  const net = toNumber(entry.net_weight, Math.max(gross - tare, 0))
                  const machineName = entry.machine_name || `Machine ${entry.machine_id}`
                  const materialName = entry.material_name || `Material ${entry.material_id || '-'}`
                  const workerName = entry.worker_name || '-'

                  return (
                    <tr key={entry.id || index} className={`hover:bg-white/[0.02] transition-colors ${index % 2 !== 0 ? 'bg-white/[0.01]' : ''}`}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedLogIds.includes(entry.id)}
                          onChange={() => toggleOne(entry.id)}
                          className="h-4 w-4 accent-accent-gold"
                          aria-label={`Select production log ${entry.id}`}
                        />
                      </td>
                      <td className="px-5 py-3 text-text-primary/80 whitespace-nowrap text-xs">{formatDateTime(entry.created_at)}</td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-accent-gold/10 text-accent-gold border border-accent-gold/20">
                          {machineName}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-text-primary/80">{materialName}</td>
                      <td className="px-5 py-3 text-text-primary/80">{entry.size || '-'}</td>
                      <td className="px-5 py-3 text-text-primary/80">{workerName}</td>
                      <td className="px-5 py-3 text-right font-mono text-text-secondary/80">{gross.toFixed(2)}</td>
                      <td className="px-5 py-3 text-right font-mono text-text-secondary/60">{tare.toFixed(2)}</td>
                      <td className="px-5 py-3 text-right font-mono font-bold text-accent-gold">{net.toFixed(2)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => openEditModal(entry)}
                            className="text-xs font-semibold text-blue-300 transition-colors hover:text-blue-200"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteOne(entry.id)}
                            className="text-xs font-semibold text-red-300 transition-colors hover:text-red-200"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EditEntryModal
        open={Boolean(editingLog)}
        title="Edit Production Log"
        values={editForm}
        onChange={(name, value) => setEditForm((previous) => ({ ...previous, [name]: value }))}
        onClose={() => {
          if (savingEdit) return
          setEditingLog(null)
        }}
        onSubmit={handleSaveEdit}
        submitting={savingEdit}
        fields={[
          { name: 'machine_id', label: 'Machine ID', type: 'number', min: '1', required: true },
          {
            name: 'material_id',
            label: 'Material',
            type: 'select',
            required: true,
            options: [
              { value: '', label: 'Select material' },
              ...materialOptions.map((material) => ({
                value: String(material.material_type_id),
                label: material.material_name,
              })),
            ],
          },
          { name: 'size', label: 'Size', type: 'text', placeholder: 'Optional size' },
          { name: 'worker_name', label: 'Worker Name', type: 'text', required: true },
          { name: 'gross_weight', label: 'Gross Weight', type: 'number', step: '0.01', min: '0.01', required: true },
          { name: 'tare_weight', label: 'Tare Weight', type: 'number', step: '0.01', min: '0', required: true },
        ]}
      />
    </div>
  )
}
