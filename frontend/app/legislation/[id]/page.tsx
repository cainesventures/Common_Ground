import BillDetailClient from './BillDetailClient'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'}/api/legislation/${id}`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return { title: 'Bill — Common Ground' }
    const data = await res.json()
    const bill = data?.data
    const title = bill?.plain_title || bill?.title || 'Bill'
    const description = bill?.summary
      ? bill.summary.slice(0, 160)
      : `Philadelphia City Council bill ${bill?.bill_number ?? ''} — Common Ground`
    return {
      title: `${title} — Common Ground`,
      description,
      openGraph: {
        title,
        description,
        type: 'article',
        siteName: 'Common Ground',
        images: [{ url: `/legislation/${id}/opengraph-image`, width: 1200, height: 630 }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: [`/legislation/${id}/opengraph-image`],
      },
    }
  } catch {
    return { title: 'Bill — Common Ground' }
  }
}

export default function BillDetailPage() {
  return <BillDetailClient />
}
