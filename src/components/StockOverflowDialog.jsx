import { useState } from 'react'

export function parseAvailableKg(errorMsg) {
  const m = String(errorMsg).match(/Available:\s*([\d.]+)\s*kg/i)
  return m ? parseFloat(m[1]) : null
}

export default function StockOverflowDialog({ materialName, attempted, available, onTopUp, onCancel, loading }) {
  const [step, setStep] = useState(1)
  const [customAmount, setCustomAmount] = useState('')

  const shortfall = Math.max(attempted - available, 0.001)
  const quickAmounts = [
    parseFloat(shortfall.toFixed(3)),
    parseFloat((shortfall + 20).toFixed(3)),
    parseFloat((shortfall + 40).toFixed(3)),
    parseFloat((shortfall + 60).toFixed(3)),
  ]

  const handleQuick = (amount) => {
    setCustomAmount(String(amount))
  }

  const handleConfirm = () => {
    const amount = parseFloat(customAmount)
    if (!amount || amount <= 0) return
    onTopUp(amount)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-card rounded-2xl border border-border-default shadow-2xl max-w-md w-full p-6 space-y-5">

        {step === 1 ? (
          <>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-text-primary">Stock Mismatch</h3>
                <p className="text-sm text-text-secondary mt-1">
                  You tried to use <span className="text-accent-gold font-semibold font-mono">{attempted.toFixed(2)} kg</span> of{' '}
                  <span className="text-text-primary font-medium">{materialName}</span>, but only{' '}
                  <span className="text-red-400 font-semibold font-mono">{available.toFixed(2)} kg</span> is recorded.
                </p>
                <p className="text-sm text-text-secondary/70 mt-2">Did you enter the right amount?</p>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={onCancel}
                className="flex-1 rounded-xl border border-border-default px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-bg-input/50 transition-colors"
              >
                No, let me fix it
              </button>
              <button
                onClick={() => setStep(2)}
                className="flex-1 rounded-xl bg-accent-gold px-4 py-2.5 text-sm font-semibold text-black hover:bg-accent-gold-hover transition-all"
              >
                Yes, that's correct
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <h3 className="text-base font-bold text-text-primary">Add Stock to Proceed</h3>
              <p className="text-sm text-text-secondary mt-1">
                Shortfall: <span className="text-red-400 font-semibold font-mono">{shortfall.toFixed(2)} kg</span>{' '}
                for <span className="text-text-primary font-medium">{materialName}</span>.
                Choose how much to add:
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {quickAmounts.map((amt) => (
                <button
                  key={amt}
                  onClick={() => handleQuick(amt)}
                  disabled={loading}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold font-mono transition-all
                    ${customAmount === String(amt)
                      ? 'border-accent-gold bg-accent-gold/10 text-accent-gold'
                      : 'border-border-default text-text-secondary hover:border-accent-gold/50 hover:text-text-primary'}
                    disabled:opacity-40`}
                >
                  +{amt.toFixed(2)} kg
                </button>
              ))}
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary/60">
                Custom Amount (kg)
              </label>
              <input
                type="number"
                min="0.001"
                step="0.001"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="Enter amount..."
                disabled={loading}
                className="w-full bg-bg-input text-text-primary border border-border-default rounded-xl px-4 py-2.5 text-sm font-mono focus:border-accent-gold transition-all disabled:opacity-40"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                disabled={loading}
                className="rounded-xl border border-border-default px-4 py-2.5 text-sm font-semibold text-text-primary hover:bg-bg-input/50 transition-colors disabled:opacity-40"
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading || !parseFloat(customAmount) || parseFloat(customAmount) <= 0}
                className="flex-1 rounded-xl bg-accent-gold px-4 py-2.5 text-sm font-semibold text-black hover:bg-accent-gold-hover transition-all disabled:opacity-40"
              >
                {loading ? 'Adding...' : `Add ${parseFloat(customAmount) > 0 ? parseFloat(customAmount).toFixed(2) + ' kg' : ''} & Continue`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
