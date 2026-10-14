import InsightsClient from './InsightsClient'
import { sectionMetadata, parseInsightsParams } from './insights-meta'
import type { SubjectOutput } from '@/components/insights/SubjectOutputSection'

/**
 * Overview fetches the subject output so the key finding can be derived from
 * real figures and rendered server-side, rather than being a sentence somebody
 * has to remember to update.
 */
async function getOutput(): Promise<SubjectOutput | null> {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'
  try {
    const res = await fetch(`${base}/api/insights/subject-output`, { next: { revalidate: 3600 } })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params
  return sectionMetadata('overview', city)
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; year?: string }>
}) {
  const [{ tag, year }, output] = await Promise.all([
    parseInsightsParams(await searchParams),
    getOutput(),
  ])
  return <InsightsClient section="overview" initialTag={tag} initialYear={year} output={output} />
}
