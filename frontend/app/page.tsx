import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Open Common Ground — City Council Bill Tracker',
  description: 'Track city council legislation with AI summaries and 17 political perspectives. Free, independent, no ads.',
}

const CITIES = [
  {
    slug: 'philadelphia',
    name: 'Philadelphia',
    subtitle: 'Philadelphia City Council',
    description: '26 years of legislation, AI-analyzed',
    available: true,
  },
  {
    slug: 'chicago',
    name: 'Chicago',
    subtitle: 'Chicago City Council',
    description: 'Coming soon',
    available: false,
  },
  {
    slug: 'new-york',
    name: 'New York',
    subtitle: 'New York City Council',
    description: 'Coming soon',
    available: false,
  },
]

export default function CitySelectPage() {
  return (
    <div className="max-w-2xl mx-auto py-16 px-4 space-y-10">
      <div className="text-center space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Open Common Ground</h1>
        <p className="text-muted-foreground text-base">
          Track city council legislation in plain English — free, independent, no ads.
        </p>
      </div>

      <div className="space-y-3">
        {CITIES.map((city) =>
          city.available ? (
            <Link
              key={city.slug}
              href={`/${city.slug}`}
              className="flex items-center justify-between border rounded-xl p-5 hover:border-primary/60 hover:bg-muted/20 transition-all group"
            >
              <div>
                <p className="font-semibold text-base">{city.name}</p>
                <p className="text-sm text-muted-foreground">{city.subtitle}</p>
                <p className="text-xs text-primary mt-1">{city.description}</p>
              </div>
              <span className="text-muted-foreground group-hover:text-foreground transition-colors text-lg">→</span>
            </Link>
          ) : (
            <div
              key={city.slug}
              className="flex items-center justify-between border rounded-xl p-5 opacity-50 cursor-not-allowed"
            >
              <div>
                <p className="font-semibold text-base">{city.name}</p>
                <p className="text-sm text-muted-foreground">{city.subtitle}</p>
                <p className="text-xs text-muted-foreground mt-1">{city.description}</p>
              </div>
              <span className="text-xs border rounded-full px-2 py-0.5 text-muted-foreground">Soon</span>
            </div>
          )
        )}
      </div>

      <p className="text-center text-sm text-muted-foreground">
        More cities coming soon.{' '}
        <Link href="/about" className="underline hover:text-foreground transition-colors">Learn more</Link>
        {' '}or{' '}
        <Link href="/donate" className="underline hover:text-foreground transition-colors">support the project</Link>.
      </p>
    </div>
  )
}
