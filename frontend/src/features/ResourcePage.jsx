import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, errorMessage, fieldErrors, items } from '../services/api'
import { Alert, Empty, ErrorState, Modal, Skeleton, Table } from '../components/ui'

/** Options for select fields: static array of [value,label] or {endpoint,label,value}. */
function useOptions(field) {
  const [result, setResult] = useState({ opts: Array.isArray(field.options) ? field.options : [], error: '' })
  useEffect(() => {
    if (field.options && !Array.isArray(field.options)) {
      let active = true
      const { endpoint, label, value = 'id', params } = field.options
      const loadAll = async () => {
        const records = []
        let page = 1
        let next = true
        while (next) {
          const { data } = await api.get(endpoint, { params: { page, page_size: 200, ...params } })
          records.push(...items(data))
          next = !!data?.next
          page += 1
        }
        return records.map((o) => [o[value], typeof label === 'function' ? label(o) : o[label]])
      }
      loadAll()
        .then((opts) => { if (active) setResult({ opts, error: '' }) })
        .catch((e) => { if (active) setResult({ opts: [], error: errorMessage(e) }) })
      return () => { active = false }
    }
    setResult({ opts: Array.isArray(field.options) ? field.options : [], error: '' })
    return undefined
  }, [field.options])
  return result
}

