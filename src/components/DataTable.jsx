export default function DataTable({
    columns,
    data,
    emptyMessage = 'No entries yet.',
    onDelete,
    onEdit,
    title,
    rightAction,
    selectedIds = [],
    onSelectedIdsChange,
    isRowSelectable,
}) {
    const selectable = typeof onSelectedIdsChange === 'function'
    const rowIsSelectable = (row) => (typeof isRowSelectable === 'function' ? isRowSelectable(row) : true)
    const selectableRows = data.filter((row) => rowIsSelectable(row))
    const allSelected = selectableRows.length > 0 && selectableRows.every((row) => selectedIds.includes(row.id))

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
        <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
            {(title || rightAction) && (
                <div className="px-6 py-4 flex items-center justify-between border-b border-border-default">
                    {title ? <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase">{title}</h3> : <div />}
                    {rightAction && <div>{rightAction}</div>}
                </div>
            )}
            {/* Desktop: normal table */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border-default">
                            {selectable && (
                                <th className="px-4 py-4 w-12">
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={toggleAll}
                                        className="h-4 w-4 accent-accent-gold"
                                        aria-label="Select all rows"
                                    />
                                </th>
                            )}
                            {columns.map((col) => (
                                <th
                                    key={col.key}
                                    className="text-left px-6 py-4 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60"
                                >
                                    {col.label}
                                </th>
                            ))}
                            {(onDelete || onEdit) && (
                                <th className="text-left px-6 py-4 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60 w-28">Actions</th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {data.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={columns.length + (selectable ? 1 : 0) + ((onDelete || onEdit) ? 1 : 0)}
                                    className="text-center py-12 text-text-secondary/50 text-sm"
                                >
                                    {emptyMessage}
                                </td>
                            </tr>
                        ) : (
                            data.map((row, idx) => (
                                <tr
                                    key={row.id || idx}
                                    className={`border-b border-border-subtle transition-colors duration-150 hover:bg-white/[0.02] ${idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.01]'
                                        }`}
                                >
                                    {selectable && (
                                        <td className="px-4 py-3.5 align-middle">
                                            {rowIsSelectable(row) ? (
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.includes(row.id)}
                                                    onChange={() => toggleOne(row.id)}
                                                    className="h-4 w-4 accent-accent-gold"
                                                    aria-label={`Select row ${row.id}`}
                                                />
                                            ) : null}
                                        </td>
                                    )}
                                    {columns.map((col) => (
                                        <td key={col.key} className="px-6 py-3.5 text-text-primary/90 font-normal">
                                            {col.render ? col.render(row[col.key], row) : row[col.key]}
                                        </td>
                                    ))}
                                    {(onDelete || onEdit) && (
                                        <td className="px-6 py-3.5">
                                            <div className="flex items-center gap-3">
                                                {onEdit && (
                                                    <button
                                                        onClick={() => onEdit(row)}
                                                        className="text-blue-400/70 hover:text-blue-300 transition-colors text-xs font-semibold"
                                                        title="Edit entry"
                                                    >
                                                        Edit
                                                    </button>
                                                )}
                                                {onDelete && (
                                                    <button
                                                        onClick={() => onDelete(row.id)}
                                                        className="text-red-400/50 hover:text-red-400 transition-colors"
                                                        title="Delete entry"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    )}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Mobile: card layout */}
            <div className="md:hidden">
                {data.length === 0 ? (
                    <p className="text-center py-12 text-text-secondary/50 text-sm">{emptyMessage}</p>
                ) : (
                    <div className="divide-y divide-border-subtle">
                        {data.map((row, idx) => (
                            <div key={row.id || idx} className="p-4 space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        {selectable && rowIsSelectable(row) && (
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(row.id)}
                                                onChange={() => toggleOne(row.id)}
                                                className="h-4 w-4 accent-accent-gold"
                                                aria-label={`Select row ${row.id}`}
                                            />
                                        )}
                                        <span className="text-xs font-medium text-text-secondary/60">#{row.sno || idx + 1}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {onEdit && (
                                            <button
                                                onClick={() => onEdit(row)}
                                                className="text-blue-400/70 hover:text-blue-300 transition-colors text-xs font-semibold"
                                                title="Edit entry"
                                            >
                                                Edit
                                            </button>
                                        )}
                                        {onDelete && (
                                            <button
                                                onClick={() => onDelete(row.id)}
                                                className="text-red-400/50 hover:text-red-400 transition-colors"
                                                title="Delete entry"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                                    {columns.filter(c => c.key !== 'sno').map((col) => (
                                        <div key={col.key} className="flex flex-col">
                                            <span className="text-[10px] font-medium tracking-wider uppercase text-text-secondary/50">{col.label}</span>
                                            <span className="text-sm text-text-primary/90 truncate">
                                                {col.render ? col.render(row[col.key], row) : (row[col.key] || '—')}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
