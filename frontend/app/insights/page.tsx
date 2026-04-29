'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface YearStatusRow {
  year: number
  total: number
  introduced: number
  in_committee: number
  signed_into_law: number
  failed: number
  vetoed: number
  withdrawn: number
  tabled: number
  other: number
}

interface TagYearRow {
  year: number
  [tag: string]: number
}

interface Summary {
  total_bills: number
  active_bills: number
  bills_this_year: number
  signed_into_law: number
  years_from: number
  years_to: number
}

// ── Colors ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; dark: string; label: string }> = {
  introduced:      { bg: '#3b82f6', dark: '#60a5fa', label: 'Introduced' },
  in_committee:    { bg: '#f59e0b', dark: '#fbbf24', label: 'In Committee' },
  signed_into_law: { bg: '#10b981', dark: '#34d399', label: 'Signed into Law' },
  failed:          { bg: '#ef4444', dark: '#f87171', label: 'Failed' },
  vetoed:          { bg: '#f97316', dark: '#fb923c', label: 'Vetoed' },
  withdrawn:       { bg: '#8b5cf6', dark: '#a78bfa', label: 'Withdrawn' },
  tabled:          { bg: '#6b7280', dark: '#9ca3af', label: 'Tabled' },
}

const TAG_PALETTE = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#f97316','#06b6d4','#ec4899','#84cc16','#6b7280',
]

const CURRENT_YEAR = new Date().getFullYear()

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-2xl font-bold tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      <div className="text-sm font-medium mt-0.5">{label}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Status Funnel Chart ───────────────────────────────────────────────────────
// X axis = status stages in funnel order, one year at a time via dropdown
// Terminal statuses (failed/vetoed/withdrawn/tabled) are bucketed as "not_passed"

const FUNNEL_STAGES = ['introduced', 'in_committee', 'signed_into_law', 'not_passed'] as const
type FunnelStage = typeof FUNNEL_STAGES[number]

// Which raw statuses map to each funnel bucket for the search API
const FUNNEL_STATUS_MAP: Record<FunnelStage, string> = {
  introduced:      'introduced',
  in_committee:    'in_committee',
  signed_into_law: 'signed_into_law',
  not_passed:      'failed,vetoed,withdrawn,tabled',
}

const FUNNEL_LABELS: Record<FunnelStage, string> = {
  introduced:      'Introduced',
  in_committee:    'In Committee',
  signed_into_law: 'Signed into Law',
  not_passed:      'Not Passed',
}

const FUNNEL_COLORS: Record<FunnelStage, string> = {
  introduced:      '#3b82f6',
  in_committee:    '#f59e0b',
  signed_into_law: '#10b981',
  not_passed:      '#6b7280',
}

const CHART_W = 700
const CHART_H = 220
const PAD = { top: 20, right: 16, bottom: 36, left: 48 }
const PAGE_SIZE = 20

interface BillRow {
  id: string
  bill_number: string
  plain_title: string | null
  title: string
  status: string
  introduced_date: string | null
  impact_level: string | null
}

function bucketRow(row: YearStatusRow): Record<FunnelStage, number> {
  return {
    introduced:      row.introduced || 0,
    in_committee:    row.in_committee || 0,
    signed_into_law: row.signed_into_law || 0,
    not_passed:      (row.failed || 0) + (row.vetoed || 0) + (row.withdrawn || 0) + (row.tabled || 0),
  }
}

