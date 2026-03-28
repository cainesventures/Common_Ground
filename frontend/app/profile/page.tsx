'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { isLoggedIn, clearToken } from '@/lib/auth'

const VOTE_STYLES: Record<string, string> = {
  support: 'bg-green-100 text-green-800',
  oppose: 'bg-red-100 text-red-800',
  neutral: 'bg-yellow-100 text-yellow-800',
}

const DEBATE_STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  active: 'bg-blue-100 text-blue-700',
  researching: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-700',
}

export default function ProfilePage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [votes, setVotes] = useState<any[]>([])
  const [myDebates, setMyDebates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/')
      return
    }

    Promise.all([
      api.getMe(),
      api.getMyVotes(),
      api.getMyDebates(),
    ]).then(([meData, voteData, debateData]) => {
      setUser(meData?.user ?? null)
      setVotes(voteData?.votes ?? [])
      setMyDebates(debateData?.debates ?? [])
    }).catch(() => {
      clearToken()
      router.replace('/')
    }).finally(() => setLoading(false))
  }, [router])

  if (loading) return <div className="h-64 bg-muted animate-pulse rounded-lg" />
  if (!user) return null

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16">
          <AvatarImage src={user.avatar_url} alt={user.display_name} />
          <AvatarFallback className="text-xl">{user.display_name?.[0] ?? 'U'}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-2xl font-bold">{user.display_name}</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
          {user.subscription_tier && user.subscription_tier !== 'free' && (
            <Badge variant="outline" className="text-xs mt-1 capitalize">{user.subscription_tier}</Badge>
          )}
        </div>
      </div>

      {/* My Debates */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">My Debates</h2>
          <Link href="/debates/new" className="text-sm text-primary hover:underline">+ New Debate</Link>
        </div>
        {myDebates.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            You haven&apos;t created any debates yet.{' '}
            <Link href="/debates/new" className="text-primary hover:underline">Create one</Link> to get started.
          </p>
        ) : (
          <div className="divide-y border rounded-lg overflow-hidden">
            {myDebates.map((d: any) => (
              <Link
                key={d.id}
                href={`/debates/${d.id}`}
                className="flex items-start gap-3 p-4 bg-background hover:bg-muted/40 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  {d.legislation_title && (
                    <p className="text-xs text-muted-foreground mb-0.5 truncate">{d.legislation_title}</p>
                  )}
                  <p className="text-sm font-medium line-clamp-1">{d.topic || d.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {d.turn_count}/{d.max_turns} turns
                    {d.created_at && <> · {new Date(d.created_at).toLocaleDateString()}</>}
                  </p>
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${DEBATE_STATUS_COLORS[d.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {d.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">My Votes</h2>
        {votes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            You haven&apos;t voted on any legislation yet.{' '}
            <Link href="/" className="text-primary hover:underline">Browse debates</Link> to get started.
          </p>
        ) : (
          <div className="space-y-3">
            {votes.map((v: any, i: number) => (
              <div key={i} className="flex items-start gap-3 border rounded-lg p-3">
                <Badge
                  variant="outline"
                  className={`text-xs shrink-0 mt-0.5 ${VOTE_STYLES[v.vote] ?? ''}`}
                >
                  {v.vote}
                </Badge>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {v.legislation?.title ?? v.legislation?.id ?? 'Unknown bill'}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    {v.legislation?.bill_number && (
                      <span>{v.legislation.bill_number}</span>
                    )}
                    {v.voted_at && (
                      <span>{new Date(v.voted_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                {v.legislation?.id && (
                  <Link
                    href={`/legislation/${v.legislation.id}`}
                    className="text-xs text-primary hover:underline shrink-0 ml-auto"
                  >
                    View
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
