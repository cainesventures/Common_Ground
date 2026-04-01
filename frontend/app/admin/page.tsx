'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { isLoggedIn } from '@/lib/auth'

// ── SSE streaming hook ────────────────────────────────────────────────────────
type StreamEvent = {
  current: number
  total: number
  message: string
  done: boolean
}

function useStreamProgress() {
  const [progress, setProgress] = useState<StreamEvent | null>(null)
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const start = useCallback(async (path: string) => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setRunning(true)
    setProgress(null)
    const token = typeof window !== 'undefined' ? localStorage.getItem('cg_access_token') : null
    const url = `http://localhost:8000${path}`
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        setProgress({ current: 0, total: 0, message: err.detail ?? 'Request failed', done: true })
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const ev: StreamEvent = JSON.parse(line.slice(6))
              setProgress(ev)
            } catch { /* ignore malformed */ }
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setProgress({ current: 0, total: 0, message: String(e), done: true })
      }
    } finally {
      setRunning(false)
    }
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setRunning(false)
  }, [])

  return { progress, running, start, stop }
}

function useElapsed(running: boolean) {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number | null>(null)
  useEffect(() => {
    if (running) {
      startRef.current = Date.now()
      setElapsed(0)
      const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current!) / 1000)), 1000)
      return () => clearInterval(id)
    } else {
      startRef.current = null
    }
  }, [running])
  return elapsed
}

function formatElapsed(s: number) {
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function ProgressBar({ progress, running, onStop }: { progress: StreamEvent | null; running: boolean; onStop?: () => void }) {
  const elapsed = useElapsed(running)
  if (!progress) return null
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : (progress.done ? 100 : 0)
  const isError = progress.done && progress.message.toLowerCase().includes('failed') && progress.current === 0
  const isDone = progress.done && !isError
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center text-xs text-muted-foreground">
        <span className={isDone ? 'text-green-600 font-medium' : ''}>{progress.message}</span>
        <div className="flex items-center gap-3 shrink-0 ml-2 tabular-nums">
          {progress.total > 0 && <span>{progress.current} / {progress.total}</span>}
          {(running || isDone) && <span className="text-muted-foreground/60">{formatElapsed(elapsed)}</span>}
          {running && onStop && (
            <button onClick={onStop} className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors">
              Stop
            </button>
          )}
        </div>
      </div>
      <div className="h-3 rounded-full overflow-hidden" style={{ backgroundColor: '#e5e7eb' }}>
        <div className="h-full rounded-full transition-all duration-300" style={{
          width: `${pct}%`,
          backgroundColor: isError ? '#ef4444' : isDone ? '#22c55e' : '#3b82f6',
        }} />
      </div>
    </div>
  )
}

interface Result { ok: boolean; message: string }

interface Bill {
  id: string
  bill_number: string
  title: string
  plain_title?: string
  level: string
  status: string
  analyzed_at?: string
  introduced_date?: string
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const ALL_PERSPECTIVE_TYPES = [
  { key: 'progressive',       label: 'Progressive' },
  { key: 'conservative',      label: 'Conservative' },
  { key: 'libertarian',       label: 'Libertarian' },
  { key: 'socialist',         label: 'Socialist' },
  { key: 'centrist',          label: 'Centrist' },
  { key: 'economic',          label: 'Economic' },
  { key: 'civil_liberties',   label: 'Civil Liberties' },
  { key: 'environmental',     label: 'Environmental' },
  { key: 'public_health',     label: 'Public Health' },
  { key: 'urban_planning',    label: 'Urban Planning' },
  { key: 'working_class',     label: 'Working Class' },
  { key: 'business',          label: 'Business' },
  { key: 'youth',             label: 'Youth' },
  { key: 'elderly',           label: 'Elderly' },
  { key: 'neighborhood',      label: 'Neighborhood' },
  { key: 'christian_ethicist',label: 'Christian Ethicist' },
  { key: 'conspiracy_theorist',label: 'Conspiracy Theorist' },
]

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const router = useRouter()
  const [authorized, setAuthorized] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  // Ingest form
  const [city, setCity] = useState('philadelphia')
  const [localLimit, setLocalLimit] = useState('5')
  const [localBulk, setLocalBulk] = useState(false)
  const [localRunning, setLocalRunning] = useState(false)
  const [localResult, setLocalResult] = useState<Result | null>(null)

  // Council members
  const [scrapeRunning, setScrapeRunning] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<Result | null>(null)

