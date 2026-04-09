'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { setToken } from '@/lib/auth'
import posthog from 'posthog-js'
import { api } from '@/lib/api'

function AuthCallbackInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = useState(false)

  useEffect(() => {
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
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-destructive font-medium">Sign-in failed — no token received.</p>
        <a href="/" className="text-sm text-primary hover:underline">Return to home</a>
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
