import { notFound } from 'next/navigation'
import BillDetailClient from './BillDetailClient'
import { siteUrl } from '@/lib/site'
import { getBill, MISSING } from './get-bill'
import { getRelated } from './get-related'
import { billIdsToPrerender } from '@/lib/sitemap-params'
import { getCouncilmembers } from '../../councilmembers/get-councilmembers'
import { billGraph, jsonLdProps } from '@/lib/structured-data'
import { BillBlogCallout } from '@/components/blog/BillBlogCallout'
import { BallotQuestionCallout } from '@/components/BallotQuestionCallout'
import { getBallotQuestion } from '@/lib/ballot-questions'

const TITLE_MAX = 70

// Every bill in the sitemap is built at deploy time (in the follow-up deploy;
// see lib/sitemap-params.ts), so a crawler hit is a file, not a function run.
// Caching on first hit (the Nov 2 fix) did not cut CPU: Google requests each
// bill about once per pass, so nearly every hit was a first hit.
// Must equal DATA_REVALIDATE in lib/backend.ts (segment config takes a literal).
export const revalidate = 604800
export function generateStaticParams({ params }: { params: { city: string } }) {
  return billIdsToPrerender(params.city).map((id) => ({ id }))
}

/** Trim to a word boundary so a 300-character legal title reads as a title. */
function truncateTitle(value: string): string {
  const clean = value.trim().replace(/\s+/g, ' ')
  if (clean.length <= TITLE_MAX) return clean
  const cut = clean.slice(0, TITLE_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[,;:]$/, '')}…`
}

export async function generateMetadata({ params }: { params: Promise<{ city: string; id: string }> }) {
  const { city, id } = await params
  // layout.tsx already 404s a missing bill before the response commits; this
  // stays outside the try because notFound() throws, and catching would
  // swallow it.
  const bill = await getBill(id)
  if (bill === MISSING) notFound()
  try {
    if (!bill) {
      return { title: 'Bill, Open Common Ground', alternates: { canonical: siteUrl(`/${city}/legislation/${id}`) } }
    }
    // Legal titles run to 300+ characters; Google shows ~60. Prefer the plain
    // title, then the AI headline, and only fall back to the raw legal title,
    // trimmed at a word boundary.
    // A bill that put a question on the ballot is searched for as the ballot
    // question, so name it that way.
    const ballot = getBallotQuestion(id)
    const rawTitle = bill?.plain_title || bill?.headline || bill?.title || 'Bill'
    const title = ballot ? ballot.seoTitle : truncateTitle(rawTitle)
    const description = ballot
      ? ballot.seoDescription
      : bill?.summary
        ? bill.summary.slice(0, 160)
        : `Philadelphia City Council bill ${bill?.bill_number ?? ''}, Open Common Ground`
    const canonical = siteUrl(`/${city}/legislation/${id}`)
    return {
      title: `${title}, Open Common Ground`,
      description,
      alternates: { canonical },
      openGraph: {
        title,
        description,
        url: canonical,
        type: 'article',
        siteName: 'Open Common Ground',
        images: [{ url: `/${city}/legislation/${id}/opengraph-image`, width: 1200, height: 630 }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [`/${city}/legislation/${id}/opengraph-image`],
      },
    }
  } catch {
    return { title: 'Bill, Open Common Ground', alternates: { canonical: siteUrl(`/${city}/legislation/${id}`) } }
  }
}

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ city: string; id: string }>
}) {
  const { city, id } = await params
  // In parallel: the bill, what to read next, and the member list that turns
  // sponsor names into links. All three are in the server HTML, so the links
  // out of this page are there for a crawler and there before a reader scrolls.
  // The member list is one cached fetch shared by every bill page.
  const [initialBill, initialRelated, allMembers] = await Promise.all([
    getBill(id),
    getRelated(id),
    getCouncilmembers(),
  ])
  // Only the fields the page reads (sponsor links, the contact button, the
  // district lookup). The list is serialized into every bill page's HTML, so
  // photos, phone numbers and tenure figures would be dead weight.
  const initialMembers = allMembers?.map(({ id: memberId, name, district, email, profile_url, term_start }) => ({
    id: memberId, name, district, email, profile_url, term_start,
  })) ?? null
  // layout.tsx is what actually makes this a 404; kept here too so the page is
  // correct on its own. A null is left alone -- the lookup failed for some
  // other reason and the client falls back to fetching, so a backend blip
  // cannot de-index a real bill.
  if (initialBill === MISSING) notFound()

  // Emitted here rather than in the client component so the markup is in the
  // server-rendered HTML, which is the only version a crawler reads. Skipped
  // when the lookup failed, so a backend blip publishes no partial entity.
  const graph = initialBill
    ? billGraph(initialBill, city, [
        { name: 'Legislation', path: `/${city}/legislation` },
        {
          name: initialBill.bill_number || 'Bill',
          path: `/${city}/legislation/${id}`,
        },
      ])
    : null

  return (
    <>
      {graph && <script {...jsonLdProps(graph)} />}
      <BallotQuestionCallout billId={id} />
      <BillBlogCallout billId={id} billNumber={initialBill?.bill_number} />
      <BillDetailClient
        initialBill={initialBill}
        initialRelated={initialRelated}
        initialMembers={initialMembers}
      />
    </>
  )
}
