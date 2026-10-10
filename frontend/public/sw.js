/* Service worker: offline shell + runtime caching. Bump VERSION to force clients to update. */
const VERSION = 'sms-v1.0.0'
const SHELL = `${VERSION}-shell`
const RUNTIME = `${VERSION}-runtime`
const API_CACHE = `${VERSION}-api`
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png']
// Read-only API data that is safe to serve stale when offline (never auth, never developer, never writes).
const CACHEABLE_API = /\/api\/v1\/(academics|timetable|events|notifications|students|attendance\/sheet|results\/(grid|summary|trend))/

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)))
})

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET') return

  if (url.pathname.includes('/api/')) {
    if (!CACHEABLE_API.test(url.pathname)) return
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(API_CACHE).then((c) => c.put(req, copy)) }
          return res
        })
        .catch(() => caches.match(req).then((hit) => hit || new Response(JSON.stringify({ detail: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))),
    )
    return
  }
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')))
    return
  }
  // static assets: stale-while-revalidate
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(RUNTIME).then((c) => c.put(req, copy)) }
        return res
      }).catch(() => hit)
      return hit || net
    }),
  )
})
