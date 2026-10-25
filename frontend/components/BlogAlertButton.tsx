'use client'

import { useEffect, useState } from 'react'
import { Bell, BellRing, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { usePostHog } from 'posthog-js/react'
import {
  followBlog,
  isFollowingBlog,
  pushSupport,
  serverKey,
  unfollowBlog,
  type PushSupport,
} from '@/lib/push'

/**
 * "Notify me of new posts" for the blog: one notification when a post goes
 * live. Same device subscription and rules as the bill bell (NotifyButton): no
 * sign-in, hidden where web push is unavailable, a Home Screen hint on iPhone.
 * `known` is every post slug the page shows, so turning it on never announces a
 * post the reader can already see.
 */
export function BlogAlertButton({ known, className = '' }: { known: string[]; className?: string }) {
  const posthog = usePostHog()
  const [support, setSupport] = useState<PushSupport>('unsupported')
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const s = pushSupport()
    if (s === 'unsupported') return
    // Stay hidden while alerts are switched off on the server.
    serverKey().then((key) => {
      if (!key) return
      setSupport(s)
      if (s === 'supported') isFollowingBlog().then(setOn).catch(() => {})
    })
  }, [])

  if (support === 'unsupported') return null

  const toggle = async () => {
    if (support === 'needs-install') {
      toast.info('On iPhone, tap Share, then "Add to Home Screen", and open the site from there to turn on alerts.')
      return
    }
    setBusy(true)
    try {
      if (on) {
        await unfollowBlog()
        setOn(false)
        toast.success('Alerts off for new posts.')
      } else {
        const r = await followBlog(known)
        if (r === 'denied') {
          toast.error('Notifications are blocked for this site. Allow them in your browser settings to get alerts.')
        } else {
          setOn(true)
          toast.success('You will get a notification when the next post goes up.')
          posthog?.capture('blog_alerts_on')
        }
      }
    } catch {
      toast.error('Could not turn on alerts. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const Icon = busy ? Loader2 : on ? BellRing : Bell
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      aria-label={on ? 'Stop alerts for new posts' : 'Get a notification when a new post goes up'}
      title={on ? 'Alerts on: tap to stop' : 'Get a notification when a new post goes up'}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
        on
          ? 'border-primary text-primary bg-primary/5'
          : 'text-muted-foreground hover:text-primary hover:border-primary/40'
      } ${className}`}
    >
      <Icon className={`w-4 h-4 ${busy ? 'animate-spin' : on ? 'anim-pop' : ''}`} aria-hidden="true" />
      <span>{on ? 'Alerts on for new posts' : 'Notify me of new posts'}</span>
    </button>
  )
}
