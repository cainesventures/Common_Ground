/**
 * One canonical origin for the whole site.
 *
 * Search engines treat apex and www as separate sites, so every canonical tag,
 * OG url, sitemap entry and JSON-LD id has to agree on one of them. The apex is
 * the one already baked into sitemap.xml, robots.txt and metadataBase, so it
 * wins; Vercel redirects www -> apex.
 */
export const SITE_URL = 'https://opencommonground.com'

/** Absolute URL for a site-relative path, for canonical/OG/JSON-LD use. */
export function siteUrl(path = ''): string {
  if (!path || path === '/') return SITE_URL
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

/** Metadata fragment marking a page as private — keeps it out of the index. */
export const NOINDEX = {
  robots: { index: false, follow: false },
} as const
