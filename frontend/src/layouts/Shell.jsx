import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useApp } from '../contexts/AppContext'
import { api, errorMessage, mediaUrl } from '../services/api'
import { Modal, Skeleton, Tabs } from '../components/ui'

export const NAVS = {
  ADMIN: [
    ['Overview', '/admin', '▦', true], ['sec', 'People'],
    ['Students', '/admin/students', '🎓'], ['Parents', '/admin/parents', '👪'], ['Teachers', '/admin/teachers', '👩‍🏫'], ['Staff', '/admin/staff', '🧑‍💼'], ['Recycle bin', '/admin/recycle-bin', '♻'],
    ['sec', 'Academics'], ['Classes & streams', '/admin/classes', '🏫'], ['Subjects', '/admin/subjects', '📘'], ['Teacher assignments', '/admin/assignments', '📋'], ['Years & terms', '/admin/academics', '📅'],
    ['Grading', '/admin/grading', '🅰'], ['Timetable', '/admin/timetable', '🕒'], ['Events', '/admin/events', '📣'],
    ['sec', 'Operations'], ['Attendance', '/admin/attendance', '✔'], ['Results', '/admin/results', '📝'], ['Reports', '/admin/reports', '🖨'],
    ['Analytics', '/admin/analytics', '📈'], ['Enquiries', '/admin/enquiries', '✉'], ['Notifications', '/admin/notifications', '🔔'],
    ['sec', 'Finance & Fees'],
    ['Finance overview', '/admin/finance', '💰'],
    ['Bursars & Cashiers', '/admin/bursars', '💼'],
    ['Record payment', '/admin/finance/payments/new', '💳'],
    ['Student accounts', '/admin/finance/accounts', '👥'],
    ['Receipts & history', '/admin/finance/receipts', '🧾'],
    ['Fee structures', '/admin/finance/structures', '📋'],
    ['Expenses', '/admin/finance/expenses', '📉'],
    ['Financial reports', '/admin/finance/reports', '📊'],
    ['sec', 'System'], ['School profile', '/admin/settings', '⚙'], ['Users', '/admin/users', '🔑'], ['Audit logs', '/admin/audit', '🛡'],
  ],
  BURSAR: [
    ['Dashboard', '/bursar', '▦', true],
    ['sec', 'Cashier & Fees'],
    ['Record payment', '/bursar/payments/new', '💳'],
    ['Student accounts', '/bursar/accounts', '👥'],
    ['Receipts & history', '/bursar/receipts', '🧾'],
    ['My collections', '/bursar/my-collections', '💵'],
    ['sec', 'Expenditure & Setup'],
    ['Fee structures', '/bursar/structures', '📋'],
    ['School expenses', '/bursar/expenses', '📉'],
    ['Financial reports', '/bursar/reports', '📊'],
    ['sec', 'Communication'],
    ['Notifications', '/bursar/notifications', '🔔'],
  ],
  TEACHER: [
    ['Dashboard', '/teacher', '▦', true], ['My classes', '/teacher/classes', '🏫'], ['Attendance', '/teacher/attendance', '✔'], ['Marks', '/teacher/marks', '📝'],
    ['Assignments', '/teacher/assignments', '📋'], ['Timetable', '/teacher/timetable', '🕒'], ['Enquiries', '/teacher/enquiries', '✉'], ['Notifications', '/teacher/notifications', '🔔'],
  ],
  PARENT: [
    ['Dashboard', '/parent', '▦', true], ['Children', '/parent/children', '🎓'], ['Attendance', '/parent/attendance', '✔'], ['Results', '/parent/results', '📝'],
    ['Performance', '/parent/performance', '📈'], ['Timetable', '/parent/timetable', '🕒'], ['Events', '/parent/events', '📣'],
    ['Notifications', '/parent/notifications', '🔔'], ['Enquiries', '/parent/enquiries', '✉'], ['My profile', '/parent/profile', '👤'],
  ],
  DEVELOPER: [
    ['Dashboard', '/developer', '▦', true], ['Errors', '/developer/errors', '🐞'], ['Logs', '/developer/logs', '📜'], ['Tests', '/developer/tests', '🧪'],
    ['Database', '/developer/database', '🗄'], ['API', '/developer/api', '🔌'], ['PWA', '/developer/pwa', '📲'], ['Sync', '/developer/sync', '🔄'],
    ['Admin accounts', '/developer/admin-accounts', '🔑'], ['Maintenance', '/developer/maintenance', '🛠'], ['Updates', '/developer/updates', '⬆'], ['Backup', '/developer/backup', '💾'], ['Audit', '/developer/audit', '🛡'],
  ],
}

