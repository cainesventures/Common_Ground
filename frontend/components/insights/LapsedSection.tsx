import Link from 'next/link'
import { VoteCoverageChart, TermChart, RankChart } from './LapsedCharts'

/**
 * "What dies" — the lapsed-without-a-vote analysis.
 *
 * This was its own page at /[city]/legislation/lapsed, which carried both the
 * analysis and a paginated list of the bills. The list belongs on the
 * legislation page, where there is now a "died without a vote" filter and all
 * the other filters can be combined with it, so only the analysis moved here.
 *
 * Every figure comes from the API rather than being written into the copy, so
 * the section cannot drift from the database.
 */

export type LapsedPayload = {
  totals: {
    corpus: number
    lapsed: number
    lapsed_without_vote: number
    from_year: number
    to_year: number
  }
  vote_rate_by_outcome: {
    status: string
    label: string
    total: number
    with_vote: number
    without_vote: number
    pct_with_vote: number
  }[]
  by_term: { start: number; end: number; count: number; label: string }[]
  who_and_where?: {
    from_year: number
    to_year: number
    baseline_pct: number | null
    baseline_total: number
    min_committee_bills: number
    min_sponsor_bills: number
    min_tag_bills: number
    min_category_bills: number
    by_committee?: { key: string; label: string; total: number; died: number; pct: number }[]
    by_sponsor?: { key: string; label: string; total: number; died: number; pct: number }[]
    by_tag?: { key: string; label: string; total: number; died: number; pct: number }[]
    by_category?: { key: string; label: string; total: number; died: number; pct: number }[]
  }
}

export function LapsedSection({ data, city }: { data: LapsedPayload | null; city: string }) {
  if (!data) {
    return (
      <div className="border rounded-lg p-6 text-center space-y-2">
        <p className="text-sm font-medium">This section could not load its data just now.</p>
        <p className="text-xs text-muted-foreground">Please try again in a moment.</p>
      </div>
    )
  }

  const { totals, vote_rate_by_outcome, by_term } = data
  const ww = data.who_and_where

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-xl font-bold leading-tight">Bills that died without a vote</h2>
        <p className="text-base text-muted-foreground leading-relaxed">
          Of the {totals.corpus.toLocaleString()} bills introduced in Philadelphia City Council
          between {totals.from_year} and {totals.to_year},{' '}
          <strong className="text-foreground font-semibold">
            {totals.lapsed_without_vote.toLocaleString()}
          </strong>{' '}
          lapsed without a single recorded vote at any stage. No committee vote, no floor vote,
          nobody on record either way. They were introduced, referred to committee, and left
          there until the council term ran out.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          That is not what happens to a bill Council wants to avoid. It is how a Philadelphia
          bill ordinarily dies, which means roughly one bill in five since 2000 was disposed of
          without anyone having to say yes or no to it.
        </p>
        <p className="text-sm">
          <Link
            href={`/${city}/legislation?lapsed_no_vote=1`}
            className="text-primary underline hover:no-underline"
          >
            Browse all {totals.lapsed_without_vote.toLocaleString()} bills →
          </Link>
          <span className="mx-2 text-muted-foreground">·</span>
          <Link
            href="/blog/philadelphia-cyclist-rules-never-voted"
            className="text-primary underline hover:no-underline"
          >
            Read how this was found →
          </Link>
        </p>
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">A roll call follows the outcome, not the controversy</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Share of bills that carry a recorded vote, grouped by how the bill ended. Bills that
            became law almost always have one. Bills that lapsed almost never do.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <VoteCoverageChart outcomes={vote_rate_by_outcome} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">Every council term does it</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Bills that lapsed with an empty roll call, by the four-year term they were introduced
            in. Pending legislation dies when a term ends, so the term a bill was introduced in
            is the term it died at the end of. The current term is absent because its bills are
            still moving.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <TermChart terms={by_term} city={city} />
        </div>
      </section>

      {ww?.by_category?.length ? (
        <section className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">What the bill was about</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Share of bills in each category that lapsed without a recorded vote. Education,
              public safety and health sit at the top; the things a city does every day, zoning
              and transportation, sit at the bottom. Select any bar to browse exactly those
              bills.
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              These are the same categories as the filter on the legislation page. A bill
              usually carries several tags, so it can fall into more than one category and the
              totals add up to more than the number of bills. Categories with at least{' '}
              {ww.min_category_bills} bills.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <RankChart
              rows={ww.by_category}
              baseline={ww.baseline_pct}
              unit="bills"
              caption="Share of bills that lapsed without a recorded vote, by category"
              hrefFor={r =>
                `/${city}/legislation?category=${encodeURIComponent(r.key)}&lapsed_no_vote=1`
              }
            />
          </div>
        </section>
      ) : null}

      {ww?.by_tag?.length ? (
        <section className="space-y-3">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">The same thing in finer detail</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The same question against the raw tags rather than the categories above, for
              tags on at least {ww.min_tag_bills} bills. This is where the sharp findings are:
              ethics and elections sit at the top, the two subjects Council was least willing to
              put to a vote, and the rules governing Council itself are what both are about. Both
              vanish into Government at the coarser grain.
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Subjects come from the tags on each bill, and a bill usually carries several, so
              one bill can appear under more than one subject and the totals add up to more than
              the number of bills.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-5">
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
            <h3 className="text-lg font-semibold">Where bills go to die</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Share of each committee&apos;s bills that lapsed without a recorded vote. A bill
              referred to Law and Government was five times likelier to die unvoted than one
              sent to Parks and Recreation. Committees with at least {ww.min_committee_bills}{' '}
              bills; the number in brackets is how many it handled.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-5">
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
            <h3 className="text-lg font-semibold">Whose bills die</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Share of each member&apos;s bills that lapsed without a recorded vote, for members
              who introduced at least {ww.min_sponsor_bills}. The spread is wide enough that it
              is not about how busy a term was: it runs from under 5 percent to nearly three
              quarters.
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Read it as a measure of what a member chose to introduce, not of how well they did
              the job. Members who put forward a lot of position-taking legislation that was
              never going to move will sit high on this list, and a member whose bills were
              mostly routine neighbourhood business will sit low.
            </p>
          </div>
          <div className="rounded-xl border bg-card p-5">
            <RankChart
              rows={ww.by_sponsor}
              baseline={ww.baseline_pct}
              unit="bills"
              caption="Share of bills that lapsed without a recorded vote, by sponsor"
            />
          </div>
        </section>
      ) : null}

      <footer className="text-xs text-muted-foreground leading-relaxed border-t pt-5 space-y-2">
        <p>
          Vote records come from Philadelphia Legistar, the city&apos;s own legislative system. A
          bill counts here when its status is &quot;lapsed&quot; and no roll call exists for it
          at any stage. Browsing the same bills on the legislation page returns a slightly lower
          count, because that list only shows bills with full text and a headline and a handful
          of these are missing one or the other.
        </p>
        {ww && (
          <p>
            The three rankings cover {ww.from_year} to {ww.to_year} rather than {totals.to_year},
            which is why their totals are smaller than the headline figure. A bill from the
            sitting term cannot have lapsed yet, because lapsing is what happens when a term
            ends, so counting those bills would put them in the denominator with no way of
            reaching the numerator. That drags down every member still in office, and unevenly.
            Across that window {ww.baseline_pct}% of all bills lapsed without a vote, which is
            the dashed line on each chart.
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
