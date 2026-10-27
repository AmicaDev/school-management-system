import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api, errorMessage, items, uuid } from '../services/api'
import { useFetch } from '../hooks/useFetch'
import { useAuth } from '../contexts/AuthContext'
import { useApp } from '../contexts/AppContext'
import { dbGet, dbPut, dbDel } from '../offline/db'
import { enqueue } from '../offline/queue'
import { Alert, Badge, Empty, ErrorState, Skeleton, Table, fmtDateTime } from '../components/ui'
import { TermSelect, useTerms, getIdentifierInfo } from './Shared'

const today = () => new Date().toISOString().slice(0, 10)
const STATES = [['PRESENT', 'P', 'Present'], ['ABSENT', 'A', 'Absent'], ['LATE', 'L', 'Late'], ['EXCUSED', 'E', 'Excused']]

/** Streams this teacher may work with (assigned subjects + classes they are class teacher of). */
export function useMyStreams() {
  const { user } = useAuth()
  const a = useFetch('/academics/assignments/', { page_size: 500 })
  const s = useFetch('/academics/streams/')
  const c = useFetch('/academics/classes/')
  const subFetch = useFetch('/academics/subjects/', { page_size: 200 })
  const assignments = items(a.data)
  const allSubjects = items(subFetch.data)
  const allClasses = items(c.data)
  const allStreams = items(s.data)

  const activeAssignments = useMemo(() => {
    return assignments.filter((x) => x.is_active !== false)
  }, [assignments])

  const assignedStreamIds = useMemo(() => {
    if (user?.role === 'ADMIN') return new Set(allStreams.map((x) => Number(x.id)))
    const ids = new Set(activeAssignments.map((x) => Number(x.stream)))
    allStreams.filter((x) => String(x.class_teacher) === String(user?.id)).forEach((x) => ids.add(Number(x.id)))
    return ids
  }, [activeAssignments, allStreams, user?.id, user?.role])

  const assignedClassIds = useMemo(() => {
    if (user?.role === 'ADMIN') return new Set(allClasses.map((cl) => Number(cl.id)))
    const ids = new Set()
    allStreams.forEach((st) => {
      if (assignedStreamIds.has(Number(st.id)) && st.school_class) {
        ids.add(Number(st.school_class))
      }
    })
    return ids
  }, [allStreams, assignedStreamIds, allClasses, user?.role])

  const streams = useMemo(() => {
    if (user?.role === 'ADMIN') return allStreams
    return allStreams.filter((x) => assignedStreamIds.has(Number(x.id)))
  }, [allStreams, assignedStreamIds, user?.role])

  return {
    assignments: activeAssignments,
    allAssignments: assignments,
    streams,
    allStreams,
    allClasses,
    assignedClassIds,
    assignedStreamIds,
    allSubjects,
    loading: a.loading || s.loading || c.loading || subFetch.loading,
    error: a.error || s.error || c.error || subFetch.error,
    reload: () => { a.reload(); s.reload(); c.reload(); subFetch.reload() }
  }
}

