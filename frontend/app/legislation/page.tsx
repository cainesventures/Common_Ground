'use client'

import { useEffect, useState, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MultiSelect } from '@/components/ui/multi-select'
import { usePostHog } from 'posthog-js/react'
import { STATUS_COLORS as STATUS_BADGE, STATUS_COLORS_FALLBACK, IMPACT_ACCENT, HEARING_BADGE } from '@/lib/badge-colors'
import { isWithin7Days, fmtStatus } from '@/lib/utils'
import { BillCard } from '@/components/BillCard'
import { BILL_CATEGORIES, CATEGORY_TAGS } from '@/lib/bill-categories'

const PAGE_SIZE = 20

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December']

interface Bill {
  id: string
  bill_number: string
  title: string
  plain_title?: string
  headline?: string
  lede?: string
  status: string
  level?: string
  introduced_date?: string
  final_date?: string
  impact_level?: string
  bill_type?: string
  analyzed_at?: string
  tags?: string
  summary?: string
  next_hearing_date?: string
}

function ExportButtons({ analyzed, tags, impact, statuses, sponsor, year, month }: {
  analyzed?: string; tags?: string[]; impact?: string; statuses?: string[]
  sponsor?: string; year?: number; month?: number
}) {
  const [loadingCsv,  setLoadingCsv]  = useState(false)
  const [loadingJson, setLoadingJson] = useState(false)

  const doExport = async (format: 'csv' | 'json') => {
    const setLoading = format === 'csv' ? setLoadingCsv : setLoadingJson
    setLoading(true)
    try {
      await api.exportLegislation({ format, analyzed, tag: tags?.join(','), impact, status: statuses?.join(','), sponsor, year, month })
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


interface YearCount  { year: number;  count: number }
interface MonthCount { month: number; count: number }

// ── Year Picker ───────────────────────────────────────────────────────────────
// Pill-based year selector. Works at any data density (1 year or 15).

function YearPicker({
  yearCounts,
  onYearSelect,
}: {
  yearCounts: YearCount[]
  onYearSelect: (year: number) => void
}) {
  if (yearCounts.length === 0) return null
  const total = yearCounts.reduce((s, y) => s + y.count, 0)
  const max   = Math.max(...yearCounts.map(y => y.count), 1)

  return (
    <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-sm font-semibold">Bill Activity</span>
          <span className="text-xs text-muted-foreground ml-2">select a year to drill down by month</span>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{total.toLocaleString()} bills</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {yearCounts.map((y) => {
          const pct = Math.round((y.count / max) * 100)
          return (
            <button
              key={y.year}
              onClick={() => onYearSelect(y.year)}
              title={`${y.year}: ${y.count.toLocaleString()} bill${y.count !== 1 ? 's' : ''}`}
              className="group relative flex flex-col items-center justify-center rounded-lg border border-border hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 overflow-hidden transition-colors min-w-[72px] px-4 py-3 cursor-pointer"
            >
              {/* Volume fill — subtle background bar rising from the bottom */}
              <div
                className="absolute inset-x-0 bottom-0 bg-primary/8 dark:bg-primary/15 transition-all duration-200 group-hover:bg-emerald-500/15"
                style={{ height: `${pct}%` }}
              />
              <span className="relative text-sm font-bold tabular-nums group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{y.year}</span>
              <span className="relative text-[11px] text-muted-foreground tabular-nums group-hover:text-emerald-500 transition-colors mt-0.5">
                {y.count.toLocaleString()}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Month Bar Chart ────────────────────────────────────────────────────────────
// Only used for the month drill-down — 12 bars always renders well.

function MonthBarChart({
  monthCounts,
  selectedMonth,
  onMonthSelect,
  year,
}: {
  monthCounts: MonthCount[]
  selectedMonth: number | null
  onMonthSelect: (month: number | null) => void
  year: number
}) {
  const [hoveredMonth, setHoveredMonth] = useState<number | null>(null)
  if (monthCounts.length === 0) return null
  const max   = Math.max(...monthCounts.map(m => m.count), 1)
  const total = monthCounts.reduce((s, m) => s + m.count, 0)

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="text-sm font-semibold">{year}</span>
          <span className="text-xs text-muted-foreground ml-2">click a month to filter</span>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{total.toLocaleString()} bills</span>
      </div>
      <div className="flex items-end gap-1" style={{ height: 108 }}>
        {monthCounts.map((m) => {
          const isActive  = selectedMonth === m.month
          const isHovered = hoveredMonth  === m.month
          const barH = Math.max((m.count / max) * 72, 3)
          const barColor = isActive ? '#10b981' : isHovered ? '#059669' : '#10b98130'

          return (
            <button
              key={m.month}
              onClick={() => onMonthSelect(isActive ? null : m.month)}
              onMouseEnter={() => setHoveredMonth(m.month)}
              onMouseLeave={() => setHoveredMonth(null)}
              className="bar-hover flex-1 flex flex-col items-center gap-0.5 min-w-0"
              title={`${MONTH_NAMES_FULL[m.month - 1]}: ${m.count.toLocaleString()} bill${m.count !== 1 ? 's' : ''}`}
            >
              <span style={{
                fontSize: 11, fontWeight: 600, lineHeight: 1,
                fontVariantNumeric: 'tabular-nums', color: 'currentColor',
                opacity: isActive || isHovered ? 1 : 0,
                transition: 'opacity 150ms ease',
              }}>
                {m.count}
              </span>
              <div className="w-full flex items-end" style={{ height: 72 }}>
                <div
                  className="w-full rounded-t-sm"
                  style={{
                    height: barH, backgroundColor: barColor,
                    outline: isActive ? '2px solid #10b981' : 'none',
                    outlineOffset: '1px',
                    transition: 'background-color 150ms ease',
                  }}
                />
              </div>
              <span style={{
                fontSize: 10, lineHeight: 1, textAlign: 'center',
                width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: isActive ? '#059669' : isHovered ? '#10b981' : '#6b7280',
                fontWeight: isActive ? 600 : 400,
                transition: 'color 150ms ease',
              }}>
                {MONTH_NAMES[m.month - 1]}
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
    return <YearPicker yearCounts={yearCounts} onYearSelect={onYearSelect} />
  }

  return (
    <div className="space-y-2">
      <MonthBarChart
        monthCounts={monthCounts}
        selectedMonth={selectedMonth}
        onMonthSelect={onMonthSelect}
        year={selectedYear}
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
  const [selectedTags,   setSelectedTags]   = useState<string[]>(() => sp.get('tag') ? sp.get('tag')!.split(',').filter(Boolean) : [])
  const [selectedLevel,  setSelectedLevel]  = useState(() => sp.get('level') ?? 'local')
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(() => sp.get('status') ? sp.get('status')!.split(',').filter(Boolean) : [])
  const [selectedImpact,  setSelectedImpact]  = useState(() => sp.get('impact') ?? '')
  const [selectedSponsor, setSelectedSponsor] = useState(() => sp.get('sponsor') ?? '')
  const [analyzedOnly,    setAnalyzedOnly]    = useState(() => sp.get('analyzed') !== '0')
  const [hasVotesOnly,    setHasVotesOnly]    = useState(() => sp.get('has_votes') === '1')
  const [hasPerspectivesOnly, setHasPerspectivesOnly] = useState(() => sp.get('has_perspectives') === '1')
  const [selectedCategories, setSelectedCategories] = useState<string[]>(() => sp.get('category') ? sp.get('category')!.split(',').filter(Boolean) : [])
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [filtersExpanded, setFiltersExpanded] = useState(true)
  const [tagCounts,       setTagCounts]       = useState<{tag: string; count: number}[]>([])
  const [councilMembers,  setCouncilMembers]  = useState<{id: string; name: string}[]>([])

  // Sync filters → URL using history.replaceState to avoid triggering Next.js router re-renders
  useEffect(() => {
    const p = new URLSearchParams()
    if (query)                p.set('q',        query)
    if (selectedYear)         p.set('year',     String(selectedYear))
    if (selectedMonth)        p.set('month',    String(selectedMonth))
    if (selectedTags.length)  p.set('tag',      selectedTags.join(','))
    if (selectedLevel && selectedLevel !== 'local') p.set('level', selectedLevel)
    if (selectedStatuses.length) p.set('status', selectedStatuses.join(','))
    if (selectedImpact)       p.set('impact',  selectedImpact)
    if (selectedSponsor)      p.set('sponsor', selectedSponsor)
    if (!analyzedOnly)        p.set('analyzed', '0')
    if (hasVotesOnly)         p.set('has_votes', '1')
    if (hasPerspectivesOnly)  p.set('has_perspectives', '1')
    if (selectedCategories.length) p.set('category', selectedCategories.join(','))
    if (page > 1)             p.set('page',    String(page))
    const qs = p.toString()
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`
    window.history.replaceState(null, '', url)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selectedYear, selectedMonth, selectedTags, selectedLevel, selectedStatuses, selectedImpact, selectedSponsor, analyzedOnly, hasVotesOnly, hasPerspectivesOnly, selectedCategories, page])

  const fetchBills = useCallback(async (
    q: string, year: number | null, month: number | null, tags: string[],
    level: string, statuses: string[], impact: string, analyzed: boolean, pageNum: number, sponsor: string, hasVotes: boolean, hasPerspectives: boolean, categories: string[]
  ) => {
    setLoading(true)
    setError('')
    try {
      const offset = (pageNum - 1) * PAGE_SIZE
      const categoryTags = categories.flatMap(cat => CATEGORY_TAGS[cat] ?? [])
      const allTags = categoryTags.length > 0 ? [...new Set([...tags, ...categoryTags])] : tags
      const data = await api.searchLegislation(
        q, PAGE_SIZE, offset, level,
        analyzed ? 'true' : '',
        allTags, impact, year ?? 0, month ?? 0, statuses, sponsor, hasVotes, hasPerspectives
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
      status: selectedStatuses.join(',') || undefined,
      sponsor: selectedSponsor || undefined,
      year: selectedYear ?? undefined,
      month: selectedMonth ?? undefined,
    }).then((d) => setTagCounts(d?.tags ?? [])).catch(() => {})
  }, [query, selectedLevel, analyzedOnly, selectedImpact, selectedStatuses, selectedSponsor, selectedYear, selectedMonth])

  useEffect(() => {
    fetchBills(query, selectedYear, selectedMonth, selectedTags, selectedLevel, selectedStatuses, selectedImpact, analyzedOnly, page, selectedSponsor, hasVotesOnly, hasPerspectivesOnly, selectedCategories)
  }, [query, selectedYear, selectedMonth, selectedTags, selectedLevel, selectedStatuses, selectedImpact, analyzedOnly, page, selectedSponsor, hasVotesOnly, hasPerspectivesOnly, selectedCategories, fetchBills])

  useEffect(() => {
    api.getCouncilmembers().then((d) => setCouncilMembers(d?.members ?? [])).catch(() => {})
  }, [])

  const reset = (overrides: Partial<{
    year: number | null; month: number | null; tags: string[]; level: string;
    statuses: string[]; impact: string; analyzed: boolean; q: string; sponsor: string; hasVotes: boolean; hasPerspectives: boolean; categories: string[]
  }> = {}) => {
    setPage(1)
    if ('year'            in overrides) { setSelectedYear(overrides.year!); setSelectedMonth(null) }
    if ('month'           in overrides) setSelectedMonth(overrides.month!)
    if ('tags'            in overrides) setSelectedTags(overrides.tags!)
    if ('level'           in overrides) setSelectedLevel(overrides.level!)
    if ('statuses'        in overrides) setSelectedStatuses(overrides.statuses!)
    if ('impact'          in overrides) setSelectedImpact(overrides.impact!)
    if ('analyzed'        in overrides) setAnalyzedOnly(overrides.analyzed!)
    if ('sponsor'         in overrides) setSelectedSponsor(overrides.sponsor!)
    if ('hasVotes'        in overrides) setHasVotesOnly(overrides.hasVotes!)
    if ('hasPerspectives' in overrides) setHasPerspectivesOnly(overrides.hasPerspectives!)
    if ('categories'      in overrides) setSelectedCategories(overrides.categories!)
    if ('q'               in overrides) { setQuery(overrides.q!); setQueryInput(overrides.q!) }
  }

  const clearAll = () => {
    setPage(1)
    setSelectedYear(null); setSelectedMonth(null)
    setSelectedTags([]); setSelectedLevel('local')
    setSelectedStatuses([]); setSelectedImpact('')
    setSelectedSponsor(''); setHasVotesOnly(false)
    setHasPerspectivesOnly(false)
    setSelectedCategories([])
    setAnalyzedOnly(true); setQuery(''); setQueryInput('')
  }

  // Close drawer on Escape
  useEffect(() => {
    if (!mobileFiltersOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileFiltersOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [mobileFiltersOpen])

  // Count active drawer filters (excludes search query)
  const drawerFilterCount = [
    selectedStatuses.length > 0,
    !!selectedSponsor,
    !!selectedImpact,
    selectedTags.length > 0,
    !analyzedOnly,
    hasVotesOnly,
    hasPerspectivesOnly,
    selectedCategories.length > 0,
    selectedYear !== null,
  ].filter(Boolean).length

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const filterParts: string[] = []
  if (selectedLevel  && selectedLevel !== 'local') filterParts.push(selectedLevel)
  if (selectedYear)   filterParts.push(String(selectedYear))
  if (selectedMonth)  filterParts.push(MONTH_NAMES_FULL[selectedMonth - 1])
  if (selectedTags.length)     selectedTags.forEach(t => filterParts.push(t))
  if (selectedStatuses.length) selectedStatuses.forEach(s => filterParts.push(fmtStatus(s)))
  if (selectedImpact)  filterParts.push(`${selectedImpact} impact`)
  if (selectedSponsor) filterParts.push(selectedSponsor)
  if (!analyzedOnly)  filterParts.push('including unanalyzed')
  if (hasVotesOnly)         filterParts.push('has roll call')
  if (hasPerspectivesOnly)  filterParts.push('has perspectives')
  if (selectedCategories.length) selectedCategories.forEach(c => filterParts.push(BILL_CATEGORIES[c]?.label ?? c))
  if (query)          filterParts.push(`"${query}"`)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Legislation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {loading
              ? 'Philadelphia City Council bills'
              : filterParts.length > 0
                ? <>{total.toLocaleString()} bill{total !== 1 ? 's' : ''} matching <span className="font-medium text-foreground">{filterParts.join(', ')}</span></>
                : <>{total.toLocaleString()} Philadelphia City Council bill{total !== 1 ? 's' : ''}</>
            }
          </p>
        </div>
        <ExportButtons
          analyzed={analyzedOnly ? 'true' : ''}
          tags={selectedTags}
          impact={selectedImpact}
          statuses={selectedStatuses}
          sponsor={selectedSponsor}
          year={selectedYear ?? undefined}
          month={selectedMonth ?? undefined}
        />
      </div>

      {/* ── Filter row ── */}
      <div className="sticky top-14 bg-background/95 backdrop-blur z-10 py-2 -mx-4 px-4 space-y-2">

        {/* Collapsed one-liner — desktop only, shown when filtersExpanded=false */}
        {!filtersExpanded && (
          <div className="hidden sm:flex flex-col gap-2">
            {/* Search row */}
            <div className="flex items-center gap-2">
              <form onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(queryInput); if (queryInput.trim()) posthog?.capture('search_performed', { query: queryInput.trim() }) }} className="flex gap-2 flex-1 min-w-0">
                <input
                  type="text"
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  placeholder="Search bills…"
                  aria-label="Search bills"
                  className="flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button type="submit" disabled={loading} className="inline-flex items-center justify-center gap-1.5 rounded-md px-4 h-8 text-sm font-semibold bg-primary text-primary-foreground hover:bg-emerald-600 hover:border-emerald-500 disabled:opacity-50 shrink-0 border-2 border-primary/60 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" /></svg>
                  Search
                </button>
              </form>
              {drawerFilterCount > 0 && (
                <span className="text-xs text-muted-foreground shrink-0 truncate max-w-xs">{filterParts.join(' · ')}</span>
              )}
              {drawerFilterCount > 0 && (
                <button onClick={clearAll} className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition-colors dark:bg-red-900/20 dark:text-red-400 dark:border-red-800">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                  Clear
                </button>
              )}
              <button
                onClick={() => setFiltersExpanded(true)}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 h-8 rounded-md border border-input text-xs font-medium text-muted-foreground hover:bg-amber-50 hover:border-amber-400 hover:text-amber-600 dark:hover:bg-amber-900/20 dark:hover:text-amber-400 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 8h10M10 12h4" /></svg>
                Filters
                {drawerFilterCount > 0 && (
                  <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">{drawerFilterCount}</span>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Mobile: search always visible + toggle button */}
        <div className="flex gap-2 sm:hidden">
          <form onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(queryInput); if (queryInput.trim()) posthog?.capture('search_performed', { query: queryInput.trim() }) }} className="flex gap-2 flex-1">
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Search bills…"
              aria-label="Search bills"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button type="submit" disabled={loading} className="inline-flex items-center justify-center rounded-md px-4 h-9 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              Search
            </button>
          </form>
          <button
            onClick={() => setMobileFiltersOpen((v) => !v)}
            className="relative inline-flex items-center gap-1.5 px-3 h-9 rounded-md border text-sm font-medium hover:bg-muted transition-colors shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 8h10M10 12h4" />
            </svg>
            Filters
            {drawerFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold">
                {drawerFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Desktop filter controls — hidden on mobile (mobile uses the bottom drawer) */}
        {filtersExpanded && <div className="hidden sm:block space-y-2">

          {/* Row 1: Search */}
          <form onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(queryInput); if (queryInput.trim()) posthog?.capture('search_performed', { query: queryInput.trim() }) }} className="flex gap-2">
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Search bills by title or number…"
              aria-label="Search bills"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center gap-1.5 rounded-md px-5 h-9 text-sm font-semibold bg-primary text-primary-foreground hover:bg-emerald-600 hover:border-emerald-500 disabled:opacity-50 shrink-0 border-2 border-primary/60 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
              </svg>
              Search
            </button>
            <button
              onClick={() => setFiltersExpanded(false)}
              title="Collapse filters"
              className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-md border border-input text-muted-foreground hover:bg-amber-50 hover:border-amber-400 hover:text-amber-600 dark:hover:bg-amber-900/20 dark:hover:text-amber-400 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
            </button>
          </form>

          {/* Row 2: Status · Sponsor · Category · Tags */}
          <div className="flex flex-wrap gap-2 items-center">
            <MultiSelect
              options={STATUSES}
              selected={selectedStatuses}
              onChange={(v) => reset({ statuses: v })}
              placeholder="All Statuses"
              className="h-8 min-w-[140px]"
            />
            {councilMembers.length > 0 && (
              <Select value={selectedSponsor || '__all__'} onValueChange={(v) => reset({ sponsor: v === '__all__' ? '' : (v ?? '') })}>
                <SelectTrigger className="h-8 text-sm w-[160px]" aria-label="Filter by sponsor">
                  <SelectValue>{selectedSponsor || 'All Sponsors'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All sponsors</SelectItem>
                  {councilMembers.map(m => (
                    <SelectItem key={m.id} value={m.name ?? ''}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <MultiSelect
              options={Object.entries(BILL_CATEGORIES).map(([key, cat]) => ({ value: key, label: cat.label }))}
              selected={selectedCategories}
              onChange={(v) => reset({ categories: v })}
              placeholder="All Categories"
              searchPlaceholder="Search categories…"
              className="h-8 min-w-[150px]"
            />
            {tagCounts.length > 0 && (
              <MultiSelect
                options={tagCounts.map(({ tag, count }) => ({ value: tag, label: `${tag} (${count})` }))}
                selected={selectedTags}
                onChange={(v) => reset({ tags: v })}
                placeholder="All Tags"
                className="h-8 min-w-[130px]"
              />
            )}
          </div>

          {/* Row 3: Impact chips · toggles */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 items-center">
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
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                <input type="checkbox" checked={analyzedOnly} onChange={(e) => reset({ analyzed: e.target.checked })} className="rounded border-input" />
                Analyzed only
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                <input type="checkbox" checked={hasVotesOnly} onChange={(e) => reset({ hasVotes: e.target.checked })} className="rounded border-input" />
                Has roll call
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                <input type="checkbox" checked={hasPerspectivesOnly} onChange={(e) => reset({ hasPerspectives: e.target.checked })} className="rounded border-input" />
                Has perspectives
              </label>
            </div>
          </div>

          {/* Row 4: Active filters + clear all — only when filters are active */}
          {filterParts.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap border-t pt-2">
              <button
                onClick={clearAll}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 hover:border-red-300 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/30 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                Clear all
              </button>
              <span className="text-xs text-muted-foreground shrink-0">·</span>
              <span className="text-xs text-foreground">{filterParts.join(' · ')}</span>
            </div>
          )}

        </div>}{/* end desktop panel */}

        {/* Sticky pagination — shown once there are multiple pages */}
        {!loading && !error && total > 0 && totalPages > 1 && (
          <div className="hidden sm:flex items-center justify-between gap-3 border-t pt-2 text-sm">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 rounded-md border text-sm font-medium disabled:opacity-40 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400 transition-colors shrink-0"
            >
              ← Previous
            </button>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const val = parseInt((e.currentTarget.elements.namedItem('pageInputTop') as HTMLInputElement).value)
                if (!isNaN(val) && val >= 1 && val <= totalPages) setPage(val)
              }}
              className="flex items-center gap-1.5 text-sm text-muted-foreground"
            >
              <span>Page</span>
              <input
                name="pageInputTop"
                key={page}
                defaultValue={page}
                type="number"
                min={1}
                max={totalPages}
                className="w-12 text-center rounded-md border border-input bg-background px-1 py-0.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span>of {totalPages} <span className="text-xs">({total.toLocaleString()} bills)</span></span>
            </form>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 rounded-md border text-sm font-medium disabled:opacity-40 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400 transition-colors shrink-0"
            >
              Next →
            </button>
          </div>
        )}

        {/* Bill Activity drill-down */}
        {filtersExpanded && <div className="hidden sm:block">
          <DrilldownChart
            selectedYear={selectedYear}
            selectedMonth={selectedMonth}
            onYearSelect={(y) => reset({ year: y })}
            onMonthSelect={(m) => { setSelectedMonth(m); setPage(1) }}
            filters={{
              q: query || undefined,
              analyzed: analyzedOnly ? 'true' : undefined,
              tag: selectedTags.join(',') || undefined,
              impact: selectedImpact || undefined,
              status: selectedStatuses.join(',') || undefined,
              sponsor: selectedSponsor || undefined,
            }}
          />
        </div>}

      </div>

      {/* ── Mobile Filter Drawer ── */}
      {mobileFiltersOpen && (
        <div className="sm:hidden fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileFiltersOpen(false)}
          />
          {/* Sheet */}
          <div className="relative bg-background rounded-t-2xl shadow-xl max-h-[85vh] flex flex-col">
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
              <span className="font-semibold text-sm">Filters</span>
              <div className="flex items-center gap-4">
                {drawerFilterCount > 0 && (
                  <button
                    onClick={() => { clearAll(); setMobileFiltersOpen(false) }}
                    className="text-sm text-red-600 hover:text-red-700 transition-colors"
                  >
                    Clear all
                  </button>
                )}
                <button
                  onClick={() => setMobileFiltersOpen(false)}
                  className="text-sm font-semibold text-primary hover:opacity-80 transition-opacity"
                >
                  Done
                </button>
              </div>
            </div>
            {/* Scrollable content */}
            <div className="overflow-y-auto flex-1 px-4 py-5 space-y-6">

              {/* Status */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
                <MultiSelect
                  options={STATUSES}
                  selected={selectedStatuses}
                  onChange={(v) => reset({ statuses: v })}
                  placeholder="All Statuses"
                  className="h-10 w-full"
                />
              </div>

              {/* Sponsor */}
              {councilMembers.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sponsor</p>
                  <Select value={selectedSponsor || '__all__'} onValueChange={(v) => reset({ sponsor: v === '__all__' ? '' : (v ?? '') })}>
                    <SelectTrigger className="h-10 text-sm w-full" aria-label="Filter by sponsor">
                      <SelectValue>{selectedSponsor || 'All Sponsors'}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All sponsors</SelectItem>
                      {councilMembers.map(m => (
                        <SelectItem key={m.id} value={m.name ?? ''}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Impact */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Impact</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => reset({ impact: '' })}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      !selectedImpact
                        ? 'bg-foreground text-background border-foreground'
                        : 'bg-background text-muted-foreground border-border hover:border-foreground/50 hover:text-foreground'
                    }`}
                  >All</button>
                  {IMPACTS.map(imp => (
                    <button
                      key={imp}
                      onClick={() => reset({ impact: selectedImpact === imp ? '' : imp })}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium capitalize border transition-colors ${
                        selectedImpact === imp
                          ? imp === 'high'   ? 'bg-red-500 text-white border-red-500'
                          : imp === 'medium' ? 'bg-amber-500 text-white border-amber-500'
                          :                   'bg-green-500 text-white border-green-500'
                          : imp === 'high'   ? 'bg-background text-red-600 border-red-300 hover:bg-red-50 hover:border-red-400 dark:hover:bg-red-900/20'
                          : imp === 'medium' ? 'bg-background text-amber-600 border-amber-300 hover:bg-amber-50 hover:border-amber-400 dark:hover:bg-amber-900/20'
                          :                   'bg-background text-green-600 border-green-300 hover:bg-green-50 hover:border-green-400 dark:hover:bg-green-900/20'
                      }`}
                    >
                      {imp}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags */}
              {tagCounts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</p>
                  <MultiSelect
                    options={tagCounts.map(({ tag, count }) => ({ value: tag, label: `${tag} (${count})` }))}
                    selected={selectedTags}
                    onChange={(v) => reset({ tags: v })}
                    placeholder="All Tags"
                    className="h-10 w-full"
                  />
                </div>
              )}

              {/* Category */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Category</p>
                <MultiSelect
                  options={Object.entries(BILL_CATEGORIES).map(([key, cat]) => ({ value: key, label: cat.label }))}
                  selected={selectedCategories}
                  onChange={(v) => reset({ categories: v })}
                  placeholder="All Categories"
                  searchPlaceholder="Search categories…"
                  className="h-10 w-full"
                />
              </div>

              {/* Options */}
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Options</p>
                <label className="flex items-center justify-between py-2 border-b">
                  <span className="text-sm">Analyzed only</span>
                  <input
                    type="checkbox"
                    checked={analyzedOnly}
                    onChange={(e) => reset({ analyzed: e.target.checked })}
                    className="rounded border-input w-4 h-4"
                  />
                </label>
                <label className="flex items-center justify-between py-2">
                  <span className="text-sm">Has roll call vote</span>
                  <input
                    type="checkbox"
                    checked={hasVotesOnly}
                    onChange={(e) => reset({ hasVotes: e.target.checked })}
                    className="rounded border-input w-4 h-4"
                  />
                </label>
                <label className="flex items-center justify-between py-2">
                  <span className="text-sm">Has perspectives</span>
                  <input
                    type="checkbox"
                    checked={hasPerspectivesOnly}
                    onChange={(e) => reset({ hasPerspectives: e.target.checked })}
                    className="rounded border-input w-4 h-4"
                  />
                </label>
              </div>

            </div>
          </div>
        </div>
      )}


      {error && <p className="text-sm text-destructive">Error: {error}</p>}


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
            <BillCard key={bill.id} bill={bill} query={query} tab={hasPerspectivesOnly ? 'perspectives' : undefined} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && bills.length === 0 && (
        <div className="text-center py-20 space-y-4">
          {filterParts.length > 0 ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto text-muted-foreground/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
              </svg>
              <div className="space-y-1">
                <p className="text-sm font-semibold">No bills match these filters</p>
                <p className="text-sm text-muted-foreground">Try adjusting or removing some of the active filters.</p>
              </div>
              <button onClick={clearAll} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
                Clear all filters
              </button>
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto text-muted-foreground/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
              </svg>
              <div className="space-y-1">
                <p className="text-sm font-semibold">No legislation yet</p>
                <p className="text-sm text-muted-foreground">Bills will appear here once they&apos;ve been ingested.</p>
              </div>
              <Link href="/admin" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
                Go to admin panel →
              </Link>
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
