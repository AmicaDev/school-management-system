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
          body[f.name] = v === '' && (f.type === 'date' || f.type === 'select' || f.type === 'time' || f.type === 'number') ? null : v
        })
      }
      const url = editing ? `${cfg.endpoint}${record.id}/` : cfg.endpoint
      await api({ method: editing ? 'patch' : 'post', url, data: body })
      onSaved()
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
  const pageSize = 25

  const load = useCallback(() => {
    setState({ loading: true, error: '' })
    const params = { page, page_size: pageSize, ...(search ? { search } : {}), ...(cfg.ordering ? { ordering: cfg.ordering } : {}), ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')), ...(cfg.params || {}) }
    return api.get(cfg.endpoint, { params })
      .then((r) => { setRows(items(r.data)); setCount(Array.isArray(r.data) ? r.data.length : r.data.count); setState({ loading: false, error: '' }) })
      .catch((e) => setState({ loading: false, error: errorMessage(e) }))
  }, [cfg, page, search, filters])

  useEffect(() => { const t = setTimeout(load, search ? 250 : 0); return () => clearTimeout(t) }, [load, search])

  const remove = async (row) => {
    if (!window.confirm(`${cfg.removeLabel || 'Archive'} this record?`)) return
    try { await api.delete(`${cfg.endpoint}${row.id}/`); setNotice(`${cfg.removeLabel || 'Archived'} successfully.`); load() } catch (e) { setNotice(errorMessage(e)) }
  }

  const restore = async (row) => {
    try { await api.post(`${cfg.endpoint}${row.id}/restore/`); setNotice('Record restored.'); load() } catch (e) { setNotice(errorMessage(e)) }
  }

  const permanentlyDelete = async (row) => {
    if (!window.confirm(`Permanently delete this ${cfg.singular || cfg.title.toLowerCase().replace(/s$/, '')}? This cannot be undone.`)) return
    try {
      await api.delete(`${cfg.endpoint}${row.id}/permanent-delete/`)
      setNotice('Record permanently deleted.')
      load()
    } catch (e) { setNotice(errorMessage(e)) }
  }

  const columns = [...cfg.columns, ...(cfg.readOnly && !cfg.rowActions && !cfg.recycleBin ? [] : [{ key: '_a', label: '', render: (r) => (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      {cfg.rowActions?.(r, load)}
      {cfg.recycleBin && <>
        <button className="btn sm" onClick={() => restore(r)}>Restore</button>
        <button className="btn sm danger" onClick={() => permanentlyDelete(r)}>Delete permanently</button>
      </>}
      {!cfg.readOnly && <button className="btn sm" onClick={() => setForm(r)}>Edit</button>}
      {!cfg.readOnly && !cfg.noRemove && <button className="btn sm danger" onClick={() => remove(r)}>{cfg.removeLabel || 'Archive'}</button>}
    </div>) }])]

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{cfg.title}</h2>
        <div className="row">
          {cfg.search !== false && <input className="input" style={{ width: 220 }} placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); if (!embedded) setSp(e.target.value ? { q: e.target.value } : {}) }} aria-label={`Search ${cfg.title}`} />}
          {(cfg.filters || []).map((f) => (
            <select key={f.name} className="input" style={{ width: 'auto' }} value={filters[f.name] ?? ''} aria-label={f.label} onChange={(e) => { setFilters((s) => ({ ...s, [f.name]: e.target.value })); setPage(1) }}>
              <option value="">{f.label}</option>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          ))}
          {!cfg.readOnly && <button className="btn primary" onClick={() => setForm({})}>+ New</button>}
        </div>
      </div>
      <Alert kind="info">{notice}</Alert>
      {state.loading && !rows.length ? <Skeleton rows={6} />
        : state.error ? <ErrorState message={state.error} onRetry={load} />
          : !rows.length ? <Empty title={`No ${cfg.title.toLowerCase()} found`}>{search ? 'Try a different search.' : cfg.readOnly ? 'Records will appear here once they exist.' : 'Use “New” to add the first one.'}</Empty>
            : <Table columns={columns} rows={rows} />}
      {count > pageSize && (
        <div className="row spread" style={{ marginTop: 12 }}>
          <span className="muted">{count} records</span>
          <div className="row"><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {Math.ceil(count / pageSize)}</span><button className="btn sm" disabled={page * pageSize >= count} onClick={() => setPage(page + 1)}>Next</button></div>
        </div>
      )}
      {form && <FormModal cfg={cfg} record={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); setNotice('Saved.'); load() }} />}
    </section>
  )
}
