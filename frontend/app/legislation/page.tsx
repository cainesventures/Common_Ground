'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePostHog } from 'posthog-js/react'

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
  next_hearing_date?: string
}

function ExportButtons({ analyzed, tag, impact, status, sponsor, year, month }: {
  analyzed?: string; tag?: string; impact?: string; status?: string
  sponsor?: string; year?: number; month?: number
}) {
  const [loadingCsv,  setLoadingCsv]  = useState(false)
  const [loadingJson, setLoadingJson] = useState(false)

  const doExport = async (format: 'csv' | 'json') => {
    const setLoading = format === 'csv' ? setLoadingCsv : setLoadingJson
    setLoading(true)
    try {
      await api.exportLegislation({ format, analyzed, tag, impact, status, sponsor, year, month })
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        onClick={() => doExport('csv')}
        disabled={loadingCsv}
        className="text-xs px-2.5 py-1.5 rounded border hover:bg-muted transition-colors disabled:opacity-50"
      >
        {loadingCsv ? '…' : 'CSV'}
      </button>
      <button
        onClick={() => doExport('json')}
        disabled={loadingJson}
        className="text-xs px-2.5 py-1.5 rounded border hover:bg-muted transition-colors disabled:opacity-50"
      >
        {loadingJson ? '…' : 'JSON'}
      </button>
    </div>
  )
}

function isWithin7Days(isoDate: string): boolean {
  const d = new Date(isoDate)
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  return diff > 0 && diff < 7 * 24 * 60 * 60 * 1000
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
  const [hoveredKey, setHoveredKey] = useState<string | number | null>(null)
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
      <div className="flex items-end gap-1" style={{ height: 108 }}>
        {data.map((item) => {
          const key  = getKey(item)
          const label = getLabel(item)
          const isActive = activeKey === key
          const isHovered = hoveredKey === key
          const barH = Math.max((item.count / max) * 72, 3)
          const barColor = isActive ? '#3b82f6' : isHovered ? '#1d4ed8' : '#3b82f630'

          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              onMouseEnter={() => setHoveredKey(key)}
              onMouseLeave={() => setHoveredKey(null)}
              className="bar-hover flex-1 flex flex-col items-center gap-0.5 min-w-0"
              title={`${label}: ${item.count.toLocaleString()} bill${item.count !== 1 ? 's' : ''}`}
            >
              {/* Count label — visible on active or hover */}
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
                color: '#000000',
                opacity: isActive || isHovered ? 1 : 0,
                transition: 'opacity 150ms ease',
              }}>
                {item.count.toLocaleString()}
              </span>

              {/* Bar */}
              <div className="w-full flex items-end" style={{ height: 72 }}>
                <div
                  className="w-full rounded-t-sm"
                  style={{
                    height: barH,
                    backgroundColor: barColor,
                    outline: isActive ? '2px solid #3b82f6' : 'none',
                    outlineOffset: '1px',
                    transition: 'background-color 150ms ease',
                  }}
                />
              </div>

              {/* X-axis label */}
              <span style={{
                fontSize: 10,
                lineHeight: 1,
                textAlign: 'center',
                width: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: isActive ? '#2563eb' : '#6b7280',
                fontWeight: isActive ? 600 : 400,
                transition: 'color 150ms ease',
              }}>
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

interface ChartFilters {
  q?: string
  analyzed?: string
  tag?: string
  impact?: string
  status?: string
  sponsor?: string
}

function DrilldownChart({
  selectedYear,
  selectedMonth,
  onYearSelect,
  onMonthSelect,
  filters,
}: {
  selectedYear:  number | null
  selectedMonth: number | null
  onYearSelect:  (year: number | null) => void
  onMonthSelect: (month: number | null) => void
  filters: ChartFilters
}) {
  const [yearCounts,  setYearCounts]  = useState<YearCount[]>([])
  const [monthCounts, setMonthCounts] = useState<MonthCount[]>([])

  useEffect(() => {
    api.getYearCounts(filters).then((d) => setYearCounts(d?.years ?? [])).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.analyzed, filters.tag, filters.impact, filters.status, filters.sponsor])

  useEffect(() => {
    if (!selectedYear) { setMonthCounts([]); return }
    api.getMonthCounts(selectedYear, filters).then((d) => setMonthCounts(d?.months ?? [])).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, filters.q, filters.analyzed, filters.tag, filters.impact, filters.status, filters.sponsor])

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

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.trim().toLowerCase()
          ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded-sm px-0.5">{part}</mark>
          : part
      )}
    </>
  )
}

