'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { api } from '@/lib/api'

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

// Legislation stores sponsors as "Councilmember Squilla" — match by last name
function extractLastName(fullName: string): string {
  const beforeComma = fullName.split(',')[0].trim()
  const parts = beforeComma.split(' ')
  return parts[parts.length - 1]
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

export default function CouncilmemberPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getCouncilmember(id)
      .then((d) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="h-32 bg-muted animate-pulse rounded-lg" />

  if (!data?.member) return (
    <div className="text-center py-16 text-muted-foreground">Council member not found.</div>
  )

  const { member, bills } = data as {
    member: any & { term_start?: number; years_serving?: number; next_election?: number }
    bills: any
  }

  return (
    <div className="max-w-3xl space-y-8">
      {/* Header */}
      <div className="flex items-start gap-6">
        <div className="shrink-0 w-24 h-24 rounded-full overflow-hidden bg-muted flex items-center justify-center">
          {member.photo_url ? (
            <img src={member.photo_url} alt={member.name} className="w-full h-full object-cover object-top" />
          ) : (
            <span className="text-3xl font-bold text-muted-foreground">{member.name[0]}</span>
          )}
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{member.name}</h1>
          <p className="text-muted-foreground mt-0.5">
            {member.district === 'At-Large' ? 'Councilmember At-Large' : `Councilmember, ${member.district}`}
          </p>
          <div className="flex flex-wrap gap-3 mt-3 text-sm text-muted-foreground">
            {member.email && (
              <a href={`mailto:${member.email}`} className="hover:text-foreground transition-colors">
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
                phlcouncil.com →
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Bio */}
      {member.bio && (
        <div className="border rounded-lg p-5">
          <h2 className="text-sm font-semibold mb-2">About</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{member.bio}</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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

      {/* Bill activity chart */}
      <SponsorActivityChart sponsorName={member.name} />

      {/* District Map */}
      <DistrictMap district={member.district} />

      {/* Bills */}
      <div>
        <h2 className="text-lg font-semibold mb-4">
          Sponsored Bills
          {bills?.total > 0 && <span className="text-sm font-normal text-muted-foreground ml-2">({bills.total} total)</span>}
        </h2>

        {(!bills?.results || bills.results.length === 0) ? (
          <p className="text-sm text-muted-foreground">No bills found in the database yet.</p>
        ) : (
          <div className="space-y-2">
            {bills.results.map((bill: any) => (
              <Link
                key={bill.id}
                href={`/legislation/${bill.id}`}
                className="flex items-start justify-between gap-3 border rounded-lg p-3 hover:border-primary/60 hover:shadow-sm transition-all"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono text-muted-foreground">{bill.bill_number}</p>
                  <p className="text-sm font-medium leading-snug line-clamp-2 mt-0.5">{bill.title}</p>
                  {bill.introduced_date && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(bill.introduced_date).toLocaleDateString()}
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
                    {bill.status?.replace(/_/g, ' ')}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Link href="/councilmembers" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
        ← All council members
      </Link>
    </div>
  )
}
