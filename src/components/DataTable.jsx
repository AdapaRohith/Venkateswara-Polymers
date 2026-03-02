export default function DataTable({ columns, data, emptyMessage = 'No entries yet.', onDelete }) {
    return (
        <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border-default">
                            {columns.map((col) => (
                                <th
                                    key={col.key}
                                    className="text-left px-6 py-4 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60"
                                >
                                    {col.label}
                                </th>
                            ))}
                            {onDelete && (
                                <th className="text-left px-6 py-4 text-[11px] font-medium tracking-widest uppercase text-text-secondary/60 w-16"></th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {data.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={columns.length + (onDelete ? 1 : 0)}
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
                                    {columns.map((col) => (
                                        <td key={col.key} className="px-6 py-3.5 text-text-primary/90 font-normal">
                                            {col.render ? col.render(row[col.key], row) : row[col.key]}
                                        </td>
                                    ))}
                                    {onDelete && (
                                        <td className="px-6 py-3.5">
                                            <button
                                                onClick={() => onDelete(row.id)}
                                                className="text-red-400/50 hover:text-red-400 transition-colors"
                                                title="Delete entry"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                                </svg>
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
