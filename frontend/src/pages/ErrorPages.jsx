import { Link, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '../services/api'
import { HOME, useAuth } from '../contexts/AuthContext'

function Screen({ code, title, text, children }) {
  return (
    <div className="state" style={{ minHeight: '70vh', display: 'grid', placeContent: 'center' }}>
      <div style={{ fontSize: 72, fontWeight: 800, color: 'var(--primary)', lineHeight: 1 }}>{code}</div>
      <h2>{title}</h2><p style={{ maxWidth: 420 }}>{text}</p><div className="row" style={{ justifyContent: 'center' }}>{children}</div>
    </div>
  )
}
export function NotFound() { const { user } = useAuth(); return <Screen code="404" title="Page not found" text="The page you are looking for does not exist or has moved."><Link className="btn primary" to={user ? HOME[user.role] : '/'}>Go home</Link></Screen> }
export function Forbidden() { const { user } = useAuth(); return <Screen code="403" title="Access denied" text="Your account does not have permission to view this area."><Link className="btn primary" to={user ? HOME[user.role] : '/login'}>Back to my dashboard</Link></Screen> }
export function ServerError({ onRetry }) { return <Screen code="500" title="Something went wrong" text="An unexpected error occurred and has been reported to the system administrators."><button className="btn primary" onClick={onRetry || (() => location.assign('/'))}>Reload</button></Screen> }
export function OfflinePage() { return <Screen code="⌁" title="Connection unavailable" text="You appear to be offline. Attendance, marks and enquiries you save will be sent automatically when you reconnect."><button className="btn primary" onClick={() => location.reload()}>Try again</button></Screen> }
export function Maintenance() {
  const nav = useNavigate()
  const [checking, setChecking] = useState(false)
  const check = async () => { setChecking(true); try { const { data } = await api.get('/developer/status/'); if (!data.maintenance) nav('/') } finally { setChecking(false) } }
  useEffect(() => { const t = setInterval(check, 30000); return () => clearInterval(t) }, [])
  return <Screen code="🛠" title="Temporarily unavailable" text="The system is undergoing scheduled maintenance. Please check back shortly."><button className="btn primary" onClick={check} disabled={checking}>Check again</button></Screen>
}
