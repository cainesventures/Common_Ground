'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
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
  const [digestEnabled,   setDigestEnabled]   = useState(false)
  const [digestFrequency, setDigestFrequency] = useState('weekly')
  const [digestMinImpact, setDigestMinImpact] = useState('low')
  const [digestSaving,    setDigestSaving]    = useState(false)

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/')
      return
    }

    Promise.allSettled([
      api.getMe(),
      api.getMyVotes(),
    ]).then(([meResult, voteResult]) => {
      if (meResult.status === 'rejected') {
        clearToken()
        router.replace('/')
        return
      }
      const meData = meResult.value
      const voteData = voteResult.status === 'fulfilled' ? voteResult.value : null
      setUser(meData?.user ?? null)
      setDigestEnabled(meData?.user?.digest_enabled ?? false)
      setDigestFrequency(meData?.user?.digest_frequency ?? 'weekly')
      setDigestMinImpact(meData?.user?.digest_min_impact ?? 'low')
      setVotes(voteData?.votes ?? [])
    }).finally(() => setLoading(false))
  }, [router])

  const savePreferences = async (overrides: { digest_enabled?: boolean; digest_frequency?: string; digest_min_impact?: string } = {}) => {
    setDigestSaving(true)
    const prefs = {
      digest_enabled:   overrides.digest_enabled   ?? digestEnabled,
      digest_frequency: overrides.digest_frequency ?? digestFrequency,
      digest_min_impact: overrides.digest_min_impact ?? digestMinImpact,
    }
    try {
      await api.updatePreferences(prefs)
      if (overrides.digest_enabled   !== undefined) setDigestEnabled(overrides.digest_enabled)
      if (overrides.digest_frequency !== undefined) setDigestFrequency(overrides.digest_frequency)
      if (overrides.digest_min_impact !== undefined) setDigestMinImpact(overrides.digest_min_impact)
    } catch {
      toast.error('Failed to save preferences — please try again')
    } finally {
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
      <div className="border rounded-lg divide-y">
        {/* Toggle */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Email Digest</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Get a summary of new Philadelphia City Council bills with AI perspectives.
            </p>
          </div>
          <button
            onClick={() => savePreferences({ digest_enabled: !digestEnabled })}
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

        {/* Frequency */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Frequency</p>
            <p className="text-xs text-muted-foreground mt-0.5">How often to receive the digest</p>
          </div>
          <select
            value={digestFrequency}
            disabled={!digestEnabled || digestSaving}
            onChange={(e) => savePreferences({ digest_frequency: e.target.value })}
            className="h-8 rounded border bg-background px-2 text-sm disabled:opacity-40"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="never">Never</option>
          </select>
        </div>

        {/* Min impact */}
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Minimum impact level</p>
            <p className="text-xs text-muted-foreground mt-0.5">Only include bills at or above this impact</p>
          </div>
          <select
            value={digestMinImpact}
            disabled={!digestEnabled || digestSaving}
            onChange={(e) => savePreferences({ digest_min_impact: e.target.value })}
            className="h-8 rounded border bg-background px-2 text-sm disabled:opacity-40"
          >
            <option value="low">Low and above</option>
            <option value="medium">Medium and above</option>
            <option value="high">High only</option>
          </select>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">My Votes</h2>
        {votes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            You haven&apos;t voted on any legislation yet.{' '}
            <Link href="/legislation" className="text-primary hover:underline">Browse legislation</Link> to get started.
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
