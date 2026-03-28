'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { UpgradeBanner } from '@/components/UpgradeBanner'
import { api } from '@/lib/api'

interface Agent {
  id: string
  name: string
  description: string
  persona: string
  agent_type: string
  expertise_areas?: string[]
}

const PRESETS = [
  { name: 'progressive', label: 'Progressive' },
  { name: 'conservative', label: 'Conservative' },
  { name: 'nonpartisan', label: 'Nonpartisan' },
  { name: 'fiscal', label: 'Fiscal Conservative' },
  { name: 'healthcare', label: 'Healthcare Expert' },
  { name: 'environmental', label: 'Environmentalist' },
  { name: 'humanist', label: 'Humanist' },
  { name: 'communist', label: 'Communist' },
  { name: 'socialist', label: 'Socialist' },
  { name: 'capitalist', label: 'Capitalist' },
  { name: 'comedian', label: 'Comedian' },
  { name: 'dramatic', label: 'Dramatic' },
  { name: 'libertarian', label: 'Libertarian' },
  { name: 'anarchist', label: 'Anarchist' },
  { name: 'technocrat', label: 'Technocrat' },
  { name: 'populist', label: 'Populist' },
]

const TYPE_COLORS: Record<string, string> = {
  claude: 'bg-orange-100 text-orange-700',
  gemini: 'bg-blue-100 text-blue-700',
  local: 'bg-purple-100 text-purple-700',
  byo: 'bg-gray-100 text-gray-600',
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [addingPreset, setAddingPreset] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  // Create form state
  const [form, setForm] = useState({
    name: '',
    description: '',
    persona: '',
    system_prompt: '',
    expertise_areas: '',
    agent_type: 'claude',
    model_name: '',
    api_url: '',
  })
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  useEffect(() => {
    api.getMe().then((data) => setCurrentUser(data?.user ?? null)).catch(() => {})
    api.getAgents(50, 0)
      .then((data) => setAgents(data?.agents ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const addPreset = async (preset: string) => {
    setAddingPreset(preset)
    try {
      const data = await api.createPresetAgent(preset)
      if (data?.agent) {
        setAgents((prev) => {
          if (prev.find((a) => a.id === data.agent.id)) return prev
          return [...prev, data.agent]
        })
      }
    } catch (e: any) {
      alert(e.message)
    } finally {
      setAddingPreset(null)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateError('')
    if (!form.name.trim() || !form.system_prompt.trim()) {
      setCreateError('Name and system prompt are required.')
      return
    }
    setCreating(true)
    try {
      const data = await api.createAgent({
        name: form.name.trim(),
        description: form.description.trim(),
        persona: form.persona.trim(),
        system_prompt: form.system_prompt.trim(),
        expertise_areas: form.expertise_areas ? form.expertise_areas.split(',').map((s) => s.trim()).filter(Boolean) : [],
        agent_type: form.agent_type,
        model_name: form.model_name.trim() || undefined,
        api_url: form.api_url.trim() || undefined,
      })
      if (data?.agent) {
        setAgents((prev) => [...prev, data.agent])
        setShowCreateForm(false)
        setForm({ name: '', description: '', persona: '', system_prompt: '', expertise_areas: '', agent_type: 'claude', model_name: '', api_url: '' })
      }
    } catch (e: any) {
      setCreateError(e.message)
    } finally {
      setCreating(false)
    }
  }

  const existingPresets = new Set(agents.map((a) => a.name.toLowerCase()))
  const tier = currentUser?.subscription_tier ?? 'free'
  const canCreateAgents = tier === 'paid' || tier === 'dev'
  const isDevTier = tier === 'dev'

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Debators</h1>
          <p className="text-muted-foreground mt-1">The AI personas that debate legislation on Common Ground.</p>
        </div>
        {canCreateAgents && (
          <Button onClick={() => setShowCreateForm((v) => !v)}>
            {showCreateForm ? 'Cancel' : '+ Custom Agent'}
          </Button>
        )}
      </div>

      {currentUser && !canCreateAgents && (
        <UpgradeBanner requiredTier="paid" featureName="Creating and managing custom debators" />
      )}

      {/* ── Create custom agent form ── */}
      {showCreateForm && canCreateAgents && (
        <form onSubmit={handleCreate} className="border rounded-lg p-5 space-y-4 bg-muted/20">
          <h2 className="font-semibold">Create Custom Agent</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={100}
                placeholder="e.g. Climate Scientist"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Agent type</label>
              <select
                value={form.agent_type}
                onChange={(e) => setForm((f) => ({ ...f, agent_type: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="claude">Claude (Anthropic API)</option>
                {isDevTier && <option value="local">Local (Ollama / LM Studio)</option>}
                {isDevTier && <option value="byo">BYO (custom endpoint)</option>}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Short one-line description"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Persona</label>
            <input
              value={form.persona}
              onChange={(e) => setForm((f) => ({ ...f, persona: e.target.value }))}
              placeholder="e.g. A data-driven climate scientist focused on peer-reviewed evidence"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">System prompt * <span className="text-muted-foreground font-normal">(max 8000 chars)</span></label>
            <textarea
              value={form.system_prompt}
              onChange={(e) => setForm((f) => ({ ...f, system_prompt: e.target.value }))}
              maxLength={8000}
              rows={6}
              placeholder="You are a climate scientist with 20 years of research experience..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
            />
            <p className="text-xs text-muted-foreground text-right">{form.system_prompt.length} / 8000</p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Expertise areas <span className="text-muted-foreground font-normal">(comma-separated)</span></label>
            <input
              value={form.expertise_areas}
              onChange={(e) => setForm((f) => ({ ...f, expertise_areas: e.target.value }))}
              placeholder="climate science, renewable energy, carbon policy"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {(form.agent_type === 'local' || form.agent_type === 'byo') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Model name</label>
                <input
                  value={form.model_name}
                  onChange={(e) => setForm((f) => ({ ...f, model_name: e.target.value }))}
                  placeholder="e.g. llama3.2"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">API URL</label>
                <input
                  value={form.api_url}
                  onChange={(e) => setForm((f) => ({ ...f, api_url: e.target.value }))}
                  placeholder="http://localhost:11434"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          )}

          {createError && <p className="text-sm text-destructive">{createError}</p>}

          <div className="flex gap-3">
            <Button type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create Agent'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {/* ── Add presets ── */}
      {canCreateAgents && (
        <section className="space-y-3">
          <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Add Preset Agents</h2>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(({ name, label }) => {
              const exists = existingPresets.has(label.toLowerCase()) || existingPresets.has(name)
              return (
                <Button
                  key={name}
                  variant="outline"
                  size="sm"
                  disabled={exists || addingPreset === name}
                  onClick={() => addPreset(name)}
                >
                  {addingPreset === name ? 'Adding…' : exists ? `✓ ${label}` : `+ ${label}`}
                </Button>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Agent list ── */}
      <section className="space-y-3">
        <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
          Debators ({agents.length})
        </h2>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents yet. Add a preset or create a custom agent above.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {agents.map((agent) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className="border rounded-lg p-4 space-y-2 hover:bg-muted/40 transition-colors block"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{agent.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${TYPE_COLORS[agent.agent_type] ?? 'bg-gray-100 text-gray-600'}`}>
                    {agent.agent_type}
                  </span>
                </div>
                {agent.persona && (
                  <p className="text-xs text-muted-foreground line-clamp-3">{agent.persona}</p>
                )}
                {agent.expertise_areas && (
                  <div className="flex flex-wrap gap-1">
                    {agent.expertise_areas.split(',').map((a: string) => a.trim()).filter(Boolean).slice(0, 4).map((area: string) => (
                      <span key={area} className="text-xs bg-muted px-1.5 py-0.5 rounded">{area}</span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-primary">View profile →</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
