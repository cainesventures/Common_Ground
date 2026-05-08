'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'

const IMPACT: Record<number, string> = {
  5:   'Funds AI analysis for ~5 City Council bills',
  10:  'Keeps Open Common Ground running for a week',
  20:  'Generates perspectives on a full batch of new bills',
  50:  'Covers a month of hosting and data costs',
  100: 'Keeps the project independent and ad-free for a month',
}

function getImpact(amount: number): string {
  const tiers = [100, 50, 20, 10, 5]
  for (const t of tiers) {
    if (amount >= t) return IMPACT[t]
  }
  return 'Supports civic transparency in Philadelphia'
}

function SuccessContent() {
  const params = useSearchParams()
  const sessionId = params.get('session_id')
  const [amount, setAmount] = useState<number | null>(null)
  const [loading, setLoading] = useState(!!sessionId)

  useEffect(() => {
    if (!sessionId) return
    api.getDonationSession(sessionId)
      .then((data) => { if (data?.amount_usd) setAmount(data.amount_usd) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [sessionId])

  const shareText = `I just supported Open Common Ground — a free civic tool that tracks every Philadelphia City Council bill in plain English. Check it out:`
  const shareUrl = typeof window !== 'undefined' ? window.location.origin : 'https://opencommonground.com'

  return (
    <div className="max-w-lg mx-auto py-16 px-4 text-center">

      {/* Icon */}
      <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-6">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>

      {/* Headline */}
      <h1 className="text-3xl font-extrabold tracking-tight mb-3">
        {loading ? 'Processing…' : amount ? `Thank you for your $${amount} donation!` : 'Thank you for your support!'}
      </h1>

      {/* Impact line */}
      {!loading && (
        <p className="text-muted-foreground text-base leading-relaxed mb-8 max-w-sm mx-auto">
          {amount
            ? `${getImpact(amount)}. Every contribution keeps Open Common Ground free and independent for all Philadelphians.`
            : 'Your contribution keeps Open Common Ground free and independent for all Philadelphians.'}
        </p>
      )}

      {/* Share prompt */}
      <div className="border rounded-xl px-6 py-5 mb-8 text-left space-y-3">
        <p className="text-sm font-semibold">Help spread the word</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Most Philadelphians don&apos;t know this tool exists. Sharing it is as valuable as donating.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <a
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            Share on X
          </a>
          <a
            href={`https://bsky.app/intent/compose?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.689-.139-1.861-.902-2.204-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/>
            </svg>
            Share on Bluesky
          </a>
        </div>
      </div>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          href="/philadelphia/legislation"
          className="px-7 py-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-base transition-colors shadow-md"
        >
          Browse the bills →
        </Link>
        <Link
          href="/donate"
          className="px-6 py-3 rounded-lg border text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          Donate again
        </Link>
      </div>

      <p className="text-xs text-muted-foreground mt-8">
        A receipt has been sent to your email by Stripe. Questions? Email us at{' '}
        <a href="mailto:hello@opencommonground.com" className="underline hover:text-foreground">hello@opencommonground.com</a>.
      </p>
    </div>
  )
}

export default function DonateSuccessPage() {
  return (
    <Suspense fallback={<div className="max-w-lg mx-auto py-16 px-4 text-center text-muted-foreground">Loading…</div>}>
      <SuccessContent />
    </Suspense>
  )
}
