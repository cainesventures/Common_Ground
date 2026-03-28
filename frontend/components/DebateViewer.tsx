import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { Badge } from '@/components/ui/badge'

interface Citation {
  title: string
  url: string
  snippet?: string
  source_type?: string
}

interface Ratings {
  overall: number
  persuasiveness: number
  logical_soundness: number
  factual_accuracy: number
  relevance: number
  count: number
}

interface ArgumentVariants {
  simple: string
  moderate: string
  expert: string
}

interface Message {
  id: string
  turn_number: number
  position: string
  argument: string
  argument_variants?: ArgumentVariants | null
  citations?: Citation[] | string | null
  agent?: { name: string; persona: string }
  ratings?: Ratings | null
}

type Complexity = 'simple' | 'moderate' | 'expert'
const COMPLEXITY_LEVELS: Complexity[] = ['simple', 'expert']
function ComplexitySlider({ value, onChange }: { value: Complexity; onChange: (v: Complexity) => void }) {
  const isAdvanced = value === 'expert'
  return (
    <div className="flex items-center gap-2 mb-5">
      <span className={`text-xs shrink-0 ${!isAdvanced ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>Basic</span>
      <input
        type="range"
        min={0}
        max={1}
        step={1}
        value={isAdvanced ? 1 : 0}
        onChange={(e) => onChange(Number(e.target.value) === 1 ? 'expert' : 'simple')}
        className="w-28 accent-primary"
      />
      <span className={`text-xs shrink-0 ${isAdvanced ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>Advanced</span>
    </div>
  )
}

interface DebateViewerProps {
  messages: Message[]
}

const POSITION_STYLES: Record<string, { badge: string; border: string; label: string }> = {
  pro:       { badge: 'bg-green-100 text-green-800',   border: 'border-l-green-400',  label: 'Pro' },
  con:       { badge: 'bg-red-100 text-red-800',       border: 'border-l-red-400',    label: 'Con' },
  neutral:   { badge: 'bg-yellow-100 text-yellow-800', border: 'border-l-yellow-400', label: 'Neutral' },
  moderator: { badge: 'bg-slate-100 text-slate-700',   border: 'border-l-slate-400',  label: 'Moderator' },
}

const RATING_LABELS: { key: keyof Omit<Ratings, 'count'>; label: string }[] = [
  { key: 'overall',          label: 'Overall' },
  { key: 'persuasiveness',   label: 'Persuasive' },
  { key: 'logical_soundness',label: 'Logic' },
  { key: 'factual_accuracy', label: 'Accuracy' },
  { key: 'relevance',        label: 'Relevance' },
]

function RatingBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary/60 rounded-full transition-all"
          style={{ width: `${Math.round((value / 10) * 100)}%` }}
        />
      </div>
      <span className="text-xs font-medium w-8 text-right">{value.toFixed(1)}</span>
    </div>
  )
}

function RatingsDisplay({ ratings }: { ratings: Ratings }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="mt-2 pt-2 border-t border-dashed">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="font-medium text-foreground">{ratings.overall.toFixed(1)}/10</span>
        <span>overall rating</span>
        <span className="text-muted-foreground/60">· {ratings.count} {ratings.count === 1 ? 'rater' : 'raters'}</span>
        <span className="ml-1">{expanded ? '▴' : '▾'}</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {RATING_LABELS.map(({ key, label }) => (
            <RatingBar key={key} label={label} value={ratings[key]} />
          ))}
        </div>
      )}
    </div>
  )
}

function parseCitations(raw: Citation[] | string | null | undefined): Citation[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw) } catch { return [] }
}

// Replace [N] / [Source N: Title] with markdown links if URLs exist, otherwise strip them
function linkifyArgument(text: string, citations: Citation[]): string {
  return text.replace(/\[(?:Source\s+)?(\d+)(?:[^\[\]]*?)?\]/g, (_, numStr) => {
    const idx = parseInt(numStr, 10) - 1
    const citation = citations[idx]
    if (citation?.url) return `[[${numStr}]](${citation.url})`
    return ''
  })
}

