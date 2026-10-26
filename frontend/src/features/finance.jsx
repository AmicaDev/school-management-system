import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, errorMessage, items } from '../services/api'
import { useFetch } from '../hooks/useFetch'
import { useAuth } from '../contexts/AuthContext'
import { Alert, Badge, Empty, ErrorState, Modal, Skeleton, Table, fmtDate, fmtDateTime } from '../components/ui'
import { useTerms } from './Shared'
import ResourcePage from './ResourcePage'
import { R } from './resources'

export const fmtUGX = (n) => {
  const num = Number(n || 0)
  return 'UGX ' + num.toLocaleString()
}

export function ReceiptModal({ paymentId, onClose, onReversed }) {
  const { data, loading, error, reload } = useFetch(paymentId ? `/finance/payments/${paymentId}/receipt/` : null)
  const [reversing, setReversing] = useState(false)
  const [revReason, setRevReason] = useState('')
  const [revError, setRevError] = useState('')
  const [showRevInput, setShowRevInput] = useState(false)

  if (!paymentId) return null

  const handlePrint = () => {
    window.print()
  }

  const handleReverse = async () => {
    if (!revReason.trim()) {
      setRevError('A reason for reversal is required.')
      return
    }
    setReversing(true)
    setRevError('')
    try {
      await api.post(`/finance/payments/${paymentId}/reverse/`, { reason: revReason })
      setShowRevInput(false)
      reload()
      if (onReversed) onReversed()
    } catch (e) {
      setRevError(errorMessage(e))
    } finally {
      setReversing(false)
    }
  }

  return (
    <Modal title={data ? `Receipt #${data.receipt_no}` : 'Receipt'} onClose={onClose} wide>
      {loading ? (
        <Skeleton rows={8} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <Empty title="Receipt not found" />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {/* Action toolbar (hidden on print) */}
          <div className="row spread no-print" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn primary" onClick={handlePrint}>
                🖨️ Print Receipt
              </button>
              {!data.is_reversed && (
                <button
                  type="button"
                  className="btn sm danger"
                  onClick={() => setShowRevInput((s) => !s)}
                >
                  {showRevInput ? 'Cancel Reversal' : 'Reverse Payment'}
                </button>
              )}
            </div>
            {data.is_reversed && (
              <Badge value="FAIL">REVERSED TRANSACTION</Badge>
            )}
          </div>

          {showRevInput && (
            <div className="stack no-print" style={{ background: '#fff0f0', padding: 12, borderRadius: 8, border: '1px solid #f5c2c7' }}>
              <Alert kind="error"><b>Warning:</b> Reversing this receipt will deduct the payment amount from the student's ledger and audit the actor.</Alert>
              {revError && <Alert kind="error">{revError}</Alert>}
              <div className="field">
                <label>Reason for Reversal *</label>
                <input
                  className="input"
                  placeholder="e.g. Deposited into wrong student account by mistake..."
                  value={revReason}
                  onChange={(e) => setRevReason(e.target.value)}
                />
              </div>
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn sm danger" disabled={reversing} onClick={handleReverse}>
                  {reversing ? 'Reversing…' : 'Confirm Reversal'}
                </button>
              </div>
            </div>
          )}

          {/* Printable Receipt Paper */}
          <div
            id="printable-receipt"
            style={{
              background: '#fff',
              color: '#111',
              padding: '24px 32px',
              border: '2px solid #222',
              borderRadius: 8,
              fontFamily: 'Arial, sans-serif'
            }}
          >
            {/* Header */}
            <div style={{ textAlign: 'center', borderBottom: '2px solid #222', paddingBottom: 12, marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 20, textTransform: 'uppercase', letterSpacing: 1 }}>
                {data.school_name || "ST. JOSEPH'S SECONDARY SCHOOL"}
              </h2>
              <div style={{ fontSize: 12, color: '#444', marginTop: 4 }}>
                {data.school_contact || 'P.O. Box 102, Kampala · Tel: +256 700 000 000'}
              </div>
              <div style={{ fontSize: 15, fontWeight: 'bold', marginTop: 8, letterSpacing: 2 }}>
                OFFICIAL RECEIPT
              </div>
              {data.is_reversed && (
                <div style={{ color: 'red', fontWeight: 'bold', fontSize: 16, marginTop: 4 }}>
                  *** CANCELLED / REVERSED ***
                </div>
              )}
            </div>

            {/* Receipt Meta */}
            <div className="row spread" style={{ fontSize: 13, marginBottom: 14 }}>
              <div>
                <b>Receipt No:</b> <span style={{ fontFamily: 'monospace', fontSize: 15 }}>{data.receipt_no}</span>
              </div>
              <div>
                <b>Date & Time:</b> {fmtDateTime(data.created_at)}
              </div>
            </div>

            {/* Student & Payer Info Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px 16px',
                fontSize: 13,
                borderBottom: '1px dashed #888',
                paddingBottom: 12,
                marginBottom: 14
              }}
            >
              <div><b>Student Name:</b> {data.student_name}</div>
              <div><b>Admission / Index:</b> {data.index_no}</div>
              <div><b>Class:</b> {data.class_name || '—'}</div>
              <div><b>Term & Year:</b> {data.term_name} ({data.year_name})</div>
              <div><b>Payer Name:</b> {data.payer_name} ({data.payer_type})</div>
              <div><b>Payer Phone:</b> {data.payer_phone || '—'}</div>
              <div><b>Payment Method:</b> {data.payment_method}</div>
              {data.transaction_reference && (
                <div><b>Reference:</b> {data.transaction_reference}</div>
              )}
            </div>

            {/* Allocations Table */}
            {data.allocations && data.allocations.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #333' }}>
                      <th style={{ padding: '4px 0' }}>Fee Category</th>
                      <th style={{ padding: '4px 0', textAlign: 'right' }}>Amount Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.allocations.map((a, i) => (
                      <tr key={i} style={{ borderBottom: '1px dotted #ccc' }}>
                        <td style={{ padding: '4px 0' }}>{a.category_name}</td>
                        <td style={{ padding: '4px 0', textAlign: 'right' }}>{fmtUGX(a.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Total Paid & In Words */}
            <div style={{ background: '#f5f5f5', padding: '10px 14px', borderRadius: 6, marginBottom: 14 }}>
              <div className="row spread" style={{ fontSize: 16, fontWeight: 'bold' }}>
                <span>TOTAL AMOUNT RECEIVED:</span>
                <span>{fmtUGX(data.amount)}</span>
              </div>
              <div style={{ fontSize: 12, marginTop: 4, fontStyle: 'italic' }}>
                <b>Amount in words:</b> {data.amount_words || data.amount_in_words}
              </div>
            </div>

            {/* Balance statement */}
            <div className="row spread" style={{ fontSize: 13, borderBottom: '1px dashed #888', paddingBottom: 10, marginBottom: 14 }}>
              <div>
                <b>Previous Balance:</b> {fmtUGX(data.balance_before)}
              </div>
              <div>
                <b>Remaining Balance:</b> <span style={{ fontWeight: 'bold', color: Number(data.balance_after) > 0 ? '#b00' : '#080' }}>
                  {fmtUGX(data.balance_after)}
                </span>
              </div>
            </div>

            {/* Footer / Signatures */}
            <div className="row spread" style={{ fontSize: 11, marginTop: 20 }}>
              <div>
                <div><b>Served By:</b> {data.received_by_name || 'Bursar'}</div>
                <div style={{ marginTop: 20, borderTop: '1px solid #444', width: 140, textAlign: 'center' }}>
                  Bursar Signature
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 10, color: '#666' }}>
                  Verify receipt online with code:
                  <br />
                  <code style={{ background: '#eee', padding: '2px 4px', fontSize: 10 }}>{data.verification_code}</code>
                </div>
                <div style={{ marginTop: 14, fontStyle: 'italic', color: '#555' }}>
                  Thank you for keeping fees up to date.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

export function FinanceOverview() {
  const { terms, active } = useTerms()
  const [termId, setTermId] = useState(null)

  useEffect(() => {
    if (active && !termId) setTermId(active.id)
  }, [active, termId])

  const { data, loading, error, reload } = useFetch(termId ? `/finance/reports/?term=${termId}` : '/finance/reports/')

  return (
    <div className="stack" style={{ gap: 20 }}>
      {/* Top Header */}
      <div className="panel">
        <div className="row spread">
          <div>
            <h2>Finance Overview</h2>
            <p className="muted">Summary of cash collections, fee balances, expenses, and cashbook reconciliation.</p>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <select
              className="input"
              style={{ width: 'auto' }}
              value={termId || ''}
              onChange={(e) => setTermId(Number(e.target.value))}
              aria-label="Select Term"
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.year_name || t.year})
                </option>
              ))}
            </select>
            <button className="btn sm" onClick={reload}>Refresh</button>
          </div>
        </div>

        {/* Quick action buttons */}
        <div className="row wrap" style={{ gap: 10, marginTop: 16 }}>
          <Link className="btn primary lg" to="/admin/finance/payments/new">💳 Record Payment</Link>
          <Link className="btn lg" to="/admin/finance/accounts">👥 Student Accounts</Link>
          <Link className="btn lg" to="/admin/finance/receipts">🧾 Receipts & History</Link>
          <Link className="btn lg" to="/admin/finance/structures">📋 Fee Structures</Link>
          <Link className="btn lg" to="/admin/finance/expenses">📉 School Expenses</Link>
          <Link className="btn lg" to="/admin/finance/reports">📊 Full Financial Reports</Link>
        </div>
      </div>

      {loading ? (
        <Skeleton rows={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <Empty title="No financial data available" />
      ) : (
        <>
          {/* Key Metric KPI Cards */}
          <div className="grid cols-4" style={{ gap: 14 }}>
            <div className="panel" style={{ borderLeft: '4px solid var(--primary)' }}>
              <small className="muted">Total Fees Collected</small>
              <h2 style={{ margin: '6px 0', color: 'var(--primary)' }}>{fmtUGX(data.total_collected)}</h2>
              <small className="muted">Current term collections</small>
            </div>
            <div className="panel" style={{ borderLeft: '4px solid #198754' }}>
              <small className="muted">Today's Collections</small>
              <h2 style={{ margin: '6px 0', color: '#198754' }}>{fmtUGX(data.today_collected)}</h2>
              <small className="muted">Collected today across bursars</small>
            </div>
            <div className="panel" style={{ borderLeft: '4px solid #dc3545' }}>
              <small className="muted">Total Expenses Paid</small>
              <h2 style={{ margin: '6px 0', color: '#dc3545' }}>{fmtUGX(data.total_expenses)}</h2>
              <small className="muted">Approved school expenditure</small>
            </div>
            <div className="panel" style={{ borderLeft: '4px solid #0dcaf0' }}>
              <small className="muted">Cash in Hand (Reconciliation)</small>
              <h2 style={{ margin: '6px 0', color: '#0dcaf0' }}>{fmtUGX(data.cash_in_hand)}</h2>
              <small className="muted">Physical cash collected vs cash spent</small>
            </div>
          </div>

          {/* Breakdown Grids */}
          <div className="grid cols-2" style={{ gap: 14 }}>
            {/* By Payment Method */}
            <section className="panel">
              <h3>Collections by Payment Method</h3>
              {!data.by_payment_method?.length ? (
                <Empty title="No payment records yet" />
              ) : (
                <Table
                  columns={[
                    { key: 'payment_method', label: 'Method' },
                    { key: 'count', label: 'Receipts' },
                    { key: 'total', label: 'Total Amount', render: (r) => <b>{fmtUGX(r.total)}</b> }
                  ]}
                  rows={data.by_payment_method}
                />
              )}
            </section>

            {/* By Bursar */}
            <section className="panel">
              <h3>Collections by Bursar / Staff</h3>
              {!data.by_bursar?.length ? (
                <Empty title="No staff collections yet" />
              ) : (
                <Table
                  columns={[
                    {
                      key: 'received_by',
                      label: 'Bursar',
                      render: (r) => `${r.received_by__first_name} ${r.received_by__last_name} (${r.received_by__username})`
                    },
                    { key: 'count', label: 'Receipts' },
                    { key: 'total', label: 'Total Collected', render: (r) => <b>{fmtUGX(r.total)}</b> }
                  ]}
                  rows={data.by_bursar}
                />
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}

export function RecordPaymentPage() {
  const navigate = useNavigate()
  const { terms, active } = useTerms()
  const [sp] = useSearchParams()
  const preStudentId = sp.get('student')

  const [termId, setTermId] = useState(active?.id || null)
  const [studentId, setStudentId] = useState(preStudentId ? Number(preStudentId) : '')
  const [studentSearch, setStudentSearch] = useState('')
  const [selectedStudent, setSelectedStudent] = useState(null)

  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('CASH')
  const [reference, setReference] = useState('')
  const [payerName, setPayerName] = useState('')
  const [payerType, setPayerType] = useState('PARENT')
  const [payerPhone, setPayerPhone] = useState('')
  const [notes, setNotes] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [newReceiptId, setNewReceiptId] = useState(null)

  useEffect(() => {
    if (active && !termId) setTermId(active.id)
  }, [active, termId])

  // Fetch student balance statement when student + term are chosen
  const balanceFetch = useFetch(
    studentId && termId ? `/finance/accounts/${studentId}/statement/?term=${termId}` : null
  )

  useEffect(() => {
    if (balanceFetch.data) {
      setSelectedStudent(balanceFetch.data)
      if (!payerName && balanceFetch.data.parents?.length > 0) {
        const p = balanceFetch.data.parents[0]
        setPayerName(`${p.first_name} ${p.last_name}`)
        if (p.phone) setPayerPhone(p.phone)
      }
    }
  }, [balanceFetch.data]) // eslint-disable-line

  // Student search
  const studentsFetch = useFetch(studentSearch ? '/students/' : null, { search: studentSearch, page_size: 10 })
  const searchResults = items(studentsFetch.data)

  const wordsPreview = useMemo(() => {
    if (!amount || isNaN(Number(amount))) return ''
    return fmtUGX(amount)
  }, [amount])

  const balBefore = selectedStudent ? selectedStudent.outstanding_balance : 0
  const balAfter = selectedStudent ? Number(balBefore) - Number(amount || 0) : 0

  const handleRecord = async (e) => {
    e.preventDefault()
    if (!studentId) return setSaveError('Please select a student.')
    if (!termId) return setSaveError('Please select an academic term.')
    if (!amount || Number(amount) <= 0) return setSaveError('Please enter a valid amount.')
    if (!payerName.trim()) return setSaveError('Payer full name is required.')

    setSaving(true)
    setSaveError('')

    try {
      const res = await api.post('/finance/payments/record-payment/', {
        student: Number(studentId),
        term: Number(termId),
        amount: String(amount),
        payment_method: method,
        transaction_reference: reference,
        payer_name: payerName,
        payer_type: payerType,
        payer_phone: payerPhone,
        notes
      })
      setNewReceiptId(res.data.id)
    } catch (err) {
      setSaveError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="panel" style={{ maxWidth: 840, margin: '0 auto', width: '100%' }}>
        <div className="panel-head">
          <h2>💳 Record Student Fee Payment</h2>
          <Link className="btn sm" to="/admin/finance/accounts">← Student Accounts</Link>
        </div>

        {saveError && <Alert kind="error">{saveError}</Alert>}

        <form onSubmit={handleRecord} className="stack" style={{ gap: 16 }}>
          {/* Step 1: Term and Student Selection */}
          <div className="grid cols-2" style={{ gap: 12 }}>
            <div className="field">
              <label>Academic Term *</label>
              <select
                className="input"
                value={termId || ''}
                onChange={(e) => setTermId(Number(e.target.value))}
                required
              >
                <option value="">— Select Term —</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.year_name || t.year})
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Select Student *</label>
              <input
                className="input"
                placeholder="Search student by name or index no…"
                value={studentSearch}
                onChange={(e) => setStudentSearch(e.target.value)}
              />
              {searchResults.length > 0 && studentSearch && (
                <div className="stack" style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginTop: 4, background: 'var(--surface)' }}>
                  {searchResults.map((s) => (
                    <div
                      key={s.id}
                      style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                      onClick={() => {
                        setStudentId(s.id)
                        setStudentSearch(`${s.full_name} (${s.index_no})`)
                      }}
                    >
                      <b>{s.full_name}</b> <span className="muted">· {s.index_no} · {s.stream_label || ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Balance Preview Card */}
          {selectedStudent && (
            <div className="panel" style={{ background: 'var(--surface-raised, #f8f9fa)', border: '1px solid var(--border)' }}>
              <div className="row spread" style={{ alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0 }}>{selectedStudent.student_name}</h3>
                  <span className="muted">{selectedStudent.index_no} · {selectedStudent.class_name}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <small className="muted">Current Outstanding Balance</small>
                  <h3 style={{ margin: 0, color: Number(selectedStudent.outstanding_balance) > 0 ? '#b00' : '#080' }}>
                    {fmtUGX(selectedStudent.outstanding_balance)}
                  </h3>
                  <Badge value={selectedStudent.status}>{selectedStudent.status}</Badge>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Payment Details */}
          <div className="grid cols-3" style={{ gap: 12 }}>
            <div className="field">
              <label>Amount Received (UGX) *</label>
              <input
                type="number"
                min="1"
                step="100"
                className="input"
                placeholder="e.g. 350000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
              {wordsPreview && <small className="muted">{wordsPreview}</small>}
            </div>

            <div className="field">
              <label>Payment Method *</label>
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)} required>
                <option value="CASH">Cash</option>
                <option value="BANK">Bank Deposit / Transfer</option>
                <option value="MOBILE_MONEY">Mobile Money</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div className="field">
              <label>Transaction / Bank Ref (if any)</label>
              <input
                className="input"
                placeholder="e.g. Bank slip # / MM Tx ID"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </div>

          {/* Step 3: Payer Information */}
          <div className="grid cols-3" style={{ gap: 12 }}>
            <div className="field">
              <label>Payer Full Name *</label>
              <input
                className="input"
                placeholder="Name of person handing over cash/paying"
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label>Payer Relationship</label>
              <select className="input" value={payerType} onChange={(e) => setPayerType(e.target.value)}>
                <option value="PARENT">Parent</option>
                <option value="GUARDIAN">Guardian</option>
                <option value="STUDENT">Student</option>
                <option value="SPONSOR">Sponsor / NGO</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div className="field">
              <label>Payer Phone Number</label>
              <input
                className="input"
                placeholder="+256 7..."
                value={payerPhone}
                onChange={(e) => setPayerPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label>Notes / Remarks</label>
            <input
              className="input"
              placeholder="e.g. Balance to be completed before mid-term exams..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Balance after preview */}
          {selectedStudent && amount && !isNaN(Number(amount)) && (
            <div className="row spread" style={{ background: '#eef8f2', padding: 12, borderRadius: 8, border: '1px solid #a3cfbb' }}>
              <div><b>Balance before:</b> {fmtUGX(balBefore)}</div>
              <div><b>Paying now:</b> {fmtUGX(amount)}</div>
              <div>
                <b>New Balance after:</b> <b style={{ color: balAfter > 0 ? '#b00' : '#080' }}>{fmtUGX(balAfter)}</b>
                {balAfter < 0 && <span className="badge info" style={{ marginLeft: 6 }}>Advance Overpayment</span>}
              </div>
            </div>
          )}

          <div className="row spread" style={{ marginTop: 10 }}>
            <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
            <button className="btn primary lg" type="submit" disabled={saving || !studentId || !amount}>
              {saving ? 'Recording Payment…' : '💾 Record Payment & Issue Receipt'}
            </button>
          </div>
        </form>
      </section>

      {/* Pop up the printable receipt when saved */}
      {newReceiptId && (
        <ReceiptModal
          paymentId={newReceiptId}
          onClose={() => {
            setNewReceiptId(null)
            navigate('/admin/finance/accounts')
          }}
        />
      )}
    </div>
  )
}

export function StudentAccountsPage() {
  const [sp, setSp] = useSearchParams()
  const { terms, active } = useTerms()
  const classesFetch = useFetch('/academics/classes/')
  const allClasses = items(classesFetch.data)

  const [termId, setTermId] = useState(active?.id || '')
  const [classId, setClassId] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')

  const [statementStudentId, setStatementStudentId] = useState(null)
  const [receiptPaymentId, setReceiptPaymentId] = useState(null)
  const [reminderNotice, setReminderNotice] = useState('')
  const [remindingId, setRemindingId] = useState(null)

  const handleSendReminder = async (student) => {
    setRemindingId(student.student_id)
    setReminderNotice('')
    try {
      const res = await api.post(`/finance/accounts/${student.student_id}/reminder/`, { term: termId })
      setReminderNotice(res.data?.detail || `Fee reminder sent for ${student.student_name}.`)
    } catch (e) {
      setReminderNotice(`Failed to send reminder: ${errorMessage(e)}`)
    } finally {
      setRemindingId(null)
    }
  }

  useEffect(() => {
    if (active && !termId) setTermId(active.id)
  }, [active, termId])

  const params = useMemo(() => ({
    ...(termId ? { term: termId } : {}),
    ...(classId ? { school_class: classId } : {}),
    ...(status ? { status } : {}),
    ...(search ? { search } : {})
  }), [termId, classId, status, search])

  const { data, loading, error, reload } = useFetch(termId ? '/finance/accounts/' : null, params)
  const rows = data?.results || []

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>👥 Student Fee Accounts</h2>
            <p className="muted">Track student billing, total paid, and outstanding balances per class and term.</p>
          </div>
          <Link className="btn primary" to="/admin/finance/payments/new">💳 Record Payment</Link>
        </div>

        {reminderNotice && (
          <Alert kind={reminderNotice.startsWith('Failed') ? 'error' : 'success'} style={{ marginBottom: 12 }}>
            {reminderNotice}
          </Alert>
        )}

        {/* Filter Toolbar */}
        <div className="row wrap" style={{ gap: 10, marginBottom: 12 }}>
          <select
            className="input"
            style={{ width: 'auto' }}
            value={termId}
            onChange={(e) => setTermId(Number(e.target.value))}
            aria-label="Term"
          >
            <option value="">Select Term</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.year_name || t.year})
              </option>
            ))}
          </select>

          <select
            className="input"
            style={{ width: 'auto' }}
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            aria-label="Class"
          >
            <option value="">All Classes</option>
            {allClasses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <select
            className="input"
            style={{ width: 'auto' }}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Payment Status"
          >
            <option value="">All Statuses</option>
            <option value="UNPAID">Unpaid (No payments)</option>
            <option value="PARTIAL">Partial (Has balance)</option>
            <option value="CLEAR">Clear (Fully paid)</option>
            <option value="OVERPAID">Overpaid (Credit advance)</option>
          </select>

          <input
            className="input"
            style={{ width: 220 }}
            placeholder="Search student or index…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search students"
          />

          <button className="btn sm" onClick={reload}>Refresh</button>
        </div>

        {loading ? (
          <Skeleton rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !rows.length ? (
          <Empty title="No student fee accounts found" />
        ) : (
          <Table
            columns={[
              { key: 'index_no', label: 'Index No' },
              {
                key: 'student_name',
                label: 'Student Name',
                render: (r) => (
                  <div>
                    <b>{r.student_name}</b>
                    <div className="muted" style={{ fontSize: 11 }}>{r.class_name} {r.stream_name ? `· ${r.stream_name}` : ''}</div>
                  </div>
                )
              },
              { key: 'expected_fees', label: 'Expected Fees', render: (r) => fmtUGX(r.expected_fees) },
              { key: 'total_paid', label: 'Total Paid', render: (r) => <span style={{ color: '#080', fontWeight: 'bold' }}>{fmtUGX(r.total_paid)}</span> },
              {
                key: 'outstanding_balance',
                label: 'Balance',
                render: (r) => (
                  <span style={{ color: Number(r.outstanding_balance) > 0 ? '#b00' : '#080', fontWeight: 'bold' }}>
                    {fmtUGX(r.outstanding_balance)}
                  </span>
                )
              },
              {
                key: 'status',
                label: 'Status',
                render: (r) => <Badge value={r.status}>{r.status}</Badge>
              },
              {
                key: '_a',
                label: '',
                render: (r) => (
                  <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                    <button className="btn sm" onClick={() => setStatementStudentId(r.student_id)}>Statement</button>
                    <Link className="btn sm primary" to={`/admin/finance/payments/new?student=${r.student_id}`}>Pay</Link>
                    {Number(r.outstanding_balance) > 0 && (
                      <button
                        className="btn sm warning"
                        disabled={remindingId === r.student_id}
                        onClick={() => handleSendReminder(r)}
                        title="Send fee balance reminder to parents"
                      >
                        {remindingId === r.student_id ? 'Sending…' : 'Remind'}
                      </button>
                    )}
                  </div>
                )
              }
            ]}
            rows={rows}
          />
        )}
      </section>

      {/* Statement Modal */}
      {statementStudentId && (
        <StatementModal
          studentId={statementStudentId}
          termId={termId}
          onClose={() => setStatementStudentId(null)}
          onViewReceipt={(id) => setReceiptPaymentId(id)}
        />
      )}

      {/* Receipt Modal */}
      {receiptPaymentId && (
        <ReceiptModal
          paymentId={receiptPaymentId}
          onClose={() => setReceiptPaymentId(null)}
          onReversed={reload}
        />
      )}
    </div>
  )
}

function StatementModal({ studentId, termId, onClose, onViewReceipt }) {
  const { data, loading, error, reload } = useFetch(
    studentId ? `/finance/accounts/${studentId}/statement/?term=${termId}` : null
  )

  return (
    <Modal title={data ? `Fee Statement: ${data.student_name}` : 'Student Statement'} onClose={onClose} wide>
      {loading ? (
        <Skeleton rows={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <Empty title="Statement not found" />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row spread" style={{ background: 'var(--surface-raised, #f8f9fa)', padding: 12, borderRadius: 8 }}>
            <div>
              <h3 style={{ margin: 0 }}>{data.student_name}</h3>
              <div className="muted">{data.index_no} · {data.class_name} · {data.term_name} ({data.year_name})</div>
              {data.parents?.length > 0 && (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  <b>Parent / Guardian Contact:</b> {data.parents.map((p) => `${p.first_name} ${p.last_name} (${p.phone || 'no phone'})`).join(', ')}
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12 }} className="muted">Outstanding Balance</div>
              <h3 style={{ margin: 0, color: Number(data.outstanding_balance) > 0 ? '#b00' : '#080' }}>
                {fmtUGX(data.outstanding_balance)}
              </h3>
              <Badge value={data.status}>{data.status}</Badge>
            </div>
          </div>

          {/* Category Breakdown */}
          <div>
            <h4>Fee Breakdown</h4>
            <table className="table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Expected</th>
                  <th>Allocated / Paid</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.categories.map((c) => (
                  <tr key={c.category_id}>
                    <td><b>{c.category_name}</b> ({c.code})</td>
                    <td>{fmtUGX(c.expected)}</td>
                    <td>{fmtUGX(c.paid)}</td>
                    <td style={{ fontWeight: 'bold', color: (c.expected - c.paid) > 0 ? '#b00' : '#080' }}>
                      {fmtUGX(c.expected - c.paid)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Payments List */}
          <div>
            <h4>Payment History (Receipts)</h4>
            {!data.payments?.length ? (
              <Empty title="No payments recorded this term" />
            ) : (
              <Table
                columns={[
                  { key: 'receipt_no', label: 'Receipt No' },
                  { key: 'date', label: 'Date', render: (p) => fmtDate(p.date) },
                  { key: 'payer_name', label: 'Payer' },
                  { key: 'payment_method', label: 'Method' },
                  { key: 'amount', label: 'Amount', render: (p) => <b>{fmtUGX(p.amount)}</b> },
                  {
                    key: '_a',
                    label: '',
                    render: (p) => (
                      <button className="btn sm primary" onClick={() => onViewReceipt(p.id)}>
                        Receipt
                      </button>
                    )
                  }
                ]}
                rows={data.payments}
              />
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

export function ReceiptsHistoryPage() {
  const { terms, active } = useTerms()
  const [termId, setTermId] = useState(active?.id || '')
  const [search, setSearch] = useState('')
  const [method, setMethod] = useState('')
  const [status, setStatus] = useState('')
  const [selectedReceiptId, setSelectedReceiptId] = useState(null)

  useEffect(() => {
    if (active && !termId) setTermId(active.id)
  }, [active, termId])

  const params = useMemo(() => ({
    ...(termId ? { term: termId } : {}),
    ...(search ? { search } : {}),
    ...(method ? { payment_method: method } : {}),
    ...(status === 'reversed' ? { is_reversed: 'true' } : status === 'active' ? { is_reversed: 'false' } : {})
  }), [termId, search, method, status])

  const { data, loading, error, reload } = useFetch('/finance/payments/', params)
  const rows = items(data)

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>🧾 Fee Receipts & Payment History</h2>
            <p className="muted">All issued official fee receipts with real-time audit status.</p>
          </div>
          <Link className="btn primary" to="/admin/finance/payments/new">💳 Record Payment</Link>
        </div>

        {/* Filter controls */}
        <div className="row wrap" style={{ gap: 10, marginBottom: 12 }}>
          <select
            className="input"
            style={{ width: 'auto' }}
            value={termId}
            onChange={(e) => setTermId(Number(e.target.value))}
            aria-label="Filter by Term"
          >
            <option value="">All Terms</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.year_name || t.year})
              </option>
            ))}
          </select>

          <select
            className="input"
            style={{ width: 'auto' }}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            aria-label="Filter by Method"
          >
            <option value="">All Payment Methods</option>
            <option value="CASH">Cash</option>
            <option value="BANK">Bank Deposit / Transfer</option>
            <option value="MOBILE_MONEY">Mobile Money</option>
            <option value="OTHER">Other</option>
          </select>

          <select
            className="input"
            style={{ width: 'auto' }}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by Status"
          >
            <option value="">All Transactions</option>
            <option value="active">Active Only</option>
            <option value="reversed">Reversed / Cancelled</option>
          </select>

          <input
            className="input"
            style={{ width: 220 }}
            placeholder="Search receipt # or student…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search receipts"
          />

          <button className="btn sm" onClick={reload}>Refresh</button>
        </div>

        {loading ? (
          <Skeleton rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !rows.length ? (
          <Empty title="No receipts found" />
        ) : (
          <Table
            columns={[
              {
                key: 'receipt_no',
                label: 'Receipt #',
                render: (r) => <code style={{ fontWeight: 'bold' }}>{r.receipt_no}</code>
              },
              { key: 'created_at', label: 'Date', render: (r) => fmtDate(r.created_at) },
              {
                key: 'student_name',
                label: 'Student',
                render: (r) => (
                  <div>
                    <b>{r.student_name}</b>
                    <div className="muted" style={{ fontSize: 11 }}>{r.index_no} · {r.class_name}</div>
                  </div>
                )
              },
              { key: 'payer_name', label: 'Payer', render: (r) => `${r.payer_name} (${r.payer_type})` },
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
                key: 'is_reversed',
                label: 'Status',
                render: (r) => (
                  r.is_reversed ? <Badge value="FAIL">Reversed</Badge> : <Badge value="CLEAR">Active</Badge>
                )
              },
              {
                key: '_act',
                label: '',
                render: (r) => (
                  <button className="btn sm primary" onClick={() => setSelectedReceiptId(r.id)}>
                    View Receipt
                  </button>
                )
              }
            ]}
            rows={rows}
          />
        )}
      </section>

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

export function FeeStructuresPage() {
  return <ResourcePage cfg={R.feeStructures} />
}

export function FeeCategoriesPage() {
  return <ResourcePage cfg={R.feeCategories} />
}

export function ExpensesPage() {
  return <ResourcePage cfg={R.expenses} />
}

export function FinancialReportsPage() {
  const { terms, active } = useTerms()
  const [termId, setTermId] = useState(active?.id || '')

  useEffect(() => {
    if (active && !termId) setTermId(active.id)
  }, [active, termId])

  const { data, loading, error, reload } = useFetch(termId ? `/finance/reports/?term=${termId}` : '/finance/reports/')

  const handlePrint = () => {
    window.print()
  }

  const netCashFlow = data ? Number(data.total_collected || 0) - Number(data.total_expenses || 0) : 0

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="panel no-print">
        <div className="row spread">
          <div>
            <h2>📊 School Financial Statements & Reports</h2>
            <p className="muted">Audited financial summaries, revenue breakdown, expense ledger, and reconciliation.</p>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <select
              className="input"
              style={{ width: 'auto' }}
              value={termId}
              onChange={(e) => setTermId(Number(e.target.value))}
              aria-label="Select Term"
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.year_name || t.year})
                </option>
              ))}
            </select>
            <button type="button" className="btn primary" onClick={handlePrint}>🖨️ Print Statement</button>
            <button type="button" className="btn" onClick={reload}>Refresh</button>
          </div>
        </div>
      </div>

      {loading ? (
        <Skeleton rows={8} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <Empty title="No financial data available" />
      ) : (
        <div
          id="printable-report"
          className="stack"
          style={{
            background: '#fff',
            color: '#111',
            padding: 24,
            borderRadius: 8,
            border: '1px solid var(--border)',
            gap: 20
          }}
        >
          {/* Header */}
          <div style={{ textAlign: 'center', borderBottom: '2px solid #333', paddingBottom: 14 }}>
            <h2 style={{ margin: 0, textTransform: 'uppercase' }}>{data.school_name || "ST. JOSEPH'S SECONDARY SCHOOL"}</h2>
            <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
              TERM FINANCIAL RECONCILIATION STATEMENT · {data.term_name || 'TERM'}
            </div>
            <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>
              Generated on {fmtDateTime(new Date().toISOString())}
            </div>
          </div>

          {/* Cashflow Summary Cards */}
          <div className="grid cols-3" style={{ gap: 14 }}>
            <div style={{ padding: 16, background: '#f8fdf9', border: '1px solid #b7e4c7', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#2d6a4f', textTransform: 'uppercase', fontWeight: 'bold' }}>Total Fees Revenue</div>
              <h2 style={{ margin: '8px 0', color: '#1b4332' }}>{fmtUGX(data.total_collected)}</h2>
              <div style={{ fontSize: 11, color: '#52b788' }}>Total collections received</div>
            </div>

            <div style={{ padding: 16, background: '#fff5f5', border: '1px solid #f5c2c7', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#b02a37', textTransform: 'uppercase', fontWeight: 'bold' }}>Total Expenditure</div>
              <h2 style={{ margin: '8px 0', color: '#842029' }}>{fmtUGX(data.total_expenses)}</h2>
              <div style={{ fontSize: 11, color: '#ea868f' }}>Operational and administrative costs</div>
            </div>

            <div style={{ padding: 16, background: '#f0f7ff', border: '1px solid #b6d4fe', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#084298', textTransform: 'uppercase', fontWeight: 'bold' }}>Net Operational Balance</div>
              <h2 style={{ margin: '8px 0', color: netCashFlow >= 0 ? '#0a58ca' : '#b02a37' }}>{fmtUGX(netCashFlow)}</h2>
              <div style={{ fontSize: 11, color: '#6ea8fe' }}>{netCashFlow >= 0 ? 'Surplus cash flow' : 'Deficit cash flow'}</div>
            </div>
          </div>

          {/* Detailed Tables */}
          <div className="grid cols-2" style={{ gap: 20 }}>
            {/* By Payment Method */}
            <div style={{ border: '1px solid #eee', padding: 16, borderRadius: 8 }}>
              <h4 style={{ margin: '0 0 12px 0' }}>Collections by Payment Channel</h4>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
                    <th style={{ padding: '6px 4px' }}>Channel</th>
                    <th style={{ padding: '6px 4px', textAlign: 'center' }}>Transactions</th>
                    <th style={{ padding: '6px 4px', textAlign: 'right' }}>Total Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_payment_method?.map((m, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '6px 4px' }}><b>{m.payment_method}</b></td>
                      <td style={{ padding: '6px 4px', textAlign: 'center' }}>{m.count}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmtUGX(m.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* By Bursar */}
            <div style={{ border: '1px solid #eee', padding: 16, borderRadius: 8 }}>
              <h4 style={{ margin: '0 0 12px 0' }}>Collections by Staff / Bursar</h4>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
                    <th style={{ padding: '6px 4px' }}>Staff / Cashier</th>
                    <th style={{ padding: '6px 4px', textAlign: 'center' }}>Receipts</th>
                    <th style={{ padding: '6px 4px', textAlign: 'right' }}>Total Received</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_bursar?.map((b, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '6px 4px' }}>{b.received_by__first_name} {b.received_by__last_name}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'center' }}>{b.count}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right' }}><b>{fmtUGX(b.total)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Expenses by Category */}
          {data.by_expense_category && data.by_expense_category.length > 0 && (
            <div style={{ border: '1px solid #eee', padding: 16, borderRadius: 8 }}>
              <h4 style={{ margin: '0 0 12px 0' }}>Expenditure Breakdown by Category</h4>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
                    <th style={{ padding: '6px 4px' }}>Expense Category</th>
                    <th style={{ padding: '6px 4px', textAlign: 'center' }}>Vouchers</th>
                    <th style={{ padding: '6px 4px', textAlign: 'right' }}>Total Spent</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_expense_category.map((ex, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '6px 4px' }}><b>{ex.category}</b></td>
                      <td style={{ padding: '6px 4px', textAlign: 'center' }}>{ex.count}</td>
                      <td style={{ padding: '6px 4px', textAlign: 'right', color: '#b02a37' }}><b>{fmtUGX(ex.total)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Verification & Signatures */}
          <div className="row spread" style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #ccc', fontSize: 12 }}>
            <div>
              <div>Prepared By: ___________________________</div>
              <div style={{ marginTop: 4, color: '#666' }}>Bursar / Accounts Office</div>
            </div>
            <div>
              <div>Reviewed By: ___________________________</div>
              <div style={{ marginTop: 4, color: '#666' }}>Headteacher / Principal</div>
            </div>
            <div>
              <div>Official School Stamp:</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
