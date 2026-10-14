/**
 * The two charts on /[city]/legislation/lapsed.
 *
 * Plain HTML and CSS rather than SVG, and no 'use client'.
 *
 * These started as inline SVG matching the insights page, which was wrong on a
 * phone: an SVG with a fixed viewBox scales its text down with everything else,
 * so 11px labels landed at about 5px at 390px wide, and the fixed minWidth
 * pushed the page into horizontal scroll. HTML bars size to their container and
 * their text never shrinks. The term filter is a link and the tooltips are
 * CSS-only, so neither chart needs a byte of JavaScript.
 *
 * Colour: one hue, #d97706, for every mark in both charts. Each chart is a
 * single series, so there is no legend and nothing is identified by colour --
 * every bar carries its own label and its own value. That hue was checked
 * against the light and dark chart surfaces (lightness band, chroma floor,
 * >=3:1 contrast) rather than picked by eye, and it is the one step that passes
 * in both modes, which is why dark mode reuses it instead of flipping to a
 * lighter amber.
 */

import Link from 'next/link'

const ACCENT = '#d97706'

type Outcome = {
  status: string
  label: string
  total: number
  with_vote: number
  without_vote: number
  pct_with_vote: number
}

type Term = { start: number; end: number; count: number; label: string }

const TIP =
  'pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden -translate-x-1/2'
  + ' whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md'
  + ' group-hover:block group-focus-visible:block'

type RankRow = { key: string; label: string; total: number; died: number; pct: number }

/**
 * A ranked horizontal bar chart on a fixed 0-100% scale.
 *
 * Every percentage chart on this page shares that scale deliberately, so a
 * committee's 47% and a sponsor's 74% and the 90% of signed bills that carry a
 * roll call can all be read against each other. Scaling each chart to its own
 * maximum would make a 47% bar and a 95% bar the same length.
 *
 * `baseline` draws the corpus average as a dashed rule, which is what turns a
 * ranking into a comparison: without it every bar looks damning, and with it
 * you can see that most of the list sits near the norm.
 */
