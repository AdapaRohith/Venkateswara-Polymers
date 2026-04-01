import { useEffect, useState } from 'react'

export function MobileBlocker({ children }) {
  const [isMobile, setIsMobile] = useState(false)
  const [isChecked, setIsChecked] = useState(false)

  useEffect(() => {
    // Check if device is mobile based on screen width and user agent
    const checkIsMobile = () => {
      const userAgent = navigator.userAgent.toLowerCase()
      const mobileRegex = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i
      const isMobileDevice = mobileRegex.test(userAgent) || window.innerWidth < 1024

      setIsMobile(isMobileDevice)
      setIsChecked(true)
    }

    checkIsMobile()

    // Listen for resize events
    window.addEventListener('resize', checkIsMobile)
    return () => window.removeEventListener('resize', checkIsMobile)
  }, [])

  if (!isChecked) {
    return null
  }

  if (isMobile) {
    return (
      <div className="fixed inset-0 bg-bg-primary flex items-center justify-center z-[9999] p-4">
        <div className="bg-bg-card border border-border-default rounded-2xl shadow-2xl max-w-md text-center p-8 space-y-6">
          <div>
            <div className="inline-flex items-center justify-center w-20 h-20 bg-red-500/10 rounded-full mb-4">
              <svg
                className="w-10 h-10 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M12 9v2m0 4v2m0 6v2m-9-9h18M5 9a4 4 0 014-4h6a4 4 0 014 4v12a4 4 0 01-4 4H9a4 4 0 01-4-4V9z"
                />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-text-primary mb-2">Not Available on Mobile</h1>
            <p className="text-text-secondary">
              This application is designed for desktop use only. Please access this site from a desktop or laptop computer to continue.
            </p>
          </div>

          <div className="bg-bg-primary rounded-lg p-4 space-y-2">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">System Requirements:</p>
            <ul className="text-sm text-text-secondary space-y-1 text-left">
              <li className="flex items-center">
                <span className="text-accent-gold mr-2">✓</span>
                Desktop or laptop computer
              </li>
              <li className="flex items-center">
                <span className="text-accent-gold mr-2">✓</span>
                Minimum screen width: 1024px
              </li>
              <li className="flex items-center">
                <span className="text-accent-gold mr-2">✓</span>
                Modern web browser
              </li>
            </ul>
          </div>

          <div className="pt-4 border-t border-border-default text-xs text-text-secondary/60">
            Your device: Mobile/Tablet
          </div>
        </div>
      </div>
    )
  }

  return children
}
