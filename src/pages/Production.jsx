import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSSE from '../hooks/useSSE'
import useFlashRows from '../hooks/useFlashRows'
import EditEntryModal from '../components/EditEntryModal'
import StockOverflowDialog, { parseAvailableKg } from '../components/StockOverflowDialog'
import Pictogram from '../components/Pictogram'
import { useToast } from '../components/Toast'
import api from '../utils/api'
import { exportSingleSheet } from '../utils/exportToExcel'
import {
  bulkDeleteProductionLogs,
  deleteProductionLog,
  updateProductionLog,
} from '../utils/logActions'
import { formatDate as formatDateIST, formatTime as formatTimeIST, formatDateTime as formatDateTimeIST, todayIST } from '../utils/datetime'

const ExcelIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
)

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function toNumber(v, fb = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fb
}
function formatKg(kg) {
  const n = toNumber(kg)
  return n >= 1000 ? `${(n / 1000).toFixed(2)} tons` : `${n.toFixed(2)} kg`
}
function formatTime(iso) {
  return formatDateTimeIST(iso, '—')
}

/* ── Persistent worker name & size ───────────────────────────────────────── */
const WORKER_KEY = 'vp_production_worker_name'
const SIZE_KEY = 'vp_production_size'
const MATERIAL_KEY = 'vp_production_material_id'
function loadWorkerName() {
  try { return localStorage.getItem(WORKER_KEY) || '' } catch { return '' }
}
function saveWorkerName(n) {
  try { localStorage.setItem(WORKER_KEY, n) } catch { /* noop */ }
}
function loadSize() {
  try { return localStorage.getItem(SIZE_KEY) || '' } catch { return '' }
}
function saveSize(s) {
  try { localStorage.setItem(SIZE_KEY, s) } catch { /* noop */ }
}
function loadMaterialId() {
  try { return localStorage.getItem(MATERIAL_KEY) || '' } catch { return '' }
}
function saveMaterialId(id) {
  try {
    if (id) {
      localStorage.setItem(MATERIAL_KEY, id)
      return
    }
    localStorage.removeItem(MATERIAL_KEY)
  } catch {
    /* noop */
  }
}

function normalizeHistoryEntry(log) {
  const gross = toNumber(log.gross ?? log.gross_weight)
  const tare = toNumber(log.tare ?? log.tare_weight)
  const net = toNumber(log.net ?? log.net_weight, Math.max(gross - tare, 0))

  return {
    id: log.id,
    time: log.time ?? log.created_at,
    machine: log.machine,
    machineId: log.machineId ?? log.machine_id,
    machineType: log.machineType,
    material: log.material,
    materialId: log.materialId ?? log.material_id,
    size: log.size || '—',
    worker: log.worker || '—',
    gross,
    tare,
    net,
  }
}

function getAssignedAvailableKg(material) {
  const pooled = material?.available_quantity_kg
  if (pooled !== undefined && pooled !== null) return toNumber(pooled)
  return toNumber(material?.quantity_kg)
}

/* ── Machine definitions ─────────────────────────────────────────────────── */
const PRODUCTION_MACHINES = [
  { id: 'M1', label: 'Machine 1' },
  { id: 'M2', label: 'Machine 2' },
  { id: 'M3', label: 'Machine 3' },
  { id: 'M4', label: 'Machine 4' },
  { id: 'M5', label: 'Machine 5' },
]
const CUTTING_MACHINES = [
  { id: 'C1', label: 'Cutting 1' },
  { id: 'C2', label: 'Cutting 2' },
  { id: 'C3', label: 'Cutting 3' },
]

/* ── Icons ────────────────────────────────────────────────────────────────── */
const MachineIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
  </svg>
)
const CutIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M7.848 8.25l1.536.887M7.848 8.25a3 3 0 11-5.196-3 3 3 0 015.196 3zm9.304 0l-1.536.887M17.152 8.25a3 3 0 105.196-3 3 3 0 00-5.196 3zM12 18.75l-3.152-5.363m0 0L12 12l3.152 1.387M8.848 13.387L12 18.75l3.152-5.363" />
  </svg>
)
const CloseIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
)

