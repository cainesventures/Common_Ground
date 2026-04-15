import Link from 'next/link'
import { STATUS_COLORS, STATUS_COLORS_FALLBACK, IMPACT_COLORS, IMPACT_ACCENT, HEARING_BADGE } from '@/lib/badge-colors'
import { isWithin7Days, fmtStatus } from '@/lib/utils'

export interface BillCardBill {
  id: string
  bill_number: string
  title: string
  plain_title?: string
  status: string
  impact_level?: string
  summary?: string
  tags?: string
  introduced_date?: string
  next_hearing_date?: string
}

interface BillCardProps {
  bill: BillCardBill
  /** Highlight this query text in the title and summary */
  query?: string
  /** Show the colored left accent bar (default: true) */
  accentBar?: boolean
  /** Show introduced date (default: false) */
  showDate?: boolean
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.trim().toLowerCase()
          ? <mark key={i} className="bg-yellow-200 text-yellow-900 dark:bg-yellow-700 dark:text-yellow-100 rounded-sm px-0.5">{part}</mark>
          : part
      )}
    </>
  )
}

export function BillCard({ bill, query = '', accentBar = true, showDate = false }: BillCardProps) {
  const accent = IMPACT_ACCENT[bill.impact_level ?? ''] ?? '#e5e7eb'
  const statusClass = STATUS_COLORS[bill.status] ?? STATUS_COLORS_FALLBACK
  const impactClass = bill.impact_level ? IMPACT_COLORS[bill.impact_level] : null

  let tags: string[] = []
  try { tags = bill.tags ? JSON.parse(bill.tags) : [] } catch { tags = [] }

  return (
    <Link
      href={`/legislation/${bill.id}`}
      className="flex rounded-lg border bg-background hover:shadow-md transition-all group overflow-hidden"
    >
      {accentBar && <div className="w-1 shrink-0" style={{ backgroundColor: accent }} />}
      <div className="flex-1 min-w-0 p-3">
        <div className="flex items-center gap-2 flex-wrap mb-1.5">
          {bill.bill_number && (
            <span className="text-xs font-mono text-muted-foreground shrink-0">{bill.bill_number}</span>
          )}
          {bill.status && (
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full capitalize shrink-0 ${statusClass}`}>
              {fmtStatus(bill.status)}
            </span>
          )}
          {impactClass && (
            <span className={`text-[11px] font-medium capitalize shrink-0 ${impactClass} px-1.5 py-0.5 rounded-full`}>
              {bill.impact_level} impact
            </span>
          )}
          {bill.next_hearing_date && isWithin7Days(bill.next_hearing_date) && (
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${HEARING_BADGE}`}>
              Hearing {new Date(bill.next_hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
          {showDate && bill.introduced_date && (
            <span className="text-[11px] text-muted-foreground/60 shrink-0 ml-auto">
              {new Date(bill.introduced_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
        </div>
        <p className="text-sm font-medium line-clamp-2 group-hover:text-primary transition-colors leading-snug">
          <Highlight text={bill.plain_title || bill.title} query={query} />
        </p>
        {bill.summary && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            <Highlight text={bill.summary} query={query} />
          </p>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {tags.slice(0, 3).map((t) => (
              <span key={t} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800 px-2 py-0.5 rounded-full font-medium capitalize">{t}</span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center pr-3 shrink-0">
        <span className="text-muted-foreground text-xs opacity-0 group-hover:opacity-100 transition-opacity">→</span>
      </div>
    </Link>
  )
}
