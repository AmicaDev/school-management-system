import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { downloadFile, errorMessage, items } from '../services/api'
import { useFetch } from '../hooks/useFetch'
import { Alert, Empty, ErrorState, Skeleton, Table, fmtDate } from '../components/ui'
import { Chart, SubjectResults, TermSelect, Trend, useTerms } from './Shared'

function useChildren() {
  const { data, loading, error, reload } = useFetch('/students/', { page_size: 50 })
  const children = items(data)
  const [id, setId] = useState('')
  useEffect(() => { if (children.length && !id) setId(String(children[0].id)) }, [children, id])
  return { children, id, setId, loading, error, reload }
}

function ChildPicker({ c }) {
  if (c.children.length < 2) return c.children[0] ? <h2 style={{ margin: 0 }}>{c.children[0].full_name}</h2> : null
  return <select className="input" style={{ width: 'auto' }} value={c.id} onChange={(e) => c.setId(e.target.value)} aria-label="Select child">{c.children.map((k) => <option key={k.id} value={k.id}>{k.full_name}</option>)}</select>
}

function WithChild({ title, children }) {
  const c = useChildren()
  if (c.loading) return <Skeleton rows={5} />
  if (c.error) return <ErrorState message={c.error} onRetry={c.reload} />
  if (!c.children.length) return <Empty title="No children linked to your account">Please contact the school office.</Empty>
  if (!c.id) return <Skeleton rows={3} />
  return <section className="panel"><div className="panel-head"><h2>{title}</h2><ChildPicker c={c} /></div>{children(c.id, c)}</section>
}

export function ParentDashboard() {
  const c = useChildren()
  const { active } = useTerms()
  const prof = useFetch(c.id ? `/students/${c.id}/profile/` : null)
  const sum = useFetch(c.id && active ? `/results/summary/${c.id}/${active.id}/` : null)
  const trend = useFetch(c.id ? `/results/trend/${c.id}/` : null)
  const ev = useFetch('/events/', { page_size: 20 })
  const att = useFetch(c.id ? '/attendance/' : null, { student: c.id, page_size: 60, ordering: '-date' })
  const upcoming = items(ev.data).filter((e) => e.start_date >= new Date().toISOString().slice(0, 10)).slice(0, 4)
  const weekly = useMemo(() => {
    const m = {}
    items(att.data).forEach((r) => { const k = r.date.slice(0, 7); m[k] = m[k] || { month: k, present: 0, total: 0 }; m[k].total += 1; if (r.status === 'PRESENT' || r.status === 'LATE') m[k].present += 1 })
    return Object.values(m).map((x) => ({ ...x, rate: Math.round((x.present / x.total) * 100) })).reverse()
  }, [att.data])
  if (c.loading) return <Skeleton rows={6} />
  if (c.error) return <ErrorState message={c.error} onRetry={c.reload} />
  if (!c.children.length) return <Empty title="No children linked to your account">Please contact the school office.</Empty>
  const totals = prof.data?.attendance_totals || {}, n = Object.values(totals).reduce((a, b) => a + b, 0)
  return (
    <div className="stack">
      <div className="row spread"><div className="row"><span className="muted">Child</span><ChildPicker c={c} /></div><Link className="btn" to={`/parent/children/${c.id}`}>Full profile</Link></div>
      <div className="grid cols-3">
        <div className="stat"><div className="l">Current class</div><div className="n" style={{ fontSize: 20 }}>{c.children.find((k) => String(k.id) === c.id)?.stream_label || '—'}</div></div>
        <div className="stat"><div className="l">Attendance</div><div className="n">{n ? `${Math.round(((totals.PRESENT || 0) + (totals.LATE || 0)) / n * 100)}%` : '—'}</div></div>
        <div className="stat"><div className="l">Average ({active?.name || 'term'})</div><div className="n">{sum.data?.subjects?.length ? `${sum.data.average}%` : '—'}</div></div>
      </div>
      <div className="grid cols-2">
        <section className="panel"><h3>Recent results</h3>{sum.loading ? <Skeleton rows={3} /> : !sum.data?.subjects?.length ? <Empty title="No results yet" /> : <Table columns={[{ key: 'subject', label: 'Subject' }, { key: 'total', label: 'Total %' }, { key: 'grade', label: 'Grade' }]} rows={sum.data.subjects} rowKey="subject_id" />}</section>
        <section className="panel"><h3>Upcoming events</h3>{!upcoming.length ? <Empty title="No upcoming events" /> : <div className="stack">{upcoming.map((e) => <div key={e.id}><b>{e.title}</b><br /><small className="muted">{fmtDate(e.start_date)}</small></div>)}</div>}</section>
        <section className="panel"><h3>Term performance</h3>{trend.loading ? <Skeleton rows={3} /> : trend.error ? <ErrorState message={trend.error} onRetry={trend.reload} /> : <Trend data={trend.data} />}</section>
        <section className="panel"><h3>Attendance trend</h3>{weekly.length ? <Chart><BarChart data={weekly}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="month" stroke="var(--muted)" fontSize={12} /><YAxis domain={[0, 100]} stroke="var(--muted)" fontSize={12} /><Tooltip /><Bar dataKey="rate" name="Attendance %" fill="var(--success)" radius={[6, 6, 0, 0]} animationDuration={300} /></BarChart></Chart> : <Empty title="No attendance recorded yet" />}</section>
      </div>
    </div>
  )
}

