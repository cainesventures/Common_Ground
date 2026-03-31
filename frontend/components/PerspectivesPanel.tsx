'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

const ALL_PERSPECTIVES = [
  { key: 'progressive',         label: 'Progressive',          group: 'Political',    icon: '🌹' },
  { key: 'conservative',        label: 'Conservative',         group: 'Political',    icon: '🦅' },
  { key: 'libertarian',         label: 'Libertarian',          group: 'Political',    icon: '🗽' },
  { key: 'socialist',           label: 'Socialist',            group: 'Political',    icon: '✊' },
  { key: 'centrist',            label: 'Centrist',             group: 'Political',    icon: '⚖️' },
  { key: 'economic',            label: 'Economic',             group: 'Policy',       icon: '💰' },
  { key: 'civil_liberties',     label: 'Civil Liberties',      group: 'Policy',       icon: '📜' },
  { key: 'environmental',       label: 'Environmental',        group: 'Policy',       icon: '🌿' },
  { key: 'public_health',       label: 'Public Health',        group: 'Policy',       icon: '🏥' },
  { key: 'urban_planning',      label: 'Urban Planning',       group: 'Policy',       icon: '🏙️' },
  { key: 'working_class',       label: 'Working Class',        group: 'Demographic',  icon: '🔨' },
  { key: 'business',            label: 'Business',             group: 'Demographic',  icon: '💼' },
  { key: 'youth',               label: 'Youth',                group: 'Demographic',  icon: '🎓' },
  { key: 'elderly',             label: 'Elderly',              group: 'Demographic',  icon: '🧓' },
  { key: 'neighborhood',        label: 'Neighborhood',         group: 'Demographic',  icon: '🏘️' },
  { key: 'christian_ethicist',  label: 'Christian Ethicist',   group: 'Special',      icon: '🕊️' },
  { key: 'conspiracy_theorist', label: 'Conspiracy Theorist',  group: 'Special',      icon: '🕵️' },
]

const POSITION_STYLES: Record<string, string> = {
  support: 'bg-green-100 text-green-800 border-green-200',
  oppose:  'bg-red-100 text-red-800 border-red-200',
  neutral: 'bg-gray-100 text-gray-700 border-gray-200',
  mixed:   'bg-yellow-100 text-yellow-800 border-yellow-200',
}

interface Perspective {
  perspective_type: string
  position: string
  key_arguments: string[] | string
  concerns?: string
  assessment?: string
  generated_at?: string
}

