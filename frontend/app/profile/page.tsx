'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { isLoggedIn, clearToken } from '@/lib/auth'
import { useTheme } from '@/components/ThemeToggle'

import { POSITION_STYLES } from '@/lib/badge-colors'

const VOTE_STYLES: Record<string, string> = {
  support: POSITION_STYLES.support,
  oppose:  POSITION_STYLES.oppose,
  neutral: POSITION_STYLES.neutral,
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
  const { theme, setTheme } = useTheme()

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

  if (loading) return (
    <div className="max-w-2xl space-y-8">
      {/* Avatar + name */}
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-muted animate-pulse shrink-0" />
        <div className="space-y-2">
          <div className="h-6 w-36 bg-muted animate-pulse rounded" />
          <div className="h-4 w-48 bg-muted animate-pulse rounded" />
        </div>
      </div>
      {/* Saved bills row */}
      <div className="h-14 bg-muted animate-pulse rounded-lg" />
      {/* Appearance */}
      <div className="h-14 bg-muted animate-pulse rounded-lg" />
      {/* Email prefs */}
      <div className="border rounded-lg divide-y">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="px-4 py-3 flex items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="h-4 w-28 bg-muted animate-pulse rounded" />
              <div className="h-3 w-52 bg-muted animate-pulse rounded" />
            </div>
            <div className="h-6 w-11 bg-muted animate-pulse rounded-full" />
          </div>
        ))}
      </div>
      {/* Votes */}
      <div className="space-y-3">
        <div className="h-5 w-20 bg-muted animate-pulse rounded" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="border rounded-lg p-3 flex gap-3">
            <div className="h-5 w-16 bg-muted animate-pulse rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-full bg-muted animate-pulse rounded" />
              <div className="h-3 w-24 bg-muted animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
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

      {/* Appearance */}
      <div className="border rounded-lg">
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Appearance</p>
            <p className="text-xs text-muted-foreground mt-0.5">Choose how the app looks to you</p>
          </div>
          <div className="flex rounded-lg border overflow-hidden shrink-0 text-xs font-medium">
            {([
              { key: 'light',  label: 'Light', icon: (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="4" />
                  <path strokeLinecap="round" d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              )},
              { key: 'system', label: 'System', icon: (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path strokeLinecap="round" d="M8 21h8M12 17v4" />
                </svg>
              )},
              { key: 'dark',   label: 'Dark',   icon: (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
              )},
            ] as { key: 'light' | 'system' | 'dark'; label: string; icon: ReactNode }[]).map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setTheme(key)}
                aria-pressed={theme === key}
                className={`flex items-center gap-1.5 px-3 py-2 transition-colors ${
                  theme === key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </div>
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
            aria-label="Enable email digest"
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
            aria-label="Digest frequency"
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
            aria-label="Minimum impact level"
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
                  className={`text-xs shrink-0 mt-0.5 capitalize ${VOTE_STYLES[v.vote] ?? ''}`}
                >
                  {v.vote}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium line-clamp-2 leading-snug">
                    {v.legislation?.plain_title || v.legislation?.title || 'Unknown bill'}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    {v.legislation?.bill_number && (
                      <span className="font-mono">{v.legislation.bill_number}</span>
                    )}
                    {v.voted_at && (
                      <span>· {new Date(v.voted_at).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                {v.legislation?.id && (
                  <Link
                    href={`/legislation/${v.legislation.id}`}
                    className="text-xs text-primary hover:underline shrink-0"
                    aria-label={`View ${v.legislation?.bill_number || 'bill'}`}
                  >
                    View →
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
