/*
 * Service worker for hearing reminders and bill status alerts.
 *
 * Push and notification clicks only. It deliberately has no fetch handler and
 * caches nothing, so it can never serve a stale page or interfere with the
 * site's normal loading.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Open Common Ground', {
      body: data.body || '',
      icon: '/apple-icon.png',
      badge: '/apple-icon.png',
      tag: data.tag,            // a newer alert for the same bill replaces the old one
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data && event.notification.data.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = tabs.find((t) => t.url === url)
    if (open) return open.focus()
    return self.clients.openWindow(url)
  })())
})
