'use client'

import { useEffect, useState, useRef, useCallback, RefObject } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import { startGoogleSignIn } from '@/lib/auth'
import { BillCard, type BillCardBill } from '@/components/BillCard'

/**
 * Tracks prefers-reduced-motion. CSS handles the keyframes (see globals.css),
 * but the two carousels on this page advance on a timer, and no media query can
 * stop a setInterval — so they read this and simply do not auto-advance.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

function useInView(ref: RefObject<HTMLElement | null>, threshold = 0.15) {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); observer.disconnect() }
    }, { threshold })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, threshold])
  return inView
}

interface SpotlightItem {
  id: string
  headline: string
  lede: string
  bill_number: string
  case_for: string
  case_against: string
}

const FEATURES = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
    title: 'Plain English',
    body: 'Legal titles like "An Ordinance amending Chapter 9-1100…" become "Zoning change near the Navy Yard." No law degree required.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
    title: 'Both Sides, Argued',
    body: 'When a bill still before Council carries a real decision, you get the strongest honest case for it and the strongest honest case against it, side by side, with every figure checked against the bill text. Routine housekeeping is marked as routine rather than argued into a fight it does not have.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
    title: 'Your Council Members',
    body: 'Full profiles for all 17 council members — voting record, sponsored bills, district map, and direct contact info so you can make your voice heard.',
  },
]

// STEPS replaced by inline JSX below

// ── Liberty Bell silhouette ───────────────────────────────────────────────────
function LibertyBell({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 340" fill="currentColor" className={className} aria-hidden="true">
      {/* Yoke / crown — top mounting bar */}
      <rect x="90" y="10" width="120" height="18" rx="4" />
      {/* Yoke arms */}
      <rect x="108" y="28" width="16" height="28" rx="3" />
      <rect x="176" y="28" width="16" height="28" rx="3" />
      {/* Shoulder / top of bell */}
      <path d="M100 56 Q150 44 200 56 L210 90 Q150 78 90 90 Z" />
      {/* Bell body */}
      <path d="M90 90 Q60 140 55 200 Q50 250 70 270 L230 270 Q250 250 245 200 Q240 140 210 90 Q150 78 90 90 Z" />
      {/* Waist band / sound bow at bottom */}
      <path d="M70 270 Q150 285 230 270 L235 285 Q150 302 65 285 Z" />
      {/* The famous crack */}
      <path d="M152 100 Q149 130 154 160 Q157 185 151 210" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" opacity="0.5" />
      {/* Clapper */}
      <line x1="150" y1="90" x2="150" y2="190" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.35" />
      <ellipse cx="150" cy="198" rx="9" ry="11" opacity="0.35" />
      {/* Inscription band */}
      <path d="M82 180 Q150 167 218 180" fill="none" stroke="currentColor" strokeWidth="6" opacity="0.12" />
    </svg>
  )
}

