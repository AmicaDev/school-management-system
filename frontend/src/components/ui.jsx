import { useEffect, useState } from 'react'

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

export function TeacherCodeCell({ code }) {
  const [show, setShow] = useState(false)
  if (!code) return <span style={{ color: 'var(--muted, #888)' }}>—</span>

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <code
        style={{
          fontFamily: 'monospace',
          fontSize: '0.85rem',
          letterSpacing: show ? '0.05em' : '0.15em',
          background: 'var(--bg-muted, #f1f3f5)',
          padding: '2px 6px',
          borderRadius: '4px',
          userSelect: show ? 'all' : 'none',
        }}
      >
        {show ? code : '••••••••'}
      </code>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setShow((s) => !s)
        }}
        title={show ? 'Hide sign-in code' : 'Show sign-in code'}
        aria-label={show ? 'Hide sign-in code' : 'Show sign-in code'}
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          padding: '2px 4px',
          display: 'inline-flex',
          alignItems: 'center',
          color: 'var(--muted, #666)',
        }}
      >
        {show ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  )
}

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
