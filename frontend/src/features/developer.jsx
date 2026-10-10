import { useCallback, useEffect, useState } from 'react'
import { api, errorMessage, items } from '../services/api'
import { useFetch } from '../hooks/useFetch'
import { useAuth } from '../contexts/AuthContext'
import { dbAll, idbAvailable } from '../offline/db'
import { discard, queued, retryFailed } from '../offline/queue'
import { Alert, Badge, Empty, ErrorState, Modal, Skeleton, Table, fmtDateTime } from '../components/ui'
import ResourcePage from './ResourcePage'
import { R } from './resources'

const secs = (s) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
const KV = ({ rows }) => <dl className="grid cols-3">{rows.map(([k, v]) => <div className="stat" key={k}><div className="l">{k}</div><div className="n" style={{ fontSize: 18 }}>{v}</div></div>)}</dl>
const ok = (b) => <Badge value={b ? 'PASS' : 'FAIL'} />

export function DevDashboard() {
  const { data: h, loading, error, reload } = useFetch('/developer/health/')
  const q = useFetch('/developer/sync/')
  if (loading) return <Skeleton rows={8} />
  if (error) return <ErrorState message={error} onRetry={reload} />
  const sw = 'serviceWorker' in navigator
  return (
    <div className="stack">
      {h.maintenance_mode && <Alert kind="warning">Maintenance mode is ON — school users cannot use the system.</Alert>}
      <section className="panel"><div className="panel-head"><h2>Application</h2><button className="btn sm" onClick={reload}>Refresh</button></div><KV rows={[['Version', h.application.version], ['Environment', h.application.environment], ['Uptime', secs(h.application.uptime_seconds)], ['Build', h.application.build]]} /></section>
      <div className="grid cols-2">
        <section className="panel"><h2>Backend</h2><KV rows={[['API', ok(h.backend.api === 'ok')], ['Response time', `${h.response_ms} ms`], ['Django', h.backend.django], ['DRF', h.backend.drf]]} /></section>
        <section className="panel"><h2>Database</h2><KV rows={[['Connection', ok(h.database.ok)], ['Engine', h.database.vendor], ['Latency', `${h.database.latency_ms} ms`], ['Pending migrations', h.database.migrations_pending]]} /></section>
        <section className="panel"><h2>Background jobs</h2><KV rows={[['Celery', <Badge value={h.celery.ok ? 'PASS' : 'WARNING'} key="c">{h.celery.ok ? 'Running' : 'No worker'}</Badge>], ['Cache / Redis', ok(h.cache.ok)], ['Unresolved errors', h.errors.unresolved], ['Critical', h.errors.critical]]} /></section>
        <section className="panel"><h2>Frontend & PWA</h2><KV rows={[['Frontend version', __APP_VERSION__], ['Built', fmtDateTime(__BUILD_TIME__)], ['Service worker', ok(sw && !!navigator.serviceWorker.controller)], ['Online', ok(navigator.onLine)]]} /></section>
        <section className="panel"><h2>Synchronization</h2><KV rows={[['Processed (server)', h.sync.processed], ['Sync error reports', h.sync.failed], ['Kinds', (q.data?.by_kind || []).map((k) => `${k.kind}:${k.n}`).join(' ') || '—']]} /></section>
      </div>
    </div>
  )
}

