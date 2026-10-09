import { notFound } from 'next/navigation'
import CouncilmemberDetailClient from './CouncilmemberDetailClient'
import { siteUrl } from '@/lib/site'
import type { CouncilmemberProfile } from '@/lib/types'
import { councilmemberGraph, jsonLdProps } from '@/lib/structured-data'

// Must match BILLS_PER_PAGE in the client, so the seeded first page is exactly
// what the client would have fetched for page 1.
const BILLS_PER_PAGE = 20

/**
 * Fetch a council member on the server, for both generateMetadata and the page
 * (Next dedupes the identical request). Seeding the client with this is what
 * puts real content in the server-rendered HTML -- see the note in
 * ../../legislation/[id]/page.tsx.
 *
 * MISSING means the API said 404, so the member genuinely does not exist. A
 * null means the lookup failed some other way and must NOT become a 404 -- a
 * backend blip should not tell crawlers a real profile has gone.
 */
const MISSING = Symbol('missing')

async function getMember(id: string): Promise<CouncilmemberProfile | typeof MISSING | null> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'}/api/councilmembers/${id}?bills_page=1&bills_limit=${BILLS_PER_PAGE}`,
      { next: { revalidate: 3600 } },
    )
    if (res.status === 404) return MISSING
    if (!res.ok) return null
    const data = await res.json()
    return data?.member ? data : MISSING
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: { params: Promise<{ city: string; id: string }> }) {
  const { city, id } = await params
  try {
    const data = await getMember(id)
    if (!data || data === MISSING) return { title: 'Councilmember — Open Common Ground', alternates: { canonical: siteUrl(`/${city}/councilmembers/${id}`) } }
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
  const { city, id } = await params
  const initialData = await getMember(id)
  // Only a confirmed 404 becomes a 404; see the note on MISSING above.
  if (initialData === MISSING) notFound()

  // Server-rendered so crawlers see it; omitted entirely when the lookup failed.
  const graph = initialData
    ? councilmemberGraph(initialData.member, city, [
        { name: 'Council', path: `/${city}/councilmembers` },
        { name: initialData.member.name, path: `/${city}/councilmembers/${id}` },
      ])
    : null

  return (
    <>
      {graph && <script {...jsonLdProps(graph)} />}
      <CouncilmemberDetailClient initialData={initialData} />
    </>
  )
}
