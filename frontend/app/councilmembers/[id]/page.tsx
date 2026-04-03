import CouncilmemberDetailClient from './CouncilmemberDetailClient'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const res = await fetch(`http://localhost:8000/api/councilmembers/${id}`, {
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
      },
      twitter: {
        card: 'summary',
        title,
        description,
      },
    }
  } catch {
    return { title: 'Councilmember — Common Ground' }
  }
}

export default function CouncilmemberPage() {
  return <CouncilmemberDetailClient />
}
