/**
 * Maps bill tags to a visual category used in the news-headline card style.
 * Each category has a label, gradient colors, and a lucide icon name.
 */

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
    iconColor: 'text-orange-600',
    iconBg: 'bg-orange-100 dark:bg-orange-900/40',
    icon: 'Building2',
  },
  budget: {
    label: 'Budget & Finance',
    gradient: 'from-emerald-600 to-green-400',
    iconColor: 'text-emerald-600',
    iconBg: 'bg-emerald-100 dark:bg-emerald-900/40',
    icon: 'DollarSign',
  },
  transportation: {
    label: 'Transportation',
    gradient: 'from-blue-600 to-sky-400',
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-100 dark:bg-blue-900/40',
    icon: 'Train',
  },
  'public safety': {
    label: 'Public Safety',
    gradient: 'from-red-600 to-rose-400',
    iconColor: 'text-red-600',
    iconBg: 'bg-red-100 dark:bg-red-900/40',
    icon: 'Shield',
  },
  'civil rights': {
    label: 'Civil Rights',
    gradient: 'from-violet-600 to-purple-400',
    iconColor: 'text-violet-600',
    iconBg: 'bg-violet-100 dark:bg-violet-900/40',
    icon: 'Scale',
  },
  environment: {
    label: 'Environment',
    gradient: 'from-teal-600 to-emerald-400',
    iconColor: 'text-teal-600',
    iconBg: 'bg-teal-100 dark:bg-teal-900/40',
    icon: 'Leaf',
  },
  health: {
    label: 'Public Health',
    gradient: 'from-pink-500 to-rose-400',
    iconColor: 'text-pink-600',
    iconBg: 'bg-pink-100 dark:bg-pink-900/40',
    icon: 'Heart',
  },
  education: {
    label: 'Education',
    gradient: 'from-yellow-500 to-amber-400',
    iconColor: 'text-yellow-600',
    iconBg: 'bg-yellow-100 dark:bg-yellow-900/40',
    icon: 'BookOpen',
  },
  business: {
    label: 'Business & Commerce',
    gradient: 'from-indigo-600 to-blue-400',
    iconColor: 'text-indigo-600',
    iconBg: 'bg-indigo-100 dark:bg-indigo-900/40',
    icon: 'Briefcase',
  },
  government: {
    label: 'City Government',
    gradient: 'from-slate-600 to-gray-400',
    iconColor: 'text-slate-600',
    iconBg: 'bg-slate-100 dark:bg-slate-800',
    icon: 'Landmark',
  },
  community: {
    label: 'Community & Neighborhoods',
    gradient: 'from-cyan-600 to-teal-400',
    iconColor: 'text-cyan-600',
    iconBg: 'bg-cyan-100 dark:bg-cyan-900/40',
    icon: 'Home',
  },
  immigration: {
    label: 'Immigration',
    gradient: 'from-violet-500 to-indigo-400',
    iconColor: 'text-violet-600',
    iconBg: 'bg-violet-100 dark:bg-violet-900/40',
    icon: 'Globe',
  },
}

// Tag-to-category key mapping (lowercase tags → category key above)
const TAG_TO_CATEGORY: Record<string, string> = {
  // Zoning
  'zoning': 'zoning', 'land use': 'zoning', 'land-use': 'zoning', 'land_use': 'zoning',
  'land use planning': 'zoning', 'planning': 'zoning', 'development': 'zoning',
  'neighborhood development': 'zoning', 'construction': 'zoning', 'residential': 'zoning',
  'physical development': 'zoning', 'urban-planning': 'zoning', 'real estate': 'zoning',
  'affordable_housing': 'zoning', 'housing': 'zoning',

  // Budget & Finance
  'budget': 'budget', 'finance': 'budget', 'taxation': 'budget', 'taxes': 'budget',
  'tax': 'budget', 'revenue': 'budget', 'fees': 'budget', 'funding': 'budget',
  'capital': 'budget', 'fiscal_policy': 'budget', 'capital_budget': 'budget',
  'capital spending': 'budget', 'city finances': 'budget', 'procurement': 'budget',
  'inheritance': 'budget', 'trade': 'budget',

  // Transportation
  'transportation': 'transportation', 'public transportation': 'transportation',
  'infrastructure': 'transportation', 'traffic': 'transportation', 'parking': 'transportation',
  'parking regulations': 'transportation', 'towing': 'transportation',
  'street improvements': 'transportation', 'street management': 'transportation',
  'right-of-way': 'transportation', 'encroachments': 'transportation',

  // Public Safety
  'law enforcement': 'public safety', 'public safety': 'public safety',
  'criminal justice': 'public safety', 'civil enforcement': 'public safety',

  // Civil Rights
  'civil rights': 'civil rights', 'discrimination': 'civil rights',
  'immigration': 'immigration', 'elections': 'civil rights',
  'personal data protection': 'civil rights', 'transparency': 'civil rights',
  'fair practices ordinance': 'civil rights', 'referendum': 'civil rights',
  'home rule charter amendment': 'government',

  // Environment
  'energy': 'environment', 'utilities': 'environment', 'air management': 'environment',
  'asbestos': 'environment', 'cell towers': 'environment', 'cell_towers': 'environment',

  // Health
  'public health': 'health', 'health': 'health', 'social services': 'health',
  'children and youth': 'health', 'alcohol': 'health',

  // Education
  'education': 'education', 'school district': 'education',

  // Business
  'business': 'business', 'licensing': 'business', 'permits': 'business',
  'regulation': 'business', 'regulations': 'business', 'commerce': 'business',
  'retail': 'business', 'hotels': 'business',
  'sidewalk cafes': 'business', 'sidewalk_cafes': 'business',
  'outdoor entertainment': 'business', 'outdoor_entertainment': 'business',
  'economic development': 'business', 'economic-development': 'business',

  // Government
  'government': 'government', 'city government': 'government',
  'city-government': 'government', 'city_government': 'government',
  'government regulation': 'government', 'government policy': 'government',
  'government structure': 'government', 'city services': 'government',
  'procurement contracts': 'government', 'office': 'government',

  // Community
  'community': 'community', 'community spaces': 'community', 'public space': 'community',
  'public_space': 'community', 'arts': 'community', 'culture': 'community',
  'street renaming': 'community', 'renaming': 'community', 'naming': 'community',
  'celebration': 'community', 'decorations': 'community',
}

const DEFAULT_CATEGORY: BillCategory = {
  label: 'City Council',
  gradient: 'from-gray-500 to-gray-400',
  iconColor: 'text-gray-500',
  iconBg: 'bg-gray-100 dark:bg-gray-800',
  icon: 'FileText',
}

/** Reverse map: category key → all tags that belong to it */
export const CATEGORY_TAGS: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {}
  for (const [tag, cat] of Object.entries(TAG_TO_CATEGORY)) {
    if (!map[cat]) map[cat] = []
    map[cat].push(tag)
  }
  return map
})()

export function getBillCategory(tags: string[]): BillCategory {
  for (const tag of tags) {
    const key = TAG_TO_CATEGORY[tag.toLowerCase().trim()]
    if (key && BILL_CATEGORIES[key]) return BILL_CATEGORIES[key]
  }
  return DEFAULT_CATEGORY
}
