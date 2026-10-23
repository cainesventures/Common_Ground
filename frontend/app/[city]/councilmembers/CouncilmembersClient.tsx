'use client'

import { useEffect, useState } from 'react'
import { useMyDistrict } from '@/lib/my-district'
import { Term } from '@/components/Term'
import type { CouncilmemberWithTenure as Member } from '@/lib/types'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { api } from '@/lib/api'
import { CITY } from '@/lib/city'
import { lastName } from '@/lib/names'
import { errorMessage } from '@/lib/utils'
import type { DistrictGeoJSON } from '@/lib/types'

// One source of truth for the map's height: the reserved box, the chunk-loading
// placeholder and the map itself all read this, so none of them can disagree
// and shift the page. See the comment at the render site.
const MAP_HEIGHT = 420

const DistrictMap = dynamic(
  () => import('@/components/DistrictMap').then((m) => m.DistrictMap),
  {
    ssr: false,
    loading: () => (
      <div style={{ height: MAP_HEIGHT }} className="rounded-lg bg-muted animate-pulse" />
    ),
  }
)

// Point-in-polygon (ray-casting). GeoJSON coords are [lng, lat].
function pointInPolygon(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]  // lng, lat
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function getDistrictNum(props: Record<string, unknown>): number | null {
  const val = props?.DISTRICT ?? props?.District ?? props?.district ??
              props?.DIST_NUM ?? props?.districtNum ?? props?.OBJECTID ?? null
  if (val === null || val === undefined) return null
  const n = Number(val)
  return isNaN(n) ? null : n
}

function findDistrictFromGeoJSON(lat: number, lng: number, geojson: DistrictGeoJSON): number | null {
  for (const feature of (geojson.features ?? [])) {
    const num = getDistrictNum(feature?.properties ?? {})
    if (num === null) continue
    const geom = feature.geometry
    const rings: number[][][] =
      geom?.type === 'Polygon'      ? [(geom.coordinates as number[][][])[0]] :
      geom?.type === 'MultiPolygon' ? (geom.coordinates as number[][][][]).map((p) => p[0]) : []
    for (const ring of rings) {
      if (pointInPolygon(lat, lng, ring)) return num
    }
  }
  return null
}

