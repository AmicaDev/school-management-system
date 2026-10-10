import { api, errorMessage, reportClientError, uuid } from '../services/api'
import { dbAll, dbDel, dbPut } from './db'

const listeners = new Set()
export const onQueueChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
const emit = (evt) => listeners.forEach((fn) => fn(evt))

/** Every queued operation carries its own client_txn_id; the server ignores a transaction it has already processed. */
export async function enqueue(kind, url, payload, label = '') {
  const id = payload.client_txn_id || uuid()
  await dbPut('queue', { id, kind, url, label, payload: { ...payload, client_txn_id: id }, state: 'pending', createdAt: Date.now(), error: '' })
  emit({ type: 'changed' })
  return id
}

export const queued = () => dbAll('queue').then((all) => all.sort((a, b) => a.createdAt - b.createdAt))

export async function retryFailed() {
  for (const q of await queued()) if (q.state === 'failed') await dbPut('queue', { ...q, state: 'pending', error: '' })
  emit({ type: 'changed' })
}
export async function discard(id) { await dbDel('queue', id); emit({ type: 'changed' }) }

let running = false
/** Sends pending operations one at a time, in order. Returns {sent, failed, stopped}. */
export async function flush() {
  if (running) return { sent: 0, failed: 0, stopped: false }
  running = true
  let sent = 0, failed = 0, stopped = false
  try {
    emit({ type: 'start' })
    for (const q of await queued()) {
      if (q.state !== 'pending') continue
      try {
        await api.post(q.url, q.payload)
        await dbDel('queue', q.id)
        sent += 1
      } catch (e) {
        const status = e.response?.status
        if (!e.response || status === 401 || status >= 500) { stopped = true; break } // try again later
        failed += 1
        await dbPut('queue', { ...q, state: 'failed', error: errorMessage(e) })
        reportClientError(`Offline sync rejected (${status}) for ${q.kind}`, { source: 'sync', module: q.kind, endpoint: q.url })
      }
    }
  } finally {
    running = false
    emit({ type: 'end', sent, failed, stopped })
  }
  return { sent, failed, stopped }
}
