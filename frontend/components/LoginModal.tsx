'use client'

import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { startGoogleSignIn } from '@/lib/auth'

interface LoginModalProps {
  onClose: () => void
  reason?: string
  title?: string
}

/**
 * A real modal dialog: announced as one, closes on Escape, locks page scroll,
 * moves focus inside on open and returns it to whatever opened it on close.
 * It used to be a styled div, so a screen reader never knew it had opened and
 * Tab walked straight out of it into the page behind the backdrop.
 */
export function LoginModal({ onClose, reason = 'Sign in to continue', title = 'Sign in' }: LoginModalProps) {
  const titleId = useId()
  const primaryRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  // Callers pass an inline arrow; a ref keeps the effect to mount/unmount.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    primaryRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return }
      if (e.key !== 'Tab' || !dialogRef.current) return
      // Two buttons, so trapping is just wrapping between the first and last.
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button')
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      opener?.focus()
    }
  }, [])

  // Portalled to <body>: rendered in place, an ancestor with a transform (the
  // bill page has several) traps `fixed` inside it, so the backdrop covered
  // only the content column and the sticky navbar sat over the dialog's top.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-background border rounded-xl p-6 max-w-sm w-full mx-4 space-y-4 shadow-xl"
      >
        <div className="space-y-1">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{reason}</p>
        </div>

        <button
          ref={primaryRef}
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
    </div>,
    document.body,
  )
}
