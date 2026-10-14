import InsightsClient from '../InsightsClient'
import { sectionMetadata, parseInsightsParams } from '../insights-meta'

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params
  return sectionMetadata('activity', city)
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; year?: string }>
}) {
  const { tag, year } = parseInsightsParams(await searchParams)
  return <InsightsClient section="activity" initialTag={tag} initialYear={year} />
}
