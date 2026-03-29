'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'

const LEVEL_OPTIONS = [
  { value: '', label: 'All Levels' },
  { value: 'federal', label: 'Federal' },
  { value: 'state', label: 'State' },
  { value: 'local', label: 'Local' },
]

const IMPACT_OPTIONS = [
  { value: '', label: 'All Impact' },
  { value: 'high', label: 'High Impact' },
  { value: 'medium', label: 'Medium Impact' },
  { value: 'low', label: 'Low Impact' },
]

const PAGE_SIZE = 20

const IMPACT_COLORS: Record<string, string> = {
  high:   'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low:    'bg-green-100 text-green-800',
}

const STATUS_COLORS: Record<string, string> = {
  introduced:      'bg-blue-100 text-blue-800',
  in_committee:    'bg-yellow-100 text-yellow-800',
  signed_into_law: 'bg-green-100 text-green-800',
  failed:          'bg-red-100 text-red-800',
  vetoed:          'bg-orange-100 text-orange-800',
}

interface Bill {
  id: string
  bill_number: string
  title: string
  source: string
  status: string
  level: string
  impact_level?: string
  impact_score?: number
  bill_type?: string
  tags?: string
  summary?: string
  analyzed_at?: string
}

function BillCard({ bill }: { bill: Bill }) {
  const impactColor = bill.impact_level ? IMPACT_COLORS[bill.impact_level] : null
  const statusColor = STATUS_COLORS[bill.status] ?? 'bg-gray-100 text-gray-700'

  let tags: string[] = []
  try { tags = bill.tags ? JSON.parse(bill.tags) : [] } catch { tags = [] }

  return (
    <Link
      href={`/legislation/${bill.id}`}
      className="block border rounded-lg p-4 hover:border-primary/60 hover:shadow-sm transition-all space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-muted-foreground font-mono">{bill.bill_number}</span>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {impactColor && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${impactColor}`}>
              {bill.impact_level}
            </span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${statusColor}`}>
            {bill.status?.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      <p className="text-sm font-medium leading-snug line-clamp-2">{bill.title}</p>

      {bill.summary && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{bill.summary}</p>
      )}

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 3).map((tag) => (
            <span key={tag} className="text-xs bg-muted px-1.5 py-0.5 rounded">{tag}</span>
          ))}
        </div>
      )}

      {!bill.analyzed_at && (
        <p className="text-xs text-muted-foreground italic">Pending analysis</p>
      )}
    </Link>
  )
}

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
  const [bills, setBills] = useState<Bill[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [level, setLevel] = useState('')

  const load = useCallback((newOffset: number, q: string, l: string) => {
    setLoading(true)
    setError(null)
    api.searchLegislation(q, PAGE_SIZE, newOffset, l)
      .then((data) => {
        setBills(data?.results ?? [])
        setTotal(data?.total ?? 0)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load(0, search, level)
    setOffset(0)
  }, [search, level, load])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Philadelphia City Council</h1>
        <p className="text-muted-foreground mt-1">
          Browse legislation and see what different perspectives have to say.
        </p>
      </div>

      {/* Search + filters */}
      <form onSubmit={handleSearch} className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search bills…"
          className="h-9 flex-1 min-w-48 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Search
        </button>
        <Select value={level} onChange={setLevel} options={LEVEL_OPTIONS} />
        {(search || level) && (
          <button
            type="button"
            onClick={() => { setSearch(''); setSearchInput(''); setLevel('') }}
            className="text-xs text-muted-foreground underline hover:no-underline"
          >
            Reset
          </button>
        )}
      </form>

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-36 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load bills: {error}. Is the backend running?
        </div>
      )}

      {!loading && !error && bills.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg font-medium mb-2">No bills found</p>
          <p className="text-sm">
            {search || level ? (
              <button onClick={() => { setSearch(''); setSearchInput(''); setLevel('') }} className="underline hover:no-underline">
                Clear filters
              </button>
            ) : (
              <>
                <Link href="/admin" className="underline hover:no-underline">Ingest legislation</Link>
                {' '}to get started.
              </>
            )}
          </p>
        </div>
      )}

      {!loading && bills.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground mb-3">{total} bill{total !== 1 ? 's' : ''}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {bills.map((bill) => (
              <BillCard key={bill.id} bill={bill} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <button
                onClick={() => {
                  const newOffset = Math.max(0, offset - PAGE_SIZE)
                  setOffset(newOffset)
                  load(newOffset, search, level)
                }}
                disabled={offset === 0}
                className="text-sm px-3 py-1.5 rounded-md border disabled:opacity-40 hover:bg-muted/40 transition-colors"
              >
                ← Previous
              </button>
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => {
                  const newOffset = offset + PAGE_SIZE
                  setOffset(newOffset)
                  load(newOffset, search, level)
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
