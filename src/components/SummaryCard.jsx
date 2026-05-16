export default function SummaryCard({ title, value, subtitle, icon }) {
    return (
        <div className="relative bg-bg-card rounded-lg border border-border-default overflow-hidden group transition-all duration-200 hover:border-accent-gold/50 hover:shadow-sm">
            {/* Left accent bar */}
            <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-accent-gold" />

            <div className="pl-6 pr-5 py-5 flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0">
                    <p className="text-[11px] font-semibold tracking-widest uppercase text-text-secondary">
                        {title}
                    </p>
                    <p className="text-2xl font-bold text-text-primary tabular-nums tracking-tight">
                        {typeof value === 'number'
                            ? value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : value}
                    </p>
                    {subtitle && (
                        <p className="text-xs text-text-secondary leading-relaxed pt-0.5">{subtitle}</p>
                    )}
                </div>
                {icon && (
                    <div className="w-9 h-9 rounded-md bg-accent-gold-muted flex items-center justify-center text-accent-gold shrink-0 mt-0.5">
                        {icon}
                    </div>
                )}
            </div>
        </div>
    )
}
