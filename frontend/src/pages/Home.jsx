import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../contexts/AppContext'

const FEATURES = [
  ['Student Management', 'Admissions, class and stream placement, parent links and a full academic history that is archived, never lost.'],
  ['Teacher Management', 'Admin-issued credentials, class teachers, subject codes and strict assignment-based access.'],
  ['Parent Portal', 'Parents sign in with a student index number and see only their own children.'],
  ['Attendance', 'Mark a class in seconds with large touch targets and exactly one state per student.'],
  ['Results', 'Spreadsheet-style mark entry with server-validated totals, grades, remarks and class positions.'],
  ['Report Cards', 'Branded PDF report cards with teacher and head teacher comments and a printed grading table.'],
  ['Timetable', 'Weekly timetables for teachers and for each child\'s class.'],
  ['Notifications', 'Academic, attendance, results, event and announcement alerts with read tracking.'],
  ['Analytics', 'Term-over-term improvement and decline, subject and class performance.'],
  ['Offline Support', 'Take attendance and enter marks without a connection; changes sync automatically.'],
  ['PWA', 'Install on phones, tablets and desktops like a native app.'],
  ['Secure Access', 'Role-based permissions enforced by the server, with audit logs for important actions.'],
]
const STEPS = ['Configure school', 'Register users', 'Manage students', 'Record attendance', 'Enter results', 'Parents monitor progress', 'Generate reports']
const SECURITY = [['Role-based access', 'Every request is checked on the server against the signed-in role and the records it may touch.'],
  ['Secure authentication', 'Hashed passwords, short-lived JWT access tokens and rotating refresh tokens.'],
  ['Audit logs', 'Sign-ins, mark and attendance submissions, configuration changes and maintenance are recorded.'],
  ['Data protection', 'Academic records are archived rather than deleted; uploads are validated and size-limited.'],
  ['Backup support', 'Standard PostgreSQL backups are documented for every deployment.']]
const LINKS = [['Home', '/#home'], ['Features', '/#features'], ['About', '/#about'], ['Contact', '/#contact']]

export function PublicHeader() {
  const [open, setOpen] = useState(false)
  const { theme, toggleTheme } = useApp()
  return (
    <header className="pub-head">
      <div className="in">
        <Link to="/" className="brand"><img src="/icon.svg" alt="" /><span>School Management System</span></Link>
        <nav className="pub-nav desk" aria-label="Primary">
          {LINKS.map(([l, to]) => <a key={l} href={to}>{l}</a>)}
          <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} aria-pressed={theme === 'dark'}>{theme === 'light' ? '☾' : '☀'}<span>{theme === 'light' ? 'Dark' : 'Light'} mode</span></button>
          <Link to="/login">Login</Link><Link to="/login" className="btn primary">Get Started</Link>
        </nav>
        <button className="icon-btn drawer-pub" onClick={() => setOpen(true)} aria-label="Open navigation">☰</button>
      </div>
      {open && <><div className="overlay" onClick={() => setOpen(false)} />
        <div className="pub-drawer" role="dialog" aria-label="Navigation">
          <button className="btn ghost" style={{ alignSelf: 'flex-end' }} onClick={() => setOpen(false)} aria-label="Close">✕</button>
          {LINKS.map(([l, to]) => <a key={l} href={to} onClick={() => setOpen(false)}>{l}</a>)}
          <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} aria-pressed={theme === 'dark'}>{theme === 'light' ? '☾' : '☀'}<span>{theme === 'light' ? 'Dark' : 'Light'} mode</span></button>
          <Link to="/login" className="btn">Login</Link><Link to="/login" className="btn primary">Get Started</Link>
        </div></>}
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer className="pub-foot" id="contact"><div className="in">
      <div className="cols">
        <div><b>School Management System</b><p>Connecting administrators, teachers and parents.</p></div>
        <div className="stack"><a href="/#about">About</a><br /><a href="/#contact">Contact</a><br /><a href="/#features">Features</a><br /><Link to="/login">Login</Link></div>
        <div className="stack"><Link to="/privacy">Privacy</Link><br /><Link to="/terms">Terms</Link></div>
      </div>
      <small>Version {__APP_VERSION__} · Contact your school administrator for access.</small>
    </div></footer>
  )
}

