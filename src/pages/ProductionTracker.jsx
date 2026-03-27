import { useState } from 'react'
import { useToast } from '../components/Toast'

const MACHINES = ['Machine 1', 'Machine 2', 'Machine 3', 'Machine 4', 'Machine 5']

const getTodayDate = () => new Date().toISOString().split('T')[0]

const createInitialForm = (user) => ({
  workerName: user?.name || '',
  machine: MACHINES[0],
  productionQuantity: '',
  wasteGenerated: '',
  date: getTodayDate(),
})

export default function ProductionTracker({ user, setProductionTrackerEntries }) {
  const toast = useToast()
  const [form, setForm] = useState(() => createInitialForm(user))

  const handleFormChange = (event) => {
    const { name, value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
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

    setProductionTrackerEntries((prev) => [newEntry, ...prev])
    setForm((prev) => ({
      ...createInitialForm(user),
      workerName: prev.workerName.trim() ? prev.workerName.trim() : user?.name || '',
    }))
    toast.success('Production entry stored')
  }

  const inputClass =
    'w-full bg-bg-input text-text-primary border border-border-default rounded-lg px-4 py-2.5 text-sm transition-colors duration-200 focus:border-accent-gold placeholder:text-text-secondary/40'

  return (
    <div className="space-y-8">
      <div className="rounded-3xl border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-gold">Production Tracker</p>
        <h1 className="mt-3 text-3xl font-semibold text-text-primary">Track worker output machine by machine.</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-text-secondary">
          Add a daily production entry here. The log history is now available on the owner's log page.
        </p>
      </div>

      <div className="max-w-xl mx-auto xl:mx-0">
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
      </div>
    </div>
  )
}
