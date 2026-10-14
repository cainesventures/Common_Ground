import Link from 'next/link'

/**
 * "What Council turns into law" — output by subject, counted not rated.
 *
 * This is the companion to the lapsed analysis under What dies, and it
 * deliberately does not mirror it. A pass *rate* by subject is almost exactly
 * 100 minus the lapse rate: measured across every tag above the floor, statuses
 * other than "signed into law" and "lapsed with no roll call" average 2.0% of
 * bills and never exceed 5.6%. Ranking subjects by pass rate just redraws the
 * other chart backwards.
 *
 * Counting is what adds something. Zoning and planning produce thousands of
 * laws while education produces a couple of hundred, and that gap says more
 * about where Council spends its time than any rate does. The pass rate is
 * still shown per row, as context rather than as the ranking.
 *
 * Bars are scaled to the largest value rather than to 100, because these are
 * counts with no natural ceiling; the percentage charts elsewhere share a fixed
 * 0-100% scale precisely because they do have one.
 */

type OutputRow = {
  key: string
  label: string
  total: number
  signed: number
  died: number
  pct_signed: number
}

/**
 * Light #0369a1, dark #0284c7, as Tailwind classes rather than an inline style
 * so the two steps can differ.
 *
 * Dark mode is selected, not reused: #0369a1 measures 2.94:1 against the dark
 * chart surface, just under the 3:1 floor, and #0284c7 clears it. A different
 * hue from the amber on What dies because these are different quantities, laws
 * made against bills killed; the pair separates at delta-E 23 under protanopia,
 * well above the 8 the method asks for.
 */
const BAR = 'bg-[#0369a1] dark:bg-[#0284c7]'

const TIP =
  'pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden -translate-x-1/2'
  + ' whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md'
  + ' group-hover:block group-focus-visible:block'

function VolumeBars({
  rows,
  hrefFor,
}: {
  rows: OutputRow[]
  hrefFor?: (row: OutputRow) => string
}) {
  const max = Math.max(...rows.map(r => r.signed), 1)

  return (
    <div className="space-y-1">
      {rows.map(r => {
        const body = (
          <>
            <span
              className={`h-4 rounded-r-[4px] ${BAR}`}
              style={{ width: `${Math.max((r.signed / max) * 100, 0.8)}%` }}
            />
            <span className="ml-2 whitespace-nowrap text-xs font-medium tabular-nums">
              {r.signed.toLocaleString()}
            </span>
            <span className={TIP}>
              <span className="block font-medium">{r.label}</span>
              <span className="block text-muted-foreground">
                {r.signed.toLocaleString()} of {r.total.toLocaleString()} signed into law
                {' '}({r.pct_signed}%). {r.died.toLocaleString()} died without a vote.
              </span>
            </span>
          </>
        )
        const cls = 'group relative flex h-4 items-center'
        return (
          <div key={r.key} className="flex items-center gap-3">
            <div className="w-24 shrink-0 text-right text-xs leading-tight sm:w-40">
              <span className="font-medium">{r.label}</span>{' '}
              <span className="text-muted-foreground">({r.pct_signed}%)</span>
            </div>
            <div className="min-w-0 flex-1">
              {hrefFor ? (
                <Link
                  href={hrefFor(r)}
                  aria-label={`${r.label}: ${r.signed} bills signed into law. Browse bills on this subject that became law.`}
                  className={`${cls} rounded-sm hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`}
                >
                  {body}
                </Link>
              ) : (
                <div className={cls} tabIndex={0}>{body}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export type SubjectOutput = {
  from_year: number
  to_year: number
  min_category_bills: number
  min_tag_bills: number
  total_signed: number
  by_category?: OutputRow[]
  by_tag?: OutputRow[]
}

export function SubjectOutputSection({
  data,
  city,
}: {
  data: SubjectOutput | null
  city: string
}) {
  if (!data?.by_category?.length) return null
  const topTags = (data.by_tag ?? []).slice(0, 15)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">What Council turns into law</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Bills signed into law between {data.from_year} and {data.to_year}, counted by subject.
          Council produced {data.total_signed.toLocaleString()} laws in that window and the
          overwhelming majority of them are about the physical city: what gets built, where, and
          how people move around it. The share in brackets is how often bills on that subject
          became law.
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Counted rather than ranked by pass rate on purpose. A subject&apos;s pass rate is
          almost exactly 100 minus its rate of dying unvoted, so ranking by it would just redraw{' '}
          <Link href={`/${city}/insights/what-dies`} className="underline hover:text-primary">
            What dies
          </Link>{' '}
          backwards. Volume is the part that is not already on screen.
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Selecting a category opens the full list of bills on that subject that became law,
          which returns a higher number than the bar: the bars stop at {data.to_year} so that
          the pass rates beside them compare like with like, and the list does not stop at all.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold">By category</h3>
        <VolumeBars
          rows={data.by_category}
          hrefFor={r =>
            `/${city}/legislation?category=${encodeURIComponent(r.key)}&status=signed_into_law`
          }
        />
        <div className="sr-only">
          <table>
            <caption>Bills signed into law by category</caption>
            <thead>
              <tr>
                <th scope="col">Category</th><th scope="col">Signed into law</th>
                <th scope="col">Bills</th><th scope="col">Share signed</th>
              </tr>
            </thead>
            <tbody>
              {data.by_category.map(r => (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  <td>{r.signed}</td><td>{r.total}</td><td>{r.pct_signed}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {topTags.length > 0 && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold">By tag, the fifteen largest</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tags on at least {data.min_tag_bills} bills. A bill carries several, so these
              overlap.
            </p>
          </div>
          <VolumeBars rows={topTags} />
          <div className="sr-only">
            <table>
              <caption>Bills signed into law by tag</caption>
              <thead>
                <tr>
                  <th scope="col">Tag</th><th scope="col">Signed into law</th>
                  <th scope="col">Bills</th><th scope="col">Share signed</th>
                </tr>
              </thead>
              <tbody>
                {topTags.map(r => (
                  <tr key={r.key}>
                    <th scope="row">{r.label}</th>
                    <td>{r.signed}</td><td>{r.total}</td><td>{r.pct_signed}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
