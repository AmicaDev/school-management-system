import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../services/api'
import { flush, onQueueChange, queued } from '../offline/queue'
import { useAuth } from './AuthContext'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

/** Theme, school profile, connectivity and the offline sync status banner. */
export function AppProvider({ children }) {
  const { user } = useAuth()
  const [theme, setTheme] = useState(() => localStorage.getItem('sms.theme') || 'light')
  const [school, setSchool] = useState(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [syncState, setSyncState] = useState('') // '' | OFFLINE | SYNCING | COMPLETE | ERROR
  const [pending, setPending] = useState(0)
  const timer = useRef()

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('sms.theme', theme) }, [theme])

  useEffect(() => {
    if (user && user.role !== 'DEVELOPER') api.get('/academics/school-profile/').then((r) => setSchool(r.data)).catch(() => {})
  }, [user])

  const refreshCount = useCallback(() => queued().then((q) => setPending(q.filter((x) => x.state === 'pending').length)).catch(() => {}), [])

  const sync = useCallback(async () => {
    if (!navigator.onLine || !localStorage.getItem('sms.tokens')) return
    const q = await queued().catch(() => [])
    if (!q.some((x) => x.state === 'pending')) return
    setSyncState('SYNCING')
    const r = await flush()
    clearTimeout(timer.current)
    if (r.failed) setSyncState('ERROR')
    else if (r.stopped) setSyncState(navigator.onLine ? '' : 'OFFLINE')
    else { setSyncState('COMPLETE'); timer.current = setTimeout(() => setSyncState(navigator.onLine ? '' : 'OFFLINE'), 3500) }
    refreshCount()
  }, [refreshCount])

  useEffect(() => {
    const up = () => { setOnline(true); setSyncState(''); sync() }
    const down = () => { setOnline(false); setSyncState('OFFLINE') }
    window.addEventListener('online', up); window.addEventListener('offline', down)
    if (!navigator.onLine) setSyncState('OFFLINE')
    const off = onQueueChange(() => refreshCount())
    refreshCount(); sync()
    const iv = setInterval(sync, 30000)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); off(); clearInterval(iv) }
  }, [sync, refreshCount])

  const value = useMemo(() => ({ theme, toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')), school, setSchool, online, syncState, pending, sync, refreshCount }),
    [theme, school, online, syncState, pending, sync, refreshCount])
  return (
    <Ctx.Provider value={value}>
      {children}
      {syncState && <div className={`sync-bar ${syncState}`} role="status">{{ OFFLINE: 'OFFLINE', SYNCING: 'SYNCING...', COMPLETE: 'SYNC COMPLETE', ERROR: 'SYNC ERROR' }[syncState]}{pending ? ` (${pending} pending)` : ''}</div>}
    </Ctx.Provider>
  )
}
