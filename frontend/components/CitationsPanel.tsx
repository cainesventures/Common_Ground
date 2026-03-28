'use client'

import { useState } from 'react'

interface Citation {
  title: string
  url: string
  snippet?: string
  source_type?: string
}

interface CitationsPanelProps {
  citations: Citation[]
}

const SOURCE_LABELS: Record<string, string> = {
  wikipedia: 'Wikipedia',
  web: 'Web',
  congress: 'Congress.gov',
  perplexity: 'Perplexity',
  tavily: 'Tavily',
}

export function CitationsPanel({ citations }: CitationsPanelProps) {
  const [open, setOpen] = useState(false)

  const valid = citations.filter((c) => c.url && c.title)
  if (valid.length === 0) return null

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
      >
        {/* Citation count badge */}
        <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded bg-blue-100 text-blue-700 font-semibold text-[10px] group-hover:bg-blue-200 transition-colors">
          {valid.length}
        </span>
        <span className="underline decoration-dotted underline-offset-2">
          {open ? 'Hide' : 'View'} source{valid.length !== 1 ? 's' : ''}
        </span>
        <span className="transition-transform duration-150" style={{ display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none' }}>
          ▾
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-l-2 border-blue-100 pl-3">
          {valid.map((citation, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex items-center gap-2">
                {citation.source_type && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                    {SOURCE_LABELS[citation.source_type] ?? citation.source_type}
                  </span>
                )}
                <a
                  href={citation.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline line-clamp-1 font-medium"
                >
                  {citation.title}
                </a>
              </div>
              {citation.snippet && (
                <p className="text-xs text-muted-foreground line-clamp-2 pl-0.5">{citation.snippet}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
