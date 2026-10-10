// Minimal promise wrapper over IndexedDB. Stores: queue (pending operations), drafts (local auto-save), cache (rosters).
const NAME = 'sms-offline'
const STORES = ['queue', 'drafts', 'cache']
let dbp

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, 1)
      req.onupgradeneeded = () => STORES.forEach((s) => req.result.createObjectStore(s, { keyPath: s === 'queue' ? 'id' : 'key' }))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbp
}

async function tx(store, mode, fn) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const r = fn(t.objectStore(store))
    t.oncomplete = () => resolve(r?.result)
    t.onerror = () => reject(t.error)
  })
}

export const dbPut = (store, value) => tx(store, 'readwrite', (s) => s.put(value))
export const dbGet = (store, key) => tx(store, 'readonly', (s) => s.get(key))
export const dbAll = (store) => tx(store, 'readonly', (s) => s.getAll())
export const dbDel = (store, key) => tx(store, 'readwrite', (s) => s.delete(key))
export const idbAvailable = () => typeof indexedDB !== 'undefined'
