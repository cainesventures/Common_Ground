import type { Metadata } from 'next'
import { NOINDEX } from '@/lib/site'

// Account-only page: not in the sitemap, but it is linked from the navbar, so
// tell crawlers explicitly rather than relying on them not finding it.
export const metadata: Metadata = { title: 'Profile', ...NOINDEX }

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
