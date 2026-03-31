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
    // Call backend directly to bypass Next.js proxy buffering (SSE requires streaming passthrough)
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

function ProgressBar({ progress, running, onStop, className = '' }: { progress: StreamEvent | null; running: boolean; onStop?: () => void; className?: string }) {
  const elapsed = useElapsed(running)
  if (!progress) return null
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : (progress.done ? 100 : 0)
  const isError = progress.done && progress.message.toLowerCase().includes('failed') && progress.current === 0
  const isDone = progress.done && !isError

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex justify-between items-center text-xs text-muted-foreground">
        <span className={isDone ? 'text-green-600 font-medium' : ''}>{progress.message}</span>
        <div className="flex items-center gap-3 shrink-0 ml-2 tabular-nums">
          {progress.total > 0 && <span>{progress.current} / {progress.total}</span>}
          {(running || isDone) && <span className="text-muted-foreground/60">{formatElapsed(elapsed)}</span>}
          {running && onStop && (
            <button
              onClick={onStop}
              className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
              title="Stop process"
            >
              Stop
            </button>
          )}
        </div>
      </div>
      <div className="h-3 rounded-full overflow-hidden" style={{ backgroundColor: '#e5e7eb' }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            backgroundColor: isError ? '#ef4444' : isDone ? '#22c55e' : '#3b82f6',
          }}
        />
      </div>
    </div>
  )
}


interface Result {
  ok: boolean
  message: string
}

interface Bill {
  id: string
  bill_number: string
  title: string
  level: string
  status: string
  analyzed_at?: string
}

