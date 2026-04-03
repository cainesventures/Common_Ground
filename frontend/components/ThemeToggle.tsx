'use client'

import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  return (localStorage.getItem('cg_theme') as Theme) ?? 'system'
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.remove('light', 'dark')
  if (theme === 'light') root.classList.add('light')
  else if (theme === 'dark') root.classList.add('dark')
  // 'system' — let the @media query decide (no class)
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>('system')

  useEffect(() => {
    const stored = getStoredTheme()
    setThemeState(stored)
    applyTheme(stored)
  }, [])

  const setTheme = (next: Theme) => {
    localStorage.setItem('cg_theme', next)
    setThemeState(next)
    applyTheme(next)
  }

  return { theme, setTheme }
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const cycle = () => {
    // light → dark → system → light
    setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light')
  }

  const label = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '💻'
  const title = theme === 'dark' ? 'Dark mode (click for system)' : theme === 'light' ? 'Light mode (click for dark)' : 'System theme (click for light)'

  return (
    <button
      onClick={cycle}
      title={title}
      className="text-base w-8 h-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
      aria-label={title}
    >
      {label}
    </button>
  )
}
