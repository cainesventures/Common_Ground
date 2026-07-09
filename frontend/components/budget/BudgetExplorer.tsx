'use client'

import { useMemo, useState } from 'react'
import type { BudgetData, BudgetFund } from '@/lib/budget'
import { adjust, MODE_LABEL, type BudgetMode } from '@/lib/budget-adjust'
import { FUND_INFO, CLASS_INFO, deptNote } from '@/lib/budget-glossary'

function pretty(name: string): string {
  return name
    .replace(/�/g, "'") // PDF extraction turned curly apostrophes into U+FFFD
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(Of|And|The|To)\b/g, (m) => m.toLowerCase())
}
function fmt(n: number, mode: BudgetMode): string {
  const s = n < 0 ? '-' : ''
  const a = Math.abs(n)
  if (mode === 'percapita') return `${s}$${Math.round(a).toLocaleString()}`
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`
  return `${s}$${Math.round(a)}`
}

const TOP_N = 15
const MODES: BudgetMode[] = ['nominal', 'real', 'percapita']
type View = 'breakdown' | 'compare' | 'track'
const VIEWS: { id: View; label: string }[] = [
  { id: 'breakdown', label: 'Breakdown' },
  { id: 'compare', label: 'Compare years' },
  { id: 'track', label: 'Track a department' },
]

export function BudgetExplorer({ data, fundOrder }: { data: BudgetData; fundOrder: string[] }) {
  const firstFY = data.fiscalYears[0]
  const lastFY = data.fiscalYears[data.fiscalYears.length - 1]

  const [fund, setFund] = useState('GENERAL FUND')
  const [mode, setMode] = useState<BudgetMode>('nominal')
  const [view, setView] = useState<View>('breakdown')

  // per-view state
  const [year, setYear] = useState(lastFY)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [yearA, setYearA] = useState(lastFY)
  const [yearB, setYearB] = useState(Math.max(firstFY, lastFY - 10))
  const [dept, setDept] = useState<string | null>(null)

  const adj = (v: number, fy: number) => adjust(v, fy, mode, lastFY)

  // Fund by fiscal year.
  const fundByYear = useMemo(() => {
    const m = new Map<number, BudgetFund | undefined>()
    for (const y of data.years) m.set(y.fiscalYear, y.funds.find((f) => f.fund === fund))
    return m
  }, [data, fund])

  // Every department name that appears in this fund, biggest-ever first.
  const deptNames = useMemo(() => {
    const max = new Map<string, number>()
    for (const y of data.years) {
      const f = y.funds.find((ff) => ff.fund === fund)
      if (!f) continue
      for (const d of f.departments) max.set(d.name, Math.max(max.get(d.name) ?? 0, d.total))
    }
    return [...max.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])
  }, [data, fund])

  const activeDept = dept && deptNames.includes(dept) ? dept : deptNames[0]
  const fundDesc = FUND_INFO[fund]

  const onFundChange = (f: string) => {
    setFund(f); setExpanded(null); setShowAll(false); setDept(null)
  }

  return (
    <div>
      {/* Fund + mode */}
      <div className="flex flex-wrap gap-4 items-end mb-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Fund</span>
          <select
            value={fund}
            onChange={(e) => onFundChange(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm min-w-[220px]"
          >
            {fundOrder.map((f) => (
              <option key={f} value={f}>{pretty(f)}</option>
            ))}
          </select>
        </label>
        <div className="inline-flex rounded-lg border p-0.5 text-sm">
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                mode === m ? 'bg-foreground text-background font-medium' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {fundDesc && <p className="text-sm text-muted-foreground mb-5 max-w-2xl">{fundDesc}</p>}

      {/* View tabs */}
      <div className="flex gap-1 border-b mb-6">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${
              view === v.id
                ? 'border-blue-500 text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'breakdown' && (
        <BreakdownView
          fund={fund} year={year} setYear={setYear} firstFY={firstFY} lastFY={lastFY}
          fundByYear={fundByYear} complete={data.years.find((y) => y.fiscalYear === year)?.complete ?? true}
          adj={adj} mode={mode} expanded={expanded} setExpanded={setExpanded} showAll={showAll} setShowAll={setShowAll}
        />
      )}

      {view === 'compare' && (
        <CompareView
          fund={fund} yearA={yearA} yearB={yearB} setYearA={setYearA} setYearB={setYearB}
          firstFY={firstFY} lastFY={lastFY} fundByYear={fundByYear} adj={adj} mode={mode}
        />
      )}

      {view === 'track' && (
        <TrackView
          fund={fund} deptNames={deptNames} activeDept={activeDept} setDept={setDept}
          data={data} adj={adj} mode={mode}
        />
      )}

      {/* Spending-class glossary */}
      <details className="mt-6 rounded-2xl border bg-card p-5">
        <summary className="cursor-pointer font-semibold text-sm">What do the line items (spending classes) mean?</summary>
        <dl className="mt-4 space-y-3">
          {Object.entries(CLASS_INFO).map(([cls, desc]) => (
            <div key={cls}>
              <dt className="text-sm font-medium">{cls}</dt>
              <dd className="text-sm text-muted-foreground">{desc}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  )
}

// ── Breakdown ──────────────────────────────────────────────────────────────
function BreakdownView(props: {
  fund: string; year: number; setYear: (n: number) => void; firstFY: number; lastFY: number
  fundByYear: Map<number, BudgetFund | undefined>; complete: boolean
  adj: (v: number, fy: number) => number; mode: BudgetMode
  expanded: string | null; setExpanded: (s: string | null) => void
  showAll: boolean; setShowAll: (f: (s: boolean) => boolean) => void
}) {
  const { fund, year, setYear, firstFY, lastFY, fundByYear, complete, adj, mode, expanded, setExpanded, showAll, setShowAll } = props
  const fundData = fundByYear.get(year)

  const trend = useMemo(
    () => [...fundByYear.entries()].sort((a, b) => a[0] - b[0]).map(([fy, f]) => ({ fy, total: f ? adj(f.total, fy) : 0 })),
    [fundByYear, adj],
  )
  const maxTrend = Math.max(...trend.map((t) => t.total), 1)
  const first = trend.find((t) => t.total > 0)
  const last = [...trend].reverse().find((t) => t.total > 0)
  const growthPct = first && last && first.total ? Math.round(((last.total - first.total) / first.total) * 100) : 0

  const rawDepts = fundData?.departments ?? []
  const shown = showAll ? rawDepts : rawDepts.slice(0, TOP_N)
  const hiddenCount = rawDepts.length - TOP_N
  const otherTotal = rawDepts.slice(TOP_N).reduce((s, d) => s + d.total, 0)
  const fundTotal = fundData ? adj(fundData.total, year) : 0
  const maxDept = Math.max(...shown.map((d) => adj(d.total, year)), 1)

  const W = 720, H = 160, PAD = 8
  const pts = trend
    .map((t, i) => {
      const x = PAD + (i / (trend.length - 1)) * (W - 2 * PAD)
      const yv = H - PAD - (t.total / maxTrend) * (H - 2 * PAD)
      return `${x.toFixed(1)},${yv.toFixed(1)}`
    })
    .join(' ')

  return (
    <>
      <label className="flex flex-col gap-1 text-sm mb-6 max-w-md">
        <span className="text-muted-foreground">
          Fiscal year: <span className="font-semibold text-foreground tabular-nums">FY{year}</span>
        </span>
        <input type="range" min={firstFY} max={lastFY} value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full" />
      </label>

      <div className="rounded-2xl border bg-card p-5 mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h2 className="type-section">{pretty(fund)} over time</h2>
          {first && last && (
            <p className="text-sm text-muted-foreground">
              <span className="tabular-nums">{fmt(first.total, mode)}</span> (FY{first.fy}) →{' '}
              <span className="tabular-nums font-semibold text-foreground">{fmt(last.total, mode)}</span> (FY{last.fy}){' '}
              <span className={growthPct >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                {growthPct >= 0 ? '+' : ''}{growthPct}%
              </span>
            </p>
          )}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-40" preserveAspectRatio="none">
          <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={2} className="text-blue-500" />
        </svg>
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>FY{trend[0]?.fy}</span><span>FY{trend[trend.length - 1]?.fy}</span>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h3 className="font-semibold">Where {pretty(fund)} went in FY{year}</h3>
          <span className="text-sm text-muted-foreground tabular-nums">Total {fmt(fundTotal, mode)}</span>
        </div>
        {!fundData ? (
          <p className="text-sm text-muted-foreground">This fund has no data for FY{year}.</p>
        ) : (
          <>
            {!complete && (
              <p className="text-xs mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
                FY{year} is <strong>partial</strong> — the city&apos;s legislative record for this year is incomplete.
              </p>
            )}
            <ul className="space-y-1.5">
              {shown.map((d) => {
                const v = adj(d.total, year)
                const pct = fundData.total ? (d.total / fundData.total) * 100 : 0
                const note = deptNote(d.name)
                const hasClasses = d.classes && Object.keys(d.classes).length > 0
                const isOpen = expanded === d.name
                // This department's total across every fiscal year (matched by name).
                const series = isOpen
                  ? trend.map((t) => {
                      const dd = fundByYear.get(t.fy)?.departments.find((x) => x.name === d.name)
                      return { fy: t.fy, total: dd ? adj(dd.total, t.fy) : 0, present: !!dd }
                    })
                  : []
                const sMax = Math.max(...series.map((s) => s.total), 1)
                const sFirst = series.find((s) => s.present)
                const sLast = [...series].reverse().find((s) => s.present)
                const sPct = sFirst && sLast && sFirst.total ? Math.round(((sLast.total - sFirst.total) / sFirst.total) * 100) : 0
                return (
                  <li key={d.name}>
                    <button
                      onClick={() => setExpanded(isOpen ? null : d.name)}
                      className="w-full flex items-center gap-3 text-sm text-left cursor-pointer"
                    >
                      <span className="w-56 shrink-0 truncate flex items-center gap-1" title={pretty(d.name)}>
                        <span className={`text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
                        {pretty(d.name)}
                      </span>
                      <span className="flex-1 h-5 rounded bg-muted overflow-hidden">
                        <span className="block h-full rounded bg-blue-500/80" style={{ width: `${(v / maxDept) * 100}%` }} />
                      </span>
                      <span className="w-24 text-right tabular-nums shrink-0">{fmt(v, mode)}</span>
                      <span className="w-10 text-right tabular-nums text-muted-foreground shrink-0">{pct.toFixed(0)}%</span>
                    </button>
                    {isOpen && (
                      <div className="ml-6 mt-2 mb-3 border-l pl-4 space-y-3">
                        {note && <p className="text-xs text-muted-foreground max-w-xl">{note}</p>}

                        {/* This department over 25 years */}
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">
                            Over time
                            {sFirst && sLast ? (
                              <>
                                {' — '}
                                <span className="tabular-nums">{fmt(sFirst.total, mode)}</span> (FY{sFirst.fy}) →{' '}
                                <span className="tabular-nums font-medium text-foreground">{fmt(sLast.total, mode)}</span> (FY{sLast.fy}){' '}
                                <span className={sPct >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                                  {sPct >= 0 ? '+' : ''}{sPct}%
                                </span>
                              </>
                            ) : null}
                          </div>
                          <div className="flex items-end gap-px h-16">
                            {series.map((s) => (
                              <div
                                key={s.fy}
                                className={`flex-1 rounded-t ${s.present ? 'bg-blue-500/70' : 'bg-transparent'}`}
                                style={{ height: `${Math.max((s.total / sMax) * 100, s.present ? 2 : 0)}%` }}
                                title={`FY${s.fy}: ${s.present ? fmt(s.total, mode) : 'not in budget'}`}
                              />
                            ))}
                          </div>
                          <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums mt-0.5">
                            <span>FY{series[0]?.fy}</span>
                            <span>FY{series[series.length - 1]?.fy}</span>
                          </div>
                        </div>

                        {/* This year's spending-class split */}
                        {hasClasses && (
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Line items, FY{year}</div>
                            <ul className="space-y-1">
                              {Object.entries(d.classes!).sort((a, b) => b[1] - a[1]).map(([cls, amt]) => (
                                <li key={cls} className="flex items-center gap-3 text-xs text-muted-foreground">
                                  <span className="w-52 shrink-0 truncate" title={CLASS_INFO[cls] ?? cls}>{cls}</span>
                                  <span className="flex-1 h-3 rounded bg-muted overflow-hidden">
                                    <span className="block h-full rounded bg-blue-400/60" style={{ width: `${(amt / d.total) * 100}%` }} />
                                  </span>
                                  <span className="w-24 text-right tabular-nums shrink-0">{fmt(adj(amt, year), mode)}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            {hiddenCount > 0 && (
              <button onClick={() => setShowAll((s) => !s)} className="mt-4 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
                {showAll ? 'Show top 15 only' : `Show all ${rawDepts.length} departments — the other ${hiddenCount} total ${fmt(adj(otherTotal, year), mode)}`}
              </button>
            )}
            <p className="text-xs text-muted-foreground mt-3">Tip: click any department with a › to see its spending-class breakdown and what it is.</p>
          </>
        )}
      </div>
    </>
  )
}

// ── Compare two years ──────────────────────────────────────────────────────
function CompareView(props: {
  fund: string; yearA: number; yearB: number; setYearA: (n: number) => void; setYearB: (n: number) => void
  firstFY: number; lastFY: number; fundByYear: Map<number, BudgetFund | undefined>
  adj: (v: number, fy: number) => number; mode: BudgetMode
}) {
  const { fund, yearA, yearB, setYearA, setYearB, firstFY, lastFY, fundByYear, adj, mode } = props
  const [showAll, setShowAll] = useState(false)
  const A = fundByYear.get(yearA)
  const B = fundByYear.get(yearB)

  const rows = useMemo(() => {
    const names = new Set<string>()
    A?.departments.forEach((d) => names.add(d.name))
    B?.departments.forEach((d) => names.add(d.name))
    const amap = new Map(A?.departments.map((d) => [d.name, d.total]))
    const bmap = new Map(B?.departments.map((d) => [d.name, d.total]))
    return [...names]
      .map((name) => {
        const a = adj(amap.get(name) ?? 0, yearA)
        const b = adj(bmap.get(name) ?? 0, yearB)
        return { name, a, b, delta: a - b }
      })
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
  }, [A, B, yearA, yearB, adj])

  const shown = showAll ? rows : rows.slice(0, 25)
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.delta)), 1)
  const totalA = A ? adj(A.total, yearA) : 0
  const totalB = B ? adj(B.total, yearB) : 0
  const totalDelta = totalA - totalB
  const totalPct = totalB ? Math.round((totalDelta / totalB) * 100) : 0

  const YearPick = ({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} className="rounded-lg border bg-background px-3 py-2 text-sm">
        {Array.from({ length: lastFY - firstFY + 1 }, (_, i) => firstFY + i).map((fy) => (
          <option key={fy} value={fy}>FY{fy}</option>
        ))}
      </select>
    </label>
  )

  return (
    <>
      <div className="flex flex-wrap gap-4 items-end mb-6">
        <YearPick value={yearB} onChange={setYearB} label="From" />
        <span className="pb-2 text-muted-foreground">vs</span>
        <YearPick value={yearA} onChange={setYearA} label="To" />
      </div>

      <div className="rounded-2xl border bg-card p-5 mb-6">
        <h3 className="font-semibold mb-3">{pretty(fund)}: FY{yearB} → FY{yearA}</h3>
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div><span className="text-muted-foreground">FY{yearB}: </span><span className="tabular-nums font-medium">{fmt(totalB, mode)}</span></div>
          <div><span className="text-muted-foreground">FY{yearA}: </span><span className="tabular-nums font-medium">{fmt(totalA, mode)}</span></div>
          <div>
            <span className="text-muted-foreground">Change: </span>
            <span className={`tabular-nums font-semibold ${totalDelta >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {totalDelta >= 0 ? '+' : ''}{fmt(totalDelta, mode)} ({totalPct >= 0 ? '+' : ''}{totalPct}%)
            </span>
          </div>
        </div>
        {mode !== 'real' && (
          <p className="text-xs text-muted-foreground mt-2">Tip: switch to <strong>Real $</strong> above to compare in inflation-adjusted dollars.</p>
        )}
      </div>

      <div className="rounded-2xl border bg-card p-5">
        <h3 className="font-semibold mb-1">Biggest movers</h3>
        <p className="text-xs text-muted-foreground mb-4">Departments sorted by size of change. Green = grew, red = shrank (bar centered at zero).</p>
        <ul className="space-y-1.5">
          {shown.map((r) => {
            const pct = r.b ? Math.round((r.delta / r.b) * 100) : null
            const up = r.delta >= 0
            return (
              <li key={r.name} className="flex items-center gap-3 text-sm">
                <span className="w-52 shrink-0 truncate" title={pretty(r.name)}>{pretty(r.name)}</span>
                <span className="w-20 text-right tabular-nums text-muted-foreground shrink-0">{fmt(r.b, mode)}</span>
                {/* diverging bar */}
                <span className="flex-1 relative h-4">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                  <span
                    className={`absolute inset-y-0 rounded ${up ? 'bg-green-500/70' : 'bg-red-500/70'}`}
                    style={up
                      ? { left: '50%', width: `${(Math.abs(r.delta) / maxAbs) * 50}%` }
                      : { right: '50%', width: `${(Math.abs(r.delta) / maxAbs) * 50}%` }}
                  />
                </span>
                <span className="w-20 text-right tabular-nums shrink-0">{fmt(r.a, mode)}</span>
                <span className={`w-24 text-right tabular-nums shrink-0 ${up ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {up ? '+' : ''}{fmt(r.delta, mode)}{pct !== null ? ` (${pct >= 0 ? '+' : ''}${pct}%)` : ''}
                </span>
              </li>
            )
          })}
        </ul>
        {rows.length > 25 && (
          <button onClick={() => setShowAll((s) => !s)} className="mt-4 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
            {showAll ? 'Show top 25 movers' : `Show all ${rows.length} departments`}
          </button>
        )}
      </div>
    </>
  )
}

