import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import avlokaiLogo from '../../avlokai_logo.png'

const Icon = {
  grid: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
  production: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
    </svg>
  ),
  materials: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  ),
  orders: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
    </svg>
  ),
  fulfillment: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
    </svg>
  ),
  reports: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  ),
  wastage: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.108 0 00-7.5 0" />
    </svg>
  ),
  rawMaterial: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
    </svg>
  ),
  users: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),
  trading: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  ),
  dashboard: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
}

const ownerNavGroups = [
  {
    label: 'Overview',
    items: [
      { name: 'Dashboard', path: '/', icon: Icon.dashboard },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { name: 'Raw Material', path: '/raw-material', icon: Icon.rawMaterial },
      { name: 'Trading', path: '/trading', icon: Icon.trading },
      { name: 'Materials', path: '/materials', icon: Icon.materials },
    ],
  },
  {
    label: 'Production',
    items: [
      { name: 'Production Log', path: '/production-log', icon: Icon.production },
      { name: 'Production Orders', path: '/production-orders', icon: Icon.orders },
      { name: 'Wastage', path: '/wastage', icon: Icon.wastage },
    ],
  },
  {
    label: 'Fulfillment',
    items: [
      { name: 'Fulfillment', path: '/fulfillment', icon: Icon.fulfillment },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { name: 'Machine Reports', path: '/reports', icon: Icon.reports },
    ],
  },
  {
    label: 'Administration',
    items: [
      { name: 'Users', path: '/users', icon: Icon.users },
    ],
  },
]

const workerNavGroups = [
  {
    label: 'Work',
    items: [
      { name: 'Production Log', path: '/production-log', icon: Icon.production },
      { name: 'Wastage', path: '/wastage', icon: Icon.wastage },
    ],
  },
]

const flatOwner = ownerNavGroups.flatMap(g => g.items)
const flatWorker = workerNavGroups.flatMap(g => g.items)

export default function Sidebar({ user, onLogout }) {
  const [open, setOpen] = useState(false)
  const [isDarkMode, setIsDarkMode] = useState(true)
  const location = useLocation()
  const isWorker = String(user?.role || '').toLowerCase() === 'worker'

  const navGroups = isWorker ? workerNavGroups : ownerNavGroups
  const flatItems = isWorker ? flatWorker : flatOwner

  const quickPaths = isWorker
    ? ['/production-log', '/wastage']
    : ['/', '/production-log', '/production-orders', '/reports']
  const quickItems = quickPaths.map(p => flatItems.find(i => i.path === p)).filter(Boolean)

  const currentItem = [...flatItems]
    .sort((a, b) => b.path.length - a.path.length)
    .find(i => i.path === '/' ? location.pathname === '/' : location.pathname.startsWith(i.path))

  useEffect(() => {
    setIsDarkMode(document.documentElement.classList.contains('dark'))
  }, [])

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  const toggleTheme = () => {
    if (isDarkMode) {
      document.documentElement.classList.remove('dark')
      setIsDarkMode(false)
    } else {
      document.documentElement.classList.add('dark')
      setIsDarkMode(true)
    }
  }

  const roleBadgeColor = isWorker
    ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
    : 'bg-accent-gold-muted text-accent-gold border border-accent-gold/20'

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-bg-card border-b border-border-default flex items-center justify-between px-4 z-50">
        <button
          onClick={() => setOpen(true)}
          className="text-text-secondary hover:text-text-primary p-1.5 -ml-1.5 rounded-md hover:bg-bg-row-hover transition-colors cursor-pointer"
          aria-label="Open menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <div className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${roleBadgeColor}`}>
            {isWorker ? 'Worker' : 'Owner'}
          </div>
          <p className="truncate text-sm font-semibold text-text-primary">{currentItem?.name || 'Dashboard'}</p>
        </div>
        <div className="shrink-0">
          <img src={avlokaiLogo} alt="Logo" className="h-7 w-auto object-contain opacity-60" />
        </div>
      </div>

      {/* Mobile bottom quick-nav */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border-default bg-bg-card">
        <div className="flex items-stretch gap-0 px-1 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
          {quickItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-1 px-2 py-2 rounded-md text-center transition-colors ${
                  isActive
                    ? 'bg-accent-gold-muted text-accent-gold'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-row-hover'
                }`
              }
            >
              <span className="w-4 h-4 flex items-center justify-center">{item.icon}</span>
              <span className="text-[10px] font-medium leading-none">{item.name.split(' ')[0]}</span>
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex-1 flex flex-col items-center gap-1 px-2 py-2 rounded-md text-center text-text-secondary hover:text-text-primary hover:bg-bg-row-hover transition-colors cursor-pointer"
            aria-label="More"
          >
            <span className="w-4 h-4 flex items-center justify-center">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </span>
            <span className="text-[10px] font-medium leading-none">More</span>
          </button>
        </div>
      </div>

      {/* Overlay */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-[60] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 h-screen w-64 bg-bg-card border-r border-border-default flex flex-col z-[70]
          transition-transform duration-250 ease-in-out
          lg:translate-x-0
          ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border-default flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-md bg-accent-gold-muted flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-accent-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-text-primary truncate leading-tight">VP Polymers</p>
              <p className="text-[10px] text-text-secondary/70 leading-tight">Inventory · Production</p>
            </div>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="lg:hidden text-text-secondary hover:text-text-primary p-1 rounded-md hover:bg-bg-row-hover transition-colors cursor-pointer shrink-0"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-0.5">
          {navGroups.map(group => (
            <div key={group.label} className="mb-1">
              <p className="px-2 pt-3 pb-1 text-[9px] font-bold tracking-[0.15em] uppercase text-text-secondary/40">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map(item => (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      end={item.path === '/'}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-2.5 py-2 text-sm rounded-md font-medium transition-all duration-150 ${
                          isActive
                            ? 'bg-accent-gold-muted text-accent-gold'
                            : 'text-text-secondary hover:text-text-primary hover:bg-bg-row-hover'
                        }`
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <span className={isActive ? 'text-accent-gold' : 'text-text-secondary/70'}>
                            {item.icon}
                          </span>
                          <span>{item.name}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 pb-4 pt-2 border-t border-border-default space-y-1 shrink-0">
          {/* User info */}
          <div className="px-2.5 py-2 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-accent-gold-muted flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-accent-gold">
                {String(user?.name || user?.role || 'U')[0].toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-text-primary truncate leading-tight">
                {user?.name || (isWorker ? 'Worker' : 'Owner')}
              </p>
              <p className="text-[10px] text-text-secondary/60 leading-tight">
                {isWorker ? 'Floor Worker' : 'Administrator'}
              </p>
            </div>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${roleBadgeColor}`}>
              {isWorker ? 'W' : 'O'}
            </span>
          </div>

          {/* Theme toggle */}
          {!isWorker && (
            <button
              onClick={toggleTheme}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-row-hover transition-all text-sm cursor-pointer"
            >
              {isDarkMode ? (
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              )}
              <span className="text-xs font-medium">{isDarkMode ? 'Dark Mode' : 'Light Mode'}</span>
            </button>
          )}

          {/* Sign out */}
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-medium text-text-secondary/60 hover:text-red-500 hover:bg-red-500/8 transition-all cursor-pointer"
          >
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            <span>Sign Out</span>
          </button>

          {/* AvlokAI branding */}
          <div className="pt-1 flex items-center justify-center">
            <img src={avlokaiLogo} alt="AvlokAI" className="h-5 w-auto object-contain opacity-20 hover:opacity-60 transition-opacity duration-300" />
          </div>
        </div>
      </aside>
    </>
  )
}
