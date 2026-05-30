'use client'

import { startGoogleSignIn } from '@/lib/auth'

interface LoginModalProps {
  onClose: () => void
  reason?: string
}

export function LoginModal({ onClose, reason = 'Sign in to continue' }: LoginModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-background border rounded-xl p-6 max-w-sm w-full mx-4 space-y-4 shadow-xl">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Sign in to vote</h2>
          <p className="text-sm text-muted-foreground">{reason}</p>
        </div>

        <button
          onClick={startGoogleSignIn}
          className="flex items-center justify-center w-full py-2.5 px-4 rounded-lg border bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Sign in with Google
        </button>

        <button
          onClick={onClose}
          className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
