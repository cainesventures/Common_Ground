'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { getCityConfig } from '@/lib/city'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
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

  // Close on Escape key
  useEffect(() => {
    if (!mobileOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
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

  // Derive city from path: /philadelphia/... → 'philadelphia'
  const citySlug = pathname.split('/')[1]
  const cityConfig = getCityConfig(citySlug)
  const p = cityConfig ? `/${citySlug}` : ''

  const navLinks = [
    { href: `${p}/legislation`, label: 'Legislation' },
    { href: `${p}/councilmembers`, label: 'Council' },
    { href: `${p}/insights`, label: 'Insights' },
    ...(user ? [{ href: `${p}/my-bills`, label: 'My Bills' }] : []),
    ...(user?.subscription_tier === 'dev' ? [{ href: '/dashboard', label: 'Dashboard' }] : []),
    ...(user?.subscription_tier === 'dev' ? [{ href: '/admin', label: 'Admin' }] : []),
  ]

  return (
    <nav className="border-b bg-background/80 backdrop-blur sticky top-0 z-50" ref={menuRef}>
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight shrink-0">
          <Image src="/logo.png" alt="" width={28} height={28} className="rounded-md dark:hidden" />
          Open Common Ground
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((l) => (
            <Link key={l.href} href={l.href} className={`text-sm transition-colors ${pathname === l.href ? 'text-foreground font-semibold underline underline-offset-4 decoration-primary/60' : 'text-muted-foreground hover:text-foreground'}`}>
              {l.label}
            </Link>
          ))}
          <Link
            href="/donate"
            className={`text-sm font-semibold px-3 py-1.5 rounded-md border transition-colors ${
              pathname === '/donate'
                ? 'bg-foreground text-background border-foreground'
                : 'border-foreground/20 text-foreground hover:bg-muted'
            }`}
          >
            Donate
          </Link>
        </div>

        {/* Right side: auth + hamburger */}
        <div className="flex items-center gap-3">
          {/* Auth — hidden on mobile to keep nav clean */}
          <div className="hidden md:flex items-center gap-3">
            {loading ? null : user ? (
              <>
                <Link href="/profile" className={`flex items-center gap-2 hover:opacity-80 transition-opacity ${pathname === '/profile' ? 'opacity-100' : ''}`}>
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={avatarSrc(user)} alt={user.display_name} />
                    <AvatarFallback>{user.display_name?.[0] ?? 'U'}</AvatarFallback>
                  </Avatar>
                  <span className={`text-sm max-w-[100px] truncate ${pathname === '/profile' ? 'font-semibold' : ''}`}>{user.display_name}</span>
                </Link>
                <Button variant="ghost" size="sm" onClick={handleSignOut}>Sign out</Button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-lg px-3 h-8 text-sm font-medium border hover:bg-muted transition-colors"
                >
                  Sign in
                </Link>
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
        <div className="md:hidden border-t bg-background/95 backdrop-blur px-4 py-3 space-y-1">
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
          <Link
            href="/donate"
            className={`block px-3 py-2 rounded-md text-sm font-semibold transition-colors ${
              pathname === '/donate' ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted'
            }`}
          >
            Donate
          </Link>
          <div className="pt-2 border-t mt-2">
            {loading ? null : user ? (
              <div className="flex items-center justify-between px-3 py-2">
                <Link href="/profile" className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity">
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarImage src={avatarSrc(user)} alt={user.display_name} />
                    <AvatarFallback>{user.display_name?.[0] ?? 'U'}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm truncate max-w-[150px]">{user.display_name}</span>
                </Link>
                <button onClick={handleSignOut} className="text-sm text-muted-foreground hover:text-foreground shrink-0 ml-2">Sign out</button>
              </div>
            ) : (
              <>
                <Link
                  href="/login"
                  className="block px-3 py-2 rounded-md text-sm font-medium border text-center hover:bg-muted transition-colors"
                >
                  Sign in
                </Link>
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
