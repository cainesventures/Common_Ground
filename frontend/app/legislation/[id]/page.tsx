'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { PerspectivesPanel } from '@/components/PerspectivesPanel'
import { api } from '@/lib/api'
import { isLoggedIn } from '@/lib/auth'

const LEVEL_LABELS: Record<string, string> = {
  federal: 'Federal',
  state: 'State',
  local: 'Local',
}

const STATUS_COLORS: Record<string, string> = {
  introduced:       'bg-blue-100 text-blue-800',
  in_committee:     'bg-yellow-100 text-yellow-800',
  signed_into_law:  'bg-green-100 text-green-800',
  failed:           'bg-red-100 text-red-800',
  vetoed:           'bg-orange-100 text-orange-800',
}

const IMPACT_COLORS: Record<string, string> = {
  high:   'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low:    'bg-green-100 text-green-800',
}

function SponsorLinks({ sponsor, members }: { sponsor: string; members: any[] }) {
  if (!sponsor) return null
  // Split multiple sponsors by comma
  const parts = sponsor.split(',').map((s) => s.trim()).filter(Boolean)
  return (
    <p className="text-sm text-muted-foreground mt-1">
      Sponsor:{' '}
      {parts.map((part, i) => {
        // Match by last name
        const lastName = part.split(' ').pop()?.toLowerCase() ?? ''
        const match = members.find((m) => m.name.toLowerCase().includes(lastName))
        return (
          <span key={i}>
            {i > 0 && ', '}
            {match ? (
              <Link href={`/councilmembers/${match.id}`} className="hover:underline text-foreground">
                {part}
              </Link>
            ) : (
              part
            )}
          </span>
        )
      })}
    </p>
  )
}

