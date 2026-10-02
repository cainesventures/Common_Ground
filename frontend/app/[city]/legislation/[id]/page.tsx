import { notFound } from 'next/navigation'
import BillDetailClient from './BillDetailClient'
import { siteUrl } from '@/lib/site'
import { getBill, MISSING } from './get-bill'

const TITLE_MAX = 70

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
      return { title: 'Bill — Open Common Ground', alternates: { canonical: siteUrl(`/${city}/legislation/${id}`) } }
    }
    // Legal titles run to 300+ characters; Google shows ~60. Prefer the plain
    // title, then the AI headline, and only fall back to the raw legal title,
    // trimmed at a word boundary.
    const rawTitle = bill?.plain_title || bill?.headline || bill?.title || 'Bill'
    const title = truncateTitle(rawTitle)
    const description = bill?.summary
      ? bill.summary.slice(0, 160)
      : `Philadelphia City Council bill ${bill?.bill_number ?? ''} — Open Common Ground`
    const canonical = siteUrl(`/${city}/legislation/${id}`)
    return {
      title: `${title} — Open Common Ground`,
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
    return { title: 'Bill — Open Common Ground', alternates: { canonical: siteUrl(`/${city}/legislation/${id}`) } }
  }
}

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ city: string; id: string }>
}) {
  const { id } = await params
  const initialBill = await getBill(id)
  // layout.tsx is what actually makes this a 404; kept here too so the page is
  // correct on its own. A null is left alone -- the lookup failed for some
  // other reason and the client falls back to fetching, so a backend blip
  // cannot de-index a real bill.
  if (initialBill === MISSING) notFound()
  return <BillDetailClient initialBill={initialBill} />
}
