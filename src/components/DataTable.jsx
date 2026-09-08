import Pictogram from './Pictogram'
import { formatDayHeading } from '../utils/datetime'

/**
 * `groupByDate` names the row field holding the timestamp. Rows are then broken
 * into day sections under a heading, which is what makes a long log readable at
 * a glance instead of one undifferentiated wall of rows.
 */
function groupRowsByDay(data, field) {
    if (!field) return [{ key: 'all', heading: null, rows: data }]
    const groups = []
    let current = null
    for (const row of data) {
        const heading = formatDayHeading(row[field])
        if (!current || current.heading !== heading) {
            current = { key: `${heading}-${groups.length}`, heading, rows: [] }
            groups.push(current)
        }
        current.rows.push(row)
    }
    return groups
}

export default function DataTable({
    columns,
    data,
    emptyMessage = 'No entries yet.',
    onDelete,
    onEdit,
    title,
    titleIcon,
    rightAction,
    selectedIds = [],
    onSelectedIdsChange,
    isRowSelectable,
    groupByDate,
}) {
    const selectable = typeof onSelectedIdsChange === 'function'
    const rowIsSelectable = (row) => (typeof isRowSelectable === 'function' ? isRowSelectable(row) : true)
    const selectableRows = data.filter((row) => rowIsSelectable(row))
    const allSelected = selectableRows.length > 0 && selectableRows.every((row) => selectedIds.includes(row.id))
    const groups = groupRowsByDay(data, groupByDate)
    const columnSpan = columns.length + (selectable ? 1 : 0) + ((onDelete || onEdit) ? 1 : 0)

    const toggleAll = () => {
        if (!selectable) return
        onSelectedIdsChange(allSelected ? [] : selectableRows.map((row) => row.id))
    }

    const toggleOne = (rowId) => {
        if (!selectable) return
        onSelectedIdsChange(
            selectedIds.includes(rowId)
                ? selectedIds.filter((id) => id !== rowId)
                : [...selectedIds, rowId]
        )
    }

    return (
        <div className="bg-bg-card rounded-lg border border-border-default overflow-hidden">
            {(title || rightAction) && (
                <div className="px-3 py-2 flex items-center justify-between border-b border-border-default bg-bg-primary/60">
                    {title ? (
                        <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase text-text-secondary">
                            {titleIcon && <Pictogram name={titleIcon} size={14} />}
                            {title}
                        </h3>
                    ) : <div />}
                    {rightAction && <div>{rightAction}</div>}
                </div>
            )}

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border-default bg-bg-primary/40">
                            {selectable && (
                                <th className="px-2 py-2 w-10">
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={toggleAll}
                                        className="h-4 w-4 accent-accent-gold cursor-pointer"
                                        aria-label="Select all rows"
                                    />
                                </th>
                            )}
                            {columns.map((col) => (
                                <th
                                    key={col.key}
                                    className="text-left px-3 py-2 text-[11px] font-semibold tracking-wide uppercase text-text-secondary whitespace-nowrap"
                                >
                                    <span className="inline-flex items-center gap-1.5">
                                        {col.icon && <Pictogram name={col.icon} size={13} className="text-text-secondary/60" />}
                                        {col.label}
                                    </span>
                                </th>
                            ))}
                            {(onDelete || onEdit) && (
                                <th className="text-left px-3 py-2 text-[11px] font-semibold tracking-wide uppercase text-text-secondary w-20">
                                    Actions
                                </th>
                            )}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                        {data.length === 0 ? (
                            <tr>
                                <td colSpan={columnSpan} className="text-center py-8 text-text-secondary/60 text-sm">
                                    <div className="flex flex-col items-center gap-2">
                                        <svg className="w-8 h-8 text-text-secondary/30" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                                        </svg>
                                        <span>{emptyMessage}</span>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            groups.flatMap((group, gi) => [
                                ...(group.heading ? [(
                                    <tr key={`head-${group.key}`} className="bg-bg-primary/70">
                                        <td colSpan={columnSpan} className="px-3 py-1.5">
                                            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                                                <Pictogram name="date" size={13} />
                                                {group.heading}
                                                <span className="font-normal normal-case text-text-secondary/50">
                                                    &middot; {group.rows.length} {group.rows.length === 1 ? 'entry' : 'entries'}
                                                </span>
                                            </span>
                                        </td>
                                    </tr>
                                )] : []),
                                ...group.rows.map((row, ri) => {
                                    const idx = gi + ri
                                    return (
                                <tr
                                    key={row.id || `${group.key}-${ri}`}
                                    style={{
                                        backgroundColor: idx % 2 !== 0 ? 'var(--bg-row-alt)' : 'transparent',
                                    }}
                                    className="transition-colors duration-100 cursor-default"
                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-row-hover)' }}
                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = idx % 2 !== 0 ? 'var(--bg-row-alt)' : 'transparent' }}
                                >
                                    {selectable && (
                                        <td className="px-2 py-1.5 align-middle">
                                            {rowIsSelectable(row) ? (
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.includes(row.id)}
                                                    onChange={() => toggleOne(row.id)}
                                                    className="h-4 w-4 accent-accent-gold cursor-pointer"
                                                    aria-label={`Select row ${row.id}`}
                                                />
                                            ) : null}
                                        </td>
                                    )}
                                    {columns.map((col) => (
                                        <td key={col.key} className="px-3 py-1.5 text-text-primary font-normal text-sm whitespace-nowrap">
                                            {col.render ? col.render(row[col.key], row) : row[col.key]}
                                        </td>
                                    ))}
                                    {(onDelete || onEdit) && (
                                        <td className="px-3 py-1.5">
                                            <div className="flex items-center gap-1">
                                                {onEdit && (
                                                    <button
                                                        onClick={() => onEdit(row)}
                                                        className="inline-flex items-center p-1.5 text-text-secondary/60 hover:text-accent-gold transition-colors rounded hover:bg-accent-gold-muted"
                                                        title="Edit entry"
                                                        aria-label="Edit entry"
                                                    >
                                                        <Pictogram name="edit" size={15} />
                                                    </button>
                                                )}
                                                {onDelete && (
                                                    <button
                                                        onClick={() => onDelete(row.id)}
                                                        className="inline-flex items-center p-1.5 text-text-secondary/50 hover:text-red-500 transition-colors rounded hover:bg-red-500/10"
                                                        title="Delete entry"
                                                    >
                                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    )}
                                </tr>
                                    )
                                }),
                            ])
                        )}
                    </tbody>
                </table>
            </div>

            {/* Mobile card layout */}
            <div className="md:hidden">
                {data.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-text-secondary/60 text-sm">
                        <svg className="w-8 h-8 text-text-secondary/30" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                        </svg>
                        <span>{emptyMessage}</span>
                    </div>
                ) : (
                    <div className="divide-y divide-border-subtle">
                        {groups.flatMap((group) => [
                            ...(group.heading ? [(
                                <div key={`mhead-${group.key}`} className="flex items-center gap-1.5 bg-bg-primary/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
                                    <Pictogram name="date" size={13} />
                                    {group.heading}
                                </div>
                            )] : []),
                            ...group.rows.map((row, ri) => (
                            <div key={row.id || `${group.key}-m-${ri}`} className="px-3 py-2.5 space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        {selectable && rowIsSelectable(row) && (
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(row.id)}
                                                onChange={() => toggleOne(row.id)}
                                                className="h-4 w-4 accent-accent-gold cursor-pointer"
                                                aria-label={`Select row ${row.id}`}
                                            />
                                        )}
                                        <span className="text-xs font-semibold text-text-secondary bg-bg-primary px-2 py-0.5 rounded">
                                            #{row.sno || ri + 1}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {onEdit && (
                                            <button
                                                onClick={() => onEdit(row)}
                                                className="p-1.5 text-text-secondary/60 hover:text-accent-gold transition-colors rounded hover:bg-accent-gold-muted"
                                                title="Edit entry"
                                                aria-label="Edit entry"
                                            >
                                                <Pictogram name="edit" size={15} />
                                            </button>
                                        )}
                                        {onDelete && (
                                            <button
                                                onClick={() => onDelete(row.id)}
                                                className="p-1.5 text-text-secondary/50 hover:text-red-500 transition-colors rounded hover:bg-red-500/10"
                                                title="Delete entry"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                                    {columns.filter(c => c.key !== 'sno').map((col) => (
                                        <div key={col.key} className="flex flex-col gap-0.5">
                                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase text-text-secondary/60">
                                                {col.icon && <Pictogram name={col.icon} size={11} />}
                                                {col.label}
                                            </span>
                                            <span className="text-sm text-text-primary truncate">
                                                {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            )),
                        ])}
                    </div>
                )}
            </div>
        </div>
    )
}