function StatusFunnelChart({
  data,
  selectedYear,
  onYearChange,
}: {
  data: YearStatusRow[]
  selectedYear: number | null
  onYearChange: (year: number) => void
}) {
  const router = useRouter()
  const [tooltip, setTooltip] = useState<{ x: number; y: number; stage: FunnelStage; count: number } | null>(null)
  const [selectedStage, setSelectedStage] = useState<FunnelStage | null>(null)
  const [bills, setBills] = useState<BillRow[]>([])
  const [billsTotal, setBillsTotal] = useState(0)
  const [billsPage, setBillsPage] = useState(0)
  const [billsLoading, setBillsLoading] = useState(false)

  const activeYear = selectedYear ?? data[data.length - 1]?.year

  // Reset drill-down when year changes
  useEffect(() => { setSelectedStage(null); setBills([]); setBillsTotal(0); setBillsPage(0) }, [activeYear])

  // Fetch bills when stage/page changes
  useEffect(() => {
    if (!selectedStage || !activeYear) return
    setBillsLoading(true)
    api.searchLegislation(
      '', PAGE_SIZE, billsPage * PAGE_SIZE, 'local', '', '', '', activeYear,
      0, FUNNEL_STATUS_MAP[selectedStage]
    )
      .then(d => {
        if (!d?.success) return
        setBills(d.results ?? [])
        setBillsTotal(d.total ?? 0)
      })
      .catch(() => {})
      .finally(() => setBillsLoading(false))
  }, [selectedStage, activeYear, billsPage])

  if (!data.length) return (
    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading…</div>
  )

  const row = data.find(r => r.year === activeYear)
  const bucketed = row ? bucketRow(row) : null

  const innerW = CHART_W - PAD.left - PAD.right
  const innerH = CHART_H - PAD.top - PAD.bottom

  const maxVal = bucketed ? Math.max(...FUNNEL_STAGES.map(s => bucketed[s]), 1) : 1
  const xPos = (i: number) => (i / (FUNNEL_STAGES.length - 1)) * innerW
  const yPos = (val: number) => innerH - (val / maxVal) * innerH
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(f * maxVal))

  const handleStageClick = (stage: FunnelStage) => {
    setSelectedStage(prev => prev === stage ? null : stage)
    setBillsPage(0)
  }

  return (
    <div className="space-y-3">
      {/* Year selector */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Year</span>
        <select
          value={activeYear}
          onChange={e => onYearChange(Number(e.target.value))}
          className="rounded border bg-background px-2 py-1 text-sm"
        >
          {[...data].reverse().map(r => (
            <option key={r.year} value={r.year}>{r.year}</option>
          ))}
        </select>
        {row && <span className="text-xs text-muted-foreground">{row.total.toLocaleString()} bills total</span>}
      </div>

      {bucketed && (
        <>
          {/* SVG chart */}
          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              className="w-full"
              style={{ minWidth: 400 }}
              onMouseLeave={() => setTooltip(null)}
            >
              <g transform={`translate(${PAD.left},${PAD.top})`}>
                {yTicks.map(tick => (
                  <g key={tick}>
                    <line x1={0} x2={innerW} y1={yPos(tick)} y2={yPos(tick)}
                      stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} />
                    <text x={-6} y={yPos(tick) + 4} textAnchor="end"
                      fontSize={10} fill="currentColor" fillOpacity={0.45}>
                      {tick >= 1000 ? `${(tick / 1000).toFixed(tick % 1000 === 0 ? 0 : 1)}k` : tick}
                    </text>
                  </g>
                ))}

                {FUNNEL_STAGES.map((s, i) => (
                  <text key={s} x={xPos(i)} y={innerH + 20}
                    textAnchor={i === 0 ? 'start' : i === FUNNEL_STAGES.length - 1 ? 'end' : 'middle'}
                    fontSize={10} fill={selectedStage === s ? FUNNEL_COLORS[s] : 'currentColor'}
                    fillOpacity={selectedStage === s ? 1 : 0.55} fontWeight={selectedStage === s ? 600 : 400}>
                    {FUNNEL_LABELS[s]}
                  </text>
                ))}

                {FUNNEL_STAGES.map((s, i) => (
                  <line key={s} x1={xPos(i)} x2={xPos(i)} y1={0} y2={innerH}
                    stroke="currentColor" strokeOpacity={0.06} strokeWidth={1} />
                ))}

                <path
                  d={FUNNEL_STAGES.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i)} ${yPos(bucketed[s])}`).join(' ')}
                  fill="none" stroke="#6366f1" strokeWidth={2}
                  strokeLinejoin="round" strokeLinecap="round"
                />

                {FUNNEL_STAGES.map((s, i) => (
                  <circle
                    key={s}
                    cx={xPos(i)} cy={yPos(bucketed[s])}
                    r={selectedStage === s ? 7 : tooltip?.stage === s ? 6 : 4.5}
                    fill={FUNNEL_COLORS[s]}
                    stroke={selectedStage === s ? 'var(--background)' : 'var(--background)'}
                    strokeWidth={selectedStage === s ? 2.5 : 1.5}
                    style={{ cursor: 'pointer', transition: 'r 100ms ease' }}
                    onMouseEnter={(e) => {
                      const svg = (e.target as SVGElement).closest('svg')!
                      const rect = svg.getBoundingClientRect()
                      const svgX = ((xPos(i) + PAD.left) / CHART_W) * rect.width + rect.left
                      const svgY = ((yPos(bucketed[s]) + PAD.top) / CHART_H) * rect.height + rect.top
                      setTooltip({ x: svgX, y: svgY, stage: s, count: bucketed[s] })
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={() => handleStageClick(s)}
                  />
                ))}
              </g>
            </svg>
          </div>

          {/* Breakdown cards — clickable */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {FUNNEL_STAGES.map(s => (
              <button
                key={s}
                onClick={() => handleStageClick(s)}
                className={`rounded-lg border p-3 text-left transition-all ${
                  selectedStage === s
                    ? 'border-foreground/40 bg-muted shadow-sm'
                    : 'bg-muted/30 hover:bg-muted/60'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: FUNNEL_COLORS[s] }} />
                  <span className="text-xs text-muted-foreground">{FUNNEL_LABELS[s]}</span>
                </div>
                <div className="text-xl font-bold tabular-nums">{bucketed[s].toLocaleString()}</div>
                {row && row.total > 0 && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {Math.round((bucketed[s] / row.total) * 100)}% of total
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Bill drill-down panel */}
          {selectedStage && (
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: FUNNEL_COLORS[selectedStage] }} />
                  <span className="font-medium text-sm">{FUNNEL_LABELS[selectedStage]} — {activeYear}</span>
                  {billsTotal > 0 && (
                    <span className="text-xs text-muted-foreground">({billsTotal.toLocaleString()} bills)</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => router.push(`/legislation?year=${activeYear}&status=${encodeURIComponent(FUNNEL_STATUS_MAP[selectedStage])}`)}
                    className="text-xs text-primary hover:underline"
                  >
                    View all →
                  </button>
                  <button onClick={() => setSelectedStage(null)} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
                </div>
              </div>

              {billsLoading ? (
                <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">Loading…</div>
              ) : bills.length === 0 ? (
                <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">No bills found.</div>
              ) : (
                <>
                  <ul className="divide-y">
                    {bills.map(bill => (
                      <li key={bill.id}>
                        <a
                          href={`/legislation/${bill.id}`}
                          className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono text-muted-foreground shrink-0">{bill.bill_number}</span>
                              {bill.impact_level && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{bill.impact_level}</span>
                              )}
                            </div>
                            <p className="text-sm mt-0.5 leading-snug line-clamp-2">
                              {bill.plain_title || bill.title}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0 mt-1">
                            {bill.introduced_date ? new Date(bill.introduced_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ''}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>

                  {/* Pagination */}
                  {billsTotal > PAGE_SIZE && (
                    <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
                      <span>
                        {billsPage * PAGE_SIZE + 1}–{Math.min((billsPage + 1) * PAGE_SIZE, billsTotal)} of {billsTotal.toLocaleString()}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setBillsPage(p => Math.max(0, p - 1))}
                          disabled={billsPage === 0}
                          className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-muted transition-colors"
                        >← Prev</button>
                        <button
                          onClick={() => setBillsPage(p => p + 1)}
                          disabled={(billsPage + 1) * PAGE_SIZE >= billsTotal}
                          className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-muted transition-colors"
                        >Next →</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 rounded-lg border bg-popover shadow-md px-3 py-2 text-sm pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 36 }}
        >
          <span>{FUNNEL_LABELS[tooltip.stage]}</span>
          <span className="text-muted-foreground mx-1">·</span>
          <span className="font-semibold tabular-nums">{tooltip.count.toLocaleString()}</span>
          <span className="text-muted-foreground text-xs ml-1">click to browse</span>
        </div>
      )}
    </div>
  )
}

// ── Tag Spark Chart ───────────────────────────────────────────────────────────

function TagSparkChart({ tag, data, color }: { tag: string; data: TagYearRow[]; color: string }) {
  const points = data.map(r => ({ year: r.year, count: (r[tag] as number) ?? 0 }))
  const maxVal = Math.max(...points.map(p => p.count), 1)
  const peakCount = maxVal
  const peakYear = points.find(p => p.count === peakCount)?.year

  // Taller chart with room for value labels above dots and year labels below
  const W = 600, H = 110, PL = 12, PR = 12, PT = 22, PB = 22
  const iW = W - PL - PR
  const iH = H - PT - PB
  const n = points.length
  const xPos = (i: number) => PL + (i / Math.max(n - 1, 1)) * iW
  const yPos = (v: number) => PT + iH - (v / maxVal) * iH
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i)} ${yPos(p.count)}`).join(' ')

  return (
    <div className="rounded-lg border bg-muted/20 p-3 mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium capitalize">{tag.replace(/-/g, ' ')} — all years</span>
        <span className="text-xs text-muted-foreground">
          peak {peakCount} in {peakYear}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* Area fill */}
        <path
          d={`${pathD} L ${xPos(n - 1)} ${PT + iH} L ${xPos(0)} ${PT + iH} Z`}
          fill={color} fillOpacity={0.1}
        />
        {/* Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        {/* Dots + value labels + year labels */}
        {points.map((p, i) => (
          <g key={p.year}>
            {p.count > 0 && (
              <>
                <circle cx={xPos(i)} cy={yPos(p.count)} r={3} fill={color} stroke="var(--background)" strokeWidth={1.5} />
                {/* Value above dot — skip if 0, nudge left/right at edges */}
                <text
                  x={xPos(i)}
                  y={yPos(p.count) - 6}
                  textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                  fontSize={8}
                  fill={color}
                  fillOpacity={0.85}
                  fontWeight={p.count === peakCount ? 700 : 400}
                >
                  {p.count}
                </text>
              </>
            )}
            {/* Year label below */}
            <text
              x={xPos(i)}
              y={H - 4}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              fontSize={8}
              fill="currentColor"
              fillOpacity={0.4}
            >
              {p.year}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ── Tag Trends Chart ──────────────────────────────────────────────────────────
// Shows top tags for the currently selected year as horizontal bars.
// Click a tag to filter the status chart and see its full history spark.

function TagTrendsChart({
  year, data, tags, selectedTag, onTagClick,
}: {
  year: number
  data: TagYearRow[]
  tags: string[]
  selectedTag: string
  onTagClick: (tag: string) => void
}) {
  const row = data.find(r => r.year === year)
  const items = tags
    .map((tag, i) => ({ tag, count: row?.[tag] ?? 0, color: TAG_PALETTE[i % TAG_PALETTE.length] }))
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count)

  if (!data.length) return (
    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading...</div>
  )

  if (!items.length) return (
    <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">No tag data for {year}.</div>
  )

  const maxVal = items[0].count
  const selectedItem = items.find(t => t.tag === selectedTag)

  return (
    <div className="space-y-1.5">
      {items.map(({ tag, count, color }) => {
        const isSelected = selectedTag === tag
        return (
          <button
            key={tag}
            onClick={() => onTagClick(tag)}
            className={`w-full flex items-center gap-3 rounded-md px-1 py-0.5 transition-colors ${
              isSelected ? 'bg-muted' : 'hover:bg-muted/50'
            }`}
          >
            <div className={`w-28 shrink-0 text-xs text-right capitalize truncate ${isSelected ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
              {tag.replace(/-/g, ' ')}
            </div>
            <div className="flex-1 h-5 rounded-sm overflow-hidden bg-muted/40">
              <div
                className="h-full rounded-sm transition-all duration-300"
                style={{
                  width: `${(count / maxVal) * 100}%`,
                  backgroundColor: color,
                  opacity: selectedTag && !isSelected ? 0.4 : 1,
                }}
              />
            </div>
            <div className={`w-10 shrink-0 text-xs tabular-nums text-right ${isSelected ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
              {count}
            </div>
          </button>
        )
      })}

      {selectedItem && (
        <TagSparkChart tag={selectedItem.tag} data={data} color={selectedItem.color} />
      )}
    </div>
  )
}


// ── Page ──────────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const router = useRouter()
  const [summary, setSummary]           = useState<Summary | null>(null)
  const [statusData, setStatusData]     = useState<YearStatusRow[]>([])
  const [tagData, setTagData]           = useState<TagYearRow[]>([])
  const [tags, setTags]                 = useState<string[]>([])
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [tagFilter, setTagFilter]       = useState('')
  const [selectedTag, setSelectedTag]   = useState('')

  const loadStatusData = useCallback(() => {
    api.getInsightsStatusByYear({ tag: tagFilter || undefined })
      .then(d => {
        if (!d) return
        setStatusData(d.years ?? [])
      })
      .catch(() => {})
  }, [tagFilter])

  const loadTagData = useCallback(() => {
    api.getInsightsTagByYear({ top_n: 10 })
      .then(d => {
        if (!d) return
        setTagData(d.years ?? [])
        setTags(d.tags ?? [])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    api.getInsightsSummary().then(d => d && setSummary(d)).catch(() => {})
  }, [])

  useEffect(() => { loadStatusData() }, [loadStatusData])
  useEffect(() => { loadTagData() },    [loadTagData])

  const handleYearChange = (year: number) => {
    setSelectedYear(year)
  }

  const handleTagClick = (tag: string) => {
    const next = selectedTag === tag ? '' : tag
    setSelectedTag(next)
    setTagFilter(next)
  }

  const handleDrillDown = () => {
    const year = selectedYear ?? statusData[statusData.length - 1]?.year
    if (!year) return
    const params = new URLSearchParams({ year: String(year) })
    if (tagFilter) params.set('tag', tagFilter)
    router.push(`/legislation?${params.toString()}`)
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Council Insights</h1>
        <p className="text-muted-foreground mt-1">
          Explore Philadelphia City Council legislative activity
          {summary ? ` from ${summary.years_from} to ${summary.years_to}` : ''}.
        </p>
      </div>

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Bills" value={summary.total_bills} sub="all time" />
          <StatCard label="Active Now" value={summary.active_bills} sub="introduced or in committee" />
          <StatCard label="This Year" value={summary.bills_this_year} sub={`introduced in ${CURRENT_YEAR}`} />
          <StatCard label="Signed into Law" value={summary.signed_into_law} sub="all time" />
        </div>
      )}

      {/* Status funnel */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">Bill Status by Year</h2>
            {selectedTag && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted border">
                <span className="capitalize">{selectedTag.replace(/-/g, ' ')}</span>
                <button onClick={() => handleTagClick(selectedTag)} className="text-muted-foreground hover:text-foreground ml-0.5">×</button>
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            See how bills flow through the legislative process — and where they get stuck.
            {!selectedTag && ' Click a tag below to filter.'}
          </p>
        </div>

        <StatusFunnelChart
          data={statusData}
          selectedYear={selectedYear}
          onYearChange={handleYearChange}
        />

        <button
          onClick={handleDrillDown}
          className="text-sm text-primary hover:underline"
        >
          View all {(selectedYear ?? statusData[statusData.length - 1]?.year)} bills →
        </button>
      </div>

      {/* Tag trends */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Top Issues — {selectedYear ?? statusData[statusData.length - 1]?.year}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Click a tag to filter the status chart above and see its full history.
          </p>
        </div>

        <TagTrendsChart
          year={selectedYear ?? statusData[statusData.length - 1]?.year ?? CURRENT_YEAR}
          data={tagData}
          tags={tags}
          selectedTag={selectedTag}
          onTagClick={handleTagClick}
        />
      </div>

    </div>
  )
}