export default function AdminPage() {
  const router = useRouter()
  const [authorized, setAuthorized] = useState(false)
  const [loading, setLoading] = useState(true)

  // Local ingest form
  const [city, setCity] = useState('philadelphia')
  const [localLimit, setLocalLimit] = useState('5')
  const [localBulk, setLocalBulk] = useState(false)
  const [localRunning, setLocalRunning] = useState(false)
  const [localResult, setLocalResult] = useState<Result | null>(null)

  // Council members scrape
  const [scrapeRunning, setScrapeRunning] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<Result | null>(null)

  // Analyze queue
  const [bills, setBills] = useState<Bill[]>([])
  const [billsLoading, setBillsLoading] = useState(false)
  const [billsTotal, setBillsTotal] = useState(0)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [analyzeResults, setAnalyzeResults] = useState<Record<string, Result>>({})
  const [fetchingNewsId, setFetchingNewsId] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/')
      return
    }
    api.getMe()
      .then((data) => {
        if (data?.user?.subscription_tier === 'dev') {
          setAuthorized(true)
        } else {
          router.replace('/')
        }
      })
      .catch(() => router.replace('/'))
      .finally(() => setLoading(false))
  }, [router])

  const loadBills = useCallback(async () => {
    setBillsLoading(true)
    try {
      const data = await api.searchLegislation('', 100, 0, 'local')
      setBills(data?.results ?? [])
      setBillsTotal(data?.total ?? 0)
    } catch {
      // silent
    } finally {
      setBillsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authorized) loadBills()
  }, [authorized, loadBills])

  const ingestLocal = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalRunning(true)
    setLocalResult(null)
    try {
      const data = await api.ingestLocal(city.trim(), Number(localLimit), localBulk)
      const count = data?.bills_ingested ?? data?.total ?? 0
      setLocalResult({ ok: true, message: `Ingested ${count} items from "${city}".` })
      loadBills()
    } catch (err: any) {
      setLocalResult({ ok: false, message: err.message })
    } finally {
      setLocalRunning(false)
    }
  }

  const analyzeBill = async (bill: Bill) => {
    setAnalyzingId(bill.id)
    setAnalyzeResults((prev) => ({ ...prev, [bill.id]: undefined as any }))
    try {
      const data = await api.analyzeLegislation(bill.id)
      setAnalyzeResults((prev) => ({
        ...prev,
        [bill.id]: {
          ok: true,
          message: `Done — impact: ${data?.impact_level ?? '?'} (${data?.impact_score ?? '?'}/10), type: ${data?.bill_type ?? '?'}. Perspectives: ${(data?.perspectives_generated ?? []).join(', ') || 'none'}.`,
        },
      }))
    } catch (err: any) {
      setAnalyzeResults((prev) => ({
        ...prev,
        [bill.id]: { ok: false, message: err.message },
      }))
    } finally {
      setAnalyzingId(null)
    }
  }

  const fetchNews = async (bill: Bill) => {
    setFetchingNewsId(bill.id)
    setAnalyzeResults((prev) => ({ ...prev, [bill.id]: undefined as any }))
    try {
      const data = await api.fetchBillNews(bill.id)
      setAnalyzeResults((prev) => ({
        ...prev,
        [bill.id]: { ok: true, message: `Found ${data?.articles_found ?? 0} news articles.` },
      }))
    } catch (err: any) {
      setAnalyzeResults((prev) => ({
        ...prev,
        [bill.id]: { ok: false, message: err.message },
      }))
    } finally {
      setFetchingNewsId(null)
    }
  }

  if (loading) return <div className="h-64 bg-muted animate-pulse rounded-lg" />
  if (!authorized) return null

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-muted-foreground mt-1">
          Ingest bills from external sources and trigger AI analysis.
        </p>
      </div>

      {/* ── Metrics ─────────────────────────────────────────────── */}
      <MetricsSection />

      {/* ── Send Digest ──────────────────────────────────────────── */}
      <DigestSection />

      {/* ── Council Members ─────────────────────────────────────── */}
      <div className="border rounded-lg p-4 space-y-3">
        <div>
          <h2 className="font-semibold">Council Members</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Scrape all 17 current Philadelphia City Council member profiles from phlcouncil.com.
            Takes ~2 minutes. Safe to re-run — upserts existing records.
          </p>
        </div>
        {scrapeResult && (
          <p className={`text-sm ${scrapeResult.ok ? 'text-green-600' : 'text-destructive'}`}>
            {scrapeResult.message}
          </p>
        )}
        <Button
          variant="outline"
          disabled={scrapeRunning}
          onClick={async () => {
            setScrapeRunning(true)
            setScrapeResult(null)
            try {
              const data = await api.scrapeCouncilmembers()
              setScrapeResult({ ok: true, message: `Scraped ${data?.scraped ?? 0} council members.` })
            } catch (err: any) {
              setScrapeResult({ ok: false, message: err.message })
            } finally {
              setScrapeRunning(false)
            }
          }}
        >
          {scrapeRunning ? 'Scraping…' : 'Scrape Council Members'}
        </Button>
      </div>

      {/* ── Fetch News ─────────────────────────────────────────── */}
      <FetchNewsSection />

      {/* ── Fetch Full Text ──────────────────────────────────────── */}
      <FetchDetailsSection />

      {/* ── Philadelphia Context ─────────────────────────────────── */}
      <CityContextSection />

      {/* ── Plain English Titles ────────────────────────────────── */}
      <PlainTitlesSection />

      {/* ── Auto-Tag Bills ──────────────────────────────────────── */}
      <AutoTagSection onDone={loadBills} />

      {/* ── Analyze Bills ───────────────────────────────────────── */}
      <AnalyzeBillsSection bills={bills} billsTotal={billsTotal} billsLoading={billsLoading} loadBills={loadBills} analyzingId={analyzingId} fetchingNewsId={fetchingNewsId} analyzeResults={analyzeResults} analyzeBill={analyzeBill} fetchNews={fetchNews} />

      {/* ── All Perspectives ────────────────────────────────────── */}
      <AllPerspectivesSection />

      {/* ── Legislation Ingestion ────────────────────────────────── */}
      <div className="border rounded-lg p-4 space-y-4">
        <div>
          <h2 className="font-semibold">Ingest Philadelphia Bills</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Fetch bills from Legistar. Enable <strong>Bulk Export</strong> to import all ~8,500 bills at once via Excel export.
          </p>
        </div>
        <form onSubmit={ingestLocal} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Limit <span className="text-muted-foreground">(ignored for bulk)</span></label>
            <input
              type="number" min={1} max={250}
              value={localLimit}
              onChange={(e) => setLocalLimit(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={localBulk}
              onChange={(e) => setLocalBulk(e.target.checked)}
              className="rounded border-input"
            />
            <span>Bulk export — exports all bills via Excel, ignores limit</span>
          </label>
          {localResult && (
            <p className={`text-sm ${localResult.ok ? 'text-green-600' : 'text-destructive'}`}>
              {localResult.message}
            </p>
          )}
          <Button type="submit" disabled={localRunning}>
            {localRunning ? 'Ingesting…' : 'Ingest Bills'}
          </Button>
        </form>
      </div>
    </div>
  )
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function AnalyzeBillsSection({
  bills, billsTotal, billsLoading, loadBills,
  analyzingId, fetchingNewsId, analyzeResults, analyzeBill, fetchNews,
}: {
  bills: Bill[]
  billsTotal: number
  billsLoading: boolean
  loadBills: () => void
  analyzingId: string | null
  fetchingNewsId: string | null
  analyzeResults: Record<string, Result>
  analyzeBill: (bill: Bill) => void
  fetchNews: (bill: Bill) => void
}) {
  const { progress, running, start, stop } = useStreamProgress()
  const [activeKey,      setActiveKey]      = useState<string | null>(null)

  // Filter state — "draft" values before Apply
  const [draftYear,      setDraftYear]      = useState('')
  const [draftMonth,     setDraftMonth]     = useState('')
  const [draftDateFrom,  setDraftDateFrom]  = useState('')
  const [draftDateTo,    setDraftDateTo]    = useState('')

  // Applied filter — what's actually sent to the backend
  const [filterYear,     setFilterYear]     = useState('')
  const [filterMonth,    setFilterMonth]    = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo,   setFilterDateTo]   = useState('')

  // Count from backend after Apply
  const [filterCount,    setFilterCount]    = useState<number | null>(null)
  const [counting,       setCounting]       = useState(false)

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: currentYear - 1999 }, (_, i) => currentYear - i)

  const hasDraft = !!(draftYear || draftMonth || draftDateFrom || draftDateTo)
  const hasApplied = !!(filterYear || filterMonth || filterDateFrom || filterDateTo)

  const applyFilter = async () => {
    setFilterYear(draftYear)
    setFilterMonth(draftMonth)
    setFilterDateFrom(draftDateFrom)
    setFilterDateTo(draftDateTo)
    setCounting(true)
    setFilterCount(null)
    try {
      const data = await api.countLegislation({
        year:      draftYear      ? Number(draftYear)  : undefined,
        month:     draftMonth     ? Number(draftMonth) : undefined,
        date_from: draftDateFrom  || undefined,
        date_to:   draftDateTo    || undefined,
      })
      setFilterCount(data?.count ?? 0)
    } catch { setFilterCount(null) }
    finally   { setCounting(false) }
  }

  const clearFilter = () => {
    setDraftYear(''); setDraftMonth(''); setDraftDateFrom(''); setDraftDateTo('')
    setFilterYear(''); setFilterMonth(''); setFilterDateFrom(''); setFilterDateTo('')
    setFilterCount(null)
  }

  const buildParams = (force: boolean, forcePerspectives = false) => {
    const p = new URLSearchParams()
    if (force)             p.set('force',              'true')
    if (forcePerspectives) p.set('force_perspectives', 'true')
    if (filterYear)        p.set('year',      filterYear)
    if (filterMonth)       p.set('month',     filterMonth)
    if (filterDateFrom)    p.set('date_from', filterDateFrom)
    if (filterDateTo)      p.set('date_to',   filterDateTo)
    return p.toString()
  }

  const run = (key: string, force: boolean, forcePerspectives = false) => {
    setActiveKey(key)
    start(`/api/legislation/stream/analyze-all?${buildParams(force, forcePerspectives)}`).then(() => loadBills())
  }

  const runFull = (key: string, force: boolean) => {
    setActiveKey(key)
    start(`/api/legislation/stream/analyze-all-full?${buildParams(force)}`).then(() => loadBills())
  }

  const filterLabel = (() => {
    if (filterYear && filterMonth) return `${MONTHS_SHORT[Number(filterMonth)-1]} ${filterYear}`
    if (filterYear)  return filterYear
    if (filterDateFrom && filterDateTo) return `${filterDateFrom} → ${filterDateTo}`
    if (filterDateFrom) return `From ${filterDateFrom}`
    if (filterDateTo)   return `Until ${filterDateTo}`
    return ''
  })()

  return (
    <div className="border rounded-lg overflow-hidden">

      {/* ── Header ── */}
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Analyze Bills</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {billsTotal.toLocaleString()} bills in DB · generates summary, impact score &amp; base perspectives
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={loadBills} disabled={billsLoading || running}>
          {billsLoading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      <div className="p-4 space-y-4">

        {/* ── Date filter ── */}
        <div className="rounded-lg border p-3 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Scope — filter by date introduced
          </p>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">Year</label>
              <select
                value={draftYear}
                onChange={(e) => { setDraftYear(e.target.value); setDraftDateFrom(''); setDraftDateTo('') }}
                className="h-8 rounded border bg-background px-2 text-sm"
              >
                <option value="">Any</option>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-muted-foreground">Month</label>
              <select
                value={draftMonth}
                onChange={(e) => { setDraftMonth(e.target.value); setDraftDateFrom(''); setDraftDateTo('') }}
                disabled={!draftYear}
                className="h-8 rounded border bg-background px-2 text-sm disabled:opacity-40"
              >
                <option value="">Any</option>
                {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div className="flex items-end pb-0.5 px-1 text-xs text-muted-foreground self-end hidden sm:block">or</div>
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
            <Button size="sm" onClick={applyFilter} disabled={!hasDraft && !hasApplied || counting || running}>
              {counting ? 'Counting…' : 'Apply filter'}
            </Button>
            {hasApplied && (
              <button onClick={clearFilter} className="text-xs text-muted-foreground hover:text-foreground underline">
                Clear
              </button>
            )}
            {filterCount !== null && (
              <span className="text-sm font-semibold text-blue-600">
                {filterCount.toLocaleString()} bill{filterCount !== 1 ? 's' : ''} match
                {filterLabel ? ` · ${filterLabel}` : ''}
              </span>
            )}
          </div>
        </div>

        {/* ── Bulk actions ── */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Bulk actions{hasApplied && filterLabel ? ` · scoped to ${filterLabel}` : ' · all bills'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {([
              { key: 'new',     label: 'Analyze Unanalyzed',            desc: 'Summary + impact + 3 base perspectives',         action: () => run('new', false, false) },
              { key: 'all',     label: 'Re-analyze All',                desc: 'Re-run analysis, keep existing perspectives',    action: () => run('all', true, false) },
              { key: 'full',    label: 'Re-analyze + Perspectives',     desc: 'Re-run analysis and regenerate 3 base perspectives', action: () => run('full', true, true) },
              { key: 'fullnew', label: 'Analyze + All 17 Perspectives', desc: 'Full analysis + generate all 17 perspectives',   action: () => runFull('fullnew', false) },
            ] as const).map(({ key, label, desc, action }) => (
              <button
                key={key}
                onClick={action}
                disabled={running}
                className={`text-left rounded-lg border px-3 py-2.5 transition-all hover:border-primary/60 hover:bg-muted/20 disabled:opacity-40 ${
                  running && activeKey === key ? 'border-primary bg-primary/5' : ''
                }`}
              >
                <p className="text-sm font-medium">
                  {running && activeKey === key ? '⏳ ' : ''}{label}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* ── Progress bar ── */}
        <ProgressBar progress={progress} running={running} onStop={stop} />

        {/* ── Per-bill queue ── */}
        {bills.length === 0 && !billsLoading ? (
          <p className="text-sm text-muted-foreground">No bills yet. Ingest some below.</p>
        ) : (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per-bill actions</p>
            <div className="space-y-px max-h-80 overflow-y-auto rounded-lg border divide-y">
              {bills.map((bill) => {
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
                        <p className={`text-[11px] mt-0.5 ${result.ok ? 'text-green-600' : 'text-destructive'}`}>
                          {result.message}
                        </p>
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
          </div>
        )}

      </div>
    </div>
  )
}

function AllPerspectivesSection() {
  const { progress, running, start, stop } = useStreamProgress()

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Generate All Perspectives</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Generate all 17 perspectives for every analyzed bill. Skips already-cached perspectives.
          Run this after bulk analysis to fill out the full set.
        </p>
      </div>
      <ProgressBar progress={progress} running={running} onStop={stop} />
      <Button
        variant="outline"
        disabled={running}
        onClick={() => start('/api/legislation/stream/generate-all-perspectives')}
      >
        {running ? 'Generating…' : 'Generate All Perspectives'}
      </Button>
    </div>
  )
}

function MetricsSection() {
  const [metrics, setMetrics] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await api.getMetrics()
      setMetrics(data?.metrics ?? null)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
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
        <h2 className="font-semibold">Metrics</h2>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
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
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Weekly Email Digest</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Send a digest of recently analyzed bills to all opted-in users. Requires RESEND_API_KEY in .env.
        </p>
      </div>
      {result && (
        <p className={`text-sm ${result.ok ? 'text-green-600' : 'text-destructive'}`}>
          {result.message}
        </p>
      )}
      <Button
        variant="outline"
        disabled={running}
        onClick={async () => {
          setRunning(true)
          setResult(null)
          try {
            const data = await api.sendDigest(7)
            setResult({ ok: true, message: `Sent to ${data?.sent ?? 0} users · ${data?.bills_in_digest ?? 0} bills · ${data?.failed ?? 0} failed.` })
          } catch (err: any) {
            setResult({ ok: false, message: err.message })
          } finally {
            setRunning(false)
          }
        }}
      >
        {running ? 'Sending…' : 'Send Digest Now'}
      </Button>
    </div>
  )
}

function FetchDetailsSection() {
  const { progress, running, start, stop } = useStreamProgress()

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Fetch Full Text & Sponsors</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          For bills imported via bulk export, fetches full text (PDF) and sponsor info from Legistar.
          Only processes bills missing full text. Slow — uses Playwright per bill.
        </p>
      </div>
      <ProgressBar progress={progress} running={running} onStop={stop} />
      <Button
        variant="outline"
        disabled={running}
        onClick={() => start('/api/legislation/stream/fetch-details-all')}
      >
        {running ? 'Fetching…' : 'Fetch Full Text for All Bills'}
      </Button>
    </div>
  )
}

function CityContextSection() {
  const { progress, running, start, stop } = useStreamProgress()

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Philadelphia Context</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Backfill tag-matched city statistics (housing, budget, health, etc.) for all analyzed bills.
          Shown on bill detail pages and used to enrich AI perspective prompts.
        </p>
      </div>
      <ProgressBar progress={progress} running={running} onStop={stop} />
      <Button
        variant="outline"
        disabled={running}
        onClick={() => start('/api/legislation/stream/backfill-city-context')}
      >
        {running ? 'Backfilling…' : 'Backfill City Context'}
      </Button>
    </div>
  )
}

function FetchNewsSection() {
  const { progress, running, start, stop } = useStreamProgress()

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Fetch News</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Search Google News for articles related to each bill and store them.
          Runs for all local bills. Safe to re-run — overwrites previous results.
        </p>
      </div>
      <ProgressBar progress={progress} running={running} onStop={stop} />
      <Button
        variant="outline"
        disabled={running}
        onClick={() => start('/api/legislation/stream/fetch-news-all')}
      >
        {running ? 'Fetching…' : 'Fetch News for All Bills'}
      </Button>
    </div>
  )
}

function PlainTitlesSection() {
  const { progress, running, start, stop } = useStreamProgress()

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Plain English Titles</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Uses AI to generate a short, human-friendly name for each bill that doesn&apos;t have one yet.
          Shown prominently on the home feed above the official title.
        </p>
      </div>
      <ProgressBar progress={progress} running={running} onStop={stop} />
      <Button
        variant="outline"
        disabled={running}
        onClick={() => start('/api/legislation/stream/plain-titles')}
      >
        {running ? 'Generating…' : 'Generate Plain Titles'}
      </Button>
    </div>
  )
}

function AutoTagSection({ onDone }: { onDone?: () => void }) {
  const { progress, running, start, stop } = useStreamProgress()

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div>
        <h2 className="font-semibold">Auto-Tag Bills</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Uses AI to assign category tags (housing, transportation, budget, etc.) to all
          bills that don&apos;t have tags yet. Tags appear as filterable pills on the home feed.
        </p>
      </div>
      <ProgressBar progress={progress} running={running} onStop={stop} />
      <Button
        variant="outline"
        disabled={running}
        onClick={() => start('/api/legislation/stream/tag-all').then(() => onDone?.())}
      >
        {running ? 'Tagging…' : 'Tag Untagged Bills'}
      </Button>
    </div>
  )
}
