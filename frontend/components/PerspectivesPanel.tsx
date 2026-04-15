'use client'

import { useEffect, useRef, useState } from 'react'
import {
  TrendingUp, Shield, Scale, Users, Minus,
  BarChart2, Unlock, Leaf, Heart, Building2,
  Hammer, Briefcase, Zap, Clock, Home, BookOpen, Eye,
  type LucideIcon,
} from 'lucide-react'
import { api } from '@/lib/api'
import { usePostHog } from 'posthog-js/react'
import { POSITION_STYLES, TALLY_BAR_COLORS } from '@/lib/badge-colors'

const GROUP_COLORS: Record<string, string> = {
  Political:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  Policy:      'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  Demographic: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  Special:     'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

const ALL_PERSPECTIVES = [
  { key: 'progressive',         label: 'Progressive',          group: 'Political' },
  { key: 'conservative',        label: 'Conservative',         group: 'Political' },
  { key: 'libertarian',         label: 'Libertarian',          group: 'Political' },
  { key: 'socialist',           label: 'Socialist',            group: 'Political' },
  { key: 'centrist',            label: 'Centrist',             group: 'Political' },
  { key: 'economic',            label: 'Economic',             group: 'Policy' },
  { key: 'civil_liberties',     label: 'Civil Liberties',      group: 'Policy' },
  { key: 'environmental',       label: 'Environmental',        group: 'Policy' },
  { key: 'public_health',       label: 'Public Health',        group: 'Policy' },
  { key: 'urban_planning',      label: 'Urban Planning',       group: 'Policy' },
  { key: 'working_class',       label: 'Working Class',        group: 'Demographic' },
  { key: 'business',            label: 'Business',             group: 'Demographic' },
  { key: 'youth',               label: 'Youth',                group: 'Demographic' },
  { key: 'elderly',             label: 'Elderly',              group: 'Demographic' },
  { key: 'neighborhood',        label: 'Neighborhood',         group: 'Demographic' },
  { key: 'christian_ethicist',  label: 'Christian Ethicist',   group: 'Special' },
  { key: 'conspiracy_theorist', label: 'Conspiracy Theorist',  group: 'Special' },
]

const PERSPECTIVE_ICONS: Record<string, LucideIcon> = {
  progressive:         TrendingUp,
  conservative:        Shield,
  libertarian:         Scale,
  socialist:           Users,
  centrist:            Minus,
  economic:            BarChart2,
  civil_liberties:     Unlock,
  environmental:       Leaf,
  public_health:       Heart,
  urban_planning:      Building2,
  working_class:       Hammer,
  business:            Briefcase,
  youth:               Zap,
  elderly:             Clock,
  neighborhood:        Home,
  christian_ethicist:  BookOpen,
  conspiracy_theorist: Eye,
}

function PerspectiveMonogram({ perspKey, group }: { perspKey: string; group: string }) {
  const colorClass = GROUP_COLORS[group] ?? GROUP_COLORS.Special
  const Icon = PERSPECTIVE_ICONS[perspKey]
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0 ${colorClass}`}>
      {Icon
        ? <Icon className="w-3 h-3" strokeWidth={2.5} />
        : <span className="text-[11px] font-bold">{perspKey.charAt(0).toUpperCase()}</span>
      }
    </span>
  )
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

interface Perspective {
  perspective_type: string
  position: string
  key_arguments: string[] | string
  concerns?: string
  assessment?: string
  generated_at?: string
}

const POSITION_LABELS: Record<string, string> = {
  support: 'Support',
  oppose: 'Oppose',
  neutral: 'Neutral',
}

function PerspectivesTally({
  perspectives, pending, billId, isAdmin, generating, generate, isBusy,
}: {
  perspectives: Perspective[]
  pending: string[]
  billId: string
  isAdmin?: boolean
  generating?: string | null
  generate?: (ptype: string) => void
  isBusy?: boolean
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const posthog = usePostHog()

  const hasPerspectives = perspectives.length > 0
  const hasPending = !!(isAdmin && pending.length > 0)

  if (!hasPerspectives && !hasPending) return null

  const counts: Record<string, number> = { support: 0, oppose: 0, neutral: 0 }
  for (const p of perspectives) {
    const pos = p.position === 'mixed' ? 'neutral' : p.position
    if (counts[pos] !== undefined) counts[pos]++
    else counts.neutral++
  }

  const total = perspectives.length
  const positionOrder = ['support', 'neutral', 'oppose'] as const

  const sorted = perspectives.slice().sort((a, b) => {
    const order = ['support', 'neutral', 'oppose']
    const pa = a.position === 'mixed' ? 'neutral' : a.position
    const pb = b.position === 'mixed' ? 'neutral' : b.position
    return order.indexOf(pa) - order.indexOf(pb)
  })

  return (
    <div className="border rounded-lg overflow-hidden">

      {/* Header + stacked bar — only when there are generated perspectives */}
      {hasPerspectives && (
        <>
          <div className="px-4 py-3 border-b bg-muted/30 flex flex-wrap items-center gap-4">
            <span className="text-sm font-semibold">
              AI Tally
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">({total} perspectives)</span>
            </span>
            <div className="flex items-center gap-3 text-sm">
              {positionOrder.map((pos) => counts[pos] > 0 && (
                <span key={pos} className="flex items-center gap-1.5">
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${TALLY_BAR_COLORS[pos]}`} />
                  <span className="font-medium">{counts[pos]}</span>
                  <span className="text-muted-foreground">{POSITION_LABELS[pos]}</span>
                  <span className="text-muted-foreground/60 text-xs">({Math.round((counts[pos] / total) * 100)}%)</span>
                </span>
              ))}
            </div>
          </div>

          <div className="flex h-1.5">
            {positionOrder.map((pos) => {
              const pct = (counts[pos] / total) * 100
              return pct > 0 ? (
                <div key={pos} className={TALLY_BAR_COLORS[pos]} style={{ width: `${pct}%` }} />
              ) : null
            })}
          </div>

          {/* Generated perspective rows */}
          <div className="divide-y">
            {sorted.map((p) => {
              const meta = ALL_PERSPECTIVES.find((x) => x.key === p.perspective_type)
              const label = meta?.label ?? p.perspective_type
              const displayPos = p.position === 'mixed' ? 'neutral' : p.position
              const posStyle = POSITION_STYLES[displayPos] ?? POSITION_STYLES.neutral
              const isOpen = expanded === p.perspective_type
              const args: string[] = Array.isArray(p.key_arguments)
                ? p.key_arguments
                : (() => { try { return JSON.parse(p.key_arguments as string) } catch { return [] } })()

              return (
                <div key={p.perspective_type}>
                  <button
                    onClick={() => {
                      const next = isOpen ? null : p.perspective_type
                      setExpanded(next)
                      if (next) posthog?.capture('perspective_opened', { bill_id: billId, perspective_type: p.perspective_type })
                    }}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/20 transition-colors text-left"
                    aria-expanded={isOpen}
                    aria-label={`${label}, ${displayPos}. ${isOpen ? 'Collapse' : 'Expand'} details`}
                  >
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <PerspectiveMonogram perspKey={p.perspective_type} group={meta?.group ?? 'Special'} />
                      {label}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${posStyle}`}>
                        {displayPos}
                      </span>
                      <span className="text-muted-foreground text-xs">{isOpen ? '▲' : '▼'}</span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-2 bg-muted/10 border-t">
                      {p.assessment ? (
                        <div className="space-y-2.5">
                          {p.assessment.split('\n\n').filter(Boolean).map((para, i) => (
                            <p key={i} className="text-sm text-foreground/80 leading-relaxed">{para}</p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">No analysis available.</p>
                      )}
                      {p.generated_at && (
                        <p className="text-[11px] text-muted-foreground/40 text-right mt-3">
                          Generated {timeAgo(p.generated_at)}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Pending rows — admin only */}
      {hasPending && (
        <div className={hasPerspectives ? 'border-t divide-y' : 'divide-y'}>
          {pending.map((t) => {
            const meta = ALL_PERSPECTIVES.find((x) => x.key === t)
            const label = meta?.label ?? t
            const isGenerating = generating === t
            return (
              <div key={t} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-muted-foreground/50 flex items-center gap-1.5">
                  <PerspectiveMonogram perspKey={t} group={meta?.group ?? 'Special'} />
                  {label}
                </span>
                {generate && (
                  <button
                    onClick={() => generate(t)}
                    disabled={isGenerating || isBusy}
                    className="text-xs px-2.5 py-1 rounded border text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors shrink-0"
                  >
                    {isGenerating ? 'Generating…' : 'Generate'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function PerspectivesPanel({
  billId, analyzed, isAdmin = false, onLoad,
}: {
  billId: string
  analyzed: boolean
  isAdmin?: boolean
  onLoad?: (count: number) => void
}) {
  const [perspectives, setPerspectives] = useState<Perspective[]>([])
  const [pending, setPending] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [generating, setGenerating] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [bulkRunning, setBulkRunning] = useState<'all' | 'clear' | null>(null)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)
  const cancelRef = useRef(false)

  const load = async () => {
    if (!analyzed) { setLoading(false); return }
    try {
      const data = await api.getPerspectives(billId)
      setPerspectives(data?.perspectives ?? [])
      setPending(data?.pending_types ?? [])
      setLoadError(false)
      onLoad?.(data?.perspectives?.length ?? 0)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [billId, analyzed])

  const generateAll = async () => {
    const freshData = await api.getPerspectives(billId).catch(() => null)
    const toGenerate: string[] = freshData?.pending_types ?? [...pending]
    if (toGenerate.length === 0) return

    setBulkRunning('all')
    setBulkProgress({ done: 0, total: toGenerate.length })
    setGenerateError(null)
    cancelRef.current = false

    let done = 0
    for (const ptype of toGenerate) {
      if (cancelRef.current) break
      try {
        const data = await api.generatePerspective(billId, ptype)
        if (data?.perspective_type) {
          setPerspectives((prev) => {
            const filtered = prev.filter((p) => p.perspective_type !== data.perspective_type)
            return [...filtered, {
              perspective_type: data.perspective_type,
              position: data.position,
              key_arguments: data.key_arguments,
              concerns: data.concerns,
              assessment: data.assessment,
              generated_at: data.generated_at,
            }]
          })
          setPending((prev) => prev.filter((t) => t !== ptype))
        }
      } catch (err: any) {
        console.warn(`Failed to generate ${ptype}:`, err?.message)
      }
      done++
      setBulkProgress({ done, total: toGenerate.length })
    }

    setBulkRunning(null)
    setBulkProgress(null)
    cancelRef.current = false
  }

  const clearAll = async () => {
    setBulkRunning('clear')
    setGenerateError(null)
    try {
      await api.clearPerspectives(billId)
      setPerspectives([])
      setPending(await api.getPerspectives(billId).then((d) => d?.pending_types ?? []))
      onLoad?.(0)
    } catch (err: any) {
      setGenerateError(err?.message ?? 'Failed to clear perspectives.')
    } finally {
      setBulkRunning(null)
    }
  }

  const generate = async (perspType: string) => {
    setGenerating(perspType)
    setGenerateError(null)
    try {
      const data = await api.generatePerspective(billId, perspType)
      if (data?.perspective_type) {
        setPerspectives((prev) => {
          const filtered = prev.filter((p) => p.perspective_type !== data.perspective_type)
          const next = [...filtered, {
            perspective_type: data.perspective_type,
            position: data.position,
            key_arguments: data.key_arguments,
            concerns: data.concerns,
            assessment: data.assessment,
            generated_at: data.generated_at,
          }]
          onLoad?.(next.length)
          return next
        })
        setPending((prev) => prev.filter((t) => t !== perspType))
      }
    } catch (err: any) {
      setGenerateError(err?.message ?? 'Generation failed — Ollama may not be installed or could not start.')
    } finally {
      setGenerating(null)
    }
  }

  if (!analyzed) {
    return (
      <div className="border rounded-lg p-5 text-center text-sm text-muted-foreground">
        This bill hasn&apos;t been analyzed yet. Perspectives will appear here once an admin runs analysis.
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="border rounded-lg p-5 text-center space-y-2">
        <p className="text-sm text-destructive font-medium">Failed to load perspectives</p>
        <p className="text-xs text-muted-foreground">There was a problem connecting to the server.</p>
        <button
          onClick={() => { setLoading(true); setLoadError(false); load() }}
          className="text-xs text-primary hover:underline"
        >
          Try again
        </button>
      </div>
    )
  }

  const isBusy = generating !== null || bulkRunning !== null

  return (
    <div className="space-y-6">
      {generateError && (
        <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {generateError}
        </div>
      )}

      {isAdmin && (
        <div className="flex items-center gap-2 flex-wrap">
          {bulkRunning === 'all' ? (
            <>
              <span className="text-xs text-muted-foreground">
                {bulkProgress ? `${bulkProgress.done} of ${bulkProgress.total} generated` : 'Starting…'}
              </span>
              <button
                onClick={() => { cancelRef.current = true }}
                className="text-xs px-3 py-1.5 rounded-md border font-medium border-red-300 text-red-600 hover:bg-red-50 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={generateAll}
              disabled={isBusy}
              className="text-xs px-3 py-1.5 rounded-md border font-medium transition-colors hover:bg-muted/40 disabled:opacity-50"
            >
              Generate All
            </button>
          )}
          <button
            onClick={clearAll}
            disabled={isBusy}
            className="text-xs px-3 py-1.5 rounded-md border font-medium transition-colors hover:bg-red-50 hover:border-red-300 hover:text-red-700 disabled:opacity-50"
          >
            {bulkRunning === 'clear' ? 'Clearing…' : 'Clear All'}
          </button>
        </div>
      )}

      <PerspectivesTally
        perspectives={perspectives}
        pending={pending}
        billId={billId}
        isAdmin={isAdmin}
        generating={generating}
        generate={generate}
        isBusy={isBusy}
      />
    </div>
  )
}
