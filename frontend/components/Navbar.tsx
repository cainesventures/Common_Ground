'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { api } from '@/lib/api'
import { getToken, clearToken } from '@/lib/auth'

interface User {
  id: string
  display_name: string
  avatar_url: string
  email: string
  subscription_tier?: string
}

export function Navbar() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

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

  return (
    <nav className="border-b bg-white/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-bold text-lg tracking-tight">
            Common Ground
          </Link>
          <Link href="/legislation" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Legislation
          </Link>
          <Link href="/councilmembers" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Council
          </Link>
          <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Pricing
          </Link>
          {user && (
            <Link href="/profile" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Profile
            </Link>
          )}
          {user?.subscription_tier === 'dev' && (
            <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Admin
            </Link>
          )}
        </div>

        <div className="flex items-center gap-3">
          {loading ? null : user ? (
            <>
              <Link href="/profile" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user.avatar_url} alt={user.display_name} />
                  <AvatarFallback>{user.display_name?.[0] ?? 'U'}</AvatarFallback>
                </Avatar>
                <span className="text-sm hidden sm:block">{user.display_name}</span>
              </Link>
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                Sign out
              </Button>
            </>
          ) : (
            <button
              onClick={handleDevLogin}
              className="inline-flex items-center justify-center rounded-lg px-3 h-7 text-sm font-medium bg-primary text-primary-foreground transition-colors hover:bg-primary/80"
            >
              Dev Login
            </button>
          )}
        </div>
      </div>
    </nav>
  )
}