// ── Track one department over time ─────────────────────────────────────────
function TrackView(props: {
  fund: string; deptNames: string[]; activeDept: string; setDept: (s: string) => void
  data: BudgetData; adj: (v: number, fy: number) => number; mode: BudgetMode
}) {
  const { fund, deptNames, activeDept, setDept, data, adj, mode } = props

  const series = useMemo(
    () =>
      data.years.map((y) => {
        const f = y.funds.find((ff) => ff.fund === fund)
        const d = f?.departments.find((dd) => dd.name === activeDept)
        return { fy: y.fiscalYear, total: d ? adj(d.total, y.fiscalYear) : 0, present: !!d }
      }),
    [data, fund, activeDept, adj],
  )
  const withData = series.filter((s) => s.present)
  const first = withData[0]
  const last = withData[withData.length - 1]
  const growthPct = first && last && first.total ? Math.round(((last.total - first.total) / first.total) * 100) : 0
  const max = Math.max(...series.map((s) => s.total), 1)
  const note = deptNote(activeDept)

  return (
    <>
      <label className="flex flex-col gap-1 text-sm mb-6 max-w-lg">
        <span className="text-muted-foreground">Department / line item</span>
        <select value={activeDept} onChange={(e) => setDept(e.target.value)} className="rounded-lg border bg-background px-3 py-2 text-sm">
          {deptNames.map((n) => (
            <option key={n} value={n}>{pretty(n)}</option>
          ))}
        </select>
      </label>

      <div className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <h3 className="font-semibold">{pretty(activeDept)}</h3>
          {first && last && (
            <p className="text-sm text-muted-foreground">
              <span className="tabular-nums">{fmt(first.total, mode)}</span> (FY{first.fy}) →{' '}
              <span className="tabular-nums font-semibold text-foreground">{fmt(last.total, mode)}</span> (FY{last.fy}){' '}
              <span className={growthPct >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                {growthPct >= 0 ? '+' : ''}{growthPct}%
              </span>
            </p>
          )}
        </div>
        {note && <p className="text-sm text-muted-foreground mb-3 max-w-2xl">{note}</p>}

        {/* Column chart — bars are DIRECT children of the fixed-height row so
            their percentage heights resolve correctly. */}
        <div className="flex items-end gap-1 h-52 mt-4 border-b">
          {series.map((s) => (
            <div
              key={s.fy}
              className={`flex-1 rounded-t transition-colors hover:bg-blue-600 ${s.present ? 'bg-blue-500/80' : 'bg-transparent'}`}
              style={{ height: `${Math.max((s.total / max) * 100, s.present ? 1 : 0)}%` }}
              title={`FY${s.fy}: ${s.present ? fmt(s.total, mode) : 'not in budget'}`}
            />
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums mt-1">
          <span>FY{series[0]?.fy}</span><span>FY{series[series.length - 1]?.fy}</span>
        </div>
        {withData.length < series.length && (
          <p className="text-xs text-muted-foreground mt-3">
            Grey/empty years = this exact name wasn&apos;t in that year&apos;s budget (departments are sometimes renamed or reorganized).
          </p>
        )}
      </div>
    </>
  )
}
