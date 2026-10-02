/**
 * Server-side bill lookup, shared by layout.tsx, page.tsx and generateMetadata.
 *
 * Next dedupes identical fetches within a request, so all three callers cost
 * one call between them.
 *
 * MISSING means the API said 404, so the bill genuinely does not exist and the
 * route should 404 too. A null means the lookup failed for some other reason —
 * the API was unreachable, or returned a 500 — and that must NOT become a 404,
 * or a transient backend blip would tell crawlers a real bill had been removed.
 */
export const MISSING = Symbol.for('bill.missing')

export async function getBill(id: string): Promise<any | typeof MISSING | null> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'}/api/legislation/${id}`,
      { next: { revalidate: 3600 } },
    )
    if (res.status === 404) return MISSING
    if (!res.ok) return null
    const data = await res.json()
    return data?.data ?? MISSING
  } catch {
    return null
  }
}
