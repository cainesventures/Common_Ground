import BillDetailClient from './BillDetailClient'
import { siteUrl } from '@/lib/site'

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
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'}/api/legislation/${id}`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return { title: 'Bill — Open Common Ground', alternates: { canonical: siteUrl(`/${city}/legislation/${id}`) } }
    const data = await res.json()
    const bill = data?.data
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

export default function BillDetailPage() {
  return <BillDetailClient />
}
