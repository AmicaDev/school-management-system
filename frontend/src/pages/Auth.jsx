import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api, errorMessage, fieldErrors } from '../services/api'
import { HOME, useAuth } from '../contexts/AuthContext'
import { Alert } from '../components/ui'
import badgeImg from '../assets/IMG-20261010-WA0012.jpg'
import coatImg from '../assets/Coat Of arm.png'

const ROLES = ['ADMIN', 'PARENTS', 'TEACHERS', 'DEVELOPER']

function EyeToggle({ show, onToggle }) {
  return (
    <button type="button" className="pw-eye" onClick={onToggle} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
      {show ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
      )}
    </button>
  )
}

function AuthFrame({ title, children, side = true }) {
  return (
    <div className="auth-wrap">
      <div className="auth-stripes top" aria-hidden="true">
        <span className="stripe s-black" /><span className="stripe s-yellow" /><span className="stripe s-red" />
      </div>
      {side && <aside className="auth-side">
        <div className="auth-emblem" aria-hidden="true">
          <img src={badgeImg} alt="Kiyingi Memorial Secondary School" />
        </div>
        <div className="auth-banner">SEARCH FOR WISDOM</div>
        <small className="auth-roles">ADMIN, PARENTS, TEACHERS, DEVELOPER</small>
      </aside>}
      <main className="auth-main">
        <div className="auth-watermark" style={{ backgroundImage: `url(${coatImg})` }} aria-hidden="true" />
        <div className="auth-card stack">
          <h1>{title}</h1>
          {children}
        </div>
      </main>
      <div className="auth-stripes bottom" aria-hidden="true">
        <span className="stripe s-black" /><span className="stripe s-yellow" /><span className="stripe s-red" />
      </div>
    </div>
  )
}

export function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [f, setF] = useState({ username: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (!f.username || !f.password) return setErr('Enter your username (or student index number) and password.')
    setBusy(true); setErr('')
    try {
      const u = await login(f.username.trim(), f.password)
      const from = loc.state?.from
      nav(from && from.startsWith(HOME[u.role]) ? from : HOME[u.role], { replace: true })
    } catch (e2) { setErr(e2.response?.status === 401 ? 'Incorrect username or password.' : errorMessage(e2)); setBusy(false) }
  }
  return (
    <AuthFrame title="Sign in">
      <p className="auth-sub">Parents can sign in with their child's index number. Teachers can sign in with their teaching subject and subject code.</p>
      <Alert>{err}</Alert>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="u">Username, student index number, or subject</label>
          <input id="u" className="input" autoComplete="username" placeholder="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="p">Password or subject code</label>
          <div className="pw-wrap">
            <input id="p" type={showPw ? 'text' : 'password'} className="input" autoComplete="current-password" placeholder="Password code" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            <EyeToggle show={showPw} onToggle={() => setShowPw((s) => !s)} />
          </div>
        </div>
        <button className="btn primary auth-btn" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="auth-links"><Link to="/forgot-password">Forgot password</Link> · <Link to="/register">Need an account?</Link></p>
    </AuthFrame>
  )
}

export function Register() {
return (
    <AuthFrame title="Request an account">
      <div className="alert info">Accounts are created by your school administrator so that every user is verified.</div>
      <p><b>Parents:</b> ask the school office for your child's index number and a temporary password.</p>
      <p><b>Teachers:</b> sign in using your teaching subject (e.g. Math) and your subject code (e.g. P220), or your assigned account username.</p>
      <Link to="/login" className="btn primary">Back to sign in</Link>
    </AuthFrame>
  )
}

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault(); setErr('')
    try { await api.post('/auth/password-reset/', { email }); setDone(true) } catch (x) { setErr(errorMessage(x)) }
  }
  return (
    <AuthFrame title="Reset your password">
      {done ? <Alert kind="success">If that address is registered, a reset link is on its way.</Alert> : (
        <form onSubmit={submit}><Alert>{err}</Alert>
          <div className="field"><label htmlFor="e">Email address</label><input id="e" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <button className="btn primary" style={{ width: '100%' }}>Send reset link</button></form>)}
      <Link to="/login">Back to sign in</Link>
    </AuthFrame>
  )
}

export function ResetPassword() {
  const [sp] = useSearchParams()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState({ kind: 'error', text: '' })
  const submit = async (e) => {
    e.preventDefault()
    if (pw !== pw2) return setMsg({ kind: 'error', text: 'Passwords do not match.' })
    try {
      await api.post('/auth/password-reset/confirm/', { uid: sp.get('uid'), token: sp.get('token'), new_password: pw })
      setMsg({ kind: 'success', text: 'Password updated. You can now sign in.' })
    } catch (x) { setMsg({ kind: 'error', text: Object.values(fieldErrors(x))[0] || errorMessage(x) }) }
  }
  return (
    <AuthFrame title="Choose a new password" side={false}>
      <Alert kind={msg.kind}>{msg.text}</Alert>
      <form onSubmit={submit}>
        <div className="field"><label htmlFor="n1">New password</label><input id="n1" type="password" className="input" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></div>
        <div className="field"><label htmlFor="n2">Confirm password</label><input id="n2" type="password" className="input" required value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></div>
        <button className="btn primary" style={{ width: '100%' }}>Update password</button>
      </form>
      <Link to="/login">Back to sign in</Link>
    </AuthFrame>
  )
}

export function Logout() {
  const { logout } = useAuth()
  const nav = useNavigate()
  useState(() => { logout().finally(() => nav('/login', { replace: true })) })
  return <div className="state"><span className="spinner" /> Signing out…</div>
}
