import CouncilmemberDetailClient from './CouncilmemberDetailClient'
import { siteUrl } from '@/lib/site'

export async function generateMetadata({ params }: { params: Promise<{ city: string; id: string }> }) {
  const { city, id } = await params
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'}/api/councilmembers/${id}`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return { title: 'Councilmember — Open Common Ground', alternates: { canonical: siteUrl(`/${city}/councilmembers/${id}`) } }
    const data = await res.json()
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

export default function CouncilmemberPage() {
  return <CouncilmemberDetailClient />
}
