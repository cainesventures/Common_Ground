'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { DebateCard } from '@/components/DebateCard'
import { api } from '@/lib/api'

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'researching', label: 'Researching' },
  { value: 'failed', label: 'Failed' },
]

const LEVEL_OPTIONS = [
  { value: '', label: 'All Levels' },
  { value: 'federal', label: 'Federal' },
  { value: 'state', label: 'State' },
  { value: 'local', label: 'Local' },
]

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'most_viewed', label: 'Most Viewed' },
  { value: 'most_shared', label: 'Most Shared' },
]

const PAGE_SIZE = 20

const TOPIC_TAGS = [
  'Immigration', 'Healthcare', 'Climate', 'Economy', 'Education',
  'Housing', 'Civil Rights', 'National Security', 'Taxes', 'Energy',
]

function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

export default function HomePage() {
  const [debates, setDebates] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [status, setStatus] = useState('')
  const [level, setLevel] = useState('')
  const [sort, setSort] = useState('newest')
  const [tag, setTag] = useState('')

  const load = useCallback((newOffset: number, s: string, l: string, so: string, t: string) => {
    setLoading(true)
    setError(null)
    api.getDebates(PAGE_SIZE, newOffset, {
      status: s || undefined,
      level: l || undefined,
      sort: so,
      tag: t || undefined,
    })
      .then((data) => {
        setDebates(data?.debates ?? [])
        setTotal(data?.total ?? 0)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load(0, status, level, sort, tag)
    setOffset(0)
  }, [status, level, sort, tag, load])

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Debate Feed</h1>
          <p className="text-muted-foreground mt-1">
            Watch AI agents debate legislation — then vote on where you stand.
          </p>
        </div>
        <Link
          href="/debates/new"
          className="shrink-0 inline-flex items-center justify-center rounded-md px-4 h-9 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + New Debate
        </Link>
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        <Select value={level} onChange={setLevel} options={LEVEL_OPTIONS} />
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-sm text-muted-foreground">Sort:</span>
          <Select value={sort} onChange={setSort} options={SORT_OPTIONS} />
        </div>
        {(status || level || sort !== 'newest' || tag) && (
          <button
            onClick={() => { setStatus(''); setLevel(''); setSort('newest'); setTag('') }}
            className="text-xs text-muted-foreground underline hover:no-underline"
          >
            Reset
          </button>
        )}
      </div>

      {/* Topic tag pills */}
      <div className="mb-6 flex flex-wrap gap-2">
        {TOPIC_TAGS.map((t) => (
          <button
            key={t}
            onClick={() => setTag(tag === t ? '' : t)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              tag === t
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:border-primary hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-44 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load debates: {error}. Is the backend running?
        </div>
      )}

      {!loading && !error && debates.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg font-medium mb-2">No debates found</p>
          <p className="text-sm">
            {status || level || tag ? (
              <button onClick={() => { setStatus(''); setLevel(''); setTag('') }} className="underline hover:no-underline">
                Clear filters
              </button>
            ) : (
              <>
                <Link href="/admin" className="underline hover:no-underline">Ingest legislation</Link>
                {' '}then{' '}
                <Link href="/debates/new" className="underline hover:no-underline">create a debate</Link>
                {' '}to get started.
              </>
            )}
          </p>
        </div>
      )}

      {!loading && debates.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {debates.map((debate) => (
              <DebateCard key={debate.id} debate={debate} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <button
                onClick={() => {
                  const newOffset = Math.max(0, offset - PAGE_SIZE)
                  setOffset(newOffset)
                  load(newOffset, status, level, sort, tag)
                }}
                disabled={offset === 0}
                className="text-sm px-3 py-1.5 rounded-md border disabled:opacity-40 hover:bg-muted/40 transition-colors"
              >
                ← Previous
              </button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages} <span className="text-xs">({total} debates)</span>
              </span>
              <button
                onClick={() => {
                  const newOffset = offset + PAGE_SIZE
                  setOffset(newOffset)
                  load(newOffset, status, level, sort, tag)
                }}
                disabled={offset + PAGE_SIZE >= total}
                className="text-sm px-3 py-1.5 rounded-md border disabled:opacity-40 hover:bg-muted/40 transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
