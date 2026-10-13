import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useApp } from '../contexts/AppContext'
import { api, mediaUrl } from '../services/api'
import { Skeleton } from '../components/ui'

export const NAVS = {
  ADMIN: [
    ['Overview', '/admin', '▦', true], ['sec', 'People'],
    ['Students', '/admin/students', '🎓'], ['Parents', '/admin/parents', '👪'], ['Teachers', '/admin/teachers', '👩‍🏫'], ['Staff', '/admin/staff', '🧑‍💼'], ['Recycle bin', '/admin/recycle-bin', '♻'],
    ['sec', 'Academics'], ['Classes & streams', '/admin/classes', '🏫'], ['Subjects', '/admin/subjects', '📘'], ['Years & terms', '/admin/academics', '📅'],
    ['Grading', '/admin/grading', '🅰'], ['Timetable', '/admin/timetable', '🕒'], ['Events', '/admin/events', '📣'],
    ['sec', 'Operations'], ['Attendance', '/admin/attendance', '✔'], ['Results', '/admin/results', '📝'], ['Reports', '/admin/reports', '🖨'],
    ['Analytics', '/admin/analytics', '📈'], ['Enquiries', '/admin/enquiries', '✉'], ['Notifications', '/admin/notifications', '🔔'],
    ['sec', 'System'], ['School profile', '/admin/settings', '⚙'], ['Users', '/admin/users', '🔑'], ['Audit logs', '/admin/audit', '🛡'],
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
    ['Admin accounts', '/developer/admin-accounts', '🔑'], ['Maintenance', '/developer/maintenance', '🛠'], ['Updates', '/developer/updates', '⬆'], ['Audit', '/developer/audit', '🛡'],
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

  const title = nav.filter((n) => n[0] !== 'sec').reduce((best, n) => (loc.pathname.startsWith(n[1]) && (!best || n[1].length > best[1].length) ? n : best), null)?.[0] || 'Student'
  const submitSearch = (e) => { e.preventDefault(); navigate(user.role === 'ADMIN' ? `/admin/students?q=${encodeURIComponent(q)}` : `/teacher/classes?q=${encodeURIComponent(q)}`) }

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
            {menu && <div className="menu"><div style={{ padding: 8 }}><b>{user.full_name}</b><div className="muted" style={{ fontSize: 12 }}>{user.role}</div></div>
              <button className="btn ghost sm" onClick={async () => { await logout(); navigate('/login') }}>Sign out</button></div>}
          </div>
        </header>
        <main className="content"><Suspense fallback={<Skeleton rows={6} />}><Outlet /></Suspense></main>
      </div>
    </div>
  )
}
