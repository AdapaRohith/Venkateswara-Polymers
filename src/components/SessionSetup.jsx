import { MAX_SESSION_MATERIALS } from '../utils/productionSession'
import { formatKg } from '../utils/stock'

function EmptyState({ message }) {
  return (
    <div className="rounded-2xl border border-dashed border-border-default bg-bg-input/20 px-4 py-5 text-sm text-text-secondary">
      {message}
    </div>
  )
}

export default function SessionSetup({
  machines,
  materialOptions,
  form,
  validationErrors,
  loading,
  error,
  onFieldChange,
  onMaterialChange,
  onMaterialQuantityChange,
  onAddMaterial,
  onRemoveMaterial,
  onSubmit,
}) {
  const inputClass =
    'w-full rounded-xl border border-border-default bg-bg-input px-4 py-3 text-sm text-text-primary transition-colors focus:border-accent-gold disabled:cursor-not-allowed disabled:opacity-60'

  return (
    <section className="space-y-6 rounded-[28px] border border-border-default bg-bg-card p-6 shadow-lg shadow-black/20 md:p-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent-gold">Session Setup</p>
          <h2 className="mt-3 text-3xl font-semibold text-text-primary">Start a production run.</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary">
            Select one machine, load up to three material sources, and open a single continuous session for the batch.
          </p>
        </div>
        <div className="rounded-2xl border border-accent-gold/20 bg-accent-gold/10 px-4 py-3 text-sm text-accent-gold">
          Max {MAX_SESSION_MATERIALS} materials per session
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">Machine</label>
            <select
              value={form.machineId}
              onChange={(event) => onFieldChange('machineId', event.target.value)}
              className={`${inputClass} cursor-pointer`}
              disabled={loading}
            >
              <option value="">{machines.length > 0 ? 'Select machine' : 'No machines available'}</option>
              {machines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.name}
                </option>
              ))}
            </select>
            {validationErrors.machineId && (
              <p className="text-xs text-red-400">{validationErrors.machineId}</p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">Worker</label>
            <input
              type="text"
              value={form.workerId}
              onChange={(event) => onFieldChange('workerId', event.target.value)}
              className={inputClass}
              placeholder="Enter worker ID or name"
              disabled={loading}
            />
            {validationErrors.workerId && (
              <p className="text-xs text-red-400">{validationErrors.workerId}</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border-default bg-bg-input/30 p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-secondary/60">Available Stock</p>
          <p className="mt-2 text-2xl font-semibold text-text-primary">{materialOptions.length}</p>
          <p className="mt-2 text-sm text-text-secondary">Material batches with remaining balance ready for a session.</p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">Raw Materials</p>
              <p className="mt-1 text-sm text-text-secondary">Choose up to three stock batches and set the quantity to allocate.</p>
            </div>
            <button
              type="button"
              onClick={onAddMaterial}
              disabled={loading || form.materials.length >= MAX_SESSION_MATERIALS}
              className="rounded-full border border-accent-gold/25 bg-accent-gold/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-accent-gold transition-colors hover:bg-accent-gold/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add Material
            </button>
          </div>

          {form.materials.length === 0 && (
            <EmptyState message="Add at least one material source before starting a session." />
          )}

          {form.materials.map((material, index) => {
            const selectedIds = new Set(
              form.materials
                .filter((_, currentIndex) => currentIndex !== index)
                .map((item) => String(item.stockId))
                .filter(Boolean),
            )

            const selectedOption = materialOptions.find(
              (option) => String(option.id) === String(material.stockId),
            )

            return (
              <div key={`setup_material_${index}`} className="rounded-2xl border border-border-default bg-bg-input/30 p-4">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_96px] lg:items-end">
                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">
                      Material {index + 1}
                    </label>
                    <select
                      value={material.stockId}
                      onChange={(event) => onMaterialChange(index, event.target.value)}
                      className={`${inputClass} cursor-pointer`}
                      disabled={loading}
                    >
                      <option value="">
                        {materialOptions.length > 0 ? 'Select material batch' : 'No material stock available'}
                      </option>
                      {materialOptions
                        .filter((option) => !selectedIds.has(String(option.id)))
                        .map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label} | {formatKg(option.availableToIssue)}
                          </option>
                        ))}
                    </select>
                    <p className="text-xs text-text-secondary">
                      {selectedOption
                        ? `Available to allocate: ${formatKg(selectedOption.availableToIssue)}`
                        : 'Select a stock batch with remaining balance.'}
                    </p>
                    {validationErrors[`material_${index}_stockId`] && (
                      <p className="text-xs text-red-400">{validationErrors[`material_${index}_stockId`]}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-[0.18em] text-text-secondary/70">Quantity (kg)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={material.quantity}
                      onChange={(event) => onMaterialQuantityChange(index, event.target.value)}
                      className={inputClass}
                      placeholder="0.00"
                      disabled={loading}
                    />
                    {validationErrors[`material_${index}_quantity`] && (
                      <p className="text-xs text-red-400">{validationErrors[`material_${index}_quantity`]}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onRemoveMaterial(index)}
                    disabled={loading || form.materials.length === 1}
                    className="h-[50px] rounded-xl border border-border-default px-4 text-sm font-medium text-text-secondary transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-2xl bg-accent-gold px-5 py-4 text-sm font-semibold text-black transition-colors hover:bg-accent-gold-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Starting Session...' : 'Start Session'}
        </button>
      </form>
    </section>
  )
}
