'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'

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

  const { member, bills } = data

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
      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg p-4 text-center">
          <p className="text-2xl font-bold">{member.bills_sponsored}</p>
          <p className="text-xs text-muted-foreground mt-1">Bills Sponsored</p>
        </div>
        <div className="border rounded-lg p-4 text-center">
          <p className="text-2xl font-bold">{member.district}</p>
          <p className="text-xs text-muted-foreground mt-1">District</p>
        </div>
      </div>

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
