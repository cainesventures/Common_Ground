'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Search, FileText, User, PenLine, CornerDownLeft, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { CITY_SLUG } from '@/lib/city'
import { fmtStatus } from '@/lib/utils'
import type { Bill, Councilmember } from '@/lib/types'

type Item = {
  key: string
  kind: 'bill' | 'member' | 'post' | 'page'
  label: string
  meta?: string
  href: string
}

type PostLite = { slug: string; title: string; dek: string }

const PAGES: Item[] = [
  { key: 'p-leg', kind: 'page', label: 'All legislation', href: `/${CITY_SLUG}/legislation` },
  { key: 'p-play', kind: 'page', label: 'Bills still in play', href: `/${CITY_SLUG}/legislation?status=introduced,in_committee,awaiting_mayor` },
  { key: 'p-council', kind: 'page', label: 'Council members', href: `/${CITY_SLUG}/councilmembers` },
  { key: 'p-insights', kind: 'page', label: 'Insights', href: `/${CITY_SLUG}/insights` },
  { key: 'p-budget', kind: 'page', label: 'Budget explorer', href: '/budget' },
  { key: 'p-blog', kind: 'page', label: 'Blog', href: '/blog' },
]

const ICON = { bill: FileText, member: User, post: PenLine, page: CornerDownLeft }
const GROUP = { bill: 'Bills', member: 'Council members', post: 'Blog', page: 'Go to' }

/** Open the palette from anywhere, e.g. the navbar button. */
export function openCommandPalette() {
  window.dispatchEvent(new Event('cg:open-palette'))
}

/**
 * Site-wide search: Cmd/Ctrl+K or "/" opens it, results arrive as you type.
 *
 * The site's only search needed a submit and a page load, and searched bills
 * alone; finding a council member or a blog post meant knowing where to look.
 * This searches all three at once. Bills come from the same search endpoint
 * as the list page; members and posts are small enough to filter in the
 * browser after one fetch each, made the first time the palette opens.
 */
export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [bills, setBills] = useState<Bill[]>([])
  const [loadingBills, setLoadingBills] = useState(false)
  const [members, setMembers] = useState<Councilmember[]>([])
  const [posts, setPosts] = useState<PostLite[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const listId = useId()
  const fetchedRef = useRef(false)

  // Global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === '/' && !typing && !open) {
        e.preventDefault()
        setOpen(true)
      }
    }
    const onOpen = () => setOpen(true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('cg:open-palette', onOpen)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('cg:open-palette', onOpen)
    }
  }, [open])

  // On open: remember the opener, lock scroll, focus, load members/posts once.
  useEffect(() => {
    if (!open) return
    openerRef.current = document.activeElement as HTMLElement | null
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    setTimeout(() => inputRef.current?.focus(), 0)
    if (!fetchedRef.current) {
      fetchedRef.current = true
      api.getCouncilmembers().then((d) => setMembers(d?.members ?? [])).catch(() => {})
      fetch('/data/blog_posts.json')
        .then((r) => r.json())
        .then((d) => setPosts((d?.posts ?? []).map((p: PostLite) => ({ slug: p.slug, title: p.title, dek: p.dek }))))
        .catch(() => {})
    }
    return () => {
      document.body.style.overflow = prev
      openerRef.current?.focus?.()
    }
  }, [open])

  // Bills: debounced server search.
  useEffect(() => {
    const term = q.trim()
    if (!open || term.length < 2) { setBills([]); setLoadingBills(false); return }
    setLoadingBills(true)
    const t = setTimeout(() => {
      api.searchLegislation(term, 6, 0, 'local', 'true')
        .then((d) => setBills(d?.results ?? []))
        .catch(() => setBills([]))
        .finally(() => setLoadingBills(false))
    }, 180)
    return () => clearTimeout(t)
  }, [q, open])

  const items: Item[] = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return PAGES
    const m = members
      .filter((x) => x.name.toLowerCase().includes(term) || (x.district ?? '').toLowerCase().includes(term))
      .slice(0, 4)
      .map((x) => ({ key: `m-${x.id}`, kind: 'member' as const, label: x.name, meta: x.district ?? undefined, href: `/${CITY_SLUG}/councilmembers/${x.id}` }))
    const p = posts
      .filter((x) => `${x.title} ${x.dek}`.toLowerCase().includes(term))
      .slice(0, 3)
      .map((x) => ({ key: `p-${x.slug}`, kind: 'post' as const, label: x.title, href: `/blog/${x.slug}` }))
    const b = bills.map((x) => ({
      key: `b-${x.id}`, kind: 'bill' as const,
      label: x.headline || x.plain_title || x.title,
      meta: [x.bill_number, x.status ? fmtStatus(x.status) : ''].filter(Boolean).join(' · '),
      href: `/${CITY_SLUG}/legislation/${x.id}`,
    }))
    const pages = PAGES.filter((x) => x.label.toLowerCase().includes(term))
    const all: Item = { key: 'search-all', kind: 'page', label: `Search all bills for "${q.trim()}"`, href: `/${CITY_SLUG}/legislation?q=${encodeURIComponent(q.trim())}` }
    return [...m, ...b, ...p, ...pages, all]
  }, [q, members, posts, bills])

  useEffect(() => { setActive(0) }, [items.length, q])

  const go = useCallback((item: Item | undefined) => {
    if (!item) return
    setOpen(false)
    setQ('')
    router.push(item.href)
  }, [router])

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(items[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, listId])

  if (!open) return null

  let lastKind: Item['kind'] | null = null
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh] bg-black/50 backdrop-blur-sm anim-fade-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div role="dialog" aria-modal="true" aria-label="Search the site"
        className="w-full max-w-xl rounded-2xl border bg-popover text-popover-foreground shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 border-b">
          {loadingBills
            ? <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" aria-hidden="true" />
            : <Search className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search bills, council members, posts…"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            className="flex-1 bg-transparent py-4 text-base outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden sm:inline text-xs text-muted-foreground border rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="max-h-[60vh] overflow-y-auto p-2">
          {items.map((item, i) => {
            const Icon = ICON[item.kind]
            const header = item.kind !== lastKind && item.key !== 'search-all' ? GROUP[item.kind] : null
            lastKind = item.kind
            return (
              <li key={item.key} role="presentation">
                {header && <p className="px-3 pt-3 pb-1 type-eyebrow text-muted-foreground" aria-hidden="true">{header}</p>}
                <div
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(item)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer ${i === active ? 'bg-muted' : ''}`}
                >
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                  <span className="flex-1 min-w-0 text-sm truncate">{item.label}</span>
                  {item.meta && <span className="text-xs text-muted-foreground shrink-0">{item.meta}</span>}
                </div>
              </li>
            )
          })}
          {q.trim().length >= 2 && !loadingBills && items.length <= 1 && (
            <li role="presentation" className="px-3 py-6 text-sm text-center text-muted-foreground">Nothing matched. Press Enter to search all bills.</li>
          )}
        </ul>
        <div className="hidden sm:flex items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
          <span><kbd className="border rounded px-1">↑</kbd> <kbd className="border rounded px-1">↓</kbd> to move</span>
          <span><kbd className="border rounded px-1">Enter</kbd> to open</span>
          <span className="ml-auto">Open anytime with <kbd className="border rounded px-1">/</kbd></span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