  useEffect(() => {
    if (!isLoggedIn()) { router.replace('/'); return }
    api.getMe()
      .then((data) => {
        if (data?.user?.subscription_tier === 'dev') setAuthorized(true)
        else router.replace('/')
      })
      .catch(() => router.replace('/'))
      .finally(() => setLoading(false))
  }, [router])

  const ingestLocal = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalRunning(true)
    setLocalResult(null)
    try {
      const data = await api.ingestLocal(city.trim(), Number(localLimit), localBulk)
      const count = data?.bills_ingested ?? data?.total ?? 0
      setLocalResult({ ok: true, message: `Ingested ${count} items from "${city}".` })
      setReloadKey(k => k + 1)
    } catch (err: any) {
      setLocalResult({ ok: false, message: err.message })
    } finally {
      setLocalRunning(false)
    }
  }

  if (loading) return <div className="h-64 bg-muted animate-pulse rounded-lg" />
  if (!authorized) return null

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-muted-foreground mt-1">Manage bill ingestion, analysis pipeline, and utilities.</p>
      </div>

      {/* ── Section A: Ingestion ───────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Ingestion</h2>

        <div className="border rounded-lg p-4 space-y-4">
          <div>
            <h3 className="font-semibold">Philadelphia Bills</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Fetch bills from Legistar. Enable <strong>Bulk Export</strong> to import all ~8,500 bills at once via Excel export.
            </p>
          </div>
          <form onSubmit={ingestLocal} className="space-y-3">
            <div className="flex items-end gap-3">
              <div className="space-y-1 flex-1">
                <label className="text-xs font-medium text-muted-foreground">Limit <span className="opacity-60">(ignored for bulk)</span></label>
                <input
                  type="number" min={1} max={250}
                  value={localLimit}
                  onChange={(e) => setLocalLimit(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <Button type="submit" disabled={localRunning}>
                {localRunning ? 'Ingesting…' : 'Ingest Bills'}
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={localBulk} onChange={(e) => setLocalBulk(e.target.checked)} className="rounded border-input" />
              <span>Bulk export — exports all bills via Excel, ignores limit</span>
            </label>
            {localResult && (
              <p className={`text-sm ${localResult.ok ? 'text-green-600' : 'text-destructive'}`}>{localResult.message}</p>
            )}
          </form>
        </div>

        <div className="border rounded-lg p-4 space-y-3">
          <div>
            <h3 className="font-semibold">Council Members</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Scrape all 17 current Philadelphia City Council member profiles from phlcouncil.com. Takes ~2 minutes. Safe to re-run.
            </p>
          </div>
          {scrapeResult && (
            <p className={`text-sm ${scrapeResult.ok ? 'text-green-600' : 'text-destructive'}`}>{scrapeResult.message}</p>
          )}
          <Button variant="outline" disabled={scrapeRunning} onClick={async () => {
            setScrapeRunning(true); setScrapeResult(null)
            try {
              const data = await api.scrapeCouncilmembers()
              setScrapeResult({ ok: true, message: `Scraped ${data?.scraped ?? 0} council members.` })
            } catch (err: any) {
              setScrapeResult({ ok: false, message: err.message })
            } finally {
              setScrapeRunning(false)
            }
          }}>
            {scrapeRunning ? 'Scraping…' : 'Scrape Council Members'}
          </Button>
        </div>
      </section>

      {/* ── Section B: Bill Pipeline ───────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Bill Pipeline</h2>
        <BillPipelineSection authorized={authorized} reloadKey={reloadKey} onReload={() => setReloadKey(k => k + 1)} />
      </section>

      {/* ── Section C: Utilities ───────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Utilities</h2>
        <MetricsSection />
        <DigestSection />
        <BackfillCityContextSection />
      </section>
    </div>
  )
}

// ── Bill Pipeline ─────────────────────────────────────────────────────────────
function BillPipelineSection({ authorized, reloadKey, onReload }: { authorized: boolean; reloadKey: number; onReload: () => void }) {
  const { progress, running, start, stop } = useStreamProgress()
  const PAGE_SIZE = 20

  // Step toggles
  const [stepAnalyze,       setStepAnalyze]       = useState(true)
  const [stepPerspectives,  setStepPerspectives]  = useState(true)
  const [stepNews,          setStepNews]          = useState(false)
  const [forceAnalyze,      setForceAnalyze]      = useState(false)

  // Perspective type multi-select
  const [selectedPTypes, setSelectedPTypes] = useState<Set<string>>(
    new Set(ALL_PERSPECTIVE_TYPES.map(p => p.key))
  )
  const [showPTypeDropdown, setShowPTypeDropdown] = useState(false)

  // Date filter
  const [draftYear,      setDraftYear]      = useState('')
  const [draftMonth,     setDraftMonth]     = useState('')
  const [draftDateFrom,  setDraftDateFrom]  = useState('')
  const [draftDateTo,    setDraftDateTo]    = useState('')
  const [filterYear,     setFilterYear]     = useState('')
  const [filterMonth,    setFilterMonth]    = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo,   setFilterDateTo]   = useState('')
  const [filterCount,    setFilterCount]    = useState<number | null>(null)
  const [counting,       setCounting]       = useState(false)

  // Per-bill list
  const [bills,        setBills]        = useState<Bill[]>([])
  const [billsTotal,   setBillsTotal]   = useState(0)
  const [billsLoading, setBillsLoading] = useState(false)
  const [page,         setPage]         = useState(0)
  const [sortOrder,    setSortOrder]    = useState<'desc' | 'asc'>('desc')
  const [analyzingId,  setAnalyzingId]  = useState<string | null>(null)
  const [analyzeResults, setAnalyzeResults] = useState<Record<string, Result>>({})
  const [fetchingNewsId, setFetchingNewsId] = useState<string | null>(null)

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: currentYear - 1999 }, (_, i) => currentYear - i)
  const hasDraft = !!(draftYear || draftMonth || draftDateFrom || draftDateTo)
  const hasApplied = !!(filterYear || filterMonth || filterDateFrom || filterDateTo)

  const filterLabel = (() => {
    if (filterYear && filterMonth) return `${MONTHS_SHORT[Number(filterMonth)-1]} ${filterYear}`
    if (filterYear) return filterYear
    if (filterDateFrom && filterDateTo) return `${filterDateFrom} → ${filterDateTo}`
    if (filterDateFrom) return `From ${filterDateFrom}`
    if (filterDateTo)   return `Until ${filterDateTo}`
    return ''
  })()

  const loadBills = useCallback(async (year = '', month = '', dateFrom = '', dateTo = '', pageNum = 0) => {
    setBillsLoading(true)
    try {
      const data = await api.searchLegislation(
        '', PAGE_SIZE, pageNum * PAGE_SIZE, 'local', '', '', '',
        year  ? Number(year)  : 0,
        month ? Number(month) : 0,
      )
      let results: Bill[] = data?.results ?? []
      if (dateFrom || dateTo) {
        results = results.filter(b => {
          const d = b.introduced_date?.substring(0, 10)
          if (!d) return false
          if (dateFrom && d < dateFrom) return false
          if (dateTo   && d > dateTo)   return false
          return true
        })
      }
      setBills(results)
      setBillsTotal(data?.total ?? 0)
    } catch (err: any) {
      console.error('loadBills failed:', err)
    } finally {
      setBillsLoading(false)
    }
  }, [PAGE_SIZE])

  useEffect(() => {
    if (authorized) loadBills()
  }, [authorized, reloadKey, loadBills])

  const applyFilter = async () => {
    setFilterYear(draftYear); setFilterMonth(draftMonth)
    setFilterDateFrom(draftDateFrom); setFilterDateTo(draftDateTo)
    setPage(0)
    loadBills(draftYear, draftMonth, draftDateFrom, draftDateTo, 0)
    setCounting(true); setFilterCount(null)
    try {
      const data = await api.countLegislation({
        year:      draftYear     ? Number(draftYear)  : undefined,
        month:     draftMonth    ? Number(draftMonth) : undefined,
        date_from: draftDateFrom || undefined,
        date_to:   draftDateTo   || undefined,
      })
      setFilterCount(data?.count ?? 0)
    } catch { setFilterCount(null) }
    finally  { setCounting(false) }
  }

  const clearFilter = () => {
    setDraftYear(''); setDraftMonth(''); setDraftDateFrom(''); setDraftDateTo('')
    setFilterYear(''); setFilterMonth(''); setFilterDateFrom(''); setFilterDateTo('')
    setFilterCount(null); setPage(0)
    loadBills()
  }

  const buildPipelinePath = () => {
    const steps = [
      stepAnalyze       && 'analyze',
      stepPerspectives  && 'perspectives',
      stepNews          && 'news',
    ].filter(Boolean).join(',')
    return api.pipelinePath({
      steps,
      force_analyze:    forceAnalyze || undefined,
      perspective_types: stepPerspectives ? [...selectedPTypes].join(',') : undefined,
      year:      filterYear     || undefined,
      month:     filterMonth    || undefined,
      date_from: filterDateFrom || undefined,
      date_to:   filterDateTo   || undefined,
    })
  }

  const runPipeline = () => {
    start(buildPipelinePath()).then(() => loadBills(filterYear, filterMonth, filterDateFrom, filterDateTo, page))
  }

  const analyzeBill = async (bill: Bill) => {
    setAnalyzingId(bill.id)
    setAnalyzeResults(prev => ({ ...prev, [bill.id]: undefined as any }))
    try {
      const data = await api.analyzeLegislation(bill.id)
      setAnalyzeResults(prev => ({
        ...prev,
        [bill.id]: { ok: true, message: `Done — impact: ${data?.impact_level ?? '?'} (${data?.impact_score ?? '?'}/10), type: ${data?.bill_type ?? '?'}.` },
      }))
    } catch (err: any) {
      setAnalyzeResults(prev => ({ ...prev, [bill.id]: { ok: false, message: err.message } }))
    } finally {
      setAnalyzingId(null)
    }
  }

  const fetchNews = async (bill: Bill) => {
    setFetchingNewsId(bill.id)
    setAnalyzeResults(prev => ({ ...prev, [bill.id]: undefined as any }))
    try {
      const data = await api.fetchBillNews(bill.id)
      setAnalyzeResults(prev => ({ ...prev, [bill.id]: { ok: true, message: `Found ${data?.articles_found ?? 0} news articles.` } }))
    } catch (err: any) {
      setAnalyzeResults(prev => ({ ...prev, [bill.id]: { ok: false, message: err.message } }))
    } finally {
      setFetchingNewsId(null)
    }
  }

  const sortedBills = sortOrder === 'desc' ? [...bills] : [...bills].reverse()
  const totalPages = Math.ceil(billsTotal / PAGE_SIZE)

  const goToPage = (p: number) => {
    setPage(p)
    loadBills(filterYear, filterMonth, filterDateFrom, filterDateTo, p)
  }

  const allPTypesSelected = selectedPTypes.size === ALL_PERSPECTIVE_TYPES.length
  const togglePType = (key: string) => {
    setSelectedPTypes(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="border rounded-lg overflow-hidden">

      {/* ── Header ── */}
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Pipeline</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {billsTotal.toLocaleString()} bills in DB · runs steps in order, skipping already-done work
          </p>
        </div>
        <Button variant="ghost" size="sm"
          onClick={() => loadBills(filterYear, filterMonth, filterDateFrom, filterDateTo, page)}
          disabled={billsLoading || running}>
          {billsLoading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      <div className="p-4 space-y-5">

        {/* ── Date scope filter ── */}
        <div className="rounded-lg border p-3 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date scope</p>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">Year</label>
              <select value={draftYear} onChange={(e) => { setDraftYear(e.target.value); setDraftDateFrom(''); setDraftDateTo('') }}
                className="h-8 rounded border bg-background px-2 text-sm">
                <option value="">Any</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">Month</label>
              <select value={draftMonth} onChange={(e) => { setDraftMonth(e.target.value); setDraftDateFrom(''); setDraftDateTo('') }}
                disabled={!draftYear} className="h-8 rounded border bg-background px-2 text-sm disabled:opacity-40">
                <option value="">Any</option>
                {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div className="hidden sm:flex items-end pb-0.5 px-1 text-xs text-muted-foreground self-end">or</div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">From date</label>
              <input type="date" value={draftDateFrom}
                onChange={(e) => { setDraftDateFrom(e.target.value); setDraftYear(''); setDraftMonth('') }}
                className="h-8 rounded border bg-background px-2 text-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">To date</label>
              <input type="date" value={draftDateTo}
                onChange={(e) => { setDraftDateTo(e.target.value); setDraftYear(''); setDraftMonth('') }}
                className="h-8 rounded border bg-background px-2 text-sm" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={applyFilter} disabled={(!hasDraft && !hasApplied) || counting || running}>
              {counting ? 'Counting…' : 'Apply'}
            </Button>
            {hasApplied && (
              <button onClick={clearFilter} className="text-xs text-muted-foreground hover:text-foreground underline">Clear</button>
            )}
            {filterCount !== null && (
              <span className="text-sm font-semibold text-blue-600">
                {filterCount.toLocaleString()} bill{filterCount !== 1 ? 's' : ''} match{filterLabel ? ` · ${filterLabel}` : ''}
              </span>
            )}
          </div>
        </div>

        {/* ── Step selection ── */}
        <div className="rounded-lg border divide-y">
          {/* Step 1: Analyze */}
          <div className="px-4 py-3 space-y-1">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={stepAnalyze} onChange={e => setStepAnalyze(e.target.checked)}
                className="rounded border-input w-4 h-4" />
              <div className="flex-1">
                <p className="text-sm font-medium">Analyze</p>
                <p className="text-xs text-muted-foreground">
                  Per bill: fetch full text → plain title → auto-tag → AI analysis (summary, impact, city context)
                </p>
              </div>
            </label>
            {stepAnalyze && (
              <label className="flex items-center gap-2 ml-7 text-xs cursor-pointer text-muted-foreground">
                <input type="checkbox" checked={forceAnalyze} onChange={e => setForceAnalyze(e.target.checked)}
                  className="rounded border-input" />
                Force re-analyze already-analyzed bills
              </label>
            )}
          </div>

          {/* Step 2: Perspectives */}
          <div className="px-4 py-3 space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={stepPerspectives} onChange={e => setStepPerspectives(e.target.checked)}
                className="rounded border-input w-4 h-4" />
              <div className="flex-1">
                <p className="text-sm font-medium">Perspectives</p>
                <p className="text-xs text-muted-foreground">
                  Generate AI perspectives for analyzed bills. Uses summary, full text, and city context. Skips cached.
                </p>
              </div>
            </label>
            {stepPerspectives && (
              <div className="ml-7 relative">
                <button
                  onClick={() => setShowPTypeDropdown(v => !v)}
                  className="text-xs border rounded px-2 py-1 bg-background hover:bg-muted flex items-center gap-1.5"
                >
                  {allPTypesSelected ? 'All 17 perspectives' : `${selectedPTypes.size} of 17 selected`}
                  <span>{showPTypeDropdown ? '▲' : '▼'}</span>
                </button>
                {showPTypeDropdown && (
                  <div className="absolute z-10 top-full mt-1 left-0 bg-background border rounded-lg shadow-lg p-2 w-56 space-y-1 max-h-64 overflow-y-auto">
                    <button
                      onClick={() => setSelectedPTypes(allPTypesSelected
                        ? new Set()
                        : new Set(ALL_PERSPECTIVE_TYPES.map(p => p.key))
                      )}
                      className="w-full text-left text-xs px-2 py-1 rounded hover:bg-muted font-medium"
                    >
                      {allPTypesSelected ? 'Deselect all' : 'Select all'}
                    </button>
                    {ALL_PERSPECTIVE_TYPES.map(p => (
                      <label key={p.key} className="flex items-center gap-2 px-2 py-0.5 rounded hover:bg-muted cursor-pointer">
                        <input type="checkbox" checked={selectedPTypes.has(p.key)} onChange={() => togglePType(p.key)} className="rounded" />
                        <span className="text-xs">{p.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 3: News */}
          <div className="px-4 py-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={stepNews} onChange={e => setStepNews(e.target.checked)}
                className="rounded border-input w-4 h-4" />
              <div className="flex-1">
                <p className="text-sm font-medium">Fetch News</p>
                <p className="text-xs text-muted-foreground">
                  Search Google News for related articles. Always re-fetches — unchecked by default.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* ── Run button ── */}
        <div className="flex items-center gap-3">
          <Button
            onClick={runPipeline}
            disabled={running || (!stepAnalyze && !stepPerspectives && !stepNews)}
          >
            {running ? 'Running Pipeline…' : `Run Pipeline${filterLabel ? ` · ${filterLabel}` : ''}`}
          </Button>
          {hasApplied && !filterLabel && (
            <span className="text-xs text-muted-foreground">scoped to applied filter</span>
          )}
        </div>

        {/* ── Progress ── */}
        <ProgressBar progress={progress} running={running} onStop={stop} />

        {/* ── Per-bill queue ── */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Per-bill actions
              {billsTotal > 0 && (
                <span className="ml-1 normal-case font-normal">
                  · {billsTotal.toLocaleString()} bills{bills.length < billsTotal ? ` (showing ${bills.length})` : ''}
                </span>
              )}
            </p>
            <button
              onClick={() => setSortOrder(o => o === 'desc' ? 'asc' : 'desc')}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-0.5 rounded border hover:border-foreground/30 transition-colors"
            >
              {sortOrder === 'desc' ? '↓ Newest first' : '↑ Oldest first'}
            </button>
          </div>

          {bills.length === 0 && !billsLoading ? (
            <p className="text-sm text-muted-foreground py-2">No bills yet — ingest some above.</p>
          ) : (
            <>
              <div className="rounded-lg border divide-y">
                {billsLoading ? (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center">Loading…</div>
                ) : sortedBills.map((bill) => {
                  const result = analyzeResults[bill.id]
                  const isAnalyzing = analyzingId === bill.id
                  return (
                    <div key={bill.id} className="flex items-center gap-3 px-3 py-2 bg-background hover:bg-muted/20 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground shrink-0">{bill.bill_number}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                            bill.analyzed_at ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {bill.analyzed_at ? 'Analyzed' : 'Pending'}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{bill.plain_title || bill.title}</p>
                        {result && (
                          <p className={`text-[11px] mt-0.5 ${result.ok ? 'text-green-600' : 'text-destructive'}`}>{result.message}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => fetchNews(bill)}
                          disabled={fetchingNewsId === bill.id || analyzingId !== null || fetchingNewsId !== null}>
                          {fetchingNewsId === bill.id ? '…' : 'News'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => analyzeBill(bill)}
                          disabled={isAnalyzing || analyzingId !== null || fetchingNewsId !== null || running}>
                          {isAnalyzing ? '…' : bill.analyzed_at ? 'Re-analyze' : 'Analyze'}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => goToPage(page - 1)} disabled={page === 0 || billsLoading}
                      className="px-2 py-1 text-xs rounded border hover:bg-muted disabled:opacity-40">← Prev</button>
                    <button onClick={() => goToPage(page + 1)} disabled={page >= totalPages - 1 || billsLoading}
                      className="px-2 py-1 text-xs rounded border hover:bg-muted disabled:opacity-40">Next →</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function MetricsSection() {
  const [metrics, setMetrics] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const load = async () => {
    setLoading(true)
    try { const data = await api.getMetrics(); setMetrics(data?.metrics ?? null) }
    catch { /* ignore */ } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const statTile = (label: string, value: number | string, sub?: string) => (
    <div key={label} className="border rounded-lg p-3 text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-medium text-muted-foreground mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{sub}</p>}
    </div>
  )

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Metrics</h3>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
      </div>
      {metrics ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {statTile('Bills', metrics.bills.total)}
          {statTile('Analyzed', metrics.bills.analyzed, `${metrics.bills.analysis_rate_pct}% of total`)}
          {statTile('Perspectives', metrics.perspectives.total)}
          {statTile('Users', metrics.users.total)}
          {statTile('Saved Bills', metrics.tracking.total_saves)}
          {statTile('Digest Opt-ins', metrics.users.digest_opted_in)}
          {statTile('With News', metrics.bills.with_news)}
          {statTile('Local Bills', metrics.bills.local)}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{loading ? 'Loading metrics…' : 'Failed to load.'}</p>
      )}
    </div>
  )
}

function DigestSection() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h3 className="font-semibold">Weekly Email Digest</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Send a digest of recently analyzed bills to all opted-in users. Requires RESEND_API_KEY in .env.
        </p>
      </div>
      {result && <p className={`text-sm ${result.ok ? 'text-green-600' : 'text-destructive'}`}>{result.message}</p>}
      <Button variant="outline" disabled={running} onClick={async () => {
        setRunning(true); setResult(null)
        try {
          const data = await api.sendDigest(7)
          setResult({ ok: true, message: `Sent to ${data?.sent ?? 0} users · ${data?.bills_in_digest ?? 0} bills · ${data?.failed ?? 0} failed.` })
        } catch (err: any) {
          setResult({ ok: false, message: err.message })
        } finally { setRunning(false) }
      }}>
        {running ? 'Sending…' : 'Send Digest Now'}
      </Button>
    </div>
  )
}

function BackfillCityContextSection() {
  const { progress, running, start, stop } = useStreamProgress()
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h3 className="font-semibold">Backfill City Context</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Repair tool for legacy bills missing supplementary_data (Philadelphia statistics). Only processes analyzed, tagged bills without context.
        </p>
      </div>
      <ProgressBar progress={progress} running={running} onStop={stop} />
      <Button variant="outline" disabled={running} onClick={() => start('/api/legislation/stream/backfill-city-context')}>
        {running ? 'Backfilling…' : 'Backfill City Context'}
      </Button>
    </div>
  )
}
