import { useMemo, useState } from 'react'
import { useToast } from '../components/Toast'
import usePersistentState from '../hooks/usePersistentState'

const STORAGE_KEY = 'vp_production_tracker_entries'
const MACHINES = ['Machine 1', 'Machine 2', 'Machine 3', 'Machine 4', 'Machine 5']

const getTodayDate = () => new Date().toISOString().split('T')[0]

const createInitialForm = (user) => ({
  workerName: user?.name || '',
  machine: MACHINES[0],
  productionQuantity: '',
  wasteGenerated: '',
  date: getTodayDate(),
})

const numberFormatter = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2,
})

const formatNumber = (value) => numberFormatter.format(Number(value || 0))

const buildPrintableTable = (rows) => {
  const bodyRows = rows.length
    ? rows.map((entry, index) => `
        <tr class="${entry.isHighest ? 'highlight' : ''}">
          <td>${index + 1}</td>
          <td>${entry.date}</td>
          <td>${entry.workerName}</td>
          <td>${entry.machine}</td>
          <td>${formatNumber(entry.productionQuantity)}</td>
          <td>${formatNumber(entry.wasteGenerated)}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="6">No production entries for the selected filters.</td></tr>'

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Production Log History</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 24px;
            color: #0f172a;
          }
          h1 {
            margin: 0 0 8px;
            font-size: 24px;
          }
          p {
            margin: 0 0 20px;
            color: #475569;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          th, td {
            border: 1px solid #cbd5e1;
            padding: 10px 12px;
            text-align: left;
            font-size: 13px;
          }
          th {
            background: #e2e8f0;
          }
          .highlight td {
            background: #dcfce7;
          }
        </style>
      </head>
      <body>
        <h1>Production Log History</h1>
        <p>Printed on ${new Date().toLocaleString('en-IN')}</p>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Date</th>
              <th>Worker Name</th>
              <th>Machine</th>
              <th>Production Quantity</th>
              <th>Waste Generated</th>
            </tr>
          </thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </body>
    </html>
  `
}

export default function ProductionTracker({ user }) {
  const toast = useToast()
  const [entries, setEntries] = usePersistentState(STORAGE_KEY, [])
  const [form, setForm] = useState(() => createInitialForm(user))
  const [filters, setFilters] = useState({
    date: '',
    machine: '',
    workerName: '',
  })

  const filteredEntries = useMemo(() => {
    const normalizedWorkerFilter = filters.workerName.trim().toLowerCase()

    const rows = entries.filter((entry) => {
      if (filters.date && entry.date !== filters.date) return false
      if (filters.machine && entry.machine !== filters.machine) return false
      if (normalizedWorkerFilter && !entry.workerName.toLowerCase().includes(normalizedWorkerFilter)) return false
      return true
    })

    const highestProduction = rows.reduce((max, entry) => Math.max(max, Number(entry.productionQuantity) || 0), 0)

    return rows
      .slice()
      .sort((left, right) => new Date(right.date) - new Date(left.date) || right.createdAt - left.createdAt)
      .map((entry) => ({
        ...entry,
        isHighest: rows.length > 0 && Number(entry.productionQuantity) === highestProduction && highestProduction > 0,
      }))
  }, [entries, filters.date, filters.machine, filters.workerName])

  const totalProduction = filteredEntries.reduce((sum, entry) => sum + Number(entry.productionQuantity || 0), 0)
  const totalWaste = filteredEntries.reduce((sum, entry) => sum + Number(entry.wasteGenerated || 0), 0)

  const handleFormChange = (event) => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  const handleFilterChange = (event) => {
    const { name, value } = event.target
    setFilters((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = (event) => {
    event.preventDefault()

    if (!form.workerName.trim() || !form.machine || !form.date) {
      toast.error('Please complete all required fields')
      return
    }

    const productionQuantity = Number(form.productionQuantity)
    const wasteGenerated = Number(form.wasteGenerated)

    if (!Number.isFinite(productionQuantity) || productionQuantity <= 0) {
      toast.error('Production quantity must be greater than zero')
      return
    }

    if (!Number.isFinite(wasteGenerated) || wasteGenerated < 0) {
      toast.error('Waste generated cannot be negative')
      return
    }

    const newEntry = {
      id: Date.now(),
      workerName: form.workerName.trim(),
      machine: form.machine,
      productionQuantity,
      wasteGenerated,
      date: form.date,
      createdAt: Date.now(),
    }

    setEntries((prev) => [newEntry, ...prev])
    setForm((prev) => ({
      ...createInitialForm(user),
      workerName: prev.workerName.trim() ? prev.workerName.trim() : user?.name || '',
    }))
    toast.success('Production entry stored')
  }

  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=900,height=700')

    if (!printWindow) {
      toast.error('Enable pop-ups to print the table')
      return
    }

    printWindow.document.write(buildPrintableTable(filteredEntries))
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
    printWindow.close()
  }

  const inputClass =
    'w-full bg-bg-input text-text-primary border border-border-default rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/40'

  return (
    <div className="space-y-8">
      <div className="rounded-3xl border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-gold">Production Tracker</p>
        <h1 className="mt-3 text-3xl font-semibold text-text-primary">Track worker output machine by machine.</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-text-secondary">
          Add a daily production entry, review the log history below, filter the results, and print only the table when needed.
        </p>
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-text-primary">Add Production Entry</h2>
            <p className="mt-2 text-sm text-text-secondary">One row represents one worker on one machine for one date.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Worker Name</label>
              <input
                type="text"
                name="workerName"
                value={form.workerName}
                onChange={handleFormChange}
                className={inputClass}
                placeholder="Enter worker name"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Machine</label>
              <select
                name="machine"
                value={form.machine}
                onChange={handleFormChange}
                className={`${inputClass} cursor-pointer`}
                required
              >
                {MACHINES.map((machine) => (
                  <option key={machine} value={machine}>
                    {machine}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Production Quantity</label>
              <input
                type="number"
                min="0"
                step="0.01"
                name="productionQuantity"
                value={form.productionQuantity}
                onChange={handleFormChange}
                className={inputClass}
                placeholder="0.00"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Waste Generated</label>
              <input
                type="number"
                min="0"
                step="0.01"
                name="wasteGenerated"
                value={form.wasteGenerated}
                onChange={handleFormChange}
                className={inputClass}
                placeholder="0.00"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Date</label>
              <input
                type="date"
                name="date"
                value={form.date}
                onChange={handleFormChange}
                className={inputClass}
                required
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-accent-gold px-4 py-3 text-sm font-semibold text-black transition-colors hover:bg-accent-gold-hover"
            >
              Submit
            </button>
          </form>
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Production Log History</h2>
                <p className="mt-2 text-sm text-text-secondary">Filter by date, machine, or worker name to narrow the table.</p>
              </div>
              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center justify-center rounded-lg border border-border-default px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:border-accent-gold hover:text-accent-gold"
              >
                Print Table
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Filter by Date</label>
                <input
                  type="date"
                  name="date"
                  value={filters.date}
                  onChange={handleFilterChange}
                  className={inputClass}
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Filter by Machine</label>
                <select
                  name="machine"
                  value={filters.machine}
                  onChange={handleFilterChange}
                  className={`${inputClass} cursor-pointer`}
                >
                  <option value="">All Machines</option>
                  {MACHINES.map((machine) => (
                    <option key={machine} value={machine}>
                      {machine}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">Filter by Worker Name</label>
                <input
                  type="text"
                  name="workerName"
                  value={filters.workerName}
                  onChange={handleFilterChange}
                  className={inputClass}
                  placeholder="Search worker"
                />
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border-default bg-bg-card shadow-lg shadow-black/20">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border-default">
                <thead className="bg-bg-input/70">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary">Worker Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary">Machine</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary">Production Quantity</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-secondary">Waste Generated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-default">
                  {filteredEntries.length > 0 ? (
                    filteredEntries.map((entry) => (
                      <tr
                        key={entry.id}
                        className={entry.isHighest ? 'bg-emerald-500/10' : 'bg-transparent'}
                      >
                        <td className="px-4 py-3 text-sm text-text-primary">{entry.date}</td>
                        <td className="px-4 py-3 text-sm text-text-primary">{entry.workerName}</td>
                        <td className="px-4 py-3 text-sm text-text-primary">{entry.machine}</td>
                        <td className="px-4 py-3 text-sm font-medium text-text-primary">{formatNumber(entry.productionQuantity)}</td>
                        <td className="px-4 py-3 text-sm text-text-primary">{formatNumber(entry.wasteGenerated)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5" className="px-4 py-8 text-center text-sm text-text-secondary">
                        No production entries found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 border-t border-border-default bg-bg-input/40 px-4 py-4 md:grid-cols-2">
              <div className="rounded-xl border border-border-default bg-bg-card px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Total Production</p>
                <p className="mt-2 text-2xl font-semibold text-text-primary">{formatNumber(totalProduction)}</p>
              </div>
              <div className="rounded-xl border border-border-default bg-bg-card px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">Total Waste</p>
                <p className="mt-2 text-2xl font-semibold text-text-primary">{formatNumber(totalWaste)}</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
