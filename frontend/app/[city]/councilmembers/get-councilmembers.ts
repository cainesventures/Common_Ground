/**
 * Server-side council member list, shared by page.tsx and generateMetadata.
 *
 * Next dedupes identical fetches within a request, so both callers cost one
 * call between them.
 *
 * A null means the lookup failed — the API was unreachable, or returned a
 * non-200. The client component falls back to its own fetch in that case, so a
 * transient backend blip degrades to the old client-rendered behaviour rather
 * than serving an empty page.
 */
import type { CouncilmemberWithTenure } from '@/lib/types'
import { backendUrl, DATA_REVALIDATE, failDuringBuild } from '@/lib/backend'

export async function getCouncilmembers(): Promise<CouncilmemberWithTenure[] | null> {
  const members = await lookupCouncilmembers()
  if (members === null) failDuringBuild('the council member list')
  return members
}

async function lookupCouncilmembers(): Promise<CouncilmemberWithTenure[] | null> {
  try {
    const res = await fetch(
      backendUrl('/api/councilmembers'),
      { next: { revalidate: DATA_REVALIDATE } },
    )
    if (!res.ok) return null
    const data = await res.json()
    return data?.members ?? null
  } catch {
    return null
  }
}
