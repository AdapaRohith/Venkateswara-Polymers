import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

const navItems = [
    {
        name: 'Dashboard',
        path: '/',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
            </svg>
        ),
    },
    {
        name: 'Raw Material',
        path: '/raw-material',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
        ),
    },
    {
        name: 'Stocks',
        path: '/stocks',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125v-3.75m16.5 3.75v3.75c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125v-3.75" />
            </svg>
        ),
    },
    {
        name: 'Manufacturing',
        path: '/manufacturing',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.1-3.06a1.5 1.5 0 01-.54-2.05l4.5-7.09a1.5 1.5 0 012.36-.11l4.59 5.28a1.5 1.5 0 01-.3 2.2l-5.51 4.83z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18" />
            </svg>
        ),
    },
    {
        name: 'Trading',
        path: '/trading',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
    },
    {
        name: 'Wastage',
        path: '/wastage',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
        ),
    },
    {
        name: 'Log History',
        path: '/log-history',
        icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
    },
]

export default function Sidebar() {
    const [open, setOpen] = useState(false)
    const [isDarkMode, setIsDarkMode] = useState(true)
    const location = useLocation()

    useEffect(() => {
        setIsDarkMode(document.documentElement.classList.contains('dark'))
    }, [])

    const toggleTheme = () => {
        if (isDarkMode) {
            document.documentElement.classList.remove('dark')
            setIsDarkMode(false)
        } else {
            document.documentElement.classList.add('dark')
            setIsDarkMode(true)
        }
    }

    // Close sidebar on route change (mobile)
    useEffect(() => {
        setOpen(false)
    }, [location.pathname])

    return (
        <>
            {/* Mobile top bar */}
            <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-bg-card border-b border-border-default flex items-center px-4 z-50">
                <button
                    onClick={() => setOpen(true)}
                    className="text-text-primary p-2 -ml-2 rounded-lg hover:bg-white/[0.05] transition-colors"
                    aria-label="Open menu"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                </button>
                <div className="flex items-center gap-2 ml-3">
                    <div className="w-7 h-7 rounded-md bg-accent-gold/10 flex items-center justify-center">
                        <span className="text-accent-gold font-bold text-[10px]">VP</span>
                    </div>
                    <span className="text-sm font-semibold text-text-primary tracking-wide">Venkateswara</span>
                </div>
            </div>

            {/* Overlay */}
            {open && (
                <div
                    className="lg:hidden fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm"
                    onClick={() => setOpen(false)}
                />
            )}

            {/* Sidebar panel */}
            <aside
                className={`
                    fixed left-0 top-0 h-screen w-64 bg-bg-card border-r border-border-default flex flex-col z-[70]
                    transition-transform duration-300 ease-in-out
                    lg:translate-x-0
                    ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
                `}
            >
                {/* Logo + close */}
                <div className="px-6 py-8 border-b border-border-default">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-accent-gold/10 flex items-center justify-center">
                                <span className="text-accent-gold font-bold text-sm">VP</span>
                            </div>
                            <div>
                                <h1 className="text-base font-semibold tracking-wide text-text-primary">Venkateswara</h1>
                                <p className="text-[11px] text-text-secondary tracking-widest uppercase">Polymers</p>
                            </div>
                        </div>
                        {/* Close button (mobile only) */}
                        <button
                            onClick={() => setOpen(false)}
                            className="lg:hidden text-text-secondary hover:text-text-primary p-1 rounded-lg hover:bg-white/[0.05] transition-colors"
                            aria-label="Close menu"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-3 py-6 overflow-y-auto">
                    <p className="px-3 mb-4 text-[10px] font-medium tracking-widest uppercase text-text-secondary/60">
                        Navigation
                    </p>
                    <ul className="space-y-1">
                        {navItems.map((item) => (
                            <li key={item.path}>
                                <NavLink
                                    to={item.path}
                                    end={item.path === '/'}
                                    className={({ isActive }) =>
                                        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 border-l-2 ${isActive
                                            ? 'text-accent-gold border-accent-gold bg-accent-gold/5'
                                            : 'text-text-secondary border-transparent hover:text-text-primary hover:bg-white/[0.03]'
                                        }`
                                    }
                                >
                                    {item.icon}
                                    <span>{item.name}</span>
                                </NavLink>
                            </li>
                        ))}
                    </ul>
                </nav>


                {/* Theme Toggle */}
                <div className="px-4 pb-3">
                    <button
                        onClick={toggleTheme}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border-default text-text-secondary hover:bg-white/[0.03] transition-all group"
                    >
                        <div className="flex items-center gap-3">
                            {isDarkMode ? (
                                <svg className="w-5 h-5 text-accent-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                                </svg>
                            ) : (
                                <svg className="w-5 h-5 text-accent-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                                </svg>
                            )}
                            <span className="text-xs font-semibold tracking-wide">{isDarkMode ? 'Dark Mode' : 'Light Mode'}</span>
                        </div>
                    </button>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-border-default">
                    <p className="text-[10px] text-text-secondary/40 tracking-wide">© 2026 Venkateswara Polymers</p>
                </div>
            </aside>
        </>
    )
}
