export default function SummaryCard({ title, value, subtitle, icon }) {
    return (
        <div className="relative bg-bg-card rounded-xl border border-border-default shadow-lg shadow-black/30 p-6 overflow-hidden group transition-all duration-300 hover:border-accent-gold/30">
            {/* Gold accent top bar */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-accent-gold/80 via-accent-gold/40 to-transparent" />

            <div className="flex items-start justify-between">
                <div className="space-y-3">
                    <p className="text-xs font-medium tracking-widest uppercase text-text-secondary/70">
                        {title}
                    </p>
                    <p className="text-3xl font-semibold text-text-primary tracking-tight">
                        {typeof value === 'number' ? value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value}
                    </p>
                    {subtitle && (
                        <p className="text-xs text-text-secondary">{subtitle}</p>
                    )}
                </div>
                {icon && (
                    <div className="w-10 h-10 rounded-lg bg-accent-gold/10 flex items-center justify-center text-accent-gold/70 shrink-0">
                        {icon}
                    </div>
                )}
            </div>
        </div>
    )
}
