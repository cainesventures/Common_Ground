'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import { isLoggedIn } from '@/lib/auth'

const IMPACT_COLORS: Record<string, string> = {
  high:   'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low:    'bg-green-100 text-green-800',
}

const STATUS_COLORS: Record<string, string> = {
  introduced:      'bg-blue-100 text-blue-800',
  in_committee:    'bg-yellow-100 text-yellow-800',
  signed_into_law: 'bg-green-100 text-green-800',
  failed:          'bg-red-100 text-red-800',
  vetoed:          'bg-orange-100 text-orange-800',
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

export default function MyBillsPage() {
  const router = useRouter()
  const [bills, setBills] = useState<TrackedBill[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/')
      return
    }
    api.getTrackedBills()
      .then((data) => setBills(data?.bills ?? []))
      .catch(() => setBills([]))
      .finally(() => setLoading(false))
  }, [router])

  const handleUntrack = useCallback(async (billId: string) => {
    try {
      await api.toggleTrackBill(billId)
      setBills((prev) => prev.filter((b) => b.id !== billId))
    } catch { /* ignore */ }
  }, [])

  if (loading) return <div className="h-64 bg-muted animate-pulse rounded-lg" />

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Saved Bills</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Bills you&apos;ve bookmarked for easy access.
        </p>
      </div>

      {bills.length === 0 ? (
        <div className="border rounded-lg p-12 text-center space-y-3">
          <p className="text-muted-foreground">You haven&apos;t saved any bills yet.</p>
          <Link href="/" className="text-sm text-primary hover:underline">
            Browse legislation →
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {bills.map((bill) => {
            const impactColor = bill.impact_level ? IMPACT_COLORS[bill.impact_level] : null
            const statusColor = STATUS_COLORS[bill.status] ?? 'bg-gray-100 text-gray-700'
            let tags: string[] = []
            try { tags = bill.tags ? JSON.parse(bill.tags) : [] } catch { tags = [] }

            return (
              <div key={bill.id} className="relative border rounded-lg hover:border-primary/60 hover:bg-muted/20 transition-all">
                <Link href={`/legislation/${bill.id}`} className="block px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs text-muted-foreground font-mono shrink-0">{bill.bill_number}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${statusColor}`}>
                      {bill.status?.replace(/_/g, ' ')}
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
                        <span key={tag} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium capitalize">{tag}</span>
                      ))}
                    </div>
                  )}
                </Link>

                {/* Remove bookmark */}
                <button
                  onClick={(e) => { e.preventDefault(); handleUntrack(bill.id) }}
                  className="absolute top-3 right-3 p-1 rounded text-primary hover:text-destructive transition-colors"
                  title="Unsave bill"
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
  )
}
