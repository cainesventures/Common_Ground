'use client'

import { useCallback, useId, useRef } from 'react'

/**
 * ARIA wiring and keyboard behaviour for a tab strip.
 *
 * The site has four of these (bill detail, council member, budget views, admin)
 * and every one was built from plain <button>s: no role="tablist"/"tab", no
 * aria-selected, no aria-controls, and no arrow-key movement. A screen reader
 * announced five unlabelled buttons, and the `[role="tab"]` focus style already
 * in globals.css matched nothing on the site.
 *
 * This supplies the semantics and leaves the styling alone, so each strip keeps
 * its own look. It implements the roving-tabindex pattern the APG specifies:
 * exactly one tab is tabbable, and Left/Right/Home/End move between them.
 *
 * Usage:
 *   const tabs = useTabs(KEYS, activeTab, setActiveTab)
 *   <div {...tabs.tablistProps} aria-label="Bill sections">
 *     {KEYS.map(k => <button key={k} {...tabs.tabProps(k)}>…</button>)}
 *   </div>
 *   <div {...tabs.panelProps('summary')}>…</div>
 *
 * Pass the keys actually rendered — several strips filter tabs out, and arrow
 * navigation has to match what is on screen.
 */
export function useTabs<T extends string>(
  keys: readonly T[],
  active: T,
  onChange: (key: T) => void,
  options: { orientation?: 'horizontal' | 'vertical' } = {},
) {
  const base = useId()
  const refs = useRef(new Map<T, HTMLButtonElement | null>())
  const orientation = options.orientation ?? 'horizontal'

  const tabId = (key: T) => `${base}-tab-${key}`
  const panelId = (key: T) => `${base}-panel-${key}`

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
      const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'
      let target: T | undefined

      if (e.key === nextKey) {
        target = keys[(keys.indexOf(active) + 1) % keys.length]
      } else if (e.key === prevKey) {
        target = keys[(keys.indexOf(active) - 1 + keys.length) % keys.length]
      } else if (e.key === 'Home') {
        target = keys[0]
      } else if (e.key === 'End') {
        target = keys[keys.length - 1]
      }
      if (!target) return

      e.preventDefault()
      onChange(target)
      // Follow focus, which is the expected behaviour for tabs that activate on
      // selection (APG "tabs with automatic activation").
      refs.current.get(target)?.focus()
    },
    [keys, active, onChange, orientation],
  )

  return {
    tablistProps: {
      role: 'tablist' as const,
      'aria-orientation': orientation,
      onKeyDown,
    },
    tabProps: (key: T) => ({
      id: tabId(key),
      role: 'tab' as const,
      'aria-selected': active === key,
      // Only the selected tab points at a panel. Every strip here renders just
      // the active panel, so setting aria-controls on the others would leave a
      // dangling IDREF that validators flag and some screen readers follow into
      // nothing. The APG allows omitting it when the panel is not in the DOM.
      'aria-controls': active === key ? panelId(key) : undefined,
      // Roving tabindex: Tab enters the strip once, arrows move within it.
      tabIndex: active === key ? 0 : -1,
      ref: (el: HTMLButtonElement | null) => {
        refs.current.set(key, el)
      },
      onClick: () => onChange(key),
    }),
    panelProps: (key: T) => ({
      id: panelId(key),
      role: 'tabpanel' as const,
      'aria-labelledby': tabId(key),
      tabIndex: 0,
    }),
  }
}