function PerspectiveCard({ p }: { p: Perspective }) {
  const posStyle = POSITION_STYLES[p.position] ?? POSITION_STYLES.neutral
  const args: string[] = Array.isArray(p.key_arguments)
    ? p.key_arguments
    : (() => { try { return JSON.parse(p.key_arguments as string) } catch { return [] } })()

  const meta = ALL_PERSPECTIVES.find((x) => x.key === p.perspective_type)
  const label = meta?.label ?? p.perspective_type
  const icon = meta?.icon

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm flex items-center gap-1.5">
          {icon && <span className="text-base leading-none">{icon}</span>}
          {label}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${posStyle}`}>
          {p.position}
        </span>
      </div>

      {p.assessment && (
        <p className="text-sm text-muted-foreground leading-relaxed">{p.assessment}</p>
      )}

      {args.length > 0 && (
        <ul className="space-y-1">
          {args.map((arg, i) => (
            <li key={i} className="text-xs text-muted-foreground flex gap-2">
              <span className="shrink-0 mt-0.5 text-primary">•</span>
              <span>{arg}</span>
            </li>
          ))}
        </ul>
      )}

      {p.concerns && (
        <div className="border-t pt-2">
          <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Concerns: </span>{p.concerns}</p>
        </div>
      )}
    </div>
  )
}

const POSITION_LABELS: Record<string, string> = {
  support: 'Support',
  oppose: 'Oppose',
  neutral: 'Neutral',
  mixed: 'Mixed',
}

const TALLY_BAR_COLORS: Record<string, string> = {
  support: 'bg-green-500',
  oppose:  'bg-red-500',
  neutral: 'bg-gray-400',
  mixed:   'bg-yellow-400',
}

function PerspectivesTally({ perspectives }: { perspectives: Perspective[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (perspectives.length === 0) return null

  const counts: Record<string, number> = { support: 0, oppose: 0, neutral: 0, mixed: 0 }
  for (const p of perspectives) {
    if (counts[p.position] !== undefined) counts[p.position]++
    else counts.neutral++
  }

  const total = perspectives.length
  // Tug-of-war order: support ←── neutral ──→ oppose
  const positionOrder = ['support', 'neutral', 'mixed', 'oppose'] as const

  const sorted = perspectives.slice().sort((a, b) => {
    const order = ['support', 'neutral', 'mixed', 'oppose']
    return order.indexOf(a.position) - order.indexOf(b.position)
  })

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Header */}
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

      {/* Stacked bar */}
      <div className="flex h-1.5">
        {positionOrder.map((pos) => {
          const pct = (counts[pos] / total) * 100
          return pct > 0 ? (
            <div key={pos} className={TALLY_BAR_COLORS[pos]} style={{ width: `${pct}%` }} />
          ) : null
        })}
      </div>

      {/* Rows — click to expand */}
      <div className="divide-y">
        {sorted.map((p) => {
          const tallyMeta = ALL_PERSPECTIVES.find((x) => x.key === p.perspective_type)
          const label = tallyMeta?.label ?? p.perspective_type
          const icon = tallyMeta?.icon
          const posStyle = POSITION_STYLES[p.position] ?? POSITION_STYLES.neutral
          const isOpen = expanded === p.perspective_type
          const args: string[] = Array.isArray(p.key_arguments)
            ? p.key_arguments
            : (() => { try { return JSON.parse(p.key_arguments as string) } catch { return [] } })()

          return (
            <div key={p.perspective_type}>
              <button
                onClick={() => setExpanded(isOpen ? null : p.perspective_type)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/20 transition-colors text-left"
              >
                <span className="text-muted-foreground flex items-center gap-1.5">
                  {icon && <span className="text-base leading-none">{icon}</span>}
                  {label}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize ${posStyle}`}>
                    {p.position}
                  </span>
                  <span className="text-muted-foreground text-xs">{isOpen ? '▲' : '▼'}</span>
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-3 pt-1 bg-muted/10 border-t space-y-2">
                  {p.assessment && (
                    <p className="text-sm text-muted-foreground leading-relaxed">{p.assessment}</p>
                  )}
                  {args.length > 0 && (
                    <ul className="space-y-1">
                      {args.map((arg, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex gap-2">
                          <span className="shrink-0 text-primary mt-0.5">•</span>
                          <span>{arg}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {p.concerns && (
                    <p className="text-xs text-muted-foreground border-t pt-2">
                      <span className="font-medium text-foreground">Concerns: </span>{p.concerns}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PerspectivesPanel({ billId, analyzed, isAdmin = false }: { billId: string; analyzed: boolean; isAdmin?: boolean }) {
  const [perspectives, setPerspectives] = useState<Perspective[]>([])
  const [pending, setPending] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [bulkRunning, setBulkRunning] = useState<'all' | 'clear' | null>(null)

  const load = async () => {
    if (!analyzed) { setLoading(false); return }
    try {
      const data = await api.getPerspectives(billId)
      setPerspectives(data?.perspectives ?? [])
      setPending(data?.pending_types ?? [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [billId, analyzed])

  const generateAll = async () => {
    setBulkRunning('all')
    setGenerateError(null)
    try {
      await api.generateAllPerspectives(billId)
      await load()
    } catch (err: any) {
      setGenerateError(err?.message ?? 'Failed to generate all perspectives.')
    } finally {
      setBulkRunning(null)
    }
  }

  const clearAll = async () => {
    setBulkRunning('clear')
    setGenerateError(null)
    try {
      await api.clearPerspectives(billId)
      setPerspectives([])
      setPending(await api.getPerspectives(billId).then((d) => d?.pending_types ?? []))
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
          return [...filtered, {
            perspective_type: data.perspective_type,
            position: data.position,
            key_arguments: data.key_arguments,
            concerns: data.concerns,
            assessment: data.assessment,
            generated_at: data.generated_at,
          }]
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

  // Group generated perspectives
  const groups = ['Political', 'Policy', 'Demographic', 'Special']

  const isBusy = generating !== null || bulkRunning !== null

  return (
    <div className="space-y-6">
      {generateError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {generateError}
        </div>
      )}

      {/* Bulk actions — admin only */}
      {isAdmin && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={generateAll}
            disabled={isBusy}
            className="text-xs px-3 py-1.5 rounded-md border font-medium transition-colors hover:bg-muted/40 disabled:opacity-50"
          >
            {bulkRunning === 'all' ? 'Generating…' : 'Generate All'}
          </button>
          <button
            onClick={clearAll}
            disabled={isBusy}
            className="text-xs px-3 py-1.5 rounded-md border font-medium transition-colors hover:bg-red-50 hover:border-red-300 hover:text-red-700 disabled:opacity-50"
          >
            {bulkRunning === 'clear' ? 'Clearing…' : 'Clear All'}
          </button>
        </div>
      )}

      <PerspectivesTally perspectives={perspectives} />

      {groups.map((group) => {
        const groupKeys = ALL_PERSPECTIVES.filter((p) => p.group === group).map((p) => p.key)
        const generated = perspectives.filter((p) => groupKeys.includes(p.perspective_type))
        const pendingInGroup = pending.filter((t) => groupKeys.includes(t))

        if (generated.length === 0 && pendingInGroup.length === 0) return null

        return (
          <div key={group}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{group}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {generated.map((p) => (
                <PerspectiveCard key={p.perspective_type} p={p} />
              ))}
              {pendingInGroup.map((t) => {
                const pendingMeta = ALL_PERSPECTIVES.find((x) => x.key === t)
                const label = pendingMeta?.label ?? t
                const pendingIcon = pendingMeta?.icon
                const isGenerating = generating === t
                return (
                  <div key={t} className="border border-dashed rounded-lg p-4 flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                      {pendingIcon && <span className="text-base leading-none">{pendingIcon}</span>}
                      {label}
                    </span>
                    {isAdmin && (
                      <button
                        onClick={() => generate(t)}
                        disabled={isGenerating || isBusy}
                        className="shrink-0 text-xs px-3 py-1.5 rounded-md border font-medium transition-colors hover:bg-muted/40 disabled:opacity-50"
                      >
                        {isGenerating ? 'Starting AI…' : 'Generate'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