function FindMyCouncilmember({ members, onFound }: { members: Member[]; onFound: (id: string) => void }) {
  const { city } = useParams<{ city: string }>()
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Member | null>(null)
  // Remembered, so the home page opens on this district next time.
  const { save } = useMyDistrict()

  const handleFind = async () => {
    if (!address.trim()) return
    setLoading(true); setError(null); setResult(null)
    try {
      const geoAbort = new AbortController()
      const geoTimeout = setTimeout(() => geoAbort.abort(), 8000)
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address + ', Philadelphia, PA')}&format=json&limit=1`,
        { headers: { 'User-Agent': 'CommonGround/1.0 civic-app' }, signal: geoAbort.signal }
      )
      clearTimeout(geoTimeout)
      const geoData = await geoRes.json()
      if (!geoData.length) { setError('Address not found. Try including street number and street name.'); return }
      const lat = parseFloat(geoData[0].lat)
      const lng = parseFloat(geoData[0].lon)

      const gjRes = await fetch('/api/councilmembers/districts-geojson')
      const geojson = await gjRes.json()
      const districtNum = findDistrictFromGeoJSON(lat, lng, geojson)
      if (!districtNum) { setError('Could not match that address to a Philadelphia district.'); return }

      const districtStr = `District ${districtNum}`
      const member = members.find((m) => m.district === districtStr)
      if (!member) { setError(`Found District ${districtNum} but no matching council member on file.`); return }

      setResult(member)
      save({ address: address.trim(), district: districtNum })
      onFound(member.id)
    } catch (e: unknown) {
      setError(errorMessage(e, 'Something went wrong.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <p className="text-sm font-semibold">Find my councilmember</p>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Enter your street address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleFind()}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          onClick={handleFind}
          disabled={loading || !address.trim()}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {loading ? 'Looking…' : 'Find'}
        </button>
      </div>
      {/* The direct answer to pressing "Find", so it has to be announced --
          and a failed lookup is worth interrupting for. */}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {result && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border">
          {result.photo_url ? (
            <Image src={result.photo_url} alt={result.name} width={40} height={40} className="w-10 h-10 rounded-full object-cover object-top shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-muted-foreground">{result.name[0]}</span>
            </div>
          )}
          <div>
            <p className="text-sm font-semibold">{result.name}</p>
            <p className="text-xs text-muted-foreground">{result.district}</p>
          </div>
          <a href={`/${city}/councilmembers/${result.id}`} className="ml-auto text-xs text-primary hover:underline">
            View profile →
          </a>
        </div>
      )}
    </div>
  )
}

function SponsorshipChart({ members }: { members: Member[] }) {
  const { city } = useParams<{ city: string }>()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const sorted = [...members].filter(m => (m.bills_sponsored ?? 0) > 0)
    .sort((a, b) => (b.bills_sponsored ?? 0) - (a.bills_sponsored ?? 0))
  if (sorted.length === 0) return null
  const max = sorted[0].bills_sponsored ?? 0

  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <p className="text-sm font-semibold mb-3">Bills sponsored or co-sponsored since taking office</p>
      {sorted.map((m) => {
        const pct = max > 0 ? Math.max(((m.bills_sponsored ?? 0) / max) * 100, 2) : 2
        const isHovered = hoveredId === m.id
        return (
          <Link
            key={m.id}
            href={`/${city}/councilmembers/${m.id}`}
            className="flex items-center gap-3 group"
            onMouseEnter={() => setHoveredId(m.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <span className="text-xs text-muted-foreground w-28 shrink-0 truncate group-hover:text-foreground transition-colors">
              {lastName(m.name)}
            </span>
            <div className="flex-1 h-5 bg-muted/40 rounded-sm overflow-hidden">
              <div
                className="h-full rounded-sm transition-all duration-150"
                style={{
                  width: `${pct}%`,
                  backgroundColor: isHovered ? '#1d4ed8' : '#3b82f6',
                }}
              />
            </div>
            <span className="text-xs font-semibold tabular-nums w-8 text-right" style={{ color: isHovered ? '#1d4ed8' : '#6b7280' }}>
              {m.bills_sponsored}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

function MemberCard({ member, highlighted }: { member: Member; highlighted?: boolean }) {
  const { city } = useParams<{ city: string }>()
  const isAtLarge = member.district === 'At-Large'

  return (
    <Link
      id={`member-${member.id}`}
      href={`/${city}/councilmembers/${member.id}`}
      className={`flex items-start gap-4 border rounded-lg p-4 hover:border-primary/60 hover:shadow-sm transition-all ${highlighted ? 'ring-2 ring-primary border-primary' : ''}`}
    >
      <div className="shrink-0 w-14 h-14 rounded-full overflow-hidden bg-muted flex items-center justify-center">
        {member.photo_url ? (
          <Image src={member.photo_url} alt={member.name} width={56} height={56} className="w-full h-full object-cover object-top" />
        ) : (
          <span className="text-xl font-bold text-muted-foreground">{member.name[0]}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm leading-snug">{member.name}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {isAtLarge ? 'At-Large' : member.district}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {member.bills_sponsored} bill{member.bills_sponsored !== 1 ? 's' : ''} sponsored
          {member.term_start && (
            <span className="ml-2 text-muted-foreground">· since {member.term_start}</span>
          )}
          {member.next_election && (
            <span className="ml-2 text-muted-foreground">· up {member.next_election}</span>
          )}
        </p>
      </div>
    </Link>
  )
}

export default function CouncilmembersClient({ initialMembers }: { initialMembers: Member[] | null }) {
  const { city } = useParams<{ city: string }>()
  // Seeded from the server so the first render -- including the one a crawler
  // sees -- already has the roster. A null means the server fetch failed, and
  // only then does the effect below fetch on the client.
  const [members, setMembers] = useState<Member[]>(initialMembers ?? [])
  const [loading, setLoading] = useState(initialMembers === null)
  const [error, setError] = useState<string | null>(null)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (initialMembers !== null) return
    api.getCouncilmembers()
      .then((data) => setMembers(data?.members ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [initialMembers])

  const handleFound = (id: string) => {
    setHighlightedId(id)
    setTimeout(() => {
      document.getElementById(`member-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 100)
  }

  const filtered = search.trim()
    ? members.filter((m) => m.name.toLowerCase().includes(search.trim().toLowerCase()))
    : members
  // Numeric, not string, order: the API's text sort put District 10 after 1.
  const districtNo = (d?: string | null) => Number(d?.match(/\d+/)?.[0] ?? 99)
  const district = filtered
    .filter((m) => m.district !== 'At-Large')
    .sort((a, b) => districtNo(a.district) - districtNo(b.district))
  const atLarge = filtered.filter((m) => m.district === 'At-Large')

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{CITY.fullCouncilName}</h1>
        <p className="text-muted-foreground mt-1">
          {CITY.totalMembers} members
          {CITY.atLargeCount > 0
            ? `, with ${CITY.districtCount} district seats and ${CITY.atLargeCount} at-large seats.`
            : `, with ${CITY.districtCount} district seats.`}
        </p>
      </div>

      {/*
        Full-city district map.

        The box is reserved whether or not the map is ready. This used to be
        gated on `!loading`, so nothing at all occupied the space until the
        members request came back and then a 420px map dropped into the middle
        of the page, pushing every card below it down -- and the dynamic()
        placeholder was h-96 (384px) against a 420px map, so there was a second
        36px shift behind the first. Together they were most of this page's
        CLS 0.248 at p75.

        Height is stated in one place now (MAP_HEIGHT) and used by the
        reserved box, the loading placeholder and the map itself, so the three
        cannot drift apart again.
      */}
      <div style={{ height: MAP_HEIGHT }} className="w-full">
        {loading || error
          ? <div className="h-full rounded-lg bg-muted animate-pulse" />
          : <DistrictMap district="all" members={members} height={MAP_HEIGHT} />}
      </div>

      {!loading && members.length > 0 && (
        <FindMyCouncilmember members={members} onFound={handleFound} />
      )}

      {!loading && members.length > 0 && (
        <SponsorshipChart members={members} />
      )}

      {!loading && members.length > 0 && (
        <div className="relative">
          <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803 7.5 7.5 0 0015.803 15.803z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search council members…"
            aria-label="Search council members"
            className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}

      {/* Decoration. aria-hidden so a screen reader does not walk eight empty
          cards; the status line below carries the actual state. */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-hidden="true">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {/* Said once, politely, instead of eight pulsing boxes. */}
      {loading && (
        <p role="status" aria-live="polite" className="sr-only">
          Loading council members…
        </p>
      )}

      {error && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load council members: {error}
        </div>
      )}

      {!loading && members.length === 0 && !error && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No council members yet.</p>
          <p className="text-xs mt-1">An admin can scrape profiles from the <Link href="/admin" className="underline">admin panel</Link>.</p>
        </div>
      )}

      {!loading && search.trim() !== '' && district.length === 0 && atLarge.length === 0 && (
        <div className="text-center py-12 space-y-2">
          <p className="text-sm font-semibold">No members match &ldquo;{search}&rdquo;</p>
          <button onClick={() => setSearch('')} className="text-sm text-primary hover:underline">Clear search</button>
        </div>
      )}

      {district.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3"><Term id="district_member">District Members</Term></h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {district.map((m) => <MemberCard key={m.id} member={m} highlighted={highlightedId === m.id} />)}
          </div>
        </div>
      )}

      {atLarge.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3"><Term id="at_large">At-Large Members</Term></h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {atLarge.map((m) => <MemberCard key={m.id} member={m} highlighted={highlightedId === m.id} />)}
          </div>
        </div>
      )}
    </div>
  )
}
