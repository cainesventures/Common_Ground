/**
 * What the bill actually does.
 *
 * This is the replacement for the 17-persona panel. On a concluded bill it is
 * the only writing on the page beyond the plain-language summary, which is why
 * it renders inline above the arguments rather than behind a tab -- the
 * personas sat two clicks deep and one person opened one in 120 days.
 *
 * Unlike those personas, every block here has been checked against the bill's
 * own text for ungrounded figures and for self-contradiction
 * (scripts/two_lane_checks.py), and a bill whose insights failed those checks
 * three times running has none stored, so it renders nothing instead of
 * something unverified.
 *
 * No 'use client', no state and no fetch of its own. It is imported by
 * BillDetailClient, which is a client component, so this does ship in the
 * client bundle -- but it is pure markup over a prop that arrives on the
 * server-fetched bill payload, so it renders during SSR and the text is in
 * the first HTML response where a crawler can read it. That is the point:
 * bill pages are the site's main organic entry point, and the persona text
 * this replaces was only ever reachable behind a tab.
 */

export interface ParsedInsights {
  /** A lead-in sentence before the list, if the model wrote one. */
  intro: string | null
  items: string[]
}

/**
 * The model is asked for "at most four" things and answers as a numbered list,
 * usually "1. … 2. … 3. …". Splitting on the markers turns that into a real
 * <ol>.
 *
 * About a sixth of the time it prefaces the list with a lead-in — "The bill
 * does the following:", "This bill amends the Realty Transfer Tax as
 * follows:". An earlier version of this required the text to *start* with
 * "1. ", so those fell through to the prose branch and rendered as a single
 * paragraph with "1." "2." "3." embedded mid-sentence. Measured on 40 rows
 * from the real run: 7 of them. So the lead-in is split off and kept as its
 * own sentence rather than discarded — it usually names what is being amended,
 * which the items then rely on.
 *
 * A marker only starts an item at the beginning, after a newline, or after a
 * colon, so a bare "1990" or "$1.5" inside a sentence cannot split it.
 * Trailing empties are dropped, which is what a list ending in "4." — a
 * marker the model opened but never filled — would otherwise leave behind.
 */
export function parseInsights(raw: string): ParsedInsights {
  const text = (raw ?? '').trim()
  if (!text) return { intro: null, items: [] }

  // Where does the list begin? Start of string, or after a newline/colon.
  const start = text.search(/(?:^|\n|:\s*)\s*1[.)]\s/)
  if (start === -1) return { intro: null, items: [text] }

  const markerAt = text.indexOf('1', start)
  const intro = text.slice(0, markerAt).replace(/[:\s]+$/, '').trim()
  const items = text
    .slice(markerAt)
    .split(/(?:^|\n|\s)\d{1,2}[.)]\s+/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  // One item and a lead-in is just a sentence with a stray "1." on it.
  if (items.length <= 1) {
    return { intro: null, items: [intro ? `${intro} ${items[0] ?? ''}`.trim() : (items[0] ?? text)] }
  }
  return { intro: intro || null, items }
}

export function InsightsPanel({ insights }: { insights?: string | null }) {
  const { intro, items } = insights
    ? parseInsights(insights)
    : { intro: null, items: [] }
  if (items.length === 0) return null

  return (
    <section className="border rounded-lg p-5 space-y-3" aria-label="What this bill does">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">What This Bill Does</h2>
        {/* Said plainly and up front, as on the arguments panel. */}
        <p className="text-xs text-muted-foreground">
          AI-written. Every figure is checked against the bill text.
        </p>
      </div>

      {intro && (
        <p className="text-sm text-muted-foreground leading-relaxed">{intro}</p>
      )}

      {items.length === 1 ? (
        <p className="text-sm text-muted-foreground leading-relaxed">{items[0]}</p>
      ) : (
        <ol className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-muted-foreground leading-relaxed">
              <span
                className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-muted text-foreground/70 text-xs font-semibold inline-flex items-center justify-center tabular-nums"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
