import Link from 'next/link'
import {
  Building2, DollarSign, Train, Shield, Scale, Leaf, Heart,
  BookOpen, Briefcase, Landmark, Home, Globe, FileText,
  type LucideIcon,
} from 'lucide-react'
import { STATUS_COLORS, STATUS_COLORS_FALLBACK, HEARING_BADGE } from '@/lib/badge-colors'
import { isWithin7Days, fmtStatus } from '@/lib/utils'
import { getBillCategory } from '@/lib/bill-categories'

const ICONS: Record<string, LucideIcon> = {
  Building2, DollarSign, Train, Shield, Scale, Leaf, Heart,
  BookOpen, Briefcase, Landmark, Home, Globe, FileText,
}

export interface BillCardBill {
  id: string
  bill_number: string
  title: string
  plain_title?: string
  headline?: string
  lede?: string
  status: string
  impact_level?: string
  summary?: string
  tags?: string
  introduced_date?: string
  final_date?: string
  next_hearing_date?: string
}

interface BillCardProps {
  bill: BillCardBill
  query?: string
  accentBar?: boolean
  showDate?: boolean
  tab?: string
  citySlug?: string
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

export function BillCard({ bill, query = '', showDate = false, tab, citySlug = 'philadelphia' }: BillCardProps) {
  const statusClass = STATUS_COLORS[bill.status] ?? STATUS_COLORS_FALLBACK

  let tags: string[] = []
  try { tags = bill.tags ? JSON.parse(bill.tags) : [] } catch { tags = [] }

  const category = getBillCategory(tags)
  const Icon = ICONS[category.icon] ?? FileText

  const lede = bill.lede || (bill.summary
    ? bill.summary.split(/(?<=[.!?])\s+/)[0] ?? bill.summary
    : null)

  const hearingSoon = bill.next_hearing_date && isWithin7Days(bill.next_hearing_date)

  const TERMINAL_STATUSES = ['signed_into_law', 'failed', 'vetoed', 'passed_both', 'passed_chamber']
  const isTerminal = TERMINAL_STATUSES.includes(bill.status)
  const dateLabel = isTerminal && bill.final_date
    ? { label: bill.status === 'signed_into_law' ? 'Signed' : bill.status === 'vetoed' ? 'Vetoed' : bill.status === 'failed' ? 'Failed' : 'Voted', date: bill.final_date }
    : bill.next_hearing_date && !isTerminal
    ? { label: 'Hearing', date: bill.next_hearing_date }
    : bill.introduced_date
    ? { label: 'Introduced', date: bill.introduced_date }
    : null

  return (
    <Link
      href={tab ? `/${citySlug}/legislation/${bill.id}?tab=${tab}` : `/${citySlug}/legislation/${bill.id}`}
      className="flex rounded-lg border bg-background hover:shadow-md transition-all group overflow-hidden"
    >
      {/* Category strip */}
      <div className={`w-1.5 shrink-0 bg-gradient-to-b ${category.gradient}`} />

      {/* Icon column */}
      <div className="flex items-start pt-3.5 pl-3 pr-1 shrink-0">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${category.iconBg}`}>
          <Icon className={`w-4 h-4 ${category.iconColor}`} strokeWidth={2} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 py-3 pr-3 pl-2">
        {/* Category label + meta row */}
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${category.iconColor}`}>
            {category.label}
          </span>
          <span className="text-muted-foreground/30 text-[10px]">·</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full capitalize ${statusClass}`}>
            {fmtStatus(bill.status)}
          </span>
          {hearingSoon && !isTerminal && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${HEARING_BADGE}`}>
              Hearing {new Date(bill.next_hearing_date!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
          {showDate && dateLabel && (
            <span className="text-[10px] text-muted-foreground/50 ml-auto shrink-0">
              {dateLabel.label} {new Date(dateLabel.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
        </div>

        {/* Headline */}
        <p className="text-sm font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors">
          <Highlight text={bill.headline || bill.plain_title || bill.title} query={query} />
        </p>

        {/* Lede */}
        {lede && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
            <Highlight text={lede} query={query} />
          </p>
        )}

        {/* Bill number footer */}
        <p className="text-[10px] font-mono text-muted-foreground/40 mt-1.5">{bill.bill_number}</p>
      </div>

      <div className="flex items-center pr-3 shrink-0">
        <span className="text-muted-foreground text-xs opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-150">→</span>
      </div>
    </Link>
  )
}
