'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { setToken } from '@/lib/auth'
import posthog from 'posthog-js'
import { api } from '@/lib/api'
import Link from 'next/link'

function AuthCallbackInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = useState(false)

  useEffect(() => {
    if (params.get('error')) {
      setError(true)
      return
    }
    const token = params.get('token')
    if (!token) {
      setError(true)
      return
    }
    setToken(token)
    api.getMe().then((data) => {
      const user = data?.user
      if (user) {
        posthog.identify(user.id, { email: user.email, subscription_tier: user.subscription_tier })
      }
    }).catch(() => {}).finally(() => {
      router.replace('/')
    })
  }, [params, router])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 gap-4">
        <p className="text-2xl">🔒</p>
        <h1 className="text-xl font-semibold">Sign-in unavailable</h1>
        <p className="text-muted-foreground max-w-sm text-sm">
          Open Common Ground is currently in early access. Sign-in will be available to everyone shortly — check back soon.
        </p>
        <Link href="/" className="text-sm text-primary hover:underline">
          Browse legislation without signing in →
        </Link>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <p className="text-muted-foreground">Signing you in…</p>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-muted-foreground">Loading…</p></div>}>
      <AuthCallbackInner />
    </Suspense>
  )
}
