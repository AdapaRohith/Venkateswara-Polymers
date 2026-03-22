import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const Login = ({ onLogin }) => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isPasswordFocused, setIsPasswordFocused] = useState(false)
  const [isEmailFocused, setIsEmailFocused] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = (e) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    setTimeout(() => {
      let userData = null;
      if (email === 'owner@demo.com' && password === 'owner123') {
        userData = { email, role: 'owner', name: 'Admin' };
      } else if (email === 'worker@demo.com' && password === 'worker123') {
        userData = { email, role: 'worker', name: 'Staff' };
      }

      if (userData) {
        onLogin(userData)
        navigate(userData.role === 'worker' ? '/raw-material' : '/')
      } else {
        setError('Invalid email or password')
        setIsLoading(false)
      }
    }, 1500)
  }

  // Owl Animation Logic
  const isCoveringEyes = isPasswordFocused && !showPassword;
  const isPeeking = isPasswordFocused && showPassword;

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-bg-primary p-4 overflow-hidden relative">
      {/* Background decoration */}
      <div className="absolute top-[-10%] left-[-10%] w-72 h-72 bg-primary opacity-5 rounded-full blur-3xl animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-primary opacity-10 rounded-full blur-3xl animate-pulse delay-700"></div>

      <div className="w-full max-w-md z-10">
        {/* Interactive Owl Character */}
        <div className="flex justify-center mb-[-15px] relative z-20">
          <div className="w-44 h-44 relative">
            <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-2xl">
              {/* Ears/Tufts */}
              <path d="M60 50 L40 20 L80 40 Z" fill="#475569" />
              <path d="M140 50 L160 20 L120 40 Z" fill="#475569" />
              
              {/* Body */}
              <ellipse cx="100" cy="110" rx="70" ry="80" fill="#64748b" />
              <ellipse cx="100" cy="120" rx="50" ry="60" fill="#f8fafc" opacity="0.1" />

              {/* Eyes/Pupils */}
              <g className="transition-all duration-500">
                {/* Eyelids / Base - always there */}
                <circle cx="70" cy="85" r="28" fill="#f8fafc" />
                <circle cx="130" cy="85" r="28" fill="#f8fafc" />

                {/* Pupils - only visible when not covering eyes */}
                <g style={{ opacity: isCoveringEyes ? 0 : 1 }} className="transition-opacity duration-300">
                  <circle 
                    cx="70" 
                    cy={isEmailFocused ? "95" : (isPeeking ? "85" : "85")} 
                    r={isPeeking ? "18" : "10"} 
                    fill="#0f172a" 
                    className="transition-all duration-300"
                  />
                  <circle 
                    cx="130" 
                    cy={isEmailFocused ? "95" : (isPeeking ? "85" : "85")} 
                    r={isPeeking ? "18" : "10"} 
                    fill="#0f172a" 
                    className="transition-all duration-300"
                  />
                </g>

                {/* Closed Eyelid Lines - only visible when covering eyes */}
                <g style={{ opacity: isCoveringEyes ? 1 : 0 }} className="transition-opacity duration-300">
                   <path d="M55 85 Q70 100 85 85" fill="none" stroke="#475569" strokeWidth="3" strokeLinecap="round" />
                   <path d="M115 85 Q130 100 145 85" fill="none" stroke="#475569" strokeWidth="3" strokeLinecap="round" />
                </g>
              </g>

              {/* Beak */}
              <path d="M90 100 L110 100 L100 125 Z" fill="#f59e0b" />

              {/* Left Wing */}
              <path 
                d="M35 100 Q10 130 35 170" 
                fill="none" 
                stroke="#475569" 
                strokeWidth="15" 
                strokeLinecap="round"
                className="transition-all duration-500 ease-in-out"
                style={{ 
                    transformOrigin: '40px 100px',
                    transform: isCoveringEyes ? 'rotate(110deg) translate(20px, -40px)' : (isPeeking ? 'rotate(45deg) translate(10px, -20px)' : 'rotate(0deg)')
                }}
              />
              
              {/* Right Wing */}
              <path 
                d="M165 100 Q190 130 165 170" 
                fill="none" 
                stroke="#475569" 
                strokeWidth="15" 
                strokeLinecap="round"
                className="transition-all duration-500 ease-in-out"
                style={{ 
                    transformOrigin: '160px 100px',
                    transform: isCoveringEyes ? 'rotate(-110deg) translate(-20px, -40px)' : (isPeeking ? 'rotate(-45deg) translate(-10px, -20px)' : 'rotate(0deg)')
                }}
              />
            </svg>
          </div>
        </div>

        <div className="bg-bg-card border border-border-default rounded-2xl shadow-xl overflow-hidden animate-slide-up relative">
          <div className="p-8 pt-10">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-text-primary mb-2">Welcome Back</h1>
              <p className="text-text-secondary">Please enter your details to sign in</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-text-secondary ml-1">Email Address</label>
                <div className="relative group">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setIsEmailFocused(true)}
                    onBlur={() => setIsEmailFocused(false)}
                    className="w-full px-4 py-3 bg-bg-input border border-border-default rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent transition-all outline-none text-text-primary"
                    placeholder="owner@demo.com"
                    required
                  />
                  <div className="absolute inset-y-0 right-3 flex items-center opacity-0 group-focus-within:opacity-100 transition-opacity">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-primary" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                      <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-text-secondary ml-1">Password</label>
                <div className="relative group">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setIsPasswordFocused(true)}
                    onBlur={() => setIsPasswordFocused(false)}
                    className="w-full px-4 py-3 bg-bg-input border border-border-default rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent transition-all outline-none text-text-primary pr-12"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-3 flex items-center text-text-secondary hover:text-primary transition-colors focus:outline-none"
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
                        <path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.666-.105 2.454-.303z" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                        <path fillRule="evenodd" d="M.458 10C1.274 5.943 5.065 3 10 3s8.726 2.943 9.542 7c-.816 4.057-4.542 7-9.542 7s-8.726-2.943-9.542-7zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 text-red-500 p-3 rounded-lg text-sm text-center animate-shake">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-between text-sm px-1">
                <label className="flex items-center cursor-pointer text-text-secondary hover:text-primary transition-colors">
                  <input type="checkbox" className="mr-2 rounded border-border-default text-primary focus:ring-primary" />
                  Remember me
                </label>
                <a href="#" className="text-primary hover:underline font-medium">Forgot password?</a>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-primary hover:bg-accent-gold-hover text-white font-bold py-3.5 rounded-xl shadow-lg shadow-primary/20 transform transition hover:-translate-y-0.5 active:translate-y-0 duration-200 flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            <div className="mt-8 text-center">
              <p className="text-text-secondary text-sm">
                Don't have an account?{' '}
                <a href="#" className="text-primary font-bold hover:underline">
                  Contact Admin
                </a>
              </p>
            </div>
          </div>
        </div>
        
        <p className="mt-8 text-center text-text-secondary text-xs opacity-50 uppercase tracking-widest">
          © 2026 VIP Anti-Damping Systems
        </p>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .animate-shake {
          animation: shake 0.2s ease-in-out 0s 2;
        }
      `}} />
    </div>
  )
}

export default Login
