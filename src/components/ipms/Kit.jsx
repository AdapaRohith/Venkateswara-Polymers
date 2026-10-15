import { useEffect, useId, useState } from 'react'
import { ArrowDown, ArrowUp, Clock, Moon, Sun } from 'lucide-react'

import useStockMeta from '../../hooks/useStockMeta'
import { formatBags, formatWeight, kgToBags, toKg } from '../../utils/units'
import { inputBase, inputClass, labelClass } from './styles'
import {
  LOCATIONS, SHIFT_LABELS, TONE_CLASSES, calendarDayFor, formatBusinessDate, liveShiftContext, nowIST,
  shiftForTime, shiftWindows,
} from '../../utils/ipms'


export function PageHeader({ icon: Icon, title, subtitle, actions }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-text-primary">
          {Icon && <Icon className="h-5 w-5 text-accent-gold" aria-hidden="true" />}
          {title}
        </h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Panel({ title, subtitle, actions, children, className = '', bodyClassName = 'p-4' }) {
  return (
    <section className={`min-w-0 rounded-xl border border-border-default bg-bg-card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-text-primary">{title}</h2>}
            {subtitle && <p className="text-xs text-text-secondary">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

export function Weight({ kg, signed = false, bags = false, className = '' }) {
  const value = Number(kg || 0)
  const tone = signed ? (value > 0 ? 'text-emerald-600 dark:text-emerald-400' : value < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-text-secondary') : ''
  return (
    <span className={`tabular-nums ${tone} ${className}`} title={`${value.toLocaleString('en-IN', { maximumFractionDigits: 3 })} kg · ${formatBags(value)}`}>
      {formatWeight(value, { signed })}
      {bags && <span className="ml-1 text-[11px] font-normal text-text-secondary">({formatBags(value)})</span>}
    </span>
  )
}

const TILE_BARS = {
  sky: 'bg-sky-500', emerald: 'bg-emerald-500', violet: 'bg-violet-500',
  amber: 'bg-amber-500', slate: 'bg-slate-500', rose: 'bg-rose-500',
}

export function StatTile({ label, kg, hint, tone = 'emerald', icon: Icon, onClick, active = false }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`relative overflow-hidden rounded-xl border bg-bg-card p-4 text-left transition ${
        active ? 'border-accent-gold ring-2 ring-accent-gold/20' : 'border-border-default'
      } ${onClick ? 'cursor-pointer hover:border-accent-gold/60' : ''}`}
    >
      <div className={`absolute inset-y-0 left-0 w-1 ${TILE_BARS[tone] || 'bg-accent-gold'}`} />
      <div className="flex items-start justify-between gap-2 pl-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-text-secondary" aria-hidden="true" />}
      </div>
      <p className="mt-1 pl-1 text-2xl font-bold tracking-tight text-text-primary">
        <Weight kg={kg} />
      </p>
      <p className="pl-1 text-xs text-text-secondary">{hint ?? formatBags(kg)}</p>
    </Tag>
  )
}

export function LocationBadge({ location, label }) {
  const info = LOCATIONS[location] || { label: location, tone: 'slate' }
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASSES[info.tone]}`}>
      {label || info.label}
    </span>
  )
}

export function ShiftBadge({ shift }) {
  if (!shift) return <span className="text-xs text-text-secondary">—</span>
  const am = shift === 'AM'
  const Icon = am ? Sun : Moon
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold ${am ? TONE_CLASSES.amber : TONE_CLASSES.violet}`}
      title={SHIFT_LABELS[shift]}>
      <Icon className="h-3 w-3" aria-hidden="true" />{shift}
    </span>
  )
}

export function StatusBadge({ status }) {
  const tone = status === 'RETURNED' ? 'rose' : status === 'REVERSED' ? 'slate' : 'emerald'
  const label = { RETURNED: 'Returned', REVERSED: 'Reversed', ACTIVE: 'Active', IN_STOCK: 'In stock' }[status] || status
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${TONE_CLASSES[tone]}`}>{label}</span>
}

/**
 * When an entry happened: business date, AM/PM shift and clock time.
 *
 * The operator usually keys in yesterday's morning and night shifts the next
 * day, so every part is editable. A blank `time` means "default": the live
 * clock for the shift running now, otherwise the shift's standard time
 * (09:00 AM / 21:00 PM). Typing a time moves the shift to match it; picking a
 * shift or date resets the time to that default.
 */
