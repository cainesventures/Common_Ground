import type { Metadata } from 'next'
import { siteUrl } from '@/lib/site'

// The donate page is a client component; this carries its metadata.
// success/layout.tsx marks the post-checkout page noindex, so it does not
// inherit this canonical.
const title = 'Support Open Common Ground'
const description =
  'Open Common Ground is free, independent and ad-free. Donations cover hosting ' +
  'and keep Philadelphia City Council data open to everyone.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: siteUrl('/donate') },
  openGraph: { title, description, url: siteUrl('/donate'), type: 'website' },
}

export default function DonateLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
