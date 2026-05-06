'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { api } from '@/lib/api'
import DrillDownPanel, { DrillDownSearchParams } from '@/components/insights/DrillDownPanel'

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
  bills_last_year: number
  signed_into_law: number
  pass_rate: number
  avg_impact_score: number | null
  years_from: number
  years_to: number
  last_fetched_at?: string | null
}

interface NarrativeData {
  generated_at: string | null
  years_covered: { from: number; to: number }
  total_bills: number
  key_stats: { label: string; value: string; note?: string }[]
  narrative: string | null
  top_issues: { tag: string; count: number }[]
}

interface ImpactYearRow {
  year: number
  total: number
  bill_type: { substantive: number; ceremonial: number; procedural: number; unknown: number }
  impact_level: { high: number; medium: number; low: number }
}

interface SponsorRow {
  sponsor: string
  total: number
  signed_into_law: number
  not_passed: number
  pass_rate: number
  avg_impact_score: number | null
}

// ── Colors ───────────────────────────────────────────────────────────────────

const FUNNEL_COLORS: Record<string, string> = {
  introduced:      '#3b82f6',
  in_committee:    '#f59e0b',
  signed_into_law: '#10b981',
  not_passed:      '#6b7280',
}

const BILL_TYPE_COLORS: Record<string, string> = {
  substantive: '#3b82f6',
  ceremonial:  '#f59e0b',
  procedural:  '#6b7280',
  unknown:     '#d1d5db',
}

const IMPACT_COLORS_PIE: Record<string, string> = {
  high:   '#ef4444',
  medium: '#f59e0b',
  low:    '#10b981',
}

const TAG_PALETTE = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#f97316','#06b6d4','#ec4899','#84cc16','#6b7280',
]

