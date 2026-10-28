import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts'
import { api, errorMessage, items, mediaUrl } from '../services/api'
import { useFetch } from '../hooks/useFetch'
import { useApp } from '../contexts/AppContext'
import { Alert, Empty, ErrorState, Modal, Skeleton, Tabs, fmtDate, fmtDateTime } from '../components/ui'
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
  { key: 'staff', title: 'Staff', cfg: R.staff, endpoint: '/staff/', params: { status: 'INACTIVE' } },
  { key: 'users', title: 'User accounts', cfg: R.users, endpoint: '/auth/users/', params: { is_active: false } },
  { key: 'subjects', title: 'Subjects', cfg: R.subjects, endpoint: '/academics/subjects/', params: { is_archived: true } },
  { key: 'audit', title: 'Recent activity', cfg: R.audit, endpoint: '/audit/', params: {}, recycleBin: true },
]

export function RecycleBinPage() {
  const [selected, setSelected] = useState(recycleConfigs[0].key)
  const current = recycleConfigs.find((item) => item.key === selected)
  const params = current.key === 'audit' ? { ...current.params, trash: '1' } : current.params
  return (
    <div className="stack">
      <p className="muted">Archived records can be restored or permanently deleted. Permanent deletion cannot be undone.</p>
      <Tabs tabs={recycleConfigs.map((item) => item.title)} value={current.title} onChange={(title) => setSelected(recycleConfigs.find((item) => item.title === title).key)} />
      <ResourcePage cfg={{ ...current.cfg, title: `${current.title} in recycle bin`, endpoint: current.endpoint, params, readOnly: true, recycleBin: true }} key={selected} />
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
  const [progress, setProgress] = useState(null)
  const [progressMsg, setProgressMsg] = useState('')

  const run = async (dry) => {
    const body = new FormData()
    body.append('file', file)
    body.append('dry_run', dry)
    setBusy(true)
    setErr('')
    setProgress(0)
    setProgressMsg(dry ? 'Uploading file for validation…' : 'Uploading file for import…')

    try {
      const { data } = await api.post(`/${kind}/import/`, body, {
        onUploadProgress: (evt) => {
          if (evt.total) {
            const pct = Math.round((evt.loaded * 100) / evt.total)
            setProgress(pct)
            if (pct >= 100) {
              setProgressMsg(dry ? 'Processing and validating records on the server…' : 'Saving validated records into database…')
            } else {
              setProgressMsg(`Uploading: ${pct}%`)
            }
          }
        }
      })
      setRes(data)
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
      setProgress(null)
      setProgressMsg('')
    }
  }

  const template = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`${columns.join(',')}\n`], { type: 'text/csv' }))
    a.download = `${kind}-import-template.csv`
    a.click()
  }

  const downloadErrorReport = () => {
    if (!res?.invalid?.length) return
    const csvContent = 'Row,Error\n' + res.invalid.map((i) => `${i.row},"${(i.error || '').replace(/"/g, '""')}"`).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv' }))
    a.download = `${kind}-import-errors.csv`
    a.click()
  }

  const totalProcessed = res ? (res.valid + (res.invalid?.length || 0) + (res.duplicates?.length || 0)) : 0

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        <button className="btn sm" onClick={template}>Download CSV template</button>
      </div>
      <p className="muted">
        Columns: {columns.join(', ')}. CSV or Excel (.xlsx), up to 2 MB. {note} Records are validated first; nothing is saved until you import.
      </p>

      {err && <Alert kind="error">{err}</Alert>}

      <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
        <input
          type="file"
          accept=".csv,.xlsx"
          className="input"
          style={{ maxWidth: 320 }}
          onChange={(e) => { setFile(e.target.files[0] || null); setRes(null); setErr('') }}
          aria-label={`${title} file`}
          disabled={busy}
        />
        <button className="btn" disabled={!file || busy} onClick={() => run(true)}>
          {busy && progressMsg.includes('validation') ? 'Validating…' : 'Validate File'}
        </button>
        <button
          className="btn primary"
          disabled={!file || busy || !res || !res.dry_run || res.valid === 0}
          onClick={() => run(false)}
        >
          {busy && progressMsg.includes('import') ? 'Importing…' : `Import ${res?.valid || ''} valid record(s)`}
        </button>
      </div>

      {busy && (
        <div style={{ marginTop: 12 }}>
          <div className="row spread" style={{ fontSize: 13, marginBottom: 4 }}>
            <span>{progressMsg}</span>
            {progress !== null && <span>{progress}%</span>}
          </div>
          <div style={{ width: '100%', height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={{
                width: `${progress ?? 100}%`,
                height: '100%',
                background: 'var(--primary)',
                transition: 'width 0.2s ease',
                animation: progress === null || progress >= 100 ? 'pulse 1.5s infinite' : 'none'
              }}
            />
          </div>
        </div>
      )}

      {res && (
        <div className="stack" style={{ marginTop: 14 }}>
          {!res.dry_run && res.created > 0 && (
            <Alert kind="success">
              ✅ Successfully imported {res.created} {title.toLowerCase()} into the system.
            </Alert>
          )}

          <div className="row spread" style={{ alignItems: 'center', background: 'var(--surface-raised, #f8f9fa)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="badge">Total processed: {totalProcessed}</span>
              <span className="badge PASS">Valid: {res.valid}</span>
              <span className="badge FAIL">Invalid: {res.invalid.length}</span>
              <span className="badge WARNING">Duplicates: {res.duplicates.length}</span>
              {!res.dry_run && <span className="badge info">Imported: {res.created}</span>}
            </div>

            {res.invalid.length > 0 && (
              <button className="btn sm danger" type="button" onClick={downloadErrorReport}>
                📥 Download Error Report (CSV)
              </button>
            )}
          </div>

          {res.invalid.map((i) => (
            <div key={i.row} className="alert error" style={{ fontSize: 13 }}>
              <b>Row {i.row}:</b> {i.error}
            </div>
          ))}

          {res.duplicates.map((d) => (
            <div key={d.row} className="alert warning" style={{ fontSize: 13 }}>
              <b>Row {d.row}:</b> {d.name} already exists
            </div>
          ))}

          {res.credentials?.length > 0 && (
            <div className="alert warning">
              <b>Temporary credentials — shown once. Copy them now and hand them out securely.</b>
              <div className="pre" style={{ maxHeight: 200, overflowY: 'auto', marginTop: 8 }}>
                {res.credentials.map((c) =>
                  c.signin_code
                    ? `${c.username}   Password: ${c.temporary_password}   Teacher code: ${c.signin_code}   (${c.full_name || ''}${c.subject ? ` · ${c.subject}` : ''})`
                    : `${c.username}   ${c.temporary_password}`
                ).join('\n')}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export function TeacherAssignmentsPage() {
  const [tab, setTab] = useState('All Assignments')
  const [search, setSearch] = useState('')
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [selectedTeacher, setSelectedTeacher] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [form, setForm] = useState(null)
  const [notice, setNotice] = useState('')

  const teachers = useFetch('/teachers/', { page_size: 200 })
  const classes = useFetch('/academics/classes/')
  const streams = useFetch('/academics/streams/')
  const subjects = useFetch('/academics/subjects/', { is_archived: false })
  const assignments = useFetch('/academics/assignments/', { page_size: 500 })

  const teacherList = items(teachers.data)
  const classList = items(classes.data)
  const streamList = items(streams.data)
  const subjectList = items(subjects.data)
  const assignmentList = items(assignments.data)

  const reloadAll = () => {
    assignments.reload()
    teachers.reload()
    streams.reload()
    subjects.reload()
  }

  const toggleStatus = async (item) => {
    try {
      const action = item.is_active ? 'deactivate' : 'activate'
      await api.post(`/academics/assignments/${item.id}/${action}/`)
      setNotice(`Assignment ${item.is_active ? 'deactivated' : 'reactivated'} successfully.`)
      reloadAll()
    } catch (e) {
      setNotice(errorMessage(e))
    }
  }

  // Combine teachers from /teachers/ and any assigned teachers from /academics/assignments/
  const allTeachers = useMemo(() => {
    const map = new Map()
    teacherList.forEach((t) => {
      const uid = String(t.user_id || t.id)
      map.set(uid, {
        id: t.id,
        user_id: t.user_id || t.id,
        full_name: t.full_name || t.username,
        username: t.username,
        phone: t.phone || '',
      })
    })
    assignmentList.forEach((a) => {
      const uid = String(a.teacher)
      if (uid && !map.has(uid)) {
        map.set(uid, {
          id: uid,
          user_id: Number(uid) || uid,
          full_name: a.teacher_name || `Teacher #${uid}`,
          username: `user_${uid}`,
          phone: '',
        })
      }
    })
    return [...map.values()].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
  }, [teacherList, assignmentList])

  const isTeacherMatch = (a, t) => {
    if (!a || !t) return false
    const aTeacher = String(a.teacher ?? '')
    const tUserId = String(t.user_id ?? '')
    const tId = String(t.id ?? '')
    if (aTeacher && tUserId && aTeacher === tUserId) return true
    if (aTeacher && tId && aTeacher === tId) return true
    if (a.teacher_name && t.full_name && a.teacher_name.trim().toLowerCase() === t.full_name.trim().toLowerCase()) return true
    if (a.teacher_name && t.username && a.teacher_name.toLowerCase().includes(t.username.toLowerCase())) return true
    return false
  }

  const isStreamMatch = (a, st) => {
    if (!a || !st) return false
    const aStream = String(a.stream ?? '')
    const stId = String(st.id ?? '')
    if (aStream && stId && aStream === stId) return true
    if (a.stream_label && (st.label || st.name) && a.stream_label.trim().toLowerCase() === (st.label || st.name).trim().toLowerCase()) return true
    return false
  }

  // Filtered master assignments
  const filteredAssignments = useMemo(() => {
    return assignmentList.filter((a) => {
      if (search) {
        const q = search.toLowerCase()
        const match =
          (a.teacher_name || '').toLowerCase().includes(q) ||
          (a.stream_label || '').toLowerCase().includes(q) ||
          (a.class_name || '').toLowerCase().includes(q) ||
          (a.subject_name || '').toLowerCase().includes(q) ||
          (a.subject_code || '').toLowerCase().includes(q) ||
          (a.teacher_subject_code || '').toLowerCase().includes(q)
        if (!match) return false
      }
      if (selectedStatus === 'active' && !a.is_active) return false
      if (selectedStatus === 'ended' && a.is_active) return false
      if (selectedTeacher && String(a.teacher) !== String(selectedTeacher)) return false
      if (selectedSubject && String(a.subject) !== String(selectedSubject)) return false
      if (selectedClass) {
        const matchClass =
          String(a.class_id) === String(selectedClass) ||
          streamList.some((s) => String(s.id) === String(a.stream) && String(s.school_class) === String(selectedClass))
        if (!matchClass) return false
      }
      return true
    })
  }, [assignmentList, search, selectedStatus, selectedTeacher, selectedSubject, selectedClass, streamList])

  const filteredTeachers = useMemo(() => {
    return allTeachers.filter((t) => {
      if (!search) return true
      const q = search.toLowerCase()
      return (t.full_name || '').toLowerCase().includes(q) || (t.username || '').toLowerCase().includes(q)
    })
  }, [allTeachers, search])

  const saveAssignment = async (e) => {
    e.preventDefault()
    if (!form.teacher || !form.stream || !form.subject) {
      setNotice('Teacher, class & stream, and subject are required.')
      return
    }
    try {
      if (form.id) {
        await api.patch(`/academics/assignments/${form.id}/`, form)
        setNotice('Assignment updated.')
      } else {
        await api.post('/academics/assignments/', form)
        setNotice('Teacher assigned successfully.')
      }
      setForm(null)
      reloadAll()
    } catch (err) {
      setNotice(errorMessage(err))
    }
  }

  const isLoading = assignments.loading || teachers.loading

  return (
    <div className="stack">
      <div className="panel-head">
        <div>
          <h2>Teacher Class & Subject Assignments</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Assign teachers to classes and subjects. Supports one teacher handling multiple subjects in one class and across many classes.
          </p>
        </div>
        <button
          className="btn primary"
          onClick={() => setForm({ paper_number: 1, is_active: true })}
        >
          + Assign Teacher to Class
        </button>
      </div>

      {notice && (
        <Alert kind={notice.includes('successfully') || notice.includes('updated') ? 'success' : 'error'}>
          {notice}
        </Alert>
      )}

      <Tabs tabs={['All Assignments', 'By Teacher', 'By Class']} value={tab} onChange={setTab} />

      {/* TAB 1: ALL ASSIGNMENTS MASTER TABLE */}
      {tab === 'All Assignments' && (
        <section className="panel">
          <div className="row wrap" style={{ gap: 8, marginBottom: 16 }}>
            <input
              className="input"
              style={{ minWidth: 220, flex: 1 }}
              placeholder="Search by teacher, subject, class, code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search teaching assignments"
            />
            <select
              className="input"
              style={{ width: 'auto' }}
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              aria-label="Filter by class"
            >
              <option value="">All Classes</option>
              {classList.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              className="input"
              style={{ width: 'auto' }}
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              aria-label="Filter by subject"
            >
              <option value="">All Subjects</option>
              {subjectList.map((s) => (
                <option key={s.id} value={s.id}>{s.code} - {s.name}</option>
              ))}
            </select>
            <select
              className="input"
              style={{ width: 'auto' }}
              value={selectedTeacher}
              onChange={(e) => setSelectedTeacher(e.target.value)}
              aria-label="Filter by teacher"
            >
              <option value="">All Teachers</option>
              {allTeachers.map((t) => (
                <option key={t.id} value={t.user_id}>{t.full_name}</option>
              ))}
            </select>
            <select
              className="input"
              style={{ width: 'auto' }}
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="ended">Ended Only</option>
            </select>
            {(search || selectedClass || selectedSubject || selectedTeacher || selectedStatus !== 'all') && (
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setSearch('')
                  setSelectedClass('')
                  setSelectedSubject('')
                  setSelectedTeacher('')
                  setSelectedStatus('all')
                }}
              >
                Reset
              </button>
            )}
          </div>

          <div className="row spread" style={{ marginBottom: 12, fontSize: 13 }}>
            <span className="muted">
              Showing <b>{filteredAssignments.length}</b> of <b>{assignmentList.length}</b> assignments
            </span>
            <button
              type="button"
              className="btn sm ghost"
              onClick={reloadAll}
              title="Refresh assignments list"
            >
              ↻ Refresh
            </button>
          </div>

          {isLoading ? (
            <Skeleton rows={8} />
          ) : assignments.error ? (
            <ErrorState message={assignments.error} onRetry={reloadAll} />
          ) : !filteredAssignments.length ? (
            <Empty title="No assignments found">
              {assignmentList.length === 0
                ? 'No teaching assignments have been created yet. Click "+ Assign Teacher to Class" above to create one.'
                : 'No assignments match the selected search or filter criteria.'}
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Teacher</th>
                    <th>Class & Stream</th>
                    <th>Subject</th>
                    <th>Paper</th>
                    <th>Subject Code</th>
                    <th>Status</th>
                    <th>Assigned On</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAssignments.map((a) => (
                    <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.65 }}>
                      <td>
                        <b>{a.teacher_name || '—'}</b>
                      </td>
                      <td><b>{a.stream_label || a.class_name || '—'}</b></td>
                      <td>{a.subject_name || '—'}</td>
                      <td>Paper {a.paper_number || 1}</td>
                      <td><code>{a.teacher_subject_code || a.subject_code || '—'}</code></td>
                      <td>
                        <span className={`badge ${a.is_active ? 'success' : 'danger'}`}>
                          {a.is_active ? 'Active' : 'Ended'}
                        </span>
                      </td>
                      <td>
                        <small className="muted">{a.created_at ? fmtDate(a.created_at) : '—'}</small>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => setForm(a)}
                            title="Edit assignment details"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={`btn sm ${a.is_active ? 'danger' : 'success'}`}
                            onClick={() => toggleStatus(a)}
                            title={a.is_active ? 'End this assignment' : 'Reactivate this assignment'}
                          >
                            {a.is_active ? 'End' : 'Reactivate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* TAB 2: GROUPED BY TEACHER */}
      {tab === 'By Teacher' && (
        <section className="panel">
          <div className="row spread" style={{ marginBottom: 16 }}>
            <input
              className="input"
              style={{ maxWidth: 300 }}
              placeholder="Search teachers by name or username…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="muted" style={{ fontSize: 13 }}>
              {filteredTeachers.length} teacher(s) registered
            </span>
          </div>

          {isLoading ? (
            <Skeleton rows={6} />
          ) : !filteredTeachers.length ? (
            <Empty title="No teachers found" />
          ) : (
            <div className="stack">
              {filteredTeachers.map((t) => {
                const myAssigns = assignmentList.filter((a) => isTeacherMatch(a, t))
                const activeCount = myAssigns.filter((a) => a.is_active).length
                return (
                  <div
                    key={t.id}
                    className="panel"
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      padding: 16,
                      background: 'var(--surface-card, var(--surface))'
                    }}
                  >
                    <div className="row spread" style={{ alignItems: 'flex-start' }}>
                      <div>
                        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <b style={{ fontSize: 16 }}>{t.full_name}</b>
                          <code className="muted">@{t.username}</code>
                          <span className={`badge ${activeCount ? 'success' : 'muted'}`}>
                            {activeCount} Active Assignment{activeCount === 1 ? '' : 's'}
                          </span>
                          {t.phone && <span className="muted" style={{ fontSize: 12 }}>📞 {t.phone}</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => setForm({ teacher: t.user_id, paper_number: 1, is_active: true })}
                      >
                        + Assign to Class / Subject
                      </button>
                    </div>

                    {!myAssigns.length ? (
                      <p className="muted" style={{ fontSize: 13, marginTop: 10, fontStyle: 'italic' }}>
                        No classes or subjects assigned yet. Click "+ Assign to Class / Subject" to assign this teacher.
                      </p>
                    ) : (
                      <div className="table-wrap" style={{ marginTop: 12 }}>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Class & Stream</th>
                              <th>Subject</th>
                              <th>Paper</th>
                              <th>Subject Code</th>
                              <th>Status</th>
                              <th>Assigned On</th>
                              <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {myAssigns.map((a) => (
                              <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.65 }}>
                                <td><b>{a.stream_label || '—'}</b></td>
                                <td>{a.subject_name || '—'}</td>
                                <td>Paper {a.paper_number || 1}</td>
                                <td><code>{a.teacher_subject_code || '—'}</code></td>
                                <td>
                                  <span className={`badge ${a.is_active ? 'success' : 'danger'}`}>
                                    {a.is_active ? 'Active' : 'Ended'}
                                  </span>
                                </td>
                                <td>
                                  <small className="muted">{a.created_at ? fmtDate(a.created_at) : '—'}</small>
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                                    <button
                                      type="button"
                                      className="btn sm"
                                      onClick={() => setForm(a)}
                                      title="Edit assignment details"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className={`btn sm ${a.is_active ? 'danger' : 'success'}`}
                                      onClick={() => toggleStatus(a)}
                                      title={a.is_active ? 'End this assignment' : 'Reactivate this assignment'}
                                    >
                                      {a.is_active ? 'End assignment' : 'Reactivate'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 3: GROUPED BY CLASS */}
      {tab === 'By Class' && (
        <section className="panel">
          <div className="row" style={{ marginBottom: 16 }}>
            <label>
              <b>Select Class:</b>
              <select
                className="input"
                style={{ width: 'auto', marginLeft: 8 }}
                value={selectedClass}
                onChange={(e) => setSelectedClass(e.target.value)}
              >
                <option value="">All Classes (Senior 1 – Senior 6)</option>
                {classList.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="stack">
            {streamList
              .filter((s) => !selectedClass || String(s.school_class) === String(selectedClass))
              .map((st) => {
                const streamAssigns = assignmentList.filter((a) => isStreamMatch(a, st))
                return (
                  <div
                    key={st.id}
                    className="panel"
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      padding: 16,
                    }}
                  >
                    <div className="row spread">
                      <div>
                        <h3 style={{ margin: 0 }}>{st.label || st.name}</h3>
                        {st.class_teacher_name && (
                          <span className="muted" style={{ fontSize: 13 }}>
                            Class teacher: <b>{st.class_teacher_name}</b>
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => setForm({ stream: st.id, paper_number: 1, is_active: true })}
                      >
                        + Assign Teacher to {st.name}
                      </button>
                    </div>

                    {!streamAssigns.length ? (
                      <p className="muted" style={{ fontSize: 13, marginTop: 10, fontStyle: 'italic' }}>
                        No teachers assigned to this class yet.
                      </p>
                    ) : (
                      <div className="table-wrap" style={{ marginTop: 12 }}>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Teacher</th>
                              <th>Subject</th>
                              <th>Paper</th>
                              <th>Subject Code</th>
                              <th>Status</th>
                              <th>Assigned On</th>
                              <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {streamAssigns.map((a) => (
                              <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.65 }}>
                                <td><b>{a.teacher_name || '—'}</b></td>
                                <td>{a.subject_name || '—'}</td>
                                <td>Paper {a.paper_number || 1}</td>
                                <td><code>{a.teacher_subject_code || '—'}</code></td>
                                <td>
                                  <span className={`badge ${a.is_active ? 'success' : 'danger'}`}>
                                    {a.is_active ? 'Active' : 'Ended'}
                                  </span>
                                </td>
                                <td><small className="muted">{a.created_at ? fmtDate(a.created_at) : '—'}</small></td>
                                <td style={{ textAlign: 'right' }}>
                                  <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                                    <button
                                      type="button"
                                      className="btn sm"
                                      onClick={() => setForm(a)}
                                      title="Edit assignment details"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className={`btn sm ${a.is_active ? 'danger' : 'success'}`}
                                      onClick={() => toggleStatus(a)}
                                    >
                                      {a.is_active ? 'End' : 'Reactivate'}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        </section>
      )}

      {/* ASSIGNMENT MODAL */}
      {form && (
        <Modal
          title={form.id ? 'Edit Teaching Assignment' : 'Assign Teacher to Class & Subject'}
          onClose={() => setForm(null)}
        >
          <form onSubmit={saveAssignment}>
            <div className="stack" style={{ gap: 12 }}>
              <label>
                Teacher:
                <select
                  className="input"
                  value={form.teacher || ''}
                  onChange={(e) => setForm({ ...form, teacher: Number(e.target.value) })}
                  required
                >
                  <option value="">Select teacher</option>
                  {allTeachers.map((t) => (
                    <option key={t.id} value={t.user_id}>{t.full_name} (@{t.username})</option>
                  ))}
                </select>
              </label>

              <label>
                Class & Stream:
                <select
                  className="input"
                  value={form.stream || ''}
                  onChange={(e) => setForm({ ...form, stream: Number(e.target.value) })}
                  required
                >
                  <option value="">Select class & stream</option>
                  {streamList.map((s) => (
                    <option key={s.id} value={s.id}>{s.label || s.name}</option>
                  ))}
                </select>
              </label>

              <label>
                Subject:
                <select
                  className="input"
                  value={form.subject || ''}
                  onChange={(e) => setForm({ ...form, subject: Number(e.target.value) })}
                  required
                >
                  <option value="">Select subject</option>
                  {subjectList.map((sub) => (
                    <option key={sub.id} value={sub.id}>{sub.code} - {sub.name}</option>
                  ))}
                </select>
              </label>

              <label>
                Paper Number:
                <input
                  type="number"
                  min="1"
                  className="input"
                  value={form.paper_number || 1}
                  onChange={(e) => setForm({ ...form, paper_number: Number(e.target.value) })}
                  required
                />
              </label>

              <label>
                Assigned Subject Code (Optional):
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. HIS221-S1"
                  value={form.teacher_subject_code || ''}
                  onChange={(e) => setForm({ ...form, teacher_subject_code: e.target.value })}
                />
              </label>

              <label className="row" style={{ gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={form.is_active ?? true}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                <span>Active assignment (uncheck to end this assignment)</span>
              </label>

              <div className="row spread" style={{ marginTop: 12 }}>
                <button type="button" className="btn" onClick={() => setForm(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn primary">
                  {form.id ? 'Save changes' : 'Assign teacher'}
                </button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

export function BursarManagementPage() {
  const [bursars, setBursars] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  // Create Modal State
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({
    username: '',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    password: '',
  })
  const [showCreatePw, setShowCreatePw] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const [createErr, setCreateErr] = useState('')

  // Reset / Recover Password Modal State
  const [resetBursar, setResetBursar] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showResetPw, setShowResetPw] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetErr, setResetErr] = useState('')

  // Success Credential Card Modal
  const [credentialCard, setCredentialCard] = useState(null)

  const loadBursars = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/auth/users/?role=BURSAR')
      setBursars(items(res.data) || [])
    } catch (err) {
      setError(errorMessage(err) || 'Failed to load bursar accounts.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBursars()
    const onRefresh = () => loadBursars()
    window.addEventListener('sms:refresh', onRefresh)
    return () => window.removeEventListener('sms:refresh', onRefresh)
  }, [])

  const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
    let pwd = ''
    for (let i = 0; i < 10; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return `Bursar#${pwd}`
  }

  const handleCreateSubmit = async (e) => {
    e.preventDefault()
    setCreateErr('')
    if (!createForm.username || !createForm.password) {
      return setCreateErr('Username and password are required.')
    }
    if (createForm.password.length < 8) {
      return setCreateErr('Password must be at least 8 characters long.')
    }
    setCreateBusy(true)
    try {
      const payload = {
        ...createForm,
        username: createForm.username.trim(),
        role: 'BURSAR',
        is_active: true,
      }
      const res = await api.post('/auth/users/', payload)
      setShowCreate(false)
      setCredentialCard({
        title: 'Bursar Account Created Successfully',
        username: payload.username,
        password: payload.password,
        fullName: `${payload.first_name} ${payload.last_name}`.trim() || payload.username,
        note: 'Share these credentials securely with the Bursar. They can log in at the main login page or /bursar/login to manage finances.',
      })
      setCreateForm({ username: '', first_name: '', last_name: '', email: '', phone: '', password: '' })
      loadBursars()
    } catch (err) {
      setCreateErr(
        err.response?.data?.username?.[0] ||
        err.response?.data?.password?.[0] ||
        err.response?.data?.detail ||
        errorMessage(err) ||
        'Failed to create bursar account.'
      )
    } finally {
      setCreateBusy(false)
    }
  }

  const handleResetSubmit = async (e) => {
    e.preventDefault()
    setResetErr('')
    if (!newPassword) {
      return setResetErr('Please enter a new password.')
    }
    if (newPassword.length < 8) {
      return setResetErr('Password must be at least 8 characters long.')
    }
    if (newPassword !== confirmPassword) {
      return setResetErr('Passwords do not match.')
    }
    setResetBusy(true)
    try {
      await api.post(`/auth/users/${resetBursar.id}/reset_password/`, {
        new_password: newPassword,
      })
      const targetBursar = resetBursar
      setResetBursar(null)
      setCredentialCard({
        title: 'Password Successfully Changed / Recovered',
        username: targetBursar.username,
        password: newPassword,
        fullName: targetBursar.full_name || targetBursar.username,
        note: 'The bursar password has been updated safely. Past payment receipts, student account transactions, and financial audit logs recorded by this bursar remain untouched.',
      })
      setNewPassword('')
      setConfirmPassword('')
      loadBursars()
    } catch (err) {
      setResetErr(
        err.response?.data?.new_password?.[0] ||
        err.response?.data?.detail ||
        errorMessage(err) ||
        'Failed to update password.'
      )
    } finally {
      setResetBusy(false)
    }
  }

  const handleToggleActive = async (bursar) => {
    const willDeactivate = bursar.is_active
    const confirmMsg = willDeactivate
      ? `Deactivate account for "${bursar.full_name || bursar.username}"? They will no longer be able to log in, but all their previous financial receipts and records will be preserved.`
      : `Reactivate account for "${bursar.full_name || bursar.username}"?`
    if (!window.confirm(confirmMsg)) return

    try {
      await api.patch(`/auth/users/${bursar.id}/`, { is_active: !bursar.is_active })
      loadBursars()
    } catch (err) {
      alert(errorMessage(err) || 'Failed to update account status.')
    }
  }

  const copyCredentials = (cred) => {
    const text = `School SMS Bursar Credentials:\nUsername: ${cred.username}\nPassword: ${cred.password}\nSign in at: ${window.location.origin}/login (Sign in as Bursar) or ${window.location.origin}/bursar/login`
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        alert('Credentials copied to clipboard!')
      }).catch(() => {
        prompt('Copy credentials:', text)
      })
    } else {
      prompt('Copy credentials:', text)
    }
  }

  const filtered = bursars.filter((b) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      b.username?.toLowerCase().includes(q) ||
      b.full_name?.toLowerCase().includes(q) ||
      b.email?.toLowerCase().includes(q) ||
      b.phone?.toLowerCase().includes(q)
    )
  })

  const totalCount = bursars.length
  const activeCount = bursars.filter((b) => b.is_active).length
  const inactiveCount = bursars.filter((b) => !b.is_active).length

  return (
    <div className="stack" style={{ gap: 20 }}>
      {/* Header and overview */}
      <div className="panel" style={{ background: 'var(--surface)' }}>
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>💼</span> Bursars & Cashiers Management
            </h2>
            <p className="muted" style={{ margin: '4px 0 0 0', fontSize: 13, maxWidth: 760 }}>
              Create bursar accounts, manage credentials, and safely recover passwords. Updating passwords
              never affects previous fee receipts, student ledger transactions, or audit logs recorded by the bursar.
            </p>
          </div>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setShowCreate(true)
              setCreateErr('')
              setCreateForm({
                username: '',
                first_name: '',
                last_name: '',
                email: '',
                phone: '',
                password: generatePassword(),
              })
            }}
          >
            + Create Bursar Account
          </button>
        </div>

        {/* Stats Row */}
        <div className="row" style={{ gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
          <div className="card" style={{ flex: '1 1 180px', padding: '12px 16px', background: 'var(--bg)' }}>
            <div className="muted" style={{ fontSize: 12 }}>Total Accounts</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--primary)' }}>{totalCount}</div>
          </div>
          <div className="card" style={{ flex: '1 1 180px', padding: '12px 16px', background: 'var(--bg)' }}>
            <div className="muted" style={{ fontSize: 12 }}>Active Cashiers</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#2e7d32' }}>{activeCount}</div>
          </div>
          <div className="card" style={{ flex: '1 1 180px', padding: '12px 16px', background: 'var(--bg)' }}>
            <div className="muted" style={{ fontSize: 12 }}>Deactivated</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--muted)' }}>{inactiveCount}</div>
          </div>
        </div>
      </div>

      {/* Info notice about separate dashboard & data integrity */}
      <div className="alert info" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 22 }}>🛡️</span>
        <div>
          <b>Dedicated Finance Dashboard:</b> Bursars sign in and work strictly within their own Finance Management
          Dashboard (<code>/bursar</code>). Changing or recovering passwords updates login authentication securely without
          affecting any past collections, receipt numbers, or audit trail data.
        </div>
      </div>

      {/* Table Section */}
      <div className="panel stack" style={{ gap: 14 }}>
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
          <input
            className="input"
            style={{ maxWidth: 320 }}
            placeholder="Search bursars by name, username, email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="button" className="btn ghost sm" onClick={loadBursars}>
            🔄 Refresh List
          </button>
        </div>

        {error && <Alert kind="error">{error}</Alert>}

        {loading ? (
          <Skeleton rows={5} />
        ) : filtered.length === 0 ? (
          <Empty
            title={search ? 'No bursars match your search' : 'No bursar accounts yet'}
            note={search ? 'Try a different search term.' : 'Click "+ Create Bursar Account" above to add the school bursar.'}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Staff & Username</th>
                  <th>Contact Info</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Date Added</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div><b>{b.full_name || '—'}</b></div>
                      <div className="muted" style={{ fontSize: 12 }}>@{b.username}</div>
                    </td>
                    <td>
                      <div>{b.email || '—'}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{b.phone || '—'}</div>
                    </td>
                    <td>
                      <span className="badge info">BURSAR / Cashier</span>
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={{
                          background: b.is_active ? 'color-mix(in srgb, #2e7d32 15%, transparent)' : 'color-mix(in srgb, var(--danger) 15%, transparent)',
                          color: b.is_active ? '#2e7d32' : 'var(--danger)',
                          fontWeight: 600,
                        }}
                      >
                        {b.is_active ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td>{fmtDate(b.created_at)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        <button
                          type="button"
                          className="btn sm"
                          title="Change or recover bursar password"
                          onClick={() => {
                            setResetBursar(b)
                            const gen = generatePassword()
                            setNewPassword(gen)
                            setConfirmPassword(gen)
                            setResetErr('')
                          }}
                        >
                          🔑 Change Password
                        </button>
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => handleToggleActive(b)}
                        >
                          {b.is_active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Create Bursar Account */}
      {showCreate && (
        <Modal title="Create New Bursar / Accountant Account" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreateSubmit} className="stack" style={{ gap: 14 }}>
            {createErr && <Alert kind="error">{createErr}</Alert>}

            <div className="row" style={{ gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>First Name *</label>
                <input
                  required
                  className="input"
                  placeholder="e.g. Sarah"
                  value={createForm.first_name}
                  onChange={(e) => setCreateForm({ ...createForm, first_name: e.target.value })}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Last Name *</label>
                <input
                  required
                  className="input"
                  placeholder="e.g. Namubiru"
                  value={createForm.last_name}
                  onChange={(e) => setCreateForm({ ...createForm, last_name: e.target.value })}
                />
              </div>
            </div>

            <div className="field">
              <label>Username *</label>
              <input
                required
                className="input"
                placeholder="e.g. bursar_sarah"
                autoComplete="off"
                value={createForm.username}
                onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
              />
              <span className="muted" style={{ fontSize: 12 }}>This will be used by the bursar to sign in.</span>
            </div>

            <div className="row" style={{ gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Email Address</label>
                <input
                  type="email"
                  className="input"
                  placeholder="bursar@school.ac.ug"
                  value={createForm.email}
                  onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Phone Number</label>
                <input
                  type="tel"
                  className="input"
                  placeholder="+256 700 000 000"
                  value={createForm.phone}
                  onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })}
                />
              </div>
            </div>

            <div className="field">
              <div className="row spread" style={{ marginBottom: 4 }}>
                <label style={{ margin: 0 }}>Initial Password *</label>
                <button
                  type="button"
                  className="btn ghost sm"
                  style={{ padding: '0 6px', fontSize: 12 }}
                  onClick={() => setCreateForm({ ...createForm, password: generatePassword() })}
                >
                  🎲 Auto-Generate Strong Password
                </button>
              </div>
              <div className="pw-wrap" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showCreatePw ? 'text' : 'password'}
                  required
                  minLength={8}
                  className="input"
                  style={{ width: '100%', paddingRight: 40 }}
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  placeholder="Minimum 8 characters"
                />
                <button
                  type="button"
                  className="pw-eye"
                  onClick={() => setShowCreatePw((s) => !s)}
                  aria-label="Toggle password"
                >
                  {showCreatePw ? '👁' : '👁‍🗨'}
                </button>
              </div>
            </div>

            <div className="row spread" style={{ marginTop: 12 }}>
              <button type="button" className="btn ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={createBusy}>
                {createBusy ? 'Creating…' : 'Create Bursar Account'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Change / Recover Bursar Password */}
      {resetBursar && (
        <Modal
          title={`Change / Recover Password: ${resetBursar.full_name || resetBursar.username}`}
          onClose={() => setResetBursar(null)}
        >
          <form onSubmit={handleResetSubmit} className="stack" style={{ gap: 14 }}>
            {resetErr && <Alert kind="error">{resetErr}</Alert>}

            <div className="alert info" style={{ fontSize: 13 }}>
              <b>Account:</b> @{resetBursar.username} ({resetBursar.full_name})<br />
              <b>Safety guarantee:</b> Resetting the password updates login access only. All previous receipts, fee
              records, and payments collected by this bursar will remain safely preserved in the database.
            </div>

            <div className="field">
              <div className="row spread" style={{ marginBottom: 4 }}>
                <label style={{ margin: 0 }}>New Password *</label>
                <button
                  type="button"
                  className="btn ghost sm"
                  style={{ padding: '0 6px', fontSize: 12 }}
                  onClick={() => {
                    const pwd = generatePassword()
                    setNewPassword(pwd)
                    setConfirmPassword(pwd)
                  }}
                >
                  🎲 Generate Strong Password
                </button>
              </div>
              <div className="pw-wrap" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showResetPw ? 'text' : 'password'}
                  required
                  minLength={8}
                  className="input"
                  style={{ width: '100%', paddingRight: 40 }}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password (min. 8 characters)"
                />
                <button
                  type="button"
                  className="pw-eye"
                  onClick={() => setShowResetPw((s) => !s)}
                  aria-label="Toggle password"
                >
                  {showResetPw ? '👁' : '👁‍🗨'}
                </button>
              </div>
            </div>

            <div className="field">
              <label>Confirm New Password *</label>
              <input
                type={showResetPw ? 'text' : 'password'}
                required
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
              />
            </div>

            <div className="row spread" style={{ marginTop: 12 }}>
              <button type="button" className="btn ghost" onClick={() => setResetBursar(null)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={resetBusy}>
                {resetBusy ? 'Updating Password…' : 'Update Bursar Password'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Modal: Credential Card (for newly created or recovered accounts) */}
      {credentialCard && (
        <Modal title={credentialCard.title} onClose={() => setCredentialCard(null)}>
          <div className="stack" style={{ gap: 14 }}>
            <p style={{ margin: 0 }}>{credentialCard.note}</p>

            <div
              className="card stack"
              style={{
                background: 'color-mix(in srgb, var(--surface) 92%, var(--primary) 8%)',
                border: '1px solid var(--primary)',
                padding: 16,
                gap: 10,
              }}
            >
              <div className="row spread">
                <span className="muted" style={{ fontSize: 13 }}>Full Name:</span>
                <b>{credentialCard.fullName}</b>
              </div>
              <div className="row spread">
                <span className="muted" style={{ fontSize: 13 }}>Role:</span>
                <span className="badge info">Bursar / Cashier</span>
              </div>
              <div className="row spread">
                <span className="muted" style={{ fontSize: 13 }}>Username:</span>
                <code style={{ fontSize: 15, fontWeight: 700 }}>{credentialCard.username}</code>
              </div>
              <div className="row spread">
                <span className="muted" style={{ fontSize: 13 }}>Password:</span>
                <code style={{ fontSize: 15, fontWeight: 700, color: 'var(--primary)' }}>
                  {credentialCard.password}
                </code>
              </div>
            </div>

            <div className="row spread" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn primary"
                onClick={() => copyCredentials(credentialCard)}
              >
                📋 Copy Login Credentials
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => setCredentialCard(null)}
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export { AdminStudentReportsPage } from './StudentReports'
