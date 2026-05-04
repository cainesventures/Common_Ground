// Single source of truth for all semantic badge colors.
// Each value is a Tailwind className string that works in both light and dark mode.

export const STATUS_COLORS: Record<string, string> = {
  introduced:       'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  in_committee:     'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  active:           'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  passed:           'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  signed:           'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  signed_into_law:  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  failed:           'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  vetoed:           'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  pending:          'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
}

export const STATUS_COLORS_FALLBACK = 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'

export const IMPACT_COLORS: Record<string, string> = {
  high:   'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  low:    'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
}

export const IMPACT_ACCENT: Record<string, string> = {
  high:   '#ef4444',
  medium: '#f59e0b',
  low:    '#22c55e',
}

export const VOTE_COLORS: Record<string, string> = {
  Yea:     'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  Nay:     'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  Abstain: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
}

export const POSITION_STYLES: Record<string, string> = {
  support: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-300 dark:border-green-800',
  oppose:  'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800',
  neutral: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700',
  mixed:   'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:border-yellow-800',
}

export const TALLY_BAR_COLORS: Record<string, string> = {
  support: 'bg-green-500 dark:bg-green-600',
  oppose:  'bg-red-500 dark:bg-red-600',
  neutral: 'bg-gray-400 dark:bg-gray-500',
  mixed:   'bg-yellow-400 dark:bg-yellow-500',
}

export const HEARING_BADGE = 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
