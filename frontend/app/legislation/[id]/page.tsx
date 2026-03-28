'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { VoteButtons } from '@/components/VoteButtons'
import { DebateCard } from '@/components/DebateCard'
import { api } from '@/lib/api'

const LEVEL_LABELS: Record<string, string> = {
  federal: 'Federal',
  state: 'State',
  local: 'Local',
}

const STATUS_COLORS: Record<string, string> = {
  introduced: 'bg-blue-100 text-blue-800',
  in_committee: 'bg-yellow-100 text-yellow-800',
  signed_into_law: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  vetoed: 'bg-orange-100 text-orange-800',
}

export default function LegislationPage() {
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const backHref = searchParams.get('from')
  const [leg, setLeg] = useState<any>(null)
  const [debates, setDebates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.getLegislation(id),
      api.getDebatesByLegislation(id, 10, 0),
    ])
      .then(([legData, debateData]) => {
        setLeg(legData?.data ?? null)
        setDebates(debateData?.debates ?? [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="h-32 bg-muted animate-pulse rounded-lg" />

  if (!leg) return (
    <div className="text-center py-16 text-muted-foreground">
      Legislation not found.
    </div>
  )

  const statusColor = STATUS_COLORS[leg.status] ?? 'bg-gray-100 text-gray-800'

  return (
    <div className="space-y-8">
      {backHref && (
        <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <X className="h-4 w-4" />
          Debate
        </Link>
      )}
      <div>
        <div className="flex items-start justify-between gap-4 mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs">
              {LEVEL_LABELS[leg.level] ?? leg.level}
            </Badge>
            <Badge variant="outline" className={`text-xs ${statusColor}`}>
              {leg.status?.replace(/_/g, ' ')}
            </Badge>
            <span className="text-sm text-muted-foreground">{leg.bill_number}</span>
          </div>
          <Link
            href={`/debates/new?legislation_id=${id}`}
            className="shrink-0 inline-flex items-center justify-center rounded-md px-3 h-8 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            + Debate this bill
          </Link>
        </div>
        <h1 className="text-2xl font-bold leading-snug">{leg.title}</h1>
        {leg.sponsor && (
          <p className="text-sm text-muted-foreground mt-1">Sponsor: {leg.sponsor}</p>
        )}
        {leg.description && (
          <p className="text-sm text-muted-foreground mt-1">{leg.description}</p>
        )}
        {leg.full_text && leg.full_text !== leg.description && (
          <details className="mt-3">
            <summary className="text-sm font-medium cursor-pointer hover:text-foreground text-muted-foreground select-none">
              Full summary ▾
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
            className="text-sm text-primary hover:underline mt-2 block"
          >
            View source →
          </a>
        )}
      </div>

      <div className="border rounded-lg p-5">
        <VoteButtons legislationId={id} />
      </div>

      {debates.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Debates about this bill</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {debates.map((debate: any) => (
              <DebateCard key={debate.id} debate={debate} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
