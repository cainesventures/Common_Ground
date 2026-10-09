import { notFound } from 'next/navigation'
import { getCityConfig } from '@/lib/city'
import CouncilmembersClient from './CouncilmembersClient'
import { getCouncilmembers } from './get-councilmembers'

// Server component so the roster is in the HTML of the first response. The
// interactive parts -- address lookup, name filter, district map -- stay in the
// client component below. Metadata lives in layout.tsx.
export default async function CouncilmembersPage({
  params,
}: {
  params: Promise<{ city: string }>
}) {
  const { city } = await params
  if (!getCityConfig(city)) notFound()

  // A null is passed through deliberately: it tells the client to fetch for
  // itself rather than render an empty roster as if the council had no members.
  const initialMembers = await getCouncilmembers()

  return <CouncilmembersClient initialMembers={initialMembers} />
}
