'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'

const PAGE_SIZE = 20

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December']

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
  signed_into_law:    'bg-emerald-100 text-emerald-700',
  vetoed:             'bg-red-100 text-red-700',
}

interface Bill {
  id: string
  bill_number: string
  title: string
  plain_title?: string
  status: string
  level?: string
  introduced_date?: string
  impact_level?: string
  bill_type?: string
  analyzed_at?: string
  tags?: string
  summary?: string
}

interface YearCount  { year: number;  count: number }
interface MonthCount { month: number; count: number }

// ── Bar Chart ────────────────────────────────────────────────────────────────

function BarChart<T extends { count: number }>({
  data,
  getLabel,
  getKey,
  activeKey,
  onSelect,
  title,
  subtitle,
}: {
  data: T[]
  getLabel: (item: T) => string
  getKey:   (item: T) => string | number
  activeKey: string | number | null
  onSelect:  (key: string | number) => void
  title: string
  subtitle?: string
}) {
  if (data.length === 0) return null
  const max = Math.max(...data.map(d => d.count), 1)
  const total = data.reduce((s, d) => s + d.count, 0)

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="text-sm font-semibold">{title}</span>
          {subtitle && <span className="text-xs text-muted-foreground ml-2">{subtitle}</span>}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{total.toLocaleString()} bills</span>
      </div>
      <div className="flex items-end gap-1" style={{ height: 100 }}>
        {data.map((item) => {
          const key  = getKey(item)
          const label = getLabel(item)
          const isActive = activeKey === key
          const barH = Math.max((item.count / max) * 72, 3)

          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              className="flex-1 flex flex-col items-center gap-0.5 group min-w-0"
              title={`${label}: ${item.count.toLocaleString()} bill${item.count !== 1 ? 's' : ''}`}
            >
              {/* Count label — always visible for active, hover for others */}
              <span className={`text-[10px] tabular-nums leading-none transition-opacity ${
                isActive ? 'text-blue-600 font-semibold opacity-100' : 'text-muted-foreground opacity-0 group-hover:opacity-100'
              }`}>
                {item.count.toLocaleString()}
              </span>

              {/* Bar */}
              <div className="w-full flex items-end" style={{ height: 72 }}>
                <div
                  className="w-full rounded-t-sm transition-all duration-150"
                  style={{
                    height: barH,
                    backgroundColor: isActive ? '#3b82f6' : '#3b82f630',
                    outline: isActive ? '2px solid #3b82f6' : 'none',
                    outlineOffset: '1px',
                  }}
                />
              </div>

              {/* X-axis label */}
              <span className={`text-[10px] leading-none truncate w-full text-center transition-colors ${
                isActive ? 'text-blue-600 font-semibold' : 'text-muted-foreground'
              }`}>
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Drill-down Chart ─────────────────────────────────────────────────────────

function DrilldownChart({
  selectedYear,
  selectedMonth,
  onYearSelect,
  onMonthSelect,
}: {
  selectedYear:  number | null
  selectedMonth: number | null
  onYearSelect:  (year: number | null) => void
  onMonthSelect: (month: number | null) => void
}) {
  const [yearCounts,  setYearCounts]  = useState<YearCount[]>([])
  const [monthCounts, setMonthCounts] = useState<MonthCount[]>([])

  useEffect(() => {
    api.getYearCounts().then((d) => setYearCounts(d?.years ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedYear) { setMonthCounts([]); return }
    api.getMonthCounts(selectedYear).then((d) => setMonthCounts(d?.months ?? [])).catch(() => {})
  }, [selectedYear])

  if (!selectedYear) {
    return (
      <BarChart
        data={yearCounts}
        getLabel={(y) => String(y.year)}
        getKey={(y) => y.year}
        activeKey={null}
        onSelect={(k) => onYearSelect(k as number)}
        title="Bill Activity"
        subtitle="click a year to drill down"
      />
    )
  }

  return (
    <div className="space-y-2">
      <BarChart
        data={monthCounts}
        getLabel={(m) => MONTH_NAMES[m.month - 1]}
        getKey={(m) => m.month}
        activeKey={selectedMonth}
        onSelect={(k) => onMonthSelect(selectedMonth === k ? null : k as number)}
        title={`${selectedYear}`}
        subtitle="click a month to filter"
      />
      <button
        onClick={() => { onYearSelect(null); onMonthSelect(null) }}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        ← All years
      </button>
    </div>
  )
}

// ── Bill Card ────────────────────────────────────────────────────────────────

function BillCard({ bill }: { bill: Bill }) {
  const accent = IMPACT_ACCENT[bill.impact_level ?? ''] ?? '#e5e7eb'
  const statusClass = STATUS_BADGE[bill.status] ?? 'bg-gray-100 text-gray-600'

  return (
    <Link
      href={`/legislation/${bill.id}`}
      className="flex rounded-lg border bg-background hover:shadow-md transition-all group overflow-hidden"
    >
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
          {bill.impact_level && (
            <span className="text-[11px] font-medium capitalize shrink-0" style={{ color: accent }}>
              {bill.impact_level} impact
            </span>
          )}
          {bill.introduced_date && (
            <span className="text-[11px] text-muted-foreground/60 shrink-0 ml-auto">
              {new Date(bill.introduced_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
        </div>
        <p className="text-sm font-medium line-clamp-2 group-hover:text-primary transition-colors leading-snug">
          {bill.plain_title || bill.title}
        </p>
        {bill.summary && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{bill.summary}</p>
        )}
      </div>
      <div className="flex items-center pr-3 shrink-0">
        <span className="text-muted-foreground text-xs opacity-0 group-hover:opacity-100 transition-opacity">→</span>
      </div>
    </Link>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

const STATUSES = [
  { value: 'introduced',    label: 'Introduced' },
  { value: 'in_committee',  label: 'In Committee' },
  { value: 'active',        label: 'Active' },
  { value: 'passed',        label: 'Passed' },
  { value: 'signed',        label: 'Signed' },
  { value: 'signed_into_law', label: 'Signed into Law' },
  { value: 'failed',        label: 'Failed' },
  { value: 'vetoed',        label: 'Vetoed' },
]

const LEVELS = [
  { value: 'local',   label: 'Local' },
  { value: 'state',   label: 'State' },
  { value: 'federal', label: 'Federal' },
]

const IMPACTS = ['high', 'medium', 'low'] as const

export default function LegislationPage() {
  const [query,          setQuery]          = useState('')
  const [queryInput,     setQueryInput]     = useState('')
  const [bills,          setBills]          = useState<Bill[]>([])
  const [total,          setTotal]          = useState(0)
  const [page,           setPage]           = useState(1)
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState('')
  const [selectedYear,   setSelectedYear]   = useState<number | null>(null)
  const [selectedMonth,  setSelectedMonth]  = useState<number | null>(null)
  const [selectedTag,    setSelectedTag]    = useState('')
  const [selectedLevel,  setSelectedLevel]  = useState('local')
  const [selectedStatus, setSelectedStatus] = useState('')
  const [selectedImpact, setSelectedImpact] = useState('')
  const [analyzedOnly,   setAnalyzedOnly]   = useState(false)
  const [tagCounts,      setTagCounts]      = useState<{tag: string; count: number}[]>([])

  const fetchBills = useCallback(async (
    q: string, year: number | null, month: number | null, tag: string,
    level: string, status: string, impact: string, analyzed: boolean, pageNum: number
  ) => {
    setLoading(true)
    setError('')
    try {
      const offset = (pageNum - 1) * PAGE_SIZE
      const data = await api.searchLegislation(
        q, PAGE_SIZE, offset, level,
        analyzed ? 'true' : '',
        tag, impact, year ?? 0, month ?? 0, status
      )
      setBills(data?.results ?? [])
      setTotal(data?.total ?? 0)
    } catch (e: any) {
      setError(e.message ?? 'Failed to load legislation')
      setBills([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    api.getTagCounts().then((d) => setTagCounts(d?.tags ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    fetchBills(query, selectedYear, selectedMonth, selectedTag, selectedLevel, selectedStatus, selectedImpact, analyzedOnly, page)
  }, [query, selectedYear, selectedMonth, selectedTag, selectedLevel, selectedStatus, selectedImpact, analyzedOnly, page, fetchBills])

  const reset = (overrides: Partial<{
    year: number | null; month: number | null; tag: string; level: string;
    status: string; impact: string; analyzed: boolean; q: string
  }> = {}) => {
    setPage(1)
    if ('year'     in overrides) { setSelectedYear(overrides.year!); setSelectedMonth(null) }
    if ('month'    in overrides) setSelectedMonth(overrides.month!)
    if ('tag'      in overrides) setSelectedTag(overrides.tag!)
    if ('level'    in overrides) setSelectedLevel(overrides.level!)
    if ('status'   in overrides) setSelectedStatus(overrides.status!)
    if ('impact'   in overrides) setSelectedImpact(overrides.impact!)
    if ('analyzed' in overrides) setAnalyzedOnly(overrides.analyzed!)
    if ('q'        in overrides) { setQuery(overrides.q!); setQueryInput(overrides.q!) }
  }

  const clearAll = () => {
    setPage(1)
    setSelectedYear(null); setSelectedMonth(null)
    setSelectedTag(''); setSelectedLevel('local')
    setSelectedStatus(''); setSelectedImpact('')
    setAnalyzedOnly(false); setQuery(''); setQueryInput('')
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const filterParts: string[] = []
  if (selectedLevel  && selectedLevel !== 'local') filterParts.push(selectedLevel)
  if (selectedYear)   filterParts.push(String(selectedYear))
  if (selectedMonth)  filterParts.push(MONTH_NAMES_FULL[selectedMonth - 1])
  if (selectedTag)    filterParts.push(selectedTag)
  if (selectedStatus) filterParts.push(selectedStatus.replace(/_/g, ' '))
  if (selectedImpact) filterParts.push(`${selectedImpact} impact`)
  if (analyzedOnly)   filterParts.push('analyzed only')
  if (query)          filterParts.push(`"${query}"`)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Legislation</h1>
        <p className="text-muted-foreground mt-1">Philadelphia City Council bills.</p>
      </div>

      {/* Drill-down bar chart */}
      <DrilldownChart
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        onYearSelect={(y) => reset({ year: y })}
        onMonthSelect={(m) => { setSelectedMonth(m); setPage(1) }}
      />

      {/* ── Filter row ── */}
      <div className="space-y-3">

        {/* Level tabs */}
        <div className="flex items-center gap-1 border-b">
          {[{ value: '', label: 'All' }, ...LEVELS].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => reset({ level: value })}
              className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                selectedLevel === value
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Status, Impact, Analyzed row */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Status dropdown */}
          <select
            value={selectedStatus}
            onChange={(e) => reset({ status: e.target.value })}
            className="h-8 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          {/* Impact chips */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => reset({ impact: '' })}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                !selectedImpact ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
            >All</button>
            {IMPACTS.map(imp => (
              <button
                key={imp}
                onClick={() => reset({ impact: selectedImpact === imp ? '' : imp })}
                className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize transition-colors ${
                  selectedImpact === imp
                    ? imp === 'high' ? 'bg-red-500 text-white'
                    : imp === 'medium' ? 'bg-amber-500 text-white'
                    : 'bg-green-500 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {imp}
              </button>
            ))}
          </div>

          {/* Analyzed toggle */}
          <label className="flex items-center gap-1.5 text-sm cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
            <input
              type="checkbox"
              checked={analyzedOnly}
              onChange={(e) => reset({ analyzed: e.target.checked })}
              className="rounded border-input"
            />
            Analyzed only
          </label>
        </div>

        {/* Search + tag */}
        <div className="flex flex-wrap gap-2">
          <form onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(queryInput) }} className="flex gap-2 flex-1 min-w-64">
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Search bills by title or number…"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center rounded-md px-4 h-9 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Search
            </button>
          </form>
          {tagCounts.length > 0 && (
            <select
              value={selectedTag}
              onChange={(e) => reset({ tag: e.target.value })}
              className="h-9 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All Tags</option>
              {tagCounts.map(({ tag, count }) => (
                <option key={tag} value={tag}>{tag} ({count})</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Active filter breadcrumb */}
      {filterParts.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Showing:</span>
          <span className="font-medium">{filterParts.join(' · ')}</span>
          <button
            onClick={clearAll}
            className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">Error: {error}</p>}

      {/* Bill count + pagination top */}
      {!loading && !error && total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total.toLocaleString()} bill{total !== 1 ? 's' : ''}</span>
          {totalPages > 1 && (
            <span>Page {page} of {totalPages}</span>
          )}
        </div>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      )}

      {/* Bill list */}
      {!loading && !error && bills.length > 0 && (
        <div className="space-y-2">
          {bills.map((bill) => (
            <BillCard key={bill.id} bill={bill} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && bills.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">
          {filterParts.length > 0
            ? 'No bills match the selected filters.'
            : <>No legislation has been ingested yet.{' '}<Link href="/admin" className="underline hover:no-underline">Ingest bills</Link></>
          }
        </p>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 rounded-md border text-sm font-medium disabled:opacity-40 hover:bg-muted/40 transition-colors"
          >
            ← Previous
          </button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              // Show first, last, current ±1, and ellipsis
              let pageNum: number | null
              if (totalPages <= 7) {
                pageNum = i + 1
              } else if (i === 0) {
                pageNum = 1
              } else if (i === 6) {
                pageNum = totalPages
              } else if (page <= 4) {
                pageNum = i + 1
              } else if (page >= totalPages - 3) {
                pageNum = totalPages - 6 + i
              } else {
                pageNum = page - 2 + i
              }
              const isEllipsis = totalPages > 7 && (
                (i === 1 && pageNum !== null && pageNum > 2) ||
                (i === 5 && pageNum !== null && pageNum < totalPages - 1)
              )
              if (isEllipsis) {
                return <span key={i} className="px-1 text-muted-foreground text-sm">…</span>
              }
              return (
                <button
                  key={i}
                  onClick={() => pageNum && setPage(pageNum)}
                  className={`w-8 h-8 rounded text-sm font-medium transition-colors ${
                    page === pageNum
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted/40 text-muted-foreground'
                  }`}
                >
                  {pageNum}
                </button>
              )
            })}
          </div>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 rounded-md border text-sm font-medium disabled:opacity-40 hover:bg-muted/40 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
