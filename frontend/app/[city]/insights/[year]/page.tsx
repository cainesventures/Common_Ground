import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCityConfig } from '@/lib/city'
import {
  getAllYears,
  getYearEntry,
  HISTORY_CITY,
  type ContestedBill,
  type NotableBill,
  type YearEntry,
} from '@/lib/legislative-history'

// Fully static: every year page is prerendered at build time and unknown
// years 404 without hitting the server.
export const dynamicParams = false

export function generateStaticParams() {
  return getAllYears().map(year => ({ city: HISTORY_CITY, year: String(year) }))
}

export async function generateMetadata({ params }: { params: Promise<{ city: string; year: string }> }) {
  const { city, year } = await params
  const entry = getYearEntry(Number(year))
  const cityConfig = getCityConfig(city)
  if (!entry || !cityConfig) return { title: 'Year in Review — Open Common Ground' }

  const title = `${cityConfig.fullCouncilName} ${entry.year}: Year in Review`
  const description =
    `${entry.headline}. ${entry.stats.total} bills introduced, ${entry.stats.signed} signed into law` +
    (entry.stats.contested_count ? `, ${entry.stats.contested_count} contested votes` : '') +
    ` — every bill, what passed, and what mattered in ${entry.year}.`

  const canonical = `https://opencommonground.com/${city}/insights/${entry.year}`
  return {
    title: `${title} — Open Common Ground`,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: 'article',
      siteName: 'Open Common Ground',
      url: canonical,
    },
    twitter: { card: 'summary', title, description },
  }
}

function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-2xl font-bold tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="text-sm font-medium mt-0.5">{label}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  )
}

const STATUS_BADGE: Record<string, string> = {
  signed_into_law: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  failed:          'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  vetoed:          'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  introduced:      'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  in_committee:    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
}

