// Service Worker cho fb-ads-tool PWA.
// Mục tiêu:
//   1. Cache static assets (CSS/JS Next.js, icons) → mở app offline / khi mạng chậm.
//   2. Network-first cho API + page → luôn data tươi, fallback cache khi mất mạng.
//   3. Push notification handler (Web Push) — show notification + click → mở app.
//
// Phiên bản: tăng CACHE_VERSION khi cần invalidate cache cũ.
const CACHE_VERSION = 'v1'
const STATIC_CACHE = `fb-ads-static-${CACHE_VERSION}`
const RUNTIME_CACHE = `fb-ads-runtime-${CACHE_VERSION}`

// Files cài đặt sẵn (mở app offline không trắng tinh).
const PRECACHE_URLS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())  // active ngay, không chờ tab cũ đóng
  )
})

// Xoá cache cũ khi deploy phiên bản mới.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== STATIC_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  )
})

// Fetch strategy:
// - API + dynamic page: network-first, fallback cache (cho offline xem report cũ).
// - Static asset (_next/static, /icon-*, etc.): cache-first.
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return  // POST/PUT bỏ qua, không cache.

  const url = new URL(request.url)
  // Skip cross-origin (Facebook Graph, Shopee, etc.).
  if (url.origin !== self.location.origin) return

  // API: network-first.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request))
    return
  }

  // Static (Next.js bundle, icons): cache-first.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icon-') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/apple-touch-icon.png' ||
    url.pathname === '/favicon-32.png'
  ) {
    event.respondWith(cacheFirst(request))
    return
  }

  // Page HTML: network-first, fallback cache offline.
  event.respondWith(networkFirst(request))
})

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached
  const fresh = await fetch(request)
  if (fresh.ok) cache.put(request, fresh.clone()).catch(() => {})
  return fresh
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE)
  try {
    const fresh = await fetch(request)
    if (fresh.ok) cache.put(request, fresh.clone()).catch(() => {})
    return fresh
  } catch (_) {
    const cached = await cache.match(request)
    if (cached) return cached
    // Không có cache → trả response lỗi.
    return new Response('Offline — chưa có cache cho trang này', { status: 503, headers: { 'Content-Type': 'text/plain;charset=utf-8' } })
  }
}

// === PUSH NOTIFICATION ===
// Khi server gửi push (web-push) → hiện notification.
self.addEventListener('push', (event) => {
  let data = { title: 'FB Ads Manager', body: 'Bạn có thông báo mới', url: '/' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch (_) {
    try { data.body = event.data.text() } catch {}
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'default',
      data: { url: data.url || '/' },
      requireInteraction: !!data.requireInteraction,
      vibrate: [200, 100, 200],
    })
  )
})

// Click notification → mở app (focus tab cũ nếu đã mở, không thì mở mới).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus()
          if ('navigate' in client) client.navigate(targetUrl)
          return
        }
      }
      return self.clients.openWindow(targetUrl)
    })
  )
})
