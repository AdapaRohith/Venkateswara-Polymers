import { useEffect, useState } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import DataTable from '../components/DataTable'
import { SectionBarChart } from '../components/Charts'
import { useToast } from '../components/Toast'
import api from '../utils/api'

const formatKg = (value) => {
    if (value === null || value === undefined || value === '') return '—'
    const numeric = Number(value)
    if (Number.isNaN(numeric)) return '—'
    return `${numeric.toFixed(2)} kg`
}

const resolveNetWeight = (draft) => {
    if (!draft) return null

    const manualNet = Number(draft.net_weight)
    if (!Number.isNaN(manualNet) && manualNet > 0) {
        return manualNet
    }

    const gross = Number(draft.gross_weight)
    const tare = Number(draft.tare_weight)

    if (!Number.isNaN(gross) && !Number.isNaN(tare)) {
        const computed = gross - tare
        if (computed > 0) {
            return computed
        }
    }

    return null
}

export default function Production() {
    const toast = useToast()

    // =====================================================
    // STATE: Production Entry Form
    // =====================================================
    const [machines, setMachines] = useState([])
    const [inventoryBalances, setInventoryBalances] = useState({})
    const [plantEfficiency, setPlantEfficiency] = useState(null)
    const [plantEfficiencyLoading, setPlantEfficiencyLoading] = useState(true)
    const [workerStockLoading, setWorkerStockLoading] = useState(false)
    const [form, setForm] = useState({
        machine_id: '',
        order_number: '',
        inputs: [{ stock_id: '', quantity: '' }],
        outputs: [],
        worker_id: '',
        created_by: '',
        note: '',
        issuance_id: '',
    })
    const [rollDraft, setRollDraft] = useState({
        machine_id: '',
        gross_weight: '',
        tare_weight: '',
        net_weight: '',
    })
    const [submitting, setSubmitting] = useState(false)
    const [showSuccess, setShowSuccess] = useState(false)
    const [successData, setSuccessData] = useState(null)

    // =====================================================
    // STATE: Production History
    // =====================================================
    const [batches, setBatches] = useState([])
    const [batchesLoading, setBatchesLoading] = useState(true)

    // =====================================================
    // STATE: Machine Analytics
    // =====================================================
    const [analytics, setAnalytics] = useState([])
    const [analyticsLoading, setAnalyticsLoading] = useState(true)

    // =====================================================
    // LOAD DATA
    // =====================================================
    useEffect(() => {
        loadAllData()
    }, [])

    const loadAllData = async () => {
        setAnalyticsLoading(true)
        setPlantEfficiencyLoading(true)
        setBatchesLoading(false)

        try {
            const [machinesRes, machineOutputRes, plantEfficiencyRes] = await Promise.allSettled([
                api.get('/machines'),
                api.get('/analytics/machine-output'),
                api.get('/analytics/plant-efficiency'),
            ])

            if (machinesRes.status === 'fulfilled') {
                setMachines(machinesRes.value.data || [])
            }

            if (machineOutputRes.status === 'fulfilled') {
                const machineOutputData = (machineOutputRes.value.data || []).map((item) => ({
                    ...item,
                    total_input: item.total_input ?? null,
                    total_output: item.total_output ?? null,
                    total_waste: item.total_waste ?? null,
                    efficiency: item.efficiency ?? null,
                }))
                setAnalytics(machineOutputData)
            } else {
                setAnalytics([])
            }

            if (plantEfficiencyRes.status === 'fulfilled') {
                setPlantEfficiency(plantEfficiencyRes.value.data || null)
            } else {
                setPlantEfficiency(null)
            }

            setBatches([])
        } catch (err) {
            console.error('Failed to load data:', err)
            toast.error('Failed to load production data')
        } finally {
            setAnalyticsLoading(false)
            setPlantEfficiencyLoading(false)
            setBatchesLoading(false)
        }
    }

    const loadWorkerStock = async (workerId) => {
        if (!workerId) {
            setInventoryBalances({})
            setForm((prev) => ({
                ...prev,
                issuance_id: '',
                inputs: [{ stock_id: '', quantity: '' }],
            }))
            return
        }

        setWorkerStockLoading(true)

        try {
            const { data } = await api.get(`/worker/stock/${workerId}`)
            const issuanceById = {}

            ;(data || []).forEach((issuance) => {
                issuanceById[issuance.id] = issuance
            })

            setInventoryBalances(issuanceById)

            setForm((prev) => {
                const updatedInputs = prev.inputs.map((input, idx) => {
                    const issuance = issuanceById[input.stock_id]
                    if (!issuance) {
                        return idx === 0 ? { stock_id: '', quantity: '' } : input
                    }
                    return { ...input, quantity: issuance.remaining_kg }
                })

                const currentIssuance = prev.issuance_id || updatedInputs[0]?.stock_id || ''
                const validIssuance = currentIssuance && issuanceById[currentIssuance] ? currentIssuance : ''

                if (!validIssuance && updatedInputs.length > 0) {
                    updatedInputs[0] = { stock_id: '', quantity: '' }
                }

                return {
                    ...prev,
                    issuance_id: validIssuance,
                    inputs: updatedInputs.length > 0 ? updatedInputs : [{ stock_id: '', quantity: '' }],
                }
            })
        } catch (err) {
            console.error('Failed to load worker stock:', err)
            toast.error(err.response?.data?.error || 'Unable to fetch worker stock')
            setInventoryBalances({})
            setForm((prev) => ({
                ...prev,
                issuance_id: '',
                inputs: [{ stock_id: '', quantity: '' }],
            }))
        } finally {
            setWorkerStockLoading(false)
        }
    }

    // =====================================================
    // FORM HANDLERS
    // =====================================================
    const handleFormChange = (e) => {
        const { name, value } = e.target
        if (name === 'machine_id') {
            setForm((prev) => ({
                ...prev,
                machine_id: value,
            }))
            setRollDraft((prev) => ({
                ...prev,
                machine_id: value || prev.machine_id,
            }))
            return
        }

        setForm((prev) => ({ ...prev, [name]: value }))
    }

    const handleInputChange = (index, field, value) => {
        if (field === 'stock_id') {
            const selectedIssuance = inventoryBalances[value]

            setForm((prev) => ({
                ...prev,
                issuance_id: value,
                inputs: prev.inputs.map((item, i) =>
                    i === index
                        ? {
                              ...item,
                              stock_id: value,
                              quantity: selectedIssuance ? selectedIssuance.remaining_kg : '',
                          }
                        : item
                ),
            }))

            return
        }

        setForm((prev) => ({
            ...prev,
            inputs: prev.inputs.map((item, i) =>
                i === index ? { ...item, [field]: value } : item
            ),
        }))
    }

    const addInputRow = () => {
        setForm((prev) => {
            if (prev.inputs.length >= 1) return prev
            return {
                ...prev,
                inputs: [...prev.inputs, { stock_id: '', quantity: '' }],
            }
        })
    }

    const removeInputRow = (index) => {
        setForm((prev) => ({
            ...prev,
            inputs: prev.inputs.filter((_, i) => i !== index),
        }))
    }

    const handleRollDraftChange = (field, value) => {
        setRollDraft((prev) => ({
            ...prev,
            [field]: value,
        }))
    }

    const handleAddRoll = () => {
        const machineId = rollDraft.machine_id || form.machine_id

        if (!machineId) {
            toast.error('Select a machine for this roll')
            return
        }

        const resolvedNet = resolveNetWeight(rollDraft)

        if (resolvedNet === null) {
            toast.error('Provide net weight or enter gross and tare values')
            return
        }

        const normalizedNet = Number(resolvedNet.toFixed(3))

        setForm((prev) => ({
            ...prev,
            outputs: [
                ...prev.outputs,
                {
                    machine_id: machineId,
                    quantity: normalizedNet,
                    gross_weight: rollDraft.gross_weight ? Number(rollDraft.gross_weight) : null,
                    tare_weight: rollDraft.tare_weight ? Number(rollDraft.tare_weight) : null,
                },
            ],
        }))

        setRollDraft({
            machine_id: machineId,
            gross_weight: '',
            tare_weight: '',
            net_weight: '',
        })
    }

    const handleRemoveRoll = (index) => {
        setForm((prev) => ({
            ...prev,
            outputs: prev.outputs.filter((_, i) => i !== index),
        }))
    }

    // =====================================================
    // DERIVED STATE
    // =====================================================
    const selectedIssuanceId = form.issuance_id || (form.inputs[0]?.stock_id ?? '')
    const selectedIssuance = selectedIssuanceId ? inventoryBalances[selectedIssuanceId] : null
    const draftNetWeight = resolveNetWeight(rollDraft)
    const totalOutputKg = form.outputs.reduce((sum, roll) => sum + Number(roll.quantity || 0), 0)
    const hasRollEntries = form.outputs.length > 0
    const canSubmit = Boolean(form.worker_id && selectedIssuanceId && hasRollEntries)

    const getMachineName = (machineId) => {
        const match = machines.find((machine) => Number(machine.id) === Number(machineId))
        return match?.name || `Machine ${machineId}`
    }

    // =====================================================
    // SUBMIT
    // =====================================================
    const handleSubmit = async (e) => {
        e.preventDefault()

        if (!canSubmit) {
            toast.error('Worker, issuance, and roll details are required')
            return
        }

        setSubmitting(true)

        try {
            const rolls = form.outputs
                .filter((roll) => roll.machine_id && roll.quantity)
                .map((roll) => ({
                    machine_id: Number(roll.machine_id),
                    quantity_kg: Number(roll.quantity),
                }))

            const payload = {
                issuance_id: Number(selectedIssuanceId),
                worker_id: form.worker_id,
                order_number: form.order_number || null,
                rolls,
                note: form.note || null,
                created_by: form.created_by || null,
            }

            const { data } = await api.post('/production/log-rolls', payload)

            setSuccessData({
                ...data,
                issuance_id: Number(selectedIssuanceId),
                worker_id: form.worker_id,
            })
            setShowSuccess(true)

            toast.success('Production rolls logged successfully')

            const workerId = form.worker_id
            const createdBy = form.created_by
            const defaultMachineId = form.machine_id

            setForm({
                machine_id: defaultMachineId,
                order_number: '',
                inputs: [{ stock_id: '', quantity: '' }],
                outputs: [],
                worker_id: workerId,
                created_by: createdBy,
                note: '',
                issuance_id: '',
            })

            setRollDraft({
                machine_id: defaultMachineId,
                gross_weight: '',
                tare_weight: '',
                net_weight: '',
            })

            await Promise.all([loadAllData(), loadWorkerStock(workerId)])

            setTimeout(() => {
                setShowSuccess(false)
            }, 4000)
        } catch (err) {
            console.error('Production log failed:', err)
            toast.error(err.response?.data?.error || 'Failed to log production rolls')
        } finally {
            setSubmitting(false)
        }
    }

    // =====================================================
    // TABLE STRUCTURES
    // =====================================================
    const batchesColumns = [
        { key: 'id', label: 'Batch ID' },
        { key: 'machine_name', label: 'Machine' },
        { key: 'order_number', label: 'Order #' },
        { key: 'total_input_kg', label: 'Input (kg)', render: (v) => Number(v).toFixed(2) },
        { key: 'total_output_kg', label: 'Output (kg)', render: (v) => Number(v).toFixed(2) },
        { key: 'total_waste_kg', label: 'Waste (kg)', render: (v) => Number(v).toFixed(2) },
        {
            key: 'created_at',
            label: 'Created At',
            render: (v) => (v ? new Date(v).toLocaleDateString() : '-'),
        },
    ]

    const analyticsColumns = [
        { key: 'name', label: 'Machine' },
        { key: 'total_input', label: 'Total Input (kg)', render: (v) => formatKg(v ?? null) },
        { key: 'total_output', label: 'Total Output (kg)', render: (v) => formatKg(v ?? null) },
        { key: 'total_waste', label: 'Total Waste (kg)', render: (v) => formatKg(v ?? null) },
        {
            key: 'efficiency',
            label: 'Efficiency',
            render: (v) => (v === null || v === undefined ? '—' : `${(Number(v) * 100).toFixed(2)}%`),
        },
        {
            key: 'waste_percentage',
            label: 'Waste %',
            render: (_, row) => {
                const total = Number(row.total_input || 0)
                const waste = Number(row.total_waste || 0)
                const pct = total > 0 ? ((waste / total) * 100).toFixed(2) : '0'
                const bgColor = pct > 10 ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'
                return <span className={`px-2 py-0.5 rounded text-xs font-medium ${bgColor}`}>{pct}%</span>
            },
        },
    ]

    const inputClass =
        'bg-bg-input text-text-primary border border-gray-700 rounded-lg px-3 py-2 text-sm transition-colors focus:border-accent-gold'
    const selectClass = inputClass + ' appearance-none cursor-pointer'

    return (
        <div className="space-y-8">
            {/* =====================================================
            HEADER
            ===================================================== */}
            <div>
                <h2 className="text-3xl font-bold text-text-primary">Manufacturing & Production</h2>
            </div>

            {/* =====================================================
            SUCCESS MODAL
            ===================================================== */}
            {showSuccess && successData && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-6 space-y-4">
                    <h3 className="text-lg font-semibold text-emerald-400">✓ Production batch created successfully</h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                            <p className="text-xs text-text-secondary uppercase">Total Input</p>
                            <p className="text-2xl font-bold text-text-primary">{formatKg(successData.total_input_kg ?? successData.total_output)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-text-secondary uppercase">Total Output</p>
                            <p className="text-2xl font-bold text-emerald-400">{formatKg(successData.total_output ?? successData.total_output_kg)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-text-secondary uppercase">Total Waste</p>
                            <p className="text-2xl font-bold text-amber-400">{formatKg(successData.total_waste_kg)}</p>
                        </div>
                        <div>
                            <p className="text-xs text-text-secondary uppercase">Batch ID</p>
                            <p className="text-2xl font-bold text-text-primary">{successData.batch_id ?? successData.id ?? '—'}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <p className="text-xs text-text-secondary uppercase">Issuance ID</p>
                            <p className="text-base font-medium text-text-primary">{successData.issuance_id ?? '—'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-text-secondary uppercase">Worker</p>
                            <p className="text-base font-medium text-text-primary">{successData.worker_id ?? '—'}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* =====================================================
            SECTION 1: PRODUCTION ENTRY FORM
            ===================================================== */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-xl font-semibold text-text-primary">Production Entry Form</h3>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-border-default bg-bg-card p-6">
                    {/* Machine Selection */}
                    <div className="space-y-3">
                        <label className="block text-sm font-medium text-text-primary">
                            Machine <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                            <select
                                name="machine_id"
                                value={form.machine_id}
                                onChange={handleFormChange}
                                className={selectClass}
                            >
                                <option value="">-- Select Machine --</option>
                                {machines.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.name}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 pointer-events-none text-text-secondary" />
                        </div>
                    </div>

                    {/* Order Number */}
                    <div className="space-y-3">
                        <label className="block text-sm font-medium text-text-primary">Order Number</label>
                        <input
                            type="text"
                            name="order_number"
                            value={form.order_number}
                            onChange={handleFormChange}
                            placeholder="e.g., ORD-001"
                            className={inputClass}
                        />
                    </div>

                    {/* Inputs: Raw Materials */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-text-primary">
                                Raw Materials (Inputs) <span className="text-red-500">*</span>
                            </label>
                            <button
                                type="button"
                                onClick={addInputRow}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-500/10 text-blue-400 rounded text-xs font-medium hover:bg-blue-500/20 transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                                Add Row
                            </button>
                        </div>

                        <div className="space-y-3 bg-bg-input/30 rounded-lg p-4">
                            {form.inputs.map((input, idx) => (
                                <div key={idx} className="flex gap-3 items-end">
                                    <div className="flex-1 space-y-1">
                                        <label className="text-xs text-text-secondary">Stock</label>
                                        <div className="relative">
                                            <select
                                                value={input.stock_id}
                                                onChange={(e) => handleInputChange(idx, 'stock_id', e.target.value)}
                                                className={selectClass}
                                            >
                                                <option value="">-- Select Issuance --</option>
                                                {Object.entries(inventoryBalances).map(([issuanceId, issuance]) => (
                                                    <option key={issuanceId} value={issuanceId}>
                                                        Issuance {issuanceId} • Stock {issuance.stock_id} ({formatKg(issuance.remaining_kg)})
                                                    </option>
                                                ))}
                                            </select>
                                            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 pointer-events-none text-text-secondary" />
                                        </div>
                                    </div>

                                    <div className="flex-1 space-y-1">
                                        <label className="text-xs text-text-secondary">Quantity (kg)</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={input.quantity}
                                            readOnly
                                            placeholder="Auto"
                                            className={`${inputClass} cursor-not-allowed`}
                                        />
                                    </div>

                                    {form.inputs.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => removeInputRow(idx)}
                                            className="p-2 bg-red-500/10 text-red-400 rounded hover:bg-red-500/20 transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Outputs: Finished Rolls */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-text-primary">
                                Finished Rolls <span className="text-red-500">*</span>
                            </label>
                        </div>

                        <div className="space-y-4 bg-bg-input/30 rounded-lg p-4">
                            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                                <div className="md:col-span-2 space-y-1">
                                    <label className="text-xs text-text-secondary">Machine</label>
                                    <div className="relative">
                                        <select
                                            value={rollDraft.machine_id || form.machine_id || ''}
                                            onChange={(e) => handleRollDraftChange('machine_id', e.target.value)}
                                            className={selectClass}
                                        >
                                            <option value="">-- Select Machine --</option>
                                            {machines.map((machine) => (
                                                <option key={machine.id} value={machine.id}>
                                                    {machine.name}
                                                </option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 pointer-events-none text-text-secondary" />
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-xs text-text-secondary">Gross (kg)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={rollDraft.gross_weight}
                                        onChange={(e) => handleRollDraftChange('gross_weight', e.target.value)}
                                        placeholder="0.00"
                                        className={inputClass}
                                    />
                                </div>

                                <div className="space-y-1">
                                    <label className="text-xs text-text-secondary">Tare (kg)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={rollDraft.tare_weight}
                                        onChange={(e) => handleRollDraftChange('tare_weight', e.target.value)}
                                        placeholder="0.00"
                                        className={inputClass}
                                    />
                                </div>

                                <div className="space-y-1">
                                    <label className="text-xs text-text-secondary">Net Weight (kg)</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={rollDraft.net_weight}
                                        onChange={(e) => handleRollDraftChange('net_weight', e.target.value)}
                                        placeholder={draftNetWeight !== null ? draftNetWeight.toFixed(2) : '0.00'}
                                        className={inputClass}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                <p className="text-xs text-text-secondary">
                                    {draftNetWeight !== null
                                        ? `Net to add: ${formatKg(draftNetWeight)}`
                                        : 'Enter net weight or provide gross and tare to auto-calculate'}
                                </p>
                                <button
                                    type="button"
                                    onClick={handleAddRoll}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 rounded text-xs font-medium hover:bg-emerald-500/20 transition-colors"
                                >
                                    <Plus className="w-4 h-4" />
                                    Add Roll
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            {form.outputs.length > 0 ? (
                                <div className="overflow-hidden border border-border-default rounded-lg">
                                    <div className="grid grid-cols-[1fr_auto] md:grid-cols-[2fr_1fr_auto] bg-bg-input/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                                        <span>Machine</span>
                                        <span className="hidden md:block text-right">Net Weight</span>
                                        <span />
                                    </div>
                                    <div className="divide-y divide-border-default/60">
                                        {form.outputs.map((roll, idx) => (
                                            <div key={idx} className="grid grid-cols-[1fr_auto] md:grid-cols-[2fr_1fr_auto] items-center px-4 py-3 text-sm text-text-primary">
                                                <span>{getMachineName(roll.machine_id)}</span>
                                                <span className="hidden md:block text-right">{formatKg(roll.quantity)}</span>
                                                <div className="flex items-center justify-end gap-3">
                                                    <span className="md:hidden text-xs text-text-secondary">{formatKg(roll.quantity)}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveRoll(idx)}
                                                        className="p-2 bg-red-500/10 text-red-400 rounded hover:bg-red-500/20 transition-colors"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-xs text-text-secondary bg-bg-input/20 border border-dashed border-border-default rounded-lg px-4 py-3">
                                    No rolls added yet. Add rolls using the form above.
                                </div>
                            )}
                            <div className="flex justify-end">
                                <span className="text-sm font-semibold text-emerald-400">
                                    Total Output: {formatKg(totalOutputKg)}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Totals & Real-time Validation */}
                    <div className="bg-bg-input/20 rounded-lg p-6 space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <p className="text-xs text-text-secondary uppercase mb-1">Plant Input</p>
                                <p className="text-2xl font-bold text-blue-400">{plantEfficiencyLoading ? 'Loading…' : formatKg(plantEfficiency?.total_input)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-text-secondary uppercase mb-1">Plant Output</p>
                                <p className="text-2xl font-bold text-emerald-400">{plantEfficiencyLoading ? 'Loading…' : formatKg(plantEfficiency?.total_output)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-text-secondary uppercase mb-1">Plant Waste</p>
                                <p className="text-2xl font-bold text-amber-400">{plantEfficiencyLoading ? 'Loading…' : formatKg(plantEfficiency?.total_waste)}</p>
                            </div>
                        </div>

                        {selectedIssuance && (
                            <div className="text-xs text-text-secondary">
                                Issuance {selectedIssuanceId}: Remaining {formatKg(selectedIssuance.remaining_kg)}
                            </div>
                        )}

                        {workerStockLoading && (
                            <div className="text-xs text-text-secondary">Refreshing worker stock…</div>
                        )}
                    </div>

                    {/* Worker & Created By */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                            <label className="block text-sm font-medium text-text-primary">Worker ID</label>
                            <input
                                type="text"
                                name="worker_id"
                                value={form.worker_id}
                                onChange={handleFormChange}
                                onBlur={() => loadWorkerStock(form.worker_id)}
                                placeholder="e.g., W001"
                                className={inputClass}
                            />
                        </div>

                        <div className="space-y-3">
                            <label className="block text-sm font-medium text-text-primary">Created By</label>
                            <input
                                type="text"
                                name="created_by"
                                value={form.created_by}
                                onChange={handleFormChange}
                                placeholder="Your name or ID"
                                className={inputClass}
                            />
                        </div>
                    </div>

                    {/* Notes */}
                    <div className="space-y-3">
                        <label className="block text-sm font-medium text-text-primary">Notes</label>
                        <textarea
                            name="note"
                            value={form.note}
                            onChange={handleFormChange}
                            placeholder="Any additional notes for this batch..."
                            rows={4}
                            className={inputClass}
                        />
                    </div>

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={!canSubmit || submitting}
                        className="w-full bg-accent-gold text-black font-semibold py-3 rounded-lg hover:bg-accent-gold-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {submitting ? 'Logging Rolls…' : 'Log Finished Rolls'}
                    </button>
                </form>
            </div>

            {/* =====================================================
            SECTION 2: PRODUCTION HISTORY TABLE
            ===================================================== */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-xl font-semibold text-text-primary">Production History</h3>
                </div>

                {batchesLoading ? (
                    <div className="text-center py-8 text-text-secondary">Loading production history...</div>
                ) : (
                    <DataTable columns={batchesColumns} data={batches} emptyMessage="No production batches found." />
                )}
            </div>

            {/* =====================================================
            SECTION 3: MACHINE ANALYTICS DASHBOARD
            ===================================================== */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-xl font-semibold text-text-primary">Machine Analytics</h3>
                </div>

                {analyticsLoading ? (
                    <div className="text-center py-8 text-text-secondary">Loading analytics...</div>
                ) : (
                    <>
                        {/* Analytics Table */}
                        <DataTable columns={analyticsColumns} data={analytics} emptyMessage="No machine data available." />

                        {/* Analytics Charts */}
                        {analytics.length > 0 && (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                {/* Efficiency Chart */}
                                <SectionBarChart
                                    data={analytics.map((m) => ({
                                        name: m.name,
                                        value: (m.efficiency * 100).toFixed(2),
                                    }))}
                                    title="Machine Efficiency (%)"
                                    color="#3b82f6"
                                />

                                {/* Waste Percentage Chart */}
                                <SectionBarChart
                                    data={analytics.map((m) => {
                                        const total = Number(m.total_input || 0)
                                        const waste = Number(m.total_waste || 0)
                                        const pct = total > 0 ? ((waste / total) * 100).toFixed(2) : 0
                                        return { name: m.name, value: pct }
                                    })}
                                    title="Waste Percentage (%)"
                                    color="#f59e0b"
                                />
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* =====================================================
            SECTION 4: INVENTORY SUMMARY
            ===================================================== */}
            <div className="space-y-5">
                <div>
                    <h3 className="text-xl font-semibold text-text-primary">Inventory Balances</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.entries(inventoryBalances).length > 0 ? (
                        Object.entries(inventoryBalances).map(([issuanceId, issuance]) => (
                            <div key={issuanceId} className="bg-bg-card rounded-xl border border-border-default p-4">
                                <p className="text-xs text-text-secondary uppercase mb-2">Issuance</p>
                                <p className="text-sm font-medium text-text-primary mb-3">{issuanceId} • Stock {issuance.stock_id}</p>
                                <p className="text-xs text-text-secondary uppercase mb-1">Remaining</p>
                                <p className="text-2xl font-bold text-blue-400">{formatKg(issuance.remaining_kg)}</p>
                            </div>
                        ))
                    ) : (
                        <div className="col-span-full text-center py-8 text-text-secondary">No inventory data available.</div>
                    )}
                </div>
            </div>
        </div>
    )
}