function ErrorDetail({ id, onClose, onChanged }) {
  const e = useFetch(`/developer/errors/${id}/`)
  const rel = useFetch(`/developer/errors/${id}/related/`)
  const toggle = async () => { await api.post(`/developer/errors/${id}/resolve/`, { resolved: !e.data.resolved }); e.reload(); onChanged() }
  return (
    <Modal title={`Error #${id}`} onClose={onClose} wide>
      {e.loading ? <Skeleton /> : e.error ? <ErrorState message={e.error} onRetry={e.reload} /> : (
        <div className="stack">
          <div className="row"><Badge value={e.data.level} /><Badge>{e.data.source}</Badge><Badge value={e.data.resolved ? 'PASS' : 'OPEN'}>{e.data.resolved ? 'Resolved' : 'Unresolved'}</Badge></div>
          <p><b>{e.data.message}</b></p>
          <KV rows={[['Endpoint', e.data.endpoint || '—'], ['Method', e.data.method || '—'], ['Status', e.data.status_code ?? '—'], ['Module', e.data.module || '—'], ['User role', e.data.user_role || '—'], ['Occurrences', e.data.count], ['First seen', fmtDateTime(e.data.first_seen)], ['Last seen', fmtDateTime(e.data.last_seen)]]} />
          <div><b>Device / browser</b><div className="muted">{e.data.user_agent || '—'}</div></div>
          <div><b>Stack trace</b><pre className="pre">{e.data.stack_trace || 'No stack trace captured.'}</pre></div>
          <div><b>Related activity since first seen</b>{rel.loading ? <Skeleton rows={2} /> : <Table columns={[{ key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at) }, { key: 'action', label: 'Action' }, { key: 'module', label: 'Module' }, { key: 'result', label: 'Result' }]} rows={(rel.data || []).map((r, i) => ({ ...r, id: i }))} />}</div>
          <button className="btn primary" onClick={toggle}>{e.data.resolved ? 'Reopen' : 'Mark resolved'}</button>
        </div>)}
    </Modal>
  )
}

export function DevErrors() {
  const [open, setOpen] = useState(null)
  const [tick, setTick] = useState(0)
  const cfg = {
    title: 'Application errors', endpoint: '/developer/errors/', readOnly: true, ordering: '-last_seen', params: { _: tick },
    filters: [{ name: 'level', label: 'All levels', options: ['INFO', 'WARNING', 'ERROR', 'CRITICAL'].map((x) => [x, x]) }, { name: 'source', label: 'All sources', options: [['django', 'Django'], ['drf', 'DRF'], ['database', 'Database'], ['auth', 'Authentication'], ['celery', 'Background jobs'], ['react', 'React'], ['sync', 'Offline sync']] }, { name: 'resolved', label: 'Any status', options: [['false', 'Unresolved'], ['true', 'Resolved']] }],
    columns: [{ key: 'id', label: 'ID' }, { key: 'level', label: 'Level', render: (r) => <Badge value={r.level} /> }, { key: 'last_seen', label: 'Last seen', render: (r) => fmtDateTime(r.last_seen) }, { key: 'message', label: 'Message', render: (r) => <span title={r.message}>{r.message.slice(0, 70)}</span> },
      { key: 'module', label: 'Module' }, { key: 'endpoint', label: 'Endpoint' }, { key: 'status_code', label: 'HTTP' }, { key: 'user_role', label: 'Role' }, { key: 'count', label: '×' }, { key: 'resolved', label: 'Resolved', render: (r) => (r.resolved ? 'Yes' : 'No') }],
    rowActions: (r) => <button className="btn sm" onClick={() => setOpen(r.id)}>Details</button>,
  }
  return <><ResourcePage cfg={cfg} key={tick} />{open && <ErrorDetail id={open} onClose={() => setOpen(null)} onChanged={() => setTick((t) => t + 1)} />}</>
}

export const DevLogs = () => <ResourcePage cfg={{ ...R.audit, title: 'System logs (all activity)' }} />
export const DevAudit = () => <ResourcePage cfg={{ ...R.audit, title: 'Developer audit trail', params: { module: 'developer' } }} />

async function clientChecks() {
  const out = []
  const add = (group, name, status, detail = '') => out.push({ group, name, status, detail })
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null
  add('PWA', 'Service worker registered', reg ? 'PASS' : 'FAIL', reg?.scope || (import.meta.env.DEV ? 'Registered only in production builds' : ''))
  add('PWA', 'Service worker controlling page', navigator.serviceWorker?.controller ? 'PASS' : 'WARNING', 'Reload once after first install')
  try { const m = await (await fetch('/manifest.webmanifest')).json(); add('PWA', 'Manifest', m.icons?.length >= 2 && m.start_url ? 'PASS' : 'FAIL', `${m.name}`) } catch { add('PWA', 'Manifest', 'FAIL', 'Could not load manifest') }
  const keys = window.caches ? await caches.keys() : []
  add('PWA', 'Cache storage', keys.length ? 'PASS' : 'WARNING', keys.join(', ') || 'No caches yet')
  add('Frontend', 'Build', 'PASS', `v${__APP_VERSION__} built ${__BUILD_TIME__}`)
  try { const t = performance.now(); await api.get('/developer/status/'); add('Frontend', 'API connectivity', 'PASS', `${Math.round(performance.now() - t)} ms`) } catch (e) { add('Frontend', 'API connectivity', 'FAIL', errorMessage(e)) }
  for (const p of ['/', '/login', '/developer']) { try { const r = await fetch(p, { method: 'HEAD' }); add('Frontend', `Route ${p}`, r.ok ? 'PASS' : 'FAIL', String(r.status)) } catch { add('Frontend', `Route ${p}`, 'FAIL') } }
  if (idbAvailable()) { try { await dbAll('queue'); add('Offline', 'IndexedDB', 'PASS') } catch (e) { add('Offline', 'IndexedDB', 'FAIL', e.message) } } else add('Offline', 'IndexedDB', 'FAIL', 'Unavailable')
  const q = await queued().catch(() => [])
  add('Offline', 'Queue', q.some((x) => x.state === 'failed') ? 'WARNING' : 'PASS', `${q.filter((x) => x.state === 'pending').length} pending, ${q.filter((x) => x.state === 'failed').length} failed`)
  return out
}

