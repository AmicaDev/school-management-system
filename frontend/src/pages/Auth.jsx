import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api, errorMessage, fieldErrors } from '../services/api'
import { HOME, useAuth } from '../contexts/AuthContext'
import { Alert } from '../components/ui'

const ROLES = [['ADMIN', 'School management'], ['TEACHER', 'Academic operations'], ['PARENT', 'Child monitoring and communication'], ['DEVELOPER', 'System maintenance and technical monitoring']]

function AuthFrame({ title, children, side = true }) {
  return (
    <div className="auth-wrap">
      {side && <aside className="auth-side">
        <Link to="/" className="brand" style={{ color: 'inherit' }}><img src="/icon.svg" alt="" /><span>School Management System</span></Link>
        <h2>One sign-in for every role</h2>
        <ul className="role-list">{ROLES.map(([r, d]) => <li key={r}><b>{r}</b><br /><small>{d}</small></li>)}</ul>
        <small>Your role is determined by the server after you sign in.</small>
      </aside>}
      <main className="auth-main"><div className="auth-card stack"><h1>{title}</h1>{children}</div></main>
    </div>
  )
}

export function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [f, setF] = useState({ username: '', password: '' })
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
      <p className="muted">Parents can sign in with their child's index number. Teachers can sign in with their teaching subject and subject code.</p>
      <Alert>{err}</Alert>
      <form onSubmit={submit} noValidate>
        <div className="field"><label htmlFor="u">Username, student index number, or subject</label><input id="u" className="input" autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} /></div>
        <div className="field"><label htmlFor="p">Password or subject code</label><input id="p" type="password" className="input" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        <button className="btn primary lg" style={{ width: '100%' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p><Link to="/forgot-password">Forgot password?</Link> · <Link to="/register">Need an account?</Link></p>
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
    <AuthFrame title="Reset your password" side={false}>
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
