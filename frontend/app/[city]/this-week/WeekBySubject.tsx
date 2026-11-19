import Link from 'next/link'
import { getBillCategory, type BillCategory } from '@/lib/bill-categories'
import type { Bill } from '@/lib/types'

/** Bills shown under a subject before the rest fold into "and N more". */
const SHOWN = 3
/** The label getBillCategory gives a bill whose tags map to no subject. */
const NO_SUBJECT = 'City Council'

function tagsOf(b: Bill): string[] {
  try { return Array.isArray(b.tags) ? b.tags : b.tags ? JSON.parse(b.tags) : [] } catch { return [] }
}

/** Bills grouped by the subject on their card, largest first, "City Council" (no subject) last. */
function bySubject(bills: Bill[]) {
  const groups = new Map<string, { cat: BillCategory; bills: Bill[] }>()
  for (const b of bills) {
    const cat = getBillCategory(tagsOf(b))
    const g = groups.get(cat.label) ?? { cat, bills: [] }
    g.bills.push(b)
    groups.set(cat.label, g)
  }
  return [...groups.values()].sort(
    (a, b) => Number(a.cat.label === NO_SUBJECT) - Number(b.cat.label === NO_SUBJECT) || b.bills.length - a.bills.length,
  )
}

/**
 * "What Council focused on": the week's new and passed bills grouped by the
 * subject on their card, largest first, each linking to the bill.
 *
 * No model is involved. An AI-written summary line above the groups was built
 * and tried (Nov 2026) and dropped: at best it restated the subject names, at
 * worst it blurred details, and it cost a GPU step on every publish.
 */
export function WeekBySubject({ introduced, passed, citySlug }: {
  introduced: Bill[]; passed: Bill[]; citySlug: string
}) {
  const parts = (
    [
      ['introduced', 'New this week', introduced],
      ['passed', 'Passed this week', passed],
    ] as const
  ).filter(([, , bills]) => bills.length > 0)
  if (parts.length === 0) return null

  return (
    <section aria-labelledby="focus" className="rounded-xl border bg-card p-5 sm:p-6 space-y-6">
      <h2 id="focus" className="type-section">What Council focused on</h2>
      {parts.map(([key, heading, bills]) => (
        <div key={key} className="space-y-3">
          <p className="type-eyebrow text-muted-foreground">{heading}</p>
          <ul className="space-y-3">
            {bySubject(bills).map(({ cat, bills: items }) => (
              <li key={cat.label} className="border-l-2 border-primary/40 pl-3">
                <p className="text-sm font-semibold">
                  {/* "City Council" is the card's fallback for a bill with no subject. */}
                  {cat.label === NO_SUBJECT ? 'Other bills' : cat.label}{' '}
                  <span className="font-normal text-muted-foreground tabular-nums">
                    · {items.length} {items.length === 1 ? 'bill' : 'bills'}
                  </span>
                </p>
                <BillLinks bills={items} citySlug={citySlug} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function BillLinks({ bills, citySlug }: { bills: Bill[]; citySlug: string }) {
  const link = (b: Bill) => (
    <li key={b.id} className="line-clamp-2 leading-snug">
      <Link href={`/${citySlug}/legislation/${b.id}`} className="text-sm text-primary hover:underline">
        {b.headline || b.plain_title || b.title}
      </Link>
    </li>
  )
  return (
    <ul className="mt-1 space-y-1.5">
      {bills.slice(0, SHOWN).map(link)}
      {bills.length > SHOWN && (
        <li>
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
              and {bills.length - SHOWN} more
            </summary>
            <ul className="mt-1.5 space-y-1.5">{bills.slice(SHOWN).map(link)}</ul>
          </details>
        </li>
      )}
    </ul>
  )
}