const IMPACT_BADGE: Record<string, string> = {
  high:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  low:    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

const CURRENT_YEAR = new Date().getFullYear()

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(n: number, total: number) {
  if (!total) return '0%'
  return `${Math.round((n / total) * 100)}%`
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      {accent && <div className="text-xs font-medium mb-1" style={{ color: accent }}>{label}</div>}
      <div className="text-2xl font-bold tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {!accent && <div className="text-sm font-medium mt-0.5">{label}</div>}
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Status Funnel Chart ───────────────────────────────────────────────────────

const FUNNEL_STAGES = ['introduced', 'in_committee', 'signed_into_law', 'not_passed'] as const
type FunnelStage = typeof FUNNEL_STAGES[number]

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
  data, selectedYear, onYearChange,
}: {
  data: YearStatusRow[]
  selectedYear: number | null
  onYearChange: (year: number) => void
}) {
  const router = useRouter()
  const { city } = useParams<{ city: string }>()
  const [tooltip, setTooltip] = useState<{ x: number; y: number; stage: FunnelStage; count: number } | null>(null)
  const [selectedStage, setSelectedStage] = useState<FunnelStage | null>(null)
  const [bills, setBills] = useState<BillRow[]>([])
  const [billsTotal, setBillsTotal] = useState(0)
  const [billsPage, setBillsPage] = useState(0)
  const [billsLoading, setBillsLoading] = useState(false)

  const activeYear = selectedYear ?? data[data.length - 1]?.year

  useEffect(() => { setSelectedStage(null); setBills([]); setBillsTotal(0); setBillsPage(0) }, [activeYear])

  useEffect(() => {
    if (!selectedStage || !activeYear) return
    setBillsLoading(true)
    api.searchLegislation('', PAGE_SIZE, billsPage * PAGE_SIZE, 'local', '', '', '', activeYear, 0, FUNNEL_STATUS_MAP[selectedStage])
      .then(d => { if (!d?.success) return; setBills(d.results ?? []); setBillsTotal(d.total ?? 0) })
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
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Year</span>
        <select value={activeYear} onChange={e => onYearChange(Number(e.target.value))}
          className="rounded border bg-background px-2 py-1 text-sm">
          {[...data].reverse().map(r => <option key={r.year} value={r.year}>{r.year}</option>)}
        </select>
        {row && <span className="text-xs text-muted-foreground">{row.total.toLocaleString()} bills total</span>}
      </div>

      {bucketed && (
        <>
          <div className="w-full overflow-x-auto">
            <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" style={{ minWidth: 400 }}
              onMouseLeave={() => setTooltip(null)}>
              <g transform={`translate(${PAD.left},${PAD.top})`}>
                {yTicks.map(tick => (
                  <g key={tick}>
                    <line x1={0} x2={innerW} y1={yPos(tick)} y2={yPos(tick)} stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} />
                    <text x={-6} y={yPos(tick) + 4} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.45}>
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
                  <line key={s} x1={xPos(i)} x2={xPos(i)} y1={0} y2={innerH} stroke="currentColor" strokeOpacity={0.06} strokeWidth={1} />
                ))}
                <path
                  d={FUNNEL_STAGES.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i)} ${yPos(bucketed[s])}`).join(' ')}
                  fill="none" stroke="#6366f1" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                />
                {FUNNEL_STAGES.map((s, i) => (
                  <circle key={s} cx={xPos(i)} cy={yPos(bucketed[s])}
                    r={selectedStage === s ? 7 : tooltip?.stage === s ? 6 : 4.5}
                    fill={FUNNEL_COLORS[s]} stroke="var(--background)"
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

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {FUNNEL_STAGES.map(s => (
              <button key={s} onClick={() => handleStageClick(s)}
                className={`rounded-lg border p-3 text-left transition-all ${selectedStage === s ? 'border-foreground/40 bg-muted shadow-sm' : 'bg-muted/30 hover:bg-muted/60'}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: FUNNEL_COLORS[s] }} />
                  <span className="text-xs text-muted-foreground">{FUNNEL_LABELS[s]}</span>
                </div>
                <div className="text-xl font-bold tabular-nums">{bucketed[s].toLocaleString()}</div>
                {row && row.total > 0 && (
                  <div className="text-xs text-muted-foreground mt-0.5">{Math.round((bucketed[s] / row.total) * 100)}% of total</div>
                )}
              </button>
            ))}
          </div>

          {selectedStage && (
            <div className="rounded-lg border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: FUNNEL_COLORS[selectedStage] }} />
                  <span className="font-medium text-sm">{FUNNEL_LABELS[selectedStage]} — {activeYear}</span>
                  {billsTotal > 0 && <span className="text-xs text-muted-foreground">({billsTotal.toLocaleString()} bills)</span>}
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => router.push(`/${city}/legislation?year=${activeYear}&status=${encodeURIComponent(FUNNEL_STATUS_MAP[selectedStage])}`)}
                    className="text-xs text-primary hover:underline">View all →</button>
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
                        <a href={`/${city}/legislation/${bill.id}`}
                          className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-mono text-muted-foreground shrink-0">{bill.bill_number}</span>
                              {bill.impact_level && (
                                <span className={`text-xs px-1.5 py-0.5 rounded-full ${IMPACT_BADGE[bill.impact_level] ?? 'bg-muted text-muted-foreground'}`}>{bill.impact_level}</span>
                              )}
                            </div>
                            <p className="text-sm mt-0.5 leading-snug line-clamp-2">{bill.plain_title || bill.title}</p>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0 mt-1">
                            {bill.introduced_date ? new Date(bill.introduced_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ''}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                  {billsTotal > PAGE_SIZE && (
                    <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
                      <span>{billsPage * PAGE_SIZE + 1}–{Math.min((billsPage + 1) * PAGE_SIZE, billsTotal)} of {billsTotal.toLocaleString()}</span>
                      <div className="flex gap-2">
                        <button onClick={() => setBillsPage(p => Math.max(0, p - 1))} disabled={billsPage === 0}
                          className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-muted transition-colors">← Prev</button>
                        <button onClick={() => setBillsPage(p => p + 1)} disabled={(billsPage + 1) * PAGE_SIZE >= billsTotal}
                          className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-muted transition-colors">Next →</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {tooltip && (
        <div className="fixed z-50 rounded-lg border bg-popover shadow-md px-3 py-2 text-sm pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 36 }}>
          <span>{FUNNEL_LABELS[tooltip.stage]}</span>
          <span className="text-muted-foreground mx-1">·</span>
          <span className="font-semibold tabular-nums">{tooltip.count.toLocaleString()}</span>
          <span className="text-muted-foreground text-xs ml-1">click to browse</span>
        </div>
      )}
    </div>
  )
}

// ── Donut Chart ───────────────────────────────────────────────────────────────

