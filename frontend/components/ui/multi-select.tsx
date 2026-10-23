'use client'

import { useEffect, useId, useRef, useState } from 'react'
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
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const optId = (i: number) => `${listId}-opt-${i}`

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch('') }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Fallback Escape for when focus has left the search box (e.g. after a mouse
  // click on an option). The in-list handler runs first and prevents default.
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); setOpen(false); setSearch('') }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Focus the search box (or the list) when the dropdown opens
  useEffect(() => {
    if (!open) return
    setActive(0)
    setTimeout(() => (searchable ? searchRef.current : listRef.current)?.focus(), 0)
  }, [open, searchable])

  const visible = options.filter(opt => !search || opt.label.toLowerCase().includes(search.toLowerCase()))

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (open) document.getElementById(optId(active))?.scrollIntoView({ block: 'nearest' })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open])

  const close = () => { setOpen(false); setSearch(''); triggerRef.current?.focus() }

  // Combobox keyboard model: focus stays in the search box and
  // aria-activedescendant points at the highlighted option. Before this,
  // ArrowDown did nothing and Escape dropped focus onto the page body.
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, visible.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(visible.length - 1) }
    else if (e.key === 'Enter' || (e.key === ' ' && !searchable)) {
      e.preventDefault()
      if (visible[active]) toggle(visible[active].value)
    }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'Tab') { setOpen(false); setSearch('') }
  }

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
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}
        className={cn(
          'flex w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-background px-2.5 py-0 text-sm whitespace-nowrap transition-colors',
          'hover:bg-muted',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
        <div className="absolute top-full left-0 mt-1 z-50 min-w-full w-max max-w-[300px] max-h-72 flex flex-col rounded-lg bg-background border border-foreground/10 shadow-md">
          {searchable && (
            <div className="flex items-center gap-2 border-b px-2.5 py-1.5 shrink-0">
              <SearchIcon className="size-3.5 text-muted-foreground shrink-0" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setActive(0) }}
                onKeyDown={onListKeyDown}
                role="combobox"
                aria-expanded={true}
                aria-controls={listId}
                aria-activedescendant={visible[active] ? optId(active) : undefined}
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground min-w-0"
                onClick={(e) => e.stopPropagation()}
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
              )}
            </div>
          )}
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            tabIndex={searchable ? undefined : 0}
            aria-activedescendant={!searchable && visible[active] ? optId(active) : undefined}
            onKeyDown={searchable ? undefined : onListKeyDown}
            className="overflow-y-auto flex-1 p-1 focus:outline-none"
          >
          {visible.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No matches</p>}
          {visible.map((opt, i) => {
            const isSelected = selected.includes(opt.value)
            return (
              <div
                key={opt.value}
                id={optId(i)}
                role="option"
                aria-selected={isSelected}
                onClick={() => toggle(opt.value)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left cursor-pointer transition-colors',
                  i === active && 'bg-muted',
                )}
              >
                <span className={cn(
                  'flex items-center justify-center w-4 h-4 rounded border shrink-0 transition-colors',
                  isSelected ? 'bg-foreground border-foreground' : 'border-foreground/30'
                )}>
                  {isSelected && <CheckIcon className="size-3 text-background" strokeWidth={3} />}
                </span>
                <span className={cn('break-words min-w-0', isSelected ? 'font-medium' : '')}>{opt.label}</span>
              </div>
            )
          })}
          </div>
        </div>
      )}
    </div>
  )
}
