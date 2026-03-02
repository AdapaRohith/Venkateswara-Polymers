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

function CustomTooltip({ active, payload, label }) {
    if (!active || !payload || !payload.length) return null
    return (
        <div className="bg-bg-tooltip border border-border-default rounded-lg px-4 py-3 shadow-xl shadow-black/40">
            <p className="text-xs text-text-secondary mb-2 font-medium">{label}</p>
            {payload.map((entry, i) => (
                <p key={i} className="text-sm text-text-primary">
                    <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: entry.color }} />
                    {entry.name}: <span className="font-semibold">{Number(entry.value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </p>
            ))}
        </div>
    )
}

export function ComparisonBarChart({ data }) {
    return (
        <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6">
            <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">
                Raw Material Production
            </h3>
            <ResponsiveContainer width="100%" height={320}>
                <BarChart data={data} barGap={8} barCategoryGap="25%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" vertical={false} />
                    <XAxis
                        dataKey="name"
                        tick={{ fill: '#9494a8', fontSize: 12 }}
                        axisLine={{ stroke: '#2a2a3a' }}
                        tickLine={false}
                    />
                    <YAxis
                        tick={{ fill: '#9494a8', fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(167,139,250,0.04)' }} />
                    <Bar dataKey="value" fill="#a78bfa" radius={[4, 4, 0, 0]} maxBarSize={56} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    )
}

export function TrendLineChart({ data, title = 'Trend', color = '#a78bfa', gradientId = 'gradNet' }) {
    return (
        <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6">
            <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">
                {title}
            </h3>
            <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data}>
                    <defs>
                        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" vertical={false} />
                    <XAxis
                        dataKey="label"
                        tick={{ fill: '#9494a8', fontSize: 11 }}
                        axisLine={{ stroke: '#2a2a3a' }}
                        tickLine={false}
                    />
                    <YAxis
                        domain={[0, 'auto']}
                        tick={{ fill: '#9494a8', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: `${color}33` }} />
                    <Area
                        type="monotone"
                        dataKey="value"
                        stroke={color}
                        strokeWidth={2}
                        fill={`url(#${gradientId})`}
                        dot={false}
                        activeDot={{ r: 4, fill: color, strokeWidth: 2, stroke: '#0f0f14' }}
                        name="Net Weight"
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    )
}

export function WastageAreaChart({ data }) {
    return (
        <div className="bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6">
            <h3 className="text-sm font-medium text-text-secondary/70 tracking-widest uppercase mb-6">
                Wastage Breakdown
            </h3>
            <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" vertical={false} />
                    <XAxis
                        dataKey="name"
                        tick={{ fill: '#9494a8', fontSize: 12 }}
                        axisLine={{ stroke: '#2a2a3a' }}
                        tickLine={false}
                    />
                    <YAxis
                        tick={{ fill: '#9494a8', fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(167,139,250,0.04)' }} />
                    <Bar dataKey="value" fill="#a78bfa" radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    )
}