export function DevTests() {
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async () => {
    setBusy(true); setErr('')
    try { const server = (await api.post('/developer/tests/')).data; setRes([...server, ...(await clientChecks())]) } catch (e) { setErr(errorMessage(e)) }
    setBusy(false)
  }
  const groups = res ? [...new Set(res.map((r) => r.group))] : []
  return (
    <section className="panel"><div className="panel-head"><h2>System health checks</h2><button className="btn primary" onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run all checks'}</button></div>
      <Alert>{err}</Alert>
      {!res ? <Empty title="No checks run yet">Backend and database checks run on the server; PWA, frontend and offline checks run in this browser.</Empty> : (
        <div className="stack"><div className="row">{['PASS', 'WARNING', 'FAIL'].map((s) => <Badge key={s} value={s}>{s} {res.filter((r) => r.status === s).length}</Badge>)}</div>
          {groups.map((g) => <div key={g}><h3>{g}</h3><Table columns={[{ key: 'name', label: 'Check' }, { key: 'status', label: 'Result', render: (r) => <Badge value={r.status} /> }, { key: 'detail', label: 'Detail' }]} rows={res.filter((r) => r.group === g).map((r, i) => ({ ...r, id: i }))} /></div>)}</div>)}
    </section>
  )
}

export function DevDatabase() {
  const h = useFetch('/developer/health/'); const u = useFetch('/developer/updates/')
  if (h.loading || u.loading) return <Skeleton rows={5} />
  if (h.error) return <ErrorState message={h.error} onRetry={h.reload} />
  const m = u.data?.migrations
  return <div className="stack"><section className="panel"><h2>PostgreSQL</h2><KV rows={[['Connection', ok(h.data.database.ok)], ['Engine', h.data.database.vendor], ['Latency', `${h.data.database.latency_ms} ms`], ['Pending migrations', h.data.database.migrations_pending]]} /></section>
    <section className="panel"><h2>Latest applied migration per app</h2><Table columns={[{ key: 'app', label: 'App' }, { key: 'name', label: 'Migration' }]} rows={Object.entries(m?.latest_applied || {}).map(([app, name]) => ({ id: app, app, name }))} />{!!m?.pending.length && <Alert kind="warning">Pending: {m.pending.join(', ')}</Alert>}</section></div>
}

export function DevApi() {
  const [pings, setPings] = useState([])
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true); const out = []
    for (let i = 0; i < 5; i++) { const t = performance.now(); try { await api.get('/developer/status/'); out.push(Math.round(performance.now() - t)) } catch { out.push(null) } }
    setPings(out); setBusy(false)
  }
  useEffect(() => { run() }, [])
  const good = pings.filter((x) => x != null)
  const errs = useFetch('/developer/errors/', { source: 'drf', resolved: false, page_size: 10 })
  return <div className="stack"><section className="panel"><div className="panel-head"><h2>API response time</h2><button className="btn" onClick={run} disabled={busy}>Measure again</button></div>
    <KV rows={[['Samples', `${good.length}/${pings.length}`], ['Average', good.length ? `${Math.round(good.reduce((a, b) => a + b, 0) / good.length)} ms` : '—'], ['Slowest', good.length ? `${Math.max(...good)} ms` : '—'], ['Base URL', api.defaults.baseURL]]} /></section>
    <section className="panel"><h2>Unresolved API errors</h2>{!items(errs.data).length ? <Empty title="No unresolved API errors" /> : <Table columns={[{ key: 'endpoint', label: 'Endpoint' }, { key: 'status_code', label: 'HTTP' }, { key: 'count', label: 'Count' }, { key: 'last_seen', label: 'Last seen', render: (r) => fmtDateTime(r.last_seen) }]} rows={items(errs.data)} />}</section></div>
}

