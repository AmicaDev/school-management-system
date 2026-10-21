import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, downloadFile, errorMessage, items, mediaUrl, uuid } from '../services/api'
import { useFetch } from '../hooks/useFetch'
import { useAuth } from '../contexts/AuthContext'
import { useApp } from '../contexts/AppContext'
import { enqueue } from '../offline/queue'
import { Alert, Badge, Empty, ErrorState, Skeleton, Table, Tabs, fmtDate, fmtDateTime } from '../components/ui'
import ResourcePage from './ResourcePage'
import { R } from './resources'

export const Chart = ({ children, height = 260 }) => <div className="chart-box" style={{ height }}><ResponsiveContainer>{children}</ResponsiveContainer></div>
const AXIS = { stroke: 'var(--muted)', fontSize: 12 }

export function Trend({ data }) {
  if (!data?.length) return <Empty title="No performance data yet">Results will appear once marks are recorded.</Empty>
  const sym = { improved: ['▲ Improved', 'trend-up'], declined: ['▼ Declined', 'trend-down'], stable: ['● Stable', 'trend-flat'] }
  return (
    <>
      <Chart><LineChart data={data}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="label" {...AXIS} /><YAxis domain={[0, 100]} {...AXIS} /><Tooltip />
        <Line type="monotone" dataKey="average" stroke="var(--primary)" strokeWidth={3} dot={{ r: 4 }} animationDuration={300} /></LineChart></Chart>
      <div className="row" style={{ marginTop: 12 }}>{data.map((d) => <div className="stat" key={d.term_id}><div className="l">{d.label}</div><div className="n">{d.average}%</div>
        <span className={sym[d.direction][1]}>{sym[d.direction][0]}{d.change != null && ` (${d.change > 0 ? '+' : ''}${d.change})`}</span></div>)}</div>
    </>
  )
}

export function useTerms() {
  const { data } = useFetch('/academics/terms/')
  const terms = useMemo(() => items(data), [data])
  return { terms, active: terms.find((t) => t.is_active) || terms[0] }
}

export function TermSelect({ value, onChange, terms }) {
  return <select className="input" style={{ width: 'auto' }} value={value || ''} onChange={(e) => onChange(Number(e.target.value))} aria-label="Term">{terms.map((t) => <option key={t.id} value={t.id}>{t.year_name} {t.name}</option>)}</select>
}

export function SubjectResults({ studentId, termId }) {
  const { data, loading, error, reload } = useFetch(termId ? `/results/summary/${studentId}/${termId}/` : null)
  if (!termId) return <Empty title="No term selected" />
  if (loading) return <Skeleton />
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!data.subjects.length) return <Empty title="No results for this term yet" />
  const cols = [{ key: 'subject', label: 'Subject' }, ...data.exam_types.map((e) => ({ key: e.code, label: e.name, render: (r) => r.components[e.code] ?? '—' })),
    { key: 'total', label: 'Total %' }, { key: 'grade', label: 'Grade', render: (r) => <b>{r.grade}</b> }, { key: 'remark', label: 'Remark' }]
  return (
    <div className="stack">
      <div className="row"><div className="stat"><div className="l">Average</div><div className="n">{data.average}%</div></div><div className="stat"><div className="l">Grade</div><div className="n">{data.grade}</div></div>
        {data.position && <div className="stat"><div className="l">Class position</div><div className="n">{data.position.rank} / {data.position.out_of}</div></div>}</div>
      <Table columns={cols} rows={data.subjects} rowKey="subject_id" />
      <Chart height={240}><BarChart data={data.subjects}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="code" {...AXIS} /><YAxis domain={[0, 100]} {...AXIS} /><Tooltip /><Bar dataKey="total" fill="var(--primary)" radius={[6, 6, 0, 0]} animationDuration={300} /></BarChart></Chart>
    </div>
  )
}

