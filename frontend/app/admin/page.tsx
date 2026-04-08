'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { isLoggedIn } from '@/lib/auth'
import { usePipeline } from '@/app/contexts/pipeline-context'

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
  const [pipelineFilter, setPipelineFilter] = useState<{ year: string; month: string; date_from: string; date_to: string }>({ year: '', month: '', date_from: '', date_to: '' })

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

      {/* ── Section 0: System Status ──────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">System Status</h2>
        <SystemStatusSection />
      </section>

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
              <Button type="submit" disabled={localRunning} className="bg-blue-600 hover:bg-blue-700 text-white">
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
          <div className="flex flex-wrap gap-2">
            <Button className="bg-blue-600 hover:bg-blue-700 text-white" disabled={scrapeRunning} onClick={async () => {
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
            <Button variant="outline" disabled={scrapeRunning} onClick={async () => {
              setScrapeRunning(true); setScrapeResult(null)
              try {
                const data = await api.backfillCouncilmemberEmails()
                const msg = data?.updated === 0
                  ? `All members already have emails (checked ${data?.checked ?? 0}).`
                  : `Updated ${data?.updated} email${data?.updated !== 1 ? 's' : ''} · still missing: ${(data?.still_missing ?? []).join(', ') || 'none'}.`
                setScrapeResult({ ok: true, message: msg })
              } catch (err: any) {
                setScrapeResult({ ok: false, message: err.message })
              } finally {
                setScrapeRunning(false)
              }
            }}>
              {scrapeRunning ? 'Running…' : 'Backfill Missing Emails'}
            </Button>
          </div>
        </div>
      </section>

      {/* ── Section B: Bill Pipeline ───────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Bill Pipeline</h2>
        <BillPipelineSection authorized={authorized} reloadKey={reloadKey} onReload={() => setReloadKey(k => k + 1)} onFilterChange={setPipelineFilter} />
      </section>

      {/* ── Section C: Utilities ───────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Utilities</h2>
        <MetricsSection filter={pipelineFilter} />
        <DigestSection />
        <RefreshHearingsSection />
        <CandidateManagementSection />
        <BackfillSponsorsSection />
        <BackfillCityContextSection />
        <BackfillVoteRecordsSection />
        <SyncStatusesSection />
      </section>
    </div>
  )
}

// ── System Status ─────────────────────────────────────────────────────────────
function SystemStatusSection() {
  const [metrics, setMetrics] = useState<any>(null)
  const [health, setHealth] = useState<{ db: string; ai_provider: string; ai_model: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [m, h] = await Promise.allSettled([api.getMetrics(), api.getSystemHealth()])
      if (m.status === 'fulfilled') setMetrics(m.value?.metrics ?? null)
      if (h.status === 'fulfilled') setHealth(h.value ?? null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const unanalyzed = metrics ? metrics.bills.total - metrics.bills.analyzed : null
  const pct = metrics?.bills?.analysis_rate_pct ?? 0

  const statusColor = (val: number) => {
    if (val === 0) return 'text-green-600'
    if (val < 100) return 'text-yellow-600'
    return 'text-red-600'
  }

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Live snapshot of pipeline health and AI config.</p>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
      </div>

      {metrics ? (
        <>
          {/* ── Key numbers ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="border rounded-lg p-3 text-center">
              <p className="text-2xl font-bold">{metrics.bills.total.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Total Bills</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <p className={`text-2xl font-bold ${statusColor(unanalyzed ?? 0)}`}>
                {unanalyzed?.toLocaleString() ?? '–'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Unanalyzed</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <p className="text-2xl font-bold">{metrics.perspectives.total.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Perspectives</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <p className="text-2xl font-bold">{metrics.users.total.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Users</p>
            </div>
          </div>

          {/* ── Analysis coverage bar ── */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Analysis coverage</span>
              <span className="tabular-nums">{metrics.bills.analyzed.toLocaleString()} / {metrics.bills.total.toLocaleString()} ({pct}%)</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#22c55e' : pct > 50 ? '#3b82f6' : '#f59e0b' }}
              />
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{loading ? 'Loading…' : 'Failed to load metrics.'}</p>
      )}

      {/* ── AI + DB config ── */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span>
          <span className="text-muted-foreground">DB: </span>
          <span className={health?.db === 'ok' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
            {health?.db ?? '–'}
          </span>
        </span>
        <span>
          <span className="text-muted-foreground">AI provider: </span>
          <span className="font-mono">{health?.ai_provider ?? '–'}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Model: </span>
          <span className="font-mono">{health?.ai_model ?? '–'}</span>
        </span>
      </div>
    </div>
  )
}

