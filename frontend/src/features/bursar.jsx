import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, errorMessage, items } from '../services/api'
import { useFetch } from '../hooks/useFetch'
import { useAuth } from '../contexts/AuthContext'
import { Alert, Badge, Empty, ErrorState, Modal, Skeleton, Table, fmtDate, fmtDateTime } from '../components/ui'
import { useTerms } from './Shared'
import { fmtUGX, ReceiptModal } from './finance'

export function BursarDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { terms, active } = useTerms()
  const [termId, setTermId] = useState(active?.id || null)
  const [studentSearch, setStudentSearch] = useState('')
  const [selectedReceiptId, setSelectedReceiptId] = useState(null)

  useEffect(() => {
    if (active && !termId) setTermId(active.id)
  }, [active, termId])

  // Overview report
  const reportFetch = useFetch(termId ? `/finance/reports/?term=${termId}` : '/finance/reports/')
  const report = reportFetch.data

  // Search students
  const searchFetch = useFetch(studentSearch ? '/students/' : null, { search: studentSearch, page_size: 8 })
  const searchResults = items(searchFetch.data)

  // Recent receipts issued by this bursar
  const recentFetch = useFetch('/finance/payments/', {
    received_by: user.id,
    page_size: 10,
    ordering: '-created_at'
  })
  const recentReceipts = items(recentFetch.data)

  return (
    <div className="stack" style={{ gap: 20 }}>
      {/* Welcome banner & quick search */}
      <div className="panel" style={{ background: 'linear-gradient(135deg, #0e3a24 0%, #1b633d 100%)', color: '#fff' }}>
        <div className="row spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ color: '#fff', margin: 0 }}>Welcome, {user.first_name || user.username}!</h2>
            <p style={{ color: '#c3e6cb', margin: '4px 0 16px 0', fontSize: 14 }}>
              Bursar & Cashier Desk · {active ? `${active.name} (${active.year_name || active.year})` : 'Active Term'}
            </p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn lg primary" style={{ background: '#fff', color: '#0e3a24', fontWeight: 'bold' }} to="/bursar/payments/new">
              💳 Record Cash / Bank Payment
            </Link>
            <Link className="btn lg" style={{ background: 'rgba(255,255,255,0.2)', color: '#fff' }} to="/bursar/my-collections">
              💵 My Collections
            </Link>
          </div>
        </div>

        {/* Quick Student Lookup */}
        <div style={{ marginTop: 12, maxWidth: 600 }}>
          <label style={{ fontSize: 13, color: '#e8f5e9', display: 'block', marginBottom: 4 }}>
            Quick Find Student Fee Account:
          </label>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              style={{ background: '#fff', color: '#111', fontSize: 15 }}
              placeholder="Type student name or index number…"
              value={studentSearch}
              onChange={(e) => setStudentSearch(e.target.value)}
            />
            {studentSearch && searchResults.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: '#fff',
                  color: '#222',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                  borderRadius: 8,
                  zIndex: 100,
                  maxHeight: 220,
                  overflowY: 'auto',
                  marginTop: 4
                }}
              >
                {searchResults.map((s) => (
                  <div
                    key={s.id}
                    style={{
                      padding: '10px 14px',
                      borderBottom: '1px solid #eee',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                    onClick={() => navigate(`/bursar/payments/new?student=${s.id}`)}
                  >
                    <div>
                      <b>{s.full_name}</b> <span className="muted">· {s.index_no} ({s.stream_label || ''})</span>
                    </div>
                    <span className="btn sm primary">Pay Fees →</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid cols-4" style={{ gap: 14 }}>
        <div className="panel" style={{ borderLeft: '4px solid #198754' }}>
          <small className="muted">Today's School Collections</small>
          <h2 style={{ margin: '6px 0', color: '#198754' }}>
            {report ? fmtUGX(report.today_collected) : '…'}
          </h2>
          <small className="muted">Across all cashiers today</small>
        </div>

        <div className="panel" style={{ borderLeft: '4px solid var(--primary)' }}>
          <small className="muted">Term Total Collections</small>
          <h2 style={{ margin: '6px 0', color: 'var(--primary)' }}>
            {report ? fmtUGX(report.total_collected) : '…'}
          </h2>
          <small className="muted">Current term total</small>
        </div>

        <div className="panel" style={{ borderLeft: '4px solid #0dcaf0' }}>
          <small className="muted">Physical Cash in Hand</small>
          <h2 style={{ margin: '6px 0', color: '#0dcaf0' }}>
            {report ? fmtUGX(report.cash_in_hand) : '…'}
          </h2>
          <small className="muted">Cash collections less cash expenses</small>
        </div>

        <div className="panel" style={{ borderLeft: '4px solid #dc3545' }}>
          <small className="muted">Term Expenses</small>
          <h2 style={{ margin: '6px 0', color: '#dc3545' }}>
            {report ? fmtUGX(report.total_expenses) : '…'}
          </h2>
          <small className="muted">Operational expenditures</small>
        </div>
      </div>

      {/* Quick Action Navigation Grid */}
      <div className="grid cols-3" style={{ gap: 14 }}>
        <div className="panel stack" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3>👥 Student Accounts</h3>
            <p className="muted" style={{ fontSize: 13 }}>
              View class-by-class balances, print individual student fee statements, or send payment reminders to parents.
            </p>
          </div>
          <Link className="btn primary" to="/bursar/accounts">Open Student Accounts →</Link>
        </div>

        <div className="panel stack" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3>🧾 Issued Receipts</h3>
            <p className="muted" style={{ fontSize: 13 }}>
              Browse official receipts issued to students, reprint receipt copies, or review reversal audit logs.
            </p>
          </div>
          <Link className="btn" to="/bursar/receipts">View Receipts Log →</Link>
        </div>

        <div className="panel stack" style={{ justifyContent: 'space-between' }}>
          <div>
            <h3>📉 Log Expense</h3>
            <p className="muted" style={{ fontSize: 13 }}>
              Record approved utility, maintenance, kitchen, or administrative expenses paid out of the cash office.
            </p>
          </div>
          <Link className="btn" to="/bursar/expenses">Manage Expenses →</Link>
        </div>
      </div>

      {/* Recent Receipts by This Bursar */}
      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Recent Receipts Issued by You</h3>
            <p className="muted">Your most recent payment collections.</p>
          </div>
          <Link className="btn sm" to="/bursar/my-collections">View Full Handover Log</Link>
        </div>

        {recentFetch.loading ? (
          <Skeleton rows={5} />
        ) : recentFetch.error ? (
          <ErrorState message={recentFetch.error} onRetry={recentFetch.reload} />
        ) : !recentReceipts.length ? (
          <Empty title="No receipts issued yet today">
            <Link className="btn primary" to="/bursar/payments/new">Record your first payment</Link>
          </Empty>
        ) : (
          <Table
            columns={[
              {
                key: 'receipt_no',
                label: 'Receipt #',
                render: (r) => <code style={{ fontWeight: 'bold' }}>{r.receipt_no}</code>
              },
              { key: 'created_at', label: 'Time', render: (r) => fmtDateTime(r.created_at) },
              {
                key: 'student_name',
                label: 'Student',
                render: (r) => (
                  <div>
                    <b>{r.student_name}</b> <span className="muted">({r.index_no})</span>
                  </div>
                )
              },
              { key: 'payer_name', label: 'Payer' },
              { key: 'payment_method', label: 'Method' },
              {
                key: 'amount',
                label: 'Amount (UGX)',
                render: (r) => (
                  <b style={{ color: r.is_reversed ? '#888' : '#080', textDecoration: r.is_reversed ? 'line-through' : 'none' }}>
                    {fmtUGX(r.amount)}
                  </b>
                )
              },
              {
                key: 'status',
                label: 'Status',
                render: (r) => (r.is_reversed ? <Badge value="FAIL">Reversed</Badge> : <Badge value="CLEAR">Active</Badge>)
              },
              {
                key: '_a',
                label: '',
                render: (r) => (
                  <button className="btn sm primary" onClick={() => setSelectedReceiptId(r.id)}>
                    View / Print
                  </button>
                )
              }
            ]}
            rows={recentReceipts}
          />
        )}
      </section>

      {/* Receipt Modal */}
      {selectedReceiptId && (
        <ReceiptModal
          paymentId={selectedReceiptId}
          onClose={() => setSelectedReceiptId(null)}
          onReversed={() => {
            recentFetch.reload()
            reportFetch.reload()
          }}
        />
      )}
    </div>
  )
}

export function BursarMyCollections() {
  const { user } = useAuth()
  const [dateFilter, setDateFilter] = useState('today')
  const [customDate, setCustomDate] = useState(new Date().toISOString().slice(0, 10))
  const [selectedReceiptId, setSelectedReceiptId] = useState(null)

  const params = useMemo(() => {
    const p = { received_by: user.id, page_size: 100, ordering: '-created_at' }
    if (dateFilter === 'today') {
      p.date = new Date().toISOString().slice(0, 10)
    } else if (dateFilter === 'custom' && customDate) {
      p.date = customDate
    }
    return p
  }, [user.id, dateFilter, customDate])

  const { data, loading, error, reload } = useFetch('/finance/payments/', params)
  const payments = items(data)

  // Calculations for End of Day Handover
  const activePayments = payments.filter((p) => !p.is_reversed)
  const totalReceived = activePayments.reduce((acc, p) => acc + Number(p.amount || 0), 0)
  const cashOnly = activePayments.filter((p) => p.payment_method === 'CASH').reduce((acc, p) => acc + Number(p.amount || 0), 0)
  const bankOnly = activePayments.filter((p) => p.payment_method === 'BANK').reduce((acc, p) => acc + Number(p.amount || 0), 0)
  const mmOnly = activePayments.filter((p) => p.payment_method === 'MOBILE_MONEY').reduce((acc, p) => acc + Number(p.amount || 0), 0)

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      {/* Header controls (hidden on print) */}
      <div className="panel no-print">
        <div className="row spread">
          <div>
            <h2>💵 My Cashier Collections & Handover Log</h2>
            <p className="muted">
              Receipts issued by <b>{user.first_name} {user.last_name} ({user.username})</b> for end-of-day reconciliation.
            </p>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <select
              className="input"
              style={{ width: 'auto' }}
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              aria-label="Date Period"
            >
              <option value="today">Today's Collections</option>
              <option value="custom">Specific Date</option>
              <option value="all">All-Time Collections</option>
            </select>

            {dateFilter === 'custom' && (
              <input
                type="date"
                className="input"
                style={{ width: 'auto' }}
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                aria-label="Pick Date"
              />
            )}

            <button type="button" className="btn primary" onClick={handlePrint}>
              🖨️ Print Handover Sheet
            </button>
            <button type="button" className="btn" onClick={reload}>Refresh</button>
          </div>
        </div>
      </div>

      {loading ? (
        <Skeleton rows={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <div
          id="handover-sheet"
          className="stack"
          style={{
            background: '#fff',
            color: '#111',
            padding: 24,
            borderRadius: 8,
            border: '1px solid var(--border)',
            gap: 16
          }}
        >
          {/* Header */}
          <div style={{ textAlign: 'center', borderBottom: '2px solid #333', paddingBottom: 12 }}>
            <h2 style={{ margin: 0, textTransform: 'uppercase' }}>OFFICIAL CASH HANDOVER SHEET</h2>
            <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
              Cashier: <b>{user.first_name} {user.last_name} ({user.username})</b> · Date: {dateFilter === 'today' ? fmtDate(new Date().toISOString()) : dateFilter === 'custom' ? fmtDate(customDate) : 'All Records'}
            </div>
          </div>

          {/* Handover Summary Tiles */}
          <div className="grid cols-4" style={{ gap: 12 }}>
            <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 6, border: '1px solid #ddd' }}>
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase' }}>Physical Cash</div>
              <h3 style={{ margin: '4px 0', color: '#198754' }}>{fmtUGX(cashOnly)}</h3>
              <div style={{ fontSize: 11, color: '#777' }}>To hand over to safe</div>
            </div>

            <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 6, border: '1px solid #ddd' }}>
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase' }}>Bank Slips / Deposits</div>
              <h3 style={{ margin: '4px 0', color: '#0d6efd' }}>{fmtUGX(bankOnly)}</h3>
              <div style={{ fontSize: 11, color: '#777' }}>Direct bank deposits</div>
            </div>

            <div style={{ padding: 12, background: '#f5f5f5', borderRadius: 6, border: '1px solid #ddd' }}>
              <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase' }}>Mobile Money</div>
              <h3 style={{ margin: '4px 0', color: '#fd7e14' }}>{fmtUGX(mmOnly)}</h3>
              <div style={{ fontSize: 11, color: '#777' }}>School merchant line</div>
            </div>

            <div style={{ padding: 12, background: '#eef8f2', borderRadius: 6, border: '1px solid #a3cfbb' }}>
              <div style={{ fontSize: 11, color: '#155724', textTransform: 'uppercase', fontWeight: 'bold' }}>Total Collected</div>
              <h3 style={{ margin: '4px 0', color: '#155724' }}>{fmtUGX(totalReceived)}</h3>
              <div style={{ fontSize: 11, color: '#155724' }}>{activePayments.length} receipts issued</div>
            </div>
          </div>

          {/* Payments Table */}
          <div>
            <h4 style={{ margin: '8px 0' }}>Itemized Transactions</h4>
            {!payments.length ? (
              <Empty title="No collections recorded for this period" />
            ) : (
              <Table
                columns={[
                  { key: 'receipt_no', label: 'Receipt #', render: (r) => <code>{r.receipt_no}</code> },
                  { key: 'created_at', label: 'Time', render: (r) => fmtDateTime(r.created_at) },
                  {
                    key: 'student_name',
                    label: 'Student',
                    render: (r) => `${r.student_name} (${r.index_no})`
                  },
                  { key: 'payer_name', label: 'Payer' },
                  { key: 'payment_method', label: 'Method' },
                  {
                    key: 'amount',
                    label: 'Amount (UGX)',
                    render: (r) => (
                      <span style={{ fontWeight: 'bold', textDecoration: r.is_reversed ? 'line-through' : 'none' }}>
                        {fmtUGX(r.amount)}
                      </span>
                    )
                  },
                  {
                    key: 'is_reversed',
                    label: 'Status',
                    render: (r) => (r.is_reversed ? <Badge value="FAIL">Reversed</Badge> : <Badge value="CLEAR">Valid</Badge>)
                  },
                  {
                    key: '_act',
                    label: '',
                    render: (r) => (
                      <button className="btn sm no-print" onClick={() => setSelectedReceiptId(r.id)}>
                        Receipt
                      </button>
                    )
                  }
                ]}
                rows={payments}
              />
            )}
          </div>

          {/* Handover Signatures */}
          <div className="row spread" style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #ccc', fontSize: 12 }}>
            <div>
              <div>Handed Over By (Cashier): ________________________</div>
              <div style={{ marginTop: 4, color: '#666' }}>{user.first_name} {user.last_name}</div>
            </div>
            <div>
              <div>Received & Verified By (Lead Bursar/Head): ________________________</div>
              <div style={{ marginTop: 4, color: '#666' }}>Date & Stamp</div>
            </div>
          </div>
        </div>
      )}

      {selectedReceiptId && (
        <ReceiptModal
          paymentId={selectedReceiptId}
          onClose={() => setSelectedReceiptId(null)}
          onReversed={reload}
        />
      )}
    </div>
  )
}

