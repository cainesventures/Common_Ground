import CouncilmemberDetailClient from './CouncilmemberDetailClient'
import { siteUrl } from '@/lib/site'

// Must match BILLS_PER_PAGE in the client, so the seeded first page is exactly
// what the client would have fetched for page 1.
const BILLS_PER_PAGE = 20

/**
 * Fetch a council member on the server, for both generateMetadata and the page
 * (Next dedupes the identical request). Seeding the client with this is what
 * puts real content in the server-rendered HTML -- see the note in
 * ../../legislation/[id]/page.tsx.
 */
async function getMember(id: string) {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'}/api/councilmembers/${id}?bills_page=1&bills_limit=${BILLS_PER_PAGE}`,
      { next: { revalidate: 3600 } },
    )
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: { params: Promise<{ city: string; id: string }> }) {
  const { city, id } = await params
  try {
    const data = await getMember(id)
    if (!data) return { title: 'Councilmember — Open Common Ground', alternates: { canonical: siteUrl(`/${city}/councilmembers/${id}`) } }
    const m = data?.member
    const title = m?.name ?? 'Councilmember'
    const description = `${title}${m?.district ? `, ${m.district}` : ''}${m?.party ? ` · ${m.party}` : ''} — Philadelphia City Council`
    const canonical = siteUrl(`/${city}/councilmembers/${id}`)
    return {
      title: `${title} — Open Common Ground`,
      description,
      alternates: { canonical },
      openGraph: {
        title,
        description,
        url: canonical,
        type: 'profile',
        siteName: 'Open Common Ground',
        images: [{ url: `/${city}/councilmembers/${id}/opengraph-image`, width: 1200, height: 630 }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [`/${city}/councilmembers/${id}/opengraph-image`],
      },
    }
  } catch {
    return { title: 'Councilmember — Open Common Ground', alternates: { canonical: siteUrl(`/${city}/councilmembers/${id}`) } }
  }
}

export default async function CouncilmemberPage({
  params,
}: {
  params: Promise<{ city: string; id: string }>
}) {
  const { id } = await params
  // null is fine: the client falls back to fetching, exactly as before.
  const initialData = await getMember(id)
  return <CouncilmemberDetailClient initialData={initialData} />
}
