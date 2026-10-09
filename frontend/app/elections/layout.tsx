import type { Metadata } from 'next'
import { siteUrl } from '@/lib/site'

// The page is a client component, so its metadata lives here — the same pattern
// as legislation/, councilmembers/ and insights/. Without this the route
// inherited the site-wide title and description verbatim, which made it a
// duplicate of the homepage to a crawler.
const title = 'Philadelphia Council Candidates — AI Vote Predictions'
const description =
  'Pick a Philadelphia City Council bill and see how declared candidates might vote on it, ' +
  'with the reasoning spelled out. AI-generated speculation for civic engagement, not a ' +
  'statement of any candidate’s position.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: siteUrl('/elections') },
  openGraph: {
    title,
    description,
    url: siteUrl('/elections'),
    type: 'website',
    siteName: 'Open Common Ground',
    images: [{ url: '/opengraph-image', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/opengraph-image'],
  },
}

export default function ElectionsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
