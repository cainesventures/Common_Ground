'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { api } from '@/lib/api'
import { getCityConfig } from '@/lib/city'

function useLastFetched() {
  const [date, setDate] = useState<string | null>(null)
  useEffect(() => {
    api.getInsightsSummary()
      .then((d) => {
        if (d?.last_fetched_at) {
          const parsed = new Date(d.last_fetched_at)
          setDate(parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))
        }
      })
      .catch(() => {})
  }, [])
  return date
}

export function Footer() {
  const lastFetched = useLastFetched()
  const pathname = usePathname()
  const citySlug = pathname.split('/')[1]
  const p = getCityConfig(citySlug) ? `/${citySlug}` : ''

  return (
    <footer className="border-t mt-16 bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-sm">Open Common Ground</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Philadelphia City Council bill tracker — free, independent, no ads.
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Personal project by{' '}
              <a
                href="https://www.linkedin.com/in/andrewcaines"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground transition-colors"
              >
                Andrew Caines
              </a>
              {' '}· Caines Ventures LLC · Not affiliated with the City of Philadelphia
            </p>
          </div>
          <nav className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <Link href={`${p}/legislation`} className="hover:text-foreground transition-colors">Legislation</Link>
            <Link href={`${p}/councilmembers`} className="hover:text-foreground transition-colors">Council</Link>
            <Link href={`${p}/insights`} className="hover:text-foreground transition-colors">Insights</Link>
            <Link href="/about" className="hover:text-foreground transition-colors">About</Link>
            <Link href="/donate" className="hover:text-foreground transition-colors">Donate</Link>
            <Link href="/legal" className="hover:text-foreground transition-colors">Legal &amp; Disclaimer</Link>
          </nav>
        </div>

        <div className="flex items-center gap-4 mt-4">
          <a
            href="https://www.linkedin.com/in/andrewcaines"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="LinkedIn"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
            </svg>
          </a>
          <a
            href="https://bsky.app/profile/opencommonground.bsky.social"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Bluesky"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.689-.139-1.861-.902-2.204-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/>
            </svg>
          </a>
        </div>

        <p className="text-xs text-muted-foreground mt-6">
          AI-generated content is for informational purposes only and does not constitute legal or political advice.
          Data sourced from <a href="https://phila.legistar.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">Philadelphia Legistar</a>.
          Not affiliated with Philadelphia City Council or any government agency.
        </p>
        <div className="flex items-center justify-between flex-wrap gap-2 mt-1">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Open Common Ground · Caines Ventures LLC
          </p>
          {lastFetched && (
            <p className="text-xs text-muted-foreground">
              Data last updated {lastFetched}
            </p>
          )}
        </div>
      </div>
    </footer>
  )
}
