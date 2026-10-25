'use client'

/**
 * Browser side of hearing reminders, status alerts and new-post alerts (see
 * public/sw.js and app/api/notification_routes.py). No account: the push
 * subscription is the identity, so a reader can follow a bill or the blog
 * without signing in.
 */

export type PushSupport = 'supported' | 'unsupported' | 'needs-install'

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  // iOS only allows web push for sites added to the Home Screen.
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (iOS && !standalone) return 'needs-install'
  return hasApis ? 'supported' : 'unsupported'
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/')
  return existing ?? navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

let keyPromise: Promise<string | null> | null = null

/** The server's VAPID key, or null when alerts are switched off. Fetched once. */
export function serverKey(): Promise<string | null> {
  keyPromise ??= fetch('/api/notifications/vapid-public-key')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => d?.key ?? null)
    .catch(() => null)
  return keyPromise
}

/** The current subscription, or null. Never prompts. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'supported') return null
  const reg = await navigator.serviceWorker.getRegistration('/')
  return reg ? reg.pushManager.getSubscription() : null
}

/** This device's push subscription, created (prompting for permission) if needed. */
async function subscribeDevice(): Promise<PushSubscription | 'denied'> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const reg = await registration()
  await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    const key = await serverKey()
    if (!key) throw new Error('Notifications are not set up yet')
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
  }
  return sub
}

/** Subscribe (prompting for permission if needed) and follow one bill. */
export async function followBill(billId: string): Promise<'on' | 'denied'> {
  const sub = await subscribeDevice()
  if (sub === 'denied') return 'denied'
  const res = await fetch('/api/notifications/watch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), bill_id: billId }),
  })
  if (!res.ok) throw new Error(`watch failed (${res.status})`)
  return 'on'
}

export async function unfollowBill(billId: string): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await fetch('/api/notifications/unwatch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint, bill_id: billId }),
  })
}

export async function isFollowing(billId: string): Promise<boolean> {
  const sub = await currentSubscription()
  if (!sub) return false
  const res = await fetch('/api/notifications/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint, bill_id: billId }),
  })
  return res.ok ? Boolean((await res.json()).watching) : false
}

/**
 * Subscribe and get one alert per new blog post. `known` is every post the
 * reader can already see, so the first alert is the next post, not this one.
 */
export async function followBlog(known: string[]): Promise<'on' | 'denied'> {
  const sub = await subscribeDevice()
  if (sub === 'denied') return 'denied'
  const res = await fetch('/api/notifications/blog/follow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), known }),
  })
  if (!res.ok) throw new Error(`blog follow failed (${res.status})`)
  return 'on'
}

export async function unfollowBlog(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await fetch('/api/notifications/blog/unfollow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  })
}

export async function isFollowingBlog(): Promise<boolean> {
  const sub = await currentSubscription()
  if (!sub) return false
  const res = await fetch('/api/notifications/blog/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  })
  return res.ok ? Boolean((await res.json()).following) : false
}