export function TeacherDashboard() {
  const my = useMyStreams()
  const tt = useFetch('/timetable/today/')
  const notes = useFetch('/notifications/', { page_size: 5 })
  const { active } = useTerms()
  const first = my.streams[0]
  const snap = useFetch(first && active ? '/results/class-summary/' : null, { stream: first?.id, term: active?.id })
  if (my.loading) return <Skeleton rows={6} />
  if (my.error) return <ErrorState message={my.error} onRetry={my.reload} />
  const subjects = [...new Map(my.assignments.map((a) => [`${a.subject}-${a.stream}-${a.paper_number}`, a])).values()]
  return (
    <div className="stack">
      <div className="panel"><h2>Quick actions</h2><div className="row"><Link className="btn primary lg" to="/teacher/attendance">Take Attendance</Link><Link className="btn lg" to="/teacher/marks">Enter Marks</Link><Link className="btn lg" to="/teacher/assignments">Assignment marks (out of …)</Link><Link className="btn lg" to="/teacher/classes">View Class</Link><Link className="btn lg" to="/teacher/timetable">View Timetable</Link></div></div>
      <div className="grid cols-2">
        <section className="panel"><h2>Today's timetable</h2>{tt.loading ? <Skeleton rows={3} /> : !items(tt.data).length ? <Empty title="No lessons today" /> : <Table columns={[{ key: 'period', label: 'Period' }, { key: 'subject_name', label: 'Subject' }, { key: 'stream_label', label: 'Class' }, { key: 'room', label: 'Room' }]} rows={items(tt.data)} />}</section>
        <section className="panel"><h2>Assigned subjects</h2>{!subjects.length ? <Empty title="No subjects assigned yet">Ask the administrator to assign your classes.</Empty> : <div className="stack">{subjects.map((a) => <div key={a.id} className="row spread"><span><b>{a.subject_name}</b> <span className="muted">{a.stream_label} · Paper {a.paper_number}{a.teacher_subject_code && ` · ${a.teacher_subject_code}`}</span></span><Link className="btn sm" to="/teacher/marks">Marks</Link></div>)}</div>}</section>
        <section className="panel"><h2>Recent notifications</h2>{!items(notes.data).length ? <Empty title="No notifications" /> : <div className="stack">{items(notes.data).map((n) => <div key={n.id}><b>{n.title}</b> <small className="muted">{fmtDateTime(n.created_at)}</small></div>)}</div>}</section>
        <section className="panel"><h2>Student performance{first ? ` — ${first.label}` : ''}</h2>{!first ? <Empty title="No class yet" /> : snap.loading ? <Skeleton rows={3} /> : !snap.data?.length ? <Empty title="No results yet" /> : <Table columns={[{ key: 'name', label: 'Student' }, { key: 'average', label: 'Average %' }, { key: 'grade', label: 'Grade' }]} rows={[...snap.data].sort((a, b) => b.average - a.average).slice(0, 5)} />}</section>
      </div>
    </div>
  )
}

function useSavedRoster() { // IndexedDB cache so rosters are available offline
  return { put: (key, value) => dbPut('cache', { key, value }).catch(() => {}), get: (key) => dbGet('cache', key).then((r) => r?.value).catch(() => null) }
}

