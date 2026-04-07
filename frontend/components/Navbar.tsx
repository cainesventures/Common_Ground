'use client'

import Link from 'next/link'
import { useEffect, useState, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ThemeToggle } from '@/components/ThemeToggle'
import { api } from '@/lib/api'
import { getToken, clearToken } from '@/lib/auth'

interface User {
  id: string
  display_name: string
  avatar_url: string | null
  email: string
  subscription_tier?: string
}

function avatarSrc(user: User): string {
  if (user.avatar_url) return user.avatar_url
  if (user.subscription_tier === 'dev') return `https://flagcdn.com/us.svg`
  return `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(user.id)}`
}

export function Navbar() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const menuRef = useRef<HTMLDivElement>(null)

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Close on outside click
  useEffect(() => {
    if (!mobileOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMobileOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [mobileOpen])

  useEffect(() => {
    if (getToken()) {
      api.getMe()
        .then((data) => data?.user && setUser(data.user))
        .catch(() => clearToken())
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const handleSignOut = () => {
    clearToken()
    window.location.href = '/'
  }

  const handleGoogleLogin = () => {
    window.location.href = '/api/auth/google'
  }

  const handleDevLogin = async () => {
    try {
      const res = await fetch('/api/auth/dev-login', { method: 'POST' })
      const data = await res.json()
      if (data?.access_token) {
        localStorage.setItem('cg_access_token', data.access_token)
        window.location.reload()
      }
    } catch {
      // ignore
    }
  }

  const isDev = process.env.NODE_ENV === 'development'

  const navLinks = [
    { href: '/legislation', label: 'Legislation' },
    { href: '/councilmembers', label: 'Council' },
    { href: '/donate', label: 'Donate' },
    ...(user ? [{ href: '/my-bills', label: 'My Bills' }] : []),
    ...(user ? [{ href: '/profile', label: 'Profile' }] : []),
    ...(user?.subscription_tier === 'dev' ? [{ href: '/dashboard', label: 'Dashboard' }] : []),
    ...(user?.subscription_tier === 'dev' ? [{ href: '/admin', label: 'Admin' }] : []),
  ]

  return (
    <nav className="border-b bg-white/80 backdrop-blur sticky top-0 z-50" ref={menuRef}>
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="font-bold text-lg tracking-tight shrink-0">
          Common Ground
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((l) => (
            <Link key={l.href} href={l.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {l.label}
            </Link>
          ))}
        </div>

        {/* Right side: theme toggle + auth + hamburger */}
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {/* Auth — hidden on mobile to keep nav clean */}
          <div className="hidden md:flex items-center gap-3">
            {loading ? null : user ? (
              <>
                <Link href="/profile" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={avatarSrc(user)} alt={user.display_name} />
                    <AvatarFallback>{user.display_name?.[0] ?? 'U'}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{user.display_name}</span>
                </Link>
                <Button variant="ghost" size="sm" onClick={handleSignOut}>Sign out</Button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGoogleLogin}
                  className="inline-flex items-center gap-2 justify-center rounded-lg px-3 h-8 text-sm font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign in with Google
                </button>
                {isDev && (
                  <button
                    onClick={handleDevLogin}
                    className="inline-flex items-center justify-center rounded-lg px-2 h-8 text-xs font-medium text-muted-foreground border border-dashed hover:bg-muted transition-colors"
                    title="Dev login (local only)"
                  >
                    Dev
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Hamburger — mobile only */}
          <button
            className="md:hidden p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t bg-white/95 backdrop-blur px-4 py-3 space-y-1">
          {navLinks.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`block px-3 py-2 rounded-md text-sm transition-colors ${
                pathname === l.href ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {l.label}
            </Link>
          ))}
          <div className="pt-2 border-t mt-2">
            {loading ? null : user ? (
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={avatarSrc(user)} alt={user.display_name} />
                    <AvatarFallback>{user.display_name?.[0] ?? 'U'}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{user.display_name}</span>
                </div>
                <button onClick={handleSignOut} className="text-sm text-muted-foreground hover:text-foreground">Sign out</button>
              </div>
            ) : (
              <>
                <button
                  onClick={handleGoogleLogin}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign in with Google
                </button>
                {isDev && (
                  <button
                    onClick={handleDevLogin}
                    className="w-full text-left px-3 py-2 rounded-md text-xs text-muted-foreground border border-dashed hover:bg-muted transition-colors"
                  >
                    Dev Login (local only)
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
