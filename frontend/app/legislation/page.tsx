'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'

const LEVELS = ['federal', 'state', 'local'] as const
type Level = typeof LEVELS[number]

const LEVEL_LABELS: Record<string, string> = {
  federal: 'Federal',
  state: 'State',
  local: 'Local',
}

const LEVEL_COLORS: Record<string, string> = {
  federal: 'bg-blue-100 text-blue-700',
  state: 'bg-purple-100 text-purple-700',
  local: 'bg-green-100 text-green-700',
}

const LEVEL_ACTIVE: Record<string, string> = {
  federal: 'bg-blue-600 text-white',
  state: 'bg-purple-600 text-white',
  local: 'bg-green-600 text-white',
}

interface LegislationResult {
  id: string
  bill_number: string
  title: string
  source: string
  status: string
  level?: string
}

export default function LegislationPage() {
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<Level | ''>('')
  const [results, setResults] = useState<LegislationResult[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)

  const fetchResults = async (q: string, lv: Level | '') => {
    setLoading(true)
    setError('')
    setSearched(!!q)
    try {
      const data = q.trim()
        ? await api.searchLegislation(q.trim(), 20, 0, lv)
        : await api.listLegislation(20, 0, lv)
      setResults(data?.results ?? [])
      setTotal(data?.total ?? 0)
    } catch (e: any) {
      setError(e.message ?? 'Failed to load legislation')
      setResults([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchResults(query, level)
  }, [level]) // re-fetch when level changes

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault()
    fetchResults(query, level)
  }

  const handleLevelClick = (lv: Level) => {
    setLevel(prev => prev === lv ? '' : lv)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Legislation</h1>
        <p className="text-muted-foreground mt-1">Search federal, state, and local bills.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {LEVELS.map((lv) => (
          <button
            key={lv}
            onClick={() => handleLevelClick(lv)}
            className={`text-sm font-medium px-3 py-1.5 rounded-full border transition-colors ${
              level === lv
                ? LEVEL_ACTIVE[lv]
                : 'border-border bg-background hover:bg-muted/60'
            }`}
          >
            {LEVEL_LABELS[lv]}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search bills by title or number…"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center rounded-md px-4 h-9 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && (
        <p className="text-sm text-destructive">Error: {error}</p>
      )}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      )}

      {!loading && !error && results.length > 0 && (
        <>
          {(searched || level) && (
            <p className="text-sm text-muted-foreground">{total} result{total !== 1 ? 's' : ''} found</p>
          )}
          <div className="divide-y border rounded-lg overflow-hidden">
            {results.map((bill) => (
              <Link
                key={bill.id}
                href={`/legislation/${bill.id}`}
                className="flex items-start gap-3 p-4 bg-background hover:bg-muted/40 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {bill.level && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${LEVEL_COLORS[bill.level] ?? 'bg-gray-100 text-gray-600'}`}>
                        {LEVEL_LABELS[bill.level] ?? bill.level}
                      </span>
                    )}
                    {bill.bill_number && (
                      <span className="text-xs text-muted-foreground font-mono">{bill.bill_number}</span>
                    )}
                    <span className="text-xs text-muted-foreground capitalize">{bill.status?.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="text-sm font-medium line-clamp-2">{bill.title}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 mt-1">View →</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {!loading && !error && searched && results.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">No bills found for &quot;{query}&quot;{level ? ` in ${LEVEL_LABELS[level]}` : ''}.</p>
      )}

      {!loading && !error && !searched && results.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">
          {level ? `No ${LEVEL_LABELS[level].toLowerCase()} legislation ingested yet.` : 'No legislation has been ingested yet.'}{' '}
          <Link href="/admin" className="underline hover:no-underline">
            Ingest bills
          </Link>{' '}
          to get started.
        </p>
      )}
    </div>
  )
}
