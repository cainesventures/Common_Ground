'use client'

import { useEffect, useState } from 'react'
import { Bell, BellRing, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { usePostHog } from 'posthog-js/react'
import { followBill, isFollowing, pushSupport, unfollowBill, type PushSupport } from '@/lib/push'

/**
 * "Notify me" for one bill: a reminder the day before a hearing, and an alert
 * when the bill changes status. No sign-in. Hidden on browsers that cannot
 * do web push; on an iPhone it explains the Home Screen requirement instead.
 */
export function NotifyButton({ billId, compact = false }: { billId: string; compact?: boolean }) {
  const posthog = usePostHog()
  const [support, setSupport] = useState<PushSupport>('unsupported')
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const s = pushSupport()
    setSupport(s)
    if (s === 'supported') isFollowing(billId).then(setOn).catch(() => {})
  }, [billId])

  if (support === 'unsupported') return null

  const toggle = async () => {
    if (support === 'needs-install') {
      toast.info('On iPhone, tap Share, then "Add to Home Screen", and open the site from there to turn on alerts.')
      return
    }
    setBusy(true)
    try {
      if (on) {
        await unfollowBill(billId)
        setOn(false)
        toast.success('Alerts off for this bill.')
      } else {
        const r = await followBill(billId)
        if (r === 'denied') {
          toast.error('Notifications are blocked for this site. Allow them in your browser settings to get alerts.')
        } else {
          setOn(true)
          toast.success('You will get a reminder before hearings and an alert when this bill moves.')
          posthog?.capture('bill_alerts_on', { bill_id: billId })
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
      aria-label={on ? 'Stop alerts for this bill' : 'Get alerts for hearings and status changes on this bill'}
      title={on ? 'Alerts on: tap to stop' : 'Remind me before hearings and tell me when this bill moves'}
      className={`inline-flex items-center gap-1.5 rounded-lg border transition-colors disabled:opacity-60 ${
        compact ? 'p-1.5' : 'px-3 py-1.5 text-sm font-medium'
      } ${on ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-muted-foreground hover:text-primary hover:border-muted'}`}
    >
      <Icon className={`w-5 h-5 ${busy ? 'animate-spin' : on ? 'anim-pop' : ''}`} aria-hidden="true" />
      {!compact && <span>{on ? 'Alerts on' : 'Notify me'}</span>}
    </button>
  )
}
