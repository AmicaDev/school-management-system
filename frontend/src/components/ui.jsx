import { useEffect } from 'react'

export const Spinner = () => <span className="spinner" role="status" aria-label="Loading" />

export function Skeleton({ rows = 4 }) {
  return <div className="stack" aria-busy="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: 18, width: `${90 - i * 8}%` }} />)}</div>
}

export const Empty = ({ title = 'Nothing here yet', children }) => <div className="state"><h3>{title}</h3>{children && <p>{children}</p>}</div>

export function ErrorState({ message, onRetry }) {
  return <div className="state"><h3>Could not load this data</h3><p>{message}</p>{onRetry && <button className="btn" onClick={onRetry}>Try again</button>}</div>
}

export const Alert = ({ kind = 'error', children }) => (children ? <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div> : null)
export const Badge = ({ value, children }) => <span className={`badge ${value || ''}`}>{children ?? value}</span>

export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="panel-head"><h2>{title}</h2><button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </>
  )
}

export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs" role="tablist">{tabs.map((t) => <button key={t} role="tab" className="tab" aria-selected={value === t} onClick={() => onChange(t)}>{t}</button>)}</div>
}

export function Table({ columns, rows, rowKey = 'id' }) {
  return (
    <div className="table-wrap"><table className="table">
      <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r[rowKey] ?? i}>{columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : (r[c.key] ?? '—')}</td>)}</tr>)}</tbody>
    </table></div>
  )
}

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
