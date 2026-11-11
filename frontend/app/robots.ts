import { MetadataRoute } from 'next'

// The legislation list and This Week render on every request (they read
// searchParams), so each filter combination a crawler follows -- every bill
// page links ?tag= and ?sponsor=, This Week links ?week= back indefinitely --
// is a fresh server render against Vercel's Hobby CPU and transfer limits.
// Those URLs drew 3 of 509 Google clicks in the 30 days to 2026-11-10; bills
// are discovered through the sitemap. The bare pages stay crawlable, and the
// patterns can't match bill pages (/legislation/<id>?tab=... has a slash
// before the query).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/*/legislation?', '/*/this-week?'],
    },
    sitemap: 'https://opencommonground.com/sitemap.xml',
  }
}
