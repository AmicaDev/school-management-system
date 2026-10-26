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
        {res.credentials?.length > 0 && <div className="alert warning"><b>Temporary credentials — shown once. Copy them now and hand them out securely.</b>
          <div className="pre">{res.credentials.map((c) => c.signin_code ? `${c.username}   Password: ${c.temporary_password}   Teacher code: ${c.signin_code}   (${c.full_name || ''}${c.subject ? ` · ${c.subject}` : ''})` : `${c.username}   ${c.temporary_password}`).join('\n')}</div></div>}</div>}
    </section>
  )
}

export function TeacherAssignmentsPage() {
  const [tab, setTab] = useState('By Teacher')
  const [search, setSearch] = useState('')
  const [selectedClass, setSelectedClass] = useState('')
  const [modalTeacher, setModalTeacher] = useState(null)
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

  const filteredTeachers = teacherList.filter((t) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (t.full_name || '').toLowerCase().includes(q) || (t.username || '').toLowerCase().includes(q)
  })

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
      setModalTeacher(null)
      reloadAll()
    } catch (err) {
      setNotice(errorMessage(err))
    }
  }

  return (
    <div className="stack">
      <div className="panel-head">
        <h2>Teacher Class & Subject Assignments</h2>
        <button
          className="btn primary"
          onClick={() => setForm({ paper_number: 1, is_active: true })}
        >
          + Assign Teacher to Class
        </button>
      </div>

      <p className="muted">
        Assign teachers to Senior 1 through Senior 6 classes and subjects. Supports multiple teachers per class and multiple classes per teacher. Deactivating or ending an assignment safely revokes access without deleting past academic or attendance records.
      </p>

      {notice && <Alert kind={notice.includes('successfully') || notice.includes('updated') ? 'success' : 'error'}>{notice}</Alert>}

      <Tabs tabs={['By Teacher', 'By Class', 'All Assignments']} value={tab} onChange={setTab} />

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

          {teachers.loading ? (
            <Skeleton rows={6} />
          ) : !filteredTeachers.length ? (
            <Empty title="No teachers found" />
          ) : (
            <div className="stack">
              {filteredTeachers.map((t) => {
                const myAssigns = assignmentList.filter((a) => a.teacher === t.user_id)
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
                        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                          <b style={{ fontSize: 16 }}>{t.full_name}</b>
                          <code className="muted">@{t.username}</code>
                          <span className={`badge ${activeCount ? 'success' : 'muted'}`}>
                            {activeCount} Active Assignment{activeCount === 1 ? '' : 's'}
                          </span>
                          {t.phone && <span className="muted" style={{ fontSize: 12 }}>📞 {t.phone}</span>}
                        </div>
                      </div>
                      <button
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
                                <td>{a.teacher_subject_code || '—'}</td>
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
                                      className="btn sm"
                                      onClick={() => setForm(a)}
                                      title="Edit assignment details"
                                    >
                                      Edit
                                    </button>
                                    <button
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
                const streamAssigns = assignmentList.filter((a) => a.stream === st.id)
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
                                <td>{a.teacher_subject_code || '—'}</td>
                                <td>
                                  <span className={`badge ${a.is_active ? 'success' : 'danger'}`}>
                                    {a.is_active ? 'Active' : 'Ended'}
                                  </span>
                                </td>
                                <td><small className="muted">{a.created_at ? fmtDate(a.created_at) : '—'}</small></td>
                                <td style={{ textAlign: 'right' }}>
                                  <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                                    <button
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

      {tab === 'All Assignments' && (
        <ResourcePage cfg={R.assignments} embedded key="all-assignments-tab" />
      )}

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
                  {teacherList.map((t) => (
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

export { AdminStudentReportsPage } from './StudentReports'