export function Attendance() {
  const my = useMyStreams()
  const { user } = useAuth()
  const { online, refreshCount, sync } = useApp()
  const cache = useSavedRoster()
  const [selectedClass, setSelectedClass] = useState('')
  const [stream, setStream] = useState('')
  const [subject, setSubject] = useState('')
  const [date, setDate] = useState(today())
  const [rows, setRows] = useState([])
  const [load, setLoad] = useState({ loading: false, error: '' })
  const [save, setSave] = useState({ state: 'idle', msg: '' })
  const [fromCache, setFromCache] = useState(false)
  const listRef = useRef()

  const classes = useMemo(() => {
    return [...my.allClasses].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, [my.allClasses])

  const isClassAssigned = useMemo(() => {
    if (!selectedClass) return false
    if (user?.role === 'ADMIN') return true
    return my.assignedClassIds.has(Number(selectedClass))
  }, [selectedClass, my.assignedClassIds, user?.role])

  const availableStreams = useMemo(() => {
    if (!selectedClass || !isClassAssigned) return []
    return my.streams.filter((s) => String(s.school_class) === String(selectedClass))
  }, [my.streams, selectedClass, isClassAssigned])

  // Auto-select stream if only 1 stream exists in the assigned class
  useEffect(() => {
    if (selectedClass && isClassAssigned && availableStreams.length === 1 && !stream) {
      setStream(String(availableStreams[0].id))
    }
  }, [selectedClass, isClassAssigned, availableStreams, stream])

  const subjects = useMemo(() => {
    return [...new Map(my.assignments.filter((a) => String(a.stream) === String(stream)).map((a) => [a.subject, a])).values()]
  }, [my.assignments, stream])

  const fetchRoster = useCallback(async () => {
    if (!stream) return setRows([])
    setLoad({ loading: true, error: '' }); setSave({ state: 'idle', msg: '' }); setFromCache(false)
    const key = `sheet:${stream}:${date}:${subject}`
    try {
      const { data } = await api.get('/attendance/sheet/', { params: { stream, date, ...(subject ? { subject } : {}) } })
      setRows(data); cache.put(key, data); cache.put(`roster:${stream}`, data.map((r) => ({ ...r, status: null }))); setLoad({ loading: false, error: '' })
    } catch (e) {
      if (!e.response) {
        const hit = (await cache.get(key)) || (await cache.get(`roster:${stream}`))
        if (hit) { setRows(hit); setFromCache(true); setLoad({ loading: false, error: '' }); return }
      }
      setLoad({ loading: false, error: errorMessage(e) })
    }
  }, [stream, date, subject]) // eslint-disable-line
  useEffect(() => { fetchRoster() }, [fetchRoster])

  const set = (i, status) => { setRows((r) => r.map((x, j) => (j === i ? { ...x, status } : x))); setSave({ state: 'idle', msg: '' }) }
  const counts = useMemo(() => Object.fromEntries([...STATES.map(([k]) => [k, rows.filter((r) => r.status === k).length]), ['NONE', rows.filter((r) => !r.status).length]]), [rows])

  const onKey = (e, i) => {
    const hit = STATES.find(([, k]) => k.toLowerCase() === e.key.toLowerCase())
    if (hit) { set(i, hit[0]); e.preventDefault() }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { listRef.current?.querySelector(`[data-row="${i + (e.key === 'ArrowDown' ? 1 : -1)}"]`)?.focus(); e.preventDefault() }
  }

  const doSave = async () => {
    if (counts.NONE) return setSave({ state: 'error', msg: `${counts.NONE} student(s) still have no status.` })
    const payload = { client_txn_id: uuid(), stream: Number(stream), date, subject: subject ? Number(subject) : null, records: rows.map((r) => ({ student: r.student, status: r.status })) }
    setSave({ state: 'saving', msg: '' })
    try {
      if (!online) throw Object.assign(new Error('offline'), {})
      await api.post('/attendance/bulk/', payload)
      cache.put(`sheet:${stream}:${date}:${subject}`, rows)
      setSave({ state: 'saved', msg: 'Saved' })
    } catch (e) {
      if (!e.response) { await enqueue('attendance', '/attendance/bulk/', payload, `Attendance ${date}`); refreshCount(); cache.put(`sheet:${stream}:${date}:${subject}`, rows); setSave({ state: 'queued', msg: 'Saved on this device — will sync automatically' }); sync() }
      else setSave({ state: 'error', msg: errorMessage(e) })
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head"><h2>Take attendance</h2></div>
        <div className="row wrap" style={{ gap: 10 }}>
          <select
            className="input"
            style={{ width: 'auto' }}
            value={selectedClass}
            onChange={(e) => {
              setSelectedClass(e.target.value)
              setStream('')
              setSubject('')
            }}
            aria-label="Select class"
          >
            <option value="">Select class</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{user?.role !== 'ADMIN' && !my.assignedClassIds.has(c.id) ? ' 🔒 (Not assigned)' : ''}
              </option>
            ))}
          </select>
          <select
            className="input"
            style={{ width: 'auto' }}
            value={stream}
            onChange={(e) => { setStream(e.target.value); setSubject('') }}
            aria-label="Stream"
            disabled={!selectedClass || !isClassAssigned}
          >
            <option value="">Stream</option>
            {availableStreams.map((s) => <option key={s.id} value={s.id}>{s.name || s.label}</option>)}
          </select>
          <input
            type="date"
            className="input"
            style={{ width: 'auto' }}
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            aria-label="Date"
            disabled={!stream}
          />
          <select
            className="input"
            style={{ width: 'auto' }}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Subject or session"
            disabled={!stream}
          >
            <option value="">Whole day</option>
            {subjects.map((a) => <option key={a.id} value={a.subject}>{a.subject_name}</option>)}
          </select>
        </div>
      </section>
      {!selectedClass ? (
        <Empty title="Choose a class to begin">Select a class from Senior One through Senior Six to view attendance.</Empty>
      ) : !isClassAssigned ? (
        <Empty title="Class Not Assigned">You are not assigned to this class. Only classes assigned to you by the administrator are accessible for attendance.</Empty>
      ) : !stream ? (
        <Empty title="Choose a stream to begin">Select a stream within this class to load the attendance sheet.</Empty>
      ) : load.loading ? (
        <Skeleton rows={6} />
      ) : load.error ? (
        <ErrorState message={load.error} onRetry={fetchRoster} />
      ) : !rows.length ? (
        <Empty title="No students in this class" />
      ) : (
        <section className="panel" style={{ padding: 0 }}>
          <div className="row spread" style={{ padding: 16, position: 'sticky', top: 60, background: 'var(--surface)', zIndex: 5, borderBottom: '1px solid var(--border)', borderRadius: '16px 16px 0 0' }}>
            <div className="counters">{STATES.map(([k, , l]) => <Badge key={k} value={k}>{l} {counts[k]}</Badge>)}<Badge>Unmarked {counts.NONE}</Badge></div>
            <div className="row"><button className="btn" onClick={() => setRows((r) => r.map((x) => ({ ...x, status: 'PRESENT' })))}>Mark all present</button>
              <button className="btn primary lg" onClick={doSave} disabled={save.state === 'saving'}>{save.state === 'saving' ? 'Saving…' : 'Save'}</button></div>
          </div>
          {fromCache && <div style={{ padding: '8px 16px' }}><Alert kind="warning">Showing the roster stored on this device. Your changes will sync when you are back online.</Alert></div>}
          {save.state !== 'idle' && <div style={{ padding: '8px 16px' }} aria-live="polite"><Alert kind={save.state === 'error' ? 'error' : save.state === 'queued' ? 'info' : 'success'}>{save.msg}</Alert></div>}
          <div ref={listRef}>{rows.map((r, i) => (
            <div key={r.student} className="att-row" tabIndex={0} data-row={i} onKeyDown={(e) => onKey(e, i)} aria-label={`${r.name}: ${r.status || 'not marked'}`}>
              <div><b>{i + 1}. {r.name}</b><div className="muted" style={{ fontSize: 12 }}>{r.index_no}</div></div>
              <div className="seg" role="group" aria-label={`Attendance for ${r.name}`}>{STATES.map(([k, key, label]) => <button key={k} className={`${r.status === k ? 'on ' : ''}${k}`} aria-pressed={r.status === k} onClick={() => set(i, k)} title={`${label} (${key})`}>{key}</button>)}</div>
            </div>))}</div>
          <p className="muted" style={{ padding: 16, margin: 0 }}>Tip: focus a row, then press P, A, L or E. Use ↑ ↓ to move between students.</p>
        </section>)}
    </div>
  )
}

