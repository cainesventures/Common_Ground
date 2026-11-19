import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCityConfig } from '@/lib/city'
import { siteUrl } from '@/lib/site'
import { BillCard } from '@/components/BillCard'
import type { Bill } from '@/lib/types'
import { WeekBySubject } from './WeekBySubject'
import { HearingCalendar } from './HearingCalendar'

type Week = {
  start: string; end: string; prev: string; next: string
  introduced: Bill[]; decided: Bill[]; hearings?: Bill[]
  // Newer API fields. passed includes bills awaiting the Mayor's signature.
  passed?: Bill[]; not_passed?: Bill[]
}

async function getWeek(end?: string): Promise<Week | null> {
  const qs = end && /^\d{4}-\d{2}-\d{2}$/.test(end) ? `?end=${end}` : ''
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'}/api/legislation/week${qs}`,
      { next: { revalidate: 3600 } })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', opts)

function range(w: Week) {
  return `${fmt(w.start, { month: 'long', day: 'numeric' })} to ${fmt(w.end, { month: 'long', day: 'numeric', year: 'numeric' })}`
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city } = await params
  const config = getCityConfig(city)
  if (!config) return {}
  const title = `This Week in ${config.fullCouncilName}`
  const description = `What ${config.fullCouncilName} worked on this week by subject, every bill introduced and passed, and the hearings coming up, in plain English.`
  return { title, description, alternates: { canonical: siteUrl(`/${city}/this-week`) }, openGraph: { title, description } }
}

/**
 * A weekly recap: what Council focused on, what was introduced, what passed,
 * what failed, and a calendar of the hearings coming up.
 *
 * A reason to come back on a rhythm (Council meets weekly) and a single link
 * worth sharing on a Friday, where a list of 8,693 bills is not. Server
 * rendered, so the week is in the HTML for crawlers and link previews.
 */
export default async function ThisWeekPage({
  params,
  searchParams,
}: {
  params: Promise<{ city: string }>
  searchParams: Promise<{ week?: string }>
}) {
  const { city } = await params
  if (!getCityConfig(city)) notFound()
  const { week } = await searchParams
  const w = await getWeek(week)

  if (!w) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center space-y-2">
        <h1 className="text-2xl font-bold">This week in Council</h1>
        <p className="text-sm text-muted-foreground">The weekly recap could not load right now. Please try again shortly.</p>
      </div>
    )
  }

  const passed = w.passed ?? w.decided.filter((b) => b.status === 'signed_into_law')
  const defeated = w.not_passed ?? w.decided.filter((b) => b.status !== 'signed_into_law')
  const enacted = passed.filter((b) => b.status === 'signed_into_law')
  const awaiting = passed.filter((b) => b.status === 'awaiting_mayor')
  const isLatest = !week
  const nextIsFuture = new Date(`${w.next}T12:00:00`) > new Date()

  return (
    <div className="max-w-3xl mx-auto space-y-10">
      <header className="space-y-3">
        <p className="type-eyebrow text-muted-foreground">{isLatest ? 'Most recent week' : 'Weekly recap'}</p>
        <h1 className="type-display text-3xl sm:text-4xl">This week in Council</h1>
        <p className="text-muted-foreground">{range(w)}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          {[
            [w.introduced.length, 'introduced'],
            [awaiting.length, 'passed, awaiting the Mayor'],
            [enacted.length, 'became law'],
            [defeated.length, 'failed or vetoed'],
          ].filter(([n, label]) => n !== 0 || label === 'introduced').map(([n, label]) => (
            <span key={String(label)} className="rounded-full border px-3 py-1 text-sm">
              <span className="font-semibold tabular-nums">{n}</span> {label}
            </span>
          ))}
        </div>
      </header>

      <WeekBySubject introduced={w.introduced} passed={passed} citySlug={city} />

      <HearingCalendar hearings={w.hearings ?? []} citySlug={city} />

      {enacted.length > 0 && (
        <section className="space-y-3" aria-labelledby="enacted">
          <h2 id="enacted" className="type-section">Became law</h2>
          <div className="space-y-2">{enacted.map((b) => <BillCard key={b.id} bill={b} showDate citySlug={city} />)}</div>
        </section>
      )}

      {awaiting.length > 0 && (
        <section className="space-y-3" aria-labelledby="awaiting">
          <div>
            <h2 id="awaiting" className="type-section">Passed Council, awaiting the Mayor</h2>
            <p className="text-sm text-muted-foreground mt-1">The Mayor can sign these or veto them.</p>
          </div>
          <div className="space-y-2">{awaiting.map((b) => <BillCard key={b.id} bill={b} showDate citySlug={city} />)}</div>
        </section>
      )}

      {defeated.length > 0 && (
        <section className="space-y-3" aria-labelledby="defeated">
          <h2 id="defeated" className="type-section">Failed or vetoed</h2>
          <div className="space-y-2">{defeated.map((b) => <BillCard key={b.id} bill={b} showDate citySlug={city} />)}</div>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="introduced">
        <h2 id="introduced" className="type-section">Newly introduced</h2>
        {w.introduced.length === 0 ? (
          <p className="text-sm text-muted-foreground">No bills were introduced this week. Council may have been in recess.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Most bills go to a committee next, which must hold a public hearing before Council can vote.</p>
            <div className="space-y-2">{w.introduced.map((b) => <BillCard key={b.id} bill={b} showDate citySlug={city} />)}</div>
          </>
        )}
      </section>

      <nav className="flex items-center justify-between border-t pt-5 text-sm" aria-label="Other weeks">
        <Link href={`/${city}/this-week?week=${w.prev}`} className="text-primary hover:underline">← Previous week</Link>
        {!isLatest && !nextIsFuture && (
          <Link href={`/${city}/this-week?week=${w.next}`} className="text-primary hover:underline">Next week →</Link>
        )}
        {!isLatest && (
          <Link href={`/${city}/this-week`} className="text-muted-foreground hover:text-foreground">Latest</Link>
        )}
      </nav>
    </div>
  )
}