function BillCard({ bill, query = '' }: { bill: Bill; query?: string }) {
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
          {bill.next_hearing_date && isWithin7Days(bill.next_hearing_date) && (
            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 shrink-0">
              Hearing {new Date(bill.next_hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
          {bill.introduced_date && (
            <span className="text-[11px] text-muted-foreground/60 shrink-0 ml-auto">
              {new Date(bill.introduced_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
        </div>
        <p className="text-sm font-medium line-clamp-2 group-hover:text-primary transition-colors leading-snug">
          <Highlight text={bill.plain_title || bill.title} query={query} />
        </p>
        {bill.summary && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            <Highlight text={bill.summary} query={query} />
          </p>
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


const IMPACTS = ['high', 'medium', 'low'] as const

export default function LegislationPage() {
  return (
    <Suspense>
      <LegislationPageInner />
    </Suspense>
  )
}

function LegislationPageInner() {
  const searchParams = useSearchParams()
  const posthog = usePostHog()

  // Initialize filter state from URL on first render
  const sp = searchParams
  const [query,          setQuery]          = useState(() => sp.get('q') ?? '')
  const [queryInput,     setQueryInput]     = useState(() => sp.get('q') ?? '')
  const [bills,          setBills]          = useState<Bill[]>([])
  const [total,          setTotal]          = useState(0)
  const [page,           setPage]           = useState(() => Number(sp.get('page') ?? '1'))
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState('')
  const [selectedYear,   setSelectedYear]   = useState<number | null>(() => sp.get('year') ? Number(sp.get('year')) : null)
  const [selectedMonth,  setSelectedMonth]  = useState<number | null>(() => sp.get('month') ? Number(sp.get('month')) : null)
  const [selectedTag,    setSelectedTag]    = useState(() => sp.get('tag') ?? '')
  const [selectedLevel,  setSelectedLevel]  = useState(() => sp.get('level') ?? 'local')
  const [selectedStatus,  setSelectedStatus]  = useState(() => sp.get('status') ?? '')
  const [selectedImpact,  setSelectedImpact]  = useState(() => sp.get('impact') ?? '')
  const [selectedSponsor, setSelectedSponsor] = useState(() => sp.get('sponsor') ?? '')
  const [analyzedOnly,    setAnalyzedOnly]    = useState(() => sp.get('analyzed') !== '0')
  const [hasVotesOnly,    setHasVotesOnly]    = useState(() => sp.get('has_votes') === '1')
  const [tagCounts,       setTagCounts]       = useState<{tag: string; count: number}[]>([])
  const [councilMembers,  setCouncilMembers]  = useState<{id: string; name: string}[]>([])

  // Sync filters → URL using history.replaceState to avoid triggering Next.js router re-renders
  useEffect(() => {
    const p = new URLSearchParams()
    if (query)          p.set('q',        query)
    if (selectedYear)   p.set('year',     String(selectedYear))
    if (selectedMonth)  p.set('month',    String(selectedMonth))
    if (selectedTag)    p.set('tag',      selectedTag)
    if (selectedLevel && selectedLevel !== 'local') p.set('level', selectedLevel)
    if (selectedStatus)  p.set('status',  selectedStatus)
    if (selectedImpact)  p.set('impact',  selectedImpact)
    if (selectedSponsor) p.set('sponsor', selectedSponsor)
    if (!analyzedOnly)   p.set('analyzed', '0')
    if (hasVotesOnly)    p.set('has_votes', '1')
    if (page > 1)        p.set('page',    String(page))
    const qs = p.toString()
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`
    window.history.replaceState(null, '', url)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selectedYear, selectedMonth, selectedTag, selectedLevel, selectedStatus, selectedImpact, selectedSponsor, analyzedOnly, hasVotesOnly, page])

  const fetchBills = useCallback(async (
    q: string, year: number | null, month: number | null, tag: string,
    level: string, status: string, impact: string, analyzed: boolean, pageNum: number, sponsor: string, hasVotes: boolean
  ) => {
    setLoading(true)
    setError('')
    try {
      const offset = (pageNum - 1) * PAGE_SIZE
      const data = await api.searchLegislation(
        q, PAGE_SIZE, offset, level,
        analyzed ? 'true' : '',
        tag, impact, year ?? 0, month ?? 0, status, sponsor, hasVotes
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
    api.getTagCounts({
      q: query,
      level: selectedLevel,
      analyzed: analyzedOnly ? 'true' : '',
      impact: selectedImpact,
      status: selectedStatus,
      sponsor: selectedSponsor || undefined,
      year: selectedYear ?? undefined,
      month: selectedMonth ?? undefined,
    }).then((d) => setTagCounts(d?.tags ?? [])).catch(() => {})
  }, [query, selectedLevel, analyzedOnly, selectedImpact, selectedStatus, selectedSponsor, selectedYear, selectedMonth])

  useEffect(() => {
    fetchBills(query, selectedYear, selectedMonth, selectedTag, selectedLevel, selectedStatus, selectedImpact, analyzedOnly, page, selectedSponsor, hasVotesOnly)
  }, [query, selectedYear, selectedMonth, selectedTag, selectedLevel, selectedStatus, selectedImpact, analyzedOnly, page, selectedSponsor, hasVotesOnly, fetchBills])

  useEffect(() => {
    api.getCouncilmembers().then((d) => setCouncilMembers(d?.members ?? [])).catch(() => {})
  }, [])

  const reset = (overrides: Partial<{
    year: number | null; month: number | null; tag: string; level: string;
    status: string; impact: string; analyzed: boolean; q: string; sponsor: string; hasVotes: boolean
  }> = {}) => {
    setPage(1)
    if ('year'     in overrides) { setSelectedYear(overrides.year!); setSelectedMonth(null) }
    if ('month'    in overrides) setSelectedMonth(overrides.month!)
    if ('tag'      in overrides) setSelectedTag(overrides.tag!)
    if ('level'    in overrides) setSelectedLevel(overrides.level!)
    if ('status'   in overrides) setSelectedStatus(overrides.status!)
    if ('impact'   in overrides) setSelectedImpact(overrides.impact!)
    if ('analyzed' in overrides) setAnalyzedOnly(overrides.analyzed!)
    if ('sponsor'  in overrides) setSelectedSponsor(overrides.sponsor!)
    if ('hasVotes' in overrides) setHasVotesOnly(overrides.hasVotes!)
    if ('q'        in overrides) { setQuery(overrides.q!); setQueryInput(overrides.q!) }
  }

  const clearAll = () => {
    setPage(1)
    setSelectedYear(null); setSelectedMonth(null)
    setSelectedTag(''); setSelectedLevel('local')
    setSelectedStatus(''); setSelectedImpact('')
    setSelectedSponsor(''); setHasVotesOnly(false)
    setAnalyzedOnly(true); setQuery(''); setQueryInput('')
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const filterParts: string[] = []
  if (selectedLevel  && selectedLevel !== 'local') filterParts.push(selectedLevel)
  if (selectedYear)   filterParts.push(String(selectedYear))
  if (selectedMonth)  filterParts.push(MONTH_NAMES_FULL[selectedMonth - 1])
  if (selectedTag)    filterParts.push(selectedTag)
  if (selectedStatus)  filterParts.push(selectedStatus.replace(/_/g, ' '))
  if (selectedImpact)  filterParts.push(`${selectedImpact} impact`)
  if (selectedSponsor) filterParts.push(selectedSponsor)
  if (!analyzedOnly)  filterParts.push('including unanalyzed')
  if (hasVotesOnly)   filterParts.push('has roll call')
  if (query)          filterParts.push(`"${query}"`)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Legislation</h1>
          <p className="text-muted-foreground mt-1">Philadelphia City Council bills.</p>
        </div>
        <ExportButtons
          analyzed={analyzedOnly ? 'true' : ''}
          tag={selectedTag}
          impact={selectedImpact}
          status={selectedStatus}
          sponsor={selectedSponsor}
          year={selectedYear ?? undefined}
          month={selectedMonth ?? undefined}
        />
      </div>

      {/* Drill-down bar chart */}
      <DrilldownChart
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        onYearSelect={(y) => reset({ year: y })}
        onMonthSelect={(m) => { setSelectedMonth(m); setPage(1) }}
        filters={{
          q: query || undefined,
          analyzed: analyzedOnly ? 'true' : undefined,
          tag: selectedTag || undefined,
          impact: selectedImpact || undefined,
          status: selectedStatus || undefined,
          sponsor: selectedSponsor || undefined,
        }}
      />

      {/* ── Filter row ── */}
      <div className="space-y-3 sticky top-14 bg-background/95 backdrop-blur z-10 py-2 -mx-4 px-4">


        {/* Status, Impact, Analyzed row */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Status dropdown */}
          <Select value={selectedStatus || '__all__'} onValueChange={(v) => reset({ status: v === '__all__' ? '' : (v ?? '') })}>
            <SelectTrigger className="h-8 text-sm w-[140px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              {STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Sponsor dropdown */}
          {councilMembers.length > 0 && (
            <Select value={selectedSponsor || '__all__'} onValueChange={(v) => reset({ sponsor: v === '__all__' ? '' : (v ?? '') })}>
              <SelectTrigger className="h-8 text-sm w-[160px]">
                <SelectValue placeholder="All sponsors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All sponsors</SelectItem>
                {councilMembers.map(m => (
                  <SelectItem key={m.id} value={m.name ?? ''}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Impact chips */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground mr-1">Impact:</span>
            <button
              onClick={() => reset({ impact: '' })}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                !selectedImpact
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-background text-muted-foreground border-border hover:border-foreground/50 hover:text-foreground'
              }`}
            >All</button>
            {IMPACTS.map(imp => (
              <button
                key={imp}
                onClick={() => reset({ impact: selectedImpact === imp ? '' : imp })}
                className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize border transition-colors ${
                  selectedImpact === imp
                    ? imp === 'high'   ? 'bg-red-500 text-white border-red-500'
                    : imp === 'medium' ? 'bg-amber-500 text-white border-amber-500'
                    :                   'bg-green-500 text-white border-green-500'
                    : imp === 'high'   ? 'bg-background text-red-600 border-red-300 hover:bg-red-50 hover:border-red-400'
                    : imp === 'medium' ? 'bg-background text-amber-600 border-amber-300 hover:bg-amber-50 hover:border-amber-400'
                    :                   'bg-background text-green-600 border-green-300 hover:bg-green-50 hover:border-green-400'
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

          {/* Has Roll Call toggle */}
          <label className="flex items-center gap-1.5 text-sm cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
            <input
              type="checkbox"
              checked={hasVotesOnly}
              onChange={(e) => reset({ hasVotes: e.target.checked })}
              className="rounded border-input"
            />
            Has roll call
          </label>
        </div>

        {/* Search + tag */}
        <div className="flex flex-wrap gap-2">
          <form onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(queryInput); if (queryInput.trim()) posthog?.capture('search_performed', { query: queryInput.trim() }) }} className="flex gap-2 flex-1 min-w-64">
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
            <BillCard key={bill.id} bill={bill} query={query} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && bills.length === 0 && (
        <div className="text-center py-16 space-y-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 mx-auto text-muted-foreground/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
          </svg>
          {filterParts.length > 0 ? (
            <>
              <p className="text-sm font-medium text-muted-foreground">No bills match these filters.</p>
              <button onClick={clearAll} className="text-sm text-primary hover:underline">Clear filters and try again</button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-muted-foreground">No legislation has been ingested yet.</p>
              <Link href="/admin" className="text-sm text-primary hover:underline">Ingest bills from the admin panel →</Link>
            </>
          )}
        </div>
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
