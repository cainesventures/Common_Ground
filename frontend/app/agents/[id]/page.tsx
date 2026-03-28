'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'

const TYPE_COLORS: Record<string, string> = {
  claude: 'bg-orange-100 text-orange-700',
  gemini: 'bg-blue-100 text-blue-700',
  local: 'bg-purple-100 text-purple-700',
  byo: 'bg-gray-100 text-gray-600',
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  active: 'bg-blue-100 text-blue-700',
  researching: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-700',
}

const RATING_LABELS: Record<string, string> = {
  overall: 'Overall',
  persuasiveness: 'Persuasive',
  logical_soundness: 'Logic',
  factual_accuracy: 'Accuracy',
  relevance: 'Relevance',
}

function RatingBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round((value / 10) * 100)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value.toFixed(1)}<span className="text-muted-foreground">/10</span></span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

const PAGE_SIZE = 10

export default function AgentProfilePage() {
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const backHref = searchParams.get('from') ?? '/agents'
  const backLabel = backHref.startsWith('/debates/') ? 'Debate' : 'Debators'
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const [debates, setDebates] = useState<any[]>([])
  const [debatesTotal, setDebatesTotal] = useState(0)
  const [debatesOffset, setDebatesOffset] = useState(0)
  const [debatesLoading, setDebatesLoading] = useState(false)

  useEffect(() => {
    api.getAgent(id)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!id) return
    setDebatesLoading(true)
    api.getAgentDebates(id, PAGE_SIZE, debatesOffset)
      .then((res) => {
        setDebates(res?.debates ?? [])
        setDebatesTotal(res?.total ?? 0)
      })
      .catch(console.error)
      .finally(() => setDebatesLoading(false))
  }, [id, debatesOffset])

  if (loading) return (
    <div className="space-y-4">
      <div className="h-24 bg-muted animate-pulse rounded-lg" />
      <div className="h-40 bg-muted animate-pulse rounded-lg" />
    </div>
  )

  if (!data?.agent) return (
    <div className="text-center py-16 text-muted-foreground">Agent not found.</div>
  )

  const { agent, stats } = data
  const totalPages = Math.ceil(debatesTotal / PAGE_SIZE)
  const currentPage = Math.floor(debatesOffset / PAGE_SIZE) + 1

  return (
    <div className="max-w-2xl space-y-8">

      {/* Header */}
      <div className="space-y-2">
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-4 w-4" />
          {backLabel}
        </Link>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold">{agent.name}</h1>
          <span className={`text-xs px-2 py-1 rounded font-mono shrink-0 ${TYPE_COLORS[agent.agent_type] ?? 'bg-gray-100 text-gray-600'}`}>
            {agent.agent_type}
          </span>
        </div>
        {agent.persona && (
          <p className="text-sm text-muted-foreground italic">{agent.persona}</p>
        )}
        {agent.expertise_areas && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {agent.expertise_areas.split(',').map((area: string) => area.trim()).filter(Boolean).map((area: string) => (
              <Badge key={area} variant="outline" className="text-xs">{area}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-4 text-center">
          <p className="text-2xl font-bold">{stats.debate_count}</p>
          <p className="text-xs text-muted-foreground mt-1">Debates</p>
        </div>
        <div className="border rounded-lg p-4 text-center">
          <p className="text-2xl font-bold">{stats.argument_count}</p>
          <p className="text-xs text-muted-foreground mt-1">Arguments</p>
        </div>
        <div className="border rounded-lg p-4 text-center">
          <p className="text-2xl font-bold">
            {stats.avg_ratings ? stats.avg_ratings.overall.toFixed(1) : '—'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Avg Rating</p>
        </div>
      </div>

      {/* Ratings breakdown */}
      {stats.avg_ratings && (
        <div className="border rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm">Argument Ratings</h2>
            <span className="text-xs text-muted-foreground">
              from {stats.avg_ratings.rating_count} rated argument{stats.avg_ratings.rating_count !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-2.5">
            {(['overall', 'persuasiveness', 'logical_soundness', 'factual_accuracy', 'relevance'] as const).map((key) => (
              <RatingBar key={key} label={RATING_LABELS[key]} value={stats.avg_ratings[key]} />
            ))}
          </div>
        </div>
      )}

      {/* Debate history */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            Debate History{debatesTotal > 0 ? ` (${debatesTotal})` : ''}
          </h2>
          {totalPages > 1 && (
            <span className="text-xs text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
          )}
        </div>

        {debatesLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : debates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No debates yet.</p>
        ) : (
          <>
            <div className="divide-y border rounded-lg overflow-hidden">
              {debates.map((debate: any) => (
                <Link
                  key={debate.id}
                  href={`/debates/${debate.id}`}
                  className="flex items-start gap-3 p-4 bg-background hover:bg-muted/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    {debate.legislation_title && (
                      <p className="text-xs text-muted-foreground mb-0.5 truncate">{debate.legislation_title}</p>
                    )}
                    <p className="text-sm font-medium line-clamp-1">{debate.topic || debate.title}</p>
                    {debate.created_at && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {new Date(debate.created_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${STATUS_COLORS[debate.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {debate.status}
                  </span>
                </Link>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={() => setDebatesOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  disabled={debatesOffset === 0}
                  className="text-sm px-3 py-1.5 rounded-md border disabled:opacity-40 hover:bg-muted/40 transition-colors"
                >
                  ← Previous
                </button>
                <button
                  onClick={() => setDebatesOffset((o) => o + PAGE_SIZE)}
                  disabled={debatesOffset + PAGE_SIZE >= debatesTotal}
                  className="text-sm px-3 py-1.5 rounded-md border disabled:opacity-40 hover:bg-muted/40 transition-colors"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

    </div>
  )
}
