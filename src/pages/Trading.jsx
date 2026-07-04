import { useMemo, useState, useEffect } from 'react'
import DataTable from '../components/DataTable'
import InputWithCamera from '../components/InputWithCamera'
import { SectionBarChart } from '../components/Charts'
import { useToast } from '../components/Toast'
import usePersistentState from '../hooks/usePersistentState'
import { exportSingleSheet } from '../utils/exportToExcel'
import api from '../utils/api'
import { getOrders } from '../utils/orders'

const ExcelIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
  </svg>
)

const getTodayDate = () => new Date().toISOString().split('T')[0]

const columns = [
    { key: 'sno', label: 'S.No' },
    { key: 'date', label: 'Date', render: (v) => v ? new Date(v).toISOString().split('T')[0] : '' },
    { key: 'order_number', label: 'Order' },
    { key: 'material_name', label: 'Material' },
    { key: 'netWeight', label: 'Net Weight', render: (v) => Number(v).toFixed(2) },
    {
        key: 'type', label: 'Type', render: (v) => (
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${v === 'Buy' ? 'bg-accent-gold/15 text-accent-gold' : 'bg-emerald-500/15 text-emerald-400'}`}>
                {v}
            </span>
        )
    },
]

export default function Trading() {
    const toast = useToast()
    const [data, setData] = useState([])
    const [materials, setMaterials] = useState([])
    const [ordersList, setOrdersList] = useState([])
    const [loading, setLoading] = useState(true)

    const initialFormState = {
        id: null,
        date: getTodayDate(),
        order_number: '',
        material_name: '',
        netWeight: '',
        type: 'Buy',
    }
    
    const [form, setForm] = usePersistentState('vp_trading_form_v2', initialFormState)
    const [submitting, setSubmitting] = useState(false)

    const fetchData = async () => {
        try {
            setLoading(true)
            const [tradingRes, matRes, ordRes] = await Promise.all([
                api.get('/trading'),
                api.get('/materials'),
                getOrders()
            ])
            setData(tradingRes.data || [])
            setMaterials(matRes.data || [])
            setOrdersList(ordRes || [])
        } catch (err) {
            toast.error('Failed to load trading data')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [])

    const handleExport = () => {
        const rows = data.map((d, idx) => ({
            sno: idx + 1,
            date: d.date ? new Date(d.date).toISOString().split('T')[0] : '',
            order_number: d.order_number,
            material_name: d.material_name,
            netWeight: Number(d.netWeight || d.net_weight).toFixed(2),
            type: d.type,
        }))
        exportSingleSheet({
            filename: `Trading_${new Date().toISOString().slice(0, 10)}`,
            rows,
            columns: [
                { key: 'sno', label: 'S.No' },
                { key: 'date', label: 'Date' },
                { key: 'order_number', label: 'Order' },
                { key: 'material_name', label: 'Material' },
                { key: 'netWeight', label: 'Net Weight' },
                { key: 'type', label: 'Type' },
            ],
        })
        toast.success('Trading data exported to Excel')
    }

    const hasOrders = ordersList.length > 0
    const orderSelectPlaceholder = hasOrders ? 'Select order...' : 'No orders available'

    const handleChange = (e) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
    }

    const handleSubmit = async (e) => {
        e.preventDefault()

        let orderNum = form.order_number

        if (!form.date || !form.material_name) {
            toast.error('Please select date and material')
            return
        }

        const net = form.netWeight === '' ? 0 : parseFloat(form.netWeight)

        setSubmitting(true)

        const payload = {
            date: form.date,
            material_name: form.material_name,
            net_weight: net,
            type: form.type,
        }
        if (orderNum) payload.order_number = orderNum

        try {
            if (form.id) {
                await api.put(`/trading/${form.id}`, payload)
                toast.success('Trading entry updated')
            } else {
                await api.post('/trading', payload)
                toast.success('Trading entry added')
            }
            await fetchData()
            setForm(initialFormState)
        } catch (err) {
            toast.error('Failed to save trading entry')
        } finally {
            setSubmitting(false)
        }
    }

    const handleEdit = (item) => {
        setForm({
            id: item.id,
            date: item.date ? new Date(item.date).toISOString().split('T')[0] : getTodayDate(),
            order_number: item.order_number,
            material_name: item.material_name,
            netWeight: item.netWeight || item.net_weight,
            type: item.type,
        })
        window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    const handleDelete = async (id) => {
        if (!window.confirm('Are you sure you want to delete this entry?')) return
        try {
            await api.delete(`/trading/${id}`)
            toast.success('Entry deleted')
            await fetchData()
        } catch (err) {
            toast.error('Failed to delete entry')
        }
    }

    const cancelEdit = () => {
        setForm(initialFormState)
    }

    const inputClass =
        'w-full bg-bg-input text-text-primary border border-gray-700 rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/30'

    // ── Summary calculations ──
    const today = new Date().toISOString().split('T')[0]
    const mappedData = data.map((d, idx) => ({
        ...d,
        sno: idx + 1,
        netWeight: d.netWeight || d.net_weight,
        dateStr: d.date ? new Date(d.date).toISOString().split('T')[0] : ''
    }))
    const todayEntries = mappedData.filter((d) => d.dateStr === today)
    const todayCount = todayEntries.length

    // Chart: daily net weight breakdown
    const chartData = useMemo(() => {
        const map = {}
        mappedData.forEach((d) => {
            if (!d.dateStr) return;
            if (!map[d.dateStr]) map[d.dateStr] = 0
            map[d.dateStr] += parseFloat(d.netWeight)
        })
        return Object.entries(map)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, value]) => ({ name: date, value }))
    }, [mappedData])

    if (loading && data.length === 0) {
        return <div className="flex h-[50vh] items-center justify-center text-text-secondary">Loading Trading data...</div>
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-semibold text-text-primary tracking-tight">Trading</h2>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="relative overflow-hidden rounded-xl border border-border-default bg-bg-card p-5 shadow-lg shadow-black/30">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Total Entries</p>
                    <p className="text-3xl font-semibold text-text-primary">{mappedData.length}</p>
                </div>
                <div className="relative overflow-hidden rounded-xl border border-border-default bg-bg-card p-5 shadow-lg shadow-black/30">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-violet-500/80 via-violet-500/40 to-transparent" />
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70 mb-1">Today's Entries</p>
                    <p className="text-3xl font-semibold text-text-primary">{todayCount}</p>
                </div>
            </div>

            {/* Chart */}
            {chartData.length > 0 && (
                <SectionBarChart data={chartData} title="Daily Trading Volume" color="#34d399" />
            )}

            {/* Form */}
            <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-5">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">{form.id ? 'Edit Trading Entry' : 'Add Trading Entry'}</h3>
                    {form.id && (
                        <button type="button" onClick={cancelEdit} className="text-xs text-text-secondary hover:text-white transition-colors">
                            Cancel Edit
                        </button>
                    )}
                </div>
                <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Date</label>
                        <InputWithCamera type="date" name="date" value={form.date} onChange={handleChange} required />
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Order <span className="text-text-secondary/40 normal-case">(optional)</span></label>
                        <select name="order_number" value={form.order_number} onChange={handleChange} className={`${inputClass} appearance-none cursor-pointer`}>
                            <option value="">{orderSelectPlaceholder}</option>
                            {ordersList.map((o) => (
                                <option key={o.order_number} value={o.order_number}>{o.order_number} {o.client_name ? `(${o.client_name})` : ''}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Material Name</label>
                        <select name="material_name" value={form.material_name} onChange={handleChange} className={`${inputClass} appearance-none cursor-pointer`} required>
                            <option value="">Select material...</option>
                            {materials.map((m) => (
                                <option key={m.id || m.name} value={m.name}>{m.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Type</label>
                        <select name="type" value={form.type} onChange={handleChange} className={`${inputClass} appearance-none cursor-pointer`}>
                            <option value="Buy">Buy (from supplier)</option>
                            <option value="Sell">Sell (to customer)</option>
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-text-secondary tracking-wide uppercase">Net Weight <span className="text-text-secondary/40 normal-case">(optional)</span></label>
                        <InputWithCamera type="number" name="netWeight" value={form.netWeight} onChange={handleChange} step="0.01" placeholder="0.00" />
                    </div>

                    <div className="flex items-end">
                        <button type="submit" disabled={submitting} className="w-full bg-accent-gold text-black font-semibold py-2.5 rounded-lg text-sm transition-all duration-200 hover:bg-accent-gold-hover active:scale-[0.98] disabled:opacity-50">
                            {submitting ? 'Saving...' : form.id ? 'Update Entry' : 'Add Entry'}
                        </button>
                    </div>
                </form>
            </div>

            <DataTable 
               title="Trading History"
               columns={columns} 
               data={mappedData} 
               emptyMessage="No trading entries yet." 
               onDelete={handleDelete} 
               onEdit={handleEdit}
               rightAction={
                   <button
                       type="button"
                       onClick={handleExport}
                       disabled={data.length === 0}
                       className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                   >
                       <ExcelIcon /> Export Excel
                   </button>
               }
            />
        </div>
    )
}
