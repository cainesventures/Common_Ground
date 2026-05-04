'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { isLoggedIn } from '@/lib/auth'
import { STATUS_COLORS, STATUS_COLORS_FALLBACK, IMPACT_COLORS } from '@/lib/badge-colors'
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

export default function MyBillsPage() {
  const router = useRouter()
  const { city } = useParams<{ city: string }>()
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
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-40 bg-muted animate-pulse rounded" />
          <div className="h-4 w-52 bg-muted animate-pulse rounded" />
        </div>
        <div className="h-8 w-24 bg-muted animate-pulse rounded" />
      </div>
      <div className="flex flex-col gap-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="border rounded-lg px-4 py-3 space-y-2">
            <div className="flex gap-2">
              <div className="h-4 w-16 bg-muted animate-pulse rounded-full" />
              <div className="h-4 w-20 bg-muted animate-pulse rounded-full" />
            </div>
            <div className="h-4 w-3/4 bg-muted animate-pulse rounded" />
            <div className="h-3 w-full bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Saved Bills</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Bills you&apos;ve bookmarked for easy access.
          </p>
        </div>
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

                {/* Remove bookmark */}
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
  )
}
