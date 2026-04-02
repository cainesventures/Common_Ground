'use client'

import { createContext, useContext, useRef, useState, useCallback } from 'react'

type StreamEvent = {
  current: number
  total: number
  message: string
  done: boolean
}

type PipelineContextValue = {
  progress: StreamEvent | null
  running: boolean
  start: (path: string) => Promise<void>
  stop: () => void
}

const PipelineContext = createContext<PipelineContextValue | null>(null)

export function PipelineProvider({ children }: { children: React.ReactNode }) {
  const [progress, setProgress] = useState<StreamEvent | null>(null)
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const start = useCallback(async (path: string) => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setRunning(true)
    setProgress(null)
    const token = typeof window !== 'undefined' ? localStorage.getItem('cg_access_token') : null
    const url = `http://localhost:8000${path}`
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        setProgress({ current: 0, total: 0, message: err.detail ?? 'Request failed', done: true })
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const ev: StreamEvent = JSON.parse(line.slice(6))
              setProgress(ev)
            } catch { /* ignore malformed */ }
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setProgress({ current: 0, total: 0, message: String(e), done: true })
      }
    } finally {
      setRunning(false)
    }
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    setRunning(false)
  }, [])

  return (
    <PipelineContext.Provider value={{ progress, running, start, stop }}>
      {children}
    </PipelineContext.Provider>
  )
}

export function usePipeline() {
  const ctx = useContext(PipelineContext)
  if (!ctx) throw new Error('usePipeline must be used within PipelineProvider')
  return ctx
}