function statusLabel(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function NotableBillCard({ bill, city }: { bill: NotableBill; city: string }) {
  return (
    <Link href={`/${city}/legislation/${bill.id}`}
      className="block rounded-lg border p-3 hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium leading-snug">{bill.title}</div>
          {bill.lede && <p className="text-xs text-muted-foreground mt-1">{bill.lede}</p>}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          <span className="text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full bg-muted border">
            impact {bill.impact_score}/10
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[bill.status] ?? 'bg-muted'}`}>
            {statusLabel(bill.status)}
          </span>
        </div>
      </div>
    </Link>
  )
}

function ContestedBillCard({ bill, city }: { bill: ContestedBill; city: string }) {
  return (
    <Link href={`/${city}/legislation/${bill.id}`}
      className="block rounded-lg border p-3 hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium leading-snug">{bill.title}</div>
          <div className="text-xs text-muted-foreground mt-1">Dissenting: {bill.dissenters.join(', ')}</div>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums">{bill.yeas}–{bill.nays}</span>
      </div>
    </Link>
  )
}

function YearNav({ entry, city }: { entry: YearEntry; city: string }) {
  const years = getAllYears()
  const prev = years.find(y => y < entry.year)
  const next = [...years].reverse().find(y => y > entry.year)
  return (
    <div className="flex items-center justify-between text-sm">
      {prev ? (
        <Link href={`/${city}/insights/${prev}`} className="text-primary hover:underline">← {prev} in review</Link>
      ) : <span />}
      <Link href={`/${city}/insights`} className="text-muted-foreground hover:text-foreground">All insights</Link>
      {next ? (
        <Link href={`/${city}/insights/${next}`} className="text-primary hover:underline">{next} in review →</Link>
      ) : <span />}
    </div>
  )
}

export default async function YearInReviewPage({ params }: { params: Promise<{ city: string; year: string }> }) {
  const { city, year } = await params
  const cityConfig = getCityConfig(city)
  const entry = getYearEntry(Number(year))
  if (!cityConfig || city !== HISTORY_CITY || !entry) notFound()

  const s = entry.stats
  const paragraphs = entry.narrative.split(/\n\n+/).filter(Boolean)
  const allYears = getAllYears()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${cityConfig.fullCouncilName} ${entry.year}: ${entry.headline}`,
    description: `AI analysis of ${s.total} bills introduced in ${cityConfig.fullCouncilName} in ${entry.year}.`,
    author: { '@type': 'Organization', name: 'Open Common Ground', url: 'https://opencommonground.com' },
    mainEntityOfPage: `https://opencommonground.com/${city}/insights/${entry.year}`,
  }

  return (
    <div className="space-y-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Header */}
      <div className="space-y-3">
        <nav className="text-sm text-muted-foreground">
          <Link href={`/${city}/insights`} className="hover:text-foreground">Council Insights</Link>
          <span className="mx-2">/</span>
          <span>{entry.year}</span>
        </nav>
        <h1 className="text-3xl font-bold leading-tight">
          {cityConfig.fullCouncilName} in {entry.year}
          {entry.is_partial && (
            <span className="ml-3 align-middle text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              year in progress
            </span>
          )}
        </h1>
        <p className="text-xl text-muted-foreground">{entry.headline}</p>
        {entry.key_themes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {entry.key_themes.map(t => (
              <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-muted border">{t}</span>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Bills Introduced" value={s.total}
          sub={s.delta_vs_prior != null ? `${s.delta_vs_prior >= 0 ? '+' : ''}${s.delta_vs_prior} vs ${entry.year - 1}` : undefined} />
        <StatTile label="Signed into Law" value={s.signed}
          sub={s.pass_rate != null ? `${Math.round(s.pass_rate * 100)}% of closed bills` : undefined} />
        <StatTile label="Didn't Pass" value={s.failed + s.vetoed + (s.died_in_committee ?? 0)}
          sub={s.died_in_committee ? 'failed, vetoed, or died in committee' : 'failed or vetoed'} />
        <StatTile label="Median Days to Law" value={s.median_days_to_passage ?? '—'} sub="introduction to signing" />
        <StatTile label="Contested Votes" value={s.contested_count} sub="bills with at least one Nay" />
        <StatTile label="Top Issue"
          value={s.top_tags[0] ? s.top_tags[0].tag.replace(/-/g, ' ') : '—'}
          sub={s.top_tags[0] ? `${s.top_tags[0].count} bills` : undefined} />
      </div>

      {/* Narrative */}
      <div className="rounded-xl border bg-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">The year in summary</h2>
        {paragraphs.map((p, i) => (
          <p key={i} className="text-sm leading-relaxed text-muted-foreground">{p}</p>
        ))}
        <p className="text-xs text-muted-foreground border-t pt-3">
          AI-generated analysis grounded in {s.total} bills from official {cityConfig.fullCouncilName} records.
        </p>
      </div>

      {/* Top issues */}
      {s.top_tags.length > 0 && (
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="text-lg font-semibold">What council worked on in {entry.year}</h2>
          <div className="flex flex-wrap gap-2">
            {s.top_tags.map(t => (
              <Link key={t.tag} href={`/${city}/legislation?year=${entry.year}&tag=${encodeURIComponent(t.tag)}`}
                className="text-sm px-3 py-1 rounded-full border hover:bg-muted transition-colors">
                <span className="capitalize">{t.tag.replace(/-/g, ' ')}</span>
                <span className="text-muted-foreground ml-1.5 tabular-nums">{t.count}</span>
              </Link>
            ))}
          </div>
          {(s.rising_tags.length > 0 || s.falling_tags.length > 0) && (
            <p className="text-xs text-muted-foreground">
              {s.rising_tags.length > 0 && (
                <>Rising vs {entry.year - 1}: {s.rising_tags.map(t => `${t.tag.replace(/-/g, ' ')} (+${t.delta})`).join(', ')}. </>
              )}
              {s.falling_tags.length > 0 && (
                <>Declining: {s.falling_tags.map(t => `${t.tag.replace(/-/g, ' ')} (${t.delta})`).join(', ')}.</>
              )}
            </p>
          )}
        </div>
      )}

      {/* Notable bills */}
      {entry.notable_bills.length > 0 && (
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="text-lg font-semibold">Highest-impact bills of {entry.year}</h2>
          <div className="space-y-2">
            {entry.notable_bills.map(b => <NotableBillCard key={b.id} bill={b} city={city} />)}
          </div>
        </div>
      )}

      {/* Contested votes */}
      {entry.contested_bills.length > 0 && (
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="text-lg font-semibold">
            Most contested votes of {entry.year}
            {s.contested_count > entry.contested_bills.length && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                top {entry.contested_bills.length} of {s.contested_count}
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground">
            Most council roll calls are unanimous — these are the bills that split the chamber.
          </p>
          <div className="space-y-2">
            {entry.contested_bills.map(b => <ContestedBillCard key={b.id} bill={b} city={city} />)}
          </div>
        </div>
      )}

      {/* Sponsors */}
      {s.top_sponsors.length > 0 && (
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="text-lg font-semibold">Most active sponsors in {entry.year}</h2>
          <ul className="space-y-1">
            {s.top_sponsors.map(sp => (
              <li key={sp.name} className="flex items-center justify-between text-sm">
                <span>{sp.name}</span>
                <span className="text-muted-foreground tabular-nums">{sp.count} bills</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link href={`/${city}/legislation?year=${entry.year}`}
        className="inline-block text-sm text-primary hover:underline">
        Browse all {s.total} bills from {entry.year} →
      </Link>

      {/* Year navigation */}
      <div className="border-t pt-5 space-y-4">
        <YearNav entry={entry} city={city} />
        <div className="flex flex-wrap gap-1.5">
          {allYears.map(y => (
            <Link key={y} href={`/${city}/insights/${y}`}
              className={`px-2.5 py-0.5 rounded-full text-xs border transition-colors ${
                y === entry.year ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
              }`}>
              {y}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
