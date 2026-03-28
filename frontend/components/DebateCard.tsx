import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface DebateCardProps {
  debate: {
    id: string
    title: string
    topic: string
    status: string
    turn_count: number
    max_turns: number
    legislation?: { title: string; level: string; status: string }
    legislation_bill_number?: string
    legislation_title?: string
    legislation_level?: string
    legislation_tags?: string[]
  }
}

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-800',
  active: 'bg-blue-100 text-blue-800',
  paused: 'bg-yellow-100 text-yellow-800',
}

const LEVEL_LABELS: Record<string, string> = {
  federal: 'Federal',
  state: 'State',
  local: 'Local',
}

export function DebateCard({ debate }: DebateCardProps) {
  const statusColor = STATUS_COLORS[debate.status] ?? 'bg-gray-100 text-gray-800'
  const level = debate.legislation_level ?? debate.legislation?.level ?? ''
  const billNumber = debate.legislation_bill_number
  const billTitle = debate.legislation_title ?? debate.legislation?.title
  const tags = debate.legislation_tags ?? []

  return (
    <Link href={`/debates/${debate.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-snug line-clamp-2">
              {debate.title}
            </CardTitle>
            <Badge className={`shrink-0 text-xs ${statusColor}`} variant="outline">
              {debate.status}
            </Badge>
          </div>
          {(billNumber || billTitle) && (
            <p className="text-xs text-muted-foreground truncate">
              {billNumber && <span className="font-medium">{billNumber}</span>}
              {billNumber && billTitle && ' — '}
              {billTitle}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
            {debate.topic}
          </p>
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{debate.turn_count} / {debate.max_turns} turns</span>
            {tags.length > 0 && (
              <div className="flex gap-1 flex-wrap justify-end">
                {tags.map((t) => (
                  <span key={t} className="px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
