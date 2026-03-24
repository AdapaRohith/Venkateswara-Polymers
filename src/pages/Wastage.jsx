import { useMemo, useState } from 'react'
import DataTable from '../components/DataTable'
import InputWithCamera from '../components/InputWithCamera'
import { WastageAreaChart } from '../components/Charts'
import { useToast } from '../components/Toast'
import usePersistentState from '../hooks/usePersistentState'
import api from '../utils/api'
import { buildStockBatches, formatKg } from '../utils/stock'
import {
    createInventoryTransaction,
    deleteInventoryTransaction,
    ensureInventoryBalance,
    INVENTORY_NOTE_CATEGORIES,
    INVENTORY_TRANSACTION_TYPES,
    makeInventoryTransaction,
} from '../utils/inventory'

const getTodayDate = () => new Date().toISOString().split('T')[0]

const historyColumns = [
    { key: 'sno', label: 'S.No' },
    { key: 'date', label: 'Date' },
    { key: 'order_number', label: 'Order' },
    { key: 'grossWeight', label: 'Gross Weight', render: (value) => Number(value).toFixed(2) },
    { key: 'netWeight', label: 'Net Weight', render: (value) => Number(value).toFixed(2) },
    { key: 'actualWeight', label: 'Actual Weight', render: (value) => Number(value).toFixed(2) },
]

