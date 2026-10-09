import { notFound } from 'next/navigation'
import { getCityConfig } from '@/lib/city'
import LegislationClient from './LegislationClient'
import { getLegislationList } from './get-legislation-list'
import { parseFilters, type RawSearchParams } from './legislation-filters'

// Server component so the first page of bills is in the HTML of the first
// response. Filtering, pagination and search stay on the client.
//
// Reading searchParams makes this route render per request, which is what lets
// a crawled ?tag= or ?year= URL come back with its own results. The backend
// fetch is revalidated hourly, so the repeated work is a cache read, and the
// canonical in layout.tsx points every filtered variant back at the bare page
// so the filter combinations are not themselves indexed.
export default async function LegislationPage({
  params,
  searchParams,
}: {
  params: Promise<{ city: string }>
  searchParams: Promise<RawSearchParams>
}) {
  const { city } = await params
  if (!getCityConfig(city)) notFound()

  const filters = parseFilters(await searchParams)
  // A null is passed through deliberately: it tells the client to fetch for
  // itself rather than render "no bills found" when the API was unreachable.
  const initialList = await getLegislationList(filters)

  return <LegislationClient initialFilters={filters} initialList={initialList} />
}
