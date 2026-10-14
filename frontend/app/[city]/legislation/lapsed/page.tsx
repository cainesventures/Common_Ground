import Link from 'next/link'
import { siteUrl } from '@/lib/site'
import { VoteCoverageChart, TermChart, RankChart } from './LapsedCharts'
import { LegislationViewTabs } from '@/components/LegislationViewTabs'

/**
 * /[city]/legislation/lapsed -- the bills that died with nobody on record.
 *
 * A static segment beside [id], so Next routes this before the dynamic bill
 * route. No bill has the id "lapsed".
 *
 * Server-rendered, including both charts' markup, because the point of this
 * page is to be the thing a reader or a reporter can check after reading the
 * claim in /blog/philadelphia-cyclist-rules-never-voted. Every figure comes
 * from the API rather than being written into the copy, so the page cannot
 * drift away from the database.
 */

const PAGE_SIZE = 50

type Outcome = {
  status: string
  label: string
  total: number
  with_vote: number
  without_vote: number
  pct_with_vote: number
}

type RankRow = { key: string; label: string; total: number; died: number; pct: number }

type WhoAndWhere = {
  from_year: number
  to_year: number
  baseline_pct: number | null
  baseline_total: number
  min_committee_bills: number
  min_sponsor_bills: number
  min_tag_bills: number
  by_committee?: RankRow[]
  by_sponsor?: RankRow[]
  by_tag?: RankRow[]
}

type Payload = {
  totals: { corpus: number; lapsed: number; lapsed_without_vote: number; from_year: number; to_year: number }
  vote_rate_by_outcome: Outcome[]
  by_term: { start: number; end: number; count: number; label: string }[]
  who_and_where?: WhoAndWhere
  bills: {
    total: number
    limit: number
    offset: number
    term: number | null
    results: {
      id: string
      bill_number: string | null
      title: string | null
      plain_title: string | null
      headline: string | null
      sponsor: string | null
      committee: string | null
      introduced_date: string | null
      term_start: number | null
    }[]
  }
}

async function getData(term: number, offset: number): Promise<Payload | null> {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'
  const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
  if (term) qs.set('term', String(term))
  try {
    const res = await fetch(`${base}/api/insights/lapsed-without-vote?${qs}`, { next: { revalidate: 3600 } })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params
  const title = 'Bills That Died Without a Vote'
  const description =
    'Philadelphia City Council disposed of 1,624 bills between 2000 and 2025 without a single '
    + 'recorded vote at any stage. Ninety percent of bills signed into law carry a roll call. '
    + 'Three percent of lapsed bills do.'
  const canonical = siteUrl(`/${city}/legislation/lapsed`)
  return {
    title: `${title}, Open Common Ground`,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'website', siteName: 'Open Common Ground' },
  }
}

function fmtDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function LapsedPage({
  params,
  searchParams,
}: {
  params: Promise<{ city: string }>
  searchParams: Promise<{ term?: string; offset?: string }>
}) {
  const { city } = await params
  const sp = await searchParams
  const term = Number(sp?.term ?? 0) || 0
  const offset = Math.max(0, Number(sp?.offset ?? 0) || 0)
  const data = await getData(term, offset)

  if (!data) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">Bills that died without a vote</h1>
        <p className="text-sm text-muted-foreground">
          This page could not load its data just now. Please try again in a moment.
        </p>
      </div>
    )
  }

  const { totals, vote_rate_by_outcome, by_term, bills } = data
  // Optional on purpose. getData caches for an hour, so right after a deploy
  // that adds a field the cached body is still the old shape; dereferencing it
  // blind took the whole page down with a 500 rather than dropping one
  // section. The rankings render when the payload has them.
  const ww = data.who_and_where
  const activeTerm = by_term.find(t => t.start === term)
  const pageEnd = Math.min(bills.offset + bills.limit, bills.total)
  const qsFor = (o: number) => {
    const q = new URLSearchParams()
    if (term) q.set('term', String(term))
    if (o) q.set('offset', String(o))
    const s = q.toString()
    return s ? `?${s}` : ''
  }

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <LegislationViewTabs
          city={city}
          active="lapsed"
          lapsedCount={totals.lapsed_without_vote}
        />

        <h1 className="text-3xl font-bold leading-tight">Bills that died without a vote</h1>

        <p className="text-base text-muted-foreground leading-relaxed">
          Of the {totals.corpus.toLocaleString()} bills introduced in Philadelphia City Council
          between {totals.from_year} and {totals.to_year},{' '}
          <strong className="text-foreground font-semibold">
            {totals.lapsed_without_vote.toLocaleString()}
          </strong>{' '}
          lapsed without a single recorded vote at any stage. No committee vote, no floor vote,
          nobody on record either way. They were introduced, referred to committee, and left there
          until the council term ran out.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          That is not what happens to a bill Council wants to avoid. It is how a Philadelphia bill
          ordinarily dies, which means roughly one bill in five since 2000 was disposed of without
          anyone having to say yes or no to it.{' '}
          <Link href="/blog/philadelphia-cyclist-rules-never-voted" className="underline hover:text-primary">
            Read how this was found
          </Link>
          .
        </p>
      </header>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">A roll call follows the outcome, not the controversy</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Share of bills that carry a recorded vote, grouped by how the bill ended. Bills that
            became law almost always have one. Bills that lapsed almost never do.
          </p>
        </div>
        <div className="border rounded-lg p-4">
          <VoteCoverageChart outcomes={vote_rate_by_outcome} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Every council term does it</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Bills that lapsed with an empty roll call, by the four-year term they were introduced
            in. Pending legislation dies when a term ends, so the term a bill was introduced in is
            the term it died at the end of. The current term is absent because its bills are still
            moving.
          </p>
        </div>
        <div className="border rounded-lg p-4">
          <TermChart
            terms={by_term}
            basePath={`/${city}/legislation/lapsed`}
            activeTerm={term || null}
          />
        </div>
      </section>

      {ww?.by_tag?.length ? (
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">What the bill was about</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Share of bills on each subject that lapsed without a recorded vote, for subjects
            attached to at least {ww.min_tag_bills} bills. Ethics and elections sit at the top,
            the two subjects Council was least willing to put to a vote, and the rules governing
            Council itself are what both are about. The bottom of the list is the routine
            business of running a city: infrastructure, planning and land use.
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Subjects come from the tags on each bill, and a bill usually carries several, so one
            bill can appear under more than one subject here and the totals add up to more than
            the number of bills.
          </p>
        </div>
        <div className="border rounded-lg p-4">
          <RankChart
            rows={ww.by_tag}
            baseline={ww.baseline_pct}
            unit="bills"
            caption="Share of bills that lapsed without a recorded vote, by subject"
          />
        </div>
      </section>
      ) : null}

      {ww?.by_committee?.length ? (
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Where bills go to die</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Share of each committee&apos;s bills that lapsed without a recorded vote. A bill
            referred to Law and Government was five times likelier to die unvoted than one sent
            to Parks and Recreation. Committees with at least{' '}
            {ww.min_committee_bills} bills; the number in brackets is how many it handled.
          </p>
        </div>
        <div className="border rounded-lg p-4">
          <RankChart
            rows={ww.by_committee}
            baseline={ww.baseline_pct}
            unit="bills"
            caption="Share of bills that lapsed without a recorded vote, by committee"
          />
        </div>
      </section>
      ) : null}

      {ww?.by_sponsor?.length ? (
      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Whose bills die</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Share of each member&apos;s bills that lapsed without a recorded vote, for members
            who introduced at least {ww.min_sponsor_bills}. The spread is wide enough that it is
            not about how busy a term was: it runs from under 5 percent to nearly three quarters.
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Read it as a measure of what a member chose to introduce, not of how well they did
            the job. Members who put forward a lot of position-taking legislation that was never
            going to move will sit high on this list, and a member whose bills were mostly
            routine neighbourhood business will sit low.
          </p>
        </div>
        <div className="border rounded-lg p-4">
          <RankChart
            rows={ww.by_sponsor}
            baseline={ww.baseline_pct}
            unit="bills"
            caption="Share of bills that lapsed without a recorded vote, by sponsor"
          />
        </div>
      </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold">
            {activeTerm ? `The ${activeTerm.label} term` : 'The bills'}
          </h2>
          <p className="text-xs text-muted-foreground">
            {bills.total.toLocaleString()} bills
            {bills.total > 0 && <> · showing {(bills.offset + 1).toLocaleString()}&ndash;{pageEnd.toLocaleString()}</>}
            {activeTerm && (
              <>
                {' '}·{' '}
                <Link href={`/${city}/legislation/lapsed`} className="underline hover:text-primary">
                  clear filter
                </Link>
              </>
            )}
          </p>
        </div>

        <ul className="divide-y border rounded-lg">
          {bills.results.map(b => (
            <li key={b.id} className="p-4 space-y-1">
              <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{b.bill_number}</span>
                <span>Introduced {fmtDate(b.introduced_date)}</span>
                {b.term_start && <span>· {b.term_start}&ndash;{b.term_start + 3} term</span>}
              </div>
              <Link
                href={`/${city}/legislation/${b.id}`}
                className="block text-sm font-medium leading-snug hover:text-primary hover:underline"
              >
                {b.plain_title || b.headline || b.title}
              </Link>
              {(b.sponsor || b.committee) && (
                <p className="text-xs text-muted-foreground">
                  {b.sponsor && <>Sponsor: {b.sponsor}</>}
                  {b.sponsor && b.committee && <span className="mx-1">·</span>}
                  {b.committee && <>Committee: {b.committee}</>}
                </p>
              )}
            </li>
          ))}
        </ul>

        {bills.total > bills.limit && (
          <nav className="flex items-center justify-between text-sm">
            {bills.offset > 0 ? (
              <Link
                href={`/${city}/legislation/lapsed${qsFor(Math.max(0, bills.offset - bills.limit))}`}
                className="underline hover:text-primary"
                rel="prev"
              >
                Previous
              </Link>
            ) : <span />}
            {pageEnd < bills.total ? (
              <Link
                href={`/${city}/legislation/lapsed${qsFor(bills.offset + bills.limit)}`}
                className="underline hover:text-primary"
                rel="next"
              >
                Next
              </Link>
            ) : <span />}
          </nav>
        )}
      </section>

      <footer className="text-xs text-muted-foreground leading-relaxed border-t pt-5 space-y-2">
        <p>
          Vote records come from Philadelphia Legistar, the city&apos;s own legislative system. A
          bill counts here when its status is &quot;lapsed&quot; and no roll call exists for it at
          any stage. Bills whose status Legistar never updated are not folded in, so this figure
          matches the published one exactly.
        </p>
        {ww && (
        <p>
          The two rankings above cover {ww.from_year} to {ww.to_year} rather than{' '}
          {totals.to_year}, which is why their totals are smaller than the headline figure. A
          bill from the sitting {by_term.length ? '2024–2027' : 'current'} term cannot have
          lapsed yet, because lapsing is what happens when a term ends, so counting those bills
          would put them in the denominator with no way of reaching the numerator. That drags
          down every member still in office, and unevenly. Restricting the comparison to terms
          that have actually finished is the only way the rates compare like with like. Across
          that window {ww.baseline_pct}% of all bills lapsed without a vote, which is the dashed
          line on both charts.
        </p>
        )}
        {ww && (
        <p>
          Sponsor is the member Legistar records as introducing the bill. Legistar writes the
          same person two ways depending on whether they held the presidency, so those are
          merged here; without that, Council President Clarke and Councilmember Clarke read as
          two people with half a record each.
        </p>
        )}
        <p>
          Grouped by council term rather than by calendar year on purpose: vote-record coverage
          dips in 2019 for what looks like a gap in the source data rather than a change in
          Council&apos;s behaviour, and a year-by-year chart would show a cliff there that is an
          artefact of the records.
        </p>
      </footer>
    </div>
  )
}