export function DevPwa() {
  const [info, setInfo] = useState(null)
  const refresh = useCallback(async () => {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null
    const keys = window.caches ? await caches.keys() : []
    const sizes = {}
    for (const k of keys) sizes[k] = (await (await caches.open(k)).keys()).length
    let manifest = null; try { manifest = await (await fetch('/manifest.webmanifest')).json() } catch { /* shown below */ }
    setInfo({ reg, sizes, manifest, standalone: matchMedia('(display-mode: standalone)').matches })
  }, [])
  useEffect(() => { refresh() }, [refresh])
  if (!info) return <Skeleton />
  return <div className="stack"><section className="panel"><h2>Service worker</h2><KV rows={[['Registered', ok(!!info.reg)], ['Scope', info.reg?.scope || '—'], ['State', info.reg?.active?.state || '—'], ['Update waiting', info.reg?.waiting ? 'Yes' : 'No'], ['Installed (standalone)', info.standalone ? 'Yes' : 'No']]} />
    <button className="btn" style={{ marginTop: 12 }} onClick={async () => { await info.reg?.update(); refresh() }}>Check for update</button></section>
    <section className="panel"><h2>Cache</h2>{Object.keys(info.sizes).length ? <Table columns={[{ key: 'k', label: 'Cache' }, { key: 'n', label: 'Entries' }]} rows={Object.entries(info.sizes).map(([k, n]) => ({ id: k, k, n }))} /> : <Empty title="No caches yet" />}
      <button className="btn danger" style={{ marginTop: 12 }} onClick={async () => { if (confirm('Clear all caches on this device?')) { for (const k of await caches.keys()) await caches.delete(k); refresh() } }}>Clear caches on this device</button></section>
    <section className="panel"><h2>Manifest</h2>{info.manifest ? <KV rows={[['Name', info.manifest.name], ['Display', info.manifest.display], ['Icons', info.manifest.icons?.length], ['Start URL', info.manifest.start_url]]} /> : <Alert>Manifest could not be loaded.</Alert>}</section></div>
}

export function DevSync() {
  const srv = useFetch('/developer/sync/')
  const [local, setLocal] = useState([])
  const load = useCallback(() => queued().then(setLocal), [])
  useEffect(() => { load() }, [load])
  return <div className="stack">
    <section className="panel"><div className="panel-head"><h2>Server ledger</h2><button className="btn sm" onClick={srv.reload}>Refresh</button></div>{srv.loading ? <Skeleton /> : srv.error ? <ErrorState message={srv.error} onRetry={srv.reload} /> : <><KV rows={[...srv.data.by_kind.map((k) => [`Processed: ${k.kind}`, k.n]), ['Failure reports', srv.data.failed_reports]]} />
      <h3 style={{ marginTop: 16 }}>Recent transactions</h3><Table columns={[{ key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at) }, { key: 'kind', label: 'Kind' }, { key: 'status', label: 'Status' }, { key: 'client_txn_id', label: 'Transaction ID' }]} rows={srv.data.recent.map((r) => ({ ...r, id: r.client_txn_id }))} /></>}</section>
    <section className="panel"><div className="panel-head"><h2>This device's queue</h2><button className="btn" onClick={async () => { await retryFailed(); load() }}>Retry failed</button></div>
      {!local.length ? <Empty title="Queue is empty" /> : <Table columns={[{ key: 'kind', label: 'Kind' }, { key: 'label', label: 'Label' }, { key: 'state', label: 'State', render: (r) => <Badge value={r.state === 'failed' ? 'FAIL' : 'WARNING'}>{r.state}</Badge> }, { key: 'error', label: 'Error' }, { key: 'id', label: 'Transaction ID' },
        { key: 'x', label: '', render: (r) => <button className="btn sm danger" onClick={async () => { if (confirm('Discard this unsent operation? The data will be lost.')) { await discard(r.id); load() } }}>Discard</button> }]} rows={local} />}</section></div>
}

