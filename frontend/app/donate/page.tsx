'use client'

import { useState } from 'react'
import { api } from '@/lib/api'

const AMOUNTS = [5, 10, 20, 50, 100]
const MIN = 1
const MAX = 10_000

function parseCustomAmount(raw: string): number | null {
  // Strip anything that isn't a digit
  const digits = raw.replace(/[^0-9]/g, '')
  if (!digits) return null
  const n = parseInt(digits, 10)
  if (isNaN(n) || n < MIN || n > MAX) return null
  return n
}

export default function DonatePage() {
  const [selected, setSelected] = useState<number>(10)
  const [isCustom, setIsCustom] = useState(false)
  const [customRaw, setCustomRaw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const customAmount = parseCustomAmount(customRaw)
  const effectiveAmount = isCustom ? customAmount : selected
  const customInvalid = isCustom && customRaw !== '' && customAmount === null

  const handleCustomInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only allow digit characters
    const sanitized = e.target.value.replace(/[^0-9]/g, '').slice(0, 6)
    setCustomRaw(sanitized)
  }

  const handleDonate = async () => {
    if (!effectiveAmount) return
    setLoading(true)
    setError(null)
    try {
      const data = await api.createCheckout(effectiveAmount)
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
              onClick={() => { setSelected(amt); setIsCustom(false) }}
              className={`btn-primary-hover px-5 py-2.5 rounded-lg border text-sm font-semibold transition-all ${
                !isCustom && selected === amt
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border'
              }`}
            >
              ${amt}
            </button>
          ))}
          <button
            onClick={() => setIsCustom(true)}
            className={`btn-primary-hover px-5 py-2.5 rounded-lg border text-sm font-semibold transition-all ${
              isCustom
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border'
            }`}
          >
            Other
          </button>
        </div>

        {isCustom && (
          <div className="mt-3">
            <div className="relative w-40">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0"
                value={customRaw}
                onChange={handleCustomInput}
                autoFocus
                className={`w-full pl-7 pr-3 py-2 rounded-lg border text-sm ${
                  customInvalid ? 'border-red-400 bg-red-50' : 'border-border bg-background'
                } focus:outline-none focus:ring-2 focus:ring-primary/40`}
              />
            </div>
            {customInvalid && (
              <p className="text-xs text-red-600 mt-1">Enter a whole number between ${MIN} and ${MAX.toLocaleString()}.</p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 mb-4 border border-red-200 bg-red-50 rounded-md px-4 py-2">
          {error}
        </p>
      )}

      <button
        onClick={handleDonate}
        disabled={loading || !effectiveAmount}
        className="btn-primary-hover w-full h-12 rounded-lg bg-primary text-primary-foreground font-semibold text-base transition-all disabled:opacity-60"
      >
        {loading ? 'Redirecting to Stripe…' : `Donate $${effectiveAmount ?? '—'}`}
      </button>

      <p className="text-xs text-muted-foreground text-center mt-4">
        Secure payment via Stripe. We never store your card details.
        This is a one-time donation — no recurring charges.
      </p>
    </div>
  )
}