export default function LegislationPage() {
  const { id } = useParams<{ id: string }>()
  const [leg, setLeg] = useState<any>(null)
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tracked, setTracked] = useState(false)
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({ support: 0, neutral: 0, oppose: 0 })
  const [isAdmin, setIsAdmin] = useState(false)
  const loggedIn = isLoggedIn()

  const loadData = useCallback(() => {
    Promise.all([
      api.getLegislation(id),
      api.getCouncilmembers().catch(() => ({ members: [] })),
      loggedIn ? api.getTrackedBillIds().catch(() => ({ ids: [] })) : Promise.resolve({ ids: [] }),
      loggedIn ? api.getMe().catch(() => null) : Promise.resolve(null),
    ])
      .then(([legData, cmData, trackData, meData]) => {
        setLeg(legData?.data ?? null)
        setMembers(cmData?.members ?? [])
        setTracked((trackData?.ids ?? []).includes(id))
        setIsAdmin(meData?.user?.subscription_tier === 'dev')
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id, loggedIn])

  useEffect(() => { loadData() }, [loadData])

  const handleToggleTrack = useCallback(async () => {
    try {
      const data = await api.toggleTrackBill(id)
      setTracked(data?.tracked ?? false)
    } catch { /* ignore */ }
  }, [id])

  if (loading) return <div className="h-32 bg-muted animate-pulse rounded-lg" />

  if (!leg) return (
    <div className="text-center py-16 text-muted-foreground">
      Legislation not found.
    </div>
  )

  const statusColor = STATUS_COLORS[leg.status] ?? 'bg-gray-100 text-gray-800'
  const impactColor = leg.impact_level ? IMPACT_COLORS[leg.impact_level] : null

  let tags: string[] = []
  try { tags = leg.tags ? JSON.parse(leg.tags) : [] } catch { tags = [] }

  let newsLinks: { title: string; url: string; source: string; published: string }[] = []
  try { newsLinks = leg.news_links ? JSON.parse(leg.news_links) : [] } catch { newsLinks = [] }

  type ContextSection = { label: string; stats: Record<string, string>; source: string }
  let cityContext: ContextSection[] = []
  try { cityContext = leg.supplementary_data ? JSON.parse(leg.supplementary_data) : [] } catch { cityContext = [] }

  return (
    <div className="max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <Badge variant="outline" className="text-xs">
            {LEVEL_LABELS[leg.level] ?? leg.level}
          </Badge>
          <Badge variant="outline" className={`text-xs ${statusColor}`}>
            {leg.status?.replace(/_/g, ' ')}
          </Badge>
          {impactColor && (
            <Badge variant="outline" className={`text-xs ${impactColor}`}>
              {leg.impact_level} impact{leg.impact_score ? ` · ${leg.impact_score}/10` : ''}
            </Badge>
          )}
          {leg.bill_type && (
            <Badge variant="outline" className="text-xs capitalize">
              {leg.bill_type}
            </Badge>
          )}
          <span className="text-sm text-muted-foreground">{leg.bill_number}</span>
        </div>

        <div className="flex items-start gap-3">
          <div className="flex-1">
            {leg.plain_title
              ? <>
                  <h1 className="text-2xl font-bold leading-snug">{leg.plain_title}</h1>
                  <p className="text-xs text-muted-foreground/70 mt-1 leading-snug">
                    <span className="uppercase tracking-wide font-medium text-[10px] mr-1">Official:</span>
                    {leg.title}
                  </p>
                </>
              : <h1 className="text-2xl font-bold leading-snug">{leg.title}</h1>
            }
          </div>
          {loggedIn && (
            <button
              onClick={handleToggleTrack}
              className={`mt-1 shrink-0 p-1.5 rounded-lg border transition-colors ${
                tracked ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-muted-foreground hover:text-primary hover:border-muted'
              }`}
              title={tracked ? 'Unsave bill' : 'Save bill'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-5 h-5" fill={tracked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
            </button>
          )}
        </div>

        {leg.sponsor && <SponsorLinks sponsor={leg.sponsor} members={members} />}

        {leg.introduced_date && (
          <p className="text-sm text-muted-foreground">
            Introduced: {new Date(leg.introduced_date).toLocaleDateString()}
          </p>
        )}

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map((tag: string) => (
              <span key={tag} className="text-xs bg-muted px-2 py-0.5 rounded-full">{tag}</span>
            ))}
          </div>
        )}
      </div>

      {/* Summary */}
      {leg.summary && (
        <div className="border rounded-lg p-5 space-y-1">
          <h2 className="text-sm font-semibold">Plain-Language Summary</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{leg.summary}</p>
        </div>
      )}

      {/* Philadelphia Context */}
      {cityContext.length > 0 && (
        <div className="border rounded-lg p-5 space-y-4">
          <h2 className="text-sm font-semibold">Philadelphia Context</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cityContext.map((section) => (
              <div key={section.label} className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {section.label}
                </p>
                <ul className="space-y-0.5">
                  {Object.entries(section.stats).map(([k, v]) => (
                    <li key={k} className="text-xs text-muted-foreground leading-snug">
                      <span className="text-foreground/80">{k}:</span> {v}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-muted-foreground/50 pt-0.5">{section.source}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Description / full text */}
      {leg.description && !leg.summary && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          <span className="uppercase tracking-wide font-medium text-[10px] text-muted-foreground/70 mr-1">Description:</span>
          {leg.description}
        </p>
      )}

      {leg.full_text && leg.full_text !== leg.description && (
        <details>
          <summary className="text-sm font-medium cursor-pointer hover:text-foreground text-muted-foreground select-none">
            Bill Text ▾
          </summary>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed whitespace-pre-wrap border-l-2 border-muted pl-3">
            {leg.full_text}
          </p>
        </details>
      )}

      {leg.external_url && (
        <a
          href={leg.external_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline"
        >
          View source →
        </a>
      )}

      {/* Vote */}
      <VotePanel billId={id} onCountsChange={setVoteCounts} />

      {/* Combined sentiment */}
      <CombinedSentimentBar billId={id} voteCounts={voteCounts} />

      {/* Perspectives */}
      <div>
        <div className="mb-4">
          <h2 className="text-lg font-semibold">AI Perspectives</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Simulated viewpoints generated by AI — not real people</p>
        </div>
        <PerspectivesPanel billId={id} analyzed={!!leg.analyzed_at} isAdmin={isAdmin} />
      </div>

      {/* Admin floating panel */}
      {isAdmin && <AdminFloatingPanel billId={id} leg={leg} onRefresh={loadData} />}

      {/* In the News */}
      {newsLinks.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">In the News</h2>
          <div className="space-y-2">
            {newsLinks.map((article, i) => (
              <a
                key={i}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 border rounded-lg p-3 hover:border-primary/60 hover:shadow-sm transition-all group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug group-hover:text-primary transition-colors line-clamp-2">
                    {article.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {article.source && (
                      <span className="text-xs text-muted-foreground">{article.source}</span>
                    )}
                    {article.published && (
                      <span className="text-xs text-muted-foreground">
                        · {new Date(article.published).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-muted-foreground text-sm shrink-0 mt-0.5">→</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Admin Floating Panel ──────────────────────────────────────────────────────

type AdminAction = {
  label: string
  runningLabel: string
  fn: () => Promise<any>
  disabled?: boolean
}

function AdminFloatingPanel({ billId, leg, onRefresh }: { billId: string; leg: any; onRefresh: () => void }) {
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})

  const run = async (key: string, fn: () => Promise<any>) => {
    setRunning(key)
    setResults((r) => ({ ...r, [key]: undefined as any }))
    try {
      const data = await fn()
      let msg = 'Done'
      if (key === 'details') msg = `Full text: ${data?.has_full_text ? 'fetched' : 'not found'} · Sponsor: ${data?.has_sponsor ? 'fetched' : 'not found'}`
      if (key === 'analyze') msg = `Impact: ${data?.impact_level ?? '?'} (${data?.impact_score ?? '?'}/10) · ${data?.bill_type ?? '?'}`
      if (key === 'perspectives') msg = `Generated ${data?.perspectives_generated?.length ?? 0} perspectives`
      if (key === 'news') msg = `Found ${data?.articles_found ?? 0} articles`
      setResults((r) => ({ ...r, [key]: { ok: true, message: msg } }))
      onRefresh()
    } catch (err: any) {
      setResults((r) => ({ ...r, [key]: { ok: false, message: err?.message ?? 'Failed' } }))
    } finally {
      setRunning(null)
    }
  }

  const isBusy = running !== null

  const actions: { key: string; label: string; runningLabel: string; fn: () => Promise<any>; warn?: boolean }[] = [
    {
      key: 'details',
      label: 'Fetch Full Text & Sponsors',
      runningLabel: 'Fetching…',
      fn: () => api.fetchBillDetails(billId),
    },
    {
      key: 'analyze',
      label: leg.analyzed_at ? 'Re-analyze' : 'Analyze Bill',
      runningLabel: 'Analyzing…',
      fn: () => api.analyzeLegislation(billId),
    },
    {
      key: 'perspectives',
      label: 'Generate All Perspectives',
      runningLabel: 'Generating…',
      fn: () => api.generateAllPerspectives(billId),
    },
    {
      key: 'news',
      label: 'Fetch News Articles',
      runningLabel: 'Fetching…',
      fn: () => api.fetchBillNews(billId),
    },
  ]

  // Data status indicators
  const checks = [
    { label: 'Full text',    ok: !!leg.full_text },
    { label: 'Sponsor',      ok: !!leg.sponsor },
    { label: 'Analyzed',     ok: !!leg.analyzed_at },
    { label: 'Summary',      ok: !!leg.summary },
    { label: 'Tags',         ok: !!leg.tags && leg.tags !== '[]' },
    { label: 'Plain title',  ok: !!leg.plain_title },
    { label: 'News',         ok: !!leg.news_links && leg.news_links !== '[]' },
    { label: 'City context', ok: !!leg.supplementary_data },
  ]

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="w-72 rounded-xl border bg-white shadow-xl overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
            <span className="text-sm font-semibold">Admin Panel</span>
            <span className="text-xs text-muted-foreground truncate ml-2">{leg.bill_number}</span>
          </div>

          {/* Status grid */}
          <div className="px-4 py-3 border-b grid grid-cols-2 gap-x-4 gap-y-1">
            {checks.map(({ label, ok }) => (
              <div key={label} className="flex items-center gap-1.5 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className={ok ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="p-3 space-y-1.5">
            {actions.map(({ key, label, runningLabel, fn }) => {
              const result = results[key]
              return (
                <div key={key}>
                  <button
                    onClick={() => run(key, fn)}
                    disabled={isBusy}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg border font-medium transition-colors hover:bg-muted/40 disabled:opacity-50"
                  >
                    {running === key ? runningLabel : label}
                  </button>
                  {result && (
                    <p className={`text-[10px] px-1 mt-0.5 ${result.ok ? 'text-green-600' : 'text-destructive'}`}>
                      {result.message}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="h-10 w-10 rounded-full bg-gray-900 text-white shadow-lg flex items-center justify-center hover:bg-gray-700 transition-colors"
        title="Admin Panel"
      >
        {open ? (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </button>
    </div>
  )
}

// ── Combined Sentiment Bar ────────────────────────────────────────────────────

function CombinedSentimentBar({ billId, voteCounts }: { billId: string; voteCounts: Record<string, number> }) {
  const [perspCounts, setPerspCounts] = useState<Record<string, number>>({ support: 0, neutral: 0, oppose: 0 })

  useEffect(() => {
    api.getPerspectives(billId).then((perspData) => {
      const perspectives: { position: string }[] = perspData?.perspectives ?? []
      const p = { support: 0, neutral: 0, oppose: 0 } as Record<string, number>
      for (const persp of perspectives) {
        const pos = persp.position === 'mixed' ? 'neutral' : persp.position
        if (pos in p) p[pos]++
      }
      setPerspCounts(p)
    }).catch(() => {})
  }, [billId])

  const totals = {
    support: (voteCounts.support ?? 0) + perspCounts.support,
    neutral: (voteCounts.neutral ?? 0) + perspCounts.neutral,
    oppose:  (voteCounts.oppose  ?? 0) + perspCounts.oppose,
  }
  const total = totals.support + totals.neutral + totals.oppose
  if (total === 0) return null

  const pct = (n: number) => Math.round((n / total) * 100)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium">Combined Sentiment</span>
        <span className="flex gap-3">
          {totals.support > 0 && <span className="text-green-600">{pct(totals.support)}% support</span>}
          {totals.neutral > 0 && <span className="text-gray-500">{pct(totals.neutral)}% neutral</span>}
          {totals.oppose  > 0 && <span className="text-red-600">{pct(totals.oppose)}% oppose</span>}
        </span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden gap-px bg-muted">
        {totals.support > 0 && <div className="bg-green-500 transition-all" style={{ width: `${pct(totals.support)}%` }} />}
        {totals.neutral > 0 && <div className="bg-gray-400 transition-all"  style={{ width: `${pct(totals.neutral)}%` }} />}
        {totals.oppose  > 0 && <div className="bg-red-500 transition-all"   style={{ width: `${pct(totals.oppose)}%`  }} />}
      </div>
      <p className="text-[10px] text-muted-foreground/50">Citizens + AI perspectives combined · {total} signals</p>
    </div>
  )
}

// ── Vote Panel ────────────────────────────────────────────────────────────────

const VOTE_OPTIONS = [
  { value: 'support', label: 'Support', active: 'bg-green-500 text-white border-green-500', inactive: 'hover:border-green-400 hover:text-green-700' },
  { value: 'neutral', label: 'Neutral', active: 'bg-gray-500 text-white border-gray-500', inactive: 'hover:border-gray-400 hover:text-gray-700' },
  { value: 'oppose',  label: 'Oppose',  active: 'bg-red-500 text-white border-red-500',   inactive: 'hover:border-red-400 hover:text-red-700' },
] as const

function _getOrCreateVoterToken(): string {
  if (typeof window === 'undefined') return ''
  const key = 'cg_voter_token'
  let token = localStorage.getItem(key)
  if (!token) {
    token = crypto.randomUUID()
    localStorage.setItem(key, token)
  }
  return token
}

function VotePanel({ billId, onCountsChange }: { billId: string; onCountsChange?: (c: Record<string, number>) => void }) {
  const [counts, setCounts] = useState<Record<string, number>>({ support: 0, neutral: 0, oppose: 0 })
  const [myVote, setMyVote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const voterToken = typeof window !== 'undefined' ? _getOrCreateVoterToken() : ''

  const updateCounts = useCallback((c: Record<string, number>) => {
    setCounts(c)
    onCountsChange?.(c)
  }, [onCountsChange])

  useEffect(() => {
    if (!voterToken) return
    api.getVotes(billId, voterToken).then((data) => {
      if (data?.counts?.total) updateCounts(data.counts.total)
      if (data?.your_vote !== undefined) setMyVote(data.your_vote)
    }).catch(() => {})
  }, [billId, voterToken, updateCounts])

  const handleVote = async (vote: string) => {
    if (loading) return
    setLoading(true)
    try {
      const data = await api.castVote(billId, vote, voterToken)
      if (data?.counts?.total) updateCounts(data.counts.total)
      setMyVote(data?.your_vote ?? vote)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  const total = (counts.support ?? 0) + (counts.neutral ?? 0) + (counts.oppose ?? 0)

  return (
    <div className="border rounded-lg p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Community Vote</h2>
          <p className="text-xs text-muted-foreground">How real people are voting — independent of AI perspectives</p>
        </div>
        {total > 0 && (
          <span className="text-xs text-muted-foreground shrink-0 ml-4">{total} {total === 1 ? 'vote' : 'votes'}</span>
        )}
      </div>

      <div className="flex gap-2">
        {VOTE_OPTIONS.map(({ value, label, active, inactive }) => {
          const count = counts[value] ?? 0
          const isSelected = myVote === value
          return (
            <button
              key={value}
              onClick={() => handleVote(value)}
              disabled={loading}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                isSelected ? active : `border-border text-muted-foreground ${inactive}`
              } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span>{label}</span>
              {total > 0 && (
                <span className={`text-xs font-normal ${isSelected ? 'opacity-80' : 'text-muted-foreground'}`}>
                  {count > 0 ? `${Math.round((count / total) * 100)}%` : '—'}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {total > 0 && (
        <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
          {counts.support > 0 && <div className="bg-green-500" style={{ width: `${(counts.support / total) * 100}%` }} />}
          {counts.neutral > 0 && <div className="bg-gray-400"  style={{ width: `${(counts.neutral / total) * 100}%` }} />}
          {counts.oppose  > 0 && <div className="bg-red-500"   style={{ width: `${(counts.oppose  / total) * 100}%` }} />}
        </div>
      )}
    </div>
  )
}