function RankBars({
  rows,
  baseline,
  unit,
}: {
  rows: RankRow[]
  baseline?: number | null
  unit: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-3">
        <div className="w-28 shrink-0 sm:w-52" />
        <div className="relative flex-1">
          {baseline != null && (
            <div
              className="absolute -top-0.5 z-10 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground"
              style={{ left: `${baseline}%` }}
            >
              {baseline}% average
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1">
        {rows.map(r => (
          <div key={r.key} className="flex items-center gap-3">
            <div className="w-28 shrink-0 text-right text-xs leading-tight sm:w-52">
              <span className="font-medium">{r.label}</span>{' '}
              <span className="text-muted-foreground">({r.total.toLocaleString()})</span>
            </div>

            <div className="relative min-w-0 flex-1">
              <div aria-hidden className="absolute inset-0 flex justify-between">
                {[0, 1, 2, 3, 4].map(i => <div key={i} className="w-px bg-foreground/10" />)}
              </div>
              {baseline != null && (
                <div
                  aria-hidden
                  className="absolute inset-y-0 z-10 w-px border-l border-dashed border-foreground/40"
                  style={{ left: `${baseline}%` }}
                />
              )}

              <div className="group relative flex h-4 items-center" tabIndex={0}>
                <div
                  className="h-4 rounded-r-[4px]"
                  style={{ backgroundColor: ACCENT, width: `${Math.max(r.pct, 0.8)}%` }}
                />
                <span className="ml-2 text-xs font-medium tabular-nums">{r.pct}%</span>
                <span className={TIP}>
                  <span className="block font-medium">{r.label}</span>
                  <span className="block text-muted-foreground">
                    {r.died.toLocaleString()} of {r.total.toLocaleString()} {unit} died without a vote
                  </span>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <div className="w-28 shrink-0 sm:w-52" />
        <div className="flex flex-1 justify-between text-[10px] text-muted-foreground">
          {[0, 25, 50, 75, 100].map(t => <span key={t}>{t}%</span>)}
        </div>
      </div>
    </div>
  )
}

/** Where bills go to die, and whose bills die. */
export function RankChart({
  rows,
  baseline,
  unit,
  caption,
}: {
  rows?: RankRow[]
  baseline?: number | null
  unit: string
  caption: string
}) {
  if (!rows || rows.length === 0) return null
  return (
    <div className="space-y-3">
      <RankBars rows={rows} baseline={baseline} unit={unit} />
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Name</th><th scope="col">Bills</th>
              <th scope="col">Died without a vote</th><th scope="col">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td>{r.total}</td><td>{r.died}</td><td>{r.pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Share of bills carrying a recorded vote, by how the bill ended.
 *
 * Horizontal because the categories are words, and this is the chart that
 * carries the finding: the lapsed bar is the outlier and the bar lengths say so
 * without any colour doing the work. Each label carries its own bill count,
 * because two of these four outcomes are small samples (40 vetoed, 65 failed)
 * and a bare percentage would overstate them.
 */
export function VoteCoverageChart({ outcomes }: { outcomes: Outcome[] }) {
  return (
    <div className="space-y-3">
      <div className="space-y-2.5">
        {outcomes.map(o => (
          <div key={o.status} className="flex items-center gap-3">
            <div className="w-24 sm:w-36 shrink-0 text-right">
              <div className="text-xs font-medium leading-tight">{o.label}</div>
              <div className="text-[10px] text-muted-foreground leading-tight">
                {o.total.toLocaleString()} bills
              </div>
            </div>

            <div className="relative flex-1 min-w-0">
              {/* Recessive gridlines, behind the bar. */}
              <div aria-hidden className="absolute inset-0 flex justify-between">
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className="w-px bg-foreground/10" />
                ))}
              </div>

              <div className="group relative flex h-5 items-center" tabIndex={0}>
                <div
                  className="h-5 rounded-r-[4px] transition-opacity"
                  style={{ backgroundColor: ACCENT, width: `${Math.max(o.pct_with_vote, 0.8)}%` }}
                />
                <span className="ml-2 text-xs font-medium tabular-nums">{o.pct_with_vote}%</span>
                <span className={TIP}>
                  <span className="block font-medium">{o.label}</span>
                  <span className="block text-muted-foreground">
                    {o.with_vote.toLocaleString()} of {o.total.toLocaleString()} carry a roll call.{' '}
                    {o.without_vote.toLocaleString()} have none at any stage.
                  </span>
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <div className="w-24 sm:w-36 shrink-0" />
        <div className="relative flex-1 flex justify-between text-[10px] text-muted-foreground">
          {[0, 25, 50, 75, 100].map(t => <span key={t}>{t}%</span>)}
        </div>
      </div>

      {/* Wrapped rather than putting sr-only on the table: sr-only is
          absolutely positioned and clipped, and a clipped table still extends
          the document's scroll width, which put the page into horizontal
          scroll at 390px. The wrapper's overflow contains it. */}
      <div className="sr-only">
      <table>
        <caption>Share of bills carrying a recorded vote, by outcome</caption>
        <thead>
          <tr>
            <th scope="col">Outcome</th><th scope="col">Bills</th>
            <th scope="col">With a recorded vote</th><th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {outcomes.map(o => (
            <tr key={o.status}>
              <th scope="row">{o.label}</th>
              <td>{o.total}</td><td>{o.with_vote}</td><td>{o.pct_with_vote}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}

/**
 * Lapsed-without-a-vote bills per four-year council term.
 *
 * By term rather than by year on purpose: vote-record coverage dips sharply in
 * 2019 for what looks like a Legistar gap rather than a change in Council's
 * behaviour, and a year-by-year chart would show a cliff there that is an
 * artefact. The 2016-2019 term absorbs it.
 *
 * Each bar is a link that filters the list below, so the filter survives a page
 * load and can be shared.
 */
export function TermChart({
  terms,
  basePath,
  activeTerm,
}: {
  terms: Term[]
  basePath: string
  activeTerm: number | null
}) {
  const max = Math.max(...terms.map(t => t.count), 1)
  const ticks = [0, 100, 200, 300].filter(t => t <= max)

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground italic">
        {activeTerm ? 'Showing one term. Select it again to clear.' : 'Select a term to filter the list below.'}
      </p>

      <div className="flex gap-2">
        {/* Value axis */}
        <div aria-hidden className="relative w-7 shrink-0 h-40">
          {ticks.map(t => (
            <span
              key={t}
              className="absolute right-0 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums"
              style={{ bottom: `${(t / max) * 100}%` }}
            >{t}</span>
          ))}
        </div>

        <div className="relative flex-1 min-w-0">
          {/* Recessive gridlines, behind the bars. */}
          <div aria-hidden className="absolute left-0 right-0 h-40">
            {ticks.map(t => (
              <div
                key={t}
                className="absolute left-0 right-0 h-px bg-foreground/10"
                style={{ bottom: `${(t / max) * 100}%` }}
              />
            ))}
          </div>

          <div className="relative flex h-40 items-end gap-1.5 sm:gap-3">
            {terms.map(t => {
              const dim = activeTerm !== null && activeTerm !== t.start
              return (
                <Link
                  key={t.start}
                  href={activeTerm === t.start ? basePath : `${basePath}?term=${t.start}`}
                  scroll={false}
                  aria-label={`${t.label} term: ${t.count} bills lapsed with no recorded vote. Filter the list.`}
                  className="group relative flex h-full flex-1 flex-col justify-end rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span
                    className={`mb-1 text-center text-[11px] font-medium tabular-nums ${dim ? 'text-muted-foreground' : ''}`}
                  >{t.count}</span>
                  {/* Capped rather than filling the column: at full width on a
                      desktop these read as blocks instead of marks. */}
                  <span
                    className="mx-auto w-full max-w-[56px] rounded-t-[4px] transition-opacity group-hover:opacity-90"
                    style={{ backgroundColor: ACCENT, height: `${(t.count / max) * 100}%`, opacity: dim ? 0.35 : 1 }}
                  />
                  <span className={TIP}>
                    <span className="block font-medium">{t.label} Council term</span>
                    <span className="block text-muted-foreground">
                      {t.count.toLocaleString()} bills lapsed with no recorded vote
                    </span>
                  </span>
                </Link>
              )
            })}
          </div>

          <div className="mt-1.5 flex gap-1.5 sm:gap-3">
            {terms.map(t => (
              <span
                key={t.start}
                className="flex-1 text-center text-[10px] leading-tight text-muted-foreground"
              >{t.label}</span>
            ))}
          </div>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground text-center">
        Council term the bill was introduced in
      </p>

      <div className="sr-only">
      <table>
        <caption>Bills that lapsed without a recorded vote, by council term</caption>
        <thead><tr><th scope="col">Council term</th><th scope="col">Bills</th></tr></thead>
        <tbody>
          {terms.map(t => (
            <tr key={t.start}><th scope="row">{t.label}</th><td>{t.count}</td></tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}
