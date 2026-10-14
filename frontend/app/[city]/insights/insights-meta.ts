import { siteUrl } from '@/lib/site'

/**
 * Per-section metadata for Council Insights.
 *
 * Each section is its own route so each gets its own title, description and
 * canonical. A single page carrying all nine analyses could only ever rank for
 * one thing; "bills that died without a vote" is a different search from
 * "Philadelphia council activity" and now has a URL of its own to answer it.
 */
export const SECTION_META = {
  overview: {
    title: 'Council Insights',
    description:
      'Philadelphia City Council legislative activity since 2000: volume, outcomes and a plain-English history of what Council has actually done.',
    path: '',
  },
  activity: {
    title: 'Council Activity',
    description:
      'How Philadelphia City Council bills move: status by year, and how the mix of substantive, ceremonial and procedural legislation has shifted.',
    path: '/activity',
  },
  subjects: {
    title: 'What Council Legislates About',
    description:
      'The subjects Philadelphia City Council bills cover, year by year, and how much of its output is substantive rather than ceremonial.',
    path: '/subjects',
  },
  'what-dies': {
    title: 'Bills That Died Without a Vote',
    description:
      'Philadelphia City Council disposed of 1,624 bills between 2000 and 2025 without a single recorded vote. Which subjects, which committees and which members.',
    path: '/what-dies',
  },
  members: {
    title: 'Council Members and Their Records',
    description:
      'Who introduces the most legislation in Philadelphia City Council, who gets it passed, and how members vote when they disagree.',
    path: '/members',
  },
} as const

export type SectionKey = keyof typeof SECTION_META

export function sectionMetadata(section: SectionKey, city: string) {
  const m = SECTION_META[section]
  const canonical = siteUrl(`/${city}/insights${m.path}`)
  return {
    title: `${m.title}, Open Common Ground`,
    description: m.description,
    alternates: { canonical },
    openGraph: {
      title: m.title,
      description: m.description,
      url: canonical,
      type: 'website' as const,
      siteName: 'Open Common Ground',
    },
  }
}

/** Shared parsing of the cross-section query state. */
export function parseInsightsParams(sp: { tag?: string | string[]; year?: string | string[] }) {
  const one = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) ?? ''
  const year = Number(one(sp?.year)) || null
  return { tag: one(sp?.tag), year }
}
