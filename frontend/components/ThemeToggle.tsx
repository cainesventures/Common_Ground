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

  const title = theme === 'dark' ? 'Dark mode (click for system)' : theme === 'light' ? 'Light mode (click for dark)' : 'System theme (click for light)'

  return (
    <button
      onClick={cycle}
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
      aria-label={title}
    >
      {theme === 'light' && (
        // Sun icon
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      )}
      {theme === 'dark' && (
        // Moon icon
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
      {theme === 'system' && (
        // Monitor icon
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path strokeLinecap="round" d="M8 21h8M12 17v4" />
        </svg>
      )}
    </button>
  )
}