function DonutChart({
  segments, size = 120, selectedKey, onSelect,
}: {
  segments: { key: string; label: string; value: number; color: string }[]
  size?: number
  selectedKey?: string
  onSelect: (key: string) => void
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  if (!total) return <div className="flex items-center justify-center h-24 text-xs text-muted-foreground">No data</div>

  const cx = size / 2, cy = size / 2, r = size * 0.38, inner = size * 0.22
  let cumAngle = -Math.PI / 2

  const paths = segments.map(seg => {
    const angle = (seg.value / total) * 2 * Math.PI
    const startAngle = cumAngle
    const endAngle = cumAngle + angle
    cumAngle = endAngle

    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle),   y2 = cy + r * Math.sin(endAngle)
    const xi1 = cx + inner * Math.cos(startAngle), yi1 = cy + inner * Math.sin(startAngle)
    const xi2 = cx + inner * Math.cos(endAngle),   yi2 = cy + inner * Math.sin(endAngle)
    const large = angle > Math.PI ? 1 : 0
    const d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${inner} ${inner} 0 ${large} 0 ${xi1} ${yi1} Z`
    return { ...seg, d, angle }
  })

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[140px]">
      {paths.map(p => (
        <path key={p.key} d={p.d} fill={p.color}
          opacity={selectedKey && selectedKey !== p.key ? 0.35 : 1}
          strokeWidth={selectedKey === p.key ? 1.5 : 0.5}
          stroke="var(--background)"
          style={{ cursor: 'pointer', transition: 'opacity 150ms' }}
          onClick={() => onSelect(p.key)}
        />
      ))}
      <text x={cx} y={cy + 3} textAnchor="middle" fontSize={11} fontWeight={600} fill="currentColor">
        {total.toLocaleString()}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize={7} fill="currentColor" fillOpacity={0.5}>total</text>
    </svg>
  )
}

// ── Impact Distribution ───────────────────────────────────────────────────────

function ImpactDistributionSection({ years }: { years: ImpactYearRow[] }) {
  const { city } = useParams<{ city: string }>()
  const [activeYear, setActiveYear] = useState<number | null>(null)
  const [drillDown, setDrillDown] = useState<{ params: DrillDownSearchParams; title: string; href: string } | null>(null)

  const yearList = [...years].reverse()
  const year = activeYear ?? yearList[0]?.year
  const row = years.find(r => r.year === year)

  const btSegs = row ? [
    { key: 'substantive', label: 'Substantive', value: row.bill_type.substantive, color: BILL_TYPE_COLORS.substantive },
    { key: 'ceremonial',  label: 'Ceremonial',  value: row.bill_type.ceremonial,  color: BILL_TYPE_COLORS.ceremonial },
    { key: 'procedural',  label: 'Procedural',  value: row.bill_type.procedural,  color: BILL_TYPE_COLORS.procedural },
  ] : []

  const ilSegs = row ? [
    { key: 'high',   label: 'High',   value: row.impact_level.high,   color: IMPACT_COLORS_PIE.high },
    { key: 'medium', label: 'Medium', value: row.impact_level.medium, color: IMPACT_COLORS_PIE.medium },
    { key: 'low',    label: 'Low',    value: row.impact_level.low,    color: IMPACT_COLORS_PIE.low },
  ] : []

  if (!years.length) return (
    <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">Loading…</div>
  )

  const handleBtClick = (key: string) => {
    if (drillDown?.params.billType === key) { setDrillDown(null); return }
    setDrillDown({
      params: { billType: key, year },
      title: `${key.charAt(0).toUpperCase() + key.slice(1)} Bills — ${year}`,
      href: `/${city}/legislation?year=${year}&bill_type=${key}`,
    })
  }

  const handleIlClick = (key: string) => {
    if (drillDown?.params.impact === key) { setDrillDown(null); return }
    setDrillDown({
      params: { impact: key, year },
      title: `${key.charAt(0).toUpperCase() + key.slice(1)} Impact Bills — ${year}`,
      href: `/${city}/legislation?year=${year}&impact=${key}`,
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Year</span>
        <select value={year} onChange={e => { setActiveYear(Number(e.target.value)); setDrillDown(null) }}
          className="rounded border bg-background px-2 py-1 text-sm">
          {yearList.map(r => <option key={r.year} value={r.year}>{r.year}</option>)}
        </select>
        {row && <span className="text-xs text-muted-foreground">{row.total.toLocaleString()} analyzed bills</span>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Bill Type donut */}
        <div>
          <div className="text-sm font-medium mb-3">Bill Type</div>
          <div className="flex items-center gap-4">
            <DonutChart segments={btSegs} size={130} selectedKey={drillDown?.params.billType}
              onSelect={handleBtClick} />
            <div className="space-y-2 flex-1">
              {btSegs.map(s => (
                <button key={s.key} onClick={() => handleBtClick(s.key)}
                  className={`w-full flex items-center gap-2 text-left rounded px-2 py-1 transition-colors ${drillDown?.params.billType === s.key ? 'bg-muted' : 'hover:bg-muted/50'}`}>
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-xs flex-1 capitalize">{s.label}</span>
                  <span className="text-xs font-semibold tabular-nums">{s.value}</span>
                  <span className="text-xs text-muted-foreground">{row ? pct(s.value, row.total) : ''}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Impact Level donut */}
        <div>
          <div className="text-sm font-medium mb-3">Impact Level</div>
          <div className="flex items-center gap-4">
            <DonutChart segments={ilSegs} size={130} selectedKey={drillDown?.params.impact}
              onSelect={handleIlClick} />
            <div className="space-y-2 flex-1">
              {ilSegs.map(s => (
                <button key={s.key} onClick={() => handleIlClick(s.key)}
                  className={`w-full flex items-center gap-2 text-left rounded px-2 py-1 transition-colors ${drillDown?.params.impact === s.key ? 'bg-muted' : 'hover:bg-muted/50'}`}>
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-xs flex-1 capitalize">{s.label}</span>
                  <span className="text-xs font-semibold tabular-nums">{s.value}</span>
                  <span className="text-xs text-muted-foreground">{row ? pct(s.value, row.total) : ''}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {drillDown && (
        <DrillDownPanel
          title={drillDown.title}
          searchParams={drillDown.params}
          viewAllHref={drillDown.href}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  )
}

// ── Bill Type Over Time ───────────────────────────────────────────────────────

function BillTypeOverTimeSection({ years }: { years: ImpactYearRow[] }) {
  const { city } = useParams<{ city: string }>()
  const [drillDown, setDrillDown] = useState<{ params: DrillDownSearchParams; title: string; href: string } | null>(null)

  if (!years.length) return (
    <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">Loading…</div>
  )

  const W = 700, H = 180, PL = 48, PR = 12, PT = 12, PB = 36
  const iW = W - PL - PR, iH = H - PT - PB
  const n = years.length
  const barW = Math.max(8, iW / n - 3)
  const xPos = (i: number) => PL + (i / n) * iW + barW / 2

  const BT_ORDER = ['substantive', 'ceremonial', 'procedural'] as const

  const handleBarClick = (yearVal: number, btKey: string) => {
    const key = `${btKey}-${yearVal}`
    if (drillDown && drillDown.params.billType === btKey && drillDown.params.year === yearVal) {
      setDrillDown(null); return
    }
    setDrillDown({
      params: { billType: btKey, year: yearVal },
      title: `${btKey.charAt(0).toUpperCase() + btKey.slice(1)} Bills — ${yearVal}`,
      href: `/${city}/legislation?year=${yearVal}&bill_type=${btKey}`,
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {BT_ORDER.map(k => (
          <div key={k} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: BILL_TYPE_COLORS[k] }} />
            <span className="capitalize">{k}</span>
          </div>
        ))}
        <span className="ml-1 italic">click a bar to see bills</span>
      </div>

      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 400 }}>
          {[0, 25, 50, 75, 100].map(tick => (
            <g key={tick}>
              <line x1={PL} x2={W - PR} y1={PT + iH - (tick / 100) * iH} y2={PT + iH - (tick / 100) * iH}
                stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} />
              <text x={PL - 6} y={PT + iH - (tick / 100) * iH + 4} textAnchor="end"
                fontSize={9} fill="currentColor" fillOpacity={0.4}>{tick}%</text>
            </g>
          ))}

          {years.map((row, i) => {
            const total = BT_ORDER.reduce((s, k) => s + row.bill_type[k], 0)
            if (!total) return null
            let stackY = PT + iH
            return (
              <g key={row.year}>
                {BT_ORDER.map(k => {
                  const h = (row.bill_type[k] / total) * iH
                  stackY -= h
                  const active = drillDown?.params.billType === k && drillDown?.params.year === row.year
                  return (
                    <rect key={k} x={xPos(i) - barW / 2} y={stackY} width={barW} height={h}
                      fill={BILL_TYPE_COLORS[k]}
                      opacity={drillDown && !active ? 0.5 : 1}
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleBarClick(row.year, k)}
                    />
                  )
                })}
                <text x={xPos(i)} y={PT + iH + 14} textAnchor="middle"
                  fontSize={9} fill="currentColor" fillOpacity={0.5}>{row.year}</text>
              </g>
            )
          })}
        </svg>
      </div>

      {drillDown && (
        <DrillDownPanel
          title={drillDown.title}
          searchParams={drillDown.params}
          viewAllHref={drillDown.href}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  )
}

// ── Sponsor Leaderboard ───────────────────────────────────────────────────────

function SponsorLeaderboard({ yearList }: { yearList: number[] }) {
  const { city } = useParams<{ city: string }>()
  const [activeYear, setActiveYear] = useState(0)
  const [sort, setSort] = useState<'active' | 'effective'>('active')
  const [sponsors, setSponsors] = useState<SponsorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [drillDown, setDrillDown] = useState<{ sponsor: string; year: number } | null>(null)

  useEffect(() => {
    setLoading(true)
    setDrillDown(null)
    api.getInsightsSponsorLeaderboard({ year: activeYear })
      .then((d: any) => { setSponsors(d?.sponsors ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [activeYear])

  const sorted = [...sponsors].sort((a, b) =>
    sort === 'active' ? b.total - a.total : b.pass_rate - a.pass_rate
  )

  const maxTotal = sorted[0]?.total || 1

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Year</span>
          <select value={activeYear} onChange={e => setActiveYear(Number(e.target.value))}
            className="rounded border bg-background px-2 py-1 text-sm">
            <option value={0}>All time</option>
            {yearList.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex rounded border overflow-hidden text-xs">
          {(['active', 'effective'] as const).map(s => (
            <button key={s} onClick={() => setSort(s)}
              className={`px-3 py-1.5 capitalize transition-colors ${sort === s ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}>
              Most {s}
            </button>
          ))}
        </div>
        {sort === 'effective' && <span className="text-xs text-muted-foreground italic">min 3 bills</span>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="text-sm text-muted-foreground">No data.</div>
      ) : (
        <div className="space-y-1">
          {(sort === 'effective' ? sorted.filter(s => s.total >= 3) : sorted).map((sponsor, i) => {
            const isSelected = drillDown?.sponsor === sponsor.sponsor
            return (
              <button key={sponsor.sponsor}
                onClick={() => setDrillDown(isSelected ? null : { sponsor: sponsor.sponsor, year: activeYear })}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${isSelected ? 'bg-muted border border-border' : 'hover:bg-muted/50'}`}>
                <span className="text-xs text-muted-foreground w-5 shrink-0 tabular-nums">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{sponsor.sponsor}</div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary/60 transition-all"
                      style={{ width: `${(sponsor.total / maxTotal) * 100}%` }} />
                  </div>
                </div>
                <div className="text-right shrink-0 space-y-0.5">
                  <div className="text-sm font-semibold tabular-nums">{sponsor.total}</div>
                  <div className="text-xs text-muted-foreground">bills</div>
                </div>
                <div className="text-right shrink-0 space-y-0.5 w-16">
                  <div className="text-sm font-semibold tabular-nums"
                    style={{ color: sponsor.pass_rate > 0.3 ? '#10b981' : sponsor.pass_rate > 0.1 ? '#f59e0b' : '#6b7280' }}>
                    {Math.round(sponsor.pass_rate * 100)}%
                  </div>
                  <div className="text-xs text-muted-foreground">pass rate</div>
                </div>
                {sponsor.avg_impact_score !== null && (
                  <div className="text-right shrink-0 space-y-0.5 w-12">
                    <div className="text-sm font-semibold tabular-nums">{sponsor.avg_impact_score}</div>
                    <div className="text-xs text-muted-foreground">avg impact</div>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}

      {drillDown && (
        <DrillDownPanel
          title={`${drillDown.sponsor}${drillDown.year ? ` — ${drillDown.year}` : ' — All time'}`}
          searchParams={{ sponsor: drillDown.sponsor, year: drillDown.year || undefined }}
          viewAllHref={`/${city}/legislation?sponsor=${encodeURIComponent(drillDown.sponsor)}${drillDown.year ? `&year=${drillDown.year}` : ''}`}
          onClose={() => setDrillDown(null)}
        />
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

  const W = 600, H = 110, PL = 12, PR = 12, PT = 22, PB = 22
  const iW = W - PL - PR, iH = H - PT - PB
  const n = points.length
  const xPos = (i: number) => PL + (i / Math.max(n - 1, 1)) * iW
  const yPos = (v: number) => PT + iH - (v / maxVal) * iH
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i)} ${yPos(p.count)}`).join(' ')

  return (
    <div className="rounded-lg border bg-muted/20 p-3 mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium capitalize">{tag.replace(/-/g, ' ')} — all years</span>
        <span className="text-xs text-muted-foreground">peak {peakCount} in {peakYear}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <path d={`${pathD} L ${xPos(n - 1)} ${PT + iH} L ${xPos(0)} ${PT + iH} Z`} fill={color} fillOpacity={0.1} />
        <path d={pathD} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={p.year}>
            {p.count > 0 && (
              <>
                <circle cx={xPos(i)} cy={yPos(p.count)} r={3} fill={color} stroke="var(--background)" strokeWidth={1.5} />
                <text x={xPos(i)} y={yPos(p.count) - 6}
                  textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                  fontSize={8} fill={color} fillOpacity={0.85}
                  fontWeight={p.count === peakCount ? 700 : 400}>{p.count}</text>
              </>
            )}
            <text x={xPos(i)} y={H - 4}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              fontSize={8} fill="currentColor" fillOpacity={0.4}>{p.year}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ── Tag Trends Chart ──────────────────────────────────────────────────────────

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

  if (!data.length) return <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading...</div>
  if (!items.length) return <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">No tag data for {year}.</div>

  const maxVal = items[0].count
  const selectedItem = items.find(t => t.tag === selectedTag)

  return (
    <div className="space-y-1.5">
      {items.map(({ tag, count, color }) => {
        const isSelected = selectedTag === tag
        return (
          <button key={tag} onClick={() => onTagClick(tag)}
            className={`w-full flex items-center gap-3 rounded-md px-1 py-0.5 transition-colors ${isSelected ? 'bg-muted' : 'hover:bg-muted/50'}`}>
            <div className={`w-28 shrink-0 text-xs text-right capitalize truncate ${isSelected ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
              {tag.replace(/-/g, ' ')}
            </div>
            <div className="flex-1 h-5 rounded-sm overflow-hidden bg-muted/40">
              <div className="h-full rounded-sm transition-all duration-300"
                style={{ width: `${(count / maxVal) * 100}%`, backgroundColor: color, opacity: selectedTag && !isSelected ? 0.4 : 1 }} />
            </div>
            <div className={`w-10 shrink-0 text-xs tabular-nums text-right ${isSelected ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
              {count}
            </div>
          </button>
        )
      })}
      {selectedItem && <TagSparkChart tag={selectedItem.tag} data={data} color={selectedItem.color} />}
    </div>
  )
}

// ── Legislative History (static JSON generated by scripts/generate_legislative_narrative.py) ──

function LegislativeHistorySection() {
  const [data, setData] = useState<NarrativeData | null>(null)

  useEffect(() => {
    fetch('/data/legislative_history.json')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.narrative) setData(d) })
      .catch(() => {})
  }, [])

  if (!data) return null

  const paragraphs = data.narrative!.split(/\n\n+/).filter(Boolean)

  return (
    <div className="rounded-xl border bg-card p-5 space-y-5">
      <div>
        <h2 className="text-lg font-semibold">
          {data.years_covered.to - data.years_covered.from + 1} Years of Philadelphia City Council
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          AI analysis of {data.total_bills.toLocaleString()} bills, {data.years_covered.from}–{data.years_covered.to}
        </p>
      </div>

      {data.key_stats.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {data.key_stats.map(s => (
            <StatCard key={s.label} label={s.label} value={s.value} sub={s.note} />
          ))}
        </div>
      )}

      <div className="space-y-3">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-sm leading-relaxed text-muted-foreground">{p}</p>
        ))}
      </div>

      {data.generated_at && (
        <p className="text-xs text-muted-foreground border-t pt-3">
          Analysis generated {new Date(data.generated_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </p>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const router = useRouter()
  const { city } = useParams<{ city: string }>()
  const [summary, setSummary]           = useState<Summary | null>(null)
  const [statusData, setStatusData]     = useState<YearStatusRow[]>([])
  const [tagData, setTagData]           = useState<TagYearRow[]>([])
  const [tags, setTags]                 = useState<string[]>([])
  const [impactData, setImpactData]     = useState<ImpactYearRow[]>([])
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [tagFilter, setTagFilter]       = useState('')
  const [selectedTag, setSelectedTag]   = useState('')

  const loadStatusData = useCallback(() => {
    api.getInsightsStatusByYear({ tag: tagFilter || undefined })
      .then(d => d && setStatusData(d.years ?? []))
      .catch(() => {})
  }, [tagFilter])

  useEffect(() => {
    api.getInsightsSummary().then(d => d && setSummary(d)).catch(() => {})
    api.getInsightsTagByYear({ top_n: 10 }).then(d => { if (!d) return; setTagData(d.years ?? []); setTags(d.tags ?? []) }).catch(() => {})
    api.getInsightsImpactByYear().then(d => d && setImpactData(d.years ?? [])).catch(() => {})
  }, [])

  useEffect(() => { loadStatusData() }, [loadStatusData])

  const handleTagClick = (tag: string) => {
    const next = selectedTag === tag ? '' : tag
    setSelectedTag(next)
    setTagFilter(next)
  }

  const activeYear = selectedYear ?? statusData[statusData.length - 1]?.year ?? CURRENT_YEAR
  const yearList = [...statusData].reverse().map(r => r.year)

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">Council Insights</h1>
          <p className="text-muted-foreground mt-1">
            Explore Philadelphia City Council legislative activity
            {summary ? ` from ${summary.years_from} to ${summary.years_to}` : ''}.
          </p>
        </div>
        {summary?.last_fetched_at && (
          <p className="text-xs text-muted-foreground mt-2 shrink-0">
            Data updated {new Date(summary.last_fetched_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        )}
      </div>

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Bills" value={summary.total_bills} sub="all time" />
          <StatCard label="Active Now" value={summary.active_bills} sub="introduced or in committee" />
          <StatCard label="This Year" value={summary.bills_this_year}
            sub={summary.bills_last_year
              ? `${summary.bills_this_year >= summary.bills_last_year ? '+' : ''}${summary.bills_this_year - summary.bills_last_year} vs ${CURRENT_YEAR - 1}`
              : `introduced in ${CURRENT_YEAR}`} />
          <StatCard label="Signed into Law" value={summary.signed_into_law} sub="all time" />
          <StatCard label="Pass Rate" value={`${Math.round(summary.pass_rate * 100)}%`} sub="of closed bills" />
          <StatCard label="Avg Impact Score" value={summary.avg_impact_score ?? '—'} sub="1–10 across analyzed" />
        </div>
      )}

      {/* 26-year narrative */}
      <LegislativeHistorySection />

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
            See how bills flow through the legislative process. Click a tag below to filter.
          </p>
        </div>
        <StatusFunnelChart data={statusData} selectedYear={selectedYear} onYearChange={setSelectedYear} />
        <button onClick={() => router.push(`/${city}/legislation?year=${activeYear}${tagFilter ? `&tag=${tagFilter}` : ''}`)}
          className="text-sm text-primary hover:underline">
          View all {activeYear} bills →
        </button>
      </div>

      {/* Impact Distribution */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Impact Distribution</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Is Council producing substantive policy or mostly ceremonial items? Click a segment to browse those bills.
          </p>
        </div>
        <ImpactDistributionSection years={impactData} />
      </div>

      {/* Bill Type Over Time */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Bill Type Over Time</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            How has the mix of substantive, ceremonial, and procedural legislation shifted year to year?
          </p>
        </div>
        <BillTypeOverTimeSection years={impactData} />
      </div>

      {/* Sponsor Leaderboard */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Sponsor Leaderboard</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Who introduces the most legislation? Who is most effective at getting bills passed?
          </p>
        </div>
        <SponsorLeaderboard yearList={yearList} />
      </div>

      {/* Top Issues */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Top Issues — {activeYear}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Click a tag to filter the status chart above and see its full history.
          </p>
        </div>
        <TagTrendsChart year={activeYear} data={tagData} tags={tags} selectedTag={selectedTag} onTagClick={handleTagClick} />
      </div>

    </div>
  )
}
