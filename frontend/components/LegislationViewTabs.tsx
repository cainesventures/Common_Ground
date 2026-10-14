import Link from 'next/link'

/**
 * View switcher above the legislation list.
 *
 * These are links, not ARIA tabs. They navigate between two routes rather than
 * swapping panels in place, so the bar is a <nav> with aria-current on the
 * active link; giving a navigating link role="tab" would promise a tabpanel
 * that does not exist. The styling deliberately matches the tab bar on bill
 * detail so the two read as the same control.
 *
 * This replaced an amber callout banner, which used alert vocabulary for what
 * is really just another way of looking at the same bills.
 */

const BASE =
  'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors -mb-px'

export function LegislationViewTabs({
  city,
  active,
  lapsedCount,
}: {
  city: string
  active: 'all' | 'lapsed'
  lapsedCount?: number
}) {
  const views = [
    { key: 'all' as const, label: 'All bills', href: `/${city}/legislation`, badge: null as number | null },
    {
      key: 'lapsed' as const,
      label: 'Died without a vote',
      href: `/${city}/legislation/lapsed`,
      badge: lapsedCount ?? null,
    },
  ]

  return (
    <nav aria-label="Legislation views" className="flex gap-0 overflow-x-auto border-b scrollbar-hide">
      {views.map(v => {
        const on = v.key === active
        return (
          <Link
            key={v.key}
            href={v.href}
            aria-current={on ? 'page' : undefined}
            className={`${BASE} ${
              on ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {v.label}
            {v.badge !== null && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  on ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                }`}
              >
                {v.badge.toLocaleString()}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
