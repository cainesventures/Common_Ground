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

export default function ProfilePage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [votes, setVotes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [digestEnabled, setDigestEnabled] = useState(false)
  const [digestSaving, setDigestSaving] = useState(false)

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/')
      return
    }

    Promise.all([
      api.getMe(),
      api.getMyVotes(),
    ]).then(([meData, voteData]) => {
      setUser(meData?.user ?? null)
      setDigestEnabled(meData?.user?.digest_enabled ?? false)
      setVotes(voteData?.votes ?? [])
    }).catch(() => {
      clearToken()
      router.replace('/')
    }).finally(() => setLoading(false))
  }, [router])

  const handleDigestToggle = async () => {
    const next = !digestEnabled
    setDigestSaving(true)
    try {
      await api.updatePreferences({ digest_enabled: next })
      setDigestEnabled(next)
    } catch { /* ignore */ } finally {
      setDigestSaving(false)
    }
  }

  if (loading) return <div className="h-64 bg-muted animate-pulse rounded-lg" />
  if (!user) return null

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16 shrink-0">
          <AvatarImage
            src={
              user.avatar_url
                ? user.avatar_url
                : user.subscription_tier === 'dev'
                  ? `https://flagcdn.com/us.svg`
                  : `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(user.id)}`
            }
            alt={user.display_name}
          />
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

      {/* My Saved Bills */}
      <div className="flex items-center justify-between border rounded-lg px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Saved Bills</p>
          <p className="text-xs text-muted-foreground mt-0.5">Bills you&apos;ve bookmarked</p>
        </div>
        <Link href="/my-bills" className="text-sm text-primary hover:underline shrink-0">
          View all →
        </Link>
      </div>

      {/* Email Preferences */}
      <div className="border rounded-lg px-4 py-3 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Weekly Digest</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Get a weekly email summary of new Philadelphia City Council bills with AI perspectives.
          </p>
        </div>
        <button
          onClick={handleDigestToggle}
          disabled={digestSaving}
          className={`relative shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
            digestEnabled ? 'bg-primary' : 'bg-muted-foreground/30'
          } ${digestSaving ? 'opacity-50' : ''}`}
          role="switch"
          aria-checked={digestEnabled}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            digestEnabled ? 'translate-x-6' : 'translate-x-1'
          }`} />
        </button>
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
