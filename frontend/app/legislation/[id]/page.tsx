'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { PerspectivesPanel } from '@/components/PerspectivesPanel'
import { api } from '@/lib/api'

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

  useEffect(() => {
    Promise.all([
      api.getLegislation(id),
      api.getCouncilmembers().catch(() => ({ members: [] })),
    ])
      .then(([legData, cmData]) => {
        setLeg(legData?.data ?? null)
        setMembers(cmData?.members ?? [])
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
  const impactColor = leg.impact_level ? IMPACT_COLORS[leg.impact_level] : null

  let tags: string[] = []
  try { tags = leg.tags ? JSON.parse(leg.tags) : [] } catch { tags = [] }

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

      {/* Perspectives */}
      <div>
        <h2 className="text-lg font-semibold mb-4">AI Perspectives</h2>
        <PerspectivesPanel billId={id} analyzed={!!leg.analyzed_at} />
      </div>
    </div>
  )
}