// ── Both Sides Slideshow ───────────────────────────────────────────────────────
// Was a persona carousel: one bill, then a nested index stepping through up to
// 17 perspectives. It is now one bill showing both cases at once, which drops
// the inner index entirely and shows a visitor the thing the site actually
// leads with. The endpoint behind it now returns only active bills whose
// arguments passed the grounding checks, so the section heading -- "What's
// being decided right now" -- is finally true; it used to serve any bill with
// perspectives, which are overwhelmingly on concluded ones.
function BothSidesSlideshow({ items }: { items: SpotlightItem[] }) {
  const { city } = useParams<{ city: string }>()
  const [billIdx, setBillIdx] = useState(0)
  const [fading, setFading] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const pausedRef = useRef(false)
  const billIdxRef = useRef(billIdx)
  const reducedMotion = usePrefersReducedMotion()
  // Hover-pause alone is unreachable by keyboard and touch, so autoplay also
  // needs a real control. This is the explicit one; pausedRef stays for hover.
  const [paused, setPaused] = useState(false)

  useEffect(() => { billIdxRef.current = billIdx }, [billIdx])

  const goToBill = useCallback((next: number) => {
    setFading(true)
    setTimeout(() => {
      setBillIdx(next)
      setFading(false)
    }, 250)
  }, [])

  const nextBill = useCallback(() => {
    goToBill((billIdxRef.current + 1) % items.length)
  }, [items.length, goToBill])

  useEffect(() => {
    if (items.length === 0) return
    // Never auto-advance when the visitor asked for reduced motion, or when
    // they paused it — they can still step through with the arrows and dots.
    if (reducedMotion || paused) return
    // Slower than the old 10s: a visitor now has two arguments to read on each
    // slide instead of one quoted sentence.
    intervalRef.current = setInterval(() => {
      if (pausedRef.current) return
      goToBill((billIdxRef.current + 1) % items.length)
    }, 14000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [items, goToBill, reducedMotion, paused])

  if (items.length === 0) return null

  const bill = items[billIdx]
  const lanes = [
    { key: 'for', label: 'The case for', text: bill.case_for, accent: 'border-emerald-400/40' },
    { key: 'against', label: 'The case against', text: bill.case_against, accent: 'border-rose-400/40' },
  ]

  return (
    <div
      className="bg-gradient-to-br from-slate-900 to-slate-800 dark:from-slate-950 dark:to-slate-900 rounded-2xl overflow-hidden"
      onMouseEnter={() => { pausedRef.current = true }}
      onMouseLeave={() => { pausedRef.current = false }}
    >
      <div
        className="px-6 pt-8 pb-6 sm:px-10 sm:pt-10 transition-opacity duration-250"
        style={{ opacity: fading ? 0 : 1 }}
      >
        <p className="text-white/40 text-xs font-mono mb-2 uppercase tracking-wider">{bill.bill_number}</p>

        <Link href={`/${city}/legislation/${bill.id}`}>
          <h3 className="text-white text-xl sm:text-2xl font-bold leading-snug mb-3 max-w-2xl hover:text-white/80 transition-colors">
            {bill.headline}
          </h3>
        </Link>

        {bill.lede && (
          <p className="text-white/60 text-sm leading-relaxed mb-6 max-w-2xl">
            {bill.lede}
          </p>
        )}

        <div className="border-t border-white/10 pt-5 grid gap-5 sm:grid-cols-2">
          {lanes.map(({ key, label, text, accent }) => (
            <div key={key} className={`border-l-2 pl-4 ${accent}`}>
              <p className="text-white/40 text-xs uppercase tracking-widest font-semibold mb-2">{label}</p>
              <p className="text-white/70 text-sm leading-relaxed">{text}</p>
            </div>
          ))}
        </div>

        <p className="text-white/25 text-[11px] mt-5">
          AI-written arguments, checked against the bill text. Neither side is the site&apos;s position.
        </p>
      </div>

      {items.length > 1 && (
        <div className="flex items-center justify-between px-6 sm:px-10 py-3 border-t border-white/10">
          <button
            onClick={() => goToBill((billIdx - 1 + items.length) % items.length)}
            className="text-xs text-white/70 hover:text-white transition-colors flex items-center gap-1"
          >
            ← Prev bill
          </button>
          <div className="flex gap-1.5">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => goToBill(i)}
                aria-label={`Go to bill ${i + 1}`}
                className={`rounded-full transition-all ${i === billIdx ? 'w-5 h-1.5 bg-white/60' : 'w-1.5 h-1.5 bg-white/20 hover:bg-white/40'}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-3">
            {!reducedMotion && (
              <button
                onClick={() => setPaused((p) => !p)}
                aria-pressed={paused}
                aria-label={paused ? 'Resume automatic slideshow' : 'Pause automatic slideshow'}
                className="text-xs text-white/70 hover:text-white transition-colors"
              >
                {paused ? '▶ Play' : '❚❚ Pause'}
              </button>
            )}
            <button
              onClick={nextBill}
              className="text-xs text-white/70 hover:text-white transition-colors flex items-center gap-1"
            >
              Next bill →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const FOUNDERS_QUOTES = [
  { text: "Liberty cannot be preserved without general knowledge among the people.", author: "John Adams" },
  { text: "The cornerstone of democracy rests on the foundation of an educated electorate.", author: "Thomas Jefferson" },
  { text: "Knowledge will forever govern ignorance; and a people who mean to be their own governors must arm themselves with the power which knowledge gives.", author: "James Madison" },
  { text: "An investment in knowledge pays the best interest.", author: "Benjamin Franklin" },
]

function FoundersQuote() {
  const [idx, setIdx] = useState(0)
  const [visible, setVisible] = useState(true)
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    if (reducedMotion) return
    const interval = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIdx(i => (i + 1) % FOUNDERS_QUOTES.length)
        setVisible(true)
      }, 400)
    }, 30000)
    return () => clearInterval(interval)
  }, [reducedMotion])

  const quote = FOUNDERS_QUOTES[idx]
  return (
    <div className="max-w-xl mx-auto text-center px-8" style={{ minHeight: '4.5rem' }}>
      <div className="transition-opacity duration-400" style={{ opacity: visible ? 1 : 0 }}>
        <p className="text-sm text-muted-foreground/70 italic leading-relaxed">
          &ldquo;{quote.text}&rdquo;
        </p>
        <p className="text-xs font-medium text-muted-foreground/50 mt-1">— {quote.author}</p>
      </div>
    </div>
  )
}

/**
 * Turns the corpus's newest `analyzed_at` into the freshness line in the hero
 * pill.
 *
 * The pill read "Updated today" as a hardcoded string. Publishing is a manual
 * local pipeline, so that claim was false on every day it did not run — six
 * days stale at the time this was written, while the page insisted otherwise.
 * A site whose whole proposition is "here is what your Council is doing right
 * now" cannot afford to be caught lying about its own freshness, so this says
 * what is actually true, including when the answer is unflattering.
 */
function freshnessLabel(lastUpdated: string | null): string {
  if (!lastUpdated) return 'Updated regularly'
  const then = new Date(lastUpdated)
  if (Number.isNaN(then.getTime())) return 'Updated regularly'

  // Compare calendar days in local time, not elapsed hours: an update at 11pm
  // read back at 1am is "yesterday" to a reader, not "today".
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000)

  if (days <= 0) return 'Updated today'
  if (days === 1) return 'Updated yesterday'
  if (days < 7) return `Updated ${days} days ago`
  return `Updated ${then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

export default function CityLandingClient() {
  const router = useRouter()
  const { city } = useParams<{ city: string }>()
  const [recentBills, setRecentBills] = useState<BillCardBill[]>([])
  const [spotlight, setSpotlight] = useState<SpotlightItem[]>([])
  const [billCount, setBillCount] = useState<number | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [contentState, setContentState] = useState<'loading' | 'ready' | 'error'>('loading')

  const howItWorksRef = useRef<HTMLDivElement>(null)
  const featuresRef = useRef<HTMLDivElement>(null)
  const howInView = useInView(howItWorksRef)
  const featuresInView = useInView(featuresRef)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = searchQuery.trim()
    setSearching(true)
    // Keep the city prefix: a bare /legislation took a 308 redirect hop through
    // next.config.ts and dropped whichever city the visitor was browsing.
    const base = `/${city}/legislation`
    router.push(q ? `${base}?q=${encodeURIComponent(q)}` : base)
  }

  // On success this component unmounts, so this timer never matters. It only
  // fires when navigation stalled or failed and we are still on the landing
  // page — previously `searching` was set true and never cleared, leaving the
  // hero input permanently disabled with a reload as the only way out.
  useEffect(() => {
    if (!searching) return
    const t = setTimeout(() => setSearching(false), 5000)
    return () => clearTimeout(t)
  }, [searching])

  // Both content sections are gated on a non-empty array, so when these loads
  // failed silently the homepage degraded to a static brochure with no trace —
  // the slideshow and bill list simply vanished. Tracked together because they
  // fill one visual slot: if either succeeds we show what we have, and only a
  // total failure surfaces a message.
  const loadContent = useCallback(() => {
    setContentState('loading')

    // Try high-impact first, fall back to any analyzed bills
    const bills = api.searchLegislation('', 4, 0, 'local', 'true', '', 'high')
      .then((data) => {
        const results = data?.results ?? []
        if (results.length >= 2) {
          setRecentBills(results)
        } else {
          return api.searchLegislation('', 4, 0, 'local', 'true', '', '')
            .then((d) => setRecentBills(d?.results ?? []))
        }
      })

    const spot = api.getSpotlight(8).then((data) => setSpotlight(data?.results ?? []))

    Promise.allSettled([bills, spot]).then((results) => {
      setContentState(results.every((r) => r.status === 'rejected') ? 'error' : 'ready')
    })
  }, [])

  useEffect(() => {
    loadContent()
    // The hero pill degrades gracefully on its own — it just omits the count.
    //
    // This was getPipelineStats, which is behind require_dev_tier, so it 401'd
    // for everyone but the owner and the catch below hid it: every real
    // visitor saw the pill's fallback word "Free" where the bill count should
    // have been. getPublicStats needs no auth and also carries the freshness
    // date, which the pill previously hardcoded as "Updated today".
    api.getPublicStats()
      .then((data) => {
        setBillCount(data?.total ?? null)
        setLastUpdated(data?.last_updated ?? null)
      })
      .catch(() => {})
  }, [loadContent])

  return (
    <div className="space-y-20 pb-20">

      {/* ── Hero ── */}
      <section className="relative pt-12 pb-4 text-center max-w-3xl mx-auto overflow-hidden">
        <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-background to-transparent pointer-events-none" />

        <div className="relative z-10 anim-hero">
          <div className="inline-block bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-xs font-semibold px-3 py-1 rounded-full mb-5 border border-blue-200 dark:border-blue-700">
            Philadelphia City Council · {billCount ? `${billCount.toLocaleString()} bills tracked` : 'Free'} · {freshnessLabel(lastUpdated)}
          </div>
          <h1 className="type-display text-4xl sm:text-5xl mb-5">
            Your City Council is voting on bills right now.<br className="hidden sm:block" /> Do you know what&apos;s in them?
          </h1>
          <p className="type-body text-muted-foreground max-w-xl mx-auto mb-8">
            Every bill. Plain English. When a bill has a real decision in it, you get the strongest case for it and the strongest case against it — so you can follow along and make up your own mind.
          </p>
          <form onSubmit={handleSearch} className="relative max-w-lg mx-auto w-full mb-6">
            {searching ? (
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin pointer-events-none" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
              </svg>
            )}
            {/*
              No autoFocus here. It put focus mid-page on load, which jumped
              past the skip link (so the skip link was never the first Tab
              stop), scrolled the hero out of view on phones, and started a
              screen reader inside a form instead of at the top of the page.
            */}
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search bills by title, topic, or number…"
              aria-label="Search Philadelphia City Council bills"
              disabled={searching}
              className="w-full rounded-lg border border-input bg-background pl-10 pr-12 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={searching}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {searching ? '…' : 'Search'}
            </button>
          </form>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href={`/${city}/legislation?analyzed=true`}
              className="px-7 py-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-base transition-colors shadow-md hover:shadow-lg"
            >
              See what&apos;s on the agenda →
            </Link>
            <Link
              href={`/${city}/councilmembers`}
              className="px-6 py-3 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 font-medium text-base hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              Find your rep
            </Link>
          </div>
        </div>
      </section>

      {/* ── Founders Quote ── */}
      <FoundersQuote />

      {/* Placeholder for the two live sections below while they load / on failure */}
      {contentState === 'loading' && (
        <section className="max-w-3xl mx-auto space-y-3" aria-hidden="true">
          <div className="h-3 w-48 bg-muted rounded animate-pulse" />
          <div className="h-56 bg-muted rounded-xl animate-pulse" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
          ))}
        </section>
      )}

      {contentState === 'error' && (
        <section className="max-w-3xl mx-auto border rounded-xl px-6 py-8 text-center space-y-3">
          <p className="font-medium">We can&apos;t load today&apos;s bills right now.</p>
          <p className="text-sm text-muted-foreground">
            This is usually brief. Everything else on the site still works.
          </p>
          <div className="flex items-center justify-center gap-3 pt-1">
            <button
              onClick={loadContent}
              className="inline-flex items-center justify-center rounded-lg px-4 h-9 text-sm font-medium bg-primary text-primary-foreground btn-primary-hover"
            >
              Try again
            </button>
            <Link href={`/${city}/legislation`} className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4">
              Browse legislation
            </Link>
          </div>
        </section>
      )}

      {/* ── Both Sides Slideshow ── */}
      {spotlight.length > 0 && (
        <section className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="type-eyebrow text-muted-foreground">
              What&apos;s being decided right now
            </h2>
            <Link href={`/${city}/legislation?analyzed=true&status=introduced,in_committee`} className="text-sm text-primary hover:underline">
              Browse all bills →
            </Link>
          </div>
          <BothSidesSlideshow items={spotlight} />
        </section>
      )}

      {/* ── Live bill preview ── */}
      {recentBills.length > 0 && (
        <section className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="type-eyebrow text-muted-foreground">
              Bills in front of Council
            </h2>
            <Link href={`/${city}/legislation?analyzed=true`} className="text-sm text-primary hover:underline">
              See all →
            </Link>
          </div>
          <div className="flex flex-col gap-3 anim-fade-in">
            {recentBills.map((bill) => (
              <BillCard key={bill.id} bill={bill} showDate={true} citySlug={city} />
            ))}
          </div>
        </section>
      )}

      {/* ── Both sides callout ── */}
      <section className="max-w-3xl mx-auto border rounded-xl px-8 py-10 text-center bg-muted/30">
        <h2 className="type-section mb-3">
          One bill. Both sides. You decide.
        </h2>
        <p className="type-body-sm text-muted-foreground max-w-xl mx-auto mb-6">
          We don&apos;t tell you what to think. For a bill still moving through Council, we write the strongest honest case for it and the strongest honest case against it, argued only from what the bill actually says. Then you make up your own mind.
        </p>
        <p className="text-xs text-muted-foreground max-w-xl mx-auto mb-6">
          Not every bill gets an argument. A zoning map change or a parking rule is marked as routine instead, and a bill whose arguments cannot be grounded in its own text is left without one. Older bills also carry an archive of AI perspectives written from different political viewpoints.
        </p>
        <div className="flex flex-wrap justify-center gap-2 mb-8 text-xs">
          {['The case for', 'The case against', 'Every figure checked against the bill'].map((p) => (
            <span key={p} className="px-3 py-1 rounded-full border bg-background font-medium">{p}</span>
          ))}
        </div>
        <Link
          href={`/${city}/legislation?analyzed=true&status=introduced,in_committee`}
          className="btn-primary-hover inline-block px-5 py-2.5 rounded-lg border border-foreground bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90"
        >
          Read what&apos;s in play →
        </Link>
      </section>

      {/* ── How it works ── */}
      <section className="max-w-3xl mx-auto" ref={howItWorksRef}>
        <h2 className="type-eyebrow text-muted-foreground text-center mb-10">
          How it works
        </h2>
        <div className="grid sm:grid-cols-3 gap-6">

          {/* Step 1 — Before/after */}
          <div
            className={`anim-scroll border rounded-xl p-5 flex flex-col gap-4 ${howInView ? 'in-view' : ''}`}
            style={{ transitionDelay: '0ms' }}
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground font-bold text-xs flex items-center justify-center shrink-0">1</div>
              <p className="font-semibold text-sm">Every bill, every day</p>
            </div>
            <div className="space-y-2 text-xs">
              <div className="bg-muted/60 rounded p-2 text-muted-foreground line-through leading-snug">
                An Ordinance amending Title 14 of The Philadelphia Code, entitled &ldquo;Zoning and Planning,&rdquo; by…
              </div>
              <div className="flex items-center justify-center text-muted-foreground/40 text-base">↓</div>
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-2 text-green-800 dark:text-green-300 font-medium leading-snug">
                Zoning change near the Navy Yard — affects density limits for new housing
              </div>
            </div>
          </div>

          {/* Step 2 — Perspectives preview */}
          <div
            className={`anim-scroll border rounded-xl p-5 flex flex-col gap-4 ${howInView ? 'in-view' : ''}`}
            style={{ transitionDelay: '80ms' }}
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground font-bold text-xs flex items-center justify-center shrink-0">2</div>
              <p className="font-semibold text-sm">Both sides, argued</p>
            </div>
            <div className="space-y-2 text-xs">
              <div className="border-l-2 border-emerald-400 pl-2.5">
                <p className="font-semibold text-emerald-700 dark:text-emerald-400 mb-0.5">The case for</p>
                <p className="text-muted-foreground leading-snug">Protects tenants from a cost they cannot see coming, using a process the City already runs.</p>
              </div>
              <div className="border-l-2 border-rose-400 pl-2.5">
                <p className="font-semibold text-rose-700 dark:text-rose-400 mb-0.5">The case against</p>
                <p className="text-muted-foreground leading-snug">Shifts the enforcement burden onto the City, with no funding named to carry it.</p>
              </div>
              <p className="text-muted-foreground/50 pt-1">Every figure checked against the bill text.</p>
            </div>
          </div>

          {/* Step 3 — Take action */}
          <div
            className={`anim-scroll border rounded-xl p-5 flex flex-col gap-4 ${howInView ? 'in-view' : ''}`}
            style={{ transitionDelay: '160ms' }}
          >
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground font-bold text-xs flex items-center justify-center shrink-0">3</div>
              <p className="font-semibold text-sm">You decide, then act</p>
            </div>
            <div className="space-y-2 text-xs">
              <p className="text-muted-foreground leading-relaxed">Vote your position, save bills you care about, and contact your council member directly — all in one place.</p>
              <div className="flex flex-col gap-1.5 pt-1">
                <div className="flex items-center gap-2 text-muted-foreground"><span className="text-green-500">✓</span> Vote support / oppose</div>
                <div className="flex items-center gap-2 text-muted-foreground"><span className="text-green-500">✓</span> Save bills to your list</div>
                <div className="flex items-center gap-2 text-muted-foreground"><span className="text-green-500">✓</span> Contact your rep in one click</div>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ── Features ── */}
      <section className="max-w-4xl mx-auto" ref={featuresRef}>
        <h2 className="type-eyebrow text-muted-foreground text-center mb-10">
          What makes it different
        </h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className={`anim-scroll border rounded-xl px-6 py-6 ${featuresInView ? 'in-view' : ''}`}
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              <div className="text-primary mb-4">{f.icon}</div>
              <p className="font-bold text-base mb-2">{f.title}</p>
              <p className="type-body-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Go deeper: Budget + Blog ── */}
      <section className="max-w-4xl mx-auto">
        <h2 className="type-eyebrow text-muted-foreground text-center mb-10">
          Go deeper
        </h2>
        <div className="grid sm:grid-cols-2 gap-6">
          {/* Budget Explorer */}
          <Link href="/budget" className="group border rounded-xl p-6 flex flex-col gap-3 hover:border-foreground/30 transition-colors">
            <div className="text-primary">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
              </svg>
            </div>
            <p className="font-bold text-base group-hover:underline underline-offset-4">Budget Explorer</p>
            <p className="type-body-sm text-muted-foreground">
              Where does the money actually go? Explore 25 years of Philadelphia&apos;s budget — every
              department and fund, adjusted for inflation or per resident. The General Fund grew from $2.8B
              to nearly $7B; see what that bought.
            </p>
            <span className="text-sm text-primary mt-auto">Explore the budget →</span>
          </Link>
          {/* Blog */}
          <Link href="/blog" className="group border rounded-xl p-6 flex flex-col gap-3 hover:border-foreground/30 transition-colors">
            <div className="text-primary">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
            </div>
            <p className="font-bold text-base group-hover:underline underline-offset-4">The Blog</p>
            <p className="type-body-sm text-muted-foreground">
              Opinionated deep dives into the data — what the bills and budgets actually reveal about the
              city, grounded in the public record. No comment section, just the analysis.
            </p>
            <span className="text-sm text-primary mt-auto">Read the latest →</span>
          </Link>
        </div>
      </section>

      {/* ── Mission ── */}
      <section className="max-w-2xl mx-auto text-center">
        <h2 className="type-section mb-4">Built for Philadelphians, by Philadelphians</h2>
        <p className="type-body-sm text-muted-foreground mb-4">
          City Council passes hundreds of bills every year — zoning changes that reshape your block in East Kensington, tax breaks that shift the burden onto renters in West Philly, public safety measures that affect every neighborhood from Roxborough to Point Breeze. Most residents never find out until it&apos;s already law.
        </p>
        <p className="type-body-sm text-muted-foreground mb-8">
          Open Common Ground is a free, independent civic tool with no ads, no corporate backing, and no political agenda. We just want Philly residents to know what their council is doing.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={startGoogleSignIn}
            className="px-7 py-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-base transition-colors shadow-md hover:shadow-lg"
          >
            Join free →
          </button>
          <Link
            href="/donate"
            className="px-6 py-3 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 font-medium text-base hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            Support the project
          </Link>
        </div>
      </section>

    </div>
  )
}
