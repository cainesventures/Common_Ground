import { ThumbsUp, ThumbsDown } from 'lucide-react'
import { TwoLaneSeen } from './TwoLaneSeen'

/**
 * The case for and the case against, side by side.
 *
 * This replaces the 17 personas as the first thing a reader meets on an active
 * bill. The personas are not deleted -- 16,217 of them exist and are indexed --
 * but they sat behind a tab and an accordion and, over 120 days, 45 people
 * viewed bills while one person opened a perspective. So this is not a tab. It
 * renders inline under the plain-language summary, with no click between the
 * reader and the argument.
 *
 * A server component on purpose: no state, no fetch, no 'use client'. The text
 * arrives on the bill payload, so it is in the server-rendered HTML where a
 * crawler can see it -- the same reason the perspectives were moved into SSR.
 *
 * Both lanes are AI-written, and every number in them has been checked against
 * the bill text (scripts/two_lane_checks.py). Bills whose arguments failed
 * those checks have no text stored at all and render nothing here, which is
 * why `state` matters: "no case" and "not generated yet" must not look the
 * same to a reader.
 */
export function TwoLanePanel({
  billId,
  caseFor,
  caseAgainst,
  state,
}: {
  billId: string
  caseFor?: string | null
  caseAgainst?: string | null
  state?: string | null
}) {
  // Only a fully two-sided bill is shown. One lane on its own would read as
  // the site taking a side, which is the opposite of the point, and a
  // procedural or dropped bill gets silence rather than an empty panel or an
  // apology for the pipeline.
  if (state !== 'argued' || !caseFor || !caseAgainst) return null

  const lanes = [
    {
      key: 'for',
      label: 'The case for',
      text: caseFor,
      Icon: ThumbsUp,
      accent: 'border-emerald-200 dark:border-emerald-900',
      chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    },
    {
      key: 'against',
      label: 'The case against',
      text: caseAgainst,
      Icon: ThumbsDown,
      accent: 'border-rose-200 dark:border-rose-900',
      chip: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
    },
  ]

  return (
    <section className="space-y-3" aria-label="Arguments for and against this bill">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">Both Sides</h2>
        {/* Said plainly and up front. The arguments are written by a model, and
            a reader who assumes otherwise has been misled by us. */}
        <p className="text-xs text-muted-foreground">
          AI-written arguments. Every figure is checked against the bill text.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {lanes.map(({ key, label, text, Icon, accent, chip }) => (
          <div key={key} className={`border rounded-lg p-5 space-y-2.5 ${accent}`}>
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${chip}`}>
                <Icon className="h-3 w-3" aria-hidden="true" />
                {label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{text}</p>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground/60">
        Neither side is the site&apos;s position. They are here so you can weigh the bill yourself.
      </p>

      {/* Last, so the event means "read to the end of both cases". */}
      <TwoLaneSeen billId={billId} />
    </section>
  )
}
