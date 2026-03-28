'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { getToken } from '@/lib/auth'
import { getVoterToken } from '@/lib/voter'

interface VoteCounts {
  support: number
  oppose: number
  neutral: number
  total: number
}

interface VoteButtonsProps {
  legislationId: string
  debateId?: string
}

const VOTES = [
  { key: 'support', label: '👍 Support', active: 'bg-green-600 text-white hover:bg-green-700' },
  { key: 'oppose',  label: '👎 Oppose',  active: 'bg-red-600 text-white hover:bg-red-700' },
  { key: 'neutral', label: '🤝 Neutral', active: 'bg-yellow-500 text-white hover:bg-yellow-600' },
] as const

type VoteKey = 'support' | 'oppose' | 'neutral'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export function VoteButtons({ legislationId, debateId }: VoteButtonsProps) {
  const [counts, setCounts] = useState<VoteCounts>({ support: 0, oppose: 0, neutral: 0, total: 0 })
  const [yourVote, setYourVote] = useState<VoteKey | null>(null)
  const [loading, setLoading] = useState(false)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const promptRef = useRef<HTMLDivElement>(null)

  const isLoggedIn = !!getToken()

  useEffect(() => {
    const token = getVoterToken()
    api.getVotes(legislationId, token)
      .then((data) => {
        // Use member counts for display since all UI votes are now member votes
        const c = data?.counts?.member ?? data?.counts?.total ?? data?.counts
        if (c) setCounts(c)
        if (data?.your_vote) setYourVote(data.your_vote as VoteKey)
      })
      .catch(() => {})
  }, [legislationId])

  // Close prompt when clicking outside
  useEffect(() => {
    if (!showLoginPrompt) return
    const handler = (e: MouseEvent) => {
      if (promptRef.current && !promptRef.current.contains(e.target as Node)) {
        setShowLoginPrompt(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showLoginPrompt])

  const handleVote = async (vote: VoteKey) => {
    if (!isLoggedIn) {
      setShowLoginPrompt(true)
      return
    }
    if (loading) return
    setLoading(true)
    try {
      const token = getVoterToken()
      const data = await api.castVote(legislationId, vote, token, debateId)
      const c = data?.counts?.member ?? data?.counts?.total ?? data?.counts
      if (c) setCounts(c)
      setYourVote(vote)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-muted-foreground">Your vote on this bill</p>

      <div className="relative">
        <div className="flex gap-2 flex-wrap">
          {VOTES.map(({ key, label, active }) => (
            <Button
              key={key}
              variant={yourVote === key ? 'default' : 'outline'}
              size="sm"
              disabled={loading}
              className={yourVote === key ? active : ''}
              onClick={() => handleVote(key)}
            >
              {label}
              {counts[key] > 0 && (
                <span className="ml-1 text-xs opacity-75">({counts[key]})</span>
              )}
            </Button>
          ))}
        </div>

        {/* Login prompt popup */}
        {showLoginPrompt && (
          <div
            ref={promptRef}
            className="absolute top-full left-0 mt-2 z-50 w-72 rounded-lg border bg-background shadow-lg p-4 space-y-3"
          >
            <div>
              <p className="font-semibold text-sm">Make your vote count</p>
              <p className="text-xs text-muted-foreground mt-1">
                Sign in to cast a verified member vote that&apos;s tracked separately from anonymous responses.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`${API_URL}/api/auth/google`}
                className="inline-flex items-center justify-center rounded-md px-3 h-8 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Sign in with Google
              </a>
              <button
                onClick={() => setShowLoginPrompt(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>

      {counts.total > 0 && (
        <p className="text-xs text-muted-foreground">
          {counts.total} member vote{counts.total !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
