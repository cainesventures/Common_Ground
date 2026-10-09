/**
 * The filter state this page encodes in its URL, in one place.
 *
 * The server parses the incoming query string into this shape and the client
 * seeds its useState from it, so the two cannot disagree about defaults. Before
 * this existed the client read the URL itself via useSearchParams, which opted
 * the whole route out of prerendering and left crawlers an empty <Suspense>.
 *
 * Keep in sync with the filters -> URL effect in LegislationClient.
 */
export const PAGE_SIZE = 20

export interface LegislationFilters {
  query: string
  page: number
  year: number | null
  month: number | null
  tags: string[]
  level: string
  statuses: string[]
  impact: string
  sponsors: string[]
  analyzedOnly: boolean
  hasVotesOnly: boolean
  hasPerspectivesOnly: boolean
  categories: string[]
}

/** A raw Next.js searchParams bag: a value may be absent, single or repeated. */
export type RawSearchParams = Record<string, string | string[] | undefined>

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

function list(value: string | string[] | undefined): string[] {
  const raw = one(value)
  return raw ? raw.split(',').filter(Boolean) : []
}

function positiveInt(value: string | string[] | undefined): number | null {
  const n = Number(one(value))
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
}

export function parseFilters(sp: RawSearchParams): LegislationFilters {
  return {
    query: one(sp.q),
    // A bad or absent ?page= is page 1 rather than NaN, which would have made
    // the offset NaN and the query return nothing.
    page: positiveInt(sp.page) ?? 1,
    year: positiveInt(sp.year),
    month: positiveInt(sp.month),
    tags: list(sp.tag),
    level: one(sp.level) || 'local',
    statuses: list(sp.status),
    impact: one(sp.impact),
    sponsors: list(sp.sponsor),
    // Analyzed-only is the default view; ?analyzed=0 is what turns it off.
    analyzedOnly: one(sp.analyzed) !== '0',
    hasVotesOnly: one(sp.has_votes) === '1',
    hasPerspectivesOnly: one(sp.has_perspectives) === '1',
    categories: list(sp.category),
  }
}