export function StudentProfile() {
  const { id } = useParams()
  const { user } = useAuth()
  const { terms, active } = useTerms()
  const [tab, setTab] = useState('Overview')
  const [termId, setTermId] = useState(null)
  useEffect(() => { if (active && !termId) setTermId(active.id) }, [active, termId])
  const prof = useFetch(`/students/${id}/profile/`)
  const trend = useFetch(tab === 'Performance' || tab === 'Academic History' ? `/results/trend/${id}/` : null)
  const assess = useFetch(tab === 'Assignments' ? '/results/assessments/' : null, { student: id, exam_type__code: 'ASSIGNMENT', page_size: 100 })
  const att = useFetch(tab === 'Attendance' ? '/attendance/' : null, { student: id, page_size: 60, ordering: '-date' })
  const [dl, setDl] = useState('')
  const back = `/${user.role.toLowerCase()}/${user.role === 'PARENT' ? 'children' : 'students'}`
  if (prof.loading) return <Skeleton rows={6} />
  if (prof.error) return <ErrorState message={prof.error} onRetry={prof.reload} />
  const s = prof.data.student, totals = prof.data.attendance_totals
  const sum = Object.values(totals).reduce((a, b) => a + b, 0)
  const rate = sum ? Math.round(((totals.PRESENT || 0) + (totals.LATE || 0)) / sum * 100) : null
  const TABS = ['Overview', 'Personal Information', 'Parent/Guardian', 'Attendance', 'Results', 'Assignments', 'Performance', 'Academic History']
  return (
    <div className="stack">
      <div className="row spread"><div><Link to={back}>← Back</Link><h1 style={{ margin: 0 }}>{s.full_name}</h1><span className="muted">{s.index_no} · {s.stream_label || 'No class assigned'}</span></div>
        {s.is_archived && <Badge value="warning">Archived</Badge>}</div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <section className="panel">
        {tab === 'Overview' && <div className="grid cols-3"><div className="stat"><div className="l">Class</div><div className="n" style={{ fontSize: 20 }}>{s.stream_label || '—'}</div></div>
          <div className="stat"><div className="l">Attendance rate</div><div className="n">{rate == null ? '—' : `${rate}%`}</div></div>
          <div className="stat"><div className="l">Records</div><div className="n">{sum}</div></div></div>}
        {tab === 'Personal Information' && <dl className="grid cols-2">{[['Index number', s.index_no], ['Gender', s.gender === 'M' ? 'Male' : 'Female'], ['Date of birth', fmtDate(s.date_of_birth)], ['Admission date', fmtDate(s.admission_date)]].map(([k, v]) => <div key={k}><dt className="muted">{k}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd></div>)}</dl>}
        {tab === 'Parent/Guardian' && (user.role === 'ADMIN' ? <ParentList ids={s.parent_ids} /> : <Empty title="Guardian details are managed by the school office" />)}
        {tab === 'Attendance' && (att.loading ? <Skeleton /> : att.error ? <ErrorState message={att.error} onRetry={att.reload} /> : <Table columns={[{ key: 'date', label: 'Date', render: (r) => fmtDate(r.date) }, { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> }]} rows={items(att.data)} />)}
        {tab === 'Results' && <div className="stack"><div className="row"><TermSelect terms={terms} value={termId} onChange={setTermId} />
          <button className="btn" disabled={!termId || !!dl} onClick={async () => { setDl('…'); try { await downloadFile(`/reports/report-card/${id}/${termId}/`, `report-card-${s.index_no}.pdf`) } catch (e) { alert(errorMessage(e)) } setDl('') }}>{dl ? 'Preparing…' : '⬇ Report card (PDF)'}</button></div>
          <SubjectResults studentId={id} termId={termId} /></div>}
        {tab === 'Assignments' && (assess.loading ? <Skeleton /> : assess.error ? <ErrorState message={assess.error} onRetry={assess.reload} /> : !items(assess.data).length ? <Empty title="No assignments recorded" /> :
          <Table columns={[{ key: 'title', label: 'Assignment', render: (r) => r.title || 'Assignment' }, { key: 'score', label: 'Marks', render: (r) => `${r.score} / ${r.max_score}` }, { key: 'percent', label: '%' }]} rows={items(assess.data)} />)}
        {(tab === 'Performance' || tab === 'Academic History') && (trend.loading ? <Skeleton /> : trend.error ? <ErrorState message={trend.error} onRetry={trend.reload} /> :
          tab === 'Performance' ? <Trend data={trend.data} /> : <Table columns={[{ key: 'label', label: 'Term' }, { key: 'average', label: 'Average %' }, { key: 'direction', label: 'Trend' }]} rows={trend.data || []} rowKey="term_id" />)}
      </section>
    </div>
  )
}