export default function Wastage({
    rawMaterials,
    manufacturingData,
    wastageData = [],
    ordersList = [],
    stockUsage = [],
    stockIssuances = [],
    stockBalances = {},
    refreshInventoryData,
    refreshOrders,
}) {
    const toast = useToast()
    const [form, setForm] = usePersistentState('vp_wastage_form', {
        order_number: '',
        newOrder: '',
        newClient: '',
        gross_weight: '',
        net_weight: '',
        fromStockId: '',
    })
    const [submitting, setSubmitting] = useState(false)
    const [showNewOrder, setShowNewOrder] = usePersistentState('vp_wastage_show_new_order', false)

    const totalRawIn = rawMaterials.reduce((sum, item) => sum + (item.quantityInKg || 0), 0)
    const totalMfgOutput = manufacturingData.reduce((sum, item) => sum + (item.netWeight || 0), 0)
    const totalMfgInput = manufacturingData.reduce((sum, item) => sum + (item.materialUsed || item.netWeight || 0), 0)
    const autoWastage = Math.max(0, totalMfgInput - totalMfgOutput)

    const perOrderData = useMemo(() => {
        const orderMap = {}

        manufacturingData.forEach((entry) => {
            const orderNumber = entry.order_number || 'Unknown'
            if (!orderMap[orderNumber]) {
                orderMap[orderNumber] = { order: orderNumber, materialUsed: 0, output: 0, rolls: 0 }
            }

            orderMap[orderNumber].materialUsed += entry.materialUsed || entry.netWeight || 0
            orderMap[orderNumber].output += entry.netWeight || 0
            orderMap[orderNumber].rolls += 1
        })

        return Object.values(orderMap).map((row) => ({
            ...row,
            wastage: Math.max(0, row.materialUsed - row.output),
            wastagePercent: row.materialUsed > 0 ? Math.max(0, ((row.materialUsed - row.output) / row.materialUsed) * 100) : 0,
        }))
    }, [manufacturingData])

    const chartData = useMemo(
        () => [
            { name: 'Raw Material In', value: totalRawIn },
            { name: 'Mfg Output', value: totalMfgOutput },
            { name: 'Process Wastage', value: autoWastage },
        ],
        [autoWastage, totalMfgOutput, totalRawIn],
    )

    const stockBatches = useMemo(
        () => buildStockBatches(rawMaterials, stockUsage, stockIssuances, stockBalances),
        [rawMaterials, stockBalances, stockIssuances, stockUsage],
    )

    const availableBatches = stockBatches.filter((batch) => batch.availableToIssue > 0)
    const hasOrders = ordersList.length > 0
    const hasAvailableBatches = availableBatches.length > 0
    const orderSelectPlaceholder = hasOrders ? 'Select order...' : 'No orders available'
    const orderHelperText = hasOrders
        ? 'Choose an existing order, or switch to "New order".'
        : 'No orders are available yet. Use "New order" to create one first.'
    const batchSelectPlaceholder = hasAvailableBatches ? 'Select stock batch...' : 'No stock batches available'
    const batchHelperText = hasAvailableBatches
        ? 'Pick the stock batch that this wastage should be deducted from.'
        : 'No stock batches have free balance right now. Add raw material or free up stock first.'

    const handleChange = (event) => {
        const { name, value } = event.target
        setForm((previous) => ({ ...previous, [name]: value }))
    }

    const handleSubmit = async (event) => {
        event.preventDefault()

        let orderNumber = form.order_number
        if (showNewOrder) {
            if (!form.newOrder.trim() || !form.newClient.trim()) {
                toast.error('Please fill order number and client name')
                return
            }

            orderNumber = form.newOrder.trim()
            const alreadyExists = ordersList.some((order) => order.order_number === orderNumber)
            if (!alreadyExists) {
                try {
                    await api.post('/orders', {
                        order_number: orderNumber,
                        client_name: form.newClient.trim(),
                    })
                    await refreshOrders?.()
                } catch (error) {
                    toast.error(error.response?.data?.error || 'Failed to create order')
                    return
                }
            }
            toast.success(`Order "${orderNumber}" created`)
        }

        const gross = parseFloat(form.gross_weight)
        const net = parseFloat(form.net_weight)
        if (!orderNumber || Number.isNaN(gross) || Number.isNaN(net)) {
            toast.error('Fill all required fields')
            return
        }
        if (gross < net) {
            toast.error('Gross weight must be greater than or equal to net weight')
            return
        }

        const actualWeight = gross - net
        let sourceBatch = null

        if (form.fromStockId) {
            sourceBatch = stockBatches.find((batch) => String(batch.id) === String(form.fromStockId))
            if (!sourceBatch) {
                toast.error('Selected stock batch not found')
                return
            }
            if (actualWeight > sourceBatch.availableToIssue) {
                toast.error(`Cannot use ${formatKg(actualWeight)}. Only ${formatKg(sourceBatch.availableToIssue)} remains in this stock.`)
                return
            }
        }

        if (!sourceBatch) {
            toast.error('Select a stock batch before logging wastage')
            return
        }

        setSubmitting(true)

        if (sourceBatch) {
            try {
                const { ok, balance } = await ensureInventoryBalance(api, sourceBatch.id, actualWeight)
                if (!ok) {
                    toast.error(`Only ${formatKg(balance)} is currently available for this stock`)
                    setSubmitting(false)
                    return
                }
            } catch (error) {
                console.error('Failed to validate stock balance', error)
                toast.error('Unable to verify stock balance right now')
                setSubmitting(false)
                return
            }
        }

        try {
            await createInventoryTransaction(
                api,
                makeInventoryTransaction({
                    stockId: sourceBatch?.id,
                    transactionType: INVENTORY_TRANSACTION_TYPES.WASTAGE,
                    direction: 'OUT',
                    quantityInKg: actualWeight,
                    metadata: {
                        category: INVENTORY_NOTE_CATEGORIES.WASTAGE,
                        date: getTodayDate(),
                        order_number: orderNumber,
                        grossWeight: gross,
                        netWeight: net,
                        actualWeight,
                        quantityUsed: actualWeight,
                        quantityUnit: 'kg',
                        source: 'Wastage',
                        fromStockLabel: sourceBatch?.label || '',
                        beforeBalance: sourceBatch?.physicalRemaining ?? null,
                        afterBalance: sourceBatch ? sourceBatch.physicalRemaining - actualWeight : null,
                        logMessage: `${formatKg(actualWeight)} wasted (${orderNumber}) from stock (${sourceBatch?.label || 'Unknown'})`,
                    },
                }),
            )

            await refreshInventoryData?.()
        } catch (error) {
            console.error('Failed to save wastage transaction', error)
            toast.error(error.response?.data?.error || 'Failed to save wastage entry')
            setSubmitting(false)
            return
        }

        toast.success('Waste entry added')
        setForm((previous) => ({
            ...previous,
            gross_weight: '',
            net_weight: '',
            newOrder: '',
            newClient: '',
            fromStockId: '',
        }))
        setShowNewOrder(false)
        setSubmitting(false)
    }

    const handleDelete = async (id) => {
        const entry = wastageData.find((item) => item.id === id)
        const transactionId = entry?.transactionId || entry?.id
        if (!transactionId) return

        try {
            await deleteInventoryTransaction(api, transactionId)
            await refreshInventoryData?.()
            toast.success('Waste entry deleted')
        } catch (error) {
            console.error('Failed to delete wastage entry', error)
            toast.error('Failed to delete wastage entry')
        }
    }

    const inputClass =
        'w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30'

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Wastage</h2>
                <p className="text-sm text-text-secondary mt-1">Per-order wastage breakdown and waste roll logging</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500/80 via-blue-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Raw Material In</p>
                    <p className="text-3xl font-semibold text-blue-400">{formatKg(totalRawIn)}</p>
                    <p className="text-xs text-text-secondary/50 mt-1">total received</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Material Used</p>
                    <p className="text-3xl font-semibold text-accent-gold">{formatKg(totalMfgInput)}</p>
                    <p className="text-xs text-text-secondary/50 mt-1">consumed in mfg</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-emerald-500/80 via-emerald-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Mfg Output</p>
                    <p className="text-3xl font-semibold text-emerald-400">{formatKg(totalMfgOutput)}</p>
                    <p className="text-xs text-text-secondary/50 mt-1">net weight produced</p>
                </div>
                <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-red-500/80 via-red-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Process Wastage</p>
                    <p className="text-3xl font-semibold text-red-400">{formatKg(autoWastage)}</p>
                    <p className="text-xs text-text-secondary/50 mt-1">
                        {totalMfgInput > 0 ? `${((autoWastage / totalMfgInput) * 100).toFixed(1)}% of material` : 'no data'}
                    </p>
                </div>
            </div>

            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
                <div className="px-6 pt-6 pb-4">
                    <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">Per-Order Wastage Breakdown</h3>
                    <p className="text-xs text-text-secondary/40 mt-1">Material used vs manufacturing output per order</p>
                </div>
                {perOrderData.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-t border-b border-border-default bg-bg-input/40">
                                    <th className="text-left px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-wider uppercase">Order</th>
                                    <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-wider uppercase">Rolls</th>
                                    <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-wider uppercase">Material Used</th>
                                    <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-wider uppercase">Output</th>
                                    <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-wider uppercase">Wastage</th>
                                    <th className="text-right px-6 py-3 text-xs font-medium text-text-secondary/70 tracking-wider uppercase">Wastage %</th>
                                </tr>
                            </thead>
                            <tbody>
                                {perOrderData.map((row) => (
                                    <tr key={row.order} className="border-b border-border-default/50 hover:bg-bg-input/20 transition-colors">
                                        <td className="px-6 py-3 text-text-primary font-medium">{row.order}</td>
                                        <td className="text-right px-6 py-3 text-text-secondary">{row.rolls}</td>
                                        <td className="text-right px-6 py-3 text-accent-gold">{row.materialUsed.toFixed(2)} kg</td>
                                        <td className="text-right px-6 py-3 text-emerald-400">{row.output.toFixed(2)} kg</td>
                                        <td className="text-right px-6 py-3 text-red-400 font-semibold">{row.wastage.toFixed(2)} kg</td>
                                        <td className="text-right px-6 py-3">
                                            <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                                                row.wastagePercent > 10 ? 'bg-red-500/20 text-red-400' :
                                                row.wastagePercent > 5 ? 'bg-amber-500/20 text-amber-400' :
                                                'bg-emerald-500/20 text-emerald-400'
                                            }`}>
                                                {row.wastagePercent.toFixed(1)}%
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-border-default bg-bg-input/30">
                                    <td className="px-6 py-3 text-text-primary font-semibold">Total</td>
                                    <td className="text-right px-6 py-3 text-text-primary font-semibold">{perOrderData.reduce((sum, row) => sum + row.rolls, 0)}</td>
                                    <td className="text-right px-6 py-3 text-accent-gold font-semibold">{totalMfgInput.toFixed(2)} kg</td>
                                    <td className="text-right px-6 py-3 text-emerald-400 font-semibold">{totalMfgOutput.toFixed(2)} kg</td>
                                    <td className="text-right px-6 py-3 text-red-400 font-bold">{autoWastage.toFixed(2)} kg</td>
                                    <td className="text-right px-6 py-3">
                                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${
                                            totalMfgInput > 0 && ((autoWastage / totalMfgInput) * 100) > 10 ? 'bg-red-500/20 text-red-400' :
                                            'bg-amber-500/20 text-amber-400'
                                        }`}>
                                            {totalMfgInput > 0 ? ((autoWastage / totalMfgInput) * 100).toFixed(1) : '0.0'}%
                                        </span>
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                ) : (
                    <div className="px-6 pb-6">
                        <p className="text-sm text-text-secondary/50 italic">No manufacturing data yet. Add manufacturing entries with material used to see per-order wastage.</p>
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6">
                    <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">
                        Log Waste Roll
                    </h3>
                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Order</label>
                                <button type="button" onClick={() => setShowNewOrder(!showNewOrder)} className="text-[10px] text-accent-gold hover:underline">
                                    {showNewOrder ? 'Select existing' : '+ New order'}
                                </button>
                            </div>
                            {showNewOrder ? (
                                <div className="space-y-2">
                                    <InputWithCamera type="text" name="newOrder" value={form.newOrder} onChange={handleChange} placeholder="Order number" />
                                    <InputWithCamera type="text" name="newClient" value={form.newClient} onChange={handleChange} placeholder="Client name" />
                                </div>
                            ) : (
                                <select name="order_number" value={form.order_number} onChange={handleChange} className={`${inputClass} appearance-none cursor-pointer`} required={!showNewOrder}>
                                    <option value="">{orderSelectPlaceholder}</option>
                                    {ordersList.map((order) => (
                                        <option key={order.order_number} value={order.order_number}>{order.order_number}</option>
                                    ))}
                                </select>
                            )}
                            {!showNewOrder && (
                                <p className="text-[11px] text-text-secondary/60">{orderHelperText}</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">From Stock Batch</label>
                            <select
                                name="fromStockId"
                                value={form.fromStockId}
                                onChange={handleChange}
                                className={`${inputClass} cursor-pointer`}
                                required
                            >
                                <option value="">{batchSelectPlaceholder}</option>
                                {availableBatches.map((batch) => (
                                    <option key={batch.id} value={batch.id}>
                                        {batch.label} - {formatKg(batch.availableToIssue)} remaining
                                    </option>
                                ))}
                            </select>
                            <p className="text-[11px] text-text-secondary/60">{batchHelperText}</p>
                            {form.fromStockId && (
                                <p className="text-[10px] text-emerald-400/70">Stock will be auto-deducted on submit</p>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Gross Weight</label>
                                <InputWithCamera type="number" name="gross_weight" value={form.gross_weight} onChange={handleChange} step="0.01" placeholder="0.00" required />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Net Weight</label>
                                <InputWithCamera type="number" name="net_weight" value={form.net_weight} onChange={handleChange} step="0.01" placeholder="0.00" required />
                            </div>
                        </div>

                        {form.gross_weight && form.net_weight && (
                            <div className="bg-bg-input border border-border-default rounded-lg px-4 py-2.5 text-sm">
                                <span className="text-text-secondary">Actual Weight: </span>
                                <span className="text-red-400 font-semibold">
                                    {Math.max(0, parseFloat(form.gross_weight) - parseFloat(form.net_weight)).toFixed(2)}
                                </span>
                            </div>
                        )}

                        <button type="submit" disabled={submitting} className="w-full bg-red-500/80 text-white font-semibold py-2.5 rounded-lg text-sm transition-all duration-200 hover:bg-red-500 active:scale-[0.98] disabled:opacity-50">
                            {submitting ? 'Logging...' : 'Log Waste Entry'}
                        </button>
                    </form>
                </div>

                <WastageAreaChart data={chartData} />
            </div>

            <DataTable columns={historyColumns} data={wastageData} emptyMessage="No wastage entries logged yet." onDelete={handleDelete} />
        </div>
    )
}
