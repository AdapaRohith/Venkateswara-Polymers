import { useState, useCallback, useMemo, createContext, useContext } from 'react'

const ToastContext = createContext(null)

export function useToast() {
    return useContext(ToastContext)
}

export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([])

    const addToast = useCallback((message, type = 'success') => {
        const id = Date.now()
        setToasts((prev) => [...prev, { id, message, type }])
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id))
        }, 4000)
    }, [])

    const toastObj = useMemo(() => ({
        success: (msg) => addToast(msg, 'success'),
        error: (msg) => addToast(msg, 'error'),
        warning: (msg) => addToast(msg, 'warning'),
    }), [addToast])

    return (
        <ToastContext.Provider value={toastObj}>
            {children}
            <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
                {toasts.map((t) => (
                    <div
                        key={t.id}
                        className={`pointer-events-auto px-5 py-3 rounded-lg shadow-xl text-sm font-medium border transition-all duration-300 animate-slide-up ${t.type === 'success'
                                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                : t.type === 'warning'
                                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                  : 'bg-red-500/15 text-red-400 border-red-500/30'
                            }`}
                    >
                        <div className="flex items-center gap-2">
                            {t.type === 'success' ? (
                                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                            ) : t.type === 'warning' ? (
                                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                </svg>
                            ) : (
                                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            )}
                            {t.message}
                        </div>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    )
}
