import type { Metadata } from 'next'
import { getCityConfig } from '@/lib/city'
import { siteUrl } from '@/lib/site'

// The index page is a server component now, but its metadata stays here so
// the page itself does nothing but fetch and hand off to the client.
// [id]/page.tsx sets its own canonical, so it does not inherit this one.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>
}): Promise<Metadata> {
  const { city } = await params
  const config = getCityConfig(city)
  if (!config) return {}

  const title = `${config.fullCouncilName} Legislation`
  const description =
    `Browse and search every ${config.fullCouncilName} bill — filter by topic, ` +
    `status, sponsor and year, with plain-English summaries.`
  const canonical = siteUrl(`/${city}/legislation`)

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'website' },
  }
}

export default function LegislationLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
