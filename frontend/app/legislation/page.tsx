'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'

const LEVEL_COLORS: Record<string, string> = {
  federal: 'bg-blue-100 text-blue-700',
  state:   'bg-purple-100 text-purple-700',
  local:   'bg-green-100 text-green-700',
}

const IMPACT_ACCENT: Record<string, string> = {
  high:   '#ef4444',
  medium: '#f59e0b',
  low:    '#22c55e',
}

const STATUS_BADGE: Record<string, string> = {
  active:             'bg-green-100 text-green-700',
  passed:             'bg-blue-100 text-blue-700',
  failed:             'bg-red-100 text-red-700',
  pending:            'bg-yellow-100 text-yellow-700',
  in_committee:       'bg-purple-100 text-purple-700',
  introduced:         'bg-gray-100 text-gray-600',
  signed:             'bg-emerald-100 text-emerald-700',
  vetoed:             'bg-red-100 text-red-700',
}

interface Bill {
  id: string
  bill_number: string
  title: string
  plain_title?: string
  source: string
  status: string
  level?: string
  introduced_date?: string
  impact_level?: string
  bill_type?: string
  analyzed_at?: string
  tags?: string
}

type MonthGroup = { label: string; shortLabel: string; date: Date; bills: Bill[] }

function groupByMonth(bills: Bill[]): MonthGroup[] {
  const map = new Map<string, { date: Date; bills: Bill[] }>()
  for (const bill of bills) {
    if (!bill.introduced_date) {
      const key = 'Unknown'
      if (!map.has(key)) map.set(key, { date: new Date(0), bills: [] })
      map.get(key)!.bills.push(bill)
      continue
    }
    const d = new Date(bill.introduced_date)
    const key = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    if (!map.has(key)) map.set(key, { date: d, bills: [] })
    map.get(key)!.bills.push(bill)
  }
  return Array.from(map.entries())
    .map(([label, v]) => ({
      label,
      shortLabel: v.date.getTime() === 0
        ? '?'
        : v.date.toLocaleDateString('en-US', { month: 'short' }),
      ...v,
    }))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
}

// ── Activity Chart ──────────────────────────────────────────────────────────

