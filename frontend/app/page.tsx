import { permanentRedirect } from 'next/navigation'

// 308, not 307: a temporary redirect tells search engines to keep indexing "/"
// and leaves the ranking signal split between it and the city landing page.
export default function RootPage() {
  permanentRedirect('/philadelphia')
}
