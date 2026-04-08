'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { setToken } from '@/lib/auth'
import posthog from 'posthog-js'
import { api } from '@/lib/api'

function AuthCallbackInner() {
  const router = useRouter()
  const params = useSearchParams()

  useEffect(() => {
    const token = params.get('token')
    if (token) {
      setToken(token)
      // Identify user in PostHog after login
      api.getMe().then((data) => {
        const user = data?.user
        if (user) {
          posthog.identify(user.id, { email: user.email, subscription_tier: user.subscription_tier })
        }
      }).catch(() => {})
    }
    router.replace('/')
  }, [params, router])

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
