'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { isLoggedIn, clearToken } from '@/lib/auth'
import { useTheme } from '@/components/ThemeToggle'

export default function ProfilePage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/')
      return
    }

    api.getMe().then((meData) => {
      setUser(meData?.user ?? null)
    }).catch(() => {
      clearToken()
      router.replace('/')
    }).finally(() => setLoading(false))
  }, [router])

  if (loading) return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-muted animate-pulse shrink-0" />
        <div className="space-y-2">
          <div className="h-6 w-36 bg-muted animate-pulse rounded" />
          <div className="h-4 w-48 bg-muted animate-pulse rounded" />
        </div>
      </div>
      <div className="h-14 bg-muted animate-pulse rounded-lg" />
      <div className="h-14 bg-muted animate-pulse rounded-lg" />
    </div>
  )
  if (!user) return null

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16 shrink-0">
          <AvatarImage
            src={
              user.avatar_url
                ? user.avatar_url
                : user.subscription_tier === 'dev'
                  ? `https://flagcdn.com/us.svg`
                  : `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(user.id)}`
            }
            alt={user.display_name}
          />
          <AvatarFallback className="text-xl">{user.display_name?.[0] ?? 'U'}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-2xl font-bold">{user.display_name}</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
          {user.subscription_tier && user.subscription_tier !== 'free' && (
            <Badge variant="outline" className="text-xs mt-1 capitalize">{user.subscription_tier}</Badge>
          )}
        </div>
      </div>

      {/* My Bills */}
      <div className="flex items-center justify-between border rounded-lg px-4 py-3">
        <div>
          <p className="text-sm font-semibold">My Bills</p>
          <p className="text-xs text-muted-foreground mt-0.5">Saved bills and your voting record</p>
        </div>
        <Link href="/philadelphia/my-bills" className="text-sm text-primary hover:underline shrink-0">
          View →
        </Link>
      </div>

      {/* Appearance */}
      <div className="border rounded-lg">
        <div className="px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Appearance</p>
            <p className="text-xs text-muted-foreground mt-0.5">Choose how the app looks to you</p>
          </div>
          <div className="flex rounded-lg border overflow-hidden shrink-0 text-xs font-medium">
            {([
              { key: 'light',  label: 'Light', icon: (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="4" />
                  <path strokeLinecap="round" d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              )},
              { key: 'system', label: 'System', icon: (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path strokeLinecap="round" d="M8 21h8M12 17v4" />
                </svg>
              )},
              { key: 'dark',   label: 'Dark',   icon: (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
              )},
            ] as { key: 'light' | 'system' | 'dark'; label: string; icon: ReactNode }[]).map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setTheme(key)}
                aria-pressed={theme === key}
                className={`flex items-center gap-1.5 px-3 py-2 transition-colors ${
                  theme === key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
