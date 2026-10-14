import Link from 'next/link'

/**
 * Section nav for Council Insights.
 *
 * Links, not ARIA tabs: each section is its own route, so the bar is a <nav>
 * with aria-current rather than role="tab" promising a tabpanel that is not
 * there. Real routes mean each section is separately indexable, linkable and
 * server-rendered, which the previous single scrolling page was not.
 *
 * `query` carries the cross-section state (tag, year) from one section to the
 * next. Those used to be component state on one long page; once the sections
 * became separate documents the state had to live in the URL or clicking a tag
 * under Subjects would silently filter a chart on Activity that the reader
 * could no longer see.
 */

export const INSIGHTS_SECTIONS = [
  { key: 'overview', label: 'Overview', path: '' },
  { key: 'activity', label: 'Activity', path: '/activity' },
  { key: 'subjects', label: 'Subjects', path: '/subjects' },
  { key: 'what-dies', label: 'What dies', path: '/what-dies' },
  { key: 'members', label: 'Members', path: '/members' },
] as const

export type InsightsSection = (typeof INSIGHTS_SECTIONS)[number]['key']

const BASE =
  'inline-flex items-center whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors -mb-px'

export function InsightsTabs({
  city,
  active,
  query,
}: {
  city: string
  active: InsightsSection
  query?: Record<string, string | undefined>
}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v) qs.set(k, v)
  }
  const suffix = qs.toString() ? `?${qs}` : ''

  return (
    <nav aria-label="Insights sections" className="flex gap-0 overflow-x-auto border-b scrollbar-hide">
      {INSIGHTS_SECTIONS.map(s => {
        const on = s.key === active
        return (
          <Link
            key={s.key}
            href={`/${city}/insights${s.path}${suffix}`}
            aria-current={on ? 'page' : undefined}
            className={`${BASE} ${
              on ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {s.label}
          </Link>
        )
      })}
    </nav>
  )
}
