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
const DEFAULT_FROM = CURRENT_YEAR - 3

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

// ── Tag Trends Chart ──────────────────────────────────────────────────────────

function TagTrendsChart({ data, tags }: { data: TagYearRow[]; tags: string[] }) {
  const [hovered, setHovered] = useState<string | null>(null)

  if (!data.length) return (
    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading...</div>
  )

  const maxVal = Math.max(...data.flatMap(row => tags.map(t => row[t] ?? 0)), 1)

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {tags.map((tag, i) => (
          <button
            key={tag}
            className="flex items-center gap-1.5 text-xs transition-opacity"
            style={{ opacity: hovered && hovered !== tag ? 0.4 : 1 }}
            onMouseEnter={() => setHovered(tag)}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: TAG_PALETTE[i % TAG_PALETTE.length] }} />
            <span className="text-muted-foreground capitalize">{tag.replace(/-/g, ' ')}</span>
          </button>
        ))}
      </div>

      {/* Grouped bars by year */}
      <div className="flex items-end gap-3" style={{ height: 200 }}>
        {data.map(row => (
          <div key={row.year} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div className="w-full flex items-end gap-px" style={{ height: 180 }}>
              {tags.map((tag, i) => {
                const val = row[tag] ?? 0
                const barH = Math.max((val / maxVal) * 160, val > 0 ? 2 : 0)
                return (
                  <div
                    key={tag}
                    className="flex-1 rounded-t-sm transition-all"
                    style={{
                      height: barH,
                      backgroundColor: TAG_PALETTE[i % TAG_PALETTE.length],
                      opacity: hovered && hovered !== tag ? 0.2 : 1,
                      transition: 'opacity 150ms ease',
                    }}
                    title={`${row.year} — ${tag.replace(/-/g, ' ')}: ${val.toLocaleString()}`}
                  />
                )
              })}
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">{row.year}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Year Range Picker ─────────────────────────────────────────────────────────

function YearRangePicker({
  fromYear, toYear, allFrom, onChange,
}: {
  fromYear: number
  toYear: number
  allFrom: number
  onChange: (from: number, to: number) => void
}) {
  const expanded = fromYear <= allFrom + 2

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Showing</span>
      <select
        value={fromYear}
        onChange={e => onChange(Number(e.target.value), toYear)}
        className="rounded border bg-background px-2 py-1 text-sm"
      >
        {Array.from({ length: toYear - allFrom + 1 }, (_, i) => allFrom + i).map(y => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      <span className="text-muted-foreground">–</span>
      <span className="font-medium">{toYear}</span>
      {!expanded && (
        <button
          onClick={() => onChange(allFrom, toYear)}
          className="text-xs text-primary hover:underline ml-1"
        >
          Show all years ({allFrom}–{toYear})
        </button>
      )}
      {expanded && fromYear > allFrom && (
        <button
          onClick={() => onChange(CURRENT_YEAR - 3, toYear)}
          className="text-xs text-muted-foreground hover:text-foreground ml-1"
        >
          ← Last 4 years
        </button>
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
  const [fromYear, setFromYear]         = useState(DEFAULT_FROM)
  const [toYear]                        = useState(CURRENT_YEAR)
  const [allFrom, setAllFrom]           = useState(DEFAULT_FROM)
  const [tagFilter, setTagFilter]       = useState('')

  const loadStatusData = useCallback(() => {
    api.getInsightsStatusByYear({ tag: tagFilter || undefined })
      .then(d => {
        if (!d) return
        setStatusData(d.years ?? [])
        if (d.all_from_year) setAllFrom(d.all_from_year)
      })
      .catch(() => {})
  }, [tagFilter])

  const loadTagData = useCallback(() => {
    api.getInsightsTagByYear({ from_year: fromYear, to_year: toYear, top_n: 10 })
      .then(d => {
        if (!d) return
        setTagData(d.years ?? [])
        setTags(d.tags ?? [])
      })
      .catch(() => {})
  }, [fromYear, toYear])

  useEffect(() => {
    api.getInsightsSummary().then(d => d && setSummary(d)).catch(() => {})
  }, [])

  useEffect(() => { loadStatusData() }, [loadStatusData])
  useEffect(() => { loadTagData() },    [loadTagData])

  const handleYearChange = (year: number) => {
    setSelectedYear(year)
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Bill Status by Year</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              See how bills flow through the legislative process — and where they get stuck.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter by tag…"
              value={tagFilter}
              onChange={e => setTagFilter(e.target.value)}
              className="rounded border bg-background px-2 py-1 text-sm w-36"
            />
          </div>
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
          <h2 className="text-lg font-semibold">Top Issues by Year</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Which topics dominated each council session.
          </p>
        </div>

        <YearRangePicker
          fromYear={fromYear}
          toYear={toYear}
          allFrom={allFrom}
          onChange={(f) => { setFromYear(f) }}
        />

        <TagTrendsChart data={tagData} tags={tags} />
      </div>

    </div>
  )
}
