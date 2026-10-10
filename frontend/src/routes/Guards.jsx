import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { HOME, useAuth } from '../contexts/AuthContext'
import { Skeleton } from '../components/ui'

/** Frontend route protection (UX only - the API enforces the same rules). */
export function RequireRole({ roles }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="content"><Skeleton /></div>
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  if (!roles.includes(user.role)) return <Navigate to="/403" replace />
  return <Outlet />
}

export function RedirectIfAuthed({ children }) {
  const { user } = useAuth()
  return user ? <Navigate to={HOME[user.role]} replace /> : children
}
