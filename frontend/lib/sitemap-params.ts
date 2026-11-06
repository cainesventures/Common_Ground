/**
 * Detail pages to build at deploy time, read from the sitemaps.
 *
 * publish.ps1 regenerates the sitemaps and commits them in the push that
 * triggers the deploy, so these lists match the database the build reads from
 * without another backend call. Google crawls these same URLs, which is the
 * traffic that was rendering a page per hit (Nov 2026: bill pages were ~70% of
 * the Vercel free tier's function CPU).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

export function idsFromSitemaps(files: string[], city: string, section: string): string[] {
  // Preview and CI builds have no backend to build from; pages render on demand.
  if (!process.env.NEXT_PUBLIC_BACKEND_URL) return []
  const loc = new RegExp(`<loc>https?://[^/<]+/${city}/${section}/([^/<?#]+)</loc>`, 'g')
  const ids: string[] = []
  for (const file of files) {
    const xml = readFileSync(path.join(process.cwd(), 'public', file), 'utf8')
    for (const m of xml.matchAll(loc)) ids.push(decodeURIComponent(m[1]))
  }
  return ids
}

/**
 * Bills to build at deploy time. All ~8,700 take 10-15 minutes, too slow for
 * every push, so Vercel's git deploy builds none and goes live in ~1.5 minutes;
 * .github/workflows/prerender-deploy.yml then redeploys the same commit with
 * PRERENDER_BILLS=all. A number builds that many, for testing. A bill that was
 * not built renders on its first request and is cached from then on.
 */
export function billIdsToPrerender(city: string): string[] {
  const setting = process.env.PRERENDER_BILLS
  if (!setting) return []
  const ids = idsFromSitemaps(['sitemap-bills.xml', 'sitemap-bills-archive.xml'], city, 'legislation')
  return setting === 'all' ? ids : ids.slice(0, Number(setting))
}
