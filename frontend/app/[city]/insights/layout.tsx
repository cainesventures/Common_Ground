import type { Metadata } from 'next'
import { getCityConfig } from '@/lib/city'
import { siteUrl } from '@/lib/site'

// The index page is a client component; this carries its metadata.
// [year]/page.tsx sets its own canonical, so it does not inherit this one.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>
}): Promise<Metadata> {
  const { city } = await params
  const config = getCityConfig(city)
  if (!config) return {}

  const title = `${config.fullCouncilName} Insights & Voting Data`
  const description =
    `Data on ${config.fullCouncilName}: pass rates, contested votes, member ` +
    `agreement, sponsorship leaders and a year-by-year legislative review.`
  const canonical = siteUrl(`/${city}/insights`)

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'website' },
  }
}

export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