export function ChildrenList() {
  const c = useChildren()
  if (c.loading) return <Skeleton />
  if (c.error) return <ErrorState message={c.error} onRetry={c.reload} />
  if (!c.children.length) return <Empty title="No children linked to your account" />
  return <div className="grid cols-3">{c.children.map((k) => <Link key={k.id} to={`/parent/children/${k.id}`} className="panel" style={{ textDecoration: 'none', color: 'inherit' }}><h3>{k.full_name}</h3><div className="muted">{k.index_no}</div><div>{k.stream_label || 'No class'}</div></Link>)}</div>
}

export function ParentAttendance() {
  return <WithChild title="Attendance">{(id) => <AttendanceTable id={id} />}</WithChild>
}
function AttendanceTable({ id }) {
  const att = useFetch('/attendance/', { student: id, page_size: 100, ordering: '-date' })
  if (att.loading) return <Skeleton />
  if (att.error) return <ErrorState message={att.error} onRetry={att.reload} />
  return items(att.data).length ? <Table columns={[{ key: 'date', label: 'Date', render: (r) => fmtDate(r.date) }, { key: 'status', label: 'Status', render: (r) => <span className={`badge ${r.status}`}>{r.status}</span> }]} rows={items(att.data)} /> : <Empty title="No attendance recorded yet" />
}

export function ParentResults() {
  const { terms, active } = useTerms()
  const [termId, setTermId] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { if (active && !termId) setTermId(active.id) }, [active, termId])
  return (
    <WithChild title="Results">{(id, c) => (
      <div className="stack"><div className="row"><TermSelect terms={terms} value={termId} onChange={setTermId} />
        <button className="btn" disabled={!termId} onClick={async () => { setErr(''); try { await downloadFile(`/reports/report-card/${id}/${termId}/`, `report-card-${c.children.find((k) => String(k.id) === id)?.index_no}.pdf`) } catch (e) { setErr(errorMessage(e)) } }}>⬇ Download report card</button></div>
        <Alert>{err}</Alert><SubjectResults studentId={id} termId={termId} /></div>)}</WithChild>
  )
}

export function ParentPerformance() {
  return <WithChild title="Performance analytics">{(id) => <PerfBody id={id} />}</WithChild>
}
function PerfBody({ id }) {
  const t = useFetch(id ? `/results/trend/${id}/` : null)
  if (t.loading) return <Skeleton />
  if (t.error) return <ErrorState message={t.error} onRetry={t.reload} />
  const d = t.data || [], cur = d[d.length - 1], prev = d[d.length - 2]
  return <div className="stack">{cur && prev && <Alert kind={cur.direction === 'declined' ? 'warning' : 'info'}>{cur.label}: {cur.average}% compared with {prev.average}% in {prev.label} — {cur.direction === 'improved' ? 'improvement' : cur.direction === 'declined' ? 'decline' : 'stable performance'}.</Alert>}<Trend data={d} /></div>
}
