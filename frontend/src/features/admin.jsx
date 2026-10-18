import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts'
import { api, errorMessage, items, mediaUrl } from '../services/api'
import { useFetch } from '../hooks/useFetch'
import { useApp } from '../contexts/AppContext'
import { Alert, Empty, ErrorState, Skeleton, Tabs, fmtDateTime } from '../components/ui'
import ResourcePage from './ResourcePage'
import { Chart } from './Shared'
import { R } from './resources'

const AXIS = { stroke: 'var(--muted)', fontSize: 12 }
const COLORS = ['var(--primary)', 'var(--secondary)']

function GenderCard({ title, d }) {
  const data = [{ name: 'Male', value: d.male }, { name: 'Female', value: d.female }]
  return (
    <div className="panel"><h3>{title}</h3>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}><span className="badge info">Total {d.total}</span><span className="badge">Male {d.male}</span><span className="badge">Female {d.female}</span></div>
      {d.total ? <Chart height={170}><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={40} outerRadius={64} animationDuration={300}>{data.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}</Pie><Tooltip /><Legend /></PieChart></Chart> : <Empty title="No records" />}
    </div>
  )
}

export function AdminDashboard({ view = 'overview' }) {
  const years = useFetch('/academics/years/')
  const terms = useFetch('/academics/terms/')
  const [year, setYear] = useState('')
  const [term, setTerm] = useState('')
  const [applied, setApplied] = useState({ year: '', term: '' })
  const { data, loading, error, reload } = useFetch('/analytics/overview/', Object.fromEntries(Object.entries(applied).filter(([, v]) => v)))
  const termList = items(terms.data).filter((t) => !year || String(t.year) === String(year))
  if (error) return <ErrorState message={error} onRetry={reload} />
  return (
    <div className="stack">
      <div className="panel row">
        <label>Academic Year <select className="input" value={year} onChange={(e) => { setYear(e.target.value); setTerm('') }}><option value="">All</option>{items(years.data).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
        <label>Term <select className="input" value={term} onChange={(e) => setTerm(e.target.value)}><option value="">All</option>{termList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <button className="btn primary" onClick={() => setApplied({ year, term })}>Apply</button><button className="btn" onClick={() => { setYear(''); setTerm(''); setApplied({ year: '', term: '' }) }}>Reset</button>
      </div>
      {loading && !data ? <Skeleton rows={6} /> : <>
        {view === 'overview' && <div className="grid cols-3"><GenderCard title="Students" d={data.students} /><GenderCard title="Teachers" d={data.teachers} /><GenderCard title="Staff" d={data.staff} /></div>}
        <div className="grid cols-2">
          <div className="panel"><h3>Attendance trend (present vs. recorded)</h3>{data.attendance_trend.length ? <Chart><LineChart data={data.attendance_trend}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="date" {...AXIS} /><YAxis {...AXIS} /><Tooltip /><Legend />
            <Line dataKey="present" name="Present" stroke="var(--success)" strokeWidth={2} animationDuration={300} /><Line dataKey="total" name="Recorded" stroke="var(--muted)" strokeWidth={2} animationDuration={300} /></LineChart></Chart> : <Empty title="No attendance recorded yet" />}</div>
          <div className="panel"><h3>Academic performance by term</h3>{data.term_performance.length ? <Chart><BarChart data={data.term_performance.map((t) => ({ ...t, label: `${t.year} ${t.term}` }))}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="label" {...AXIS} /><YAxis domain={[0, 100]} {...AXIS} /><Tooltip /><Bar dataKey="average" name="Average %" fill="var(--primary)" radius={[6, 6, 0, 0]} animationDuration={300} /></BarChart></Chart> : <Empty title="No results yet" />}</div>
          <div className="panel"><h3>Class performance</h3>{data.class_performance.length ? <Chart><BarChart data={data.class_performance}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="class" {...AXIS} /><YAxis domain={[0, 100]} {...AXIS} /><Tooltip /><Bar dataKey="average" name="Average %" fill="var(--secondary)" radius={[6, 6, 0, 0]} animationDuration={300} /></BarChart></Chart> : <Empty title="No results yet" />}</div>
          {view === 'overview' && <div className="panel"><h3>Recent activity</h3>{data.recent_activity.length ? <div className="stack">{data.recent_activity.map((a, i) => <div key={i} className="row spread"><span><b>{a.action.replaceAll('_', ' ').toLowerCase()}</b> · {a.module} {a.object_repr && <span className="muted">— {a.object_repr}</span>}</span><small className="muted">{a.actor_name} · {fmtDateTime(a.created_at)}</small></div>)}</div> : <Empty title="No activity yet" />}</div>}
        </div>
        {view === 'overview' && <div className="row"><Link className="btn" to="/admin/students">Manage students</Link><Link className="btn" to="/admin/attendance">View attendance</Link><Link className="btn" to="/admin/reports">Report cards</Link></div>}
      </>}
    </div>
  )
}

const pair = (a, b, names) => function Pair() {
  const [t, setT] = useState(names[0])
  return <div><Tabs tabs={names} value={t} onChange={setT} /><ResourcePage cfg={t === names[0] ? R[a] : R[b]} embedded key={t} /></div>
}
export const ClassesPage = pair('classes', 'streams', ['Classes', 'Streams'])
export const SubjectsPage = pair('subjects', 'assignments', ['Subjects', 'Teaching assignments'])
export const AcademicsPage = pair('years', 'terms', ['Academic years', 'Terms'])
export const GradingPage = pair('grading', 'examTypes', ['Grade bands', 'Examination types'])

const recycleConfigs = [
  { key: 'students', title: 'Students', cfg: R.students, endpoint: '/students/', params: { is_archived: true } },
  { key: 'parents', title: 'Parents', cfg: R.parents, endpoint: '/parents/', params: { is_archived: true } },
  { key: 'teachers', title: 'Teachers', cfg: R.teachers, endpoint: '/teachers/', params: { is_archived: true } },
  { key: 'subjects', title: 'Subjects', cfg: R.subjects, endpoint: '/academics/subjects/', params: { is_archived: true } },
]

export function RecycleBinPage() {
  const [selected, setSelected] = useState(recycleConfigs[0].key)
  const current = recycleConfigs.find((item) => item.key === selected)
  return (
    <div className="stack">
      <p className="muted">Archived records can be restored or permanently deleted. Permanent deletion cannot be undone.</p>
      <Tabs tabs={recycleConfigs.map((item) => item.title)} value={current.title} onChange={(title) => setSelected(recycleConfigs.find((item) => item.title === title).key)} />
      <ResourcePage cfg={{ ...current.cfg, title: `${current.title} in recycle bin`, endpoint: current.endpoint, params: current.params, readOnly: true, recycleBin: true }} key={selected} />
    </div>
  )
}

export function SchoolSettings() {
  const { school, setSchool } = useApp()
  const [f, setF] = useState(null)
  const [files, setFiles] = useState({})
  const [msg, setMsg] = useState({ kind: 'success', text: '' })
  useEffect(() => { if (school && !f) setF(school) }, [school, f])
  if (!f) return <Skeleton />
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async (e) => {
    e.preventDefault()
    const body = new FormData()
    ;['name', 'address', 'phone', 'email', 'website', 'motto', 'head_teacher'].forEach((k) => body.append(k, f[k] ?? ''))
    Object.entries(files).forEach(([k, v]) => v && body.append(k, v))
    try { const { data } = await api.patch('/academics/school-profile/', body); setSchool(data); setF(data); setMsg({ kind: 'success', text: 'School profile saved.' }) } catch (x) { setMsg({ kind: 'error', text: errorMessage(x) }) }
  }
  return (
    <form className="panel" onSubmit={save} style={{ maxWidth: 720 }}>
      <div className="panel-head"><h2>School profile</h2></div><Alert kind={msg.kind}>{msg.text}</Alert>
      {[['name', 'School name'], ['motto', 'Motto'], ['head_teacher', 'Head teacher / principal'], ['address', 'Address'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website']].map(([k, l]) => <div className="field" key={k}><label htmlFor={k}>{l}</label><input id={k} className="input" value={f[k] || ''} onChange={set(k)} /></div>)}
      <div className="grid cols-2">{[['logo', 'Logo'], ['badge', 'Badge']].map(([k, l]) => <div className="field" key={k}><label htmlFor={k}>{l} (PNG/JPG/WebP, max 2 MB)</label>{f[k] && <img src={mediaUrl(f[k])} alt={`${l} preview`} style={{ height: 56, objectFit: 'contain', alignSelf: 'start' }} />}<input id={k} type="file" accept="image/png,image/jpeg,image/webp" className="input" onChange={(e) => setFiles({ ...files, [k]: e.target.files[0] })} /></div>)}</div>
      <button className="btn primary">Save profile</button>
    </form>
  )
}

export function ImportPanel({ kind, title, columns, note }) {
  const [file, setFile] = useState(null)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (dry) => {
    const body = new FormData(); body.append('file', file); body.append('dry_run', dry)
    setBusy(true); setErr('')
    try { setRes((await api.post(`/${kind}/import/`, body)).data) } catch (e) { setErr(errorMessage(e)) }
    setBusy(false)
  }
  const template = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`${columns.join(',')}\n`], { type: 'text/csv' }))
    a.download = `${kind}-import-template.csv`; a.click()
  }
  return (
    <section className="panel"><div className="panel-head"><h2>{title}</h2><button className="btn sm" onClick={template}>Download CSV template</button></div>
      <p className="muted">Columns: {columns.join(', ')}. CSV or Excel (.xlsx), up to 2 MB. {note} Records are validated first; nothing is saved until you import.</p>
      <Alert>{err}</Alert>
      <div className="row"><input type="file" accept=".csv,.xlsx" className="input" style={{ maxWidth: 320 }} onChange={(e) => { setFile(e.target.files[0]); setRes(null) }} aria-label={`${title} file`} />
        <button className="btn" disabled={!file || busy} onClick={() => run(true)}>Validate</button>
        <button className="btn primary" disabled={!file || busy || !res || !res.dry_run || res.valid === 0} onClick={() => run(false)}>Import {res?.valid || ''} valid record(s)</button></div>
      {res && <div className="stack" style={{ marginTop: 12 }}>
        <div className="row"><span className="badge PASS">Valid {res.valid}</span><span className="badge FAIL">Invalid {res.invalid.length}</span><span className="badge WARNING">Duplicates {res.duplicates.length}</span>{!res.dry_run && <span className="badge info">Imported {res.created}</span>}</div>
        {res.invalid.map((i) => <div key={i.row} className="alert error">Row {i.row}: {i.error}</div>)}{res.duplicates.map((d) => <div key={d.row} className="alert warning">Row {d.row}: {d.name} already exists</div>)}
        {res.credentials?.length > 0 && <div className="alert warning"><b>Temporary passwords — shown once. Copy them now and hand them out securely.</b>
          <div className="pre">{res.credentials.map((c) => `${c.username}   ${c.temporary_password}`).join('\n')}</div></div>}</div>}
    </section>
  )
}

export { AdminStudentReportsPage } from './StudentReports'
