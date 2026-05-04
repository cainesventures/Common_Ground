import BillDetailClient from './BillDetailClient'

export async function generateMetadata({ params }: { params: Promise<{ city: string; id: string }> }) {
  const { city, id } = await params
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'}/api/legislation/${id}`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return { title: 'Bill — Open Common Ground' }
    const data = await res.json()
    const bill = data?.data
    const title = bill?.plain_title || bill?.title || 'Bill'
    const description = bill?.summary
      ? bill.summary.slice(0, 160)
      : `Philadelphia City Council bill ${bill?.bill_number ?? ''} — Open Common Ground`
    return {
      title: `${title} — Open Common Ground`,
      description,
      openGraph: {
        title,
        description,
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
    return { title: 'Bill — Open Common Ground' }
  }
}

export default function BillDetailPage() {
  return <BillDetailClient />
}
