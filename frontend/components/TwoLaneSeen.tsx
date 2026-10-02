'use client'

import { useEffect, useRef } from 'react'
import { usePostHog } from 'posthog-js/react'

/**
 * Fires `two_lane_viewed` once when the arguments actually reach the screen.
 *
 * The pivot away from the personas rests on a claim that has to be checked:
 * that people did not read them because they sat behind a tab and an
 * accordion, not because they did not want them. The evidence for the first
 * half is PostHog -- over 120 days, 100 `bill_viewed` and three
 * `perspective_opened` from one person. The second half needs a comparable
 * number from the new design, and `bill_viewed` alone cannot give one.
 *
 * So this measures scrolling past the arguments, not opening them: there is
 * nothing to open. Against `bill_viewed` it answers "of the people who opened
 * a bill, how many read as far as the end of both cases", which is the honest
 * comparison to three events from one person.
 *
 * It is a separate client island on purpose -- TwoLanePanel stays a server
 * component so its text is in the server-rendered HTML for crawlers, which was
 * the point of putting it above the tab bar.
 */
export function TwoLaneSeen({ billId }: { billId: string }) {
  const posthog = usePostHog()
  const ref = useRef<HTMLSpanElement>(null)
  const fired = useRef(false)

  useEffect(() => {
    const el = ref.current
    // IntersectionObserver is absent in older browsers and in some test
    // environments. No event is better than a crash in the bill page.
    if (!el || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || fired.current) continue
          fired.current = true
          posthog?.capture('two_lane_viewed', { bill_id: billId })
          observer.disconnect()
        }
      },
      // The sentinel sits at the END of the panel, so this fires when the
      // reader has scrolled past both arguments rather than when the heading
      // clips the bottom of the viewport. A threshold on the sentinel itself
      // would be meaningless -- it is one pixel tall; its position is what
      // carries the meaning.
      { threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [billId, posthog])

  return <span ref={ref} aria-hidden="true" className="block h-px w-full" />
}