export function DevMaintenance() {
  const { user } = useAuth()
  const st = useFetch('/developer/maintenance/')
  const [msg, setMsg] = useState({ kind: 'info', text: '' })
  const [danger, setDanger] = useState(null)
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState(false)
  const run = async (action, extra = {}) => {
    try { const { data } = await api.post('/developer/maintenance/', { action, ...extra }); setMsg({ kind: 'success', text: data.detail }); setDanger(null); setPw(''); setConfirm(false); st.reload() } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }) }
  }
  const SAFE = [['clear_cache', 'Clear cache', 'Empties the server cache (dashboards rebuild on next request).'], ['refresh_cache', 'Refresh cache', 'Clears cached configuration so it is reloaded.'], ['retry_failed_jobs', 'Retry failed background jobs', 'Re-runs report-card batches that failed.'], ['check_integrity', 'Check database integrity', 'Runs Django system checks and data consistency checks.']]
  return (
    <div className="stack"><Alert kind={msg.kind}>{msg.text}</Alert>
      <section className="panel"><h2>Safe actions</h2><div className="grid cols-3">{SAFE.map(([a, l, d]) => <div className="feat" key={a}><b>{l}</b><p className="muted">{d}</p><button className="btn" onClick={() => run(a)}>Run</button></div>)}</div>
        <p className="muted" style={{ marginTop: 12 }}>Failed offline synchronization is retried from each user's device (see Sync → Retry failed). There is no browser button that deletes data.</p></section>
      <section className="panel"><h2>Protected actions</h2><p className="muted">These require confirmation and your password, and are written to the audit log.</p>
        <div className="row"><button className="btn danger" onClick={() => setDanger('toggle_maintenance')}>{st.data?.maintenance_mode ? 'Disable' : 'Enable'} maintenance mode</button>
          <button className="btn danger" disabled={!st.data?.migrations_allowed} title={st.data?.migrations_allowed ? '' : 'Disabled: set ALLOW_WEB_MIGRATIONS=True or migrate from your deployment pipeline'} onClick={() => setDanger('run_migrations')}>Run migrations</button></div></section>
      {danger && <Modal title="Confirm protected action" onClose={() => setDanger(null)}>
        <Alert kind="warning">{danger === 'toggle_maintenance' ? 'Maintenance mode blocks every school user until it is disabled.' : 'Migrations change the database structure. Take a backup first.'}</Alert>
        <div className="field"><label htmlFor="rp">Re-enter your password ({user.username})</label><input id="rp" type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></div>
        <label className="row"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} style={{ width: 20, height: 20 }} /> I understand and want to continue</label>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="btn" onClick={() => setDanger(null)}>Cancel</button><button className="btn danger" disabled={!pw || !confirm} onClick={() => run(danger, { password: pw, confirm: true })}>Proceed</button></div></Modal>}
    </div>
  )
}

export function DevUpdates() {
  const { data, loading, error, reload } = useFetch('/developer/updates/')
  const [pwa, setPwa] = useState('—')
  useEffect(() => { window.caches?.keys().then((k) => setPwa(k.find((x) => x.includes('-shell'))?.replace('-shell', '') || '—')) }, [])
  if (loading) return <Skeleton />
  if (error) return <ErrorState message={error} onRetry={reload} />
  const latest = Object.entries(data.migrations.latest_applied).sort().map(([a, n]) => `${a}: ${n}`)
  return <div className="stack"><section className="panel"><h2>Versions</h2><KV rows={[['Application', data.application], ['Backend (Django / DRF)', `${data.backend.django} / ${data.backend.drf}`], ['Frontend', __APP_VERSION__], ['PWA cache', pwa], ['Build', data.build], ['Environment', data.environment]]} /></section>
    <section className="panel"><h2>Database migration state</h2><div className="pre">{latest.join('\n') || '—'}</div>{data.migrations.pending.length ? <Alert kind="warning">Pending migrations: {data.migrations.pending.join(', ')}</Alert> : <Alert kind="success">All migrations applied.</Alert>}</section>
    <Alert kind="info">{data.note}</Alert></div>
}
