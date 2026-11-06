/**
 * Server-side related-bills lookup for the bill page.
 *
 * Fetched during the server render so the links are in the HTML. The list it
 * replaced was fetched in the browser after load, which meant a crawler never
 * saw a single link from one bill to another, and a reader saw the section pop
 * in late, if at all.
 *
 * A null means the lookup failed. The page still renders, and the client
 * fetches the list itself, so a backend blip costs the server HTML its links
 * for one ISR cycle rather than costing the reader the section.
 */
import type { RelatedBills } from '@/lib/types'
import { backendUrl, DATA_REVALIDATE, failDuringBuild } from '@/lib/backend'

export async function getRelated(id: string): Promise<RelatedBills | null> {
  const related = await lookupRelated(id)
  if (related === null) failDuringBuild(`related bills for ${id}`)
  return related
}

async function lookupRelated(id: string): Promise<RelatedBills | null> {
  try {
    const res = await fetch(
      backendUrl(`/api/legislation/${id}/related`),
      { next: { revalidate: DATA_REVALIDATE } },
    )
    if (!res.ok) return null
    const data = await res.json()
    return data?.data ?? null
  } catch {
    return null
  }
}
