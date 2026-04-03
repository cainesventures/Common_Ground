'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'

const IMPACT_COLORS: Record<string, string> = {
  high:   'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low:    'bg-green-100 text-green-800',
}

const STATUS_COLORS: Record<string, string> = {
  introduced:      'bg-blue-100 text-blue-800',
  in_committee:    'bg-yellow-100 text-yellow-800',
  signed_into_law: 'bg-green-100 text-green-800',
  failed:          'bg-red-100 text-red-800',
  vetoed:          'bg-orange-100 text-orange-800',
}

interface Bill {
  id: string
  bill_number: string
  title: string
  plain_title?: string
  status: string
  impact_level?: string
  summary?: string
  tags?: string
  next_hearing_date?: string
}

function isWithin7Days(isoDate: string): boolean {
  const d = new Date(isoDate)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  return diff > 0 && diff < 7 * 24 * 60 * 60 * 1000
}

const FEATURES = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
    title: 'Plain English',
    body: 'Cryptic legal titles rewritten into language anyone can understand. Know what a bill actually does before reading a word of legalese.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
    title: '17 Perspectives',
    body: 'Every analyzed bill gets viewpoints from 17 distinct lenses — progressive, conservative, working class, business owner, urban planner, and more.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
    title: 'Impact Scoring',
    body: 'Each bill is rated on how broadly it affects Philadelphians — from low-impact procedural items to high-impact legislation that touches everyday life.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" />
      </svg>
    ),
    title: 'In the News',
    body: 'Related news articles surfaced automatically for each bill so you can see how local media is covering the legislation.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
    title: 'Council Members',
    body: 'Profiles for all 17 Philadelphia City Council members — who sponsors what, their district, contact info, and every bill they\'ve introduced.',
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
      </svg>
    ),
    title: 'Save & Follow',
    body: 'Bookmark bills you care about and get a weekly email digest of newly analyzed legislation with perspectives. Free, no spam.',
  },
]

const STEPS = [
  {
    number: '1',
    title: 'Bills are ingested daily',
    body: 'New legislation introduced to Philadelphia City Council is automatically pulled from the city\'s Legistar system.',
  },
  {
    number: '2',
    title: 'AI analyzes each bill',
    body: 'A plain-English title, summary, impact score, and category tags are generated so you can understand the bill at a glance.',
  },
  {
    number: '3',
    title: '17 perspectives are generated',
    body: 'The bill is analyzed from 17 political, policy, and demographic viewpoints — each with a clear position and key arguments.',
  },
]

function BillPreviewCard({ bill }: { bill: Bill }) {
  let tags: string[] = []
  try { tags = bill.tags ? JSON.parse(bill.tags) : [] } catch { tags = [] }
  const statusColor = STATUS_COLORS[bill.status] ?? 'bg-gray-100 text-gray-700'
  const impactColor = bill.impact_level ? IMPACT_COLORS[bill.impact_level] : null

  return (
    <Link
      href={`/legislation/${bill.id}`}
      className="block border rounded-lg px-4 py-3 hover:border-primary/60 hover:bg-muted/20 transition-all"
    >
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className="text-xs text-muted-foreground font-mono shrink-0">{bill.bill_number}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${statusColor}`}>
          {bill.status?.replace(/_/g, ' ')}
        </span>
        {impactColor && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${impactColor}`}>
            {bill.impact_level} impact
          </span>
        )}
        {bill.next_hearing_date && isWithin7Days(bill.next_hearing_date) && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">
            Hearing {new Date(bill.next_hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
      <p className="text-sm font-semibold leading-snug">
        {bill.plain_title || bill.title}
      </p>
      {bill.summary && (
        <p className="text-xs text-muted-foreground leading-relaxed mt-1 line-clamp-2">{bill.summary}</p>
      )}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {tags.slice(0, 3).map((t) => (
            <span key={t} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium capitalize">{t}</span>
          ))}
        </div>
      )}
    </Link>
  )
}

interface SiteMetrics {
  bills:       { total: number; analyzed: number; with_plain_titles: number }
  perspectives:{ total: number }
}

export default function LandingPage() {
  const router = useRouter()
  const [recentBills, setRecentBills] = useState<Bill[]>([])
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
      <section className="pt-12 pb-4 text-center max-w-3xl mx-auto">
        <div className="inline-block bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1 rounded-full mb-5 border border-blue-200">
          Philadelphia City Council · Free &amp; Open
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight mb-5">
          Understand what your City Council<br className="hidden sm:block" /> is actually doing
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto mb-8">
          Common Ground tracks every bill introduced to Philadelphia City Council and explains it in plain English — with AI perspectives from across the political spectrum.
        </p>
        <form onSubmit={handleSearch} className="flex gap-2 max-w-lg mx-auto w-full mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search bills by title, topic, or number…"
            className="flex-1 rounded-lg border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            type="submit"
            className="px-5 py-3 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors"
          >
            Search
          </button>
        </form>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/legislation"
            className="btn-primary-hover px-6 py-3 rounded-lg border border-black bg-primary text-primary-foreground font-semibold text-base hover:bg-primary/90"
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
      </section>

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
          What you get
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

      {/* ── Live bill preview ── */}
      {recentBills.length > 0 && (
        <section className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Recently analyzed
            </h2>
            <Link href="/legislation?analyzed=true&impact=high" className="text-sm text-primary hover:underline">
              See all →
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            {recentBills.map((bill) => (
              <BillPreviewCard key={bill.id} bill={bill} />
            ))}
          </div>
        </section>
      )}

      {/* ── Perspectives callout ── */}
      <section className="max-w-3xl mx-auto border rounded-xl px-8 py-10 text-center bg-muted/30">
        <h2 className="text-2xl font-bold tracking-tight mb-3">
          17 perspectives on every bill
        </h2>
        <p className="text-muted-foreground leading-relaxed max-w-xl mx-auto mb-6">
          We don't tell you what to think. Instead, we show you how different communities — from progressive activists to business owners to conspiracy theorists — see each piece of legislation. Make up your own mind.
        </p>
        <div className="flex flex-wrap justify-center gap-2 mb-8 text-xs">
          {['Progressive', 'Conservative', 'Libertarian', 'Socialist', 'Working Class', 'Business', 'Urban Planner', 'Public Health', 'Youth', 'Elderly', 'Neighborhood', 'Christian Ethicist', '+ more'].map((p) => (
            <span key={p} className="px-3 py-1 rounded-full border bg-background font-medium">{p}</span>
          ))}
        </div>
        <Link
          href="/legislation?analyzed=true"
          className="btn-primary-hover inline-block px-5 py-2.5 rounded-lg border border-black bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90"
        >
          Read the perspectives
        </Link>
      </section>

      {/* ── Mission ── */}
      <section className="max-w-2xl mx-auto text-center">
        <h2 className="text-2xl font-bold tracking-tight mb-4">Built for Philadelphians</h2>
        <p className="text-muted-foreground leading-relaxed mb-4">
          City Council passes hundreds of bills every year — zoning changes, budget allocations, public safety measures, labor rules. Most residents never hear about them until they're already law.
        </p>
        <p className="text-muted-foreground leading-relaxed mb-8">
          Common Ground is a free, independent civic tool with no ads and no agenda. If it's useful to you, consider supporting it.
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
