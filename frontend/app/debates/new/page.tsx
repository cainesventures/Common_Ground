'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { UpgradeBanner } from '@/components/UpgradeBanner'
import { api } from '@/lib/api'
import { isLoggedIn } from '@/lib/auth'
import { Suspense } from 'react'

interface Legislation {
  id: string
  bill_number: string
  title: string
  level?: string
}

interface Agent {
  id: string
  name: string
  description: string
  persona: string
  agent_type: string
  expertise_areas?: string[]
}

const PRESET_AGENTS = [
  'progressive', 'conservative', 'nonpartisan', 'fiscal', 'healthcare',
  'environmental', 'humanist', 'libertarian', 'technocrat', 'populist',
]

function NewDebateForm() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Pre-fill legislation if passed via query param
  const prefilledLegislationId = searchParams.get('legislation_id') ?? ''

  const [legislationQuery, setLegislationQuery] = useState('')
  const [legislationResults, setLegislationResults] = useState<Legislation[]>([])
  const [selectedLegislation, setSelectedLegislation] = useState<Legislation | null>(null)
  const [legSearching, setLegSearching] = useState(false)

  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const [agentsLoading, setAgentsLoading] = useState(true)

  const [topic, setTopic] = useState('')
  const [maxTurns, setMaxTurns] = useState(5)
  const [researchEnabled, setResearchEnabled] = useState(true)
  const [isPublic, setIsPublic] = useState(true)

  const [currentUser, setCurrentUser] = useState<any>(null)
  const [userLoading, setUserLoading] = useState(true)
  const [convictionLevels, setConvictionLevels] = useState<Record<string, number>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Load current user + agents on mount
  useEffect(() => {
    api.getMe()
      .then((data) => setCurrentUser(data?.user ?? null))
      .catch(() => {})
      .finally(() => setUserLoading(false))

    api.getAgents(50, 0)
      .then((data) => setAgents(data?.agents ?? []))
      .catch(() => {})
      .finally(() => setAgentsLoading(false))
  }, [])

  // Pre-fill legislation by ID if passed
  useEffect(() => {
    if (!prefilledLegislationId) return
    api.getLegislation(prefilledLegislationId)
      .then((data) => data?.legislation && setSelectedLegislation(data.legislation))
      .catch(() => {})
  }, [prefilledLegislationId])

  const searchLegislation = async () => {
    if (!legislationQuery.trim()) return
    setLegSearching(true)
    try {
      const data = await api.searchLegislation(legislationQuery.trim(), 10, 0)
      setLegislationResults(data?.results ?? [])
    } catch {
      setLegislationResults([])
    } finally {
      setLegSearching(false)
    }
  }

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((a) => a !== id)
        setConvictionLevels((c) => { const n = { ...c }; delete n[id]; return n })
        return next
      }
      setConvictionLevels((c) => ({ ...c, [id]: 3 }))
      return [...prev, id]
    })
  }

  const addPreset = async (preset: string) => {
    try {
      const data = await api.createPresetAgent(preset)
      if (data?.agent) {
        setAgents((prev) => {
          if (prev.find((a) => a.id === data.agent.id)) return prev
          return [...prev, data.agent]
        })
        setSelectedAgentIds((prev) => [...prev, data.agent.id])
      }
    } catch (e: any) {
      alert(e.message)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!selectedLegislation) { setError('Please select a bill.'); return }
    if (!topic.trim()) { setError('Please enter a debate topic.'); return }
    if (selectedAgentIds.length < 2) { setError('Select at least 2 agents.'); return }

    setSubmitting(true)
    try {
      const participantSettings = Object.fromEntries(
        Object.entries(convictionLevels).map(([id, lvl]) => [id, { conviction: lvl }])
      )
      const data = await api.createDebate({
        legislation_id: selectedLegislation.id,
        topic: topic.trim(),
        agent_ids: selectedAgentIds,
        max_turns: maxTurns,
        research_enabled: researchEnabled,
        is_public: isPublic,
        participant_settings: Object.keys(participantSettings).length ? participantSettings : undefined,
      })
      if (data?.debate?.id) {
        router.push(`/debates/${data.debate.id}`)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (userLoading) return <div className="h-64 bg-muted animate-pulse rounded-lg" />

  const tier = currentUser?.subscription_tier ?? 'free'
  if (tier === 'free') {
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">New Debate</h1>
        <UpgradeBanner requiredTier="paid" featureName="Creating debates" />
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">New Debate</h1>
        <p className="text-muted-foreground mt-1">Choose a bill, pick your debators, and launch an AI debate.</p>
      </div>

      {/* ── Legislation selection ── */}
      <section className="space-y-3">
        <h2 className="font-semibold">1. Select a Bill</h2>
        {selectedLegislation ? (
          <div className="flex items-start justify-between border rounded-lg p-3 bg-muted/40">
            <div>
              <p className="text-sm font-medium">{selectedLegislation.title}</p>
              {selectedLegislation.bill_number && (
                <p className="text-xs text-muted-foreground font-mono mt-0.5">{selectedLegislation.bill_number}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => { setSelectedLegislation(null); setLegislationResults([]) }}
              className="text-xs text-muted-foreground hover:text-foreground ml-3 shrink-0"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={legislationQuery}
                onChange={(e) => setLegislationQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchLegislation())}
                placeholder="Search bills…"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="button" variant="outline" size="sm" onClick={searchLegislation} disabled={legSearching}>
                {legSearching ? 'Searching…' : 'Search'}
              </Button>
            </div>
            {legislationResults.length > 0 && (
              <div className="border rounded-lg divide-y overflow-hidden">
                {legislationResults.map((bill) => (
                  <button
                    key={bill.id}
                    type="button"
                    onClick={() => { setSelectedLegislation(bill); setLegislationResults([]) }}
                    className="w-full text-left px-3 py-2 hover:bg-muted/40 transition-colors"
                  >
                    <p className="text-sm font-medium line-clamp-1">{bill.title}</p>
                    {bill.bill_number && (
                      <p className="text-xs text-muted-foreground font-mono">{bill.bill_number}</p>
                    )}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Don&apos;t see any bills?{' '}
              <Link href="/admin" className="underline hover:no-underline">Ingest legislation first.</Link>
            </p>
          </div>
        )}
      </section>

      {/* ── Topic ── */}
      <section className="space-y-3">
        <h2 className="font-semibold">2. Debate Topic</h2>
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. Should this bill be passed as written?"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </section>

      {/* ── Agents ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">3. Select Debators</h2>
          <span className="text-xs text-muted-foreground">{selectedAgentIds.length} selected (min 2)</span>
        </div>

        {agentsLoading ? (
          <div className="h-32 bg-muted animate-pulse rounded-lg" />
        ) : agents.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No agents yet. Add a preset to get started:</p>
            <div className="flex flex-wrap gap-2">
              {PRESET_AGENTS.map((p) => (
                <Button key={p} type="button" variant="outline" size="sm" onClick={() => addPreset(p)}>
                  + {p.charAt(0).toUpperCase() + p.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {agents.map((agent) => {
                const selected = selectedAgentIds.includes(agent.id)
                return (
                  <div
                    key={agent.id}
                    className={`rounded-lg border transition-colors ${
                      selected ? 'border-primary bg-primary/5' : 'border-input'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleAgent(agent.id)}
                      className="w-full text-left p-3"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{agent.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                          agent.agent_type === 'claude' ? 'bg-orange-100 text-orange-700' :
                          agent.agent_type === 'local' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>{agent.agent_type}</span>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{agent.persona || agent.description}</p>
                    </button>

                    {/* Conviction slider — only for paid users on selected agents */}
                    {selected && tier !== 'free' && (
                      <div className="px-3 pb-3 space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-xs text-muted-foreground">Conviction</label>
                          <span className="text-xs font-medium">
                            {['', 'Balanced', 'Moderate', 'Standard', 'Strong', 'Passionate'][convictionLevels[agent.id] ?? 3]}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={5}
                          value={convictionLevels[agent.id] ?? 3}
                          onChange={(e) => setConvictionLevels((c) => ({ ...c, [agent.id]: Number(e.target.value) }))}
                          className="w-full h-1.5 accent-primary"
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>Balanced</span><span>Passionate</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">Add a preset agent:</p>
              <div className="flex flex-wrap gap-2">
                {PRESET_AGENTS.map((p) => (
                  <Button key={p} type="button" variant="outline" size="sm" onClick={() => addPreset(p)}>
                    + {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Settings ── */}
      <section className="space-y-3">
        <h2 className="font-semibold">4. Settings</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Max turns</label>
            <select
              value={maxTurns}
              onChange={(e) => setMaxTurns(Number(e.target.value))}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {[3, 5, 8, 10, 15, 20].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              id="research"
              type="checkbox"
              checked={researchEnabled}
              onChange={(e) => setResearchEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <label htmlFor="research" className="text-sm">Research phase</label>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              id="public"
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <label htmlFor="public" className="text-sm">Public debate</label>
          </div>
        </div>
      </section>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? 'Creating debate…' : 'Create & Run Debate'}
      </Button>
    </form>
  )
}

export default function NewDebatePage() {
  const router = useRouter()

  useEffect(() => {
    if (!isLoggedIn()) router.replace('/')
  }, [router])

  return (
    <Suspense fallback={<div className="h-64 bg-muted animate-pulse rounded-lg" />}>
      <NewDebateForm />
    </Suspense>
  )
}
