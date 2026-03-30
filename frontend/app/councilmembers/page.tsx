'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { api } from '@/lib/api'

const DistrictMap = dynamic(
  () => import('@/components/DistrictMap').then((m) => m.DistrictMap),
  { ssr: false, loading: () => <div className="h-96 rounded-lg bg-muted animate-pulse" /> }
)

interface Member {
  id: string
  name: string
  district: string
  party: string
  email?: string
  phone?: string
  photo_url?: string
  bills_sponsored: number
  profile_url?: string
  term_start?: number
  years_serving?: number
  next_election?: number
  years_until_election?: number
}

function MemberCard({ member }: { member: Member }) {
  const isAtLarge = member.district === 'At-Large'

  return (
    <Link
      href={`/councilmembers/${member.id}`}
      className="flex items-start gap-4 border rounded-lg p-4 hover:border-primary/60 hover:shadow-sm transition-all"
    >
      <div className="shrink-0 w-14 h-14 rounded-full overflow-hidden bg-muted flex items-center justify-center">
        {member.photo_url ? (
          <img src={member.photo_url} alt={member.name} className="w-full h-full object-cover object-top" />
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
            <span className="ml-2 text-muted-foreground/60">· since {member.term_start}</span>
          )}
          {member.next_election && (
            <span className="ml-2 text-muted-foreground/60">· up {member.next_election}</span>
          )}
        </p>
      </div>
    </Link>
  )
}

export default function CouncilmembersPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getCouncilmembers()
      .then((data) => setMembers(data?.members ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const district = members.filter((m) => m.district !== 'At-Large')
  const atLarge = members.filter((m) => m.district === 'At-Large')

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Philadelphia City Council</h1>
        <p className="text-muted-foreground mt-1">
          17 members — 10 district seats and 7 at-large seats.
        </p>
      </div>

      {/* Full-city district map — shown once members load */}
      {!loading && !error && (
        <DistrictMap
          district="all"
          members={members}
          height={420}
        />
      )}

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load council members: {error}
        </div>
      )}

      {!loading && members.length === 0 && !error && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No council members yet.</p>
          <p className="text-xs mt-1">An admin can scrape profiles from the <a href="/admin" className="underline">admin panel</a>.</p>
        </div>
      )}

      {district.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">District Members</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {district.map((m) => <MemberCard key={m.id} member={m} />)}
          </div>
        </div>
      )}

      {atLarge.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">At-Large Members</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {atLarge.map((m) => <MemberCard key={m.id} member={m} />)}
          </div>
        </div>
      )}
    </div>
  )
}
