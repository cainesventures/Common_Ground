import { getToken, clearToken } from './auth'

const API_URL = ''  // Use relative URLs — Next.js rewrites proxy to backend

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_URL}${path}`, { ...options, headers })

  if (res.status === 401) {
    if (token) {
      clearToken()
      if (typeof window !== 'undefined') window.location.href = '/'
    }
    return null
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }

  return res.json()
}

export const api = {
  // ── Debates ───────────────────────────────────────────────────────────────
  getDebates: (limit = 20, offset = 0, filters?: { status?: string; level?: string; sort?: string; tag?: string }) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (filters?.status) params.set('status', filters.status)
    if (filters?.level) params.set('level', filters.level)
    if (filters?.sort) params.set('sort', filters.sort)
    if (filters?.tag) params.set('tag', filters.tag)
    return apiFetch(`/api/debates/list?${params}`)
  },

  getDebatesByLegislation: (legislationId: string, limit = 20, offset = 0) =>
    apiFetch(`/api/debates/list?legislation_id=${encodeURIComponent(legislationId)}&limit=${limit}&offset=${offset}`),

  getDebate: (id: string) =>
    apiFetch(`/api/debates/${id}`),

  getDebateMessages: (id: string) =>
    apiFetch(`/api/debates/${id}/messages`),

  // ── Legislation ───────────────────────────────────────────────────────────
  getLegislation: (id: string) =>
    apiFetch(`/api/legislation/${id}`),

  listLegislation: (limit = 20, offset = 0, level = '') =>
    apiFetch(`/api/legislation/list?limit=${limit}&offset=${offset}${level ? `&level=${level}` : ''}`),

  getTagCounts: (params?: { q?: string; level?: string; analyzed?: string; impact?: string; status?: string; sponsor?: string; year?: number; month?: number }) => {
    const p = new URLSearchParams()
    if (params?.q)        p.set('q', params.q)
    if (params?.level)    p.set('level', params.level)
    if (params?.analyzed) p.set('analyzed', params.analyzed)
    if (params?.impact)   p.set('impact', params.impact)
    if (params?.status)   p.set('status', params.status)
    if (params?.sponsor)  p.set('sponsor', params.sponsor)
    if (params?.year)     p.set('year', String(params.year))
    if (params?.month)    p.set('month', String(params.month))
    const qs = p.toString()
    return apiFetch(`/api/legislation/tag-counts${qs ? `?${qs}` : ''}`)
  },

  getYearCounts: (params?: { q?: string; analyzed?: string; tag?: string; impact?: string; status?: string; sponsor?: string }) => {
    const p = new URLSearchParams()
    if (params?.q)        p.set('q', params.q)
    if (params?.analyzed) p.set('analyzed', params.analyzed)
    if (params?.tag)      p.set('tag', params.tag)
    if (params?.impact)   p.set('impact', params.impact)
    if (params?.status)   p.set('status', params.status)
    if (params?.sponsor)  p.set('sponsor', params.sponsor)
    const qs = p.toString()
    return apiFetch(`/api/legislation/year-counts${qs ? `?${qs}` : ''}`)
  },

  countLegislation: (params: { year?: number; month?: number; date_from?: string; date_to?: string; analyzed?: string }) => {
    const p = new URLSearchParams()
    if (params.year)      p.set('year',      String(params.year))
    if (params.month)     p.set('month',     String(params.month))
    if (params.date_from) p.set('date_from', params.date_from)
    if (params.date_to)   p.set('date_to',   params.date_to)
    if (params.analyzed)  p.set('analyzed',  params.analyzed)
    return apiFetch(`/api/legislation/count?${p}`)
  },

  getMonthCounts: (year: number, params?: { q?: string; analyzed?: string; tag?: string; impact?: string; status?: string; sponsor?: string }) => {
    const p = new URLSearchParams({ year: String(year) })
    if (params?.q)        p.set('q', params.q)
    if (params?.analyzed) p.set('analyzed', params.analyzed)
    if (params?.tag)      p.set('tag', params.tag)
    if (params?.impact)   p.set('impact', params.impact)
    if (params?.status)   p.set('status', params.status)
    if (params?.sponsor)  p.set('sponsor', params.sponsor)
    return apiFetch(`/api/legislation/month-counts?${p}`)
  },

  searchLegislation: (q: string, limit = 20, offset = 0, level = '', analyzed = '', tag = '', impact = '', year = 0, month = 0, status = '', sponsor = '', hasVotes = false) =>
    apiFetch(`/api/legislation/search?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}${level ? `&level=${level}` : ''}${analyzed ? `&analyzed=${analyzed}` : ''}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}${impact ? `&impact=${impact}` : ''}${year ? `&year=${year}` : ''}${month ? `&month=${month}` : ''}${status ? `&status=${encodeURIComponent(status)}` : ''}${sponsor ? `&sponsor=${encodeURIComponent(sponsor)}` : ''}${hasVotes ? `&has_votes=true` : ''}`),

  tagAllBills: () =>
    apiFetch('/api/legislation/tag-all', { method: 'POST' }),

  generatePlainTitles: () =>
    apiFetch('/api/legislation/plain-titles', { method: 'POST' }),

  syncBillStatuses: () =>
    apiFetch('/api/legislation/sync-statuses', { method: 'POST' }),

  // ── Voting ────────────────────────────────────────────────────────────────
  castVote: (legislationId: string, vote: string, voterToken: string, debateId?: string) =>
    apiFetch(`/api/legislation/${legislationId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ vote, voter_token: voterToken, debate_id: debateId ?? null }),
    }),

  getVotes: (legislationId: string, voterToken?: string) =>
    apiFetch(`/api/legislation/${legislationId}/votes${voterToken ? `?voter_token=${voterToken}` : ''}`),

  // ── Auth ──────────────────────────────────────────────────────────────────
  getMe: () => apiFetch('/api/auth/me'),

  googleLoginUrl: () => `${API_URL}/api/auth/google`,

  logout: () => apiFetch('/api/auth/logout', { method: 'POST' }),

  // ── User ──────────────────────────────────────────────────────────────────
  getMyVotes: (limit = 20, offset = 0) =>
    apiFetch(`/api/users/me/votes?limit=${limit}&offset=${offset}`),

  getTrackedBills: () => apiFetch('/api/users/me/tracked-bills'),
  getTrackedBillIds: () => apiFetch('/api/users/me/tracked-bill-ids'),
  toggleTrackBill: (id: string) => apiFetch(`/api/users/me/track/${id}`, { method: 'POST' }),
  updatePreferences: (prefs: { digest_enabled: boolean; digest_frequency?: string; digest_min_impact?: string }) =>
    apiFetch('/api/users/me/preferences', { method: 'PATCH', body: JSON.stringify(prefs) }),
  sendDigest: (lookbackDays = 7) =>
    apiFetch(`/api/users/send-digest?lookback_days=${lookbackDays}`, { method: 'POST' }),

  // ── Export ───────────────────────────────────────────────────────────────
  exportLegislation: async (params: {
    format: 'csv' | 'json'
    analyzed?: string
    tag?: string
    impact?: string
    status?: string
    sponsor?: string
    year?: number
    month?: number
    trackedOnly?: boolean
  }): Promise<void> => {
    const p = new URLSearchParams({ format: params.format })
    if (params.analyzed)    p.set('analyzed',      params.analyzed)
    if (params.tag)         p.set('tag',            params.tag)
    if (params.impact)      p.set('impact',         params.impact)
    if (params.status)      p.set('status',         params.status)
    if (params.sponsor)     p.set('sponsor',        params.sponsor)
    if (params.year)        p.set('year',           String(params.year))
    if (params.month)       p.set('month',          String(params.month))
    if (params.trackedOnly) p.set('tracked_only',   'true')
    const token = getToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`/api/legislation/export?${p.toString()}`, { headers })
    if (!res.ok) throw new Error('Export failed')
    const blob = await res.blob()
    const filename = params.trackedOnly
      ? `tracked-bills.${params.format}`
      : `legislation.${params.format}`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  },

  backfillCouncilmemberEmails: () =>
    apiFetch('/api/councilmembers/backfill-emails', { method: 'POST' }),

  // ── Councilmember votes ───────────────────────────────────────────────────
  getCouncilmemberVotes: (memberId: string, voterToken: string) =>
    apiFetch(`/api/councilmembers/${memberId}/votes?voter_token=${encodeURIComponent(voterToken)}`),
  castCouncilmemberVote: (memberId: string, vote: string, voterToken: string) =>
    apiFetch(`/api/councilmembers/${memberId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ vote, voter_token: voterToken }),
    }),
  // ── Official roll call votes ──────────────────────────────────────────────
  getRollCall: (legislationId: string) =>
    apiFetch(`/api/legislation/${legislationId}/roll-call`),
  syncVotes: (legislationId: string) =>
    apiFetch(`/api/legislation/${legislationId}/sync-votes`, { method: 'POST' }),
  backfillVoteRecords: (year?: number, month?: number) => {
    const p = new URLSearchParams()
    if (year)  p.set('year',  String(year))
    if (month) p.set('month', String(month))
    const qs = p.toString()
    return apiFetch(`/api/legislation/backfill-vote-records${qs ? `?${qs}` : ''}`, { method: 'POST' })
  },

  // ── Metrics ───────────────────────────────────────────────────────────────
  getSystemHealth: () => apiFetch('/api/metrics/health'),

  getMetrics: (params?: { year?: string; month?: string; date_from?: string; date_to?: string }) => {
    const p = new URLSearchParams()
    if (params?.year)      p.set('year',      params.year)
    if (params?.month)     p.set('month',     params.month)
    if (params?.date_from) p.set('date_from', params.date_from)
    if (params?.date_to)   p.set('date_to',   params.date_to)
    const qs = p.toString()
    return apiFetch(`/api/metrics${qs ? `?${qs}` : ''}`)
  },

  getMyDebates: (limit = 20, offset = 0) =>
    apiFetch(`/api/users/me/debates?limit=${limit}&offset=${offset}`),

  getMyAgent: () => apiFetch('/api/users/me/agent'),

  createMyAgent: (stances: Record<string, number>, displayName?: string, avatarId?: string) =>
    apiFetch('/api/users/me/agent', {
      method: 'POST',
      body: JSON.stringify({ stances, display_name: displayName || null, avatar_id: avatarId || null }),
    }),

  deleteMyAgent: () => apiFetch('/api/users/me/agent', { method: 'DELETE' }),

  getDimensions: () => apiFetch('/api/users/stances/dimensions'),

  // ── Agents ────────────────────────────────────────────────────────────────
  getAgents: (limit = 20, offset = 0) =>
    apiFetch(`/api/agents/list?limit=${limit}&offset=${offset}`),

  getAgent: (id: string) =>
    apiFetch(`/api/agents/${id}`),

  getAgentDebates: (id: string, limit = 10, offset = 0) =>
    apiFetch(`/api/agents/${id}/debates?limit=${limit}&offset=${offset}`),

  createAgent: (data: {
    name: string
    description: string
    persona: string
    system_prompt: string
    expertise_areas?: string[]
    agent_type?: string
    model_name?: string
    api_url?: string
    api_key?: string
    avatar_id?: string
    voice_id?: string
  }) =>
    apiFetch('/api/agents/create', { method: 'POST', body: JSON.stringify(data) }),

  createPresetAgent: (presetName: string) =>
    apiFetch(`/api/agents/create-preset/${presetName}`, { method: 'POST' }),

  // ── Debates (create) ──────────────────────────────────────────────────────
  createDebate: (data: {
    legislation_id: string
    topic: string
    agent_ids: string[]
    max_turns?: number
    research_enabled?: boolean
    is_public?: boolean
    participant_settings?: Record<string, { conviction: number }>
  }) =>
    apiFetch('/api/debates/create', { method: 'POST', body: JSON.stringify(data) }),

  runDebate: (id: string) =>
    apiFetch(`/api/debates/${id}/run-all`, { method: 'POST' }),

  triggerAutoDebates: (maxDebates = 1, lookbackHours = 48) =>
    apiFetch(`/api/debates/auto-generate?max_debates=${maxDebates}&lookback_hours=${lookbackHours}`, { method: 'POST' }),

  // ── Video ─────────────────────────────────────────────────────────────────
  getVideoStatus: (debateId: string) =>
    apiFetch(`/api/debates/${debateId}/video`),

  // ── Donations ─────────────────────────────────────────────────────────────
  getDonationConfig: () => apiFetch('/api/donations/config'),
  createCheckout: (amount_usd: number) =>
    apiFetch('/api/donations/checkout', { method: 'POST', body: JSON.stringify({ amount_usd }) }),

  // ── Ingestion (developer) ─────────────────────────────────────────────────
  ingestFederal: (congress = 118, limit = 20) =>
    apiFetch(`/api/legislation/ingest/federal?congress=${congress}&limit=${limit}`, { method: 'POST' }),

  ingestState: (state: string, limit = 20) =>
    apiFetch(`/api/legislation/ingest/state/${state}?limit=${limit}`, { method: 'POST' }),

  ingestLocal: (city: string, limit = 20, bulk = false) =>
    apiFetch(`/api/legislation/ingest/local/${city}?limit=${limit}&bulk=${bulk}`, { method: 'POST' }),

  // ── Hearings ─────────────────────────────────────────────────────────────
  refreshHearings: () =>
    apiFetch('/api/hearings/refresh', { method: 'POST' }),

  getUpcomingHearings: (days = 30) =>
    apiFetch(`/api/hearings/upcoming?days=${days}`),

  // ── Elections ────────────────────────────────────────────────────────────
  getCandidates: (params?: { election_year?: number; district?: string }) => {
    const p = new URLSearchParams()
    if (params?.election_year) p.set('election_year', String(params.election_year))
    if (params?.district)      p.set('district', params.district)
    return apiFetch(`/api/elections/candidates?${p}`)
  },

  createCandidate: (data: {
    name: string; district: string; party?: string; bio?: string;
    photo_url?: string; website_url?: string; office_sought?: string;
    election_year: number; is_incumbent?: boolean; known_positions?: string
  }) => apiFetch('/api/elections/candidates', { method: 'POST', body: JSON.stringify(data) }),

  updateCandidate: (id: string, data: object) =>
    apiFetch(`/api/elections/candidates/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteCandidate: (id: string) =>
    apiFetch(`/api/elections/candidates/${id}`, { method: 'DELETE' }),

  getOfficeDescription: (office: string) =>
    apiFetch(`/api/elections/office-description?office=${encodeURIComponent(office)}`),

  scrapeCandidates: (election_year = 2027, overwrite = false) =>
    apiFetch(`/api/elections/candidates/scrape?election_year=${election_year}&overwrite=${overwrite}`, { method: 'POST' }),

  getCandidatePredictions: (billId: string) =>
    apiFetch(`/api/elections/predictions?bill_id=${encodeURIComponent(billId)}`),

  clearCandidatePredictions: (params?: { bill_id?: string; candidate_id?: string }) => {
    const p = new URLSearchParams()
    if (params?.bill_id)      p.set('bill_id', params.bill_id)
    if (params?.candidate_id) p.set('candidate_id', params.candidate_id)
    return apiFetch(`/api/elections/predictions?${p}`, { method: 'DELETE' })
  },

  // ── Councilmembers ────────────────────────────────────────────────────────
  getCouncilmembers: () =>
    apiFetch('/api/councilmembers'),

  getCouncilmember: (id: string, billsPage = 1, billsLimit = 20) =>
    apiFetch(`/api/councilmembers/${id}?bills_page=${billsPage}&bills_limit=${billsLimit}`),

  scrapeCouncilmembers: () =>
    apiFetch('/api/councilmembers/scrape', { method: 'POST' }),

  // ── Analysis ──────────────────────────────────────────────────────────────
  fetchBillDetails: (id: string) =>
    apiFetch(`/api/legislation/${id}/fetch-details`, { method: 'POST' }),

  analyzeLegislation: (id: string) =>
    apiFetch(`/api/legislation/${id}/analyze`, { method: 'POST' }),

  fetchBillNews: (id: string) =>
    apiFetch(`/api/legislation/${id}/fetch-news`, { method: 'POST' }),

  fetchNewsAll: () =>
    apiFetch('/api/legislation/fetch-news-all', { method: 'POST' }),

  analyzeAll: (force = false, forcePerspectives = false) =>
    apiFetch(`/api/legislation/analyze-all?force=${force}&force_perspectives=${forcePerspectives}`, { method: 'POST' }),

  fetchDetailsAll: () =>
    apiFetch('/api/legislation/fetch-details-all', { method: 'POST' }),

  generateAllPerspectivesBulk: () =>
    apiFetch('/api/legislation/generate-all-perspectives', { method: 'POST' }),

  // Pipeline SSE path (used directly via fetch in admin, not apiFetch)
  pipelinePath: (params: { steps: string; force_analyze?: boolean; perspective_types?: string; year?: string; month?: string; date_from?: string; date_to?: string }) => {
    const p = new URLSearchParams()
    p.set('steps', params.steps)
    if (params.force_analyze) p.set('force_analyze', 'true')
    if (params.perspective_types) p.set('perspective_types', params.perspective_types)
    if (params.year) p.set('year', params.year)
    if (params.month) p.set('month', params.month)
    if (params.date_from) p.set('date_from', params.date_from)
    if (params.date_to) p.set('date_to', params.date_to)
    return `/api/legislation/stream/pipeline?${p}`
  },

  backfillCityContext: () =>
    apiFetch('/api/legislation/backfill-city-context', { method: 'POST' }),

  getPerspectives: (id: string) =>
    apiFetch(`/api/legislation/${id}/perspectives`),

  generatePerspective: (id: string, perspectiveType: string) =>
    apiFetch(`/api/legislation/${id}/perspectives/${perspectiveType}`, { method: 'POST' }),

  generateAllPerspectives: (id: string) =>
    apiFetch(`/api/legislation/${id}/perspectives/generate-all`, { method: 'POST' }),

  clearPerspectives: (id: string) =>
    apiFetch(`/api/legislation/${id}/perspectives`, { method: 'DELETE' }),

  getCouncilmemberVoteHistory: (memberId: string, page = 1, pageSize = 20) =>
    apiFetch(`/api/councilmembers/${memberId}/vote-history?page=${page}&page_size=${pageSize}`),
}
