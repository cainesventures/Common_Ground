import { MetadataRoute } from 'next'

// The legislation list and This Week render on every request (they read
// searchParams), so each filter combination a crawler follows -- every bill
// page links ?tag= and ?sponsor=, This Week links ?week= back indefinitely --
// is a fresh server render against Vercel's Hobby CPU and transfer limits.
// Those URLs drew 3 of 509 Google clicks in the 30 days to 2026-11-10; bills
// are discovered through the sitemap. The bare pages stay crawlable, and the
// patterns can't match bill pages (/legislation/<id>?tab=... has a slash
// before the query).
//
// AI training crawlers are shut out entirely. On 2026-11-13/14 GPTBot fetched
// ~80k pages in a day and pushed Fast Origin Transfer from 84% to 94% of the
// Hobby cap; they send no visitors. Search engines and AI answer bots
// (Googlebot, Bingbot, Applebot, OAI-SearchBot, ChatGPT-User, PerplexityBot)
// stay on the '*' rules. Google-Extended and Applebot-Extended are opt-out
// tokens only: they withhold pages from Gemini/Apple model training without
// touching search. The Vercel firewall deny rule carries the same UA list for
// crawlers that ignore this file.
const AI_TRAINING_CRAWLERS = [
  'GPTBot',
  'CCBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'meta-externalagent',
  'FacebookBot',
  'cohere-ai',
  'cohere-training-data-crawler',
  'Diffbot',
  'Amazonbot',
  'AI2Bot',
  'Ai2Bot-Dolma',
  'Bytespider',
  'Timpibot',
  'ImagesiftBot',
  'PanguBot',
  'img2dataset',
  'omgili',
  'omgilibot',
  'Kangaroo Bot',
  'Google-Extended',
  'Applebot-Extended',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/*/legislation?', '/*/this-week?'],
      },
      {
        userAgent: AI_TRAINING_CRAWLERS,
        disallow: '/',
      },
    ],
    sitemap: 'https://opencommonground.com/sitemap.xml',
  }
}
