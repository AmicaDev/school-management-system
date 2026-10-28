import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, errorMessage } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { Alert } from '../components/ui'
import badgeImg from '../assets/IMG-20261010-WA0012.jpg'
import coatImg from '../assets/Coat Of arm.png'

export default function BursarLogin() {
  const { login, logout } = useAuth()
  const nav = useNavigate()
  const [f, setF] = useState({ username: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      const user = await login(f.username, f.password)
      if (user.role === 'BURSAR') {
        nav('/bursar', { replace: true })
      } else {
        await logout()
        setErr('Access restricted: This portal is reserved strictly for Bursars.')
      }
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-stripes top" aria-hidden="true">
        <span className="stripe s-black" />
        <span className="stripe s-yellow" />
        <span className="stripe s-red" />
      </div>

      <aside className="auth-side" style={{ background: '#0e3a24' }}>
        <div className="auth-emblem" aria-hidden="true">
          <img src={badgeImg} alt="School Badge" />
        </div>
        <div className="auth-banner" style={{ color: '#85e3a8' }}>
          ACCOUNTS & CASH OFFICE
        </div>
        <small className="auth-roles" style={{ color: '#a3cfbb' }}>
          BURSAR & FINANCE PORTAL
        </small>
      </aside>

      <main className="auth-main">
        <div className="auth-watermark" style={{ backgroundImage: `url(${coatImg})` }} aria-hidden="true" />
        <div className="auth-card stack" style={{ maxWidth: 440 }}>
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 32 }}>💳</span>
            <h1 style={{ margin: '8px 0 4px 0' }}>Bursar Portal Login</h1>
            <p className="muted" style={{ fontSize: 13 }}>
              Enter your bursar credentials to access fee collections, accounts, and official receipts.
            </p>
          </div>

          {err && <Alert kind="error">{err}</Alert>}

          <form onSubmit={handleSubmit} className="stack" style={{ gap: 14 }}>
            <div className="field">
              <label htmlFor="bursar-username">Username or Email *</label>
              <input
                id="bursar-username"
                className="input"
                autoComplete="username"
                required
                autoFocus
                value={f.username}
                onChange={(e) => setF({ ...f, username: e.target.value })}
                placeholder="bursar_username"
              />
            </div>

            <div className="field">
              <label htmlFor="bursar-password">Password *</label>
              <div className="pw-input-wrap">
                <input
                  id="bursar-password"
                  className="input"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={f.password}
                  onChange={(e) => setF({ ...f, password: e.target.value })}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="pw-eye"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? '👁️' : '🙈'}
                </button>
              </div>
            </div>

            <button className="btn primary block lg" type="submit" disabled={busy}>
              {busy ? 'Authenticating…' : 'Sign In to Finance Portal'}
            </button>
          </form>

          <div className="row spread" style={{ marginTop: 16, fontSize: 13, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <Link to="/login" className="muted">
              ← Main School Login
            </Link>
            <Link to="/forgot-password" className="muted">
              Forgot password?
            </Link>
          </div>
        </div>
      </main>

      <div className="auth-stripes bottom" aria-hidden="true">
        <span className="stripe s-black" />
        <span className="stripe s-yellow" />
        <span className="stripe s-red" />
      </div>
    </div>
  )
}

