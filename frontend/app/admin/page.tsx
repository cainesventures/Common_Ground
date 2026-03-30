'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { isLoggedIn } from '@/lib/auth'


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

  // Fetch news for all
  const [newsRunning, setNewsRunning] = useState(false)
  const [newsResult, setNewsResult] = useState<Result | null>(null)

  // Auto-tag
  const [tagRunning, setTagRunning] = useState(false)
  const [tagResult, setTagResult] = useState<Result | null>(null)

  // Plain titles
  const [plainTitleRunning, setPlainTitleRunning] = useState(false)
  const [plainTitleResult, setPlainTitleResult] = useState<Result | null>(null)

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
      <div className="border rounded-lg p-4 space-y-3">
        <div>
          <h2 className="font-semibold">Fetch News</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Search Google News for articles related to each bill and store them.
            Runs for all local bills. Safe to re-run — overwrites previous results.
          </p>
        </div>
        {newsResult && (
          <p className={`text-sm ${newsResult.ok ? 'text-green-600' : 'text-destructive'}`}>
            {newsResult.message}
          </p>
        )}
        <Button
          variant="outline"
          disabled={newsRunning}
          onClick={async () => {
            setNewsRunning(true)
            setNewsResult(null)
            try {
              const data = await api.fetchNewsAll()
              setNewsResult({ ok: true, message: `Fetched ${data?.total_articles ?? 0} articles across ${data?.bills_processed ?? 0} bills.` })
            } catch (err: any) {
              setNewsResult({ ok: false, message: err.message })
            } finally {
              setNewsRunning(false)
            }
          }}
        >
          {newsRunning ? 'Fetching…' : 'Fetch News for All Bills'}
        </Button>
      </div>

      {/* ── Plain English Titles ────────────────────────────────── */}
      <div className="border rounded-lg p-4 space-y-3">
        <div>
          <h2 className="font-semibold">Plain English Titles</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Uses Ollama to generate a short, human-friendly name for each bill that doesn&apos;t have one yet.
            Shown prominently on the home feed above the official title.
          </p>
        </div>
        {plainTitleResult && (
          <p className={`text-sm ${plainTitleResult.ok ? 'text-green-600' : 'text-destructive'}`}>
            {plainTitleResult.message}
          </p>
        )}
        <Button
          variant="outline"
          disabled={plainTitleRunning}
          onClick={async () => {
            setPlainTitleRunning(true)
            setPlainTitleResult(null)
            try {
              const data = await api.generatePlainTitles()
              setPlainTitleResult({ ok: true, message: `Generated plain titles for ${data?.generated ?? 0} of ${data?.total ?? 0} bills.` })
            } catch (err: any) {
              setPlainTitleResult({ ok: false, message: err.message })
            } finally {
              setPlainTitleRunning(false)
            }
          }}
        >
          {plainTitleRunning ? 'Generating…' : 'Generate Plain Titles'}
        </Button>
      </div>

      {/* ── Auto-Tag Bills ──────────────────────────────────────── */}
      <div className="border rounded-lg p-4 space-y-3">
        <div>
          <h2 className="font-semibold">Auto-Tag Bills</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Uses Ollama to assign category tags (housing, transportation, budget, etc.) to all
            bills that don&apos;t have tags yet. Tags appear as filterable pills on the home feed.
          </p>
        </div>
        {tagResult && (
          <p className={`text-sm ${tagResult.ok ? 'text-green-600' : 'text-destructive'}`}>
            {tagResult.message}
          </p>
        )}
        <Button
          variant="outline"
          disabled={tagRunning}
          onClick={async () => {
            setTagRunning(true)
            setTagResult(null)
            try {
              const data = await api.tagAllBills()
              setTagResult({ ok: true, message: `Tagged ${data?.tagged ?? 0} of ${data?.total ?? 0} untagged bills.` })
              loadBills()
            } catch (err: any) {
              setTagResult({ ok: false, message: err.message })
            } finally {
              setTagRunning(false)
            }
          }}
        >
          {tagRunning ? 'Tagging…' : 'Tag Untagged Bills'}
        </Button>
      </div>

      {/* ── Analyze Bills ───────────────────────────────────────── */}
      <div className="border rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Analyze Bills</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {billsTotal} bills in DB. Click Analyze to generate summary, impact score, and 3 base perspectives.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={loadBills} disabled={billsLoading}>
            {billsLoading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>

        {bills.length === 0 && !billsLoading && (
          <p className="text-sm text-muted-foreground">No bills yet. Ingest some below.</p>
        )}

        <div className="space-y-2 max-h-96 overflow-y-auto">
          {bills.map((bill) => {
            const result = analyzeResults[bill.id]
            const isAnalyzing = analyzingId === bill.id
            return (
              <div key={bill.id} className="flex items-start gap-3 py-2 border-b last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{bill.bill_number}</p>
                  <p className="text-xs text-muted-foreground truncate">{bill.title}</p>
                  {result && (
                    <p className={`text-xs mt-1 ${result.ok ? 'text-green-600' : 'text-destructive'}`}>
                      {result.message}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    bill.analyzed_at
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}>
                    {bill.analyzed_at ? 'Analyzed' : 'Pending'}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => fetchNews(bill)}
                    disabled={fetchingNewsId === bill.id || analyzingId !== null || fetchingNewsId !== null}
                  >
                    {fetchingNewsId === bill.id ? 'Fetching…' : 'News'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => analyzeBill(bill)}
                    disabled={isAnalyzing || analyzingId !== null || fetchingNewsId !== null}
                  >
                    {isAnalyzing ? 'Analyzing…' : bill.analyzed_at ? 'Re-analyze' : 'Analyze'}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

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