// ── Bill Pipeline ─────────────────────────────────────────────────────────────
function BillPipelineSection({ authorized, reloadKey, onReload, onFilterChange }: { authorized: boolean; reloadKey: number; onReload: () => void; onFilterChange?: (f: { year: string; month: string; date_from: string; date_to: string }) => void }) {
  const { progress, running, start, stop } = usePipeline()
  const PAGE_SIZE = 20

  // Step toggles
  const [stepSponsors,      setStepSponsors]      = useState(false)
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
    onFilterChange?.({ year: draftYear, month: draftMonth, date_from: draftDateFrom, date_to: draftDateTo })
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
    onFilterChange?.({ year: '', month: '', date_from: '', date_to: '' })
    loadBills()
  }

  const buildPipelinePath = () => {
    const steps = [
      stepSponsors      && 'sponsors',
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
          {/* Step 0: Sponsors */}
          <div className="px-4 py-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={stepSponsors} onChange={e => setStepSponsors(e.target.checked)}
                className="rounded border-input w-4 h-4" />
              <div className="flex-1">
                <p className="text-sm font-medium">Backfill Sponsors</p>
                <p className="text-xs text-muted-foreground">
                  Scrapes Legistar once to build a matter→GUID map, then fetches the sponsor for each bill in scope that has none. Unchecked by default — takes ~30–60 min for a full run.
                </p>
              </div>
            </label>
          </div>

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
            size="lg"
            onClick={runPipeline}
            disabled={running || (!stepSponsors && !stepAnalyze && !stepPerspectives && !stepNews)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6"
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
function MetricsSection({ filter }: { filter?: { year: string; month: string; date_from: string; date_to: string } }) {
  const [metrics, setMetrics] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const load = async () => {
    setLoading(true)
    try {
      const data = await api.getMetrics(filter?.year || filter?.month || filter?.date_from || filter?.date_to ? filter : undefined)
      setMetrics(data?.metrics ?? null)
    }
    catch { /* ignore */ } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [filter?.year, filter?.month, filter?.date_from, filter?.date_to])

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
        <div>
          <h3 className="font-semibold">Metrics</h3>
          {(filter?.year || filter?.month || filter?.date_from || filter?.date_to) && (
            <p className="text-xs text-blue-600 mt-0.5">Scoped to pipeline filter</p>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</Button>
      </div>
      {metrics ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {statTile('Bills', metrics.bills.total, metrics.bills.scoped ? 'in scope' : undefined)}
          {statTile('Analyzed', metrics.bills.analyzed, `${metrics.bills.analysis_rate_pct}% of total`)}
          {statTile('Perspectives', metrics.perspectives.total)}
          {statTile('Users', metrics.users.total)}
          {statTile('Saved Bills', metrics.tracking.total_saves)}
          {statTile('Digest Opt-ins', metrics.users.digest_opted_in)}
          {statTile('With News', metrics.bills.with_news)}
          {statTile('Plain Titles', metrics.bills.with_plain_titles)}
          {statTile('Vote Records', metrics.bills.with_vote_records ?? 0, 'bills backfilled')}
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
      <Button disabled={running} className="bg-blue-600 hover:bg-blue-700 text-white" onClick={async () => {
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

function BackfillSponsorsSection() {
  const { progress, running, start, stop } = useStreamProgress()
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h3 className="font-semibold">Backfill Sponsors</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Backfill sponsor names for the ~8,500 bulk-imported bills that have no sponsor set.
          Scrapes the Legistar list page once to build a matter→GUID map, then fetches each bill's
          detail page. Takes ~30–60 min for a full run.
        </p>
      </div>
      <ProgressBar progress={progress} running={running} onStop={stop} />
      <Button disabled={running} className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => start('/api/legislation/stream/backfill-sponsors')}>
        {running ? 'Backfilling Sponsors…' : 'Backfill Sponsors'}
      </Button>
    </div>
  )
}

function RefreshHearingsSection() {
  const { progress, running, start, stop } = useStreamProgress()

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h3 className="font-semibold">Upcoming Hearings</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Scrape phila.legistar.com/Calendar.aspx and update hearing dates on matching bills. Takes 1–3 minutes.
        </p>
      </div>
      <ProgressBar progress={progress} running={running} onStop={stop} />
      <Button
        disabled={running}
        className="bg-blue-600 hover:bg-blue-700 text-white"
        onClick={() => start('/api/hearings/stream/refresh')}
      >
        {running ? 'Refreshing Hearings…' : 'Refresh Hearings'}
      </Button>
    </div>
  )
}

function ScrapeCandidatesButton({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [year, setYear] = useState(2025)

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {result && (
        <span className={`text-xs ${result.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
          {result.message}
        </span>
      )}
      <select
        value={year}
        onChange={(e) => setYear(Number(e.target.value))}
        className="rounded border border-input bg-background px-2 py-1.5 text-xs focus:outline-none"
      >
        {[2027, 2025, 2023, 2021].map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <Button
        disabled={running}
        variant="outline"
        className="text-xs px-3 py-1.5"
        onClick={async () => {
          setRunning(true); setResult(null)
          try {
            const data = await api.scrapeCandidates(year, false)
            const src = data?.source_year && data.source_year !== year ? ` (from ${data.source_year} — ${year} page not found yet)` : ''
            setResult({ ok: true, message: `Added ${data?.added ?? 0}, skipped ${data?.skipped ?? 0}${src}` })
            onDone()
          } catch (e: any) {
            setResult({ ok: false, message: e.message || 'Scrape failed' })
          } finally { setRunning(false) }
        }}
      >
        {running ? 'Scraping…' : 'Scrape Ballotpedia'}
      </Button>
    </div>
  )
}

function CandidateManagementSection() {
  const [candidates, setCandidates] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const emptyForm = { name: '', district: '', party: '', office_sought: '', election_year: new Date().getFullYear() + 1, is_incumbent: false, bio: '', website_url: '', known_positions: '' }
  const [form, setForm] = useState<typeof emptyForm>(emptyForm)

  const load = () => {
    setLoading(true)
    api.getCandidates().then((d) => setCandidates(d?.candidates ?? [])).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const handleSave = async () => {
    if (!form.name || !form.district) return
    setSaving(true)
    try {
      if (editingId) {
        await api.updateCandidate(editingId, form)
      } else {
        await api.createCandidate({ ...form, election_year: Number(form.election_year) })
      }
      setForm(emptyForm); setShowForm(false); setEditingId(null); load()
    } catch (e: any) {
      alert(e.message)
    } finally { setSaving(false) }
  }

  const handleEdit = (c: any) => {
    setForm({ name: c.name, district: c.district, party: c.party ?? '', office_sought: c.office_sought ?? '', election_year: c.election_year, is_incumbent: !!c.is_incumbent, bio: c.bio ?? '', website_url: c.website_url ?? '', known_positions: c.known_positions ?? '' })
    setEditingId(c.id); setShowForm(true)
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete candidate ${name}? This also clears their cached predictions.`)) return
    await api.deleteCandidate(id); load()
  }

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold">Election Candidates</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Manage candidate profiles shown on the Elections page.</p>
        </div>
        <div className="flex gap-2">
          <ScrapeCandidatesButton onDone={load} />
          <Button className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5" onClick={() => { setForm(emptyForm); setEditingId(null); setShowForm(true) }}>
            + Add
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="border rounded-md p-4 space-y-3 bg-muted/20">
          <p className="text-sm font-medium">{editingId ? 'Edit Candidate' : 'New Candidate'}</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              ['name', 'Full name', 'text'],
              ['district', 'District (e.g. "District 2" or "At-Large")', 'text'],
              ['party', 'Party', 'text'],
              ['office_sought', 'Office sought', 'text'],
              ['election_year', 'Election year', 'number'],
              ['website_url', 'Campaign website URL', 'text'],
            ].map(([field, label, type]) => (
              <div key={field} className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{label}</label>
                <input
                  type={type}
                  value={(form as any)[field]}
                  onChange={(e) => setForm((f) => ({ ...f, [field]: type === 'number' ? Number(e.target.value) : e.target.value }))}
                  className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Bio</label>
            <textarea rows={2} value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Known positions (AI uses this for predictions — e.g. "Supports affordable housing; opposes stadium subsidies")</label>
            <textarea rows={2} value={form.known_positions} onChange={(e) => setForm((f) => ({ ...f, known_positions: e.target.value }))} className="w-full rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_incumbent} onChange={(e) => setForm((f) => ({ ...f, is_incumbent: e.target.checked }))} />
            Incumbent
          </label>
          <div className="flex gap-2">
            <Button disabled={saving || !form.name || !form.district} className="bg-blue-600 hover:bg-blue-700 text-white" onClick={handleSave}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setEditingId(null); setForm(emptyForm) }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No candidates yet.</p>
      ) : (
        <div className="space-y-2">
          {candidates.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm border rounded-md px-3 py-2">
              <div>
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground ml-2">{c.district} · {c.party ?? 'Independent'} · {c.election_year}</span>
                {c.is_incumbent && <span className="ml-2 text-xs text-blue-600">(incumbent)</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleEdit(c)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Edit</button>
                <button onClick={() => handleDelete(c.id, c.name)} className="text-xs text-red-500 hover:text-red-700 transition-colors">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SyncStatusesSection() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const run = async () => {
    setRunning(true); setResult(null)
    try {
      const data = await api.syncBillStatuses()
      setResult(`Checked ${data.checked} bills, updated ${data.updated}`)
    } catch (e: any) {
      setResult(`Error: ${e.message}`)
    } finally {
      setRunning(false)
    }
  }
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h3 className="font-semibold">Sync Bill Statuses</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Re-fetch status from Legistar for all introduced/in-committee bills. Detects bills that have been passed, failed, or vetoed since last ingest.
        </p>
      </div>
      {result && <p className="text-sm text-muted-foreground">{result}</p>}
      <Button disabled={running} className="bg-blue-600 hover:bg-blue-700 text-white" onClick={run}>
        {running ? 'Syncing…' : 'Sync Statuses'}
      </Button>
    </div>
  )
}

function BackfillVoteRecordsSection() {
  const { progress, running, start, stop } = useStreamProgress()
  const [limit, setLimit] = useState(100)
  const [force, setForce] = useState(false)
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h3 className="font-semibold">Backfill Vote Records</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Fetch official roll call votes from Legistar for all local bills and cache them in the database.
        </p>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground shrink-0">Bill limit:</label>
          <input
            type="number"
            min={1}
            max={8500}
            value={limit}
            disabled={running}
            onChange={e => setLimit(Math.max(1, Math.min(8500, Number(e.target.value))))}
            className="w-24 border rounded px-2 py-1 text-sm"
          />
          <span className="text-xs text-muted-foreground">(max 8500)</span>
        </div>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={force}
            disabled={running}
            onChange={e => setForce(e.target.checked)}
          />
          Force re-fetch
        </label>
      </div>
      <ProgressBar progress={progress} running={running} onStop={stop} />
      <Button disabled={running} className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => start(`/api/legislation/stream/backfill-vote-records?limit=${limit}&force=${force}`)}>
        {running ? 'Fetching votes…' : 'Backfill Vote Records'}
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
      <Button disabled={running} className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => start('/api/legislation/stream/backfill-city-context')}>
        {running ? 'Backfilling…' : 'Backfill City Context'}
      </Button>
    </div>
  )
}
