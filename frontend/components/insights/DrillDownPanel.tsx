'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'

const PAGE_SIZE = 20

const IMPACT_COLORS: Record<string, string> = {
  high:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  low:    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

export interface DrillDownSearchParams {
  status?: string
  year?: number
  tag?: string
  sponsor?: string
  impact?: string
  billType?: string
  committee?: string
}

interface Props {
  title: string
  searchParams: DrillDownSearchParams
  viewAllHref: string
  onClose: () => void
}

interface BillRow {
  id: string
  bill_number: string
  plain_title: string
  headline: string
  status: string
  impact_level: string
  introduced_date: string
}

export default function DrillDownPanel({ title, searchParams, viewAllHref, onClose }: Props) {
  const [bills, setBills] = useState<BillRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setPage(0)
    setBills([])
  }, [searchParams])

  useEffect(() => {
    setLoading(true)
    api.searchLegislation(
      '',
      PAGE_SIZE,
      page * PAGE_SIZE,
      'local',
      '',
      searchParams.tag ?? '',
      searchParams.impact ?? '',
      searchParams.year ?? 0,
      0,
      searchParams.status ?? '',
      searchParams.sponsor ?? '',
      false,
      false,
      false,
      searchParams.billType ?? '',
      searchParams.committee ?? '',
    ).then((d: any) => {
      setBills(d?.results ?? [])
      setTotal(d?.total ?? 0)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [searchParams, page])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="mt-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="font-semibold text-sm">{title}</span>
          {!loading && <span className="ml-2 text-xs text-muted-foreground">{total} bills</span>}
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground py-4 text-center">Loading…</div>
      ) : bills.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center">No bills found.</div>
      ) : (
        <ul className="divide-y text-sm">
          {bills.map(bill => (
            <li key={bill.id} className="py-2 flex items-start gap-3">
              <Link
                href={`/legislation/${bill.id}`}
                className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0 hover:bg-accent"
              >
                {bill.bill_number}
              </Link>
              <div className="flex-1 min-w-0">
                <Link href={`/legislation/${bill.id}`} className="hover:underline line-clamp-1">
                  {bill.plain_title || bill.headline || '(untitled)'}
                </Link>
                <div className="flex items-center gap-2 mt-0.5">
                  {bill.impact_level && (
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${IMPACT_COLORS[bill.impact_level] ?? ''}`}>
                      {bill.impact_level}
                    </span>
                  )}
                  {bill.introduced_date && (
                    <span className="text-xs text-muted-foreground">
                      {bill.introduced_date.slice(0, 10)}
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loading && (total > PAGE_SIZE || page > 0) && (
        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <button
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            className="disabled:opacity-40 hover:text-foreground"
          >
            ← Prev
          </button>
          <span>Page {page + 1} of {totalPages}</span>
          <button
            disabled={page + 1 >= totalPages}
            onClick={() => setPage(p => p + 1)}
            className="disabled:opacity-40 hover:text-foreground"
          >
            Next →
          </button>
        </div>
      )}

      {!loading && total > 0 && (
        <div className="mt-3 text-right">
          <Link href={viewAllHref} className="text-xs text-primary hover:underline">
            View all {total} bills →
          </Link>
        </div>
      )}
    </div>
  )
}
