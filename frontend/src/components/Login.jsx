import { useState } from 'react'
import { API_URL } from '../config'

export default function Login({ onLogin, sessionExpired = false }) {
  const [isRegistering, setIsRegistering] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const endpoint = isRegistering ? 'register' : 'login'
    try {
      const res = await fetch(`${API_URL}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const data = await res.json()
      if (res.ok) {
        if (isRegistering) { setIsRegistering(false); setError('Registration successful! Please login.') }
        else onLogin(data)
      } else {
        setError(data.error || 'Something went wrong')
      }
    } catch (err) {
      setError('Connection failed')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%',
    background: 'var(--fill-secondary)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    padding: '14px 16px',
    fontSize: 'var(--text-body)',
    color: 'var(--text-app)',
    outline: 'none',
    transition: `box-shadow var(--duration-fast) var(--ease-default)`,
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-app)', padding: 'var(--space-4)', fontFamily: 'var(--font-sans)' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        {/* Logo + Title */}
        <div className="text-center" style={{ marginBottom: 'var(--space-8)' }}>
          <img src="/favicon.svg" alt="Atrium" className="mx-auto" style={{ width: '56px', height: '56px', marginBottom: 'var(--space-4)', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.2))' }} />
          <h1 style={{ fontSize: 'var(--text-title1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', letterSpacing: 'var(--tracking-tight)' }}>Atrium</h1>
          <p style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
            {isRegistering ? 'Create your account' : 'Sign in to continue'}
          </p>
        </div>

        {/* Session-expired explanation (ui-copy-glossary-001): AuthContext has
            passed this prop since bug-auth-expiry-detect-001, but it was never
            rendered — an automatic logout looked like the app forgot you. */}
        {sessionExpired && !isRegistering && (
          <div
            data-testid="session-expired-banner"
            className="text-center"
            style={{
              marginBottom: 'var(--space-4)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-md)',
              background: 'color-mix(in srgb, var(--apple-orange) 10%, transparent)',
              border: '0.5px solid color-mix(in srgb, var(--apple-orange) 30%, transparent)',
              color: 'var(--apple-orange)',
              fontSize: 'var(--text-caption1)',
            }}
          >
            Your session ended — sign in again to continue. Nothing was lost.
          </div>
        )}

        {/* Card */}
        <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: 'var(--border-hairline)', padding: 'var(--space-8)' }}>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <label style={{ display: 'block', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>Username</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                style={inputStyle}
                onFocus={e => e.target.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-app) 30%, transparent)'}
                onBlur={e => e.target.style.boxShadow = 'none'}
              />
            </div>

            <div style={{ marginBottom: 'var(--space-6)' }}>
              <label style={{ display: 'block', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                style={inputStyle}
                onFocus={e => e.target.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-app) 30%, transparent)'}
                onBlur={e => e.target.style.boxShadow = 'none'}
              />
            </div>

            {error && (
              <div style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-caption1)',
                fontWeight: 'var(--font-medium)',
                textAlign: 'center',
                marginBottom: 'var(--space-5)',
                color: error.includes('successful') ? 'var(--apple-green)' : 'var(--apple-red)',
                background: error.includes('successful') ? 'color-mix(in srgb, var(--apple-green) 10%, transparent)' : 'color-mix(in srgb, var(--apple-red) 10%, transparent)',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="apple-press"
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-body)',
                fontWeight: 'var(--font-semibold)',
                color: 'white',
                background: 'var(--accent-app)',
                border: 'none',
                cursor: loading ? 'wait' : 'pointer',
                opacity: loading ? 0.6 : 1,
                transition: `all var(--duration-fast) var(--ease-default)`,
              }}
            >
              {loading ? 'Signing in...' : (isRegistering ? 'Create Account' : 'Sign In')}
            </button>
          </form>

          <div className="text-center" style={{ marginTop: 'var(--space-6)' }}>
            <button
              onClick={() => { setIsRegistering(!isRegistering); setError('') }}
              className="apple-press"
              style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--accent-app)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              {isRegistering ? 'Already have an account? Sign In' : "Don't have an account? Create one"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
