'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { api } from '@/lib/api'
import { lastName as extractLastName } from '@/lib/names'
import { fmtStatus } from '@/lib/utils'
import { isLoggedIn } from '@/lib/auth'
import { CITY } from '@/lib/city'
import { LoginModal } from '@/components/LoginModal'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Compact bar chart ──────────────────────────────────────────────────────────

function MiniBarChart<T extends { count: number }>({
  data,
  getLabel,
  getKey,
  activeKey,
  onSelect,
  title,
  subtitle,
}: {
  data: T[]
  getLabel: (item: T) => string
  getKey:   (item: T) => string | number
  activeKey: string | number | null
  onSelect:  (key: string | number) => void
  title: string
  subtitle?: string
}) {
  const [hoveredKey, setHoveredKey] = useState<string | number | null>(null)
  if (data.length === 0) return null
  const max = Math.max(...data.map(d => d.count), 1)
  const total = data.reduce((s, d) => s + d.count, 0)

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="text-sm font-semibold">{title}</span>
          {subtitle && <span className="text-xs text-muted-foreground ml-2">{subtitle}</span>}
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{total.toLocaleString()} bills</span>
      </div>
      <div className="flex items-end gap-1" style={{ height: 108 }}>
        {data.map((item) => {
          const key = getKey(item)
          const isActive = activeKey === key
          const isHovered = hoveredKey === key
          const barH = Math.max((item.count / max) * 72, 3)
          const barColor = isActive ? '#3b82f6' : isHovered ? '#1d4ed8' : '#3b82f630'
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              onMouseEnter={() => setHoveredKey(key)}
              onMouseLeave={() => setHoveredKey(null)}
              className="bar-hover flex-1 flex flex-col items-center gap-0.5 min-w-0"
              title={`${getLabel(item)}: ${item.count.toLocaleString()} bill${item.count !== 1 ? 's' : ''}`}
            >
              <span style={{
                fontSize: 11, fontWeight: 600, lineHeight: 1,
                fontVariantNumeric: 'tabular-nums', color: '#000',
                opacity: isActive || isHovered ? 1 : 0,
                transition: 'opacity 150ms ease',
              }}>
                {item.count.toLocaleString()}
              </span>
              <div className="w-full flex items-end" style={{ height: 72 }}>
                <div className="w-full rounded-t-sm" style={{
                  height: barH, backgroundColor: barColor,
                  outline: isActive ? '2px solid #3b82f6' : 'none',
                  outlineOffset: '1px',
                  transition: 'background-color 150ms ease',
                }} />
              </div>
              <span style={{
                fontSize: 10, lineHeight: 1, textAlign: 'center', width: '100%',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: isActive ? '#2563eb' : '#6b7280',
                fontWeight: isActive ? 600 : 400,
                transition: 'color 150ms ease',
              }}>
                {getLabel(item)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SponsorActivityChart({ sponsorName }: { sponsorName: string }) {
  const [yearCounts,   setYearCounts]   = useState<{ year: number; count: number }[]>([])
  const [monthCounts,  setMonthCounts]  = useState<{ month: number; count: number }[]>([])
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const lastName = extractLastName(sponsorName)

  useEffect(() => {
    api.getYearCounts({ sponsor: lastName })
      .then((d) => setYearCounts(d?.years ?? []))
      .catch(() => {})
  }, [lastName])

  useEffect(() => {
    if (!selectedYear) { setMonthCounts([]); return }
    api.getMonthCounts(selectedYear, { sponsor: lastName })
      .then((d) => setMonthCounts(d?.months ?? []))
      .catch(() => {})
  }, [selectedYear, lastName])

  if (yearCounts.length === 0) return null

  if (!selectedYear) {
    return (
      <MiniBarChart
        data={yearCounts}
        getLabel={(y) => String(y.year)}
        getKey={(y) => y.year}
        activeKey={null}
        onSelect={(k) => setSelectedYear(k as number)}
        title="Bill Activity by Year"
        subtitle="click a year to drill down"
      />
    )
  }

  return (
    <div className="space-y-2">
      <MiniBarChart
        data={monthCounts}
        getLabel={(m) => MONTH_NAMES[m.month - 1]}
        getKey={(m) => m.month}
        activeKey={null}
        onSelect={() => {}}
        title={`${selectedYear}`}
        subtitle="bills introduced by month"
      />
      <button
        onClick={() => setSelectedYear(null)}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        ← All years
      </button>
    </div>
  )
}

// ── Legislative profile (bill analysis) ────────────────────────────────────────

interface Profile {
  outcomes: { total: number; signed: number; failed_vetoed: number; died_in_committee: number; active: number; pass_rate: number | null }
  top_tags: { tag: string; count: number }[]
  bill_types: Record<string, number>
  impact: { levels: Record<string, number>; avg_score: number | null }
  committees: { committee: string; count: number }[]
  median_days_to_passage: number | null
  voting: {
    total_votes: number; absent: number; dissents: number; attendance_rate: number | null
    dissent_bills: DissentBill[]
  }
}

interface DissentBill {
  id: string
  bill_number: string
  title: string
  status: string
  action_date: string | null
  yeas: number
  nays: number
}

const OUTCOME_SEGMENTS: { key: keyof Profile['outcomes']; label: string; color: string }[] = [
  { key: 'signed',            label: 'Signed into law',  color: '#22c55e' },
  { key: 'active',            label: 'Active',           color: '#3b82f6' },
  { key: 'died_in_committee', label: 'Died in committee', color: '#94a3b8' },
  { key: 'failed_vetoed',     label: 'Failed / vetoed',  color: '#ef4444' },
]

function OutcomeBillList({ memberId, outcome, total, label }: {
  memberId: string; outcome: string; total: number; label: string
}) {
  const { city } = useParams<{ city: string }>()
  const [bills, setBills] = useState<any[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const LIMIT = 10
  const pages = Math.ceil(total / LIMIT)

  useEffect(() => {
    setLoading(true)
    api.getCouncilmemberBillsByOutcome(memberId, outcome, page, LIMIT)
      .then((d) => setBills(d?.results ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [memberId, outcome, page])

  return (
    <div className="border rounded-lg p-4 space-y-2">
      <p className="text-sm font-semibold">
        {label}
        <span className="text-xs font-normal text-muted-foreground ml-2">{total.toLocaleString()} total</span>
      </p>
      {loading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-11 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-1.5">
          {bills.map((b) => (
            <Link
              key={b.id}
              href={`/${city}/legislation/${b.id}`}
              className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2 hover:border-primary/60 hover:shadow-sm transition-all group"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-muted-foreground">{b.bill_number}</p>
                <p className="text-sm leading-snug line-clamp-1 group-hover:text-primary transition-colors mt-0.5">{b.title}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 text-xs">
                {b.introduced_date && (
                  <span className="text-muted-foreground hidden sm:block">
                    {new Date(b.introduced_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </span>
                )}
                {b.impact_level && (
                  <span className={`px-2 py-0.5 rounded-full capitalize ${IMPACT_COLORS[b.impact_level] ?? ''}`}>{b.impact_level}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between pt-1 text-xs">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40">← Prev</button>
          <span className="text-muted-foreground">Page {page} of {pages}</span>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40">Next →</button>
        </div>
      )}
    </div>
  )
}

function Metric({ value, label, sub, onClick, expanded }: {
  value: string | number; label: string; sub?: string
  onClick?: () => void; expanded?: boolean
}) {
  const interactive = !!onClick
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={`border rounded-lg p-3 text-left w-full ${
        interactive ? 'hover:border-primary/60 hover:bg-muted/40 transition-colors cursor-pointer' : 'cursor-default'
      } ${expanded ? 'border-primary/60 bg-muted/40' : ''}`}
    >
      <p className="text-xl font-bold tabular-nums leading-none">{value}</p>
      <p className="text-xs font-medium mt-1.5 flex items-center gap-1">
        {label}
        {interactive && <span className="text-muted-foreground text-[10px]">{expanded ? '▲' : '▼'}</span>}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{sub}</p>}
    </button>
  )
}

function LegislativeProfile({ memberId, memberName }: { memberId: string; memberName: string }) {
  const { city } = useParams<{ city: string }>()
  const [p, setP] = useState<Profile | null>(null)
  const [openPanel, setOpenPanel] = useState<'signed' | 'active' | 'dissents' | null>(null)

  useEffect(() => {
    api.getCouncilmemberProfile(memberId).then((d) => d && setP(d.profile)).catch(() => {})
  }, [memberId])

  if (!p || p.outcomes.total === 0) return null

  const firstName = memberName.split(' ')[0]
  const surname = extractLastName(memberName)
  const o = p.outcomes
  const tagMax = Math.max(...p.top_tags.map(t => t.count), 1)
  const v = p.voting
  const hasDissents = v.dissent_bills.length > 0
  const toggle = (k: 'signed' | 'active' | 'dissents') => setOpenPanel((cur) => (cur === k ? null : k))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Legislative Profile</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          What {firstName} legislates on and how effective those bills have been.
        </p>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <Metric
          value={o.pass_rate != null ? `${Math.round(o.pass_rate * 100)}%` : '—'}
          label="Pass Rate"
          sub="of concluded bills signed into law"
        />
        <Metric
          value={o.signed}
          label="Signed into Law"
          sub={o.signed > 0 ? 'tap to see the bills' : `of ${o.total} sponsored`}
          onClick={o.signed > 0 ? () => toggle('signed') : undefined}
          expanded={openPanel === 'signed'}
        />
        <Metric
          value={o.active}
          label="Live Bills"
          sub={o.active > 0 ? 'tap to see what’s pending' : 'currently pending'}
          onClick={o.active > 0 ? () => toggle('active') : undefined}
          expanded={openPanel === 'active'}
        />
        <Metric value={p.impact.avg_score ?? '—'} label="Avg Impact" sub="1–10 across analyzed bills" />
        <Metric
          value={p.median_days_to_passage ?? '—'}
          label="Median Days to Law"
          sub="introduction → signed"
        />
        <Metric
          value={v.attendance_rate != null ? `${Math.round(v.attendance_rate * 100)}%` : '—'}
          label="Vote Attendance"
          sub={`${v.total_votes.toLocaleString()} roll calls`}
        />
        <Metric
          value={v.dissents}
          label="Dissenting Votes"
          sub={hasDissents ? 'tap to see the bills' : 'times voted against the majority'}
          onClick={hasDissents ? () => toggle('dissents') : undefined}
          expanded={openPanel === 'dissents'}
        />
      </div>

      {/* Signed / Live bill lists (lazy, paginated) */}
      {openPanel === 'signed' && (
        <OutcomeBillList memberId={memberId} outcome="signed" total={o.signed}
          label={`Bills ${firstName} got signed into law`} />
      )}
      {openPanel === 'active' && (
        <OutcomeBillList memberId={memberId} outcome="active" total={o.active}
          label={`${firstName}’s live bills`} />
      )}

      {/* Dissenting bills (expandable) */}
      {openPanel === 'dissents' && hasDissents && (
        <div className="border rounded-lg p-4 space-y-2">
          <p className="text-sm font-semibold">
            Bills {firstName} voted against
            <span className="text-xs font-normal text-muted-foreground ml-2">{v.dissent_bills.length} total</span>
          </p>
          <div className="space-y-1.5">
            {v.dissent_bills.map((b) => {
              const passed = b.yeas > b.nays
              return (
                <Link
                  key={b.id}
                  href={`/${city}/legislation/${b.id}`}
                  className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2 hover:border-primary/60 hover:shadow-sm transition-all group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-muted-foreground">{b.bill_number}</p>
                    <p className="text-sm leading-snug line-clamp-1 group-hover:text-primary transition-colors mt-0.5">
                      {b.title}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 text-xs">
                    {b.action_date && (
                      <span className="text-muted-foreground hidden sm:block">
                        {new Date(b.action_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                      </span>
                    )}
                    <span className="tabular-nums font-medium" title="Yeas–Nays">{b.yeas}–{b.nays}</span>
                    <span className={`px-2 py-0.5 rounded-full font-medium ${passed ? 'bg-muted text-muted-foreground' : 'bg-red-100 text-red-700'}`}>
                      {passed ? 'passed anyway' : 'blocked'}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Outcome breakdown */}
      <div className="border rounded-lg p-4 space-y-2.5">
        <p className="text-sm font-semibold">What happens to {firstName}&apos;s bills</p>
        <div className="h-3 rounded-full overflow-hidden flex bg-muted">
          {OUTCOME_SEGMENTS.map((s) => {
            const n = o[s.key] as number
            const pct = o.total ? (n / o.total) * 100 : 0
            if (pct === 0) return null
            return <div key={s.key} style={{ width: `${pct}%`, backgroundColor: s.color }} title={`${s.label}: ${n}`} />
          })}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {OUTCOME_SEGMENTS.map((s) => {
            const n = o[s.key] as number
            if (n === 0) return null
            return (
              <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                {s.label} <span className="tabular-nums font-medium text-foreground">{n}</span>
              </span>
            )
          })}
        </div>
      </div>

      {/* Top issues */}
      {p.top_tags.length > 0 && (
        <div className="border rounded-lg p-4 space-y-2.5">
          <p className="text-sm font-semibold">Top Issue Areas</p>
          <div className="space-y-1.5">
            {p.top_tags.map((t) => (
              <Link
                key={t.tag}
                href={`/${city}/legislation?tag=${encodeURIComponent(t.tag)}&sponsor=${encodeURIComponent(surname)}`}
                className="flex items-center gap-2 group"
              >
                <span className="text-xs w-28 shrink-0 truncate capitalize group-hover:text-foreground transition-colors">
                  {t.tag.replace(/-/g, ' ')}
                </span>
                <div className="flex-1 h-4 bg-muted/40 rounded-sm overflow-hidden">
                  <div className="h-full rounded-sm bg-blue-500/70 group-hover:bg-blue-500 transition-colors"
                    style={{ width: `${Math.max((t.count / tagMax) * 100, 3)}%` }} />
                </div>
                <span className="text-xs tabular-nums w-8 text-right text-muted-foreground">{t.count}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Committees */}
      {p.committees.length > 0 && (
        <div className="border rounded-lg p-4 space-y-2">
          <p className="text-sm font-semibold">Committees Their Bills Go Through</p>
          <div className="space-y-1">
            {p.committees.map((c) => (
              <div key={c.committee} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground truncate pr-2">{c.committee}</span>
                <span className="tabular-nums text-xs shrink-0">{c.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CouncilmemberVotePanel({ memberId, memberName }: { memberId: string; memberName: string }) {
  const [counts, setCounts] = useState<{ support: number; oppose: number }>({ support: 0, oppose: 0 })
  const [myVote, setMyVote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showLogin, setShowLogin] = useState(false)

  const voterToken = (() => {
    if (typeof window === 'undefined') return ''
    const key = 'cg_voter_token'
    let t = localStorage.getItem(key)
    if (!t) { t = crypto.randomUUID(); localStorage.setItem(key, t) }
    return t
  })()

  useEffect(() => {
    if (!voterToken) return
    api.getCouncilmemberVotes(memberId, voterToken).then((d) => {
      if (d?.counts) setCounts(d.counts)
      if (d?.your_vote !== undefined) setMyVote(d.your_vote)
    }).catch(() => {})
  }, [memberId, voterToken])

  const handleVote = async (vote: string) => {
    if (!isLoggedIn()) { setShowLogin(true); return }
    if (loading) return
    setLoading(true)
    try {
      const d = await api.castCouncilmemberVote(memberId, vote, voterToken)
      if (d?.counts) setCounts(d.counts)
      setMyVote(d?.your_vote ?? vote)
    } catch { /* ignore */ } finally { setLoading(false) }
  }

  const total = counts.support + counts.oppose
  const supportPct = total > 0 ? Math.round((counts.support / total) * 100) : 0
  const opposePct  = total > 0 ? Math.round((counts.oppose  / total) * 100) : 0

  return (
    <>
      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          reason="Sign in to rate your councilmember and see how your community feels."
        />
      )}
      <div className="border rounded-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Citizen Approval</h2>
          {total > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">{total.toLocaleString()} {total === 1 ? 'vote' : 'votes'}</span>
          )}
        </div>

        <div className="flex gap-2">
          {(['support', 'oppose'] as const).map((v) => {
            const isSelected = myVote === v
            const isSupport = v === 'support'
            return (
              <button
                key={v}
                onClick={() => handleVote(v)}
                disabled={loading}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${
                  isSelected
                    ? isSupport
                      ? 'bg-green-500 text-white border-green-500'
                      : 'bg-red-500 text-white border-red-500'
                    : isSupport
                      ? 'hover:border-green-400 hover:text-green-700'
                      : 'hover:border-red-400 hover:text-red-700'
                }`}
              >
                {isSupport ? 'Support' : 'Oppose'}
                {counts[v] > 0 && (
                  <span className="ml-1.5 opacity-70 text-xs tabular-nums">({counts[v].toLocaleString()})</span>
                )}
              </button>
            )
          })}
        </div>

        {total > 0 && (
          <div className="space-y-1">
            <div className="h-2 rounded-full overflow-hidden flex bg-muted">
              {supportPct > 0 && <div className="bg-green-500 transition-all" style={{ width: `${supportPct}%` }} />}
              {opposePct  > 0 && <div className="bg-red-500 transition-all"   style={{ width: `${opposePct}%`  }} />}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
              <span className="text-green-600">{supportPct}% support</span>
              <span className="text-red-600">{opposePct}% oppose</span>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function ContactSection({ member }: { member: any }) {
  const [phoneCopied, setPhoneCopied] = useState(false)

  const subject = `${CITY.fullCouncilName} — Constituent Message`
  const body = `Dear ${member.name},

I am a ${CITY.name} resident writing to share my perspective on legislation currently before City Council.

[Describe the bill and your position here.]

Thank you for your service to our community.

Sincerely,
[Your name]
[Your address]`

  const mailtoUrl = member.email
    ? `mailto:${member.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null

  if (!mailtoUrl && !member.phone && !member.profile_url) return null

  const copyPhone = (e: React.MouseEvent) => {
    if (!member.phone) return
    // On mobile, let the tel: link handle it naturally
    if (navigator.maxTouchPoints > 0) return
    e.preventDefault()
    navigator.clipboard.writeText(member.phone).then(() => {
      setPhoneCopied(true)
      setTimeout(() => setPhoneCopied(false), 2000)
    })
  }

  return (
    <div className="border rounded-lg p-5 space-y-3">
      <h2 className="text-sm font-semibold">Contact {member.name}</h2>
      <div className="flex gap-2 flex-wrap">
        {mailtoUrl && (
          <a
            href={mailtoUrl}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Send email
          </a>
        )}
        {member.phone && (
          <a
            href={`tel:${member.phone}`}
            onClick={copyPhone}
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border hover:bg-muted transition-colors"
          >
            {phoneCopied ? 'Copied!' : member.phone}
          </a>
        )}
        {member.profile_url && (
          <a href={member.profile_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg border hover:bg-muted transition-colors">
            Council profile →
          </a>
        )}
      </div>
      {mailtoUrl && <p className="text-xs text-muted-foreground">Opens a pre-filled draft in your email app. Edit before sending.</p>}
    </div>
  )
}

// ── Official vote history ──────────────────────────────────────────────────────

const VOTE_BADGE: Record<string, string> = {
  Yea:     'bg-green-100 text-green-800',
  Nay:     'bg-red-100 text-red-800',
  Abstain: 'bg-yellow-100 text-yellow-800',
  Absent:  'bg-gray-100 text-gray-500',
}

function VoteHistorySection({ memberId }: { memberId: string }) {
  const { city } = useParams<{ city: string }>()
  const [records, setRecords]   = useState<any[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [loading, setLoading]   = useState(true)
  const PAGE_SIZE = 10

  useEffect(() => {
    setLoading(true)
    api.getCouncilmemberVoteHistory(memberId, page, PAGE_SIZE)
      .then((d) => { setRecords(d?.data ?? []); setTotal(d?.total ?? 0) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [memberId, page])

  if (!loading && records.length === 0) return null

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">
        Voting Record
        {total > 0 && <span className="text-sm font-normal text-muted-foreground ml-2">({total} votes)</span>}
      </h2>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-1.5">
          {records.map((r) => (
            <Link
              key={r.legislation_id}
              href={`/${city}/legislation/${r.legislation_id}`}
              className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2 hover:border-primary/60 hover:shadow-sm transition-all group"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-muted-foreground">{r.bill_number}</p>
                <p className="text-sm leading-snug line-clamp-1 group-hover:text-primary transition-colors mt-0.5">
                  {r.plain_title}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {r.action_date && (
                  <span className="text-xs text-muted-foreground hidden sm:block">
                    {new Date(r.action_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </span>
                )}
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${VOTE_BADGE[r.vote] ?? 'bg-gray-100 text-gray-600'}`}>
                  {r.vote}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {Math.ceil(total / PAGE_SIZE)}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= Math.ceil(total / PAGE_SIZE)}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}

const DistrictMap = dynamic(
  () => import('@/components/DistrictMap').then((m) => m.DistrictMap),
  { ssr: false, loading: () => <div className="h-80 rounded-lg bg-muted animate-pulse" /> }
)

const STATUS_COLORS: Record<string, string> = {
  introduced:      'bg-blue-100 text-blue-800',
  in_committee:    'bg-yellow-100 text-yellow-800',
  signed_into_law: 'bg-green-100 text-green-800',
  failed:          'bg-red-100 text-red-800',
  vetoed:          'bg-orange-100 text-orange-800',
}

const IMPACT_COLORS: Record<string, string> = {
  high:   'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low:    'bg-green-100 text-green-800',
}

type TabKey = 'overview' | 'bills' | 'votes' | 'map'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'bills',    label: 'Bills' },
  { key: 'votes',    label: 'Voting Record' },
  { key: 'map',      label: 'Map' },
]

const BILLS_PER_PAGE = 20

export default function CouncilmemberDetailClient() {
  const { city, id } = useParams<{ city: string; id: string }>()
  const [data, setData]           = useState<any>(null)
  const [loading, setLoading]     = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [billsPage, setBillsPage]     = useState(1)
  const [billsLoading, setBillsLoading] = useState(false)

  useEffect(() => {
    api.getCouncilmember(id, 1, BILLS_PER_PAGE)
      .then((d) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  const loadBillsPage = async (page: number) => {
    setBillsLoading(true)
    try {
      const d = await api.getCouncilmember(id, page, BILLS_PER_PAGE)
      setData((prev: any) => ({ ...prev, bills: d?.bills }))
      setBillsPage(page)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch { /* ignore */ }
    finally { setBillsLoading(false) }
  }

  if (loading) return (
    <div className="max-w-3xl space-y-6">
      <div className="flex gap-6">
        <div className="w-24 h-24 rounded-full bg-muted animate-pulse shrink-0" />
        <div className="flex-1 space-y-3 pt-2">
          <div className="h-6 bg-muted animate-pulse rounded w-48" />
          <div className="h-4 bg-muted animate-pulse rounded w-32" />
        </div>
      </div>
      <div className="h-10 bg-muted animate-pulse rounded" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
        ))}
      </div>
    </div>
  )

  if (!data?.member) return (
    <div className="text-center py-16 text-muted-foreground">Council member not found.</div>
  )

  const { member, bills } = data as {
    member: any & { term_start?: number; years_serving?: number; next_election?: number }
    bills: any
  }

  return (
    <div className="max-w-3xl space-y-6">

      {/* ── Always-visible header ── */}
      <div className="flex items-start gap-5">
        <div className="shrink-0 w-20 h-20 rounded-full overflow-hidden bg-muted flex items-center justify-center">
          {member.photo_url ? (
            <Image src={member.photo_url} alt={member.name} width={80} height={80} className="w-full h-full object-cover object-top" />
          ) : (
            <span className="text-2xl font-bold text-muted-foreground">{member.name[0]}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold leading-tight">{member.name}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {member.district === 'At-Large' ? 'Councilmember At-Large' : `Councilmember, ${member.district}`}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
            {member.email && (
              <a href={`mailto:${member.email}`} className="hover:text-foreground transition-colors truncate">
                {member.email}
              </a>
            )}
            {member.phone && (
              <a href={`tel:${member.phone}`} className="hover:text-foreground transition-colors">
                {member.phone}
              </a>
            )}
            {member.profile_url && (
              <a href={member.profile_url} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">
                council profile →
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex border-b overflow-x-auto scrollbar-hide">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            {tab.label}
            {tab.key === 'bills' && bills?.total > 0 && (
              <span className="ml-1.5 text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full tabular-nums">
                {bills.total}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="border rounded-lg p-4 text-center">
              <p className="text-2xl font-bold">{member.bills_sponsored}</p>
              <p className="text-xs text-muted-foreground mt-1">Bills Sponsored</p>
            </div>
            {member.term_start && (
              <div className="border rounded-lg p-4 text-center">
                <p className="text-2xl font-bold">{member.years_serving}y</p>
                <p className="text-xs text-muted-foreground mt-1">Since {member.term_start}</p>
              </div>
            )}
            {member.next_election && (
              <div className="border rounded-lg p-4 text-center">
                <p className="text-2xl font-bold">{member.next_election}</p>
                <p className="text-xs text-muted-foreground mt-1">Next Election</p>
              </div>
            )}
            <div className="border rounded-lg p-4 text-center">
              <p className="text-2xl font-bold">{member.district === 'At-Large' ? '–' : member.district.replace('District ', '')}</p>
              <p className="text-xs text-muted-foreground mt-1">{member.district === 'At-Large' ? 'At-Large' : 'District'}</p>
            </div>
          </div>

          {/* Bio */}
          {member.bio && (
            <div className="border rounded-lg p-5">
              <h2 className="text-sm font-semibold mb-2">About</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{member.bio}</p>
            </div>
          )}

          {/* Legislative profile / bill analysis */}
          <LegislativeProfile memberId={member.id} memberName={member.name} />

          {/* Citizen approval */}
          <CouncilmemberVotePanel memberId={member.id} memberName={member.name} />

          {/* Contact */}
          <ContactSection member={member} />
        </div>
      )}

      {/* ── Bills tab ── */}
      {activeTab === 'bills' && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Bills sponsored by {member.name.split(' ')[0]}
            {bills?.total > 0 ? ` · ${bills.total} total` : ''}
          </p>

          {(!bills?.results || bills.results.length === 0) ? (
            <div className="border rounded-lg p-10 text-center space-y-2">
              <p className="text-sm text-muted-foreground">No sponsored bills found in the database yet.</p>
              <p className="text-xs text-muted-foreground">Bills are ingested daily from {CITY.fullCouncilName} Legistar.</p>
            </div>
          ) : (
            <>
              <div className={`space-y-2 transition-opacity ${billsLoading ? 'opacity-50' : 'opacity-100'}`}>
                {bills.results.map((bill: any) => (
                  <Link
                    key={bill.id}
                    href={`/${city}/legislation/${bill.id}`}
                    className="flex items-start justify-between gap-3 border rounded-lg p-3 hover:border-primary/60 hover:shadow-sm transition-all"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-mono text-muted-foreground">{bill.bill_number}</p>
                      <p className="text-sm font-medium leading-snug line-clamp-2 mt-0.5">
                        {bill.plain_title || bill.title}
                      </p>
                      {bill.introduced_date && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(bill.introduced_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {bill.impact_level && (
                        <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${IMPACT_COLORS[bill.impact_level] ?? ''}`}>
                          {bill.impact_level}
                        </span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[bill.status] ?? 'bg-gray-100 text-gray-700'}`}>
                        {bill.status ? fmtStatus(bill.status) : ''}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
              {bills.total > BILLS_PER_PAGE && (
                <div className="flex items-center justify-between pt-2 text-sm">
                  <span className="text-muted-foreground">
                    {((billsPage - 1) * BILLS_PER_PAGE) + 1}–{Math.min(billsPage * BILLS_PER_PAGE, bills.total)} of {bills.total}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => loadBillsPage(billsPage - 1)}
                      disabled={billsPage <= 1 || billsLoading}
                      className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-muted transition-colors"
                    >
                      ← Prev
                    </button>
                    <button
                      onClick={() => loadBillsPage(billsPage + 1)}
                      disabled={billsPage * BILLS_PER_PAGE >= bills.total || billsLoading}
                      className="px-3 py-1 rounded border text-sm disabled:opacity-40 hover:bg-muted transition-colors"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Votes tab ── */}
      {activeTab === 'votes' && (
        <div className="space-y-6">
          <VoteHistorySection memberId={id} />
          <SponsorActivityChart sponsorName={member.name} />
        </div>
      )}

      {/* ── Map tab ── */}
      {activeTab === 'map' && (
        <DistrictMap district={member.district} />
      )}

      <Link href={`/${city}/councilmembers`} className="inline-block text-sm text-muted-foreground hover:text-foreground transition-colors pt-2">
        ← All council members
      </Link>
    </div>
  )
}
