'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { isLoggedIn } from '@/lib/auth'
import { STATUS_COLORS, STATUS_COLORS_FALLBACK, IMPACT_COLORS, POSITION_STYLES } from '@/lib/badge-colors'
import { fmtStatus } from '@/lib/utils'

function ExportButtons() {
  const [loadingCsv,  setLoadingCsv]  = useState(false)
  const [loadingJson, setLoadingJson] = useState(false)

  const doExport = async (format: 'csv' | 'json') => {
    const setLoading = format === 'csv' ? setLoadingCsv : setLoadingJson
    setLoading(true)
    try {
      await api.exportLegislation({ format, trackedOnly: true })
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Export:</span>
      <button
        onClick={() => doExport('csv')}
        disabled={loadingCsv}
        className="text-xs px-2.5 py-1.5 rounded border hover:bg-muted transition-colors disabled:opacity-50"
      >
        {loadingCsv ? '…' : 'CSV'}
      </button>
      <button
        onClick={() => doExport('json')}
        disabled={loadingJson}
        className="text-xs px-2.5 py-1.5 rounded border hover:bg-muted transition-colors disabled:opacity-50"
      >
        {loadingJson ? '…' : 'JSON'}
      </button>
    </div>
  )
}

interface TrackedBill {
  id: string
  bill_number: string
  title: string
  plain_title?: string
  status: string
  level: string
  impact_level?: string
  impact_score?: number
  bill_type?: string
  tags?: string
  summary?: string
  description?: string
  analyzed_at?: string
  tracked_at?: string
}

interface VoteRecord {
  vote: string
  voted_at: string | null
  legislation: {
    id: string
    title: string | null
    plain_title: string | null
    bill_number: string | null
    status: string | null
    level: string | null
  } | null
}

function VoteBar({ support, oppose, neutral }: { support: number; oppose: number; neutral: number }) {
  const total = support + oppose + neutral
  if (total === 0) return null
  const sp = Math.round((support / total) * 100)
  const op = Math.round((oppose / total) * 100)
  const ne = 100 - sp - op

  return (
    <div className="flex rounded-full overflow-hidden h-2 gap-px">
      {sp > 0 && <div className="bg-green-500" style={{ width: `${sp}%` }} />}
      {op > 0 && <div className="bg-red-500" style={{ width: `${op}%` }} />}
      {ne > 0 && <div className="bg-muted-foreground/30" style={{ width: `${ne}%` }} />}
    </div>
  )
}

function VotingStats({ votes }: { votes: VoteRecord[] }) {
  const support = votes.filter(v => v.vote === 'support').length
  const oppose  = votes.filter(v => v.vote === 'oppose').length
  const neutral = votes.filter(v => v.vote === 'neutral').length
  const total   = votes.length

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Your voting record</p>
        <span className="text-xs text-muted-foreground">{total} vote{total !== 1 ? 's' : ''}</span>
      </div>
      <VoteBar support={support} oppose={oppose} neutral={neutral} />
      <div className="flex gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
          <span className="font-medium text-green-700 dark:text-green-400">{support}</span>
          <span className="text-muted-foreground">Support</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
          <span className="font-medium text-red-700 dark:text-red-400">{oppose}</span>
          <span className="text-muted-foreground">Oppose</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/40" />
          <span className="font-medium">{neutral}</span>
          <span className="text-muted-foreground">Neutral</span>
        </span>
      </div>
    </div>
  )
}

