import api from './api'

export const MAX_SESSION_MATERIALS = 3

function toNumber(value, fallback = 0) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : fallback
}

function getMachineName(machine, machineLookup = new Map()) {
  const directName =
    machine?.machine_name ??
    machine?.machineName ??
    machine?.name ??
    machine?.machine?.name

  if (directName) return directName

  const machineId = machine?.machine_id ?? machine?.machineId ?? machine?.id
  if (machineId !== undefined && machineId !== null && machineLookup.has(String(machineId))) {
    return machineLookup.get(String(machineId))
  }

  return machineId ? `Machine ${machineId}` : 'Unassigned'
}

function normalizeMaterial(material = {}) {
  const initialQuantity = toNumber(
    material.initial_quantity ??
      material.initialQuantity ??
      material.quantity ??
      material.allocated_quantity ??
      material.allocatedQuantity,
  )

  const remainingQuantity = toNumber(
    material.remaining_quantity ??
      material.remainingQuantity ??
      material.remaining ??
      material.balance ??
      material.available_quantity ??
      material.availableQuantity,
    initialQuantity,
  )

  const stockId = material.stock_id ?? material.stockId ?? material.id ?? material.material_id ?? material.materialId
  const label =
    material.material_name ??
    material.materialName ??
    material.stock_label ??
    material.stockLabel ??
    material.label ??
    (stockId ? `Stock ${stockId}` : 'Material')

  return {
    id: material.id ?? stockId ?? `${label}_${initialQuantity}`,
    stockId,
    label,
    initialQuantity,
    remainingQuantity,
    usedQuantity: Math.max(initialQuantity - remainingQuantity, 0),
  }
}

function normalizeLog(log = {}, index = 0) {
  const grossWeight = toNumber(log.gross_weight ?? log.grossWeight)
  const tareWeight = toNumber(log.tare_weight ?? log.tareWeight)
  const netWeight = toNumber(log.net_weight ?? log.netWeight, Math.max(grossWeight - tareWeight, 0))
  const timestamp = log.logged_at ?? log.created_at ?? log.timestamp ?? log.time ?? ''

  return {
    id: log.id ?? log.log_id ?? `${timestamp}_${index}`,
    grossWeight,
    tareWeight,
    netWeight,
    timestamp,
  }
}

export function deriveProductionSessionState(payload, machines = []) {
  const machineLookup = new Map(
    (Array.isArray(machines) ? machines : []).map((machine) => [
      String(machine.id ?? machine.machine_id ?? machine.machineId),
      machine.name ?? machine.machine_name ?? machine.machineName ?? `Machine ${machine.id}`,
    ]),
  )

  const root = payload?.data ?? payload ?? {}
  const sessionRoot = root.session ?? root.production_session ?? root
  const machineId = sessionRoot.machine_id ?? sessionRoot.machineId ?? sessionRoot.machine?.id ?? null
  const materialsRaw = root.materials ?? sessionRoot.materials ?? sessionRoot.session_materials ?? []
  const logsRaw = root.session_logs ?? sessionRoot.session_logs ?? sessionRoot.logs ?? root.logs ?? []
  const materials = (Array.isArray(materialsRaw) ? materialsRaw : []).map(normalizeMaterial)
  const logs = (Array.isArray(logsRaw) ? logsRaw : []).map(normalizeLog)
  const totalOutput =
    toNumber(root.total_output ?? sessionRoot.total_output ?? sessionRoot.totalOutput) ||
    logs.reduce((sum, log) => sum + log.netWeight, 0)

  return {
    session: {
      id: sessionRoot.id ?? sessionRoot.session_id ?? root.session_id ?? null,
      machineId,
      machineName: getMachineName(sessionRoot, machineLookup),
      workerId:
        sessionRoot.worker_id ??
        sessionRoot.workerId ??
        root.worker_id ??
        root.workerId ??
        null,
      workerName:
        sessionRoot.worker_name ??
        sessionRoot.workerName ??
        root.worker_name ??
        root.workerName ??
        '',
      startedAt:
        sessionRoot.started_at ??
        sessionRoot.start_time ??
        sessionRoot.created_at ??
        sessionRoot.startedAt ??
        '',
      status: sessionRoot.status ?? 'active',
    },
    materials,
    logs,
    totalOutput,
  }
}

function parseMachines(data) {
  const items = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []

  return items.map((item, index) => ({
    ...item,
    id: item.id ?? item.machine_id ?? item.machineId ?? `machine_${index}`,
    name:
      item.name ??
      item.machine_name ??
      item.machineName ??
      item.code ??
      item.machine_code ??
      item.machineCode ??
      `Machine ${item.id ?? index + 1}`,
  }))
}

export async function fetchMachines() {
  const { data } = await api.get('/machines')
  return parseMachines(data)
}

export async function startProductionSession(payload, machines = []) {
  const { data } = await api.post('/production/start', payload)
  const sessionId = data?.session_id ?? data?.id ?? data?.session?.id ?? data?.production_session?.id

  if (!sessionId) {
    return deriveProductionSessionState(data, machines)
  }

  return getProductionSession(sessionId, machines)
}

export async function getProductionSession(sessionId, machines = []) {
  const { data } = await api.get(`/production/${encodeURIComponent(sessionId)}`)
  return deriveProductionSessionState(data, machines)
}

export async function logProductionEntry(payload, machines = []) {
  const { data } = await api.post('/production/log', payload)
  const sessionId = payload?.session_id ?? data?.session_id ?? data?.session?.id

  if (!sessionId) {
    return deriveProductionSessionState(data, machines)
  }

  return getProductionSession(sessionId, machines)
}

export async function endProductionSession(sessionId) {
  const { data } = await api.post('/production/end', { session_id: sessionId })

  return {
    totalOutput: toNumber(data?.total_output ?? data?.totalOutput),
    totalWaste: toNumber(data?.total_waste ?? data?.totalWaste),
    raw: data,
  }
}
export async function findActiveProductionSession(machines = []) {
  try {
    const { data } = await api.get('/production/active')

    if (!data) {
      return null
    }

    const sessionId =
      data.id ??
      data.session_id ??
      data.session?.id ??
      data.production_session?.id ??
      null

    if (!sessionId) {
      return deriveProductionSessionState(data, machines)
    }

    return await getProductionSession(sessionId, machines)
  } catch (error) {
    if (error?.response?.status === 404) {
      return null
    }

    throw error
  }
}