export default function Home() {
  return (
    <>
      <PublicHeader />
      <section className="hero" id="home"><div className="in">
        <div className="hero-copy">
          <span className="eyebrow">A better way to learn, together</span>
          <h1>Welcome to Kiyingi Memorial SS Management system.</h1>
          <p className="lead">Bringing our school community together with thoughtful tools for learning, communication, and everyday school life.</p>
          <div className="row"><Link to="/login" className="btn primary lg">Sign in</Link><a href="/#features" className="btn lg">Explore School <span aria-hidden="true">↗</span></a></div>
        </div>
        <div className="hero-art" aria-label="A welcoming illustration of an open book and the school community">
          <div className="art-orbit orbit-one" />
          <div className="art-orbit orbit-two" />
          <div className="welcome-card glass-card">
            <span className="welcome-mark" aria-hidden="true">✦</span>
            <span className="eyebrow">Learning starts here</span>
            <h2>Growing brighter, together.</h2>
            <p>Every learner. Every educator. One welcoming place.</p>
            <div className="welcome-line" aria-hidden="true"><i /><i /><i /></div>
          </div>
          <span className="art-chip chip-top">Curiosity</span>
          <span className="art-chip chip-bottom">Community</span>
        </div>
      </div></section>
      <section className="section public-section" id="features"><div className="in">
        <span className="eyebrow">Made for school life</span>
        <h2>Everything your school needs, in one place.</h2>
        <p className="section-intro">Simple, connected tools help your community stay informed and focus on what matters: learning.</p>
        <div className="grid cols-3">{FEATURES.map(([t, d]) => <div className="feat" key={t}><b>{t}</b><span className="muted">{d}</span></div>)}</div>
      </div></section>
      <section className="section alt public-section"><div className="in"><span className="eyebrow">A smoother school day</span><h2>Made to work together.</h2><p className="section-intro">From the first school setup to the moments families celebrate progress, each step has a place.</p><ol className="steps">{STEPS.map((s) => <li key={s}>{s}</li>)}</ol></div></section>
      <section className="section public-section" id="about"><div className="in">
        <span className="eyebrow">Designed around your community</span>
        <h2>Built for trust, shaped for learning.</h2>
        <p className="section-intro">Clear roles and responsible safeguards help make school information easier to manage with confidence.</p>
        <div className="grid cols-3">{SECURITY.map(([t, d]) => <div className="feat" key={t}><b>{t}</b><span className="muted">{d}</span></div>)}</div>
      </div></section>
      <section className="section public-section"><div className="in"><div className="cta glass-card"><span className="eyebrow">Your school, in sync</span><h2>Let’s make room for what matters.</h2><p>Sign in with the account your school administrator created for you.</p><Link to="/login" className="btn lg">Get started <span aria-hidden="true">→</span></Link></div></div></section>
      <PublicFooter />
    </>
  )
}

export function Legal({ kind }) {
  const privacy = kind === 'privacy'
  return (
    <>
      <PublicHeader />
      <section className="section"><div className="in" style={{ maxWidth: 760 }}>
        <h1>{privacy ? 'Privacy' : 'Terms of use'}</h1>
        {privacy ? <>
          <p>This system stores student, parent and teacher records on the school's own database. Access is limited by role: parents see only their own children, and teachers only their assigned classes.</p>
          <p>Important actions are written to an audit log. Passwords are stored as one-way hashes. The school decides how long records are kept and who may export them.</p>
          <p>Schools should replace this summary with their own policy that reflects local data-protection law.</p>
        </> : <>
          <p>Accounts are issued by the school administrator and are personal. Do not share your password.</p>
          <p>Academic information is confidential and may be used only for the education and welfare of the learner.</p>
          <p>Schools should replace this summary with terms that reflect their own policies.</p>
        </>}
      </div></section>
      <PublicFooter />
    </>
  )
}