function FilterSelect({ filter, value, onChange }) {
  const { opts } = useOptions(filter)
  return (
    <select
      className="input"
      style={{ width: 'auto' }}
      value={value ?? ''}
      aria-label={filter.label}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{filter.label}</option>
      {(opts || []).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}

function Field({ f, value, error, onChange }) {
  const { opts, error: optionsError } = useOptions(f)
  const id = `f-${f.name}`
  const cls = `input${error ? ' invalid' : ''}`
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  let control
  if (f.type === 'select') {
    control = <select id={id} className={cls} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : e.target.value)}><option value="">— select —</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
  } else if (f.type === 'multiselect') {
    const selected = (value || []).map(String)
    const selectedOptions = opts.filter(([v]) => selected.includes(String(v)))
    const visible = opts.filter(([v, label]) => selected.includes(String(v)) || String(label).toLowerCase().includes(search.toLowerCase()))
    control = <div className="stack">
      <button type="button" className={`btn${error ? ' invalid' : ''}`} aria-haspopup="dialog" onClick={() => setPickerOpen(true)}>
        {selected.length ? `${selected.length} selected · Edit list` : 'Choose from registered records'}
      </button>
      {selectedOptions.length > 0 && <div className="row">{selectedOptions.map(([option, label]) => <span className="badge" key={option}>{label}</span>)}</div>}
      {pickerOpen && <Modal title={`Choose ${f.label.toLowerCase()}`} onClose={() => setPickerOpen(false)} wide>
        <div className="field"><label htmlFor={`${id}-search`}>Search registered records</label><input id={`${id}-search`} autoFocus className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type a name to filter…" /></div>
        <div className="stack" style={{ maxHeight: 'min(50vh, 420px)', overflowY: 'auto' }}>
          {visible.map(([option, label]) => {
            const checked = selected.includes(String(option))
            return <label key={option} className="row" style={{ justifyContent: 'flex-start', padding: 10, border: '1px solid var(--border)', borderRadius: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={checked} onChange={() => onChange(checked ? value.filter((x) => String(x) !== String(option)) : [...(value || []), Number(option)])} />
              <span>{label}</span>
            </label>
          })}
          {!visible.length && <Empty title="No matching records" />}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button type="button" className="btn primary" onClick={() => { setPickerOpen(false); setSearch('') }}>Done</button></div>
      </Modal>}
    </div>
  } else if (f.type === 'textarea') {
    control = <textarea id={id} className={cls} rows={3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  } else if (f.type === 'checkbox') {
    control = <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} style={{ width: 22, height: 22 }} />
  } else if (f.type === 'checkboxes') {
    control = <div className="row">{opts.map(([option, label]) => <label className="row" key={option} style={{ gap: 6 }}>
      <input type="checkbox" checked={(value || []).includes(option)} onChange={() => onChange((value || []).includes(option) ? value.filter((x) => x !== option) : [...(value || []), option])} />
      <span>{label}</span>
    </label>)}</div>
  } else if (f.type === 'radio') {
    control = <div className="row">{opts.map(([option, label]) => <label className="row" key={option} style={{ gap: 6 }}>
      <input type="radio" name={id} checked={value === option} onChange={() => onChange(option)} />
      <span>{label}</span>
    </label>)}</div>
  } else if (f.type === 'file') {
    control = <input id={id} type="file" accept="image/png,image/jpeg,image/webp" className={cls} onChange={(e) => onChange(e.target.files[0] || null)} />
  } else {
    control = <input id={id} type={f.type || 'text'} className={cls} value={value ?? ''} step={f.step} min={f.min} autoComplete={f.type === 'password' ? 'new-password' : 'off'} onChange={(e) => onChange(e.target.value)} />
  }
  return <div className="field"><label htmlFor={id}>{f.label}{f.required && ' *'}</label>{control}{optionsError && <Alert>{optionsError}</Alert>}{f.help && <span className="muted" style={{ fontSize: 12 }}>{f.help}</span>}{error && <span className="err">{error}</span>}</div>
}

function FormModal({ cfg, record, onClose, onSaved }) {
  const editing = !!record
  const [values, setValues] = useState(() => Object.fromEntries(cfg.fields.map((f) => [f.name, record ? (record[f.name] ?? (f.type === 'multiselect' || f.type === 'checkboxes' ? [] : '')) : (f.default ?? (f.type === 'multiselect' || f.type === 'checkboxes' ? [] : f.type === 'checkbox' ? false : ''))])))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    const local = {}
    cfg.fields.forEach((f) => { if (f.required && !(editing && f.type === 'password') && (values[f.name] === '' || values[f.name] == null)) local[f.name] = 'This field is required.' })
    setErrors(local)
    if (Object.keys(local).length) return
    setSaving(true); setMsg('')
    try {
      const hasFile = cfg.fields.some((f) => f.type === 'file' && values[f.name] instanceof File)
      let body
      if (hasFile) {
        body = new FormData()
        cfg.fields.forEach((f) => {
          const v = values[f.name]
          if (f.type === 'file') { if (v instanceof File) body.append(f.name, v) }
          else if (f.type === 'password' && !v) return
          else if (f.name === 'signin_code' && !v) return
          else if (f.type === 'checkboxes' && Array.isArray(v)) body.append(f.name, JSON.stringify(v))
          else if (Array.isArray(v)) { v.forEach((x) => body.append(f.name, x)) }
          else if (v !== '' && v != null) body.append(f.name, v)
        })
      } else {
        body = {}
        cfg.fields.forEach((f) => {
          const v = values[f.name]
          if (f.type === 'file') return
          if (f.type === 'password' && !v) return
          if (f.name === 'signin_code' && !v) return
          body[f.name] = v === '' && (f.type === 'date' || f.type === 'select' || f.type === 'time' || f.type === 'number') ? null : v
        })
      }
      const url = editing ? `${cfg.endpoint}${record.id}/` : cfg.endpoint
      const res = await api({ method: editing ? 'patch' : 'post', url, data: body })
      onSaved(res.data)
    } catch (err) {
      setErrors(fieldErrors(err)); setMsg(errorMessage(err))
    } finally { setSaving(false) }
  }

  return (
    <Modal title={`${editing ? 'Edit' : 'New'} ${cfg.singular || cfg.title.toLowerCase()}`} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <Alert>{msg}</Alert>
        {cfg.fields.map((f) => <Field key={f.name} f={f} value={values[f.name]} error={errors[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />)}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Generic list + create/edit page driven by a config object (see resources.js).
 * cfg: {title, endpoint, columns, fields, readOnly, removeLabel, filters, search, ordering, rowActions(row, reload)}
 */
export default function ResourcePage({ cfg, embedded }) {
  const [sp, setSp] = useSearchParams()
  const [rows, setRows] = useState([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState(embedded ? '' : sp.get('q') || '')
  const [filters, setFilters] = useState({})
  const [state, setState] = useState({ loading: true, error: '' })
  const [form, setForm] = useState(null)
  const [notice, setNotice] = useState('')
  const [noticeKind, setNoticeKind] = useState('info')
  const pageSize = 25

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [selectAllMatching, setSelectAllMatching] = useState(false)
  const [bulkModal, setBulkModal] = useState(null) // 'archive' | 'restore' | 'delete' | null
  const [bulkReason, setBulkReason] = useState('')
  const [bulkConfirmPhrase, setBulkConfirmPhrase] = useState('')
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [bulkError, setBulkError] = useState('')

  const isArchivedView = filters.is_archived === 'true' || cfg.recycleBin

  const load = useCallback(() => {
    setState({ loading: true, error: '' })
    const params = {
      page,
      page_size: pageSize,
      ...(search ? { search } : {}),
      ...(cfg.ordering ? { ordering: cfg.ordering } : {}),
      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')),
      ...(cfg.params || {})
    }
    return api.get(cfg.endpoint, { params })
      .then((r) => {
        setRows(items(r.data))
        setCount(Array.isArray(r.data) ? r.data.length : r.data.count)
        setState({ loading: false, error: '' })
      })
      .catch((e) => setState({ loading: false, error: errorMessage(e) }))
  }, [cfg, page, search, filters])

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  // Clear selection whenever search, filter, or page changes to prevent accidental operations
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    setSelectAllMatching(false)
  }, [])

  const handleFilterChange = (name, val) => {
    setFilters((s) => ({ ...s, [name]: val }))
    setPage(1)
    clearSelection()
  }

  const handleSearchChange = (val) => {
    setSearch(val)
    setPage(1)
    clearSelection()
    if (!embedded) setSp(val ? { q: val } : {})
  }

  const selectedCount = selectAllMatching ? count : selectedIds.size

  const allPageSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id))

  const toggleAllPage = () => {
    if (allPageSelected) {
      setSelectedIds((s) => {
        const next = new Set(s)
        rows.forEach((r) => next.delete(r.id))
        return next
      })
      setSelectAllMatching(false)
    } else {
      setSelectedIds((s) => {
        const next = new Set(s)
        rows.forEach((r) => next.add(r.id))
        return next
      })
    }
  }

  const toggleOne = (id) => {
    setSelectedIds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setSelectAllMatching(false)
  }

  // Single row actions
  const remove = async (row) => {
    if (!window.confirm(`${cfg.removeLabel || 'Archive'} this record?`)) return
    try {
      await api.delete(`${cfg.endpoint}${row.id}/`)
      setNoticeKind('success')
      setNotice(`${cfg.removeLabel || 'Archived'} successfully.`)
      clearSelection()
      load()
    } catch (e) {
      setNoticeKind('error')
      setNotice(errorMessage(e))
    }
  }

  const restore = async (row) => {
    try {
      await api.post(`${cfg.endpoint}${row.id}/restore/`)
      setNoticeKind('success')
      setNotice('Record restored successfully.')
      clearSelection()
      load()
    } catch (e) {
      setNoticeKind('error')
      setNotice(errorMessage(e))
    }
  }

  const permanentlyDelete = async (row) => {
    if (row.role === 'ADMIN') {
      alert('Administrator accounts cannot be permanently deleted.')
      return
    }
    const phrase = window.prompt(
      `Permanent deletion cannot be undone. To permanently delete this record, type DELETE PERMANENTLY below:`
    )
    if (phrase !== 'DELETE PERMANENTLY') {
      if (phrase !== null) alert('Deletion cancelled: confirmation phrase did not match.')
      return
    }
    try {
      await api.delete(`${cfg.endpoint}${row.id}/permanent-delete/`)
      setNoticeKind('success')
      setNotice('Record permanently deleted.')
      clearSelection()
      load()
    } catch (e) {
      setNoticeKind('error')
      setNotice(errorMessage(e))
    }
  }

  // Bulk actions executor
  const executeBulkAction = async () => {
    setBulkProcessing(true)
    setBulkError('')
    const ids = Array.from(selectedIds)

    try {
      if (bulkModal === 'archive') {
        const res = await api.post(`${cfg.endpoint}bulk_archive/`, {
          ids,
          select_all_matching: selectAllMatching,
          reason: bulkReason
        })
        setNoticeKind('success')
        setNotice(res.data.message || `Archived ${res.data.archived_count || ids.length} record(s).`)
      } else if (bulkModal === 'restore') {
        const res = await api.post(`${cfg.endpoint}bulk_restore/`, {
          ids,
          select_all_matching: selectAllMatching
        })
        setNoticeKind('success')
        setNotice(res.data.message || `Restored ${res.data.restored_count || ids.length} record(s).`)
      } else if (bulkModal === 'delete') {
        const res = await api.post(`${cfg.endpoint}bulk-permanent-delete/`, {
          ids,
          confirmation_phrase: bulkConfirmPhrase,
          reason: bulkReason
        })
        if (res.data.blocked_count > 0) {
          setNoticeKind('warning')
          setNotice(
            `Permanently deleted ${res.data.deleted_count} record(s). ${res.data.blocked_count} record(s) could not be deleted because linked academic/attendance records must be retained.`
          )
        } else {
          setNoticeKind('success')
          setNotice(res.data.message || `Permanently deleted ${res.data.deleted_count} record(s).`)
        }
      }
      setBulkModal(null)
      clearSelection()
      load()
    } catch (err) {
      setBulkError(errorMessage(err))
    } finally {
      setBulkProcessing(false)
    }
  }

  // Build columns with checkbox if enabled
  const bulkCol = (cfg.enableBulkSelect && !cfg.readOnly) ? [{
    key: '_sel',
    label: (
      <input
        type="checkbox"
        checked={allPageSelected}
        onChange={toggleAllPage}
        aria-label="Select all on this page"
      />
    ),
    render: (r) => (
      <input
        type="checkbox"
        checked={selectedIds.has(r.id)}
        onChange={() => toggleOne(r.id)}
        aria-label={`Select ${r.full_name || r.name || r.id}`}
      />
    )
  }] : []

  const actionCol = (cfg.readOnly && !cfg.rowActions && !cfg.recycleBin) ? [] : [{
    key: '_a',
    label: '',
    render: (r) => (
      <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
        {cfg.rowActions?.(r, load)}
        {cfg.recycleBin && (
          <>
            <button className="btn sm" onClick={() => restore(r)}>Restore</button>
            {r.role !== 'ADMIN' && <button className="btn sm danger" onClick={() => permanentlyDelete(r)}>Delete permanently</button>}
          </>
        )}
        {!cfg.readOnly && !cfg.recycleBin && isArchivedView && (
          <>
            <button className="btn sm success" onClick={() => restore(r)}>Restore</button>
            {cfg.canPermanentDelete && r.role !== 'ADMIN' && (
              <button className="btn sm danger" title="Delete permanently" onClick={() => permanentlyDelete(r)}>Delete</button>
            )}
          </>
        )}
        {!cfg.readOnly && !cfg.recycleBin && !isArchivedView && (
          <>
            <button className="btn sm" onClick={() => setForm(r)}>Edit</button>
            {!cfg.noRemove && (
              <button className="btn sm danger" onClick={() => remove(r)}>{cfg.removeLabel || 'Archive'}</button>
            )}
            {cfg.canPermanentDelete && r.role !== 'ADMIN' && (
              <button className="btn sm danger" title="Delete permanently" onClick={() => permanentlyDelete(r)}>Delete</button>
            )}
          </>
        )}
      </div>
    )
  }]

  const columns = [...bulkCol, ...cfg.columns, ...actionCol]

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{cfg.title}</h2>
        <div className="row">
          {cfg.search !== false && (
            <input
              className="input"
              style={{ width: 220 }}
              placeholder="Search…"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              aria-label={`Search ${cfg.title}`}
            />
          )}
          {(cfg.filters || []).map((f) => (
            <FilterSelect
              key={f.name}
              filter={f}
              value={filters[f.name]}
              onChange={(val) => handleFilterChange(f.name, val)}
            />
          ))}
          {!cfg.readOnly && <button className="btn primary" onClick={() => setForm({})}>+ New</button>}
        </div>
      </div>

      {notice && (
        <div style={{ marginBottom: 12 }}>
          <Alert kind={noticeKind}>{notice}</Alert>
        </div>
      )}

      {/* Select all matching banner across pagination */}
      {cfg.enableBulkSelect && allPageSelected && count > rows.length && (
        <div
          className="row spread"
          style={{
            background: 'var(--surface-raised, #f0f4f8)',
            padding: '8px 16px',
            borderRadius: 8,
            marginBottom: 10,
            fontSize: 13,
            border: '1px solid var(--border)'
          }}
        >
          {selectAllMatching ? (
            <span>All <b>{count}</b> matching {cfg.title.toLowerCase()} across all pages are selected.</span>
          ) : (
            <span>All <b>{rows.length}</b> records on this page are selected.</span>
          )}
          <button
            className="btn sm"
            type="button"
            onClick={() => setSelectAllMatching((s) => !s)}
          >
            {selectAllMatching ? 'Select current page only' : `Select all ${count} matching ${cfg.title.toLowerCase()}`}
          </button>
        </div>
      )}

      {/* Accessible Floating/Sticky Bulk Toolbar */}
      {selectedCount > 0 && (
        <div
          className="row spread"
          style={{
            position: 'sticky',
            top: 60,
            zIndex: 10,
            background: 'var(--surface)',
            padding: '10px 16px',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
            marginBottom: 12
          }}
          role="region"
          aria-label="Bulk actions toolbar"
        >
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <span className="badge primary" style={{ fontSize: 13, padding: '4px 10px' }}>
              {selectedCount} selected
            </span>
            <button className="btn sm" type="button" onClick={clearSelection}>
              Clear selection
            </button>
          </div>

          <div className="row" style={{ gap: 8 }}>
            {isArchivedView ? (
              <button
                className="btn sm success"
                type="button"
                onClick={() => {
                  setBulkReason('')
                  setBulkError('')
                  setBulkModal('restore')
                }}
              >
                Restore selected ({selectedCount})
              </button>
            ) : (
              <button
                className="btn sm warning"
                type="button"
                onClick={() => {
                  setBulkReason('')
                  setBulkError('')
                  setBulkModal('archive')
                }}
              >
                {cfg.removeLabel || 'Archive'} selected ({selectedCount})
              </button>
            )}

            {cfg.canPermanentDelete && (
              <button
                className="btn sm danger"
                type="button"
                onClick={() => {
                  setBulkConfirmPhrase('')
                  setBulkReason('')
                  setBulkError('')
                  setBulkModal('delete')
                }}
              >
                Delete permanently ({selectedCount})
              </button>
            )}
          </div>
        </div>
      )}

      {state.loading && !rows.length ? (
        <Skeleton rows={6} />
      ) : state.error ? (
        <ErrorState message={state.error} onRetry={load} />
      ) : !rows.length ? (
        <Empty title={`No ${cfg.title.toLowerCase()} found`}>
          {search ? 'Try a different search.' : cfg.readOnly ? 'Records will appear here once they exist.' : 'Use “New” to add the first one.'}
        </Empty>
      ) : (
        <Table columns={columns} rows={rows} />
      )}

      {count > pageSize && (
        <div className="row spread" style={{ marginTop: 12 }}>
          <span className="muted">{count} records</span>
          <div className="row">
            <button className="btn sm" disabled={page <= 1} onClick={() => { setPage(page - 1); clearSelection() }}>
              Previous
            </button>
            <span>Page {page} of {Math.ceil(count / pageSize)}</span>
            <button className="btn sm" disabled={page * pageSize >= count} onClick={() => { setPage(page + 1); clearSelection() }}>
              Next
            </button>
          </div>
        </div>
      )}

      {/* Form Modal (Create / Edit) */}
      {form && (
        <FormModal
          cfg={cfg}
          record={form.id ? form : null}
          onClose={() => setForm(null)}
          onSaved={(savedData) => {
            const isEditing = Boolean(form.id)
            setForm(null)
            const nameLabel = savedData?.full_name || savedData?.name || ''
            if (cfg.singular === 'student') {
              const streamInfo = savedData?.stream_label ? ` (${savedData.stream_label})` : ''
              setNoticeKind('success')
              setNotice(`Student ${nameLabel}${streamInfo} ${isEditing ? 'updated' : 'registered'} successfully.`)
            } else if (cfg.singular === 'teacher') {
              setNoticeKind('success')
              if (savedData?.signin_code) {
                setNotice(`Teacher ${nameLabel} ${isEditing ? 'updated' : 'registered'} successfully. Teacher sign-in code: ${savedData.signin_code} — please share this code with the teacher.`)
              } else {
                setNotice(`Teacher ${nameLabel} ${isEditing ? 'updated' : 'registered'} successfully.`)
              }
            } else {
              setNoticeKind('success')
              setNotice(`${cfg.singular ? cfg.singular.charAt(0).toUpperCase() + cfg.singular.slice(1) : 'Record'} ${isEditing ? 'updated' : 'saved'} successfully.`)
            }
            load()
          }}
        />
      )}

      {/* Bulk Action Confirmation Modals */}
      {bulkModal === 'archive' && (
        <Modal title={`Archive ${selectedCount} ${cfg.singular || 'record'}(s)`} onClose={() => setBulkModal(null)}>
          <div className="stack" style={{ gap: 14 }}>
            {bulkError && <Alert kind="error">{bulkError}</Alert>}
            <p>
              Are you sure you want to archive <b>{selectedCount}</b> {cfg.title.toLowerCase()}?
              Archived records are hidden from active lists, but their full academic history, attendance, and audit records remain intact and can be restored at any time.
            </p>
            <div className="field">
              <label htmlFor="bulk-archive-reason">Reason for archiving (optional)</label>
              <input
                id="bulk-archive-reason"
                className="input"
                placeholder="e.g. Graduated, Transferred, Completed term..."
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
              />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <button type="button" className="btn" onClick={() => setBulkModal(null)} disabled={bulkProcessing}>
                Cancel
              </button>
              <button
                type="button"
                className="btn warning"
                onClick={executeBulkAction}
                disabled={bulkProcessing}
              >
                {bulkProcessing ? 'Archiving…' : `Confirm Archive (${selectedCount})`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {bulkModal === 'restore' && (
        <Modal title={`Restore ${selectedCount} ${cfg.singular || 'record'}(s)`} onClose={() => setBulkModal(null)}>
          <div className="stack" style={{ gap: 14 }}>
            {bulkError && <Alert kind="error">{bulkError}</Alert>}
            <p>
              Are you sure you want to restore <b>{selectedCount}</b> {cfg.title.toLowerCase()} back to active status?
            </p>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <button type="button" className="btn" onClick={() => setBulkModal(null)} disabled={bulkProcessing}>
                Cancel
              </button>
              <button
                type="button"
                className="btn success"
                onClick={executeBulkAction}
                disabled={bulkProcessing}
              >
                {bulkProcessing ? 'Restoring…' : `Confirm Restore (${selectedCount})`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {bulkModal === 'delete' && (
        <Modal title="⚠️ Confirm Permanent Deletion" onClose={() => setBulkModal(null)}>
          <div className="stack" style={{ gap: 14 }}>
            <Alert kind="error">
              <b>High-Risk Permanent Deletion</b>
              <br />
              This action will completely delete eligible records from the database. It cannot be undone.
              <br /><br />
              <b>Safety Safeguards:</b> Any records with linked academic marks, assessment results, or attendance sessions cannot be deleted and will be protected automatically.
            </Alert>

            {bulkError && <Alert kind="error">{bulkError}</Alert>}

            <p>
              You have selected <b>{selectedCount}</b> {cfg.title.toLowerCase()} for permanent deletion.
            </p>

            <div className="field">
              <label htmlFor="bulk-delete-confirm">
                To proceed, type <b>DELETE PERMANENTLY</b> below: *
              </label>
              <input
                id="bulk-delete-confirm"
                className="input"
                placeholder="DELETE PERMANENTLY"
                value={bulkConfirmPhrase}
                onChange={(e) => setBulkConfirmPhrase(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="field">
              <label htmlFor="bulk-delete-reason">Reason for deletion (audited)</label>
              <input
                id="bulk-delete-reason"
                className="input"
                placeholder="e.g. Duplicate test record created in error..."
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
              />
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <button type="button" className="btn" onClick={() => setBulkModal(null)} disabled={bulkProcessing}>
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={executeBulkAction}
                disabled={bulkProcessing || bulkConfirmPhrase !== 'DELETE PERMANENTLY'}
              >
                {bulkProcessing ? 'Deleting…' : `Permanently Delete (${selectedCount})`}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}
