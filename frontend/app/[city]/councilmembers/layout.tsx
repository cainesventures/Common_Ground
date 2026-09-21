import type { Metadata } from 'next'
import { getCityConfig } from '@/lib/city'
import { siteUrl } from '@/lib/site'

// The index page is a client component; this carries its metadata.
// [id]/page.tsx sets its own canonical, so it does not inherit this one.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>
}): Promise<Metadata> {
  const { city } = await params
  const config = getCityConfig(city)
  if (!config) return {}

  const title = `${config.fullCouncilName} Members`
  const description =
    `All ${config.totalMembers} ${config.fullCouncilName} members — district maps, ` +
    `voting records, sponsored bills and contact details.`
  const canonical = siteUrl(`/${city}/councilmembers`)

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'website' },
  }
}

export default function CouncilmembersLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
