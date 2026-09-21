import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCityConfig } from '@/lib/city'
import { siteUrl } from '@/lib/site'
import CityLandingClient from './CityLandingClient'

// The landing page itself is a client component, so its metadata lives here.
// It deliberately does not go in [city]/layout.tsx: metadata set on a layout is
// inherited by every route beneath it, which would stamp this page's canonical
// onto all 8,600 bill pages.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>
}): Promise<Metadata> {
  const { city } = await params
  const config = getCityConfig(city)
  if (!config) return {}

  const title = `${config.fullCouncilName} Bill Tracker`
  const description =
    `Track ${config.fullCouncilName} legislation in plain English — bill summaries, ` +
    `sponsors, voting records and ${config.totalMembers} council member profiles. ` +
    `Free, independent, no ads.`
  const canonical = siteUrl(`/${city}`)

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'website' },
  }
}

export default async function CityLandingPage({
  params,
}: {
  params: Promise<{ city: string }>
}) {
  const { city } = await params
  if (!getCityConfig(city)) notFound()
  return <CityLandingClient />
}
