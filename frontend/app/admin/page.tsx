'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { isLoggedIn } from '@/lib/auth'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]

type Tab = 'federal' | 'state' | 'local'

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
}

export default function AdminPage() {
  const router = useRouter()
  const [authorized, setAuthorized] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('federal')

  // Federal form
  const [congress, setCongress] = useState('118')
  const [federalLimit, setFederalLimit] = useState('1')
  const [federalRunning, setFederalRunning] = useState(false)
  const [federalResult, setFederalResult] = useState<Result | null>(null)

  // State form
  const [stateVal, setStateVal] = useState('PA')
  const [stateLimit, setStateLimit] = useState('1')
  const [stateRunning, setStateRunning] = useState(false)
  const [stateResult, setStateResult] = useState<Result | null>(null)

  // Local form
  const [city, setCity] = useState('philadelphia')
  const [localLimit, setLocalLimit] = useState('5')
  const [localBulk, setLocalBulk] = useState(false)
  const [localRunning, setLocalRunning] = useState(false)
  const [localResult, setLocalResult] = useState<Result | null>(null)

  // Analyze queue
  const [bills, setBills] = useState<Bill[]>([])
  const [billsLoading, setBillsLoading] = useState(false)
  const [billsTotal, setBillsTotal] = useState(0)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const [analyzeResults, setAnalyzeResults] = useState<Record<string, Result>>({})

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
      const data = await api.listLegislation(50, 0)
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

  const ingestFederal = async (e: React.FormEvent) => {
    e.preventDefault()
    setFederalRunning(true)
    setFederalResult(null)
    try {
      const data = await api.ingestFederal(Number(congress), Number(federalLimit))
      setFederalResult({ ok: true, message: `Ingested ${data?.bills_ingested ?? 0} federal bills from Congress ${congress}.` })
      loadBills()
    } catch (err: any) {
      setFederalResult({ ok: false, message: err.message })
    } finally {
      setFederalRunning(false)
    }
  }

  const ingestState = async (e: React.FormEvent) => {
    e.preventDefault()
    setStateRunning(true)
    setStateResult(null)
    try {
      const data = await api.ingestState(stateVal, Number(stateLimit))
      setStateResult({ ok: true, message: `Ingested ${data?.bills_ingested ?? 0} bills from ${stateVal}.` })
      loadBills()
    } catch (err: any) {
      setStateResult({ ok: false, message: err.message })
    } finally {
      setStateRunning(false)
    }
  }

  const ingestLocal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!city.trim()) return
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

  if (loading) return <div className="h-64 bg-muted animate-pulse rounded-lg" />
  if (!authorized) return null

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
    }`

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-muted-foreground mt-1">
          Ingest bills from external sources and trigger AI analysis.
        </p>
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
                  <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {bill.level}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => analyzeBill(bill)}
                    disabled={isAnalyzing || analyzingId !== null}
                  >
                    {isAnalyzing ? 'Analyzing…' : 'Analyze'}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Legislation Ingestion ────────────────────────────────── */}
      <div>
        <h2 className="font-semibold mb-1">Legislation Ingestion</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Pull bills from external sources into the database.
        </p>

        {/* Tabs */}
        <div className="flex border-b mb-4">
          <button className={tabClass('federal')} onClick={() => setTab('federal')}>Federal</button>
          <button className={tabClass('state')} onClick={() => setTab('state')}>State</button>
          <button className={tabClass('local')} onClick={() => setTab('local')}>Local</button>
        </div>

        {/* Federal */}
        {tab === 'federal' && (
          <form onSubmit={ingestFederal} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Fetches bills from <strong>Congress.gov</strong>. Requires <code className="text-xs bg-muted px-1 rounded">CONGRESS_API_KEY</code>.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Congress number</label>
                <select
                  value={congress}
                  onChange={(e) => setCongress(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {[119, 118, 117, 116].map((n) => (
                    <option key={n} value={String(n)}>{n}th Congress</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Limit</label>
                <input
                  type="number" min={1} max={100}
                  value={federalLimit}
                  onChange={(e) => setFederalLimit(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
            {federalResult && (
              <p className={`text-sm ${federalResult.ok ? 'text-green-600' : 'text-destructive'}`}>
                {federalResult.message}
              </p>
            )}
            <Button type="submit" disabled={federalRunning}>
              {federalRunning ? 'Ingesting…' : 'Ingest Federal Bills'}
            </Button>
          </form>
        )}

        {/* State */}
        {tab === 'state' && (
          <form onSubmit={ingestState} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Fetches bills from <strong>OpenStates</strong>. Requires <code className="text-xs bg-muted px-1 rounded">OPENSTATES_API_KEY</code>.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">State</label>
                <select
                  value={stateVal}
                  onChange={(e) => setStateVal(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {US_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Limit</label>
                <input
                  type="number" min={1} max={100}
                  value={stateLimit}
                  onChange={(e) => setStateLimit(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
            {stateResult && (
              <p className={`text-sm ${stateResult.ok ? 'text-green-600' : 'text-destructive'}`}>
                {stateResult.message}
              </p>
            )}
            <Button type="submit" disabled={stateRunning}>
              {stateRunning ? 'Ingesting…' : `Ingest ${stateVal} Bills`}
            </Button>
          </form>
        )}

        {/* Local */}
        {tab === 'local' && (
          <form onSubmit={ingestLocal} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Fetches items from <strong>Legistar</strong>. Use the city slug (e.g. <code className="text-xs bg-muted px-1 rounded">philadelphia</code>, <code className="text-xs bg-muted px-1 rounded">nyc</code>).
              For Philadelphia, enable <strong>Bulk Export</strong> to import all ~8,500 bills at once via Excel export.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">City slug</label>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. philadelphia"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Limit <span className="text-muted-foreground">(ignored for bulk)</span></label>
                <input
                  type="number" min={1} max={250}
                  value={localLimit}
                  onChange={(e) => setLocalLimit(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={localBulk}
                onChange={(e) => setLocalBulk(e.target.checked)}
                className="rounded border-input"
              />
              <span>Bulk export (Philadelphia only — exports all bills via Excel, ignores limit)</span>
            </label>
            {localResult && (
              <p className={`text-sm ${localResult.ok ? 'text-green-600' : 'text-destructive'}`}>
                {localResult.message}
              </p>
            )}
            <Button type="submit" disabled={localRunning || !city.trim()}>
              {localRunning ? 'Ingesting…' : 'Ingest Local Bills'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
