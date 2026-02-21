import { useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import GlitchText from '../ui/GlitchText'
import MatrixRain from '../ui/MatrixRain'

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const { login, register, error, clearError } = useAuthStore()
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (isLogin) {
        await login(email, password)
      } else {
        await register(email, password, displayName)
      }
    } catch {
      // error already in store
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <MatrixRain />

      <div className="glass rounded-2xl p-8 w-full max-w-md mx-4 relative z-10 animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <GlitchText
            text="DIZKORD"
            className="text-4xl font-bold font-display text-neon-green"
          />
          <p className="text-text-muted text-sm mt-2 font-mono">
            {isLogin ? '// welcome back, legend' : '// join the void'}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-neon-pink/10 border border-neon-pink/30 rounded-lg p-3 mb-4 text-neon-pink text-sm animate-fade-in">
            {error}
            <button onClick={clearError} className="float-right text-text-muted hover:text-white">
              x
            </button>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div className="animate-fade-in">
              <label className="block text-text-secondary text-xs font-mono mb-1 uppercase tracking-wider">
                display name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-4 py-3 rounded-lg text-sm"
                placeholder="ur gamer tag"
                required={!isLogin}
              />
            </div>
          )}

          <div>
            <label className="block text-text-secondary text-xs font-mono mb-1 uppercase tracking-wider">
              email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 rounded-lg text-sm"
              placeholder="you@based.gg"
              required
            />
          </div>

          <div>
            <label className="block text-text-secondary text-xs font-mono mb-1 uppercase tracking-wider">
              password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg text-sm"
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg font-display font-semibold text-void bg-neon-green
                       hover:bg-neon-green/90 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-200 hover:shadow-[0_0_20px_rgba(0,255,136,0.4)]"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-void border-t-transparent rounded-full animate-spin" />
                {isLogin ? 'entering...' : 'creating...'}
              </span>
            ) : (
              isLogin ? 'ENTER THE VOID' : 'JOIN THE VOID'
            )}
          </button>
        </form>

        {/* Toggle */}
        <div className="mt-6 text-center">
          <button
            onClick={() => { setIsLogin(!isLogin); clearError() }}
            className="text-text-secondary text-sm hover:text-neon-green transition-colors font-mono"
          >
            {isLogin ? "// don't have an account? sign up" : '// already based? log in'}
          </button>
        </div>

        {/* Footer vibe */}
        <div className="mt-8 text-center text-text-muted text-xs font-mono">
          <span className="text-neon-green">$</span> freedommaxxing since 2026
        </div>
      </div>
    </div>
  )
}
