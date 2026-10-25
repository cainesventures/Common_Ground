import Link from 'next/link'

/**
 * The finding that only appears when the two subject analyses are read
 * together, stated on Overview so it is not something a reader has to
 * assemble for themselves by flipping between tabs.
 *
 * What dies ranks subjects by how often they lapse unvoted. What Council turns
 * into law counts what each subject produces. Separately each is a list.
 * Together they say something neither does alone: the subjects Council is
 * least willing to vote on are also the ones it produces almost nothing about,
 * and those subjects are the rules governing Council itself.
 *
 * Everything here is derived from the payload rather than written into the
 * copy. The names and the numbers move if the data moves, which is the whole
 * reason the figures in the blog post needed a page to point at.
 */

import type { SubjectOutput } from './SubjectOutputSection'

// The one claim the payload cannot carry: that the two deadliest subjects are
// about the rules governing Council. Checked against the keys, so if retagging
// ever moves a different subject into the top two, the panel stays off rather
// than saying it about the wrong ones.
const RULES_FOR_COUNCIL = new Set(['ethics', 'elections'])

export function KeyFinding({ data, city }: { data: SubjectOutput | null; city: string }) {
  const rows = data?.by_tag ?? []
  if (rows.length < 4) return null

  const withRates = rows.map(r => ({ ...r, diedPct: (r.died / r.total) * 100 }))
  const deadliest = [...withRates].sort((a, b) => b.diedPct - a.diedPct).slice(0, 2)
  const biggest = [...withRates].sort((a, b) => b.signed - a.signed)[0]

  // Only worth stating if the contrast is actually there.
  if (!deadliest[0] || !biggest || deadliest[0].signed >= biggest.signed) return null
  if (!deadliest.every(r => RULES_FOR_COUNCIL.has(r.key))) return null

  const ratio = Math.round(biggest.signed / Math.max(deadliest[0].signed, 1))

  return (
    <section
      aria-labelledby="key-finding-heading"
      className="rounded-xl border bg-card p-5 space-y-3"
    >
      <h2 id="key-finding-heading" className="text-lg font-semibold">
        Council legislates the city, not itself
      </h2>

      <p className="text-sm text-muted-foreground leading-relaxed">
        The two subjects Council is least willing to put to a vote are{' '}
        <strong className="text-foreground font-medium">{deadliest[0].label.toLowerCase()}</strong>{' '}
        and{' '}
        <strong className="text-foreground font-medium">{deadliest[1].label.toLowerCase()}</strong>
        , where {deadliest[0].diedPct.toFixed(0)}% and {deadliest[1].diedPct.toFixed(0)}% of bills
        lapsed without a recorded vote. They are also two of the subjects it produces least:{' '}
        {deadliest[0].signed.toLocaleString()} and {deadliest[1].signed.toLocaleString()} laws
        across {data!.from_year} to {data!.to_year}. Both are about the rules governing Council
        itself.
      </p>

      <p className="text-sm text-muted-foreground leading-relaxed">
        Over the same years Council signed{' '}
        <strong className="text-foreground font-medium">
          {biggest.signed.toLocaleString()} {biggest.label.toLowerCase()} laws
        </strong>
        , about {ratio} times as many, and {biggest.diedPct.toFixed(0)}% of{' '}
        {biggest.label.toLowerCase()} bills died unvoted against{' '}
        {deadliest[0].diedPct.toFixed(0)}% for {deadliest[0].label.toLowerCase()}. The pattern is
        not that Council avoids hard subjects. It is that the subjects it reliably acts on are
        the ones about the physical city, and the ones it reliably does not are the ones that
        would bind Council.
      </p>

      <p className="text-sm">
        <Link href={`/${city}/insights/what-dies`} className="text-primary underline hover:no-underline">
          What dies →
        </Link>
        <span className="mx-2 text-muted-foreground">·</span>
        <Link href={`/${city}/insights/subjects`} className="text-primary underline hover:no-underline">
          What it turns into law →
        </Link>
      </p>
    </section>
  )
}
