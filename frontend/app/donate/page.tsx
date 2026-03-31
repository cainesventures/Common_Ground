'use client'

import { useState } from 'react'
import { api } from '@/lib/api'

const AMOUNTS = [5, 10, 20, 50, 100]

export default function DonatePage() {
  const [selected, setSelected] = useState(10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDonate = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.createCheckout(selected)
      if (data?.url) {
        window.location.href = data.url
      } else {
        setError('Could not start checkout. Please try again.')
      }
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto py-12 px-4">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold tracking-tight mb-3">Support Common Ground</h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          Common Ground is a free, open civic tool for Philadelphia residents. Your donation keeps
          it running — covering AI analysis costs, hosting, and development.
        </p>
      </div>

      {/* What your donation does */}
      <div className="border rounded-lg px-5 py-4 mb-8 space-y-2">
        <p className="text-sm font-semibold mb-3">What your support funds</p>
        {[
          ['$5', 'Analyzes ~5 City Council bills with AI perspectives'],
          ['$10', 'Keeps the site running for a week'],
          ['$20', 'Generates perspectives on a full batch of new bills'],
          ['$50', 'Covers a month of hosting and data costs'],
          ['$100', 'Keeps the project independent and ad-free for a month'],
        ].map(([amt, desc]) => (
          <div key={amt} className="flex gap-2 text-sm">
            <span className="font-mono font-semibold text-primary w-10 shrink-0">{amt}</span>
            <span className="text-muted-foreground">{desc}</span>
          </div>
        ))}
      </div>

      {/* Amount picker */}
      <div className="mb-6">
        <p className="text-sm font-medium mb-3">Choose an amount</p>
        <div className="flex gap-2 flex-wrap">
          {AMOUNTS.map((amt) => (
            <button
              key={amt}
              onClick={() => setSelected(amt)}
              className={`px-5 py-2.5 rounded-lg border text-sm font-semibold transition-all ${
                selected === amt
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background hover:bg-muted/40 border-border'
              }`}
            >
              ${amt}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-4 border border-red-200 bg-red-50 rounded-md px-4 py-2">
          {error}
        </p>
      )}

      <button
        onClick={handleDonate}
        disabled={loading}
        className="w-full h-12 rounded-lg bg-primary text-primary-foreground font-semibold text-base hover:bg-primary/90 transition-colors disabled:opacity-60"
      >
        {loading ? 'Redirecting to Stripe…' : `Donate $${selected}`}
      </button>

      <p className="text-xs text-muted-foreground text-center mt-4">
        Secure payment via Stripe. We never store your card details.
        This is a one-time donation — no recurring charges.
      </p>
    </div>
  )
}
