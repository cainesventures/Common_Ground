/**
 * Server-side first page of search results, so the list is in the HTML of the
 * first response instead of arriving after hydration.
 *
 * Mirrors the query string that api.searchLegislation builds on the client —
 * see lib/api.ts. The client keeps using its own fetch for every subsequent
 * filter change; this only has to cover the initial render.
 *
 * A null result means the lookup failed (unreachable API, non-200). The client
 * falls back to fetching for itself in that case, so a backend blip degrades to
 * the old client-rendered behaviour rather than serving "no bills found" to a
 * crawler.
 */
import { CATEGORY_TAGS } from '@/lib/bill-categories'
import type { Bill } from '@/lib/types'
import { PAGE_SIZE, type LegislationFilters } from './legislation-filters'

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'

export interface InitialLegislation {
  bills: Bill[]
  total: number
}

/** Category chips expand into their constituent tags, as on the client. */
function effectiveTags(f: LegislationFilters): string[] {
  const categoryTags = f.categories.flatMap(cat => CATEGORY_TAGS[cat] ?? [])
  return categoryTags.length > 0 ? [...new Set([...f.tags, ...categoryTags])] : f.tags
}

export async function getLegislationList(
  f: LegislationFilters,
): Promise<InitialLegislation | null> {
  const p = new URLSearchParams()
  p.set('q', f.query)
  p.set('limit', String(PAGE_SIZE))
  p.set('offset', String((f.page - 1) * PAGE_SIZE))
  if (f.level) p.set('level', f.level)
  if (f.analyzedOnly) p.set('analyzed', 'true')
  const tags = effectiveTags(f)
  if (tags.length) p.set('tag', tags.join(','))
  if (f.impact) p.set('impact', f.impact)
  if (f.year) p.set('year', String(f.year))
  if (f.month) p.set('month', String(f.month))
  if (f.statuses.length) p.set('status', f.statuses.join(','))
  if (f.sponsors.length) p.set('sponsor', f.sponsors.join(','))
  if (f.hasVotesOnly) p.set('has_votes', 'true')
  if (f.hasPerspectivesOnly) p.set('has_perspectives', 'true')

  try {
    const res = await fetch(`${BACKEND}/api/legislation/search?${p}`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    const data = await res.json()
    return { bills: data?.results ?? [], total: data?.total ?? 0 }
  } catch {
    return null
  }
}