function ActivityChart({ groups, activeMonth, onSelect }: {
  groups: MonthGroup[]
  activeMonth: string | null
  onSelect: (label: string) => void
}) {
  if (groups.length === 0) return null
  const max = Math.max(...groups.map(g => g.bills.length), 1)
  const chronological = [...groups].reverse()

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bill Activity</span>
        <span className="text-xs text-muted-foreground">{groups.reduce((s, g) => s + g.bills.length, 0)} bills</span>
      </div>
      <div className="flex items-end gap-1.5" style={{ height: 72 }}>
        {chronological.map(({ label, shortLabel, bills }) => {
          const isActive = activeMonth === label
          const pct = bills.length / max
          const barH = Math.max(pct * 56, 4)
          return (
            <button
              key={label}
              onClick={() => onSelect(label)}
              className="flex-1 flex flex-col items-center gap-1 group"
              title={`${label}: ${bills.length} bill${bills.length !== 1 ? 's' : ''}`}
            >
              <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity leading-none">
                {bills.length}
              </span>
              <div className="w-full flex items-end" style={{ height: 56 }}>
                <div
                  className="w-full rounded-t transition-all duration-200"
                  style={{
                    height: barH,
                    backgroundColor: isActive ? '#3b82f6' : '#3b82f620',
                    outline: isActive ? '2px solid #3b82f6' : 'none',
                  }}
                />
              </div>
              <span className={`text-[10px] leading-none transition-colors ${isActive ? 'text-blue-600 font-semibold' : 'text-muted-foreground'}`}>
                {shortLabel}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Bill Card ───────────────────────────────────────────────────────────────

function BillCard({ bill }: { bill: Bill }) {
  const accent = IMPACT_ACCENT[bill.impact_level ?? ''] ?? '#e5e7eb'
  const displayTitle = bill.plain_title || bill.title
  const statusClass = STATUS_BADGE[bill.status] ?? 'bg-gray-100 text-gray-600'

  return (
    <Link
      href={`/legislation/${bill.id}`}
      className="flex rounded-lg border bg-background hover:shadow-md transition-all group overflow-hidden"
    >
      {/* Colored left accent */}
      <div className="w-1 shrink-0" style={{ backgroundColor: accent }} />

      <div className="flex-1 min-w-0 p-3">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          {bill.bill_number && (
            <span className="text-xs font-mono text-muted-foreground shrink-0">{bill.bill_number}</span>
          )}
          {bill.status && (
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full capitalize shrink-0 ${statusClass}`}>
              {bill.status.replace(/_/g, ' ')}
            </span>
          )}
          {bill.bill_type && (
            <span className="text-[11px] text-muted-foreground/60 capitalize shrink-0">{bill.bill_type}</span>
          )}
          {bill.impact_level && (
            <span className="text-[11px] font-medium capitalize shrink-0" style={{ color: accent }}>
              {bill.impact_level} impact
            </span>
          )}
        </div>
        <p className="text-sm font-medium line-clamp-2 group-hover:text-primary transition-colors leading-snug">
          {displayTitle}
        </p>
      </div>

      <div className="flex items-center pr-3 shrink-0">
        <span className="text-muted-foreground text-xs opacity-0 group-hover:opacity-100 transition-opacity">→</span>
      </div>
    </Link>
  )
}

// ── Timeline View ────────────────────────────────────────────────────────────

function TimelineView({ bills }: { bills: Bill[] }) {
  const groups = groupByMonth(bills)
  const [activeMonth, setActiveMonth] = useState<string | null>(groups[0]?.label ?? null)

  if (groups.length === 0) return null

  const handleSelect = (label: string) => {
    setActiveMonth(label)
    const el = document.getElementById(`month-${label.replace(/\s/g, '-')}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="space-y-6">
      <ActivityChart groups={groups} activeMonth={activeMonth} onSelect={handleSelect} />

      <div className="relative">
        {/* Vertical spine */}
        <div
          className="absolute top-0 bottom-0 w-px"
          style={{ left: 116, backgroundColor: '#e5e7eb' }}
        />

        <div className="space-y-10">
          {groups.map(({ label, bills: groupBills }) => (
            <div
              key={label}
              id={`month-${label.replace(/\s/g, '-')}`}
              className="flex gap-0"
            >
              {/* Month label */}
              <div className="w-28 shrink-0 text-right pr-4 pt-1">
                <span className="text-xs font-bold text-foreground/70 whitespace-nowrap">{label}</span>
                <p className="text-[11px] text-muted-foreground">{groupBills.length} bill{groupBills.length !== 1 ? 's' : ''}</p>
              </div>

              {/* Dot on the spine */}
              <div className="relative shrink-0 flex items-start pt-1.5" style={{ width: 16 }}>
                <div
                  className="w-3.5 h-3.5 rounded-full border-2 z-10 relative"
                  style={{ borderColor: '#3b82f6', backgroundColor: '#fff', marginLeft: -7 }}
                />
              </div>

              {/* Bills */}
              <div className="flex-1 min-w-0 pl-4 space-y-2">
                {groupBills.map((bill) => (
                  <BillCard key={bill.id} bill={bill} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── List View ────────────────────────────────────────────────────────────────

function ListView({ bills }: { bills: Bill[] }) {
  return (
    <div className="divide-y border rounded-lg overflow-hidden">
      {bills.map((bill) => (
        <Link
          key={bill.id}
          href={`/legislation/${bill.id}`}
          className="flex items-start gap-3 p-4 bg-background hover:bg-muted/40 transition-colors group"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {bill.level && (
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${LEVEL_COLORS[bill.level] ?? 'bg-gray-100 text-gray-600'}`}>
                  {bill.level}
                </span>
              )}
              {bill.bill_number && (
                <span className="text-xs text-muted-foreground font-mono">{bill.bill_number}</span>
              )}
              <span className="text-xs text-muted-foreground capitalize">{bill.status?.replace(/_/g, ' ')}</span>
              {bill.introduced_date && (
                <span className="text-xs text-muted-foreground">
                  {new Date(bill.introduced_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
            </div>
            <p className="text-sm font-medium line-clamp-2">{bill.plain_title || bill.title}</p>
          </div>
          <span className="text-xs text-muted-foreground shrink-0 mt-1">View →</span>
        </Link>
      ))}
    </div>
  )
}

// ── Filter pills ─────────────────────────────────────────────────────────────

function FilterSelect({ placeholder, options, value, onChange }: {
  placeholder: string
  options: { value: string; label: string }[] | string[]
  value: string
  onChange: (v: string) => void
}) {
  if (options.length === 0) return null
  const normalized = (options as any[]).map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o
  )
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring capitalize"
    >
      <option value="">{placeholder}</option>
      {normalized.map((o) => (
        <option key={o.value} value={o.value} className="capitalize">{o.label}</option>
      ))}
    </select>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function LegislationPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Bill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const [view, setView] = useState<'list' | 'timeline'>('timeline')
  const [selectedMonth, setSelectedMonth] = useState('')
  const [selectedType, setSelectedType] = useState('')
  const [selectedTag, setSelectedTag] = useState('')
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({})

  const fetchResults = async (q: string, tag: string) => {
    setLoading(true)
    setError('')
    setSearched(!!q)
    try {
      const data = (q.trim() || tag)
        ? await api.searchLegislation(q.trim(), 50, 0, '', '', tag)
        : await api.listLegislation(50, 0)
      setResults(data?.results ?? [])
    } catch (e: any) {
      setError(e.message ?? 'Failed to load legislation')
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchResults(query, selectedTag)
    api.getTagCounts().then((data) => {
      const map: Record<string, number> = {}
      for (const { tag, count } of data?.tags ?? []) map[tag] = count
      setTagCounts(map)
    }).catch(() => {})
  }, [selectedTag])

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault()
    fetchResults(query, selectedTag)
  }

  // Derive available months and types from loaded results
  const availableMonths = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const bill of results) {
      if (!bill.introduced_date) continue
      const label = new Date(bill.introduced_date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      if (!seen.has(label)) { seen.add(label); out.push(label) }
    }
    return out
  }, [results])

  const availableTypes = useMemo(() => {
    const seen = new Set<string>()
    for (const bill of results) { if (bill.bill_type) seen.add(bill.bill_type) }
    return Array.from(seen).sort()
  }, [results])

  const availableTags = useMemo(() => {
    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag)
  }, [tagCounts])

  const filteredResults = useMemo(() => {
    return results.filter(bill => {
      if (selectedMonth) {
        if (!bill.introduced_date) return false
        const label = new Date(bill.introduced_date).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        if (label !== selectedMonth) return false
      }
      if (selectedType && bill.bill_type !== selectedType) return false
      if (selectedTag) {
        try {
          const tags: string[] = JSON.parse(bill.tags ?? '[]')
          if (!tags.includes(selectedTag)) return false
        } catch { return false }
      }
      return true
    })
  }, [results, selectedMonth, selectedType, selectedTag])

  const isFiltered = !!(selectedMonth || selectedType || selectedTag)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Legislation</h1>
          <p className="text-muted-foreground mt-1">Philadelphia City Council bills.</p>
        </div>
        {/* View toggle */}
        <div className="flex items-center gap-1 border rounded-lg p-1 shrink-0">
          <button
            onClick={() => setView('timeline')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              view === 'timeline' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Timeline
          </button>
          <button
            onClick={() => setView('list')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              view === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            List
          </button>
        </div>
      </div>

      {/* Search */}
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

      {/* Filters */}
      {!loading && results.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <FilterSelect placeholder="All Months" options={availableMonths} value={selectedMonth} onChange={setSelectedMonth} />
          <FilterSelect placeholder="All Types" options={availableTypes} value={selectedType} onChange={setSelectedType} />
          <FilterSelect
            placeholder="All Tags"
            options={availableTags.map(t => ({ value: t, label: tagCounts[t] != null ? `${t} (${tagCounts[t]})` : t }))}
            value={selectedTag}
            onChange={setSelectedTag}
          />
        </div>
      )}

      {error && <p className="text-sm text-destructive">Error: {error}</p>}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      )}

      {!loading && !error && filteredResults.length > 0 && (
        <>
          {(searched || isFiltered) && (
            <p className="text-sm text-muted-foreground">{filteredResults.length} result{filteredResults.length !== 1 ? 's' : ''}</p>
          )}
          {view === 'timeline'
            ? <TimelineView bills={filteredResults} />
            : <ListView bills={filteredResults} />
          }
        </>
      )}

      {!loading && !error && filteredResults.length === 0 && results.length > 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">
          No bills match the selected filters.
        </p>
      )}

      {!loading && !error && results.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">
          {searched ? `No bills found for "${query}".` : 'No legislation has been ingested yet.'}{' '}
          {!searched && <Link href="/admin" className="underline hover:no-underline">Ingest bills</Link>}
        </p>
      )}
    </div>
  )
}
