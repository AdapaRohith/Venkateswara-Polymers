import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    AreaChart,
    Area,
} from 'recharts'

const GRID_COLOR = 'var(--border-default)'
const TICK_COLOR = 'var(--text-secondary)'

function CustomTooltip({ active, payload, label }) {
    if (!active || !payload || !payload.length) return null
    return (
        <div className="bg-bg-tooltip border border-border-default rounded-md px-3 py-2.5 shadow-lg">
            <p className="text-xs text-text-secondary mb-1.5 font-medium">{label}</p>
            {payload.map((entry, i) => (
                <p key={i} className="text-sm text-text-primary flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                    <span>{entry.name}:</span>
                    <span className="font-semibold tabular-nums">
                        {Number(entry.value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                </p>
            ))}
        </div>
    )
}

export function ComparisonBarChart({ data }) {
    return (
        <div className="bg-bg-card rounded-lg border border-border-default p-5">
            <h3 className="text-xs font-semibold text-text-secondary tracking-widest uppercase mb-5">
                Raw Material Production
            </h3>
            <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data} barGap={8} barCategoryGap="25%">
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: TICK_COLOR, fontSize: 12 }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
                    <YAxis tick={{ fill: TICK_COLOR, fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-gold-muted)' }} />
                    <Bar dataKey="value" fill="var(--chart-bar1)" radius={[3, 3, 0, 0]} maxBarSize={52} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    )
}

export function TrendLineChart({ data, title = 'Trend', color, gradientId = 'gradNet', onPointClick }) {
    const lineColor = color || 'var(--chart-line)'
    const handleChartClick = onPointClick
        ? (state) => { if (state?.activeLabel) onPointClick(state.activeLabel) }
        : undefined
    return (
        <div className="bg-bg-card rounded-lg border border-border-default p-5">
            <h3 className="text-xs font-semibold text-text-secondary tracking-widest uppercase mb-5">
                {title}
            </h3>
            <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={data} onClick={handleChartClick} style={onPointClick ? { cursor: 'pointer' } : undefined}>
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
                            <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: TICK_COLOR, fontSize: 11 }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
                    <YAxis domain={[0, 'auto']} tick={{ fill: TICK_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: lineColor, strokeWidth: 1, strokeDasharray: '4 4' }} />
                    <Area
                        type="monotone"
                        dataKey="value"
                        stroke={lineColor}
                        strokeWidth={2}
                        fill={`url(#${gradientId})`}
                        dot={false}
                        activeDot={{ r: 4, fill: lineColor, strokeWidth: 2, stroke: 'var(--bg-card)' }}
                        name="Net Weight"
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    )
}

export function WastageAreaChart({ data }) {
    return (
        <div className="bg-bg-card rounded-lg border border-border-default p-5">
            <h3 className="text-xs font-semibold text-text-secondary tracking-widest uppercase mb-5">
                Wastage Breakdown
            </h3>
            <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: TICK_COLOR, fontSize: 12 }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
                    <YAxis tick={{ fill: TICK_COLOR, fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-gold-muted)' }} />
                    <Bar dataKey="value" fill="var(--chart-bar3)" radius={[3, 3, 0, 0]} maxBarSize={48} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    )
}

export function SectionBarChart({ data, title = 'Breakdown', color, onBarClick }) {
    const barColor = color || 'var(--chart-bar1)'
    const handleBarClick = onBarClick
        ? (entry) => onBarClick(entry?.payload ?? entry)
        : undefined
    return (
        <div className="bg-bg-card rounded-lg border border-border-default p-5">
            <h3 className="text-xs font-semibold text-text-secondary tracking-widest uppercase mb-5">
                {title}
            </h3>
            <ResponsiveContainer width="100%" height={260}>
                <BarChart data={data} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: TICK_COLOR, fontSize: 12 }} axisLine={{ stroke: GRID_COLOR }} tickLine={false} />
                    <YAxis tick={{ fill: TICK_COLOR, fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--accent-gold-muted)' }} />
                    <Bar
                        dataKey="value"
                        fill={barColor}
                        radius={[3, 3, 0, 0]}
                        maxBarSize={48}
                        onClick={handleBarClick}
                        cursor={onBarClick ? 'pointer' : undefined}
                    />
                </BarChart>
            </ResponsiveContainer>
        </div>
    )
}
