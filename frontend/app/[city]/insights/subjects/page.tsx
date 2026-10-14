import InsightsClient from '../InsightsClient'
import { sectionMetadata, parseInsightsParams } from '../insights-meta'
import type { SubjectOutput } from '@/components/insights/SubjectOutputSection'

/**
 * Fetched server-side so the output figures are in the HTML, like the lapsed
 * section. This is the half of the subject story that says what Council
 * actually produces, and it should be readable without JavaScript.
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
  return sectionMetadata('subjects', city)
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
  return <InsightsClient section="subjects" initialTag={tag} initialYear={year} output={output} />
}
