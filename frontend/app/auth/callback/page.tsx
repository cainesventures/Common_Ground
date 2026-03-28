'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { setToken } from '@/lib/auth'

function AuthCallbackInner() {
  const router = useRouter()
  const params = useSearchParams()

  useEffect(() => {
    const token = params.get('token')
    if (token) {
      setToken(token)
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
