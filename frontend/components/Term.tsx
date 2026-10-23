'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { GLOSSARY } from '@/lib/civic-glossary'

/**
 * A word with a plain-language definition one tap away.
 *
 * Bill pages are full of "in committee", "lapsed", "resolution", "roll call",
 * and a reader who does not know them is the reader this site is for. A real
 * button rather than a hover tooltip: hover does not exist on phones and is
 * unreachable by keyboard. Escape or a click outside closes it.
 */
export function Term({ id, children, className = '' }: { id: string; children: React.ReactNode; className?: string }) {
  const entry = GLOSSARY[id]
  const [open, setOpen] = useState(false)
  const popId = useId()
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!entry) return <>{children}</>

  return (
    <span ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={popId}
        className={`underline decoration-dotted decoration-from-font underline-offset-[3px] cursor-help ${className}`}
      >
        {children}
      </button>
      {open && (
        <span
          id={popId}
          role="note"
          className="absolute left-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-3.5 text-left text-sm font-normal normal-case tracking-normal text-popover-foreground shadow-lg anim-fade-in"
        >
          <span className="block font-semibold mb-1">{entry.term}</span>
          <span className="block text-muted-foreground leading-relaxed">{entry.short}</span>
          <Link href={`/glossary#${id}`} className="mt-2 inline-block text-xs text-primary hover:underline">
            All civic terms →
          </Link>
        </span>
      )}
    </span>
  )
}
