import { notFound } from 'next/navigation'
import { CITY_SLUG, getCityConfig } from '@/lib/city'

// Without a list of cities every page under [city] rendered per request, even
// ones with nothing request-specific in them (the city home page alone was
// ~230 renders per 12 hours, Nov 2026). Only the city this deployment serves:
// Next skips pre-rendering a whole route if any listed parent ends up with no
// child pages, and the placeholder cities have no bills or members. They still
// render on request, and unknown slugs still 404 below.
export function generateStaticParams() {
  return [{ city: CITY_SLUG }]
}

export default async function CityLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ city: string }>
}) {
  const { city } = await params
  if (!getCityConfig(city)) notFound()
  return <>{children}</>
}
