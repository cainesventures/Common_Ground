/**
 * Presentation for each bill category: label, gradient and icon.
 *
 * The tag -> category mapping itself is NOT here. It lives in
 * app/data/tag_categories.json, shared with the API, and reaches this file via
 * the generated module imported below.
 */
import { TAG_TO_CATEGORY } from './tag-categories.generated'

export interface BillCategory {
  label: string
  gradient: string        // Tailwind bg gradient classes
  iconColor: string       // Tailwind text color for the icon
  iconBg: string          // Tailwind bg for icon circle
  icon: string            // lucide icon key (matched in BillCard)
}

export const BILL_CATEGORIES: Record<string, BillCategory> = {
  zoning: {
    label: 'Zoning & Development',
    gradient: 'from-orange-500 to-amber-400',
    iconColor: 'text-orange-700 dark:text-orange-400',
    iconBg: 'bg-orange-100 dark:bg-orange-900/40',
    icon: 'Building2',
  },
  budget: {
    label: 'Budget & Finance',
    gradient: 'from-emerald-600 to-green-400',
    iconColor: 'text-emerald-700 dark:text-emerald-400',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
    icon: 'DollarSign',
  },
  transportation: {
    label: 'Transportation',
    gradient: 'from-blue-600 to-sky-400',
    iconColor: 'text-blue-700 dark:text-blue-400',
    iconBg: 'bg-blue-100 dark:bg-blue-900/40',
    icon: 'Train',
  },
  'public safety': {
    label: 'Public Safety',
    gradient: 'from-red-600 to-rose-400',
    iconColor: 'text-red-700 dark:text-red-400',
    iconBg: 'bg-red-100 dark:bg-red-900/40',
    icon: 'Shield',
  },
  'civil rights': {
    label: 'Civil Rights',
    gradient: 'from-violet-600 to-purple-400',
    iconColor: 'text-violet-700 dark:text-violet-400',
    iconBg: 'bg-violet-100 dark:bg-violet-900/40',
    icon: 'Scale',
  },
  environment: {
    label: 'Environment',
    gradient: 'from-teal-600 to-emerald-400',
    iconColor: 'text-teal-700 dark:text-teal-400',
    iconBg: 'bg-teal-100 dark:bg-teal-900/40',
    icon: 'Leaf',
  },
  health: {
    label: 'Public Health',
    gradient: 'from-pink-500 to-rose-400',
    iconColor: 'text-pink-700 dark:text-pink-400',
    iconBg: 'bg-pink-100 dark:bg-pink-900/40',
    icon: 'Heart',
  },
  education: {
    label: 'Education',
    gradient: 'from-yellow-500 to-amber-400',
    iconColor: 'text-yellow-700 dark:text-yellow-400',
    iconBg: 'bg-yellow-100 dark:bg-yellow-900/40',
    icon: 'BookOpen',
  },
  business: {
    label: 'Business & Commerce',
    gradient: 'from-indigo-600 to-blue-400',
    iconColor: 'text-indigo-700 dark:text-indigo-400',
    iconBg: 'bg-indigo-100 dark:bg-indigo-900/40',
    icon: 'Briefcase',
  },
  government: {
    label: 'City Government',
    gradient: 'from-slate-600 to-gray-400',
    iconColor: 'text-slate-700 dark:text-slate-400',
    iconBg: 'bg-slate-100 dark:bg-slate-800',
    icon: 'Landmark',
  },
  community: {
    label: 'Community & Neighborhoods',
    gradient: 'from-cyan-600 to-teal-400',
    iconColor: 'text-cyan-700 dark:text-cyan-400',
    iconBg: 'bg-cyan-100 dark:bg-cyan-900/40',
    icon: 'Home',
  },
  immigration: {
    label: 'Immigration',
    gradient: 'from-violet-500 to-indigo-400',
    iconColor: 'text-violet-700 dark:text-violet-400',
    iconBg: 'bg-violet-100 dark:bg-violet-900/40',
    icon: 'Globe',
  },
}

// Tag-to-category key mapping (lowercase tags → category key above)
/**
 * Re-exported from the generated module so there is one mapping, not two.
 *
 * This was a hand-maintained literal here and a second one in
 * app/api/legislation_routes.py. They drifted, and nothing noticed until the
 * Categories filter was measured: the API reported Public Safety 13 against
 * 704 uses of the tag. Edit app/data/tag_categories.json instead; this file
 * keeps only the presentation (labels, gradients, icons), which the API has no
 * use for.
 */

const DEFAULT_CATEGORY: BillCategory = {
  label: 'City Council',
  gradient: 'from-gray-500 to-gray-400',
  iconColor: 'text-gray-600 dark:text-gray-400',
  iconBg: 'bg-gray-100 dark:bg-gray-800',
  icon: 'FileText',
}

/** Reverse map: category key → all tags that belong to it */
export const CATEGORY_TAGS: Record<string, string[]> = (() => {
  const map: Record<string, Set<string>> = {}
  for (const [tag, cat] of Object.entries(TAG_TO_CATEGORY)) {
    // Every spelling, not just the one the map happens to use: this list is
    // what gets sent as &tag=... when a category is selected, so a bucket
    // written 'public safety' has to query 'public-safety' as well or the
    // filter returns almost nothing.
    if (!map[cat]) map[cat] = new Set()
    for (const v of tagVariants(tag)) map[cat].add(v)
  }
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v]]))
})()

/**
 * Spelling variants of one tag.
 *
 * The map is written with spaces ('public safety') but the tags on bills are
 * hyphenated ('public-safety'), so the biggest categories matched nothing at
 * all. Normalising at lookup fixes every such pair at once.
 */
function tagVariants(tag: string): string[] {
  const key = tag.toLowerCase().trim()
  return [...new Set([key, key.replace(/[-_]/g, ' '), key.replace(/ /g, '-')])]
}

export function categoryKeyForTag(tag: string): string | undefined {
  for (const v of tagVariants(tag)) {
    const hit = TAG_TO_CATEGORY[v]
    if (hit) return hit
  }
  return undefined
}

export function getBillCategory(tags: string[]): BillCategory {
  for (const tag of tags) {
    const key = categoryKeyForTag(tag)
    if (key && BILL_CATEGORIES[key]) return BILL_CATEGORIES[key]
  }
  return DEFAULT_CATEGORY
}
