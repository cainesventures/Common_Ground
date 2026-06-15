// Canonical councilmember surname for display labels (chart axes, matrices).
//
// Mirrors the backend app/services/name_matching.surname(): take the last
// name token while dropping generational suffixes, so "Curtis Jones, Jr."
// renders as "Jones", not "Jr.". Naive name.split(' ').pop() was duplicated
// across several components and silently mislabeled the two suffixed members.

const SUFFIX_RE = /^(jr\.?|sr\.?|ii|iii|iv)$/i

/**
 * Surname for display. Drops commas and generational suffixes; any leading
 * title tokens ("Councilmember", "Council President") fall away naturally
 * since we return the last remaining token.
 *
 *   "Curtis Jones, Jr."              -> "Jones"
 *   "Councilmember Mark Squilla"     -> "Squilla"
 *   "Jeffery Young, Jr."             -> "Young"
 */
export function lastName(fullName: string): string {
  const parts = fullName.replace(/,/g, ' ').split(/\s+/).filter(p => p && !SUFFIX_RE.test(p))
  return parts[parts.length - 1] ?? fullName
}
