'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

/**
 * Route-level boundary for every city-scoped page (home, legislation, council
 * members, insights, my-bills). Without this the root app/error.tsx was the
 * only boundary in the app, so a render error anywhere under /[city] replaced
 * the whole page — nav and footer included — with the generic message.
 *
 * Keeping the boundary here preserves the chrome and offers the two routes a
 * visitor most likely wanted, instead of a dead end.
 */
export default function CityError({ error, reset }: { error: Error; reset: () => void }) {
  const { city } = useParams<{ city: string }>()

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center px-4">
      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">This page didn&apos;t load</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Something went wrong on our end. The rest of the site is still working.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium btn-primary-hover"
        >
          Try again
        </button>
        <Link
          href={`/${city}/legislation`}
          className="text-sm px-4 py-2 rounded-md border hover:bg-muted/40 transition-colors"
        >
          Browse legislation
        </Link>
      </div>
    </div>
  )
}
