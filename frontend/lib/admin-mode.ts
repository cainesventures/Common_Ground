'use client'

import { useState, useEffect } from 'react'

const KEY = 'cg_admin_mode'
const EVENT = 'cg-admin-mode-changed'

export type AdminMode = 'admin' | 'user'

export function getAdminMode(): AdminMode {
  if (typeof window === 'undefined') return 'admin'
  const v = localStorage.getItem(KEY)
  return v === 'user' ? 'user' : 'admin'
}

export function setAdminMode(mode: AdminMode) {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY, mode)
  window.dispatchEvent(new Event(EVENT))
}

/**
 * Subscribe to the admin-mode preference.  Mode persists in localStorage,
 * updates across tabs (storage event), and updates same-tab (custom event).
 * Defaults to 'admin' so an admin who hasn't toggled sees their tools.
 */
export function useAdminMode(): [AdminMode, (mode: AdminMode) => void] {
  // Start with 'admin' for SSR / first paint; reconcile from localStorage on mount.
  const [mode, setModeState] = useState<AdminMode>('admin')

  useEffect(() => {
    setModeState(getAdminMode())
    const handler = () => setModeState(getAdminMode())
    window.addEventListener(EVENT, handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener(EVENT, handler)
      window.removeEventListener('storage', handler)
    }
  }, [])

  const set = (m: AdminMode) => {
    setAdminMode(m)
    setModeState(m)
  }
  return [mode, set]
}
