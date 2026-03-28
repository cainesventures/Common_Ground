'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { StanceBuilder } from '@/components/StanceBuilder'
import { UpgradeBanner } from '@/components/UpgradeBanner'
import { api } from '@/lib/api'
import { isLoggedIn } from '@/lib/auth'

interface Dimension {
  key: string
  label: string
  description: string
  positions: Record<string, string>
}

const DEFAULT_STANCES: Record<string, number> = {
  economy: 3,
  environment: 3,
  healthcare: 3,
  immigration: 3,
  social: 3,
  government: 3,
}

export default function MyDebatorPage() {
  const router = useRouter()
  const [dimensions, setDimensions] = useState<Dimension[]>([])
  const [stances, setStances] = useState<Record<string, number>>(DEFAULT_STANCES)
  const [displayName, setDisplayName] = useState('')
  const [existingAgent, setExistingAgent] = useState<any>(null)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dimError, setDimError] = useState(false)

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace('/')
      return
    }

    Promise.all([
      api.getMe(),
      api.getDimensions(),
      api.getMyAgent().catch(() => null),
    ]).then(([meData, dimData, agentData]) => {
      setCurrentUser(meData?.user ?? null)
      if (!dimData?.dimensions?.length) setDimError(true)
      setDimensions(dimData?.dimensions ?? [])
      if (agentData?.agent) setExistingAgent(agentData.agent)
    }).catch(() => setDimError(true))
      .finally(() => setLoading(false))
  }, [router])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const data = await api.createMyAgent(stances, displayName || undefined)
      if (data?.agent) {
        setExistingAgent(data.agent)
        setSaved(true)
      }
    } catch (e: any) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete your personal AI debator?')) return
    await api.deleteMyAgent().catch(() => {})
    setExistingAgent(null)
  }

  if (loading) return <div className="h-64 bg-muted animate-pulse rounded-lg" />

  const tier = currentUser?.subscription_tier ?? 'free'

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">My AI Debator</h1>
        <p className="text-muted-foreground mt-1">
          Define your political stances and we&apos;ll build an AI agent that argues on your behalf.
          No free text — just pick a position on each dimension.
        </p>
      </div>

      {tier === 'free' && (
        <UpgradeBanner requiredTier="paid" featureName="Personal AI Debator" />
      )}

      {existingAgent && (
        <div className="border rounded-lg p-4 bg-muted/40 flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">Current debator: <span className="font-bold">{existingAgent.name}</span></p>
            <p className="text-xs text-muted-foreground">Saving new stances will replace this debator.</p>
          </div>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">Debator name (optional)</label>
        <input
          type="text"
          maxLength={50}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. My Debator"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {dimError && (
        <p className="text-sm text-destructive">
          Could not load stance dimensions. Make sure the backend is running and try refreshing.
        </p>
      )}

      {!dimError && dimensions.length > 0 && tier !== 'free' && (
        <>
          <StanceBuilder
            dimensions={dimensions}
            stances={stances}
            onChange={(key, val) => setStances((s) => ({ ...s, [key]: val }))}
          />

          <div className="flex gap-3 items-center">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Building…' : existingAgent ? 'Update My Debator' : 'Build My Debator'}
            </Button>
            {saved && (
              <span className="text-sm text-green-600 font-medium">Saved!</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
