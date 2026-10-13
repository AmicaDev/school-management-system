import axios from 'axios'

const BASE = import.meta.env.PROD ? '/api/v1' : (import.meta.env.VITE_API_BASE_URL || '/api/v1')
const KEY = 'sms.tokens'

export const tokens = {
  get: () => { try { return JSON.parse(localStorage.getItem(KEY)) || null } catch { return null } },
  set: (t) => localStorage.setItem(KEY, JSON.stringify(t)),
  clear: () => localStorage.removeItem(KEY),
}

export const api = axios.create({ baseURL: BASE, timeout: 60000 })

api.interceptors.request.use((cfg) => {
  const t = tokens.get()
  if (t?.access) cfg.headers.Authorization = `Bearer ${t.access}`
  return cfg
})

let refreshing = null
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const { response, config } = error
    if (response?.status === 503 && response.data?.maintenance && !location.pathname.startsWith('/maintenance')) {
      location.assign('/maintenance')
    }
    const isAuthCall = config?.url?.includes('/auth/login') || config?.url?.includes('/auth/refresh')
    if (response?.status === 401 && !config._retry && !isAuthCall && tokens.get()?.refresh) {
      config._retry = true
      try {
        refreshing = refreshing || axios.post(`${BASE}/auth/refresh/`, { refresh: tokens.get().refresh }).finally(() => { refreshing = null })
        const { data } = await refreshing
        tokens.set({ access: data.access, refresh: data.refresh || tokens.get().refresh })
        config.headers.Authorization = `Bearer ${data.access}`
        return api(config)
      } catch {
        tokens.clear()
        window.dispatchEvent(new Event('sms:logout'))
      }
    }
    return Promise.reject(error)
  },
)

/** DRF returns either an array or a paginated {results} object. */
export const items = (data) => (Array.isArray(data) ? data : data?.results || [])

export function errorMessage(e, fallback = 'Something went wrong. Please try again.') {
  if (!e?.response) {
    if (e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT') return 'The server took too long to respond. It may be starting up; please try again.'
    return 'Cannot reach the server. Check your connection and try again.'
  }
  const d = e.response.data
  if (typeof d === 'string') return /<!doctype html|<html[\s>]/i.test(d) ? (e.response.status === 404 ? 'The requested data could not be found.' : `The server returned an unexpected page (HTTP ${e.response.status}).`) : d.slice(0, 200)
  if (d?.detail) return String(d.detail)
  if (d && typeof d === 'object') {
    const first = Object.entries(d)[0]
    if (first) return `${first[0] === 'non_field_errors' ? '' : first[0] + ': '}${[].concat(first[1]).join(' ')}`
  }
  return fallback
}

export function fieldErrors(e) {
  const d = e?.response?.data
  if (!d || typeof d !== 'object' || e.response.status !== 400) return {}
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, [].concat(v).join(' ')]))
}

/** Fire-and-forget crash/sync report. Never includes tokens or form data. */
export function reportClientError(message, { source = 'react', level = 'ERROR', stack = '', module = '', endpoint = '' } = {}) {
  try {
    fetch(`${BASE}/developer/client-errors/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ source, level, message: String(message).slice(0, 500), stack: String(stack).slice(0, 4000), module, endpoint }),
    }).catch(() => {})
  } catch { /* reporting must never throw */ }
}

export async function downloadFile(url, filename) {
  const res = await api.get(url, { responseType: 'blob' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(res.data)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
export const mediaUrl = (path) => (path ? (path.startsWith('http') ? path : `${BASE.replace(/\/api\/v1\/?$/, '')}${path}`) : null)