function ParentList({ ids = [] }) {
  const { data, loading } = useFetch('/parents/', { page_size: 200 })
  if (loading) return <Skeleton rows={2} />
  const list = items(data).filter((p) => ids.includes(p.id))
  return list.length ? <Table columns={[{ key: 'full_name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }]} rows={list} /> : <Empty title="No parent linked yet" />
}

/** One ZIP of every report card in a class, built as a background job and polled until ready. */
function BatchCards({ stream, termId }) {
  const [job, setJob] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setJob(null); setErr('') }, [stream, termId])
  useEffect(() => {
    if (!job || !['PENDING', 'RUNNING'].includes(job.status)) return undefined
    const t = setInterval(async () => {
      try { const { data } = await api.get('/reports/class-cards/'); const mine = data.find((j) => j.id === job.id); if (mine) setJob(mine) } catch { /* keep polling */ }
    }, 2500)
    return () => clearInterval(t)
  }, [job])
  const start = async () => {
    setBusy(true); setErr('')
    try { setJob((await api.post('/reports/class-cards/', { stream, term: termId })).data) } catch (e) { setErr(errorMessage(e)) }
    setBusy(false)
  }
  return (
    <div className="row" style={{ marginBottom: 12 }}>
      <button className="btn primary" disabled={busy || ['PENDING', 'RUNNING'].includes(job?.status)} onClick={start}>Generate all report cards (ZIP)</button>
      {job && ['PENDING', 'RUNNING'].includes(job.status) && <span className="muted"><span className="spinner" /> Building in the background…</span>}
      {job?.status === 'DONE' && <button className="btn" onClick={() => downloadFile(`/reports/class-cards/${job.id}/download/`, `report-cards-${job.id}.zip`).catch((e) => setErr(errorMessage(e)))}>⬇ Download ZIP ({job.count} report cards)</button>}
      {job?.status === 'FAILED' && <span className="alert error" style={{ margin: 0 }}>Failed: {job.error} — a developer can retry it from Maintenance.</span>}
      <Alert>{err}</Alert>
    </div>
  )
}

function getIdentifierInfo(c1) {
  if (c1 == null) return { ident: '—', desc: '—' }
  const raw = Math.round(Number(c1))
  if (raw <= 1) return { ident: 1, desc: 'BASIC' }
  if (raw === 2) return { ident: 2, desc: 'MODERATE' }
  return { ident: 3, desc: 'OUTSTANDING' }
}

/** Class results for a stream/term, with teacher marks breakdown and report-card downloads. */
export function ClassResults({ downloads = true }) {
  const { terms, active } = useTerms()
  const streams = useFetch('/academics/streams/')
  const subjects = useFetch('/academics/subjects/', { is_archived: false })
  const [stream, setStream] = useState('')
  const [termId, setTermId] = useState(null)
  const [subjectFilter, setSubjectFilter] = useState('')
  const [viewMode, setViewMode] = useState(downloads ? 'summary' : 'detailed')
  const [busy, setBusy] = useState(null)

  useEffect(() => { if (active && !termId) setTermId(active.id) }, [active, termId])

  const res = useFetch(stream && termId ? '/results/class-summary/' : null, { stream, term: termId, detailed: 1 })

  // Summary columns
  const summaryCols = [
    { key: 'index_no', label: 'Index no.' },
    { key: 'name', label: 'Student' },
    { key: 'subjects', label: 'Subjects' },
    { key: 'average', label: 'Average %' },
    { key: 'grade', label: 'Grade' },
    { key: 'position', label: 'Position' },
    ...(downloads ? [{
      key: 'pdf', label: '',
      render: (r) => (
        <button className="btn sm" disabled={busy === r.id} onClick={async () => {
          setBusy(r.id)
          try { await downloadFile(`/reports/report-card/${r.id}/${termId}/`, `report-card-${r.index_no}.pdf`) } catch (e) { alert(errorMessage(e)) }
          setBusy(null)
        }}>
          {busy === r.id ? '…' : 'Report card PDF'}
        </button>
      ),
    }] : []),
    { key: 'p', label: '', render: (r) => <Link className="btn sm" to={`/admin/students/${r.id}`}>Profile</Link> },
  ]

  // Flattened teacher-submitted marks breakdown
  const markRows = useMemo(() => {
    if (!res.data || !Array.isArray(res.data)) return []
    const out = []
    res.data.forEach((student) => {
      const subList = student.report?.subjects || []
      subList.forEach((sub) => {
        if (subjectFilter && String(sub.subject_id) !== String(subjectFilter)) return
        const rawComps = sub.raw_components || {}
        const comps = sub.components || {}
        const botVal = rawComps['BOT'] != null ? Number(rawComps['BOT']) : (comps['BOT'] != null ? Number(comps['BOT']) : null)
        const midVal = rawComps['MID'] != null ? Number(rawComps['MID']) : (rawComps['MIDTERM'] != null ? Number(rawComps['MIDTERM']) : (comps['MID'] != null ? Number(comps['MID']) : null))
        const eotVal = rawComps['FINAL'] != null ? Number(rawComps['FINAL']) : (rawComps['EOT'] != null ? Number(rawComps['EOT']) : (comps['FINAL'] != null ? Number(comps['FINAL']) : (comps['EOT'] != null ? Number(comps['EOT']) : null)))

        const col20 = botVal != null ? botVal : null
        const c1Raw = sub.c1 != null ? Number(sub.c1) : (col20 != null ? (col20 / 20.0) * 3.0 : (comps['C1'] != null ? Number(comps['C1']) : null))
        const c1 = c1Raw != null ? Number(c1Raw.toFixed(1)) : null

        const c2Raw = sub.c2 != null ? Number(sub.c2) : (midVal != null ? (midVal / 20.0) * 3.0 : c1)
        const c2 = c2Raw != null ? Number(c2Raw.toFixed(1)) : c1

        const avgRaw = (c1 != null && c2 != null) ? (c1 + c2) / 2.0 : (c1 != null ? c1 : c2)
        const avg = avgRaw != null ? Number(avgRaw.toFixed(1)) : null
        const idInfo = getIdentifierInfo(avg != null ? avg : c1)

        const final100 = sub.total != null
          ? Number(sub.total)
          : (col20 != null && eotVal != null ? (col20 + eotVal) : (eotVal != null ? eotVal : (col20 != null ? col20 : null)))

        out.push({
          id: `${student.id}-${sub.subject_id}`,
          student_id: student.id,
          name: student.name,
          index_no: student.index_no,
          subject: sub.subject,
          bot: col20 != null ? col20 : '—',
          c1: c1 != null ? c1 : '—',
          avg: avg != null ? avg : '—',
          ident: idInfo.ident,
          descr: idInfo.desc,
          mid: midVal != null ? midVal : '—',
          eot: eotVal != null ? eotVal : '—',
          final_mark: final100 != null ? `${final100}%` : '—',
          grade: sub.grade || '—',
          remark: sub.remark || '—',
          tr_initials: sub.teacher_initials || 'TR',
        })
      })
    })
    return out
  }, [res.data, subjectFilter])

  const detailedCols = [
    { key: 'name', label: 'Name of student' },
    { key: 'subject', label: 'Subject' },
    { key: 'bot', label: 'BOT (out of 20)' },
    { key: 'c1', label: 'C1' },
    { key: 'avg', label: 'AVG' },
    { key: 'ident', label: 'IDENT' },
    { key: 'descr', label: 'DESCR' },
    { key: 'mid', label: 'Mid-Term' },
    { key: 'eot', label: 'End Of Term (Out of 80)' },
    { key: 'final_mark', label: 'Final Mark (100)' },
    { key: 'grade', label: 'GRADE' },
    { key: 'remark', label: 'REMARKS' },
    { key: 'tr_initials', label: 'TR INITIALS' },
  ]

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Results & Submitted Marks</h2>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <select className="input" style={{ width: 'auto' }} value={stream} onChange={(e) => setStream(e.target.value)} aria-label="Class and stream">
            <option value="">Select class & stream</option>
            {items(streams.data).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <TermSelect terms={terms} value={termId} onChange={setTermId} />
          {viewMode === 'detailed' && (
            <select className="input" style={{ width: 'auto' }} value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)} aria-label="Filter by subject">
              <option value="">All subjects</option>
              {items(subjects.data).map((sub) => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
            </select>
          )}
          <div className="row" style={{ gap: 4 }}>
            <button type="button" className={`btn sm${viewMode === 'detailed' ? ' primary' : ''}`} onClick={() => setViewMode('detailed')}>Teacher Marks</button>
            <button type="button" className={`btn sm${viewMode === 'summary' ? ' primary' : ''}`} onClick={() => setViewMode('summary')}>Class Summary</button>
          </div>
        </div>
      </div>
      {downloads && stream && termId && <BatchCards stream={stream} termId={termId} />}
      {!stream ? (
        <Empty title="Choose a class and stream">Select a class stream and academic term above to view submitted marks.</Empty>
      ) : res.loading ? (
        <Skeleton rows={6} />
      ) : res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : !res.data.length ? (
        <Empty title="No students in this stream" />
      ) : viewMode === 'detailed' ? (
        !markRows.length ? (
          <Empty title="No marks submitted yet">Teachers have not entered marks for this class and term.</Empty>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <Table columns={detailedCols} rows={markRows} />
          </div>
        )
      ) : (
        <Table columns={summaryCols} rows={res.data} />
      )}
    </section>
  )
}

export function NotificationsPage() {
  const [page, setPage] = useState(1)
  const { data, loading, error, reload } = useFetch('/notifications/', { page, page_size: 20 })
  const mark = async (id) => { await api.post(`/notifications/${id}/read/`); reload() }
  const all = async () => { await api.post('/notifications/read_all/'); reload() }
  const list = items(data)
  return (
    <section className="panel">
      <div className="panel-head"><h2>Notifications</h2><button className="btn sm" onClick={all}>Mark all as read</button></div>
      {loading && !list.length ? <Skeleton /> : error ? <ErrorState message={error} onRetry={reload} /> : !list.length ? <Empty title="You're all caught up" /> :
        <div className="stack">{list.map((n) => (
          <div key={n.id} className="row spread" style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: n.is_read ? 'transparent' : 'var(--primary-50)' }}>
            <div><div className="row"><Badge>{n.kind}</Badge>{n.priority === 'HIGH' && <Badge value="HIGH" />}<b>{n.title}</b></div><div className="muted">{n.body}</div><small className="muted">{fmtDateTime(n.created_at)}</small></div>
            {!n.is_read && <button className="btn sm" onClick={() => mark(n.id)}>Mark read</button>}
          </div>))}
          {data?.count > 20 && <div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button className="btn sm" disabled={page * 20 >= data.count} onClick={() => setPage(page + 1)}>Next</button></div>}</div>}
    </section>
  )
}