/* ── Machine Button ───────────────────────────────────────────────────────── */
function MachinePill({ machine, isActive, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        relative group flex items-center gap-3 rounded-2xl border px-5 py-4 text-left transition-all duration-200
        ${isActive
          ? 'border-accent-gold bg-accent-gold/10 shadow-lg shadow-accent-gold/10 scale-[1.02]'
          : 'border-border-default bg-bg-card hover:border-accent-gold/40 hover:bg-white/[0.02]'}
      `}
    >
      <div className={`
        w-3 h-3 rounded-full transition-colors duration-200
        ${isActive ? 'bg-accent-gold animate-pulse' : 'bg-text-secondary/20 group-hover:bg-accent-gold/40'}
      `} />
      <span className={`text-sm font-semibold tracking-wide ${isActive ? 'text-accent-gold' : 'text-text-primary'}`}>
        {machine.label}
      </span>
      {isActive && (
        <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-accent-gold/70">Active</span>
      )}
    </button>
  )
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  MAIN COMPONENT                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */
function getTodayDate() {
  return todayIST()
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return ''
  return formatDateIST(dateStr, dateStr)
}

export default function Production({ user }) {
  const toast = useToast()

  /* ── State ──────────────────────────────────────────────────────────────── */
  const [activeMachine, setActiveMachine] = useState(null)     // { id, label, type: 'production' | 'cutting' }
  const [floorStock, setFloorStock] = useState([])            // Issued (floor) materials with quantities
  const [assignedStock, setAssignedStock] = useState([])      // Materials assigned to active machine
  const [workerName, setWorkerName] = useState(loadWorkerName)
  const [materialId, setMaterialId] = useState(loadMaterialId) // Stores material_type_id for floor_material_balance
  const [size, setSize] = useState(loadSize)
  const [grossWeight, setGrossWeight] = useState('')
  const [tareWeight, setTareWeight] = useState('')
  const [directNetWeight, setDirectNetWeight] = useState('')
  const [productionDate, setProductionDate] = useState(getTodayDate)
  const [history, setHistory] = useState([])
  const [historyMachineFilter, setHistoryMachineFilter] = useState('')
  useFlashRows(history.length)
  const [selectedHistoryIds, setSelectedHistoryIds] = useState([])
  const [editingHistoryRow, setEditingHistoryRow] = useState(null)
  const [editHistoryForm, setEditHistoryForm] = useState({
    machine_id: '',
    material_id: '',
    size: '',
    worker_name: '',
    gross_weight: '',
    tare_weight: '',
  })
  const [savingHistoryEdit, setSavingHistoryEdit] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [stockOverflow, setStockOverflow] = useState(null) // { materialName, attempted, available, materialName }
  const [topUpLoading, setTopUpLoading] = useState(false)
  const [loadingWorker, setLoadingWorker] = useState(false)
  const [loadingMaterials, setLoadingMaterials] = useState(false)
  const [hasLoadedMaterialsOnce, setHasLoadedMaterialsOnce] = useState(false)
  const grossRef = useRef(null)
  const isBackdated = productionDate !== getTodayDate()

  /* ── Compute available materials for production with floor stock quantities ─ */
  const materialsForProduction = useMemo(() => {
    // Floor stock is the source of truth for production - only show materials that have been issued
    return floorStock.map(fs => ({
      id: fs.material_type_id,  // material_type_id from floor_material_balance
      material_name: fs.material_name,
      issued_quantity_kg: toNumber(fs.total_quantity_kg),
    }))
  }, [floorStock])

  const selectedMaterialAvailable = useMemo(
    () => materialsForProduction.some((mat) => String(mat.id) === String(materialId)),
    [materialId, materialsForProduction],
  )

  /* ── Net weight auto-calc ───────────────────────────────────────────────── */
  const isCuttingMachine = activeMachine?.type === 'cutting'

  const netWeight = useMemo(() => {
    if (isCuttingMachine) {
      if (!directNetWeight) return null
      return toNumber(directNetWeight)
    }
    const g = toNumber(grossWeight)
    const t = toNumber(tareWeight)
    if (!grossWeight && !tareWeight) return null
    return Math.max(g - t, 0)
  }, [grossWeight, tareWeight, directNetWeight, isCuttingMachine])

  const isValid = netWeight !== null && netWeight > 0 && materialId !== '' && selectedMaterialAvailable && activeMachine !== null
  const isInvalid = !isCuttingMachine && grossWeight !== '' && tareWeight !== '' && netWeight !== null && netWeight <= 0

  /* ── Load floor stock (issued materials) for production ───────────────────── */
  const loadFloorStock = useCallback(async (silent = false) => {
    if (!silent) setLoadingMaterials(true)
    try {
      const { data } = await api.get('/floor/stock')
      setFloorStock(Array.isArray(data) ? data : [])
      setHasLoadedMaterialsOnce(true)
    } catch (err) {
      console.error('Failed to load floor stock:', err)
    } finally {
      if (!silent) setLoadingMaterials(false)
    }
  }, [])

  useEffect(() => {
    loadFloorStock()
  }, [loadFloorStock])

  useSSE(['production', 'floor_stock'], () => loadFloorStock(true))

  /* ── Persist worker name & size ─────────────────────────────────────────── */
  useEffect(() => { saveWorkerName(workerName) }, [workerName])
  useEffect(() => { saveSize(size) }, [size])
  useEffect(() => { saveMaterialId(materialId) }, [materialId])

  useEffect(() => {
    if (loadingMaterials || !hasLoadedMaterialsOnce) return
    if (materialId && !selectedMaterialAvailable) {
      setMaterialId('')
    }
  }, [hasLoadedMaterialsOnce, loadingMaterials, materialId, selectedMaterialAvailable])

  /* ── Fetch worker name from machine state ────────────────────────────────── */
  const fetchWorkerForMachine = useCallback(async (machineId) => {
    setLoadingWorker(true)
    try {
      const { data } = await api.get(`/machines/${machineId}/state`)
      if (data?.current_worker) {
        setWorkerName(data.current_worker)
      }
    } catch (err) {
      // Silently ignore if endpoint doesn't exist
      console.debug('Could not fetch worker state:', err.message)
    } finally {
      setLoadingWorker(false)
    }
  }, [])

  /* ── Fetch production logs for selected machine ──────────────────────────── */
  const fetchLogsForMachine = useCallback(async (machineId) => {
    try {
      const params = {}
      if (machineId) params.machine_id = machineId

      const { data } = await api.get('/production/logs', {
        params
      })

      // Transform API response to history format
      const logs = Array.isArray(data) ? data : []
      const historyItems = logs.map(log => normalizeHistoryEntry({
        id: log.id,
        time: log.created_at,
        machine: `M${log.machine_id}`,
        machineType: 'production',
        material: log.material_name || `Material ${log.material_id}`,
        size: log.size || '—',
        worker: log.worker_name || '—',
        gross: log.gross_weight,
        tare: log.tare_weight,
        net: log.net_weight,
      }))

      setHistory(historyItems)
    } catch (err) {
      console.error('Failed to load production logs:', err)
    }
  }, [])

  useEffect(() => {
    const machineId = historyMachineFilter ? Number(historyMachineFilter) : null
    fetchLogsForMachine(machineId).catch(() => {})
  }, [fetchLogsForMachine, historyMachineFilter])

  /* ── Select / deselect machine ──────────────────────────────────────────── */
  const selectMachine = useCallback((machine, type) => {
    setActiveMachine(prev => {
      if (prev && prev.id === machine.id && prev.type === type) return null
      return { ...machine, type }
    })
    setAssignedStock([])
    setGrossWeight('')
    setTareWeight('')
    setDirectNetWeight('')

    // Fetch worker name for this machine from backend state
    const machineIdNum = parseInt(machine.id.replace(/\D/g, ''), 10) || 1
    setHistoryMachineFilter(String(machineIdNum))
    fetchWorkerForMachine(machineIdNum)

    setTimeout(() => grossRef.current?.focus(), 100)
  }, [fetchWorkerForMachine])

  /* ── Load assigned stock for active machine ──────────────────────────────── */
  useEffect(() => {
    const loadAssignedStock = async () => {
      if (!activeMachine) {
        setAssignedStock([])
        return
      }

      try {
        const machineIdNum = parseInt(activeMachine.id.replace(/\D/g, ''), 10) || 1
        const { data } = await api.get(`/machines/${machineIdNum}/assigned-stock`)

        if (data?.assigned_materials) {
          const assignedMaterials = Array.isArray(data.assigned_materials) ? data.assigned_materials : []
          setAssignedStock(assignedMaterials)
        }
      } catch (err) {
        // Assignment table might not exist yet, fall back to floor stock
        console.debug('Could not load assigned stock:', err.message)
        setAssignedStock([])
      }
    }

    loadAssignedStock()
  }, [activeMachine])

  const deselectMachine = useCallback(() => {
    setActiveMachine(null)
    setAssignedStock([])
    setGrossWeight('')
    setTareWeight('')
    setDirectNetWeight('')
  }, [])

  const refreshHistoryContext = useCallback(async (machineIdOverride) => {
    const resolvedMachineId =
      machineIdOverride ||
      (historyMachineFilter ? Number(historyMachineFilter) : null) ||
      (activeMachine ? parseInt(activeMachine.id.replace(/\D/g, ''), 10) || 1 : null)

    const requests = [api.get('/floor/stock')]
    if (resolvedMachineId) {
      requests.push(api.get(`/machines/${resolvedMachineId}/assigned-stock`))
      requests.push(fetchLogsForMachine(resolvedMachineId))
    }

    const [floorRes, assignedRes] = await Promise.allSettled(requests)

    if (floorRes.status === 'fulfilled') {
      setFloorStock(Array.isArray(floorRes.value.data) ? floorRes.value.data : [])
      setHasLoadedMaterialsOnce(true)
    }

    if (assignedRes && assignedRes.status === 'fulfilled') {
      const assignedMaterials = Array.isArray(assignedRes.value.data?.assigned_materials)
        ? assignedRes.value.data.assigned_materials
        : []
      setAssignedStock(assignedMaterials)
    }
  }, [activeMachine, fetchLogsForMachine, historyMachineFilter])

  /* ── Submit entry ───────────────────────────────────────────────────────── */
  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault()
    if (!activeMachine || !isValid || !materialId) return

    // Validation
    if (!materialId) {
      toast.error('Please select a material')
      return
    }
    if (!workerName) {
      toast.error('Please enter worker name')
      return
    }

    const isCutting = activeMachine.type === 'cutting'
    const gross = isCutting ? 0 : toNumber(grossWeight)
    const tare = isCutting ? 0 : toNumber(tareWeight)
    const net = isCutting ? toNumber(directNetWeight) : Math.max(gross - tare, 0)

    if (net <= 0) {
      toast.error('Net weight must be greater than 0')
      return
    }
    if (!isCutting && gross < tare) {
      toast.error('Gross weight must be >= tare weight')
      return
    }

    setSubmitting(true)
    try {
      const machineIdNum = parseInt(activeMachine.id.replace(/\D/g, ''), 10) || 1
      const materialIdNum = parseInt(materialId, 10)

      // New API: POST /production/logs
      // Send as material_type_id for auto-assignment system
      const { data } = await api.post('/production/logs', {
        machine_id: machineIdNum,
        material_type_id: materialIdNum, // Use material_type_id for auto-assignment
        size: size || null,
        worker_name: workerName,
        gross_weight: gross,
        tare_weight: tare,
        production_date: productionDate || getTodayDate(),
      })

      // Find material name from assigned stock or floor stock for history display
      const selectedAssignedMaterial = assignedStock.find(mat => String(mat.material_type_id) === String(materialIdNum))
      let selectedMaterial = selectedAssignedMaterial
      if (!selectedMaterial) {
        selectedMaterial = materialsForProduction.find(mat => String(mat.id) === String(materialIdNum))
      }
      const materialName = selectedMaterial?.material_name || `Material ${materialIdNum}`

      // Add to local history
      setHistory(prev => [normalizeHistoryEntry({
        id: data?.id || Date.now(),
        time: new Date().toISOString(),
        machine: activeMachine.label,
        machineType: activeMachine.type,
        material: materialName,
        size: size || '—',
        worker: workerName || '—',
        gross,
        tare,
        net,
      }), ...prev])

      setFloorStock((prev) =>
        prev
          .map((row) => {
            if (String(row.material_type_id) !== String(materialIdNum)) return row
            return {
              ...row,
              total_quantity_kg: Math.max(toNumber(row.total_quantity_kg) - net, 0),
            }
          })
          .filter((row) => toNumber(row.total_quantity_kg) > 0),
      )

      setAssignedStock((prev) =>
        prev.map((row) => {
          if (String(row.material_type_id) !== String(materialIdNum)) return row
          return {
            ...row,
            available_quantity_kg: Math.max(getAssignedAvailableKg(row) - net, 0),
          }
        }),
      )

      toast.success(`✓ Entry logged for ${activeMachine.label}`)

      // Reset form (keep machine, worker, material selection)
      if (data?.tolerance?.tolerance_status === 'BREACH') {
        toast.warning(`Entry logged for ${activeMachine.label} with tolerance breach`)
      }
      setGrossWeight('')
      setTareWeight('')
      setDirectNetWeight('')
      setTimeout(() => grossRef.current?.focus(), 50)
    } catch (err) {
      const errorMsg = err?.response?.data?.detail || err?.response?.data?.error || err?.message || 'Failed to log entry'
      if (errorMsg.includes('Insufficient floor stock') || errorMsg.includes('Not enough')) {
        const available = parseAvailableKg(errorMsg) ?? 0
        const selectedAssignedMaterial = assignedStock.find(mat => String(mat.material_type_id) === String(parseInt(materialId, 10)))
        const selectedMaterial = selectedAssignedMaterial || materialsForProduction.find(mat => String(mat.id) === String(parseInt(materialId, 10)))
        setStockOverflow({
          materialName: selectedMaterial?.material_name || `Material ${materialId}`,
          attempted: net,
          available,
          materialId,
        })
      } else {
        toast.error(errorMsg)
      }
      // Do NOT clear form on error per spec
    } finally {
      setSubmitting(false)
    }
  }, [activeMachine, assignedStock, grossWeight, tareWeight, directNetWeight, materialId, size, workerName, isValid, materialsForProduction, toast, productionDate])

  const openEditHistory = useCallback((row) => {
    setEditingHistoryRow(row)
    setEditHistoryForm({
      machine_id: String(row.machineId || ''),
      material_id: String(row.materialId || ''),
      size: row.size === '—' ? '' : row.size || '',
      worker_name: row.worker === '—' ? '' : row.worker || '',
      gross_weight: toNumber(row.gross).toFixed(2),
      tare_weight: toNumber(row.tare).toFixed(2),
    })
  }, [])

  const handleDeleteHistory = useCallback(async (rowId) => {
    if (!window.confirm('Delete this production entry?')) return

    try {
      await deleteProductionLog(rowId)
      setSelectedHistoryIds((previous) => previous.filter((id) => id !== rowId))
      await refreshHistoryContext()
      toast.success('Production entry deleted')
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to delete production entry')
    }
  }, [refreshHistoryContext, toast])

  const handleBulkDeleteHistory = useCallback(async () => {
    if (selectedHistoryIds.length === 0) return
    if (!window.confirm(`Delete ${selectedHistoryIds.length} selected production entries?`)) return

    try {
      await bulkDeleteProductionLogs(selectedHistoryIds)
      setSelectedHistoryIds([])
      await refreshHistoryContext()
      toast.success('Selected production entries deleted')
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to delete selected entries')
    }
  }, [refreshHistoryContext, selectedHistoryIds, toast])

  const handleSaveHistoryEdit = useCallback(async () => {
    if (!editingHistoryRow) return

    try {
      setSavingHistoryEdit(true)
      await updateProductionLog(editingHistoryRow.id, {
        machine_id: toNumber(editHistoryForm.machine_id),
        material_type_id: toNumber(editHistoryForm.material_id),
        size: editHistoryForm.size || null,
        worker_name: editHistoryForm.worker_name,
        gross_weight: toNumber(editHistoryForm.gross_weight),
        tare_weight: toNumber(editHistoryForm.tare_weight),
      })
      setEditingHistoryRow(null)
      await refreshHistoryContext(toNumber(editHistoryForm.machine_id))
      toast.success('Production entry updated')
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update production entry')
    } finally {
      setSavingHistoryEdit(false)
    }
  }, [editHistoryForm, editingHistoryRow, refreshHistoryContext, toast])

  /* ── Keyboard shortcut ──────────────────────────────────────────────────── */
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && activeMachine && isValid && !submitting) {
        handleSubmit(e)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeMachine, isValid, submitting, handleSubmit])

  /* ── Totals ─────────────────────────────────────────────────────────────── */
  const totalGross = useMemo(() => history.reduce((sum, row) => sum + toNumber(row.gross), 0), [history])
  const totalTare = useMemo(() => history.reduce((sum, row) => sum + toNumber(row.tare), 0), [history])
  const totalNet = useMemo(() => history.reduce((sum, row) => sum + toNumber(row.net), 0), [history])
  const allHistorySelected = history.length > 0 && history.every((row) => selectedHistoryIds.includes(row.id))

  const handleExportHistory = useCallback(() => {
    const rows = history.map((row) => ({
      time: formatTime(row.time),
      machine: row.machine,
      material: row.material,
      size: row.size,
      worker: row.worker,
      gross: toNumber(row.gross).toFixed(2),
      tare: toNumber(row.tare).toFixed(2),
      net: toNumber(row.net).toFixed(2),
    }))
    exportSingleSheet({
      filename: `Production_History_${todayIST()}`,
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
      totalRow: { time: '', machine: '', material: '', size: '', worker: 'TOTAL', gross: totalGross.toFixed(2), tare: totalTare.toFixed(2), net: totalNet.toFixed(2) },
    })
  }, [history, totalGross, totalTare, totalNet])

  const inputClass =
    'w-full rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary transition-colors duration-200 focus:border-accent-gold disabled:cursor-not-allowed disabled:opacity-60'
  const labelClass =
    'mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary/80'

  /* ══════════════════════════════════════════════════════════════════════════ */
  /*  RENDER                                                                  */
  /* ══════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-text-primary">
        <Pictogram name="production" size={20} className="text-accent-gold" />
        Production
      </h1>

      {/* ── Dual Machine Selectors ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Production Machines */}
        <div className="rounded-lg border border-border-default bg-bg-card p-4">
          <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-primary">
            <Pictogram name="machine" size={15} className="text-accent-gold" />
            Production Machines
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {PRODUCTION_MACHINES.map(m => (
              <MachinePill
                key={m.id}
                machine={m}
                isActive={activeMachine?.id === m.id && activeMachine?.type === 'production'}
                onClick={() => selectMachine(m, 'production')}
              />
            ))}
          </div>

          {/* ── Select Material & Production Date (outside machines) ────── */}
          <div className="mt-3 border-t border-border-default pt-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Select Material */}
              <div>
                <label className={labelClass}>
                  <Pictogram name="material" size={13} className="text-text-secondary/70" />
                  Material
                </label>
                <select
                  value={materialId}
                  onChange={e => setMaterialId(e.target.value)}
                  className={inputClass}
                  disabled={loadingMaterials}
                >
                  <option value="">
                    {loadingMaterials
                      ? 'Loading materials...'
                      : materialsForProduction.length > 0
                        ? 'Select material...'
                        : 'No floor stock available'}
                  </option>
                  {materialsForProduction.map((mat, i) => (
                    <option key={mat.id ?? i} value={mat.id}>
                      {mat.material_name} ({toNumber(mat.issued_quantity_kg).toFixed(1)} kg issued)
                    </option>
                  ))}
                </select>
              </div>

              {/* Production Date */}
              <div>
                <label className={labelClass}>
                  <Pictogram name="date" size={13} className="text-text-secondary/70" />
                  Date
                </label>
                <div className="relative flex items-center">
                  <input
                    type="date"
                    value={productionDate}
                    onChange={e => setProductionDate(e.target.value)}
                    max={getTodayDate()}
                    className={`${inputClass} ${isBackdated ? 'pr-24' : ''}`}
                  />
                  {isBackdated && (
                    <button
                      type="button"
                      onClick={() => setProductionDate(getTodayDate())}
                      className="absolute right-10 text-[10px] font-bold uppercase tracking-wider text-orange-400 hover:text-orange-300 transition-colors"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>

            {isBackdated && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-orange-400">
                <Pictogram name="warning" size={13} />
                Logging for {formatDateIST(productionDate)}
              </p>
            )}
          </div>
        </div>

        {/* Cutting Machines */}
        <div className="rounded-lg border border-border-default bg-bg-card p-4">
          <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-primary">
            <Pictogram name="wastage" size={15} className="text-emerald-400" />
            Cutting Machines
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {CUTTING_MACHINES.map(m => (
              <MachinePill
                key={m.id}
                machine={m}
                isActive={activeMachine?.id === m.id && activeMachine?.type === 'cutting'}
                onClick={() => selectMachine(m, 'cutting')}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Active Machine — Full-Width Data Entry ───────────────────────── */}
      {activeMachine && (
        <section className="overflow-hidden rounded-lg border border-border-default bg-bg-card animate-slide-up">
          {/* Header bar */}
          <div className="flex items-center justify-between border-b border-border-default bg-bg-primary/60 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Pictogram
                name={activeMachine.type === 'cutting' ? 'wastage' : 'machine'}
                size={18}
                className={activeMachine.type === 'cutting' ? 'text-emerald-400' : 'text-accent-gold'}
              />
              <h2 className="text-base font-semibold text-text-primary">{activeMachine.label}</h2>
            </div>
            <button
              type="button"
              onClick={deselectMachine}
              className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-red-500/10 hover:text-red-400"
              title="Deselect machine"
            >
              <CloseIcon />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3 p-4">
            {/* Assigned stock table */}
            {assignedStock.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {assignedStock.map(mat => (
                  <span
                    key={`${mat.machine_id}-${mat.material_type_id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-primary/50 px-2.5 py-1 text-xs"
                  >
                    <Pictogram name="material" size={13} className="text-text-secondary/70" />
                    <span className="font-medium text-text-primary">{mat.material_name}</span>
                    <span className="font-mono font-semibold tabular-nums text-accent-gold">
                      {getAssignedAvailableKg(mat).toFixed(1)} kg
                    </span>
                  </span>
                ))}
              </div>
            )}

            {/* Row 1: Size + Worker */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">

              <div>
                <label className={labelClass}>
                  <Pictogram name="order" size={13} className="text-text-secondary/70" />
                  Size
                </label>
                <input
                  type="text"
                  value={size}
                  onChange={e => setSize(e.target.value)}
                  placeholder="e.g. 12mm, 50x70"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>
                  <Pictogram name="person" size={13} className="text-text-secondary/70" />
                  Worker
                </label>
                <input
                  type="text"
                  value={workerName}
                  onChange={e => setWorkerName(e.target.value)}
                  placeholder="Enter worker name..."
                  className={`${inputClass} border-accent-gold/30`}
                />
              </div>
            </div>

            {/* Row 2: Weight inputs — different for production vs cutting */}
            {isCuttingMachine ? (
              /* Cutting machines: single Net Weight input */
              <div>
                <label className={labelClass}>
                  <Pictogram name="weight" size={13} className="text-text-secondary/70" />
                  Net Weight (kg)
                </label>
                <input
                  ref={grossRef}
                  type="number"
                  min="0"
                  step="0.01"
                  value={directNetWeight}
                  onChange={e => setDirectNetWeight(e.target.value)}
                  placeholder="0.00"
                  className={inputClass}
                  disabled={submitting}
                />
                {/* Net Weight Display for cutting */}
                {directNetWeight && (
                  <div className={`
                    mt-2 rounded-lg border p-2 text-center transition-colors
                    ${toNumber(directNetWeight) > 0
                      ? 'bg-emerald-500/10 border-emerald-500/30'
                      : 'bg-bg-primary border-border-subtle'}
                  `}>
                    <p className={`font-mono text-2xl font-bold tabular-nums ${
                      toNumber(directNetWeight) > 0 ? 'text-emerald-400' : 'text-text-secondary/30'
                    }`}>
                      {toNumber(directNetWeight).toFixed(2)} kg
                    </p>
                  </div>
                )}
              </div>
            ) : (
              /* Production machines: Gross + Tare with auto-calc */
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>
                      <Pictogram name="bag" size={13} className="text-text-secondary/70" />
                      Gross (kg)
                    </label>
                    <input
                      ref={grossRef}
                      type="number"
                      min="0"
                      step="0.01"
                      value={grossWeight}
                      onChange={e => setGrossWeight(e.target.value)}
                      placeholder="0.00"
                      className={inputClass}
                      disabled={submitting}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>
                      <Pictogram name="remove" size={13} className="text-text-secondary/70" />
                      Tare (kg)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={tareWeight}
                      onChange={e => setTareWeight(e.target.value)}
                      placeholder="0.00"
                      className={inputClass}
                      disabled={submitting}
                    />
                  </div>
                </div>

                {/* Net Weight Display */}
                <div className={`
                  flex items-center justify-center gap-2 rounded-lg border p-2 transition-colors
                  ${isValid
                    ? 'bg-accent-gold/10 border-accent-gold/30'
                    : isInvalid
                    ? 'bg-red-500/10 border-red-500/30'
                    : 'bg-bg-primary border-border-subtle'}
                `}>
                  <Pictogram
                    name="weight"
                    size={16}
                    className={isValid ? 'text-accent-gold' : isInvalid ? 'text-red-400' : 'text-text-secondary/40'}
                  />
                  <p className={`font-mono text-2xl font-bold tabular-nums ${
                    isValid ? 'text-accent-gold' : isInvalid ? 'text-red-400' : 'text-text-secondary/30'
                  }`}>
                    {netWeight !== null ? `${netWeight.toFixed(2)} kg` : '— kg'}
                  </p>
                </div>
                {isInvalid && (
                  <p className="inline-flex items-center gap-1.5 text-xs text-red-400">
                    <Pictogram name="warning" size={13} />
                    Gross must be more than tare
                  </p>
                )}
              </>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={!isValid || submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent-gold px-4 py-2.5 text-sm font-semibold text-black transition-all duration-200 hover:bg-accent-gold-hover disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.98]"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </span>
              ) : (
                <>
                  <Pictogram name="check" size={16} />
                  {`Add to ${activeMachine.label}`}
                </>
              )}
            </button>
          </form>
        </section>
      )}

      {/* ── Production History Log ───────────────────────────────────────── */}
      <section className="rounded-lg border border-border-default bg-bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-primary">
            <Pictogram name="clock" size={15} className="text-text-secondary" />
            History
            <span className="font-normal normal-case tracking-normal text-text-secondary/60">
              {history.length} {history.length === 1 ? 'entry' : 'entries'}
              {totalNet > 0 && ` \u00b7 ${formatKg(totalNet)}`}
            </span>
          </h2>

          <div className="flex flex-wrap items-center gap-2">
            <div>
              <select
                value={historyMachineFilter}
                onChange={(event) => setHistoryMachineFilter(event.target.value)}
                className="rounded-lg border border-border-default bg-bg-input px-3 py-1.5 text-sm text-text-primary transition-colors focus:border-accent-gold"
              >
                <option value="">All machines</option>
                {PRODUCTION_MACHINES.map((machine) => (
                  <option key={machine.id} value={machine.id.replace(/\D/g, '')}>
                    {machine.label}
                  </option>
                ))}
                {CUTTING_MACHINES.map((machine) => (
                  <option key={machine.id} value={machine.id.replace(/\D/g, '')}>
                    {machine.label}
                  </option>
                ))}
              </select>
            </div>

            {history.length > 0 && (
              <button
                type="button"
                onClick={handleExportHistory}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20"
              >
                <ExcelIcon /> Export
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border-default bg-bg-input/15">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default bg-bg-primary/50">
                {[
                  { label: 'Date', icon: 'date' },
                  { label: 'Time', icon: 'clock' },
                  { label: 'Machine', icon: 'machine' },
                  { label: 'Material', icon: 'material' },
                  { label: 'Size', icon: 'order' },
                  { label: 'Worker', icon: 'person' },
                ].map(col => (
                  <th key={col.label} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-text-secondary/70">
                    <span className="inline-flex items-center gap-1.5">
                      <Pictogram name={col.icon} size={13} className="text-text-secondary/60" />
                      {col.label}
                    </span>
                  </th>
                ))}
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-secondary/70">Gross</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-secondary/70">Tare</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-text-secondary/70">Net (kg)</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center">
                    <div className="flex flex-col items-center gap-2 text-text-secondary/40">
                      <Pictogram name="production" size={28} className="opacity-40" />
                      <p className="text-sm">No entries yet</p>
                    </div>
                  </td>
                </tr>
              ) : (
                history.map((row, idx) => (
                  <tr
                    key={row.id}
                    data-flash-date={String(row.time || '').slice(0, 10)}
                    className={`
                      border-b border-white/[0.08] transition-colors hover:bg-white/[0.04]
                      ${idx === 0 ? 'bg-accent-gold/[0.03]' : idx % 2 === 0 ? '' : 'bg-white/[0.015]'}
                    `}
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 text-text-primary/80">{formatDateIST(row.time)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-text-secondary">{formatTimeIST(row.time)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      <span className={`
                        inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-semibold
                        ${row.machineType === 'cutting'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-accent-gold/10 text-accent-gold border border-accent-gold/20'}
                      `}>
                        {row.machine}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-text-primary/80">{row.material}</td>
                    <td className="px-3 py-1.5 text-text-primary/80">{row.size}</td>
                    <td className="px-3 py-1.5 font-medium text-text-primary/80">{row.worker}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-text-secondary/80">{toNumber(row.gross).toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-text-secondary/60">{toNumber(row.tare).toFixed(2)}</td>
                    <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums text-accent-gold">{toNumber(row.net).toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {history.length > 0 && (
              <tfoot>
                <tr className="border-t border-border-default bg-bg-primary/50">
                  <td colSpan={6} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-secondary/60">
                    Total
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-text-secondary/80">
                    {totalGross.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-text-secondary/60">
                    {totalTare.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-accent-gold">
                    {totalNet.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {stockOverflow && (
        <StockOverflowDialog
          materialName={stockOverflow.materialName}
          attempted={stockOverflow.attempted}
          available={stockOverflow.available}
          loading={topUpLoading}
          onCancel={() => setStockOverflow(null)}
          onTopUp={async (amount) => {
            setTopUpLoading(true)
            try {
              await api.post('/raw-material/add', {
                material_name: stockOverflow.materialName,
                quantity_kg: amount,
              })
              await api.post('/floor/issue-from-raw', {
                material_name: stockOverflow.materialName,
                quantity_kg: amount,
              })
              setStockOverflow(null)
              handleSubmit()
            } catch (err) {
              toast.error(err?.response?.data?.detail || err?.response?.data?.error || 'Failed to add floor stock')
            } finally {
              setTopUpLoading(false)
            }
          }}
        />
      )}
    </div>
  )
}
