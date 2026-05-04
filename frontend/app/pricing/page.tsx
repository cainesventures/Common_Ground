import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Pricing — Open Common Ground',
  description: 'Open Common Ground is free forever, supported by donations.',
}

export default function PricingPage() {
  return (
    <div className="max-w-lg mx-auto py-12 px-4 space-y-10">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Free forever</h1>
        <p className="text-muted-foreground">
          Open Common Ground is and will always be free. No subscriptions, no paywalls, no ads.
        </p>
      </div>

      <div className="rounded-xl border p-8 space-y-6">
        <div>
          <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Everything included</div>
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-bold">$0</span>
            <span className="text-sm text-muted-foreground">/ forever</span>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Every feature, every bill, every perspective — free for every Philadelphian.
          </p>
        </div>

        <ul className="space-y-2">
          {[
            'Browse and search all City Council bills',
            'AI summaries in plain English',
            '17 political perspectives per bill',
            'Impact scores and analysis',
            'Sponsor and committee insights',
            'Vote on legislation (sign-in required)',
            'Save and track bills you care about',
            'Insights dashboard — 26 years of data',
          ].map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm">
              <span className="text-green-500 shrink-0 mt-0.5">✓</span>
              {f}
            </li>
          ))}
        </ul>

        <Link
          href="/"
          className="block w-full text-center py-3 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
        >
          Start exploring →
        </Link>
      </div>

      <div className="rounded-xl border border-dashed p-6 space-y-3 text-center">
        <p className="text-sm font-semibold">Keep it running</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The site runs on donations. If it&apos;s useful to you, consider contributing a few dollars
          to cover AI analysis costs and hosting.
        </p>
        <Link
          href="/donate"
          className="inline-block px-6 py-2.5 rounded-lg border text-sm font-semibold hover:bg-muted/50 transition-colors"
        >
          Donate to support the project
        </Link>
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Questions?{' '}
        <a href="mailto:hello@opencommonground.com" className="underline hover:no-underline">
          hello@opencommonground.com
        </a>
      </p>
    </div>
  )
}