export function ShiftDatePicker({ date, shift, time = '', onChange, disabled = false, compact = false }) {
  const dateId = useId()
  const timeId = useId()
  const meta = useStockMeta()
  const windows = shiftWindows(meta)
  const [live, setLive] = useState(() => liveShiftContext(windows))
  useEffect(() => {
    const tick = () => setLive(liveShiftContext(windows))
    tick()
    const id = setInterval(tick, 20_000)
    return () => clearInterval(id)
  }, [windows.amStart, windows.pmStart]) // eslint-disable-line react-hooks/exhaustive-deps

  const isLiveSlot = date === live.date && shift === live.shift
  const shownTime = time || (isLiveSlot ? live.time : windows.defaults[shift] || '')
  const calendarDay = calendarDayFor(date, shownTime, windows)
  const today = nowIST()
  const isFuture = !!date && `${calendarDay}T${shownTime}` > `${today.date}T${today.time}`
  const emit = (patch) => onChange({ date, shift, time, ...patch })

  return (
    <div className={compact ? 'flex flex-wrap items-end gap-2' : 'space-y-1'}>
      <div>
        {!compact && <label htmlFor={dateId} className={labelClass}>Date, shift &amp; time of entry</label>}
        <div className="flex flex-wrap items-center gap-2">
          <input id={dateId} type="date" value={date || ''} max={live.date} disabled={disabled}
            onChange={(e) => e.target.value && emit({ date: e.target.value, time: '' })}
            className={`${inputBase} w-auto`} aria-label="Business date" />
          <div role="radiogroup" aria-label="Shift" className="inline-flex overflow-hidden rounded-lg border border-border-default">
            {['AM', 'PM'].map((s) => {
              const Icon = s === 'AM' ? Sun : Moon
              const active = shift === s
              return (
                <button key={s} type="button" role="radio" aria-checked={active} disabled={disabled}
                  onClick={() => emit({ shift: s, time: '' })}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition ${
                    active
                      ? s === 'AM' ? 'bg-amber-500 text-black' : 'bg-violet-600 text-white'
                      : 'bg-bg-input text-text-secondary hover:text-text-primary'
                  }`}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {s} <span className="hidden font-medium sm:inline">{s === 'AM' ? 'Morning' : 'Night'}</span>
                </button>
              )
            })}
          </div>
          <div className="inline-flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-text-secondary" aria-hidden="true" />
            <input id={timeId} type="time" value={shownTime} disabled={disabled} aria-label="Time of entry"
              onChange={(e) => {
                const t = e.target.value
                if (!t) return emit({ time: '' })
                emit({ time: t, shift: shiftForTime(t, windows) })
              }}
              className={`${inputBase} w-auto ${isFuture ? 'border-rose-500' : ''}`} />
            {time && (
              <button type="button" disabled={disabled} onClick={() => emit({ time: '' })}
                className="text-xs font-semibold text-accent-gold hover:underline">
                {isLiveSlot ? 'Now' : 'Default'}
              </button>
            )}
          </div>
          {!(date === live.date && shift === live.shift && !time) && (
            <button type="button" disabled={disabled} onClick={() => onChange({ date: live.date, shift: live.shift, time: '' })}
              className="text-xs font-semibold text-text-secondary hover:text-accent-gold hover:underline">
              Back to now
            </button>
          )}
        </div>
      </div>
      {!compact && (
        <p className={`text-xs ${isFuture ? 'text-rose-500' : 'text-text-secondary'}`}>
          {isFuture
            ? `${formatBusinessDate(calendarDay)} ${shownTime} is in the future — pick an earlier time.`
            : isLiveSlot && !time
              ? 'Live shift — the current time is recorded.'
              : <>
                  Filing for <strong className="text-text-primary">{formatBusinessDate(date)}</strong> · {SHIFT_LABELS[shift] || ''} shift ·
                  saved at <strong className="text-text-primary">{shownTime}</strong>
                  {calendarDay !== date && ` on ${formatBusinessDate(calendarDay, { weekday: false })} (after midnight)`}
                  {!time && !isLiveSlot && ' (default time)'}
                </>}
        </p>
      )}
    </div>
  )
}

/** Quantity typed in kg or bags (1 bag = 25 kg); always reports kilograms. */
export function QuantityInput({ value, unit, onChange, label = 'Quantity', available, disabled = false, id }) {
  const autoId = useId()
  const inputId = id || autoId
  const kg = toKg(value, unit)
  const over = available !== undefined && available !== null && kg !== null && kg > Number(available) + 1e-9
  return (
    <div>
      <label htmlFor={inputId} className={labelClass}>{label}</label>
      <div className="flex">
        <input id={inputId} type="number" min="0" step="any" inputMode="decimal" value={value} disabled={disabled}
          onChange={(e) => onChange({ value: e.target.value, unit })}
          className={`${inputClass} rounded-r-none ${over ? 'border-rose-500' : ''}`} placeholder="0" />
        <div className="inline-flex shrink-0 overflow-hidden rounded-r-lg border border-l-0 border-border-default">
          {['kg', 'bags'].map((u) => (
            <button key={u} type="button" disabled={disabled}
              onClick={() => {
                // Keep the same physical quantity when switching units.
                const current = toKg(value, unit)
                const next = current === null ? value
                  : u === 'bags' ? String(Math.round(kgToBags(current) * 1000) / 1000) : String(current)
                onChange({ value: next, unit: u })
              }}
              className={`px-3 text-xs font-bold ${unit === u ? 'bg-accent-gold text-white dark:text-black' : 'bg-bg-input text-text-secondary hover:text-text-primary'}`}>
              {u}
            </button>
          ))}
        </div>
      </div>
      <p className={`mt-1 text-xs ${over ? 'text-rose-500' : 'text-text-secondary'}`}>
        {kg === null
          ? '1 bag = 25 kg'
          : `= ${formatWeight(kg)} · ${formatBags(kg)}`}
        {available !== undefined && available !== null && (
          <> · available <strong>{formatWeight(available)}</strong></>
        )}
      </p>
    </div>
  )
}

export function FlowCell({ inKg, outKg }) {
  const inflow = Number(inKg || 0)
  const outflow = Number(outKg || 0)
  if (!inflow && !outflow) return <span className="text-xs text-text-secondary/60">—</span>
  return (
    <span className="inline-flex flex-col items-end gap-0.5 text-xs">
      {inflow > 0 && <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"><ArrowUp className="h-3 w-3" />{formatWeight(inflow)}</span>}
      {outflow > 0 && <span className="inline-flex items-center gap-0.5 text-rose-600 dark:text-rose-400"><ArrowDown className="h-3 w-3" />{formatWeight(outflow)}</span>}
    </span>
  )
}

export function EmptyState({ children }) {
  return <div className="rounded-lg border border-dashed border-border-default px-4 py-10 text-center text-sm text-text-secondary">{children}</div>
}

export function PrimaryButton({ children, className = '', ...props }) {
  return (
    <button type="button" {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-accent-gold px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-gold-hover disabled:cursor-not-allowed disabled:opacity-50 dark:text-black ${className}`}>
      {children}
    </button>
  )
}

export function SecondaryButton({ children, className = '', ...props }) {
  return (
    <button type="button" {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border border-border-default bg-bg-card px-3 py-2 text-sm font-semibold text-text-primary transition hover:border-accent-gold/60 hover:text-accent-gold disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>
      {children}
    </button>
  )
}

/** Compact AM/PM toggle for existing entry forms. '' means "decide from the clock". */
export function ShiftToggle({ value, onChange, disabled = false }) {
  return (
    <div className="space-y-1.5">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-secondary">Shift</span>
      <div role="radiogroup" aria-label="Shift" className="flex overflow-hidden rounded-lg border border-border-default">
        {[['', 'Auto'], ['AM', 'AM · Morning'], ['PM', 'PM · Night']].map(([id, label]) => (
          <button key={id || 'auto'} type="button" role="radio" aria-checked={value === id} disabled={disabled}
            onClick={() => onChange(id)}
            className={`flex-1 px-2 py-2 text-xs font-bold transition ${
              value === id
                ? id === 'AM' ? 'bg-amber-500 text-black' : id === 'PM' ? 'bg-violet-600 text-white' : 'bg-accent-gold text-white dark:text-black'
                : 'bg-bg-input text-text-secondary hover:text-text-primary'
            }`}>
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
