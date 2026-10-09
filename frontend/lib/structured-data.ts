/**
 * JSON-LD builders.
 *
 * The site had Dataset (/budget), OpinionNewsArticle (/blog) and Article
 * (/insights/[year]) but nothing on the two page types that make up almost the
 * whole sitemap: 8,681 bill pages and the council-member profiles. Those are the
 * pages Google organic actually lands on, so `Legislation` and `Person` are the
 * highest-leverage markup available here.
 *
 * Everything is built server-side and emitted with JSON.stringify into a
 * <script type="application/ld+json">, matching how /budget already does it.
 *
 * Keys with undefined values are stripped before output — Google treats an
 * explicit null as a malformed value, and most bill fields are nullable.
 */
import { SITE_URL, siteUrl } from './site'
import type { Bill, Councilmember } from './types'

const ORG_ID = `${SITE_URL}/#organization`
const SITE_ID = `${SITE_URL}/#website`

type Json = Record<string, unknown>

/** Drop undefined/null/empty-string values, recursively, so no empty keys ship. */
function prune<T extends Json>(obj: T): T {
  const out: Json = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      const arr = v.filter((x) => x !== undefined && x !== null && x !== '')
      if (arr.length) out[k] = arr
      continue
    }
    if (typeof v === 'object') {
      const nested = prune(v as Json)
      if (Object.keys(nested).length) out[k] = nested
      continue
    }
    out[k] = v
  }
  return out as T
}

/**
 * The publisher entity, referenced by @id from every other node so the graph
 * describes one organization rather than repeating it per page.
 *
 * Deliberately carries no founder/person: the byline is pseudonymous and must
 * stay unlinked from any real identity.
 */
export function organizationNode(): Json {
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: 'Open Common Ground',
    url: SITE_URL,
    description:
      'Independent tracker for Philadelphia City Council legislation, with plain-English summaries and the case for and against active bills.',
    logo: { '@type': 'ImageObject', url: siteUrl('/icon.png') },
  }
}

/**
 * WebSite node with a SearchAction, which is what makes a sitelinks search box
 * possible. The target has to be a real, crawlable search URL — this points at
 * the legislation index's `q` param, the same one the hero search submits to.
 */
export function webSiteNode(citySlug = 'philadelphia'): Json {
  return {
    '@type': 'WebSite',
    '@id': SITE_ID,
    name: 'Open Common Ground',
    url: SITE_URL,
    publisher: { '@id': ORG_ID },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/${citySlug}/legislation?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  }
}

/** Site-wide graph for the root layout: who publishes this, and how to search it. */
export function siteGraph(): Json {
  return { '@context': 'https://schema.org', '@graph': [organizationNode(), webSiteNode()] }
}

export interface Crumb {
  name: string
  path: string
}

/** BreadcrumbList — gives Google the hierarchy it otherwise guesses from the URL. */
export function breadcrumbNode(crumbs: Crumb[]): Json {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: siteUrl(c.path),
    })),
  }
}

/**
 * Bill page graph: schema.org/Legislation plus a breadcrumb trail.
 *
 * `legislationIdentifier` is the council's own bill number, which is how people
 * search for these ("bill 250123"), so it matters more than it looks.
 */
export function billGraph(bill: Bill, citySlug: string, crumbs: Crumb[]): Json {
  const url = siteUrl(`/${citySlug}/legislation/${bill.id}`)
  const headline = bill.plain_title || bill.headline || bill.title

  const legislation = prune({
    '@type': 'Legislation',
    '@id': `${url}#legislation`,
    url,
    name: headline,
    // The full legal title, kept alongside the readable one.
    alternateName: bill.title !== headline ? bill.title : undefined,
    legislationIdentifier: bill.bill_number,
    // No legislationType. That property wants the legal instrument (Ordinance,
    // Resolution), and nothing in the data says which: `bill_type` is this
    // project's own substantive/ceremonial/procedural impact taxonomy, and the
    // titles carry no instrument prefix. Emitting "substantive" there would be
    // asserting something untrue to every consumer of the markup.
    legislationJurisdiction: 'Philadelphia, Pennsylvania, United States',
    description: bill.summary ?? bill.lede ?? bill.description ?? undefined,
    // schema.org wants a Date here, not a timestamp.
    legislationDate: isoDate(bill.introduced_date),
    dateModified: bill.last_updated ?? undefined,
    legislationPassedBy: {
      '@type': 'GovernmentOrganization',
      name: 'Philadelphia City Council',
    },
    // Sponsor is a free-text name on the bill row; Person is the right type even
    // without a stable id for them here.
    creator: bill.sponsor ? { '@type': 'Person', name: bill.sponsor } : undefined,
    about: normalizeTags(bill.tags),
    isBasedOn: bill.external_url ?? undefined,
    publisher: { '@id': ORG_ID },
    isAccessibleForFree: true,
  })

  return { '@context': 'https://schema.org', '@graph': [legislation, breadcrumbNode(crumbs)] }
}

/** "2000-02-03T00:00:00" → "2000-02-03"; anything unparseable is dropped. */
function isoDate(value?: string | null): string | undefined {
  if (!value) return undefined
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value)
  return match ? match[1] : undefined
}

/** `tags` is a TEXT column holding a JSON array, so it can arrive either way. */
function normalizeTags(tags: Bill['tags']): string[] | undefined {
  if (!tags) return undefined
  if (Array.isArray(tags)) return tags.length ? tags : undefined
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) && parsed.length ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Council-member page graph: schema.org/Person plus a breadcrumb trail. */
export function councilmemberGraph(
  member: Councilmember,
  citySlug: string,
  crumbs: Crumb[],
): Json {
  const url = siteUrl(`/${citySlug}/councilmembers/${member.id}`)
  const district = member.district && member.district !== 'At-Large'
    ? `${member.district} representative`
    : 'At-Large member'

  const person = prune({
    '@type': 'Person',
    '@id': `${url}#person`,
    url,
    name: member.name,
    jobTitle: 'Philadelphia City Council Member',
    description: member.bio ?? `${district} on Philadelphia City Council.`,
    image: member.photo_url ?? undefined,
    email: member.email ? `mailto:${member.email}` : undefined,
    telephone: member.phone ?? undefined,
    affiliation: {
      '@type': 'GovernmentOrganization',
      name: 'Philadelphia City Council',
    },
    memberOf: member.party ? { '@type': 'Organization', name: member.party } : undefined,
    // The member's official city page, which is the authoritative record.
    sameAs: member.profile_url ?? undefined,
  })

  return { '@context': 'https://schema.org', '@graph': [person, breadcrumbNode(crumbs)] }
}

/** Renderable props for a <script type="application/ld+json"> tag. */
export function jsonLdProps(node: Json) {
  return {
    type: 'application/ld+json' as const,
    dangerouslySetInnerHTML: { __html: JSON.stringify(node) },
  }
}
