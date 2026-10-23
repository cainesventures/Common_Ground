'use client'

import { useState } from 'react'
import { usePostHog } from 'posthog-js/react'
import { ImageDown, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Shares the 9:16 "Both Sides" card from ./story as an image.
 *
 * On phones this opens the native share sheet with the PNG attached, so it
 * goes straight into an Instagram story or a group chat, the places a link
 * preview does not travel. Where the browser cannot share files (most
 * desktops) it downloads the image instead.
 */
export function ShareStoryButton({
  billId,
  billNumber,
  label = 'Share both sides as an image',
}: {
  billId: string
  billNumber?: string | null
  label?: string
}) {
  const posthog = usePostHog()
  const [busy, setBusy] = useState(false)

  const share = async () => {
    setBusy(true)
    try {
      // The card route sits under the bill page's own path, whatever the city.
      const base = window.location.pathname.replace(/\/$/, '')
      const res = await fetch(`${base}/story`)
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const name = `both-sides-${billNumber || billId}.png`
      const file = new File([blob], name, { type: 'image/png' })

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Both sides of a Philadelphia bill', url: window.location.href })
        posthog?.capture('story_card_shared', { bill_id: billId, method: 'native' })
      } else {
        const url = URL.createObjectURL(blob)
        const a = Object.assign(document.createElement('a'), { href: url, download: name })
        a.click()
        URL.revokeObjectURL(url)
        toast.success('Image saved. Post it anywhere.')
        posthog?.capture('story_card_shared', { bill_id: billId, method: 'download' })
      }
    } catch (e) {
      // Cancelling the share sheet rejects with AbortError: not a failure.
      if ((e as Error)?.name !== 'AbortError') toast.error('Could not make the image. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={share}
      disabled={busy}
      className="inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ImageDown className="w-4 h-4" aria-hidden="true" />}
      {busy ? 'Making image…' : label}
    </button>
  )
}
