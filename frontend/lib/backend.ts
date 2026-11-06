/**
 * Server-side backend fetch settings for pre-rendered pages.
 *
 * Bill pages are built at deploy time (see lib/sitemap-params.ts) so
 * crawler hits are served as files instead of running a function each time.
 * That only holds if every fetch on the page agrees on how long its data lives:
 * a route refreshes as often as its shortest fetch, so one hourly fetch brings
 * back hourly re-renders.
 */

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'

/**
 * A week. Bill data only changes on publish, and a publish redeploys and
 * rebuilds every page, so this is a backstop for a deploy that never happened,
 * not the normal refresh path. Route segments must repeat it as a literal.
 */
export const DATA_REVALIDATE = 604800

/**
 * Per-build cache key, appended to backend URLs. Vercel's Data Cache can
 * outlive a deployment and Cloudflare holds API reads for an hour, so without
 * it a build right after a publish could bake the previous day's responses
 * into every page for a week. Set in next.config.ts and inlined at build, so
 * runtime renders share the build's key.
 */
const DEPLOY_KEY = process.env.BACKEND_CACHE_KEY ?? 'dev'

export function backendUrl(path: string): string {
  const sep = path.includes('?') ? '&' : '?'
  return `${BACKEND_URL}${path}${sep}v=${DEPLOY_KEY}`
}

/**
 * A failed lookup degrades to a client-side fetch at request time, which is
 * fine for one visitor. During the build it would freeze a page without its
 * data until the next deploy, so fail the page instead: Next retries it
 * (staticGenerationRetryCount), and if it still fails the deploy fails and the
 * previous one stays live.
 */
export function failDuringBuild(what: string): void {
  // Only where a backend is configured: CI and preview builds have none, and
  // their pages are meant to fall back to client-side fetching.
  if (process.env.NEXT_PHASE === 'phase-production-build' && process.env.NEXT_PUBLIC_BACKEND_URL) {
    throw new Error(`Backend lookup failed for ${what} while pre-rendering`)
  }
}