const gradePreview = (totStr) => {
  if (!totStr || totStr === '—') return '—'
  const n = Number(String(totStr).replace('%', ''))
  if (isNaN(n)) return '—'
  if (n >= 80) return 'A'
  if (n >= 70) return 'B'
  if (n >= 60) return 'C'
  if (n >= 50) return 'D'
  return 'E'
}

const remarkPreview = (g) => {
  return { A: 'EXCELLENT', B: 'VERY GOOD', C: 'GOOD', D: 'FAIR', E: 'POOR' }[g] || '—'
}

export function Marks({ only }) {
  const location = useLocation()
  const my = useMyStreams()
  const { user } = useAuth()
  const { terms, active } = useTerms()
  const { online, refreshCount, sync } = useApp()

  const years = useMemo(() => {
    const map = new Map()
    terms.forEach((t) => {
      if (t.year && !map.has(t.year)) {
        map.set(t.year, { id: t.year, name: t.year_name || String(t.year) })
      }
    })
    return [...map.values()]
  }, [terms])

  const [yearId, setYearId] = useState(null)
  const [termId, setTermId] = useState(null)

  useEffect(() => {
    if (active && !termId) {
      setTermId(active.id)
      setYearId(active.year)
    }
  }, [active, termId])

  const availableTerms = useMemo(() => {
    if (!yearId) return terms
    return terms.filter((t) => t.year === yearId)
  }, [terms, yearId])

  const classes = useMemo(() => {
    return [...my.allClasses].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, [my.allClasses])

  const [selectedClass, setSelectedClass] = useState('')
  const [stream, setStream] = useState('')
  const [subject, setSubject] = useState('')
  const [paper, setPaper] = useState('')
  const [examTypeFilter, setExamTypeFilter] = useState(only ? only[0] : '')

  const isClassAssigned = useMemo(() => {
    if (!selectedClass) return false
    if (user?.role === 'ADMIN') return true
    return my.assignedClassIds.has(Number(selectedClass))
  }, [selectedClass, my.assignedClassIds, user?.role])

  const availableStreams = useMemo(() => {
    if (!selectedClass || !isClassAssigned) return []
    return my.streams.filter((s) => String(s.school_class) === String(selectedClass))
  }, [my.streams, selectedClass, isClassAssigned])

  // Pre-fill from navigation state if available
  useEffect(() => {
    if (location.state?.stream) {
      const st = my.streams.find((s) => String(s.id) === String(location.state.stream))
      if (st) {
        setSelectedClass(String(st.school_class))
        setStream(String(st.id))
        if (location.state.subject) setSubject(String(location.state.subject))
        if (location.state.paper) setPaper(String(location.state.paper))
      }
    }
  }, [location.state, my.streams])

  // Auto-select stream if only 1 exists for the selected class
  useEffect(() => {
    if (selectedClass && isClassAssigned && availableStreams.length === 1 && !stream) {
      setStream(String(availableStreams[0].id))
    }
  }, [selectedClass, isClassAssigned, availableStreams, stream])

  const subjects = useMemo(() => {
    if (!isClassAssigned) return []
    const assigned = [...new Map(my.assignments.filter((a) => String(a.stream) === String(stream)).map((a) => [a.subject, a])).values()]
    if (assigned.length || user?.role !== 'ADMIN') return assigned
    return (my.allSubjects || []).map((sub) => ({ id: sub.id, subject: sub.id, subject_name: sub.name, paper_number: 1 }))
  }, [my.assignments, my.allSubjects, stream, isClassAssigned, user?.role])

  const papers = useMemo(() => {
    const assigned = my.assignments.filter((a) => String(a.stream) === String(stream) && String(a.subject) === String(subject))
    if (assigned.length) {
      return [...new Set(assigned.map((a) => a.paper_number))].sort((a, b) => a - b)
    }
    const foundSub = (my.allSubjects || []).find((s) => String(s.id) === String(subject))
    const num = foundSub?.number_of_papers || 1
    return Array.from({ length: num }, (_, i) => i + 1)
  }, [my.assignments, my.allSubjects, stream, subject])

  useEffect(() => {
    if (papers.length && !papers.some((n) => String(n) === paper)) setPaper(String(papers[0]))
    if (!papers.length && paper) setPaper('')
  }, [papers.join(','), stream, subject]) // eslint-disable-line

  const [grid, setGrid] = useState(null)
  const [edits, setEdits] = useState({})
  const [maxes, setMaxes] = useState({})
  const [load, setLoad] = useState({ loading: false, error: '' })
  const [save, setSave] = useState({ state: 'idle', msg: '' })
  const [draftState, setDraftState] = useState('')
  const draftKey = `marks:${stream}:${subject}:${paper}:${termId}`

  const fetchGrid = useCallback(async () => {
    if (!stream || !subject || !paper || !termId) return setGrid(null)
    setLoad({ loading: true, error: '' }); setSave({ state: 'idle', msg: '' })
    let data
    try {
      data = (await api.get('/results/grid/', { params: { stream, subject, paper_number: paper, term: termId } })).data
      dbPut('cache', { key: `grid:${draftKey}`, value: data }).catch(() => {})
    } catch (e) {
      if (!e.response) data = (await dbGet('cache', `grid:${draftKey}`).catch(() => null))?.value
      if (!data) return setLoad({ loading: false, error: errorMessage(e) })
    }
    const m = {}
    data.exam_types.forEach((t) => {
      const withData = data.rows.find((r) => r.cells[t.code])
      let defMax = t.default_max
      if (t.code === 'BOT') defMax = 20
      else if (t.code === 'MID') defMax = 20
      else if (t.code === 'FINAL' || t.code === 'EOT') defMax = 80
      m[t.code] = String(withData ? withData.cells[t.code].max : defMax)
    })
    const draft = (await dbGet('drafts', draftKey).catch(() => null))?.value
    setGrid(data)
    setMaxes({ ...m, ...(draft?.maxes || {}) })
    setEdits(draft?.edits || {})
    if (draft && Object.keys(draft.edits || {}).length) setDraftState('Restored your unsaved entries from this device.')
    setLoad({ loading: false, error: '' })
  }, [stream, subject, paper, termId, draftKey])

  useEffect(() => { fetchGrid() }, [fetchGrid])

  useEffect(() => {
    if (!grid) return undefined
    const t = setTimeout(() => {
      dbPut('drafts', { key: draftKey, value: { edits, maxes } })
        .then(() => setDraftState(Object.keys(edits).length ? 'Draft saved on this device' : ''))
        .catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [edits, maxes, draftKey, grid])

  const allExamTypes = (grid?.exam_types || []).filter((t) => t.code !== 'BOT')
  const types = allExamTypes.filter((t) => {
    if (only && !only.includes(t.code)) return false
    if (examTypeFilter && t.code !== examTypeFilter) return false
    return true
  })

  const cellVal = (r, code) => edits[`${r.student}:${code}`] ?? (r.cells[code] ? String(r.cells[code].score) : '')
  const invalid = (r, code) => {
    const v = cellVal(r, code)
    if (v === '') return ''
    const n = Number(v), mx = Number(maxes[code])
    if (Number.isNaN(n) || n < 0) return 'Enter a number of 0 or more'
    if (n > mx) return `Cannot exceed ${mx}`
    return ''
  }
  const errorCount = grid ? grid.rows.reduce((a, r) => a + types.filter((t) => invalid(r, t.code)).length, 0) : 0
  const maxErr = (code) => !(Number(maxes[code]) > 0)

  const nav = (e, r, c) => {
    const d = { ArrowDown: [1, 0], Enter: [1, 0], ArrowUp: [-1, 0] }[e.key]
    if (!d) return
    e.preventDefault()
    document.querySelector(`[data-cell="${r + d[0]}:${c}"]`)?.focus()
  }

  const doSave = async () => {
    if (errorCount || types.some((t) => maxErr(t.code))) return setSave({ state: 'error', msg: 'Fix the highlighted marks before saving.' })
    const batches = types.map((t) => ({
      t,
      entries: grid.rows
        .filter((r) => edits[`${r.student}:${t.code}`] !== undefined && edits[`${r.student}:${t.code}`] !== '')
        .map((r) => ({ student: r.student, score: edits[`${r.student}:${t.code}`] }))
    })).filter((b) => b.entries.length)
    if (!batches.length) return setSave({ state: 'error', msg: 'Nothing new to save.' })
    setSave({ state: 'saving', msg: '' })
    let queued = false
    try {
      for (const b of batches) {
        const payload = {
          client_txn_id: uuid(),
          stream: Number(stream),
          subject: Number(subject),
          paper_number: Number(paper),
          term: termId,
          exam_type: b.t.id,
          title: '',
          max_score: maxes[b.t.code],
          entries: b.entries
        }
        try {
          if (!online) throw Object.assign(new Error('offline'), {})
          await api.post('/results/assessments/bulk/', payload)
        } catch (e) {
          if (e.response) throw e
          await enqueue('marks', '/results/assessments/bulk/', payload, b.t.name)
          queued = true
        }
      }
      await dbDel('drafts', draftKey).catch(() => {})
      if (queued) {
        refreshCount()
        sync()
        setSave({ state: 'queued', msg: 'Saved on this device — will sync automatically' })
      } else {
        setEdits({})
        setDraftState('')
        await fetchGrid()
        setSave({ state: 'saved', msg: 'Marks saved. Totals and grades are calculated by the server.' })
      }
    } catch (e) {
      const bad = e.response?.data?.errors
      setSave({ state: 'error', msg: bad ? `${Object.keys(bad).length} mark(s) rejected: ${Object.values(bad)[0]}` : errorMessage(e) })
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head"><h2>{only ? 'Assignment marks' : 'Enter marks'}</h2></div>
        <div className="row wrap" style={{ gap: 10 }}>
          {/* Academic Year */}
          <select
            className="input"
            style={{ width: 'auto' }}
            value={yearId || ''}
            onChange={(e) => {
              const yId = Number(e.target.value)
              setYearId(yId)
              const tInYear = terms.filter((t) => t.year === yId)
              if (tInYear.length && !tInYear.some((t) => t.id === termId)) {
                setTermId(tInYear.find((t) => t.is_active)?.id || tInYear[0].id)
              }
            }}
            aria-label="Academic Year"
          >
            <option value="">Academic Year</option>
            {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
          </select>

          {/* Academic & Term */}
          <select
            className="input"
            style={{ width: 'auto' }}
            value={termId || ''}
            onChange={(e) => setTermId(Number(e.target.value))}
            aria-label="Academic & Term"
          >
            <option value="">Term</option>
            {availableTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          {/* Select class */}
          <select
            className="input"
            style={{ width: 'auto' }}
            value={selectedClass}
            onChange={(e) => {
              const cId = e.target.value
              setSelectedClass(cId)
              const streamsInClass = my.streams.filter((s) => String(s.school_class) === String(cId))
              if (streamsInClass.length === 1) {
                setStream(String(streamsInClass[0].id))
              } else {
                setStream('')
              }
              setSubject('')
              setPaper('')
            }}
            aria-label="Select class"
          >
            <option value="">Select class</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{user?.role !== 'ADMIN' && !my.assignedClassIds.has(c.id) ? ' 🔒 (Not assigned)' : ''}
              </option>
            ))}
          </select>

          {/* Stream */}
          <select
            className="input"
            style={{ width: 'auto' }}
            value={stream}
            onChange={(e) => { setStream(e.target.value); setSubject(''); setPaper('') }}
            aria-label="Stream"
            disabled={!selectedClass || !isClassAssigned}
          >
            <option value="">Stream</option>
            {availableStreams.map((s) => <option key={s.id} value={s.id}>{s.name || s.label}</option>)}
          </select>

          {/* Subject */}
          <select
            className="input"
            style={{ width: 'auto' }}
            value={subject}
            onChange={(e) => { setSubject(e.target.value); setPaper('') }}
            aria-label="Subject"
            disabled={!stream || !isClassAssigned}
          >
            <option value="">Subject</option>
            {subjects.map((a) => <option key={a.subject} value={a.subject}>{a.subject_name}</option>)}
          </select>

          {/* Papers */}
          <select
            className="input"
            style={{ width: 'auto' }}
            value={paper}
            onChange={(e) => setPaper(e.target.value)}
            aria-label="Papers"
            disabled={!subject || !isClassAssigned}
          >
            <option value="">Paper</option>
            {papers.map((n) => <option key={n} value={n}>Paper {n}</option>)}
          </select>

          {/* Assignment / Examination type */}
          <select
            className="input"
            style={{ width: 'auto' }}
            value={examTypeFilter}
            onChange={(e) => setExamTypeFilter(e.target.value)}
            aria-label="Assignment / Examination type"
            disabled={Boolean(only)}
          >
            <option value="">All Examination Types</option>
            {allExamTypes.map((t) => <option key={t.code} value={t.code}>{t.name} ({t.code})</option>)}
          </select>
        </div>
      </section>

      {!selectedClass ? (
        <Empty title="Choose a class to begin">
          Select a class from Senior One through Senior Six to enter marks.
        </Empty>
      ) : !isClassAssigned ? (
        <Empty title="Class Not Assigned">
          You are not assigned to this class. Only classes assigned to you by the administrator are accessible for entering marks and assessments.
        </Empty>
      ) : !stream || !subject || !paper ? (
        <Empty title="Choose stream, subject and paper to view students" />
      ) : load.loading ? (
        <Skeleton rows={6} />
      ) : load.error ? (
        <ErrorState message={load.error} onRetry={fetchGrid} />
      ) : !grid?.rows.length ? (
        <Empty title="No registered students in this class" />
      ) : (
        <section className="panel sheet">
          <div className="row spread" style={{ marginBottom: 12 }}>
            <span className="muted" aria-live="polite">
              {draftState}{errorCount > 0 && ` · ${errorCount} invalid`}
            </span>
            <button className="btn primary lg" onClick={doSave} disabled={save.state === 'saving'}>
              {save.state === 'saving' ? 'Saving…' : 'Save marks'}
            </button>
          </div>
          {save.state !== 'idle' && <Alert kind={save.state === 'error' ? 'error' : save.state === 'queued' ? 'info' : 'success'}>{save.msg}</Alert>}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ minWidth: 160 }}>Student</th>
                  {types.map((t) => {
                    const isMid = t.code === 'MID'
                    const isFinal = t.code === 'FINAL' || t.code === 'EOT'
                    const defaultOut = isMid ? 20 : isFinal ? 80 : (t.default_max || 100)
                    return (
                      <Fragment key={t.code}>
                        <th>
                          {t.name}
                          <br />
                          <small className="muted">
                            out of{' '}
                            <input
                              className={`input cell${maxErr(t.code) ? ' invalid' : ''}`}
                              style={{ width: 56, minHeight: 26, padding: '2px 4px', textAlign: 'center' }}
                              inputMode="decimal"
                              value={maxes[t.code] ?? defaultOut}
                              onChange={(e) => setMaxes({ ...maxes, [t.code]: e.target.value })}
                              aria-label={`${t.name} maximum mark`}
                            />
                          </small>
                        </th>
                        {isMid && (
                          <>
                            <th style={{ minWidth: 65, textAlign: 'center' }}>
                              C1
                              <br />
                              <small className="muted">(out of 3.0)</small>
                            </th>
                            <th style={{ minWidth: 60, textAlign: 'center' }}>AVG</th>
                            <th style={{ minWidth: 60, textAlign: 'center' }}>IDENT</th>
                            <th style={{ minWidth: 90, textAlign: 'center' }}>DESCRIPTOR</th>
                          </>
                        )}
                      </Fragment>
                    )
                  })}
                  <th>Total %</th>
                  <th>Grade</th>
                  <th>Remark</th>
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((r, ri) => {
                  const midVal = cellVal(r, 'MID')
                  const finalVal = cellVal(r, 'FINAL') || cellVal(r, 'EOT')
                  const midMax = Number(maxes['MID']) || 20

                  // C1 dynamically calculated as ((marks obtained / 20) * 3) from Mid-Term
                  const c1Display = midVal !== '' && !isNaN(Number(midVal))
                    ? ((Number(midVal) / midMax) * 3).toFixed(1)
                    : (r.c1 != null ? Number(r.c1).toFixed(1) : '—')

                  const avgDisplay = c1Display
                  const idInfo = getIdentifierInfo(c1Display !== '—' ? Number(c1Display) : null)

                  // Total: Mid-Term (out of 20) + End of Term (out of 80) = Final score out of 100
                  // BOT is completely excluded
                  let displayTotal = r.total != null ? `${r.total}%` : '—'
                  if (midVal !== '' && finalVal !== '' && !isNaN(Number(midVal)) && !isNaN(Number(finalVal))) {
                    displayTotal = `${(Number(midVal) + Number(finalVal)).toFixed(1)}%`
                  } else if (midVal !== '' && !isNaN(Number(midVal)) && finalVal === '') {
                    displayTotal = `${Number(midVal).toFixed(1)}%`
                  } else if (finalVal !== '' && !isNaN(Number(finalVal)) && midVal === '') {
                    displayTotal = `${Number(finalVal).toFixed(1)}%`
                  }

                  const gPreview = gradePreview(displayTotal)
                  const remPreview = remarkPreview(gPreview)

                  return (
                    <tr key={r.student}>
                      <td>
                        <b>{r.name}</b>
                        <br />
                        <small className="muted">{r.index_no}</small>
                      </td>
                      {types.map((t, ci) => {
                        const err = invalid(r, t.code)
                        const isMid = t.code === 'MID'
                        return (
                          <Fragment key={t.code}>
                            <td>
                              <input
                                data-cell={`${ri}:${ci}`}
                                className={`input cell${err ? ' invalid' : ''}`}
                                inputMode="decimal"
                                value={cellVal(r, t.code)}
                                title={err}
                                aria-invalid={!!err}
                                aria-label={`${r.name} ${t.name}`}
                                onChange={(e) => setEdits({ ...edits, [`${r.student}:${t.code}`]: e.target.value })}
                                onKeyDown={(e) => nav(e, ri, ci)}
                              />
                            </td>
                            {isMid && (
                              <>
                                <td className="ro" style={{ textAlign: 'center', fontWeight: 600, color: 'var(--primary)' }}>
                                  {c1Display}
                                </td>
                                <td className="ro" style={{ textAlign: 'center', fontWeight: 600 }}>
                                  {avgDisplay}
                                </td>
                                <td className="ro" style={{ textAlign: 'center', fontWeight: 700 }}>
                                  {idInfo.ident}
                                </td>
                                <td className="ro" style={{ textAlign: 'center', fontSize: 11, fontWeight: 600 }}>
                                  {idInfo.desc}
                                </td>
                              </>
                            )}
                          </Fragment>
                        )
                      })}
                      <td className="ro"><b>{displayTotal}</b></td>
                      <td className="ro"><b>{gPreview}</b></td>
                      <td className="ro">{remPreview}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted">
            Enter or ↓ moves down a column. Entries are kept on this device while you type. BOT is entered out of 20 and converted to C1. Mid-Term is entered out of 20 and converted to C2 (not added to final term results). End of Term is entered out of 80. BOT + End of Term gives final mark out of 100.
          </p>
        </section>
      )}
    </div>
  )
}
