'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { MapPin, Mail, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { lookupDistrict, useMyDistrict } from '@/lib/my-district'
import { STATUS_COLORS, STATUS_COLORS_FALLBACK } from '@/lib/badge-colors'
import { fmtStatus } from '@/lib/utils'
import type { Bill, Councilmember } from '@/lib/types'

/**
 * "Your district" on the home page.
 *
 * The hook for a renter in their 20s is not "8,693 bills", it is "what is MY
 * council member doing". The address lookup already existed, buried on the
 * council page; this brings it to the front and remembers the answer, so a
 * return visit opens on the reader's own member and their live bills. It
 * takes no side: it shows what the member has in play and how to reach them.
 */
export function NearYou({ city }: { city: string }) {
  const { mine, ready, save, clear } = useMyDistrict()
  const [members, setMembers] = useState<Councilmember[]>([])
  const [bills, setBills] = useState<Bill[] | null>(null)
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!mine) return
    api.getCouncilmembers().then((d) => setMembers(d?.members ?? [])).catch(() => {})
  }, [mine])

  const member = mine ? members.find((m) => m.district === `District ${mine.district}`) : undefined

  useEffect(() => {
    if (!member) return
    setBills(null)
    api.getCouncilmemberBillsByOutcome(member.id, 'active', 1, 3)
      .then((d) => setBills(d?.results ?? []))
      .catch(() => setBills([]))
  }, [member])

  const find = async (e: React.FormEvent) => {
    e.preventDefault()
    const a = address.trim()
    if (!a) return
    setBusy(true); setError(null)
    const result = await lookupDistrict(a)
    setBusy(false)
    if (typeof result === 'string') { setError(result); return }
    save({ address: a, district: result })
    setAddress('')
  }

  // Nothing until localStorage has been read, so a returning reader never sees
  // the empty form flash before their district appears.
  if (!ready) return <div className="max-w-3xl mx-auto h-[148px]" aria-hidden="true" />

  if (!mine) {
    return (
      <section className="max-w-3xl mx-auto rounded-2xl border bg-card p-6 sm:p-7" aria-labelledby="near-you-heading">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 text-primary p-2.5 shrink-0"><MapPin className="w-5 h-5" aria-hidden="true" /></div>
          <div className="flex-1 min-w-0">
            <h2 id="near-you-heading" className="font-semibold">What is your council member working on?</h2>
            <p className="text-sm text-muted-foreground mt-1">Enter your address once and this page will open on your district.</p>
            <form onSubmit={find} className="mt-4 flex gap-2">
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="1234 Market St"
                aria-label="Your street address"
                autoComplete="street-address"
                className="flex-1 min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button type="submit" disabled={busy || !address.trim()}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold disabled:opacity-50 hover:bg-primary/90 transition-colors">
                {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {busy ? 'Finding…' : 'Find my district'}
              </button>
            </form>
            {error && <p role="alert" className="text-sm text-destructive mt-2">{error}</p>}
            <p className="text-xs text-muted-foreground mt-3">
              Your address is looked up with OpenStreetMap and stays in this browser. We never store it.
            </p>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="max-w-3xl mx-auto rounded-2xl border bg-card p-6 sm:p-7 space-y-4" aria-labelledby="near-you-heading">
      <div className="flex items-center gap-4">
        {member?.photo_url ? (
          <Image src={member.photo_url} alt="" width={56} height={56} className="w-14 h-14 rounded-full object-cover object-top shrink-0" />
        ) : (
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center shrink-0"><MapPin className="w-5 h-5 text-muted-foreground" aria-hidden="true" /></div>
        )}
        <div className="flex-1 min-w-0">
          <p className="type-eyebrow text-muted-foreground">Your district</p>
          <h2 id="near-you-heading" className="font-semibold text-lg leading-tight">
            {member ? (
              <Link href={`/${city}/councilmembers/${member.id}`} className="hover:underline underline-offset-4">
                {`District ${mine.district}: ${member.name}`}
              </Link>
            ) : `District ${mine.district}`}
          </h2>
        </div>
        <button onClick={clear} className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 shrink-0">
          Change address
        </button>
      </div>

      {member && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Their bills still in play</p>
          {bills === null ? (
            <div className="space-y-2" aria-hidden="true">
              {[0, 1].map((i) => <div key={i} className="h-11 rounded-lg bg-muted animate-pulse" />)}
            </div>
          ) : bills.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bills from {member.name} are before Council right now.</p>
          ) : (
            <ul className="space-y-1.5">
              {bills.map((b) => (
                <li key={b.id}>
                  <Link href={`/${city}/legislation/${b.id}`}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2.5 hover:bg-muted/50 transition-colors">
                    <span className="flex-1 min-w-0 text-sm truncate">{b.title}</span>
                    <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[b.status] ?? STATUS_COLORS_FALLBACK}`}>
                      {fmtStatus(b.status)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-sm">
            <Link href={`/${city}/councilmembers/${member.id}`} className="text-primary hover:underline">
              Everything {member.name.split(' ').slice(-1)[0]} has sponsored →
            </Link>
            {member.email && (
              <a href={`mailto:${member.email}`} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                <Mail className="w-4 h-4" aria-hidden="true" /> Email their office
              </a>
            )}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Philadelphia also has seven at-large members who represent the whole city.{' '}
        <Link href={`/${city}/councilmembers`} className="underline underline-offset-4 hover:text-foreground">See all members</Link>
      </p>
    </section>
  )
}
