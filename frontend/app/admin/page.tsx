'use client'

import { useEffect, useState } from 'react'
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
  const [state, setState] = useState('PA')
  const [stateLimit, setStateLimit] = useState('1')
  const [stateRunning, setStateRunning] = useState(false)
  const [stateResult, setStateResult] = useState<Result | null>(null)

  // Local form
  const [city, setCity] = useState('philadelphia')
  const [localLimit, setLocalLimit] = useState('1')
  const [localRunning, setLocalRunning] = useState(false)
  const [localResult, setLocalResult] = useState<Result | null>(null)

  // Auto-debate
  const [autoRunning, setAutoRunning] = useState(false)
  const [autoResult, setAutoResult] = useState<Result | null>(null)

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

  const runAutoDebates = async () => {
    setAutoRunning(true)
    setAutoResult(null)
    try {
      const data = await api.triggerAutoDebates(1, 48)
      setAutoResult({ ok: true, message: `Queued ${data?.message ?? 'auto-debate task'} (task: ${data?.task_id ?? '—'})` })
    } catch (err: any) {
      setAutoResult({ ok: false, message: err.message })
    } finally {
      setAutoRunning(false)
    }
  }

  const ingestFederal = async (e: React.FormEvent) => {
    e.preventDefault()
    setFederalRunning(true)
    setFederalResult(null)
    try {
      const data = await api.ingestFederal(Number(congress), Number(federalLimit))
      setFederalResult({ ok: true, message: `Ingested ${data?.bills_ingested ?? 0} federal bills from Congress ${congress}.` })
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
      const data = await api.ingestState(state, Number(stateLimit))
      setStateResult({ ok: true, message: `Ingested ${data?.bills_ingested ?? 0} bills from ${state}.` })
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
      const data = await api.ingestLocal(city.trim(), Number(localLimit))
      setLocalResult({ ok: true, message: `Ingested ${data?.bills_ingested ?? 0} items from "${city}".` })
    } catch (err: any) {
      setLocalResult({ ok: false, message: err.message })
    } finally {
      setLocalRunning(false)
    }
  }

  if (loading) return <div className="h-64 bg-muted animate-pulse rounded-lg" />
  if (!authorized) return null

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
    }`

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-muted-foreground mt-1">
          Pull bills from external sources and trigger AI debate generation.
        </p>
      </div>

      {/* Auto-debate */}
      <div className="border rounded-lg p-4 space-y-3">
        <div>
          <h2 className="font-semibold">Auto-Generate Debates</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Finds legislation ingested in the last 48 hours with no debate yet and queues debates for each. Runs automatically every hour via the background worker.
          </p>
        </div>
        {autoResult && (
          <p className={`text-sm ${autoResult.ok ? 'text-green-600' : 'text-destructive'}`}>
            {autoResult.message}
          </p>
        )}
        <Button type="button" variant="outline" onClick={runAutoDebates} disabled={autoRunning}>
          {autoRunning ? 'Queueing…' : 'Run Now'}
        </Button>
      </div>

      <div>
        <h2 className="font-semibold mb-3">Legislation Ingestion</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Pull bills from external sources into the database. Requires API keys configured on the server.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        <button className={tabClass('federal')} onClick={() => setTab('federal')}>Federal</button>
        <button className={tabClass('state')} onClick={() => setTab('state')}>State</button>
        <button className={tabClass('local')} onClick={() => setTab('local')}>Local</button>
      </div>

      {/* Federal */}
      {tab === 'federal' && (
        <form onSubmit={ingestFederal} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Fetches bills from <strong>Congress.gov</strong>. Requires <code className="text-xs bg-muted px-1 rounded">CONGRESS_API_KEY</code> on the server.
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
                type="number"
                min={1}
                max={100}
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
            Fetches bills from <strong>OpenStates</strong>. Requires <code className="text-xs bg-muted px-1 rounded">OPENSTATES_API_KEY</code> on the server.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">State</label>
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
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
                type="number"
                min={1}
                max={100}
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
            {stateRunning ? 'Ingesting…' : `Ingest ${state} Bills`}
          </Button>
        </form>
      )}

      {/* Local */}
      {tab === 'local' && (
        <form onSubmit={ingestLocal} className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Fetches items from <strong>Legistar</strong> (municipal councils). Use the city&apos;s Legistar slug (e.g. <code className="text-xs bg-muted px-1 rounded">nyc</code>, <code className="text-xs bg-muted px-1 rounded">Seattle</code>, <code className="text-xs bg-muted px-1 rounded">Philadelphia</code>).
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">City slug</label>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. nyc"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Limit</label>
              <input
                type="number"
                min={1}
                max={100}
                value={localLimit}
                onChange={(e) => setLocalLimit(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
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
  )
}
