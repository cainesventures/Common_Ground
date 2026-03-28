'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { DebateViewer } from '@/components/DebateViewer'
import { VoteButtons } from '@/components/VoteButtons'
import { api } from '@/lib/api'

function VideoPanel({ debateId }: { debateId: string }) {
  const [video, setVideo] = useState<any>(null)

  useEffect(() => {
    api.getVideoStatus(debateId)
      .then((d: any) => { if (d?.video) setVideo(d.video) })
      .catch(() => {})
  }, [debateId])

  useEffect(() => {
    if (!video || video.status === 'completed' || video.status === 'failed') return
    const id = setInterval(() => {
      api.getVideoStatus(debateId)
        .then((d: any) => { if (d?.video) setVideo(d.video) })
        .catch(() => {})
    }, 10000)
    return () => clearInterval(id)
  }, [video?.status, debateId])

  if (!video || video.status === 'pending' || video.status === 'processing') {
    if (!video) return null
    return (
      <div className="w-full aspect-video bg-muted rounded-lg flex items-center justify-center text-sm text-muted-foreground animate-pulse mb-6">
        Video generating…
      </div>
    )
  }
  if (video.status === 'completed') {
    return (
      <video
        controls
        poster={video.thumbnail_url}
        src={video.video_url}
        className="w-full rounded-lg mb-6"
      />
    )
  }
  return null
}

export default function DebatePage() {
  const { id } = useParams<{ id: string }>()
  const [debate, setDebate] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getDebate(id)
      .then((data) => setDebate(data?.debate ?? data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div className="space-y-4">
      <div className="h-24 bg-mused animate-pulse rounded-lg" />
      <div className="h-64 bg-muted animate-pulse rounded-lg" />
    </div>
  )

  if (!debate) return (
    <div className="text-center py-16 text-muted-foreground">Debate not found.</div>
  )

  const legId = debate.legislation_id ?? debate.legislation?.id

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-6">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="outline" className="text-xs">{debate.status}</Badge>
            <span className="text-xs text-muted-foreground">
              {debate.turn_count}/{debate.max_turns} turns
            </span>
          </div>
          <h1 className="text-2xl font-bold leading-snug">{debate.title}</h1>
          {debate.legislation?.bill_number && (
            <p className="text-sm text-muted-foreground font-medium mt-0.5">
              {debate.legislation.bill_number}
              {debate.legislation.title && ` — ${debate.legislation.title}`}
            </p>
          )}
          {debate.topic && (
            <p className="text-muted-foreground mt-1">{debate.topic}</p>
          )}
        </div>

        <VideoPanel debateId={id} />
        <DebateViewer messages={debate.messages ?? []} />
      </div>

      <div className="space-y-6">
        {legId && (
          <div className="border rounded-lg p-5 space-y-4">
            <h2 className="font-semibold text-sm">About this bill</h2>
            {debate.legislation && (
              <>
                <p className="text-sm font-medium">{debate.legislation.title}</p>

                {debate.legislation.sponsor && (
                  <div className="text-sm space-y-1">
                    <div className="flex items-baseline gap-1.5 flex-wrap">
                      <span className="text-muted-foreground text-xs">Sponsored by</span>
                      <span className="font-medium">{debate.legislation.sponsor}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {debate.legislation.sponsor_party && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          debate.legislation.sponsor_party === 'Republican'
                            ? 'bg-red-100 text-red-700'
                            : debate.legislation.sponsor_party === 'Democrat'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}>
                          {debate.legislation.sponsor_party}
                        </span>
                      )}
                      {debate.legislation.sponsor_state && (
                        <span className="text-xs text-muted-foreground font-mono">
                          {debate.legislation.sponsor_state}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {debate.legislation.introduced_date && (
                  <div className="text-xs text-muted-foreground">
                    Introduced {new Date(debate.legislation.introduced_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                )}

                {debate.legislation.status && (
                  <div className="text-xs text-muted-foreground capitalize">
                    Status: {debate.legislation.status.replace(/_/g, ' ')}
                  </div>
                )}

                {debate.legislation.external_url && (
                  <a
                    href={debate.legislation.external_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline block"
                  >
                    View on Congress.gov →
                  </a>
                )}

                <Link
                  href={`/legislation/${legId}?from=/debates/${id}`}
                  className="text-xs text-primary hover:underline block"
                >
                  View full bill →
                </Link>
              </>
            )}
            <VoteButtons legislationId={legId} debateId={id} />
          </div>
        )}

        {debate.participating_agents?.length > 0 && (
          <div className="border rounded-lg p-5">
            <h2 className="font-semibold text-sm mb-3">Debators</h2>
            <div className="space-y-2">
              {[...debate.participating_agents]
                .sort((a: any, b: any) => {
                  const aMod = a.agent_type === 'moderator' || a.id?.includes('moderator')
                  const bMod = b.agent_type === 'moderator' || b.id?.includes('moderator')
                  return aMod === bMod ? 0 : aMod ? -1 : 1
                })
                .map((agent: any) => (
                <Link key={agent.id} href={`/agents/${agent.id}?from=/debates/${id}`} className="block text-sm hover:underline">
                  <span className="font-medium">{agent.name}</span>
                  {agent.persona && (
                    <span className="text-muted-foreground ml-1">— {agent.persona}</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
