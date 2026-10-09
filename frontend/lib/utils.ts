import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isWithin7Days(isoDate: string): boolean {
  const d = new Date(isoDate)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  return diff > 0 && diff < 7 * 24 * 60 * 60 * 1000
}

/**
 * Message from a caught value, for display.
 *
 * A `catch` binding is `unknown`, not `Error` — the thrown value can be anything
 * (`apiFetch` throws an Error, but a network failure or a string throw does not
 * have to). This keeps the ~15 call sites that show an error to the user from
 * each repeating the same instanceof dance, and from reading `.message` off a
 * value that may not have one.
 */
export function errorMessage(e: unknown, fallback = 'Something went wrong'): string {
  if (e instanceof Error) return e.message || fallback
  if (typeof e === 'string' && e) return e
  return fallback
}

/** "in_committee" → "In Committee", "introduced" → "Introduced" */
export function fmtStatus(status: string): string {
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