export default function Shell() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme, school, online } = useApp()
  const nav = NAVS[user.role]
  const dev = user.role === 'DEVELOPER'
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sms.collapsed') === '1')
  const [menu, setMenu] = useState(false)
  const [unread, setUnread] = useState(0)
  const [q, setQ] = useState('')
  const [showChangePw, setShowChangePw] = useState(false)
  const [pwForm, setPwForm] = useState({ old_password: '', new_password: '', confirm: '' })
  const [showOldPw, setShowOldPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [pwBusy, setPwBusy] = useState(false)
  const [pwErr, setPwErr] = useState('')
  const [pwSuccess, setPwSuccess] = useState('')
  const [refreshToast, setRefreshToast] = useState(false)
  const [notifPerm, setNotifPerm] = useState(() => (typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'))
  const loc = useLocation()
  const navigate = useNavigate()
  const base = `/${user.role.toLowerCase()}`

  useEffect(() => { setOpen(false); setMenu(false) }, [loc.pathname])
  useEffect(() => { localStorage.setItem('sms.collapsed', collapsed ? '1' : '0') }, [collapsed])
  useEffect(() => {
    if (dev || !online) return undefined
    const load = () => api.get('/notifications/unread_count/').then((r) => setUnread(r.data.count)).catch(() => {})
    load(); const iv = setInterval(load, 60000)
    return () => clearInterval(iv)
  }, [dev, online, loc.pathname])

  const handleBrowserAlert = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      alert('Browser notifications are not supported on this browser.')
      return
    }
    if (Notification.permission === 'granted') {
      try {
        new Notification(school?.name || 'School Management System', {
          body: 'Browser alert notifications are enabled and functioning properly.',
          icon: school?.logo ? mediaUrl(school.logo) : '/icon-192.png',
        })
      } catch {
        alert('Browser alerts are active for this device.')
      }
    } else {
      try {
        const perm = await Notification.requestPermission()
        setNotifPerm(perm)
        if (perm === 'granted') {
          new Notification(school?.name || 'School Management System', {
            body: 'Browser alert notifications are now active!',
            icon: school?.logo ? mediaUrl(school.logo) : '/icon-192.png',
          })
        }
      } catch {
        // ignore
      }
    }
  }

  const handleInPageRefresh = () => {
    window.dispatchEvent(new CustomEvent('sms:refresh'))
    if (!dev && online) {
      api.get('/notifications/unread_count/').then((r) => setUnread(r.data.count)).catch(() => {})
    }
    setRefreshToast(true)
    setTimeout(() => setRefreshToast(false), 2400)
    setMenu(false)
  }

  const submitChangePw = async (e) => {
    e.preventDefault()
    setPwErr('')
    setPwSuccess('')
    if (pwForm.new_password !== pwForm.confirm) {
      return setPwErr('New passwords do not match.')
    }
    if (pwForm.new_password.length < 8) {
      return setPwErr('New password must be at least 8 characters long.')
    }
    setPwBusy(true)
    try {
      await api.post('/auth/change-password/', {
        old_password: pwForm.old_password,
        new_password: pwForm.new_password,
      })
      setPwSuccess('Password successfully updated!')
      setPwForm({ old_password: '', new_password: '', confirm: '' })
      setTimeout(() => setShowChangePw(false), 1600)
    } catch (err) {
      setPwErr(err.response?.data?.old_password?.[0] || err.response?.data?.new_password?.[0] || errorMessage(err) || 'Failed to update password.')
    } finally {
      setPwBusy(false)
    }
  }

  const title = nav.filter((n) => n[0] !== 'sec').reduce((best, n) => (loc.pathname.startsWith(n[1]) && (!best || n[1].length > best[1].length) ? n : best), null)?.[0] || 'Student'
  const submitSearch = (e) => { e.preventDefault(); navigate(user.role === 'ADMIN' ? `/admin/students?q=${encodeURIComponent(q)}` : `/teacher/classes?q=${encodeURIComponent(q)}`) }

  // Bottom tabs for smartphones: Reports, Teachers, Attendance, Results
  const MOBILE_TABS = [
    { label: 'Teachers', to: '/admin/teachers', icon: '👩‍🏫' },
    { label: 'Attendance', to: '/admin/attendance', icon: '✔' },
    { label: 'Results', to: '/admin/results', icon: '📝' },
    { label: 'Reports', to: '/admin/reports', icon: '🖨' },
  ]
  const activeTab = MOBILE_TABS.find((t) => loc.pathname === t.to || loc.pathname.startsWith(t.to + '/'))?.label

  const isMobile = () => window.matchMedia('(max-width: 768px)').matches
  const [mobile, setMobile] = useState(isMobile())
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)')
    const handler = () => setMobile(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}${dev ? ' dev-shell' : ''}`}>
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Main navigation">
        <NavLink to={base} className="brand">
          {school?.logo ? <img src={mediaUrl(school.logo)} alt="" /> : <img src="/icon.svg" alt="" />}
          <span>{dev ? 'System Console' : school?.name || 'School SMS'}</span>
        </NavLink>
        <nav>
          {nav.map((n, i) => n[0] === 'sec'
            ? <div key={i} className="nav-sec">{n[1]}</div>
            : <NavLink key={n[1]} to={n[1]} end={!!n[3]} className="nav-link" title={n[0]}><span className="nav-ic" aria-hidden>{n[2]}</span><span className="nav-label">{n[0]}</span></NavLink>)}
        </nav>
        <button className="btn ghost sm collapse-btn" style={{ marginTop: 'auto' }} onClick={() => setCollapsed((c) => !c)} aria-label="Collapse sidebar">{collapsed ? '»' : '« Collapse'}</button>
      </aside>
      {open && <div className="overlay" style={{ zIndex: 25 }} onClick={() => setOpen(false)} />}
      <div className="main">
        <div className="school-bg-watermark" style={school?.logo ? { backgroundImage: `url(${mediaUrl(school.logo)})` } : undefined} aria-hidden="true" />
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
          <h1>{title}</h1>
          {(user.role === 'ADMIN' || user.role === 'TEACHER') && (
            <form onSubmit={submitSearch} role="search"><input className="input search" placeholder="Search students…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search students" /></form>
          )}
          {!dev && <button className="icon-btn" onClick={() => navigate(`${base}/notifications`)} aria-label={`Notifications, ${unread} unread`}>🔔{unread > 0 && <span className="dot">{unread > 99 ? '99+' : unread}</span>}</button>}
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme">{theme === 'light' ? '🌙' : '☀'}</button>
          <div className="menu-wrap">
            <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="Profile menu" aria-expanded={menu}>👤</button>
            {menu && (
              <>
                <div className="overlay" style={{ background: 'transparent', zIndex: 45 }} onClick={() => setMenu(false)} />
                <div className="settings-menu" role="menu">
                  <div className="settings-menu-head">
                    <b>{user.full_name}</b>
                    <div className="muted" style={{ fontSize: 12 }}>{user.role} • {user.email || user.username}</div>
                  </div>
                  <div className="settings-menu-title">Setting</div>
                  <div className="settings-menu-list">
                    <button type="button" className="settings-menu-item" onClick={handleBrowserAlert}>
                      <span>🔔 1. Browser alert</span>
                      <span className="badge" style={{ fontSize: 11, background: notifPerm === 'granted' ? '#2e7d32' : undefined, color: notifPerm === 'granted' ? '#fff' : undefined }}>
                        {notifPerm === 'granted' ? 'Enabled' : notifPerm === 'denied' ? 'Blocked' : 'Enable'}
                      </span>
                    </button>
                    <button type="button" className="settings-menu-item" onClick={() => { setShowChangePw(true); setMenu(false); setPwErr(''); setPwSuccess('') }}>
                      <span>🔑 2. Changing password</span>
                      <span className="muted" style={{ fontSize: 12 }}>Change ›</span>
                    </button>
                    <button type="button" className="settings-menu-item" onClick={toggleTheme}>
                      <span>{theme === 'dark' ? '☀ 3. Light mode' : '🌙 3. Dark mode'}</span>
                      <span className="badge" style={{ fontSize: 11 }}>{theme === 'dark' ? 'Dark' : 'Light'}</span>
                    </button>
                    <button type="button" className="settings-menu-item" onClick={handleInPageRefresh}>
                      <span>🔄 4. Refresh page</span>
                      <span className="badge" style={{ fontSize: 11 }}>In-page</span>
                    </button>
                    <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                    <button type="button" className="settings-menu-item danger" onClick={async () => { setMenu(false); await logout(); navigate('/login') }}>
                      <span>🚪 6. Logout</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </header>
        <main className="content"><Suspense fallback={<Skeleton rows={6} />}><Outlet /></Suspense></main>
      </div>
      {showChangePw && (
        <Modal title="Change Password" onClose={() => setShowChangePw(false)}>
          <form onSubmit={submitChangePw} className="stack" style={{ gap: 14 }}>
            {pwErr && <div className="alert error">{pwErr}</div>}
            {pwSuccess && <div className="alert success">{pwSuccess}</div>}
            <div className="field">
              <label>Current password *</label>
              <div className="pw-wrap" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showOldPw ? 'text' : 'password'}
                  required
                  className="input"
                  style={{ width: '100%', paddingRight: 40 }}
                  value={pwForm.old_password}
                  onChange={(e) => setPwForm({ ...pwForm, old_password: e.target.value })}
                  placeholder="Enter current password"
                />
                <button type="button" className="pw-eye" onClick={() => setShowOldPw((s) => !s)} aria-label="Toggle password">
                  {showOldPw ? '👁' : '👁‍🗨'}
                </button>
              </div>
            </div>
            <div className="field">
              <label>New password *</label>
              <div className="pw-wrap" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showNewPw ? 'text' : 'password'}
                  required
                  minLength={8}
                  className="input"
                  style={{ width: '100%', paddingRight: 40 }}
                  value={pwForm.new_password}
                  onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })}
                  placeholder="At least 8 characters"
                />
                <button type="button" className="pw-eye" onClick={() => setShowNewPw((s) => !s)} aria-label="Toggle password">
                  {showNewPw ? '👁' : '👁‍🗨'}
                </button>
              </div>
            </div>
            <div className="field">
              <label>Confirm new password *</label>
              <input
                type={showNewPw ? 'text' : 'password'}
                required
                className="input"
                value={pwForm.confirm}
                onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
                placeholder="Repeat new password"
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn ghost" onClick={() => setShowChangePw(false)}>Cancel</button>
              <button type="submit" className="btn primary" disabled={pwBusy}>
                {pwBusy ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {refreshToast && <div className="settings-toast" role="status">✓ Page data refreshed</div>}
      {mobile && user.role === 'ADMIN' && (
        <nav className="bottom-tabs" aria-label="Quick navigation">
          {MOBILE_TABS.map((t) => {
            const isActive = activeTab === t.label
            const cls = `bottom-tab${isActive ? ' active' : ''}`
            return (
              <a key={t.label} href={t.to} onClick={(e) => { e.preventDefault(); navigate(t.to) }} className={cls} aria-current={isActive ? 'page' : undefined}>
                <span className="bottom-tab-icon" aria-hidden>{t.icon}</span>
                <span className="bottom-tab-label">{t.label}</span>
              </a>
            )
          })}
        </nav>
      )}
    </div>
  )
}
