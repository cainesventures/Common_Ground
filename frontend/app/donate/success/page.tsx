'use client'

import Link from 'next/link'

export default function DonateSuccessPage() {
  return (
    <div className="max-w-md mx-auto py-20 px-4 text-center space-y-6">
      <div className="text-5xl">🙏</div>
      <h1 className="text-2xl font-bold tracking-tight">Thank you!</h1>
      <p className="text-muted-foreground leading-relaxed">
        Your donation helps keep Common Ground free and independent for all Philadelphians.
        We appreciate your support.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
        <Link
          href="/"
          className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Browse legislation
        </Link>
        <Link
          href="/donate"
          className="px-5 py-2.5 rounded-lg border text-sm font-medium hover:bg-muted/40 transition-colors"
        >
          Donate again
        </Link>
      </div>
    </div>
  )
}
