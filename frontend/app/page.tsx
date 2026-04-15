'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import { BillCard, type BillCardBill } from '@/components/BillCard'

const FEATURES = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
    title: 'Plain English',
    body: 'Legal titles like "An Ordinance amending Chapter 9-1100…" become "Zoning change near the Navy Yard." No law degree required.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
    title: '17 Perspectives',
    body: 'Every bill gets viewpoints from 17 distinct lenses — progressive, conservative, working class, business owner, urban planner, and more. See who wins and who loses.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
    title: 'Impact Scoring',
    body: 'Not every bill is equal. Each one is rated on how broadly it affects daily life in Philadelphia — so you know what\'s actually worth your attention.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
      </svg>
    ),
    title: 'In the News',
    body: 'Related news articles surfaced automatically for each bill — see how local media is covering the legislation and what reporters are missing.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
    title: 'Council Members',
    body: 'Full profiles for all 17 council members — voting record, sponsored bills, district map, contact info. See exactly what your rep is doing.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
      </svg>
    ),
    title: 'Save & Follow',
    body: 'Bookmark the bills that matter to you. Get a weekly email digest of new legislation with AI perspectives — free, no spam, unsubscribe anytime.',
  },
]

const STEPS = [
  {
    number: '1',
    title: 'Every bill, every day',
    body: 'New legislation introduced to Philadelphia City Council is pulled automatically from the city\'s Legistar system. Nothing slips through.',
  },
  {
    number: '2',
    title: 'Plain English, instantly',
    body: 'AI rewrites each bill with a clear title, plain-language summary, impact score, and category tags so you can understand it at a glance.',
  },
  {
    number: '3',
    title: '17 takes, zero spin',
    body: 'The bill is analyzed from 17 political, policy, and demographic viewpoints — each one honest about who benefits and who doesn\'t.',
  },
]

// ── Philadelphia City Hall silhouette ─────────────────────────────────────────
// Simplified architectural silhouette used as a decorative hero element.
// Key features: main block, corner pavilions, central tower, William Penn.
function CityHallSilhouette({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 280" fill="currentColor" className={className} aria-hidden="true">
      {/* Base steps */}
      <rect x="20" y="270" width="360" height="10" />
      <rect x="34" y="262" width="332" height="8" />

      {/* Corner pavilions — slightly taller than main block */}
      <rect x="44" y="152" width="62" height="110" />
      <rect x="294" y="152" width="62" height="110" />

      {/* Main building block */}
      <rect x="50" y="168" width="300" height="94" />

      {/* Tower lower base */}
      <rect x="144" y="118" width="112" height="144" />

      {/* Tower middle */}
      <rect x="158" y="96" width="84" height="26" />

      {/* Tower upper */}
      <rect x="168" y="74" width="64" height="26" />

      {/* Cupola */}
      <rect x="176" y="56" width="48" height="22" rx="2" />

      {/* Lantern */}
      <rect x="186" y="42" width="28" height="16" rx="1" />

      {/* Finial */}
      <rect x="198" y="28" width="4" height="16" />

      {/* William Penn — head + body */}
      <ellipse cx="200" cy="20" rx="5" ry="6" />
      <path d="M196 26 Q200 24 204 26 L205 37 Q200 35 195 37 Z" />

      {/* Clock suggestion on tower */}
      <circle cx="200" cy="108" r="13" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />

      {/* Windows — left pavilion */}
      <rect x="56" y="176" width="12" height="18" rx="1.5" opacity="0.25" />
      <rect x="76" y="176" width="12" height="18" rx="1.5" opacity="0.25" />
      <rect x="56" y="206" width="12" height="18" rx="1.5" opacity="0.25" />
      <rect x="76" y="206" width="12" height="18" rx="1.5" opacity="0.25" />

      {/* Windows — center main block */}
      <rect x="168" y="180" width="12" height="18" rx="1.5" opacity="0.25" />
      <rect x="188" y="180" width="12" height="18" rx="1.5" opacity="0.25" />
      <rect x="208" y="180" width="12" height="18" rx="1.5" opacity="0.25" />
      <rect x="228" y="180" width="12" height="18" rx="1.5" opacity="0.25" />
      <rect x="168" y="208" width="12" height="18" rx="1.5" opacity="0.25" />
      <rect x="188" y="208" width="12" height="18" rx="1.5" opacity="0.25" />
      <rect x="208" y="208" width="12" height="18" rx="1.5" opacity="0.25" />
      <rect x="228" y="208" width="12" height="18" rx="1.5" opacity="0.25" />

      {/* Windows — right pavilion */}
      <rect x="312" y="176" width="12" height="18" rx="1.5" opacity="0.25" />
      <rect x="332" y="176" width="12" height="18" rx="1.5" opacity="0.25" />
      <rect x="312" y="206" width="12" height="18" rx="1.5" opacity="0.25" />
      <rect x="332" y="206" width="12" height="18" rx="1.5" opacity="0.25" />

      {/* Tower windows */}
      <rect x="162" y="132" width="10" height="14" rx="1.5" opacity="0.25" />
      <rect x="178" y="132" width="10" height="14" rx="1.5" opacity="0.25" />
      <rect x="212" y="132" width="10" height="14" rx="1.5" opacity="0.25" />
      <rect x="228" y="132" width="10" height="14" rx="1.5" opacity="0.25" />
      <rect x="162" y="156" width="10" height="14" rx="1.5" opacity="0.25" />
      <rect x="228" y="156" width="10" height="14" rx="1.5" opacity="0.25" />

      {/* Arched ground entrances */}
      <rect x="86" y="230" width="22" height="32" rx="11 11 0 0" opacity="0.3" />
      <rect x="189" y="226" width="22" height="36" rx="11 11 0 0" opacity="0.3" />
      <rect x="292" y="230" width="22" height="32" rx="11 11 0 0" opacity="0.3" />

      {/* Columns — left pavilion suggestion */}
      <rect x="52"  y="192" width="3" height="70" opacity="0.18" />
      <rect x="60"  y="192" width="3" height="70" opacity="0.18" />
      <rect x="96"  y="192" width="3" height="70" opacity="0.18" />
      <rect x="104" y="192" width="3" height="70" opacity="0.18" />

      {/* Columns — right pavilion */}
      <rect x="293" y="192" width="3" height="70" opacity="0.18" />
      <rect x="301" y="192" width="3" height="70" opacity="0.18" />
      <rect x="337" y="192" width="3" height="70" opacity="0.18" />
      <rect x="345" y="192" width="3" height="70" opacity="0.18" />
    </svg>
  )
}

