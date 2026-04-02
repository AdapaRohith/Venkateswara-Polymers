export default function EditEntryModal({
  open,
  title,
  fields,
  values,
  onChange,
  onClose,
  onSubmit,
  submitting = false,
}) {
  if (!open) return null

  const inputClass =
    'w-full rounded-lg border border-border-default bg-bg-input px-4 py-2.5 text-sm text-text-primary transition-colors focus:border-accent-gold'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border-default bg-bg-card p-6 shadow-2xl">
        <div className="mb-5">
          <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSubmit?.()
          }}
          className="space-y-4"
        >
          {fields.map((field) => (
            <div key={field.name} className="space-y-2">
              <label className="block text-xs font-medium uppercase tracking-wide text-text-secondary">
                {field.label}
              </label>

              {field.type === 'select' ? (
                <select
                  value={values[field.name] ?? ''}
                  onChange={(event) => onChange(field.name, event.target.value)}
                  className={inputClass}
                  required={field.required}
                  disabled={submitting}
                >
                  {(field.options || []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  value={values[field.name] ?? ''}
                  onChange={(event) => onChange(field.name, event.target.value)}
                  className={`${inputClass} min-h-24 resize-y`}
                  placeholder={field.placeholder}
                  required={field.required}
                  disabled={submitting}
                />
              ) : (
                <input
                  type={field.type || 'text'}
                  value={values[field.name] ?? ''}
                  onChange={(event) => onChange(field.name, event.target.value)}
                  className={inputClass}
                  placeholder={field.placeholder}
                  step={field.step}
                  min={field.min}
                  required={field.required}
                  disabled={submitting}
                />
              )}
            </div>
          ))}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-lg border border-border-default px-4 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:bg-white/[0.03] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-accent-gold px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-accent-gold-hover disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
