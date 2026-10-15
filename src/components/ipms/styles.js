// Shared form styles for the stock screens.

export const inputBase =
  'rounded-lg border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary ' +
  'focus:border-accent-gold focus:outline-none focus:ring-2 focus:ring-accent-gold/20 disabled:opacity-50'

export const inputClass = `w-full ${inputBase}`
/** Same look, sized by its own width class instead of filling the row. */
export const inputInline = inputBase

export const labelClass = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-text-secondary'
