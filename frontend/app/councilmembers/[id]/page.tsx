import CouncilmemberDetailClient from './CouncilmemberDetailClient'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'}/api/councilmembers/${id}`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return { title: 'Councilmember — Common Ground' }
    const data = await res.json()
    const m = data?.member
    const title = m?.name ?? 'Councilmember'
    const description = `${title}${m?.district ? `, ${m.district}` : ''}${m?.party ? ` · ${m.party}` : ''} — Philadelphia City Council`
    return {
      title: `${title} — Common Ground`,
      description,
      openGraph: {
        title,
        description,
        type: 'profile',
        siteName: 'Common Ground',
        images: [{ url: `/councilmembers/${id}/opengraph-image`, width: 1200, height: 630 }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [`/councilmembers/${id}/opengraph-image`],
      },
    }
  } catch {
    return { title: 'Councilmember — Common Ground' }
  }
}

export default function CouncilmemberPage() {
  return <CouncilmemberDetailClient />
}
