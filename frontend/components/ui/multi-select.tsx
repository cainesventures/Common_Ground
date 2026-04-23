'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { ChevronDownIcon, CheckIcon, SearchIcon } from 'lucide-react'

interface Option {
  value: string
  label: string
}

interface MultiSelectProps {
  options: Option[]
  selected: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  className?: string
  searchable?: boolean
  searchPlaceholder?: string
}

export function MultiSelect({ options, selected, onChange, placeholder = 'All', className, searchable = true, searchPlaceholder = 'Search…' }: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch('') }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); setSearch('') } }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open && searchable) setTimeout(() => searchRef.current?.focus(), 0)
  }, [open, searchable])

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value])
  }

  const label = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? (options.find(o => o.value === selected[0])?.label ?? selected[0])
      : `${selected.length} selected`

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-background px-2.5 py-0 text-sm whitespace-nowrap transition-colors',
          'hover:bg-gray-50 dark:hover:bg-zinc-800',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60',
          selected.length > 0 ? 'border-foreground/40 font-medium' : 'text-foreground/80',
          className
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex-1 text-left truncate">{label}</span>
        {selected.length > 0 && (
          <span
            className="flex items-center justify-center w-4 h-4 rounded-full bg-foreground text-background text-[10px] font-bold shrink-0"
            aria-label={`${selected.length} selected`}
          >
            {selected.length}
          </span>
        )}
        <ChevronDownIcon className={cn('size-4 text-muted-foreground shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-full w-max max-h-72 flex flex-col rounded-lg bg-background border border-foreground/10 shadow-md">
          {searchable && (
            <div className="flex items-center gap-2 border-b px-2.5 py-1.5 shrink-0">
              <SearchIcon className="size-3.5 text-muted-foreground shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 min-w-0"
                onClick={(e) => e.stopPropagation()}
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
              )}
            </div>
          )}
          <div className="overflow-y-auto flex-1 p-1">
          {options.filter(opt => !search || opt.label.toLowerCase().includes(search.toLowerCase())).map(opt => {
            const isSelected = selected.includes(opt.value)
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => toggle(opt.value)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left cursor-pointer transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700"
              >
                <span className={cn(
                  'flex items-center justify-center w-4 h-4 rounded border shrink-0 transition-colors',
                  isSelected ? 'bg-foreground border-foreground' : 'border-foreground/30'
                )}>
                  {isSelected && <CheckIcon className="size-3 text-background" strokeWidth={3} />}
                </span>
                <span className={isSelected ? 'font-medium' : ''}>{opt.label}</span>
              </button>
            )
          })}
          </div>
        </div>
      )}
    </div>
  )
}
