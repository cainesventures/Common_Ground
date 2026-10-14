import { permanentRedirect } from 'next/navigation'

/**
 * Retired: this analysis now lives at /[city]/insights/what-dies, and the list
 * of the bills lives on the legislation page behind its "died without a vote"
 * filter.
 *
 * Kept as a permanent redirect rather than deleted. The URL is in the sitemap,
 * is linked from /blog/philadelphia-cyclist-rules-never-voted, and may be
 * indexed or bookmarked; removing it outright would break those and throw away
 * whatever ranking it had.
 */
export default async function LapsedRedirect({
  params,
}: {
  params: Promise<{ city: string }>
}) {
  const { city } = await params
  permanentRedirect(`/${city}/insights/what-dies`)
}
