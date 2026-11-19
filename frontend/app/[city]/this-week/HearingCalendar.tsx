import Link from 'next/link'
import type { Bill } from '@/lib/types'

/** Where Council and its committees almost always meet. Only other places are spelled out. */
const MAIN_ROOM = 'Room 400, City Hall'
/** Meetings with more bills than this fold their list. */
const OPEN_LIMIT = 6
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Meeting = { date: string; time: string; body: string; location: string | null; url: string | null; bills: Bill[] }

const atNoon = (iso: string) => new Date(`${iso}T12:00:00`)
const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => atNoon(iso).toLocaleDateString('en-US', opts)

/**
 * Legistar stores the room plus a note for remote commenters
 * ("PLEASE USE THE AGENDA PDF..."). The note belongs on Legistar, which the
 * agenda link reaches; the room is the first line.
 */
function place(raw?: string | null): string | null {
  const first = (raw ?? '').split('\n')[0].trim()
  if (!first || first.toLowerCase().replace(/\s+/g, ' ') === MAIN_ROOM.toLowerCase()) return null
  return first
}

function meetings(bills: Bill[]): Meeting[] {
  const out = new Map<string, Meeting>()
  for (const b of bills) {
    const date = b.next_hearing_date?.slice(0, 10)
    if (!date) continue
    const k = `${date}|${b.next_hearing_time ?? ''}|${b.next_hearing_body ?? ''}`
    const m = out.get(k) ?? {
      date, time: b.next_hearing_time ?? '', body: b.next_hearing_body ?? 'Council',
      location: place(b.next_hearing_location), url: b.next_hearing_url ?? null, bills: [],
    }
    m.bills.push(b)
    out.set(k, m)
  }
  return [...out.values()]
}

/** "CITY COUNCIL" and "COMMITTEE ON STREETS AND SERVICES" read as shouting in a sentence. */
function bodyName(body: string) {
  if (body !== body.toUpperCase()) return body
  return body.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(On|And|Of|The|For)\b/g, (w) => w.toLowerCase())
}

function MonthGrid({ year, month, days }: { year: number; month: number; days: Map<string, number> }) {
  const first = new Date(year, month, 1)
  const count = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)]
  const label = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  return (
    <div className="rounded-xl border p-3 sm:p-4">
      <p className="text-sm font-semibold mb-2">{label}</p>
      <div role="grid" aria-label={label} className="grid grid-cols-7 gap-1 text-center text-xs">
        {WEEKDAYS.map((d) => <div key={d} role="columnheader" className="text-muted-foreground py-1">{d}</div>)}
        {cells.map((d, i) => {
          if (d === null) return <div key={`x${i}`} />
          const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
          const n = days.get(iso)
          return n ? (
            <a key={iso} href={`#hearing-${iso}`} role="gridcell"
              aria-label={`${fmt(iso, { weekday: 'long', month: 'long', day: 'numeric' })}: ${n} ${n === 1 ? 'meeting' : 'meetings'}`}
              className="rounded-md bg-primary text-primary-foreground font-semibold py-1.5 hover:opacity-90 tabular-nums">
              {d}
            </a>
          ) : (
            <div key={iso} role="gridcell" className="py-1.5 text-muted-foreground tabular-nums">{d}</div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Upcoming hearings as a month calendar plus a day-by-day agenda. The calendar
 * answers "when", and each highlighted day jumps to its meetings below.
 *
 * Only meetings with a bill we track are known: the schedule comes from each
 * bill's next hearing, not from the full Legistar calendar.
 */
export function HearingCalendar({ hearings, citySlug }: { hearings: Bill[]; citySlug: string }) {
  const list = meetings(hearings).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  if (list.length === 0) return null

  const perDay = new Map<string, number>()
  for (const m of list) perDay.set(m.date, (perDay.get(m.date) ?? 0) + 1)
  const months = [...new Set(list.map((m) => m.date.slice(0, 7)))].map((ym) => ym.split('-').map(Number))
  const byDay = list.reduce<Record<string, Meeting[]>>((acc, m) => ((acc[m.date] ||= []).push(m), acc), {})

  return (
    <section className="space-y-4" aria-labelledby="hearings">
      <div>
        <h2 id="hearings" className="type-section">Coming up: public hearings and sessions</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Meetings are open to the public and held in {MAIN_ROOM} unless another place is listed.
          Committees hear testimony before voting. Open a bill and tap the bell for a reminder the day before.
        </p>
      </div>

      <div className={`grid gap-3 ${months.length > 1 ? 'sm:grid-cols-2' : 'sm:max-w-sm'}`}>
        {months.map(([y, m]) => <MonthGrid key={`${y}-${m}`} year={y} month={m - 1} days={perDay} />)}
      </div>

      <ol className="space-y-5">
        {Object.entries(byDay).map(([date, ms]) => (
          <li key={date} id={`hearing-${date}`} className="scroll-mt-24 space-y-3">
            <p className="text-sm font-semibold">{fmt(date, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
            {ms.map((m) => (
              <div key={`${m.time}|${m.body}`} className="rounded-lg border p-3 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm">
                    {m.time && <span className="font-semibold tabular-nums">{m.time}</span>}
                    {m.time && ' · '}
                    {bodyName(m.body)}
                  </p>
                  {m.url && (
                    <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                      Agenda and how to comment ↗
                    </a>
                  )}
                </div>
                {m.location && (
                  <p className="text-sm">
                    <span className="font-medium">Location:</span> {m.location}{' '}
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${m.location}, Philadelphia, PA`)}`}
                      target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">Map ↗</a>
                  </p>
                )}
                <MeetingBills bills={m.bills} citySlug={citySlug} />
              </div>
            ))}
          </li>
        ))}
      </ol>
    </section>
  )
}

function MeetingBills({ bills, citySlug }: { bills: Bill[]; citySlug: string }) {
  const items = (
    <ul className="space-y-1">
      {bills.map((b) => (
        <li key={b.id} className="text-sm">
          <span className="text-muted-foreground tabular-nums">{b.bill_number}</span>{' '}
          <Link href={`/${citySlug}/legislation/${b.id}`} className="text-primary hover:underline">
            {b.headline || b.plain_title || b.title}
          </Link>
        </li>
      ))}
    </ul>
  )
  const label = `${bills.length} ${bills.length === 1 ? 'bill' : 'bills'} on the agenda`
  if (bills.length <= OPEN_LIMIT) return <div className="space-y-1"><p className="text-xs text-muted-foreground">{label}</p>{items}</div>
  return (
    <details>
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">{label}</summary>
      <div className="mt-2">{items}</div>
    </details>
  )
}
