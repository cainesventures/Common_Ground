'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

interface Metrics {
  bills: {
    total: number
    analyzed: number
    local: number
    with_news: number
    analysis_rate_pct: number
  }
  perspectives: {
    total: number
    by_position: Record<string, number>
  }
  users: {
    total: number
    digest_opted_in: number
  }
  tracking: {
    total_saves: number
  }
}

const POSITION_COLORS: Record<string, string> = {
  support:  'bg-green-500',
  oppose:   'bg-red-500',
  neutral:  'bg-gray-400',
  mixed:    'bg-yellow-500',
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="border rounded-lg px-5 py-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">{label}</p>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  )
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getMetrics()
      .then((data) => setMetrics(data?.metrics ?? null))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Could not load metrics: {error}
      </div>
    )
  }

  if (!metrics) return null

  const positionEntries = Object.entries(metrics.perspectives.by_position).sort((a, b) => b[1] - a[1])
  const totalPositioned = positionEntries.reduce((sum, [, n]) => sum + n, 0)

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Site-wide metrics for Common Ground.</p>
      </div>

      {/* Bills */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Legislation</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Bills" value={metrics.bills.total.toLocaleString()} />
          <StatCard
            label="Analyzed"
            value={metrics.bills.analyzed.toLocaleString()}
            sub={`${metrics.bills.analysis_rate_pct}% of total`}
          />
          <StatCard
            label="Pending"
            value={(metrics.bills.total - metrics.bills.analyzed).toLocaleString()}
            sub="not yet analyzed"
          />
          <StatCard label="With News" value={metrics.bills.with_news.toLocaleString()} />
        </div>

        {/* Analysis progress bar */}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>Analysis progress</span>
            <span>{metrics.bills.analysis_rate_pct}%</span>
          </div>
          <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${metrics.bills.analysis_rate_pct}%` }}
            />
          </div>
        </div>
      </section>

      {/* Perspectives */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Perspectives</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Generated" value={metrics.perspectives.total.toLocaleString()} />
          {positionEntries.map(([pos, count]) => (
            <StatCard
              key={pos}
              label={pos.charAt(0).toUpperCase() + pos.slice(1)}
              value={count.toLocaleString()}
              sub={totalPositioned ? `${Math.round(count / totalPositioned * 100)}% of perspectives` : undefined}
            />
          ))}
        </div>

        {/* Position breakdown bar */}
        {positionEntries.length > 0 && totalPositioned > 0 && (
          <div className="mt-4">
            <p className="text-xs text-muted-foreground mb-1">Position breakdown</p>
            <div className="flex h-3 w-full rounded-full overflow-hidden gap-px">
              {positionEntries.map(([pos, count]) => (
                <div
                  key={pos}
                  className={`${POSITION_COLORS[pos] ?? 'bg-blue-400'} transition-all`}
                  style={{ width: `${(count / totalPositioned) * 100}%` }}
                  title={`${pos}: ${count}`}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-3 mt-2">
              {positionEntries.map(([pos]) => (
                <span key={pos} className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className={`inline-block w-2.5 h-2.5 rounded-sm ${POSITION_COLORS[pos] ?? 'bg-blue-400'}`} />
                  {pos}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Users */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Users</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Registered Users" value={metrics.users.total.toLocaleString()} />
          <StatCard
            label="Digest Opt-ins"
            value={metrics.users.digest_opted_in.toLocaleString()}
            sub={metrics.users.total ? `${Math.round(metrics.users.digest_opted_in / metrics.users.total * 100)}% of users` : undefined}
          />
          <StatCard label="Total Bill Saves" value={metrics.tracking.total_saves.toLocaleString()} />
        </div>
      </section>
    </div>
  )
}
