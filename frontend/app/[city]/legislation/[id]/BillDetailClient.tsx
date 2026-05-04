'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { PerspectivesPanel } from '@/components/PerspectivesPanel'
import { api } from '@/lib/api'
import { isLoggedIn } from '@/lib/auth'
import { usePostHog } from 'posthog-js/react'
import { STATUS_COLORS, STATUS_COLORS_FALLBACK, IMPACT_COLORS, VOTE_COLORS as VOTE_COLORS_MAP, HEARING_BADGE } from '@/lib/badge-colors'
import { fmtStatus } from '@/lib/utils'
import { CITY } from '@/lib/city'
import { LoginModal } from '@/components/LoginModal'

const LEVEL_LABELS: Record<string, string> = {
  federal: 'Federal',
  state: 'State',
  local: 'Local',
}

function buildGcalUrl(opts: { date: string; time?: string; body?: string; location?: string; billTitle: string; billNumber: string }): string {
  const d = new Date(opts.date)
  // Try to parse time string like "10:00 AM"
  if (opts.time) {
    const match = opts.time.match(/(\d+):(\d+)\s*(AM|PM)/i)
    if (match) {
      let h = parseInt(match[1]); const m = parseInt(match[2]); const ampm = match[3].toUpperCase()
      if (ampm === 'PM' && h < 12) h += 12
      if (ampm === 'AM' && h === 12) h = 0
      d.setHours(h, m, 0, 0)
    }
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  const fmt = (dt: Date) =>
    `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`
  const end = new Date(d.getTime() + 60 * 60 * 1000) // +1 hour
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Hearing: ${opts.billNumber} — ${opts.billTitle}`,
    dates: `${fmt(d)}/${fmt(end)}`,
    details: `${CITY.fullCouncilName} hearing: ${opts.body || ''}`,
    location: opts.location || `City Hall, ${CITY.name}`,
  })
  return `https://calendar.google.com/calendar/render?${params}`
}

function HearingBanner({ date, time, body, location, meetingUrl, billTitle, billNumber }: {
  date: string; time?: string; body?: string; location?: string; meetingUrl?: string; billTitle: string; billNumber: string
}) {
  const d = new Date(date)
  const formattedDate = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const gcalUrl = buildGcalUrl({ date, time, body, location, billTitle, billNumber })
  return (
    <div className="border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 rounded-lg p-4 space-y-1">
      <p className="font-semibold text-sm text-amber-900 dark:text-amber-200">Upcoming Hearing</p>
      {body && <p className="text-sm text-amber-800 dark:text-amber-300">{body}</p>}
      <p className="text-sm text-amber-700 dark:text-amber-300">{formattedDate}{time ? ` at ${time}` : ''}</p>
      {location && <p className="text-xs text-amber-600 dark:text-amber-400">{location}</p>}
      <div className="flex gap-3 mt-1">
        <a
          href={gcalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 underline"
        >
          Add to Google Calendar →
        </a>
        {meetingUrl && (
          <a
            href={meetingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-200 underline"
          >
            View full agenda →
          </a>
        )}
      </div>
    </div>
  )
}

// ── Roll call vote section ────────────────────────────────────────────────────

const VOTE_COLORS: Record<string, string> = {
  ...VOTE_COLORS_MAP,
  Absent: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

function RollCallSection({ legislationId }: { legislationId: string }) {
  const { city } = useParams<{ city: string }>()
  const [records, setRecords] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getRollCall(legislationId)
      .then((d) => setRecords(d?.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [legislationId])

  if (loading) return null
  if (records.length === 0) return null

  const yeas    = records.filter((r) => r.vote === 'Yea').length
  const nays    = records.filter((r) => r.vote === 'Nay').length
  const abstain = records.filter((r) => r.vote === 'Abstain').length
  const absent  = records.filter((r) => r.vote === 'Absent').length
  const result  = records[0]?.result

  return (
    <div className="border rounded-lg p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Council Vote</h2>
        {result && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            result.toLowerCase().includes('pass')
              ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
          }`}>
            {result}
          </span>
        )}
      </div>
      <div className="flex gap-4 text-sm">
        <span className="text-green-700 font-semibold">{yeas} Yea</span>
        <span className="text-red-700 font-semibold">{nays} Nay</span>
        {abstain > 0 && <span className="text-yellow-700">{abstain} Abstain</span>}
        {absent > 0  && <span className="text-gray-500">{absent} Absent</span>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {records.map((r) => (
          <div key={r.voter_name} className="flex items-center justify-between text-xs border rounded px-2 py-1">
            <span className="truncate text-foreground/80">
              {r.councilmember_id
                ? <a href={`/${city}/councilmembers/${r.councilmember_id}`} className="hover:underline hover:text-primary">{formatVoterName(r.voter_name)}</a>
                : formatVoterName(r.voter_name)
              }
            </span>
            <span className={`ml-2 shrink-0 px-1.5 py-0.5 rounded font-medium ${VOTE_COLORS[r.vote] ?? 'bg-gray-100 text-gray-600'}`}>
              {r.vote}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatVoterName(raw: string): string {
  // Convert "Last, First" → "First Last"
  const parts = raw.split(',')
  if (parts.length === 2) return `${parts[1].trim()} ${parts[0].trim()}`
  return raw
}

// ── Citizen vs rep callout ────────────────────────────────────────────────────

const CITIZEN_TO_LEGISTAR: Record<string, string> = {
  support: 'Yea',
  oppose:  'Nay',
}

function RepVoteCallout({ legislationId, members, yourVote }: {
  legislationId: string
  members: any[]
  yourVote: string | null
}) {
  const { city } = useParams<{ city: string }>()
  const [repVote, setRepVote]   = useState<string | null>(null)
  const [repName, setRepName]   = useState<string | null>(null)
  const [repId, setRepId]       = useState<string | null>(null)

  useEffect(() => {
    if (!yourVote || members.length === 0) return
    const savedAddress = typeof window !== 'undefined' ? localStorage.getItem('cg_user_address') : null
    if (!savedAddress) return

    Promise.all([
      resolveCouncilmember(savedAddress, members),
      api.getRollCall(legislationId),
    ]).then(([result, rollCallData]) => {
      if (typeof result === 'string') return
      const rollCall: any[] = rollCallData?.data ?? []
      const memberLastName = result.member.name.split(' ').pop()?.toLowerCase() ?? ''
      const matchedVote = rollCall.find((r) => {
        const lastName = r.voter_name.split(',')[0].trim().toLowerCase()
        return lastName === memberLastName
      })
      if (matchedVote) {
        setRepName(result.member.name)
        setRepId(result.member.id)
        setRepVote(matchedVote.vote)
      }
    }).catch(() => {})
  }, [legislationId, members, yourVote])

  if (!repVote || !yourVote || !repName) return null

  const citizenLegistar = CITIZEN_TO_LEGISTAR[yourVote]
  const agree = citizenLegistar === repVote

  return (
    <div className={`border rounded-lg p-4 flex items-start gap-3 ${agree ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-900/20' : 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20'}`}>
      <div className="mt-0.5 shrink-0">
        {agree ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-green-600 dark:text-green-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-amber-600 dark:text-amber-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        )}
      </div>
      <div className="text-sm">
        <p className={`font-semibold ${agree ? 'text-green-900 dark:text-green-300' : 'text-amber-900 dark:text-amber-300'}`}>
          {agree ? 'You and your rep agree on this bill' : 'You and your rep disagree on this bill'}
        </p>
        <p className={`mt-0.5 ${agree ? 'text-green-800 dark:text-green-400' : 'text-amber-800 dark:text-amber-400'}`}>
          You <span className="font-medium capitalize">{yourVote}d</span> this bill.{' '}
          <Link href={`/${city}/councilmembers/${repId}`} className="font-medium hover:underline">
            {repName}
          </Link>{' '}
          voted <span className="font-medium">{repVote}</span>.
        </p>
      </div>
    </div>
  )
}

// ── Point-in-polygon helpers (shared with councilmembers list) ────────────────
function pipTest(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function districtFromGeoJSON(lat: number, lng: number, geojson: any): number | null {
  for (const f of (geojson.features ?? [])) {
    const p = f?.properties ?? {}
    const num = Number(p?.DISTRICT ?? p?.District ?? p?.district ?? p?.DIST_NUM ?? p?.districtNum ?? NaN)
    if (isNaN(num)) continue
    const rings: number[][][] = f.geometry?.type === 'Polygon' ? [f.geometry.coordinates[0]]
      : f.geometry?.type === 'MultiPolygon' ? f.geometry.coordinates.map((c: any) => c[0]) : []
    for (const ring of rings) { if (pipTest(lat, lng, ring)) return num }
  }
  return null
}
async function resolveCouncilmember(address: string, members: any[]): Promise<{ member: any; district: string } | string> {
  const geoAbort = new AbortController()
  const geoTimeout = setTimeout(() => geoAbort.abort(), 8000)
  const geoRes = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address + ', Philadelphia, PA')}&format=json&limit=1`,
    { headers: { 'User-Agent': 'CommonGround/1.0 civic-app' }, signal: geoAbort.signal }
  )
  clearTimeout(geoTimeout)
  const geoData = await geoRes.json()
  if (!geoData.length) return 'Address not found. Try including street number and name.'
  const lat = parseFloat(geoData[0].lat), lng = parseFloat(geoData[0].lon)
  const gjRes = await fetch('/api/councilmembers/districts-geojson')
  const geojson = await gjRes.json()
  const num = districtFromGeoJSON(lat, lng, geojson)
  if (!num) return 'Could not match that address to a Philadelphia district.'
  const member = members.find((m: any) => m.district === `District ${num}`)
  if (!member) return `Found District ${num} but no matching councilmember on file.`
  return { member, district: `District ${num}` }
}

const ADDRESS_KEY = 'cg_user_address'

function ContactMyCouncilmember({ members, billTitle, billNumber }: { members: any[]; billTitle: string; billNumber: string }) {
  const [address, setAddress] = useState(() => (typeof window !== 'undefined' ? localStorage.getItem(ADDRESS_KEY) ?? '' : ''))
  const [showPrompt, setShowPrompt] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [member, setMember] = useState<any>(null)

  const resolveAndOpen = async (addr: string) => {
    setLoading(true); setError(null)
    const result = await resolveCouncilmember(addr, members).catch((e) => e.message as string)
    setLoading(false)
    if (typeof result === 'string') { setError(result); return }
    localStorage.setItem(ADDRESS_KEY, addr)
    setAddress(addr)
    setMember(result.member)
    setShowPrompt(false)
    openGmail(result.member, billTitle, billNumber)
  }

  const handleClick = () => {
    if (address) {
      // Already have address — resolve immediately
      resolveAndOpen(address)
    } else {
      setShowPrompt(true)
    }
  }

  return (
    <div className="mt-3">
      {!showPrompt ? (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleClick}
            disabled={loading || members.length === 0}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border hover:bg-muted transition-colors disabled:opacity-50"
          >
            {loading ? 'Looking up…' : 'Contact my councilmember'}
          </button>
          {address && (
            <button
              onClick={() => { setAddress(''); localStorage.removeItem(ADDRESS_KEY); setMember(null) }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Change address
            </button>
          )}
          {error && <p className="text-xs text-red-600 w-full">{error}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Enter your address to find your district councilmember:</p>
          <div className="flex gap-2">
            <input
              type="text"
              autoFocus
              aria-label="Your street address"
              placeholder="123 Main St"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && inputVal.trim() && resolveAndOpen(inputVal.trim())}
              className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              onClick={() => inputVal.trim() && resolveAndOpen(inputVal.trim())}
              disabled={loading || !inputVal.trim()}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              {loading ? '…' : 'Find'}
            </button>
            <button onClick={() => setShowPrompt(false)} className="text-xs text-muted-foreground px-2">Cancel</button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}

function openGmail(member: any, billTitle: string, billNumber: string) {
  const subject = `Philadelphia City Council — ${billNumber}`
  const body = `Dear ${member.name},

I am a Philadelphia resident writing about ${billNumber}: ${billTitle}.

[Share your position here.]

Thank you for your service to our community.

Sincerely,
[Your name]
[Your address]`

  if (member.email) {
    window.open(`mailto:${member.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`)
  } else if (member.profile_url) {
    window.open(member.profile_url, '_blank')
  }
}

// ── Bill status timeline ─────────────────────────────────────────────────────

// Ordered steps that match actual DB statuses
const STATUS_STEPS = [
  { key: 'introduced',      label: 'Introduced' },
  { key: 'in_committee',    label: 'In Committee' },
  { key: 'signed_into_law', label: 'Signed into Law' },
] as const

type StepKey = typeof STATUS_STEPS[number]['key']

const TERMINAL_FAIL: Record<string, string> = {
  failed: 'Failed',
  vetoed: 'Vetoed',
}

function StatusTimeline({ status }: { status: string }) {
  const failLabel = TERMINAL_FAIL[status]
  const activeIdx = STATUS_STEPS.findIndex((s) => s.key === status)
  // Unknown non-terminal status — treat as introduced (index 0)
  const effectiveIdx = activeIdx >= 0 ? activeIdx : (failLabel ? -1 : 0)

  // primary blue used by this app
  const PRIMARY = 'hsl(221.2 83.2% 53.3%)'
  const GRAY    = '#d1d5db'
  const FADED   = '#e5e7eb'

  return (
    <div className="flex items-center w-full py-1">
      {STATUS_STEPS.map((step, i) => {
        const isPast    = !failLabel && effectiveIdx > i
        const isCurrent = !failLabel && effectiveIdx === i
        const active    = isPast || isCurrent

        return (
          <div key={step.key} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center shrink-0">
              <div
                className="w-5 h-5 rounded-full border-2 flex items-center justify-center"
                style={{
                  backgroundColor: active ? PRIMARY : 'white',
                  borderColor:     active ? PRIMARY : GRAY,
                }}
              >
                {isPast && (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {isCurrent && <div className="w-2 h-2 rounded-full bg-white" />}
              </div>
              <span
                className="text-[10px] mt-1 whitespace-nowrap"
                style={{ color: active ? '#111' : '#9ca3af', fontWeight: active ? 600 : 400 }}
              >
                {step.label}
              </span>
            </div>
            {i < STATUS_STEPS.length - 1 && (
              <div
                className="flex-1 h-0.5 mx-1"
                style={{ backgroundColor: isPast ? PRIMARY : FADED, marginTop: '-10px' }}
              />
            )}
          </div>
        )
      })}
      {/* Terminal failure node */}
      {failLabel && (
        <div className="flex items-center flex-1 min-w-0">
          <div className="flex-1 h-0.5 mx-1 mt-[-10px]" style={{ backgroundColor: FADED }} />
          <div className="flex flex-col items-center shrink-0">
            <div className="w-5 h-5 rounded-full border-2 flex items-center justify-center"
              style={{ backgroundColor: '#ef4444', borderColor: '#ef4444' }}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <span className="text-[10px] mt-1 whitespace-nowrap font-medium" style={{ color: '#ef4444' }}>
              {failLabel}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Related bills ─────────────────────────────────────────────────────────────

function RelatedBills({ billId, tags, sponsor }: { billId: string; tags: string[]; sponsor?: string }) {
  const { city } = useParams<{ city: string }>()
  const [bills, setBills] = useState<any[]>([])

  useEffect(() => {
    const firstTag = tags[0]
    if (!firstTag && !sponsor) return

    const fetches: Promise<any[]>[] = []
    if (firstTag) {
      fetches.push(
        api.searchLegislation('', 6, 0, '', '', firstTag, '', 0, 0, '', '')
          .then((d) => d?.results ?? [])
          .catch(() => [])
      )
    }
    if (sponsor) {
      const lastName = sponsor.split(',')[0].trim().split(' ').pop() ?? ''
      fetches.push(
        api.searchLegislation('', 6, 0, '', '', '', '', 0, 0, '', lastName)
          .then((d) => d?.results ?? [])
          .catch(() => [])
      )
    }

    Promise.all(fetches).then((results) => {
      const seen = new Set([billId])
      const merged: any[] = []
      for (const list of results) {
        for (const b of list) {
          if (!seen.has(b.id)) { seen.add(b.id); merged.push(b) }
        }
      }
      setBills(merged.slice(0, 5))
    })
  }, [billId, tags, sponsor])

  if (bills.length === 0) return null

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3">Related Bills</h2>
      <div className="space-y-2">
        {bills.map((b) => (
          <Link
            key={b.id}
            href={`/${city}/legislation/${b.id}`}
            className="flex items-start gap-3 border rounded-lg p-3 hover:border-primary/60 hover:shadow-sm transition-all group"
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono text-muted-foreground">{b.bill_number}</p>
              <p className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors mt-0.5">
                {b.plain_title || b.title}
              </p>
              {b.summary && (
                <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{b.summary}</p>
              )}
            </div>
            {b.impact_level && (
              <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full capitalize font-medium mt-0.5 ${IMPACT_COLORS[b.impact_level] ?? ''}`}>{b.impact_level}</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}

function SponsorLinks({ sponsor, members }: { sponsor: string; members: any[] }) {
  const { city } = useParams<{ city: string }>()
  if (!sponsor) return null
  // Split multiple sponsors by comma
  const parts = sponsor.split(',').map((s) => s.trim()).filter(Boolean)
  return (
    <p className="text-sm text-muted-foreground mt-1">
      Sponsor:{' '}
      {parts.map((part, i) => {
        // Match by last name
        const lastName = part.split(' ').pop()?.toLowerCase() ?? ''
        const match = members.find((m) => m.name.toLowerCase().includes(lastName))
        return (
          <span key={i}>
            {i > 0 && ', '}
            {match ? (
              <Link href={`/${city}/councilmembers/${match.id}`} className="hover:underline text-foreground">
                {part}
              </Link>
            ) : (
              part
            )}
          </span>
        )
      })}
    </p>
  )
}

// Strip Legistar print headers that repeat on every page:
//   "City of Philadelphia\nPrinted on [date]\nPage N of N\npowered by Legistar™\n\nFile #: …\n"
// Then collapse runs of 3+ blank lines down to a single blank line.
function cleanBillText(raw: string): string {
  return raw
    .replace(/City of Philadelphia\s*\nPrinted on [^\n]+\nPage \d+ of \d+\npowered by Legistar[^\n]*(?:\n\nFile #:[^\n]+\n?)?/g, '')
    .replace(/(\n\s*){3,}/g, '\n\n')
    .trim()
}

type TabKey = 'summary' | 'perspectives' | 'votes' | 'news' | 'text'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'summary',      label: 'Summary' },
  { key: 'perspectives', label: 'Perspectives' },
  { key: 'votes',        label: 'Votes' },
  { key: 'news',         label: 'News' },
  { key: 'text',         label: 'Bill Text' },
]

export default function BillDetailClient() {
  const { city, id } = useParams<{ city: string; id: string }>()
  const searchParams = useSearchParams()
  const [leg, setLeg] = useState<any>(null)
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tracked, setTracked] = useState(false)
  const [voteCounts, setVoteCounts] = useState<Record<string, number>>({ support: 0, neutral: 0, oppose: 0 })
  const [isAdmin, setIsAdmin] = useState(false)
  const [copied, setCopied] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [yourVote, setYourVote] = useState<string | null>(null)
  const [perspectivesCount, setPerspectivesCount] = useState(0)
  const [rollCallCount, setRollCallCount] = useState(0)
  const [stickyVisible, setStickyVisible] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const t = searchParams?.get('tab')
    return (t === 'perspectives' || t === 'votes' || t === 'news') ? t : 'summary'
  })
  const titleRef = useRef<HTMLHeadingElement>(null)
  const posthog = usePostHog()

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      posthog?.capture('bill_shared', { bill_id: id })
    })
  }
  const loggedIn = isLoggedIn()

  const loadData = useCallback(() => {
    // Phase 1: load bill (includes perspectives + vote_records inline)
    Promise.all([
      api.getLegislation(id),
      api.getCouncilmembers().catch(() => ({ members: [] })),
      loggedIn ? api.getTrackedBillIds().catch(() => ({ ids: [] })) : Promise.resolve({ ids: [] }),
      loggedIn ? api.getMe().catch(() => null) : Promise.resolve(null),
    ])
      .then(([legData, cmData, trackData, meData]) => {
        const bill = legData?.data ?? null
        setLeg(bill)
        setMembers(cmData?.members ?? [])
        setTracked((trackData?.ids ?? []).includes(id))
        setIsAdmin(meData?.user?.subscription_tier === 'dev')
        // perspectives and roll call count come from getLegislation now
        setPerspectivesCount((bill?.perspectives ?? []).length)
        setRollCallCount((bill?.vote_records?.length ?? 0))
        if (bill) {
          posthog?.capture('bill_viewed', {
            bill_id: id,
            title: bill.plain_title || bill.title,
            impact_level: bill.impact_level,
            tags: bill.tags,
          })
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id, loggedIn])

  useEffect(() => { loadData() }, [loadData])

  // Show sticky header once the bill title scrolls out of view
  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setStickyVisible(!entry.isIntersecting),
      { threshold: 0 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [leg])

  const handleToggleTrack = useCallback(async () => {
    try {
      const data = await api.toggleTrackBill(id)
      const nowTracked = data?.tracked ?? false
      setTracked(nowTracked)
      toast.success(nowTracked ? 'Bill saved to your list' : 'Bill removed from your list')
      posthog?.capture('bill_tracked', { bill_id: id, tracked: nowTracked })
    } catch {
      toast.error('Failed to update saved bills')
    }
  }, [id, posthog])

  if (loading) return null

  if (!leg) return (
    <div className="text-center py-16 text-muted-foreground">
      Legislation not found.
    </div>
  )

  const statusColor = STATUS_COLORS[leg.status] ?? STATUS_COLORS_FALLBACK
  const impactColor = leg.impact_level ? IMPACT_COLORS[leg.impact_level] : null

  let tags: string[] = []
  try { tags = leg.tags ? JSON.parse(leg.tags) : [] } catch { tags = [] }

  let newsLinks: { title: string; url: string; source: string; published: string }[] = []
  try { newsLinks = leg.news_links ? JSON.parse(leg.news_links) : [] } catch { newsLinks = [] }

  type ContextSection = { label: string; stats: Record<string, string>; source: string }
  let cityContext: ContextSection[] = []
  try { cityContext = leg.supplementary_data ? JSON.parse(leg.supplementary_data) : [] } catch { cityContext = [] }

  return (
    <div className="max-w-3xl space-y-8">

      {/* Back navigation */}
      <Link
        href={`/${city}/legislation`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
        </svg>
        All legislation
      </Link>

      {/* Sticky compact header — fades in after title scrolls out, sits below navbar */}
      <div
        aria-hidden={!stickyVisible}
        className={`fixed top-14 left-0 right-0 z-40 bg-background/95 backdrop-blur border-b px-4 py-2 flex items-center gap-3 shadow-sm transition-all duration-150 ${
          stickyVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1 pointer-events-none'
        }`}
      >
        <div className="max-w-3xl mx-auto w-full flex items-center gap-3">
          <span className="text-xs font-mono text-muted-foreground shrink-0">{leg.bill_number}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${statusColor}`}>
            {leg.status ? fmtStatus(leg.status) : ''}
          </span>
          <p className="text-sm font-semibold truncate flex-1">{leg.plain_title || leg.title}</p>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={handleShare} className="p-1.5 text-muted-foreground hover:text-primary transition-colors" aria-label="Copy link">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </button>
            {loggedIn && (
              <button onClick={handleToggleTrack} className={`p-1.5 transition-colors ${tracked ? 'text-primary' : 'text-muted-foreground hover:text-primary'}`} aria-label={tracked ? 'Unsave bill' : 'Save bill'}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-4 h-4" fill={tracked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <Badge variant="outline" className="text-xs">
            {LEVEL_LABELS[leg.level] ?? leg.level}
          </Badge>
          <Badge variant="outline" className={`text-xs ${statusColor}`}>
            {leg.status ? fmtStatus(leg.status) : ''}
          </Badge>
          {impactColor && (
            <Badge variant="outline" className={`text-xs ${impactColor}`}>
              {leg.impact_level} impact{leg.impact_score ? ` · ${leg.impact_score}/10` : ''}
            </Badge>
          )}
          {leg.bill_type && (
            <Badge variant="outline" className="text-xs capitalize">
              {leg.bill_type}
            </Badge>
          )}
          <span className="text-sm text-muted-foreground">{leg.bill_number}</span>
        </div>

        <div className="flex items-start gap-3">
          <div className="flex-1">
            {leg.plain_title
              ? <>
                  <h1 ref={titleRef} className="text-2xl font-bold leading-snug">{leg.plain_title}</h1>
                  <p className="text-xs text-muted-foreground/70 mt-1 leading-snug">
                    <span className="uppercase tracking-wide font-medium text-[10px] mr-1">Official:</span>
                    {leg.title}
                  </p>
                </>
              : <h1 ref={titleRef} className="text-2xl font-bold leading-snug">{leg.title}</h1>
            }
          </div>
          <div className="flex items-center gap-1 shrink-0 mt-1">
            <div className="relative">
              <button
                onClick={() => setExportOpen(o => !o)}
                className="p-1.5 rounded-lg border-transparent text-muted-foreground hover:text-primary hover:border-muted border transition-colors"
                title="Export bill"
                aria-label="Export bill"
                aria-expanded={exportOpen}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
              {exportOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} aria-hidden />
                  <div className="absolute right-0 top-full mt-1 flex flex-col bg-background border rounded-lg shadow-md overflow-hidden z-20 min-w-[80px]">
                    <a
                      href={`/api/legislation/${id}/export?format=csv`}
                      download
                      onClick={() => setExportOpen(false)}
                      className="px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors"
                    >
                      CSV
                    </a>
                    <a
                      href={`/api/legislation/${id}/export?format=json`}
                      download
                      onClick={() => setExportOpen(false)}
                      className="px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-zinc-700 transition-colors border-t"
                    >
                      JSON
                    </a>
                  </div>
                </>
              )}
            </div>
            <button
              onClick={handleShare}
              className="p-1.5 rounded-lg border-transparent text-muted-foreground hover:text-primary hover:border-muted border transition-colors"
              title="Copy link"
              aria-label="Copy link to bill"
            >
              {copied ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              )}
            </button>
            {loggedIn && (
              <button
                onClick={handleToggleTrack}
                className={`p-1.5 rounded-lg border transition-colors ${
                  tracked ? 'border-primary text-primary bg-primary/5' : 'border-transparent text-muted-foreground hover:text-primary hover:border-muted'
                }`}
                title={tracked ? 'Unsave bill' : 'Save bill'}
                aria-label={tracked ? 'Unsave bill' : 'Save bill'}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="w-5 h-5" fill={tracked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {leg.sponsor && <SponsorLinks sponsor={leg.sponsor} members={members} />}

        {leg.introduced_date && (
          <p className="text-sm text-muted-foreground">
            Introduced: {new Date(leg.introduced_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        )}
        {leg.final_date && (
          <p className="text-sm text-muted-foreground">
            {leg.status === 'signed_into_law' ? 'Signed' : leg.status === 'vetoed' ? 'Vetoed' : leg.status === 'failed' ? 'Failed' : 'Voted'}: {new Date(leg.final_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        )}
        {leg.committee && (
          <p className="text-sm text-muted-foreground">
            Committee: {leg.committee}
          </p>
        )}

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map((tag: string) => (
              <span key={tag} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800 px-2 py-0.5 rounded-full font-medium capitalize">{tag}</span>
            ))}
          </div>
        )}
      </div>

      {/* Status timeline */}
      {leg.status && <StatusTimeline status={leg.status} />}

      {/* Plain-language summary — always visible regardless of active tab */}
      {leg.summary ? (
        <div className="border rounded-lg p-5 space-y-1">
          <h2 className="text-sm font-semibold">Plain-Language Summary</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{leg.summary}</p>
        </div>
      ) : !leg.analyzed_at && (
        <div className="border border-dashed rounded-lg p-5 text-center space-y-1">
          <p className="text-sm font-medium text-muted-foreground">This bill hasn&apos;t been analyzed yet.</p>
          <p className="text-xs text-muted-foreground">A plain-English summary, impact score, and AI perspectives will appear here once it&apos;s processed.</p>
        </div>
      )}

      {/* Tab bar — shifts down when sticky header is showing (navbar 56px + sticky header ~48px = 104px) */}
      <div className={`flex border-b gap-0 sticky ${stickyVisible ? 'top-[6.5rem]' : 'top-14'} bg-background z-10 pt-1 overflow-x-auto scrollbar-hide transition-[top] duration-150`}>
        {TABS.filter((tab) => {
          if (tab.key === 'text') return !!(leg.full_text && leg.full_text !== leg.description)
          const isActive = ['introduced', 'in_committee'].includes(leg.status?.toLowerCase())
          if (tab.key === 'perspectives') return isActive || perspectivesCount > 0
          if (tab.key === 'news') return isActive || newsLinks.length > 0
          return true
        }).map((tab) => {
          const badge =
            tab.key === 'perspectives' && perspectivesCount > 0 ? perspectivesCount :
            tab.key === 'news'         && newsLinks.length > 0   ? newsLinks.length :
            tab.key === 'votes'        && rollCallCount > 0      ? rollCallCount :
            null
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {badge !== null && (
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.key
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Summary tab ─────────────────────────────────────── */}
      {activeTab === 'summary' && (
        <div className="space-y-6">
          {/* Upcoming Hearing Banner — most time-sensitive, first */}
          {leg.next_hearing_date && (
            <HearingBanner
              date={leg.next_hearing_date}
              time={leg.next_hearing_time}
              body={leg.next_hearing_body}
              location={leg.next_hearing_location}
              meetingUrl={leg.next_hearing_url}
              billTitle={leg.plain_title || leg.title}
              billNumber={leg.bill_number}
            />
          )}

          {/* Vote CTA — prominent, right after the summary */}
          <div className="border rounded-lg p-5 space-y-3">
            <div>
              <h2 className="text-sm font-semibold">What do you think?</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Cast your vote and see how the community stands.</p>
            </div>
            <VotePanel billId={id} onCountsChange={setVoteCounts} onVoteChange={setYourVote} inline />
          </div>

          {/* Contact My Councilmember — after user has read the summary */}
          {members.length > 0 && (
            <ContactMyCouncilmember
              members={members}
              billTitle={leg.plain_title || leg.title}
              billNumber={leg.bill_number}
            />
          )}

          {/* Related bills — discovery, shown right after the summary */}
          <RelatedBills billId={id} tags={tags} sponsor={leg.sponsor} />

          {/* Philadelphia Context */}
          {cityContext.length > 0 && (
            <div className="border rounded-lg p-5 space-y-4">
              <h2 className="text-sm font-semibold">Philadelphia Context</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cityContext.map((section) => (
                  <div key={section.label} className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {section.label}
                    </p>
                    <ul className="space-y-0.5">
                      {Object.entries(section.stats).map(([k, v]) => (
                        <li key={k} className="text-xs text-muted-foreground leading-snug">
                          <span className="text-foreground/80">{k}:</span> {v}
                        </li>
                      ))}
                    </ul>
                    <p className="text-[10px] text-muted-foreground/50 pt-0.5">{section.source}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Perspectives tab ─────────────────────────────────── */}
      {activeTab === 'perspectives' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold">AI Perspectives</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Simulated viewpoints generated by AI — not real people</p>
          </div>
          <PerspectivesPanel billId={id} analyzed={!!leg.analyzed_at} isAdmin={isAdmin} onLoad={setPerspectivesCount} />
        </div>
      )}

      {/* ── Votes tab ────────────────────────────────────────── */}
      {activeTab === 'votes' && (
        <div className="space-y-6">
          <RollCallSection legislationId={id} />
          <VotePanel billId={id} onCountsChange={setVoteCounts} onVoteChange={setYourVote} />
          <RepVoteCallout legislationId={id} members={members} yourVote={yourVote} />
          <CombinedSentimentBar perspectives={leg?.perspectives ?? []} voteCounts={voteCounts} />
        </div>
      )}

      {/* ── News tab ─────────────────────────────────────────── */}
      {activeTab === 'news' && (
        newsLinks.length > 0 ? (
          <div className="space-y-2">
            {newsLinks.map((article, i) => (
              <a
                key={i}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 border rounded-lg p-3 hover:border-primary/60 hover:shadow-sm transition-all group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-snug group-hover:text-primary transition-colors line-clamp-2">
                    {article.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {article.source && <span className="text-xs text-muted-foreground">{article.source}</span>}
                    {article.published && <span className="text-xs text-muted-foreground">· {new Date(article.published).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
                  </div>
                </div>
                <span className="text-muted-foreground text-sm shrink-0 mt-0.5">→</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">No news coverage found for this bill.</p>
        )
      )}

      {/* ── Text tab ─────────────────────────────────────────── */}
      {activeTab === 'text' && (
        <div className="space-y-5">
          {leg.description && !leg.summary && (
            <div className="border rounded-lg p-5 space-y-1">
              <h2 className="text-sm font-semibold">Description</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{leg.description}</p>
            </div>
          )}

          {leg.full_text && leg.full_text !== leg.description && (
            <div className="border rounded-lg p-5 space-y-3">
              <h2 className="text-sm font-semibold">Full Bill Text</h2>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap border-l-2 border-muted pl-4">
                {cleanBillText(leg.full_text)}
              </p>
            </div>
          )}

          {leg.external_url && (
            <a
              href={leg.external_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              View on Legistar (official source)
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
              </svg>
            </a>
          )}
        </div>
      )}

      {/* Admin floating panel — always visible */}
      {isAdmin && <AdminFloatingPanel billId={id} leg={leg} onRefresh={loadData} />}

      <Link href={`/${city}/legislation`} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
        ← All legislation
      </Link>
    </div>
  )
}

// ── Admin Floating Panel ──────────────────────────────────────────────────────

type AdminAction = {
  label: string
  runningLabel: string
  fn: () => Promise<any>
  disabled?: boolean
  disabledReason?: string
  warn?: boolean
}

function AdminFloatingPanel({ billId, leg, onRefresh }: { billId: string; leg: any; onRefresh: () => void }) {
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})

  const run = async (key: string, fn: () => Promise<any>) => {
    setRunning(key)
    setResults((r) => ({ ...r, [key]: undefined as any }))
    try {
      const data = await fn()
      let msg = 'Done'
      if (key === 'details') msg = `Full text: ${data?.has_full_text ? 'fetched' : 'not found'} · Sponsor: ${data?.has_sponsor ? 'fetched' : 'not found'}`
      if (key === 'analyze') msg = `Impact: ${data?.impact_level ?? '?'} (${data?.impact_score ?? '?'}/10) · ${data?.bill_type ?? '?'}`
      if (key === 'perspectives') msg = `Generated ${data?.perspectives_generated?.length ?? 0} perspectives`
      if (key === 'news') msg = `Found ${data?.articles_found ?? 0} articles`
      setResults((r) => ({ ...r, [key]: { ok: true, message: msg } }))
      onRefresh()
    } catch (err: any) {
      setResults((r) => ({ ...r, [key]: { ok: false, message: err?.message ?? 'Failed' } }))
    } finally {
      setRunning(null)
    }
  }

  const isBusy = running !== null

  const isActiveBill = ['introduced', 'in_committee'].includes(leg.status?.toLowerCase())

  const actions: { key: string; label: string; runningLabel: string; fn: () => Promise<any>; warn?: boolean; disabled?: boolean; disabledReason?: string }[] = [
    {
      key: 'details',
      label: 'Fetch Full Text & Sponsors',
      runningLabel: 'Fetching…',
      fn: () => api.fetchBillDetails(billId),
    },
    {
      key: 'analyze',
      label: leg.analyzed_at ? 'Re-analyze' : 'Analyze Bill',
      runningLabel: 'Analyzing…',
      fn: () => api.analyzeLegislation(billId),
    },
    {
      key: 'perspectives',
      label: 'Generate All Perspectives',
      runningLabel: 'Generating…',
      fn: () => api.generateAllPerspectives(billId),
      disabled: !isActiveBill,
      disabledReason: 'Active bills only',
    },
    {
      key: 'news',
      label: 'Fetch News Articles',
      runningLabel: 'Fetching…',
      fn: () => api.fetchBillNews(billId),
      disabled: !isActiveBill,
      disabledReason: 'Active bills only',
    },
  ]

  // Data status indicators
  const checks = [
    { label: 'Full text',    ok: !!leg.full_text },
    { label: 'Sponsor',      ok: !!leg.sponsor },
    { label: 'Analyzed',     ok: !!leg.analyzed_at },
    { label: 'Summary',      ok: !!leg.summary },
    { label: 'Tags',         ok: !!leg.tags && leg.tags !== '[]' },
    { label: 'Plain title',  ok: !!leg.plain_title },
    { label: 'News',         ok: !!leg.news_links && leg.news_links !== '[]' },
    { label: 'City context', ok: !!leg.supplementary_data },
  ]

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="w-72 rounded-xl border bg-white shadow-xl overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
            <span className="text-sm font-semibold">Admin Panel</span>
            <span className="text-xs text-muted-foreground truncate ml-2">{leg.bill_number}</span>
          </div>

          {/* Status grid */}
          <div className="px-4 py-3 border-b grid grid-cols-2 gap-x-4 gap-y-1">
            {checks.map(({ label, ok }) => (
              <div key={label} className="flex items-center gap-1.5 text-xs">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ok ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className={ok ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="p-3 space-y-1.5">
            {actions.map(({ key, label, runningLabel, fn, disabled, disabledReason }) => {
              const result = results[key]
              const isDisabled = isBusy || disabled
              return (
                <div key={key}>
                  <button
                    onClick={() => !disabled && run(key, fn)}
                    disabled={isDisabled}
                    title={disabled ? disabledReason : undefined}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg border font-medium transition-colors hover:bg-muted/40 disabled:opacity-50"
                  >
                    <span className="flex items-center justify-between">
                      <span>{running === key ? runningLabel : label}</span>
                      {disabled && disabledReason && (
                        <span className="text-[10px] text-muted-foreground font-normal">{disabledReason}</span>
                      )}
                    </span>
                  </button>
                  {result && (
                    <p className={`text-[10px] px-1 mt-0.5 ${result.ok ? 'text-green-600' : 'text-destructive'}`}>
                      {result.message}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="h-10 w-10 rounded-full bg-gray-900 text-white shadow-lg flex items-center justify-center hover:bg-gray-700 transition-colors"
        title="Admin Panel"
      >
        {open ? (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </button>
    </div>
  )
}

// ── Combined Sentiment Bar ────────────────────────────────────────────────────

function CombinedSentimentBar({ perspectives: perspectivesProp, voteCounts }: { perspectives: { position: string }[]; voteCounts: Record<string, number> }) {
  const perspCounts = (() => {
    const p = { support: 0, neutral: 0, oppose: 0 } as Record<string, number>
    for (const persp of perspectivesProp ?? []) {
      const pos = persp.position === 'mixed' ? 'neutral' : persp.position
      if (pos in p) p[pos]++
    }
    return p
  })()

  const totals = {
    support: (voteCounts.support ?? 0) + perspCounts.support,
    neutral: (voteCounts.neutral ?? 0) + perspCounts.neutral,
    oppose:  (voteCounts.oppose  ?? 0) + perspCounts.oppose,
  }
  const total = totals.support + totals.neutral + totals.oppose
  if (total === 0) return null

  const pct = (n: number) => Math.round((n / total) * 100)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium">Combined Sentiment</span>
        <span className="flex gap-3">
          {totals.support > 0 && <span className="text-green-600">{pct(totals.support)}% support</span>}
          {totals.neutral > 0 && <span className="text-gray-500">{pct(totals.neutral)}% neutral</span>}
          {totals.oppose  > 0 && <span className="text-red-600">{pct(totals.oppose)}% oppose</span>}
        </span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden gap-px bg-muted">
        {totals.support > 0 && <div className="bg-green-500 transition-all" style={{ width: `${pct(totals.support)}%` }} />}
        {totals.neutral > 0 && <div className="bg-gray-400 transition-all"  style={{ width: `${pct(totals.neutral)}%` }} />}
        {totals.oppose  > 0 && <div className="bg-red-500 transition-all"   style={{ width: `${pct(totals.oppose)}%`  }} />}
      </div>
      <p className="text-[10px] text-muted-foreground/50">Citizens + AI perspectives combined · {total} signals</p>
    </div>
  )
}

// ── Vote Panel ────────────────────────────────────────────────────────────────

const VOTE_OPTIONS = [
  { value: 'support', label: 'Support', active: 'bg-green-500 text-white border-green-500', inactive: 'hover:border-green-400 hover:text-green-700' },
  { value: 'neutral', label: 'Neutral', active: 'bg-gray-500 text-white border-gray-500', inactive: 'hover:border-gray-400 hover:text-gray-700' },
  { value: 'oppose',  label: 'Oppose',  active: 'bg-red-500 text-white border-red-500',   inactive: 'hover:border-red-400 hover:text-red-700' },
] as const

function _getOrCreateVoterToken(): string {
  if (typeof window === 'undefined') return ''
  const key = 'cg_voter_token'
  let token = localStorage.getItem(key)
  if (!token) {
    token = crypto.randomUUID()
    localStorage.setItem(key, token)
  }
  return token
}

function VotePanel({ billId, onCountsChange, onVoteChange, inline }: { billId: string; onCountsChange?: (c: Record<string, number>) => void; onVoteChange?: (v: string | null) => void; inline?: boolean }) {
  const [counts, setCounts] = useState<Record<string, number>>({ support: 0, neutral: 0, oppose: 0 })
  const [myVote, setMyVote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const submittingRef = useRef(false)
  const voterToken = typeof window !== 'undefined' ? _getOrCreateVoterToken() : ''
  const posthog = usePostHog()

  const updateCounts = useCallback((c: Record<string, number>) => {
    setCounts(c)
    onCountsChange?.(c)
  }, [onCountsChange])

  useEffect(() => {
    if (!voterToken) return
    api.getVotes(billId, voterToken).then((data) => {
      if (data?.counts?.total) updateCounts(data.counts.total)
      if (data?.your_vote !== undefined) { setMyVote(data.your_vote); onVoteChange?.(data.your_vote) }
    }).catch(() => {})
  }, [billId, voterToken, updateCounts, onVoteChange])

  const handleVote = async (vote: string) => {
    if (!isLoggedIn()) { setShowLogin(true); return }
    if (submittingRef.current || loading) return
    submittingRef.current = true
    setLoading(true)
    try {
      const data = await api.castVote(billId, vote, voterToken)
      if (data?.counts?.total) updateCounts(data.counts.total)
      const v = data?.your_vote ?? vote
      setMyVote(v)
      onVoteChange?.(v)
      toast.success(`Vote cast: ${vote}`)
      posthog?.capture('vote_cast', { bill_id: billId, vote })
    } catch {
      toast.error('Failed to cast vote')
    } finally {
      submittingRef.current = false
      setLoading(false)
    }
  }

  const total = (counts.support ?? 0) + (counts.neutral ?? 0) + (counts.oppose ?? 0)

  return (
    <>
      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          reason="Sign in to vote on legislation and see how your community stands."
        />
      )}
      <div className={inline ? 'space-y-3' : 'border rounded-lg p-5 space-y-3'}>
        {!inline && (
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Community Vote</h2>
              <p className="text-xs text-muted-foreground">How real people are voting — independent of AI perspectives</p>
            </div>
            {total > 0 && (
              <span className="text-xs text-muted-foreground shrink-0 ml-4">{total} {total === 1 ? 'vote' : 'votes'}</span>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {VOTE_OPTIONS.map(({ value, label, active, inactive }) => {
            const count = counts[value] ?? 0
            const isSelected = myVote === value
            return (
              <button
                key={value}
                onClick={() => handleVote(value)}
                disabled={loading}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  isSelected ? active : `border-border text-muted-foreground ${inactive}`
                } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span>{label}</span>
                {total > 0 && (
                  <span className={`text-xs font-normal ${isSelected ? 'opacity-80' : 'text-muted-foreground'}`}>
                    {count > 0 ? `${Math.round((count / total) * 100)}%` : '—'}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {total > 0 && (
          <div className="flex h-1.5 rounded-full overflow-hidden gap-px">
            {counts.support > 0 && <div className="bg-green-500" style={{ width: `${(counts.support / total) * 100}%` }} />}
            {counts.neutral > 0 && <div className="bg-gray-400"  style={{ width: `${(counts.neutral / total) * 100}%` }} />}
            {counts.oppose  > 0 && <div className="bg-red-500"   style={{ width: `${(counts.oppose  / total) * 100}%` }} />}
          </div>
        )}

        {!isLoggedIn() && (
          <p className="text-xs text-muted-foreground text-center pt-1">
            <button onClick={() => setShowLogin(true)} className="underline hover:text-foreground transition-colors">
              Sign in
            </button>{' '}to cast your vote
          </p>
        )}
      </div>
    </>
  )
}