export default function MyBillsPage() {
  const router = useRouter()
  const { city } = useParams<{ city: string }>()
  const [tab, setTab] = useState<'saved' | 'votes'>('saved')
  const [bills, setBills] = useState<TrackedBill[]>([])
  const [votes, setVotes] = useState<VoteRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/')
      return
    }
    Promise.allSettled([
      api.getTrackedBills(),
      api.getMyVotes(100),
    ]).then(([billsResult, votesResult]) => {
      if (billsResult.status === 'fulfilled') setBills(billsResult.value?.bills ?? [])
      if (votesResult.status === 'fulfilled') setVotes(votesResult.value?.votes ?? [])
    }).finally(() => setLoading(false))
  }, [router])

  const handleUntrack = useCallback(async (billId: string) => {
    const snapshot = bills.find((b) => b.id === billId)
    setBills((prev) => prev.filter((b) => b.id !== billId))
    try {
      await api.toggleTrackBill(billId)
    } catch {
      if (snapshot) setBills((prev) => [...prev, snapshot])
      toast.error('Failed to remove bill — please try again')
    }
  }, [bills])

  if (loading) return (
    <div className="max-w-3xl space-y-6">
      <div className="h-7 w-32 bg-muted animate-pulse rounded" />
      <div className="flex gap-2">
        <div className="h-8 w-24 bg-muted animate-pulse rounded-md" />
        <div className="h-8 w-24 bg-muted animate-pulse rounded-md" />
      </div>
      <div className="flex flex-col gap-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="border rounded-lg px-4 py-3 space-y-2">
            <div className="flex gap-2">
              <div className="h-4 w-16 bg-muted animate-pulse rounded-full" />
              <div className="h-4 w-20 bg-muted animate-pulse rounded-full" />
            </div>
            <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">My Bills</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {([
          { key: 'saved', label: 'Saved', count: bills.length },
          { key: 'votes', label: 'Votes', count: votes.length },
        ] as const).map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {count > 0 && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                tab === key ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              }`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Saved Bills tab */}
      {tab === 'saved' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Bills you&apos;ve bookmarked for easy access.</p>
            {bills.length > 0 && <ExportButtons />}
          </div>

          {bills.length === 0 ? (
            <div className="border rounded-lg py-20 px-8 text-center space-y-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto text-muted-foreground/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
              <div className="space-y-1">
                <p className="text-sm font-semibold">No saved bills yet</p>
                <p className="text-sm text-muted-foreground">Bookmark bills to track their progress and come back to them easily.</p>
              </div>
              <Link href={`/${city}/legislation`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
                Browse legislation →
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {bills.map((bill) => {
                const impactColor = bill.impact_level ? IMPACT_COLORS[bill.impact_level] : null
                const statusColor = STATUS_COLORS[bill.status] ?? STATUS_COLORS_FALLBACK
                let tags: string[] = []
                try { tags = bill.tags ? JSON.parse(bill.tags) : [] } catch { tags = [] }

                return (
                  <div key={bill.id} className="relative border rounded-lg hover:border-primary/60 hover:bg-muted/20 transition-all">
                    <Link href={`/${city}/legislation/${bill.id}`} className="block px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap mb-1 pr-8">
                        <span className="text-xs text-muted-foreground font-mono shrink-0">{bill.bill_number}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${statusColor}`}>
                          {bill.status ? fmtStatus(bill.status) : ''}
                        </span>
                        {impactColor && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${impactColor}`}>
                            {bill.impact_level} impact
                          </span>
                        )}
                        {bill.tracked_at && (
                          <span className="text-xs text-muted-foreground ml-auto">
                            Saved {new Date(bill.tracked_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>

                      {bill.plain_title
                        ? <>
                            <p className="text-sm font-semibold leading-snug pr-8">{bill.plain_title}</p>
                            <p className="text-xs text-muted-foreground/70 mt-0.5 line-clamp-1">
                              <span className="uppercase tracking-wide font-medium text-[10px] mr-1">Legal:</span>
                              {bill.title}
                            </p>
                          </>
                        : <p className="text-sm font-medium leading-snug pr-8">{bill.title}</p>
                      }

                      {(bill.summary || bill.description) && (
                        <p className="text-xs text-muted-foreground leading-relaxed mt-1 line-clamp-2">
                          {bill.summary ?? bill.description}
                        </p>
                      )}

                      {tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {tags.map((tag) => (
                            <span key={tag} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800 px-2 py-0.5 rounded-full font-medium capitalize">{tag}</span>
                          ))}
                        </div>
                      )}
                    </Link>

                    <button
                      onClick={(e) => { e.preventDefault(); handleUntrack(bill.id) }}
                      className="absolute top-3 right-3 p-1 rounded text-primary hover:text-destructive transition-colors"
                      title="Unsave bill"
                      aria-label={`Unsave ${bill.plain_title || bill.title}`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Votes tab */}
      {tab === 'votes' && (
        <div className="space-y-4">
          {votes.length === 0 ? (
            <div className="border rounded-lg py-20 px-8 text-center space-y-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto text-muted-foreground/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="space-y-1">
                <p className="text-sm font-semibold">No votes yet</p>
                <p className="text-sm text-muted-foreground">Vote on legislation to see your record here.</p>
              </div>
              <Link href={`/${city}/legislation`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
                Browse legislation →
              </Link>
            </div>
          ) : (
            <>
              <VotingStats votes={votes} />
              <div className="flex flex-col gap-2">
                {votes.map((v, i) => {
                  const statusColor = v.legislation?.status
                    ? (STATUS_COLORS[v.legislation.status] ?? STATUS_COLORS_FALLBACK)
                    : STATUS_COLORS_FALLBACK
                  const voteStyle = POSITION_STYLES[v.vote] ?? ''
                  return (
                    <Link
                      key={i}
                      href={`/${city}/legislation/${v.legislation?.id}`}
                      className="flex items-start gap-3 border rounded-lg px-4 py-3 hover:border-primary/60 hover:bg-muted/20 transition-all"
                    >
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize shrink-0 mt-0.5 ${voteStyle}`}>
                        {v.vote}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug line-clamp-2">
                          {v.legislation?.plain_title || v.legislation?.title || 'Unknown bill'}
                        </p>
                        <div className="flex items-center gap-2 flex-wrap mt-0.5">
                          {v.legislation?.bill_number && (
                            <span className="text-xs text-muted-foreground font-mono">{v.legislation.bill_number}</span>
                          )}
                          {v.legislation?.status && (
                            <span className={`text-xs px-1.5 py-0.5 rounded-full capitalize ${statusColor}`}>
                              {fmtStatus(v.legislation.status)}
                            </span>
                          )}
                          {v.voted_at && (
                            <span className="text-xs text-muted-foreground">· {new Date(v.voted_at).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