interface SiteMetrics {
  bills:       { total: number; analyzed: number; with_plain_titles: number }
  perspectives:{ total: number }
}

export default function LandingPage() {
  const router = useRouter()
  const [recentBills, setRecentBills] = useState<BillCardBill[]>([])
  const [metrics, setMetrics] = useState<SiteMetrics | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = searchQuery.trim()
    if (q) router.push(`/legislation?q=${encodeURIComponent(q)}`)
    else router.push('/legislation')
  }

  useEffect(() => {
    api.searchLegislation('', 4, 0, 'local', 'true', '', 'high')
      .then((data) => setRecentBills(data?.results ?? []))
      .catch(() => {})
    api.getMetrics()
      .then((data) => setMetrics(data?.metrics ?? null))
      .catch(() => {})
  }, [])

  return (
    <div className="space-y-20 pb-20">

      {/* ── Hero ── */}
      <section className="relative pt-12 pb-4 text-center max-w-3xl mx-auto overflow-hidden">
        {/* City Hall silhouette — decorative background */}
        <CityHallSilhouette className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[520px] max-w-none opacity-[0.13] dark:opacity-[0.1] text-blue-900 dark:text-blue-200 pointer-events-none select-none" />
        {/* Fade to page at the bottom */}
        <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-background to-transparent pointer-events-none" />

        <div className="relative z-10">
          <div className="inline-block bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-xs font-semibold px-3 py-1 rounded-full mb-5 border border-blue-200 dark:border-blue-700">
            The City of Brotherly Love · Free · No Agenda
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight mb-5">
            Your City Council is voting on bills right now.<br className="hidden sm:block" /> Do you know what&apos;s in them?
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto mb-8">
            Common Ground tracks every bill introduced to Philadelphia City Council — from Fishtown to Kensington, South Philly to Germantown — and rewrites it in plain English so every resident can follow along.
          </p>
          <form onSubmit={handleSearch} className="relative max-w-lg mx-auto w-full mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search bills by title, topic, or number…"
              autoFocus={typeof window !== 'undefined' && window.innerWidth > 768}
              className="w-full rounded-lg border border-input bg-background pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </form>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/legislation"
              className="btn-primary-hover px-6 py-3 rounded-lg border border-foreground bg-primary text-primary-foreground font-semibold text-base hover:bg-primary/90"
            >
              Browse legislation
            </Link>
            <Link
              href="/councilmembers"
              className="btn-primary-hover px-6 py-3 rounded-lg border font-semibold text-base"
            >
              View council members
            </Link>
          </div>
        </div>
      </section>

      {/* ── Live bill preview — right after the hero so users see real content first ── */}
      {recentBills.length > 0 && (
        <section className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              High-impact bills right now
            </h2>
            <Link href="/legislation?analyzed=true&impact=high" className="text-sm text-primary hover:underline">
              See all →
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {recentBills.map((bill) => (
              <BillCard key={bill.id} bill={bill} showDate={false} />
            ))}
          </div>
        </section>
      )}

      {/* ── Live metrics ── */}
      {metrics && (
        <section className="max-w-2xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            {[
              { value: metrics.bills.total.toLocaleString(),             label: 'Bills tracked' },
              { value: metrics.bills.analyzed.toLocaleString(),          label: 'Bills analyzed' },
              { value: metrics.bills.with_plain_titles.toLocaleString(), label: 'Plain English titles' },
              { value: metrics.perspectives.total.toLocaleString(),      label: 'AI perspectives' },
            ].map(({ value, label }) => (
              <div key={label} className="border rounded-xl px-4 py-5 bg-card">
                <p className="text-2xl font-extrabold tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── How it works ── */}
      <section className="max-w-3xl mx-auto">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground text-center mb-10">
          How it works
        </h2>

        <div className="grid sm:grid-cols-3 gap-6">
          {STEPS.map((step) => (
            <div key={step.number} className="text-center">
              <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground font-bold text-lg flex items-center justify-center mx-auto mb-4">
                {step.number}
              </div>
              <p className="font-semibold mb-2">{step.title}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section className="max-w-4xl mx-auto">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground text-center mb-10">
          What makes it different
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="border rounded-lg px-5 py-4">
              <div className="text-primary mb-3">{f.icon}</div>
              <p className="font-semibold mb-1">{f.title}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Perspectives callout ── */}
      <section className="max-w-3xl mx-auto border rounded-xl px-8 py-10 text-center bg-muted/30">
        <h2 className="text-2xl font-bold tracking-tight mb-3">
          One bill. 17 perspectives. You decide.
        </h2>
        <p className="text-muted-foreground leading-relaxed max-w-xl mx-auto mb-6">
          We don&apos;t tell you what to think. We show you how different communities — progressive activists, small business owners, urban planners, even conspiracy theorists — actually see the same legislation. Then you make up your own mind.
        </p>
        <div className="flex flex-wrap justify-center gap-2 mb-8 text-xs">
          {['Progressive', 'Conservative', 'Libertarian', 'Socialist', 'Working Class', 'Business', 'Urban Planner', 'Public Health', 'Youth', 'Elderly', 'Neighborhood', 'Christian Ethicist', '+ more'].map((p) => (
            <span key={p} className="px-3 py-1 rounded-full border bg-background font-medium">{p}</span>
          ))}
        </div>
        <Link
          href="/legislation?analyzed=true"
          className="btn-primary-hover inline-block px-5 py-2.5 rounded-lg border border-foreground bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90"
        >
          Read the perspectives
        </Link>
      </section>

      {/* ── Mission ── */}
      <section className="max-w-2xl mx-auto text-center">
        <h2 className="text-2xl font-bold tracking-tight mb-4">Built for Philadelphians, by Philadelphians</h2>
        <p className="text-muted-foreground leading-relaxed mb-4">
          City Council passes hundreds of bills every year — zoning changes that reshape your block in East Kensington, tax breaks that shift the burden onto renters in West Philly, public safety measures that affect every neighborhood from Roxborough to Point Breeze. Most residents never find out until it&apos;s already law.
        </p>
        <p className="text-muted-foreground leading-relaxed mb-8">
          Common Ground is a free, independent civic tool with no ads, no corporate backing, and no political agenda. We just want Philly residents to know what their council is doing. If that&apos;s useful to you, consider helping keep the lights on.
        </p>
        <Link
          href="/donate"
          className="btn-primary-hover inline-block px-5 py-2.5 rounded-lg border font-semibold text-sm"
        >
          Support the project →
        </Link>
      </section>

    </div>
  )
}