export function EventsPage() {
  const cfg = { ...R.events, readOnly: true }
  return <ResourcePage cfg={cfg} />
}

/** Admin inbox + conversation, and parent compose. Parent submissions work offline via the sync queue. */
export function ParentProfile() {
  const { user, setUser } = useAuth()
  const [address, setAddress] = useState(user.address || '')
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState({ kind: 'info', text: '' })
  const preview = useMemo(() => photo ? URL.createObjectURL(photo) : mediaUrl(user.photo), [photo, user.photo])

  useEffect(() => {
    if (!photo) return undefined
    return () => URL.revokeObjectURL(preview)
  }, [photo, preview])

  const save = async (event) => {
    event.preventDefault()
    if (photo && (!photo.type.startsWith('image/') || photo.size > 2 * 1024 * 1024)) {
      setNotice({ kind: 'error', text: 'Choose an image no larger than 2 MB.' })
      return
    }
    const body = new FormData()
    body.append('address', address)
    if (photo) body.append('photo', photo)
    setBusy(true)
    try {
      const { data } = await api.patch('/auth/me/', body)
      setUser(data)
      setPhoto(null)
      setNotice({ kind: 'success', text: 'Your profile has been updated.' })
    } catch (e) {
      setNotice({ kind: 'error', text: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return <form className="panel" onSubmit={save} style={{ maxWidth: 680 }}>
    <div className="panel-head"><h2>Parent profile</h2></div>
    <Alert kind={notice.kind}>{notice.text}</Alert>
    <div className="field"><label htmlFor="parent-photo">Profile picture (PNG, JPG or WebP, max 2 MB)</label>
      {preview && <img src={preview} alt="Profile preview" style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover' }} />}
      <input id="parent-photo" type="file" accept="image/png,image/jpeg,image/webp" className="input" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
    </div>
    <div className="field"><label htmlFor="parent-address">Address or location</label><textarea id="parent-address" className="input" rows={3} maxLength={255} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Enter your home address or location" /></div>
    <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
  </form>
}

export function Enquiries() {
  const { user } = useAuth()
  const { online, refreshCount, sync } = useApp()
  const [archivedView, setArchivedView] = useState(false)
  const list = useFetch('/enquiries/', { page_size: 50, archived: archivedView })
  const [openId, setOpenId] = useState(null)
  const [selectedMessages, setSelectedMessages] = useState([])
  const [reply, setReply] = useState('')
  const [compose, setCompose] = useState(false)
  const [form, setForm] = useState({ subject: '', body: '', student: '' })
  const [msg, setMsg] = useState({ kind: 'info', text: '' })
  const kids = useFetch(user.role === 'PARENT' ? '/students/' : null)
  const current = items(list.data).find((e) => e.id === openId)
  useEffect(() => {
    if (current && current.unread) api.post(`/enquiries/${current.id}/mark_read/`).then(() => list.reload()).catch((e) => setMsg({ kind: 'error', text: errorMessage(e) }))
  }, [openId]) // eslint-disable-line
  useEffect(() => {
    const firstChild = items(kids.data)[0]
    if (firstChild && !form.student) setForm((state) => ({ ...state, student: String(firstChild.id) }))
  }, [kids.data]) // eslint-disable-line
  useEffect(() => { setSelectedMessages([]) }, [openId])

  const send = async (e) => {
    e.preventDefault()
    if (!form.subject.trim() || !form.body.trim()) return setMsg({ kind: 'error', text: 'Subject and message are required.' })
    const payload = { subject: form.subject.trim(), body: form.body.trim(), student: form.student || null, client_txn_id: uuid() }
    try {
      if (!online) throw Object.assign(new Error('offline'), { offline: true })
      await api.post('/enquiries/', payload)
      setMsg({ kind: 'success', text: 'Enquiry sent.' }); setCompose(false); setForm({ subject: '', body: '', student: '' }); list.reload()
    } catch (err) {
      if (!err.response) {
        await enqueue('enquiry', '/enquiries/', payload, payload.subject); refreshCount(); setCompose(false); setForm({ subject: '', body: '', student: '' })
        setMsg({ kind: 'info', text: 'You are offline. Your enquiry is saved on this device and will be sent automatically.' }); sync()
      } else setMsg({ kind: 'error', text: errorMessage(err) })
    }
  }
  const sendReply = async () => {
    if (!reply.trim()) return
    try { await api.post(`/enquiries/${openId}/reply/`, { body: reply }); setReply(''); list.reload() } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }) }
  }
  const archive = async () => {
    if (!current) return
    try {
      await api.post(`/enquiries/${current.id}/${archivedView ? 'restore' : 'archive'}/`)
      setOpenId(null)
      list.reload()
    } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }) }
  }
  const deleteSelected = async () => {
    if (!current || !selectedMessages.length || !window.confirm('Permanently delete the selected message(s) for both participants?')) return
    try {
      await api.post(`/enquiries/${current.id}/delete_messages/`, { message_ids: selectedMessages })
      setSelectedMessages([])
      list.reload()
    } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }) }
  }
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <section className="panel">
        <div className="panel-head"><h2>{user.role === 'PARENT' ? 'My enquiries' : 'Inbox'}</h2><div className="row">
          <button className="btn sm" onClick={() => { setArchivedView((v) => !v); setOpenId(null) }}>{archivedView ? 'Active conversations' : 'Archived'}</button>
          {user.role === 'PARENT' && <button className="btn primary" onClick={() => setCompose(true)}>New enquiry</button>}</div></div>
        <Alert kind={msg.kind}>{msg.text}</Alert>
        {compose && <form onSubmit={send} className="panel" style={{ marginBottom: 12 }}>
          <div className="field"><label htmlFor="es">Subject</label><input id="es" className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} maxLength={200} /></div>
          {items(kids.data).length > 0 && <div className="field"><label htmlFor="ec">Regarding</label><select id="ec" className="input" value={form.student} onChange={(e) => setForm({ ...form, student: e.target.value })}>{items(kids.data).map((k) => <option key={k.id} value={k.id}>{k.full_name} · {k.index_no}</option>)}</select></div>}
          <div className="field"><label htmlFor="em">Message</label><textarea id="em" rows={4} className="input" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} maxLength={4000} /></div>
          <div className="row"><button className="btn primary">Send</button><button type="button" className="btn" onClick={() => setCompose(false)}>Cancel</button></div></form>}
        {list.loading ? <Skeleton /> : list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !items(list.data).length ? <Empty title="No enquiries yet" /> :
          <div className="stack">{items(list.data).map((e) => (
            <button key={e.id} className="btn" style={{ width: '100%', justifyContent: 'space-between', background: openId === e.id ? 'var(--primary-50)' : undefined }} onClick={() => setOpenId(e.id)}>
              <span style={{ textAlign: 'left' }}><b>{e.subject}</b><br /><small className="muted">{user.role !== 'PARENT' && `${e.parent_name} · `}{e.student_name ? `${e.student_name} · ` : ''}{fmtDateTime(e.updated_at)}</small></span>
              <span className="row">{e.unread > 0 && <Badge value="HIGH">{e.unread} new</Badge>}<Badge value={e.status} /></span></button>))}</div>}
      </section>
      <section className="panel">
        {!current ? <Empty title="Select an enquiry to read the conversation" /> : <>
          <div className="panel-head"><div><h2>{current.subject}</h2>{current.student_name && <small className="muted">{current.student_name} · Index {current.student_index_no}</small>}</div>
            <div className="row">{user.role === 'ADMIN' && <button className="btn sm" onClick={() => window.confirm('Close this conversation?') && api.post(`/enquiries/${current.id}/close/`).then(list.reload).catch((e) => setMsg({ kind: 'error', text: errorMessage(e) }))}>Close</button>}
              <button className="btn sm" onClick={archive}>{archivedView ? 'Restore' : 'Archive for me'}</button></div></div>
          {user.role !== 'PARENT' && <div className="row" style={{ alignItems: 'center', padding: 12, borderBottom: '1px solid var(--border)' }}>
            {current.parent_photo ? <img src={mediaUrl(current.parent_photo)} alt="" style={{ width: 46, height: 46, borderRadius: '50%', objectFit: 'cover' }} /> : <span className="avatar">{current.parent_name?.slice(0, 1) || 'P'}</span>}
            <div><b>{current.parent_name}</b><div className="muted">{current.parent_phone || 'No phone'} · {current.parent_address || 'No address added'}</div></div>
          </div>}
          {selectedMessages.length > 0 && <div className="row"><span className="muted">{selectedMessages.length} selected</span><button className="btn sm danger" onClick={deleteSelected}>Delete for both</button><button className="btn sm" onClick={() => setSelectedMessages([])}>Cancel</button></div>}
          {current.messages.map((m) => {
            const canDelete = user.role === 'ADMIN' || m.sender === user.id
            const checked = selectedMessages.includes(m.id)
            return <div key={m.id} className={`bubble${m.sender === user.id ? ' me' : ''}`}>
              <div className="row spread"><small className="muted">{m.sender_name} · {fmtDateTime(m.created_at)}{m.sender === user.id && m.read_at ? ' · read' : ''}</small>
                {canDelete && <label className="row" style={{ gap: 5, fontSize: 12 }}><input type="checkbox" checked={checked} onChange={() => setSelectedMessages((ids) => checked ? ids.filter((id) => id !== m.id) : [...ids, m.id])} /> Select</label>}</div>
              <div>{m.body}</div>
            </div>
          })}
          {!archivedView && current.status !== 'CLOSED' && <div className="row" style={{ marginTop: 12 }}><textarea className="input" rows={2} style={{ flex: 1 }} placeholder="Write a reply…" value={reply} onChange={(e) => setReply(e.target.value)} aria-label="Reply" /><button className="btn primary" onClick={sendReply}>Reply</button></div>}</>}
      </section>
    </div>
  )
}
