'use client'

import { useEffect, useState, useCallback, Suspense, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams, useParams } from 'next/navigation'
import { api } from '@/lib/api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MultiSelect } from '@/components/ui/multi-select'
import { usePostHog } from 'posthog-js/react'
import { STATUS_COLORS as STATUS_BADGE, STATUS_COLORS_FALLBACK, IMPACT_ACCENT, HEARING_BADGE } from '@/lib/badge-colors'
import { isWithin7Days, fmtStatus } from '@/lib/utils'
import { BillCard } from '@/components/BillCard'
import { BILL_CATEGORIES, CATEGORY_TAGS } from '@/lib/bill-categories'

const PAGE_SIZE = 20

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

function ExportButtons({ analyzed, tags, impact, statuses, sponsor, year, month, total }: {
  analyzed?: string; tags?: string[]; impact?: string; statuses?: string[]
  sponsor?: string; year?: number; month?: number; total: number
}) {
  const [loading, setLoading] = useState(false)

  const hasFilters = !!(analyzed || tags?.length || impact || statuses?.length || sponsor || year || month)

  const doExport = async () => {
    setLoading(true)
    try {
      await api.exportLegislation({ format: 'csv', analyzed, tag: tags?.join(','), impact, status: statuses?.join(','), sponsor, year, month })
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  const label = loading
    ? '…'
    : hasFilters
      ? `Download ${total.toLocaleString()} bills (.csv)`
      : 'Download all legislation (.csv)'

  return (
    <button
      onClick={doExport}
      disabled={loading}
      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border hover:bg-muted transition-colors disabled:opacity-50 shrink-0 whitespace-nowrap"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      {label}
    </button>
  )
}


interface YearCount  { year: number;  count: number }
interface MonthCount { month: number; count: number }

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
  const { city } = useParams<{ city: string }>()
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
  const [selectedSponsors, setSelectedSponsors] = useState<string[]>(() => sp.get('sponsor') ? sp.get('sponsor')!.split(',').filter(Boolean) : [])
  const [analyzedOnly,    setAnalyzedOnly]    = useState(() => sp.get('analyzed') !== '0')
  const [hasVotesOnly,    setHasVotesOnly]    = useState(() => sp.get('has_votes') === '1')
  const [hasPerspectivesOnly, setHasPerspectivesOnly] = useState(() => sp.get('has_perspectives') === '1')
  const [selectedCategories, setSelectedCategories] = useState<string[]>(() => sp.get('category') ? sp.get('category')!.split(',').filter(Boolean) : [])
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [filtersExpanded, setFiltersExpanded] = useState(true)
  const [paginationExpanded, setPaginationExpanded] = useState(false)
  const [paginationFixed, setPaginationFixed] = useState(true)
  const bottomSentinelRef = useRef<HTMLDivElement>(null)
  const [facets, setFacets] = useState<{
    statuses: {value: string; count: number}[]
    sponsors: {name: string; count: number}[]
    tags: {tag: string; count: number}[]
    categories: {key: string; count: number}[]
  }>({ statuses: [], sponsors: [], tags: [], categories: [] })
  const [yearCounts,  setYearCounts]  = useState<YearCount[]>([])
  const [monthCounts, setMonthCounts] = useState<MonthCount[]>([])

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
    if (selectedSponsors.length) p.set('sponsor', selectedSponsors.join(','))
    if (!analyzedOnly)        p.set('analyzed', '0')
    if (hasVotesOnly)         p.set('has_votes', '1')
    if (hasPerspectivesOnly)  p.set('has_perspectives', '1')
    if (selectedCategories.length) p.set('category', selectedCategories.join(','))
    if (page > 1)             p.set('page',    String(page))
    const qs = p.toString()
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`
    window.history.replaceState(null, '', url)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selectedYear, selectedMonth, selectedTags, selectedLevel, selectedStatuses, selectedImpact, selectedSponsors, analyzedOnly, hasVotesOnly, hasPerspectivesOnly, selectedCategories, page])

  const fetchBills = useCallback(async (
    q: string, year: number | null, month: number | null, tags: string[],
    level: string, statuses: string[], impact: string, analyzed: boolean, pageNum: number, sponsors: string[], hasVotes: boolean, hasPerspectives: boolean, categories: string[]
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
        allTags, impact, year ?? 0, month ?? 0, statuses, sponsors.join(','), hasVotes, hasPerspectives
      )
      setBills(data?.results ?? [])
      setTotal(data?.total ?? 0)
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : 'Failed to load legislation'
      setError(msg)
      setBills([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounce bill search + facets together — both react to the same filter changes
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)
    fetchTimerRef.current = setTimeout(() => {
      const categoryTags = selectedCategories.flatMap(cat => CATEGORY_TAGS[cat] ?? [])
      const allTags = categoryTags.length > 0 ? [...new Set([...selectedTags, ...categoryTags])] : selectedTags
      fetchBills(query, selectedYear, selectedMonth, selectedTags, selectedLevel, selectedStatuses, selectedImpact, analyzedOnly, page, selectedSponsors, hasVotesOnly, hasPerspectivesOnly, selectedCategories)
      api.getFacets({
        q: query || undefined,
        level: selectedLevel || 'local',
        analyzed: analyzedOnly ? 'true' : 'false',
        tag: allTags.join(',') || undefined,
        impact: selectedImpact || undefined,
        status: selectedStatuses.join(',') || undefined,
        sponsor: selectedSponsors.join(',') || undefined,
        year: selectedYear ?? undefined,
        month: selectedMonth ?? undefined,
      }).then(d => { if (d) setFacets(d) }).catch(() => {})
    }, 250)
    return () => { if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current) }
  }, [query, selectedYear, selectedMonth, selectedTags, selectedLevel, selectedStatuses, selectedImpact, analyzedOnly, page, selectedSponsors, hasVotesOnly, hasPerspectivesOnly, selectedCategories, fetchBills])

  useEffect(() => {
    const categoryTags = selectedCategories.flatMap(cat => CATEGORY_TAGS[cat] ?? [])
    const allTags = categoryTags.length > 0 ? [...new Set([...selectedTags, ...categoryTags])] : selectedTags
    api.getYearCounts({
      q: query || undefined,
      analyzed: analyzedOnly ? 'true' : undefined,
      tag: allTags.join(',') || undefined,
      impact: selectedImpact || undefined,
      status: selectedStatuses.join(',') || undefined,
      sponsor: selectedSponsors.join(',') || undefined,
    }).then((d) => setYearCounts(d?.years ?? [])).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, analyzedOnly, selectedTags, selectedCategories, selectedImpact, selectedStatuses, selectedSponsors])

  useEffect(() => {
    if (!selectedYear) { setMonthCounts([]); return }
    api.getMonthCounts(selectedYear, {
      q: query || undefined,
      analyzed: analyzedOnly ? 'true' : undefined,
      tag: [...selectedTags, ...selectedCategories.flatMap(c => CATEGORY_TAGS[c] ?? [])].join(',') || undefined,
      impact: selectedImpact || undefined,
      status: selectedStatuses.join(',') || undefined,
      sponsor: selectedSponsors.join(',') || undefined,
    }).then((d) => setMonthCounts(d?.months ?? [])).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, query, analyzedOnly, selectedTags, selectedCategories, selectedImpact, selectedStatuses, selectedSponsors])

  const reset = (overrides: Partial<{
    year: number | null; month: number | null; tags: string[]; level: string;
    statuses: string[]; impact: string; analyzed: boolean; q: string; sponsors: string[]; hasVotes: boolean; hasPerspectives: boolean; categories: string[]
  }> = {}) => {
    setPage(1)
    if ('year'            in overrides) { setSelectedYear(overrides.year!); setSelectedMonth(null) }
    if ('month'           in overrides) setSelectedMonth(overrides.month!)
    if ('tags'            in overrides) setSelectedTags(overrides.tags!)
    if ('level'           in overrides) setSelectedLevel(overrides.level!)
    if ('statuses'        in overrides) setSelectedStatuses(overrides.statuses!)
    if ('impact'          in overrides) setSelectedImpact(overrides.impact!)
    if ('analyzed'        in overrides) setAnalyzedOnly(overrides.analyzed!)
    if ('sponsors'        in overrides) setSelectedSponsors(overrides.sponsors!)
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
    setSelectedSponsors([]); setHasVotesOnly(false)
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
    selectedSponsors.length > 0,
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
  if (selectedCategories.length) selectedCategories.forEach(c => filterParts.push(BILL_CATEGORIES[c]?.label ?? c))
  if (selectedSponsors.length) selectedSponsors.forEach(s => filterParts.push(s))
  if (selectedStatuses.length) selectedStatuses.forEach(s => filterParts.push(fmtStatus(s)))
  if (selectedImpact)  filterParts.push(`${selectedImpact} impact`)
  if (selectedTags.length) selectedTags.forEach(t => filterParts.push(t))
  if (!analyzedOnly)  filterParts.push('including unanalyzed')
  if (hasVotesOnly)         filterParts.push('has roll call')
  if (hasPerspectivesOnly)  filterParts.push('has perspectives')
  if (query)          filterParts.push(`"${query}"`)

  useEffect(() => {
    const el = bottomSentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => setPaginationFixed(!entry.isIntersecting), { threshold: 0 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const goToPage = (p: number) => {
    setPage(p)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className={`space-y-5 ${totalPages > 1 && paginationFixed ? 'pb-14' : ''}`}>
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
          sponsor={selectedSponsors.join(',')}
          year={selectedYear ?? undefined}
          month={selectedMonth ?? undefined}
          total={total}
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

          {/* Row 2: Year · Month · Category · Sponsor · Status · Tags */}
          <div className="flex flex-wrap gap-2 items-center">
            {yearCounts.length > 0 && (
              <Select value={selectedYear ? String(selectedYear) : '__all__'} onValueChange={(v) => reset({ year: v === '__all__' ? null : Number(v) })}>
                <SelectTrigger className="h-8 text-sm w-[120px]" aria-label="Filter by year">
                  <SelectValue>{selectedYear ? String(selectedYear) : 'All Years'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All years</SelectItem>
                  {[...yearCounts].reverse().map(y => (
                    <SelectItem key={y.year} value={String(y.year)}>
                      {y.year} ({y.count.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selectedYear && (
              <Select value={selectedMonth ? String(selectedMonth) : '__all__'} onValueChange={(v) => { setSelectedMonth(v === '__all__' ? null : Number(v)); setPage(1) }}>
                <SelectTrigger className="h-8 text-sm w-[130px]" aria-label="Filter by month">
                  <SelectValue>{selectedMonth ? MONTH_NAMES_FULL[selectedMonth - 1] : 'All Months'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All months</SelectItem>
                  {monthCounts.map(m => (
                    <SelectItem key={m.month} value={String(m.month)}>
                      {MONTH_NAMES_FULL[m.month - 1]} ({m.count.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <MultiSelect
              options={Object.entries(BILL_CATEGORIES).map(([key, cat]) => {
                const f = facets.categories.find(fc => fc.key === key)
                return { value: key, label: f ? `${cat.label} (${f.count.toLocaleString()})` : cat.label }
              })}
              selected={selectedCategories}
              onChange={(v) => reset({ categories: v })}
              placeholder="All Categories"
              searchPlaceholder="Search categories…"
              className="h-8 min-w-[150px]"
            />
            {facets.sponsors.length > 0 && (
              <MultiSelect
                options={facets.sponsors.map(s => ({ value: s.name, label: `${s.name} (${s.count.toLocaleString()})` }))}
                selected={selectedSponsors}
                onChange={(v) => reset({ sponsors: v })}
                placeholder="All Sponsors"
                searchPlaceholder="Search sponsors…"
                className="h-8 min-w-[150px]"
              />
            )}
            <MultiSelect
              options={STATUSES.map(s => {
                const f = facets.statuses.find(fs => fs.value === s.value)
                return f ? { ...s, label: `${s.label} (${f.count.toLocaleString()})` } : s
              })}
              selected={selectedStatuses}
              onChange={(v) => reset({ statuses: v })}
              placeholder="All Statuses"
              className="h-8 min-w-[140px]"
            />
            {facets.tags.length > 0 && (
              <MultiSelect
                options={facets.tags.map(({ tag, count }) => ({ value: tag, label: `${tag} (${count.toLocaleString()})` }))}
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

              {/* Year */}
              {yearCounts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Year</p>
                  <Select value={selectedYear ? String(selectedYear) : '__all__'} onValueChange={(v) => reset({ year: v === '__all__' ? null : Number(v) })}>
                    <SelectTrigger className="h-10 text-sm w-full" aria-label="Filter by year">
                      <SelectValue>{selectedYear ? String(selectedYear) : 'All years'}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All years</SelectItem>
                      {[...yearCounts].reverse().map(y => (
                        <SelectItem key={y.year} value={String(y.year)}>
                          {y.year} ({y.count.toLocaleString()})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Month — only when a year is selected */}
              {selectedYear && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Month</p>
                  <Select value={selectedMonth ? String(selectedMonth) : '__all__'} onValueChange={(v) => { setSelectedMonth(v === '__all__' ? null : Number(v)); setPage(1) }}>
                    <SelectTrigger className="h-10 text-sm w-full" aria-label="Filter by month">
                      <SelectValue>{selectedMonth ? MONTH_NAMES_FULL[selectedMonth - 1] : 'All months'}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All months</SelectItem>
                      {monthCounts.map(m => (
                        <SelectItem key={m.month} value={String(m.month)}>
                          {MONTH_NAMES_FULL[m.month - 1]} ({m.count.toLocaleString()})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Category */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Category</p>
                <MultiSelect
                  options={Object.entries(BILL_CATEGORIES).map(([key, cat]) => {
                    const f = facets.categories.find(fc => fc.key === key)
                    return { value: key, label: f ? `${cat.label} (${f.count.toLocaleString()})` : cat.label }
                  })}
                  selected={selectedCategories}
                  onChange={(v) => reset({ categories: v })}
                  placeholder="All Categories"
                  searchPlaceholder="Search categories…"
                  className="h-10 w-full"
                />
              </div>

              {/* Sponsor */}
              {facets.sponsors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sponsor</p>
                  <MultiSelect
                    options={facets.sponsors.map(s => ({ value: s.name, label: `${s.name} (${s.count.toLocaleString()})` }))}
                    selected={selectedSponsors}
                    onChange={(v) => reset({ sponsors: v })}
                    placeholder="All Sponsors"
                    searchPlaceholder="Search sponsors…"
                    className="h-10 w-full"
                  />
                </div>
              )}

              {/* Status */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
                <MultiSelect
                  options={STATUSES.map(s => {
                    const f = facets.statuses.find(fs => fs.value === s.value)
                    return f ? { ...s, label: `${s.label} (${f.count.toLocaleString()})` } : s
                  })}
                  selected={selectedStatuses}
                  onChange={(v) => reset({ statuses: v })}
                  placeholder="All Statuses"
                  className="h-10 w-full"
                />
              </div>

              {/* Tags */}
              {facets.tags.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tags</p>
                  <MultiSelect
                    options={facets.tags.map(({ tag, count }) => ({ value: tag, label: `${tag} (${count.toLocaleString()})` }))}
                    selected={selectedTags}
                    onChange={(v) => reset({ tags: v })}
                    placeholder="All Tags"
                    className="h-10 w-full"
                  />
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
            <BillCard key={bill.id} bill={bill} query={query} showDate tab={hasPerspectivesOnly ? 'perspectives' : undefined} citySlug={city} />
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

      {/* Sentinel — when visible the pagination bar docks inline above the footer */}
      <div ref={bottomSentinelRef} className="h-px" />

      {/* Pagination bar — fixed when scrolling, inline when at the bottom of the page */}
      {totalPages > 1 && (
        <div className={paginationFixed
          ? 'fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur'
          : 'border-t bg-background/95'
        }>
          <div className="max-w-5xl mx-auto px-4">
            {paginationExpanded ? (
              <div className="flex items-center justify-between gap-3 py-2">
                <button
                  onClick={() => goToPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded-md border text-sm font-medium disabled:opacity-40 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400 transition-colors shrink-0"
                >
                  ← Previous
                </button>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const val = parseInt((e.currentTarget.elements.namedItem('pageInputFixed') as HTMLInputElement).value)
                    if (!isNaN(val) && val >= 1 && val <= totalPages) goToPage(val)
                  }}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground"
                >
                  <span>Page</span>
                  <input
                    name="pageInputFixed"
                    key={page}
                    defaultValue={page}
                    type="number"
                    min={1}
                    max={totalPages}
                    className="w-12 text-center rounded-md border border-input bg-background px-1 py-0.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span>of {totalPages}</span>
                  <span className="text-xs hidden sm:inline">({total.toLocaleString()} bills)</span>
                </form>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => goToPage(Math.min(totalPages, page + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 rounded-md border text-sm font-medium disabled:opacity-40 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400 transition-colors shrink-0"
                  >
                    Next →
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaginationExpanded(false)}
                    title="Minimize"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 py-1.5">
                <button
                  onClick={() => goToPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 rounded-md border text-sm font-medium disabled:opacity-40 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400 transition-colors shrink-0"
                >
                  ← Previous
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
                  <button
                    type="button"
                    onClick={() => setPaginationExpanded(true)}
                    title="Expand"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                </div>
                <button
                  onClick={() => goToPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 rounded-md border text-sm font-medium disabled:opacity-40 hover:bg-emerald-50 hover:border-emerald-400 hover:text-emerald-700 dark:hover:bg-emerald-900/20 dark:hover:text-emerald-400 transition-colors shrink-0"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
