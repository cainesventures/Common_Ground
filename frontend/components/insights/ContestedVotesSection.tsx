'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { lastName } from '@/lib/names'

// ── Types (mirror /api/insights vote analytics responses) ────────────────────

interface ContestedBillRow {
  id: string
  bill_number: string
  title: string
  status: string
  impact_score: number | null
  year: number | null
  yeas: number
  nays: number
  dissenters: string[]
}

interface VotingMemberRow {
  voter_name: string
  short_name: string
  is_current: boolean
  councilmember_id: string | null
  district: string | null
  party: string | null
  total_votes: number
  yeas: number
  nays: number
  abstains: number
  absents: number
  presents: number
  contested_votes: number
  dissent_rate: number
}

interface MatrixData {
  voters: { voter_name: string; short_name: string; is_current: boolean; contested_votes: number }[]
  matrix: (number | null)[][]
  min_shared: number
}

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: CURRENT_YEAR - 2000 + 1 }, (_, i) => CURRENT_YEAR - i)

const SORTS = [
  { key: 'nays',    label: 'Most opposition' },
  { key: 'closest', label: 'Closest margin' },
  { key: 'recent',  label: 'Most recent' },
] as const

// ── Contested bills explorer ─────────────────────────────────────────────────

function ContestedBillsCard({ city }: { city: string }) {
  const [year, setYear] = useState(0)
  const [sort, setSort] = useState<string>('nays')
  const [bills, setBills] = useState<ContestedBillRow[]>([])
  const [total, setTotal] = useState<number | null>(null)

  useEffect(() => {
    api.getInsightsContestedBills({ year: year || undefined, sort, limit: 12 })
      .then(d => { if (!d) return; setBills(d.bills ?? []); setTotal(d.total_contested ?? null) })
      .catch(() => {})
  }, [year, sort])

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">The Votes That Split Council</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Nearly every council roll call is unanimous — these are the rare bills that drew opposition.
          {total != null && (year ? ` ${total} contested in ${year}.` : ` ${total} contested bills since 2000.`)}
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="text-sm border rounded-lg px-2 py-1 bg-background"
        >
          <option value={0}>All years</option>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className="flex gap-1">
          {SORTS.map(s => (
            <button key={s.key} onClick={() => setSort(s.key)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                sort === s.key ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
              }`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {bills.map(b => (
          <a key={b.id} href={`/${city}/legislation/${b.id}`}
            className="block rounded-lg border p-3 hover:bg-muted/50 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium leading-snug">{b.title}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {b.year && <span className="mr-2 font-medium">{b.year}</span>}
                  Dissenting: {b.dissenters.join(', ')}
                </div>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{b.yeas}–{b.nays}</span>
            </div>
          </a>
        ))}
        {bills.length === 0 && (
          <p className="text-sm text-muted-foreground">No contested votes found{year ? ` in ${year}` : ''}.</p>
        )}
      </div>
    </div>
  )
}

// ── Dissent & attendance table ───────────────────────────────────────────────

function DissentTableCard({ city }: { city: string }) {
  const [members, setMembers] = useState<VotingMemberRow[]>([])
  const [scope, setScope] = useState<'current' | 'all'>('current')

  useEffect(() => {
    api.getInsightsVotingRecords()
      .then(d => d && setMembers(d.members ?? []))
      .catch(() => {})
  }, [])

  const rows = useMemo(() => {
    const filtered = scope === 'current' ? members.filter(m => m.is_current) : members
    return [...filtered].sort((a, b) => b.nays - a.nays).slice(0, 20)
  }, [members, scope])

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Dissent &amp; Attendance</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Who votes No, and how often? Dissent rate is the share of a member&apos;s votes on contested
            bills cast against the majority.
          </p>
        </div>
        <div className="flex gap-1">
          {(['current', 'all'] as const).map(s => (
            <button key={s} onClick={() => setScope(s)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                scope === s ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'
              }`}>
              {s === 'current' ? 'Current members' : 'All time'}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b">
              <th className="text-left font-medium py-2 pr-3">Member</th>
              <th className="text-right font-medium py-2 px-3">Votes Cast</th>
              <th className="text-right font-medium py-2 px-3">Nay Votes</th>
              <th className="text-right font-medium py-2 px-3">Dissent Rate</th>
              <th className="text-right font-medium py-2 pl-3">Absences</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.councilmember_id ?? m.voter_name} className="border-b last:border-0">
                <td className="py-2 pr-3">
                  {m.is_current && m.councilmember_id ? (
                    <a href={`/${city}/councilmembers/${m.councilmember_id}`} className="text-primary hover:underline">
                      {m.short_name}
                    </a>
                  ) : (
                    m.short_name
                  )}
                  {m.is_current && m.party && m.party !== 'Democratic' && (
                    <span className="ml-1.5 text-xs text-muted-foreground">({m.party})</span>
                  )}
                </td>
                <td className="text-right tabular-nums py-2 px-3">{m.total_votes.toLocaleString()}</td>
                <td className="text-right tabular-nums py-2 px-3 font-medium">{m.nays}</td>
                <td className="text-right tabular-nums py-2 px-3">
                  {m.contested_votes ? `${Math.round(m.dissent_rate * 100)}%` : '—'}
                </td>
                <td className="text-right tabular-nums py-2 pl-3">{m.absents}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Agreement matrix heatmap ─────────────────────────────────────────────────

function cellColor(pct: number) {
  // 50% agreement → red-ish, 100% → green. Council agreement rarely dips below 50%.
  const t = Math.max(0, Math.min(1, (pct - 0.5) / 0.5))
  return `hsl(${Math.round(t * 130)}, 60%, ${42 + t * 6}%)`
}

function AgreementMatrixCard() {
  const [data, setData] = useState<MatrixData | null>(null)

  useEffect(() => {
    api.getInsightsAgreementMatrix({ current_only: true })
      .then(d => d && setData(d))
      .catch(() => {})
  }, [])

  if (!data || data.voters.length === 0) return null

  const n = data.voters.length
  const CELL = 24
  const LABEL_W = 150
  const LABEL_H = 70
  const width = LABEL_W + n * CELL + 60  // right padding so rotated column labels don't clip
  const height = LABEL_H + n * CELL

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Who Votes Together</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Agreement between current members on contested bills only — the votes that actually
          differentiate. Green = usually agree, red = often split. Pairs with fewer than{' '}
          {data.min_shared} shared contested votes are blank.
        </p>
      </div>

      <div className="overflow-x-auto">
        <svg width={width} height={height} className="select-none">
          {/* Column labels */}
          {data.voters.map((v, j) => (
            <text key={`c${j}`}
              x={LABEL_W + j * CELL + CELL / 2}
              y={LABEL_H - 6}
              transform={`rotate(-50, ${LABEL_W + j * CELL + CELL / 2}, ${LABEL_H - 6})`}
              className="fill-current text-foreground"
              fontSize={11}
              textAnchor="start"
            >
              {lastName(v.short_name)}
            </text>
          ))}
          {/* Rows */}
          {data.voters.map((v, i) => (
            <g key={`r${i}`}>
              <text
                x={LABEL_W - 8}
                y={LABEL_H + i * CELL + CELL / 2 + 4}
                className="fill-current text-foreground"
                fontSize={11}
                textAnchor="end"
              >
                {lastName(v.short_name)}
              </text>
              {data.voters.map((w, j) => {
                const pct = data.matrix[i]?.[j]
                if (i === j) {
                  return <rect key={j} x={LABEL_W + j * CELL} y={LABEL_H + i * CELL}
                    width={CELL - 2} height={CELL - 2} rx={3} className="fill-muted" />
                }
                if (pct == null) {
                  return <rect key={j} x={LABEL_W + j * CELL} y={LABEL_H + i * CELL}
                    width={CELL - 2} height={CELL - 2} rx={3} className="fill-muted/40" />
                }
                return (
                  <rect key={j} x={LABEL_W + j * CELL} y={LABEL_H + i * CELL}
                    width={CELL - 2} height={CELL - 2} rx={3} fill={cellColor(pct)}>
                    <title>{`${v.short_name} × ${w.short_name}: ${Math.round(pct * 100)}% agreement`}</title>
                  </rect>
                )
              })}
            </g>
          ))}
        </svg>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>Often split</span>
        <div className="flex h-2.5 rounded overflow-hidden">
          {[0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map(p => (
            <div key={p} style={{ backgroundColor: cellColor(p), width: 22 }} />
          ))}
        </div>
        <span>Usually agree</span>
      </div>
    </div>
  )
}

// ── Public section ───────────────────────────────────────────────────────────

export default function ContestedVotesSection({ city }: { city: string }) {
  return (
    <>
      <ContestedBillsCard city={city} />
      <DissentTableCard city={city} />
      <AgreementMatrixCard />
    </>
  )
}
