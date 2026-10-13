import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, tokens } from '../services/api'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export const HOME = { ADMIN: '/admin', TEACHER: '/teacher', PARENT: '/parent', DEVELOPER: '/developer' }

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(!!tokens.get())

  const clearApiCache = () => { if (window.caches) caches.keys().then((ks) => ks.filter((k) => k.endsWith('-api')).forEach((k) => caches.delete(k))) }

  const logout = useCallback(async () => {
    const t = tokens.get()
    try { if (t?.refresh) await api.post('/auth/logout/', { refresh: t.refresh }) } catch { /* already invalid */ }
    tokens.clear(); clearApiCache(); setUser(null)
  }, [])

  useEffect(() => {
    const onLogout = () => { clearApiCache(); setUser(null) }
    window.addEventListener('sms:logout', onLogout)
    if (tokens.get()) {
      api.get('/auth/me/').then((r) => setUser(r.data)).catch((e) => { if (e.response) tokens.clear() }).finally(() => setLoading(false))
    }
    return () => window.removeEventListener('sms:logout', onLogout)
  }, [])

  const login = useCallback(async (username, password) => {
    const { data } = await api.post('/auth/login/', { username, password }, { timeout: 90000 })
    tokens.set({ access: data.access, refresh: data.refresh })
    setUser(data.user)
    return data.user
  }, [])

  const value = useMemo(() => ({ user, loading, login, logout, setUser }), [user, loading, login, logout])
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
