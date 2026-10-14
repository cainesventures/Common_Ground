import InsightsClient from '../InsightsClient'
import { sectionMetadata, parseInsightsParams } from '../insights-meta'
import type { LapsedPayload } from '@/components/insights/LapsedSection'

/**
 * The one section with its own server-side data.
 *
 * Fetched here rather than in the client component so the charts and the
 * figures in the surrounding copy are in the server HTML. This section is the
 * destination for the blog post's claim, and for the /legislation/lapsed
 * redirect, so it has to be readable without running JavaScript.
 */
async function getLapsed(): Promise<LapsedPayload | null> {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'
  try {
    const res = await fetch(`${base}/api/insights/lapsed-without-vote?limit=1`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params
  return sectionMetadata('what-dies', city)
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; year?: string }>
}) {
  const [{ tag, year }, lapsed] = await Promise.all([
    parseInsightsParams(await searchParams),
    getLapsed(),
  ])
  return <InsightsClient section="what-dies" initialTag={tag} initialYear={year} lapsed={lapsed} />
}