function AllSourcesPanel({ citations }: { citations: Array<Citation & { msgLabel: string }> }) {
  const [open, setOpen] = useState(false)
  if (citations.length === 0) return null

  return (
    <div className="mt-6 border-t pt-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded bg-blue-100 text-blue-700 font-semibold text-xs">
          {citations.length}
        </span>
        <span>Sources cited in this debate</span>
        <span className="ml-1 text-xs">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <ol className="mt-3 space-y-2 text-sm list-none">
          {citations.map((c, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-xs text-muted-foreground font-mono w-5 shrink-0 pt-0.5">{i + 1}.</span>
              <div>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline font-medium"
                >
                  {c.title}
                </a>
                <span className="text-xs text-muted-foreground ml-2">({c.msgLabel})</span>
                {c.snippet && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.snippet}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export function DebateViewer({ messages }: DebateViewerProps) {
  const [complexity, setComplexity] = useState<Complexity>('simple')

  useEffect(() => {
    const stored = localStorage.getItem('debate_complexity')
    if (stored === 'simple' || stored === 'expert') {
      setComplexity(stored)
    }
  }, [])

  const handleComplexityChange = (v: Complexity) => {
    setComplexity(v)
    localStorage.setItem('debate_complexity', v)
  }

  if (!messages?.length) {
    return <p className="text-muted-foreground text-sm">No messages yet.</p>
  }

  const sorted = [...messages].sort((a, b) => {
    if (a.turn_number !== b.turn_number) return a.turn_number - b.turn_number
    const aMod = (a.position ?? '').toLowerCase() === 'moderator'
    const bMod = (b.position ?? '').toLowerCase() === 'moderator'
    if (aMod === bMod) return 0
    if (a.turn_number === 0) return aMod ? -1 : 1
    return aMod ? 1 : -1
  })

  // Collect all citations across all messages for the bottom panel
  const allCitations: Array<Citation & { msgLabel: string }> = []
  sorted.forEach((msg) => {
    const isMod = (msg.position ?? '').toLowerCase() === 'moderator'
    const label = isMod
      ? (msg.turn_number === 0 ? 'Moderator opening' : `Moderator, turn ${msg.turn_number}`)
      : `${msg.agent?.name ?? 'Agent'}, turn ${msg.turn_number}`
    parseCitations(msg.citations)
      .filter((c) => c.url && c.title)
      .forEach((c) => allCitations.push({ ...c, msgLabel: label }))
  })

  return (
    <div>
      <ComplexitySlider value={complexity} onChange={handleComplexityChange} />
      <div className="space-y-4">
        {sorted.map((msg) => {
          const pos = (msg.position ?? 'neutral').toLowerCase()
          const style = POSITION_STYLES[pos] ?? POSITION_STYLES.neutral
          const isModerator = pos === 'moderator'
          const citations = parseCitations(msg.citations)
          const argumentText = msg.argument_variants?.[complexity] ?? msg.argument
          const processedText = linkifyArgument(argumentText, citations)

          return (
            <div
              key={msg.id}
              className={`border-l-4 pl-4 py-2 ${style.border} ${isModerator ? 'bg-slate-50/60 rounded-r-lg pr-3' : ''}`}
            >
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className={`font-medium text-sm ${isModerator ? 'text-slate-600' : ''}`}>
                  {isModerator ? '⚖️ Moderator' : (msg.agent?.name ?? 'Agent')}
                </span>
                <Badge className={`text-xs ${style.badge}`} variant="outline">
                  {style.label}
                </Badge>
                {msg.turn_number > 0 && (
                  <span className="text-xs text-muted-foreground ml-auto">Turn {msg.turn_number}</span>
                )}
                {msg.turn_number === 0 && (
                  <span className="text-xs text-muted-foreground ml-auto italic">Opening</span>
                )}
              </div>

              <div className={`debate-body text-sm leading-relaxed ${isModerator ? 'text-slate-700 italic' : ''}`}>
                <ReactMarkdown
                  components={{
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline font-medium"
                      >
                        {children}
                      </a>
                    ),
                  }}
                >
                  {processedText}
                </ReactMarkdown>
              </div>

              {msg.ratings && msg.ratings.count > 0 && (
                <RatingsDisplay ratings={msg.ratings} />
              )}
            </div>
          )
        })}
      </div>

      <AllSourcesPanel citations={allCitations} />
    </div>
  )
}
