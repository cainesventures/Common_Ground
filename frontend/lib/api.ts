import { getToken, clearToken } from './auth'
import type {
  ActionResult,
  AdminStatsResponse,
  AdminUsersResponse,
  AgreementMatrixResponse,
  BillDetailResponse,
  BillListResponse,
  CandidatesResponse,
  CheckoutResponse,
  CommitteeActivityResponse,
  ContestedBillsResponse,
  CouncilmemberBillsResponse,
  CouncilmemberProfile,
  CouncilmembersResponse,
  CountResponse,
  DonationConfigResponse,
  DonationSessionResponse,
  FacetsResponse,
  HearingsResponse,
  ImpactByYearResponse,
  InsightsSummaryResponse,
  LegislativeProfileResponse,
  MeResponse,
  MetricsResponse,
  MonthCountsResponse,
  MyVotesResponse,
  OfficeDescriptionResponse,
  PerspectiveResponse,
  PerspectivesResponse,
  PipelineStatsResponse,
  PublicStatsResponse,
  PredictionsResponse,
  RollCallResponse,
  SponsorLeaderboardResponse,
  SpotlightResponse,
  StatusByYearResponse,
  SystemHealthResponse,
  TagByYearResponse,
  TagCountsResponse,
  ToggleTrackResponse,
  TrackedBillIdsResponse,
  TrackedBillsResponse,
  BillVoteCountsResponse,
  MemberVoteCountsResponse,
  VoteHistoryResponse,
  VotingRecordsResponse,
  YearCountsResponse,
} from './api-types'

const API_URL = ''  // Use relative URLs — Next.js rewrites proxy to backend

/**
 * The single boundary where JSON from the backend enters the app.
 *
 * `T` is the expected body, declared per helper below against the response
 * interfaces in `./api-types`. There is no runtime validation here — this is a
 * compile-time contract that says what the route is documented to return, and
 * the types were read off the `return {...}` statements in `app/api/*_routes.py`
 * rather than inferred from call sites.
 *
 * **Resolves to `T | null`.** A 401 clears the token, bounces to `/` in the
 * browser, and returns `null` — so every caller can get a null regardless of
 * `T`. That was true before too, just invisible behind `any`, which is why the
 * call sites are full of `?.` and `?? fallback`: those guards are load-bearing.
 */
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T | null> {
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
    const err: { detail?: string } = await res
      .json()
      .catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }

  return res.json() as Promise<T>
}

export const api = {
  // ── Legislation ───────────────────────────────────────────────────────────
  getLegislation: (id: string) =>
    apiFetch<BillDetailResponse>(`/api/legislation/${id}`),

  listLegislation: (limit = 20, offset = 0, level = '') =>
    apiFetch<BillListResponse>(`/api/legislation/list?limit=${limit}&offset=${offset}${level ? `&level=${level}` : ''}`),

  getFacets: (params: { q?: string; level?: string; analyzed?: string; tag?: string; impact?: string; status?: string; sponsor?: string; year?: number; month?: number }) => {
    const p = new URLSearchParams()
    if (params.q)        p.set('q', params.q)
    if (params.level)    p.set('level', params.level)
    if (params.analyzed) p.set('analyzed', params.analyzed)
    if (params.tag)      p.set('tag', params.tag)
    if (params.impact)   p.set('impact', params.impact)
    if (params.status)   p.set('status', params.status)
    if (params.sponsor)  p.set('sponsor', params.sponsor)
    if (params.year)     p.set('year', String(params.year))
    if (params.month)    p.set('month', String(params.month))
    return apiFetch<FacetsResponse>(`/api/legislation/facets?${p}`)
  },

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
    return apiFetch<TagCountsResponse>(`/api/legislation/tag-counts${qs ? `?${qs}` : ''}`)
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
    return apiFetch<YearCountsResponse>(`/api/legislation/year-counts${qs ? `?${qs}` : ''}`)
  },

  getInsightsStatusByYear: (params?: { from_year?: number; to_year?: number; tag?: string }) => {
    const p = new URLSearchParams()
    if (params?.from_year) p.set('from_year', String(params.from_year))
    if (params?.to_year)   p.set('to_year',   String(params.to_year))
    if (params?.tag)       p.set('tag',        params.tag)
    const qs = p.toString()
    return apiFetch<StatusByYearResponse>(`/api/insights/status-by-year${qs ? `?${qs}` : ''}`)
  },

  getInsightsTagByYear: (params?: { from_year?: number; to_year?: number; top_n?: number }) => {
    const p = new URLSearchParams()
    if (params?.from_year) p.set('from_year', String(params.from_year))
    if (params?.to_year)   p.set('to_year',   String(params.to_year))
    if (params?.top_n)     p.set('top_n',     String(params.top_n))
    const qs = p.toString()
    return apiFetch<TagByYearResponse>(`/api/insights/tag-by-year${qs ? `?${qs}` : ''}`)
  },

  getInsightsSummary: () => apiFetch<InsightsSummaryResponse>('/api/insights/summary'),

  getInsightsImpactByYear: (params?: { from_year?: number; to_year?: number }) => {
    const p = new URLSearchParams()
    if (params?.from_year) p.set('from_year', String(params.from_year))
    if (params?.to_year)   p.set('to_year',   String(params.to_year))
    const qs = p.toString()
    return apiFetch<ImpactByYearResponse>(`/api/insights/impact-by-year${qs ? `?${qs}` : ''}`)
  },

  getInsightsSponsorLeaderboard: (params?: { year?: number; limit?: number }) => {
    const p = new URLSearchParams()
    if (params?.year)  p.set('year',  String(params.year))
    if (params?.limit) p.set('limit', String(params.limit))
    const qs = p.toString()
    return apiFetch<SponsorLeaderboardResponse>(`/api/insights/sponsor-leaderboard${qs ? `?${qs}` : ''}`)
  },

  getInsightsContestedBills: (params?: { year?: number; sort?: string; limit?: number }) => {
    const p = new URLSearchParams()
    if (params?.year)  p.set('year',  String(params.year))
    if (params?.sort)  p.set('sort',  params.sort)
    if (params?.limit) p.set('limit', String(params.limit))
    const qs = p.toString()
    return apiFetch<ContestedBillsResponse>(`/api/insights/contested-bills${qs ? `?${qs}` : ''}`)
  },

  getInsightsVotingRecords: () => apiFetch<VotingRecordsResponse>('/api/insights/voting-records'),

  getInsightsAgreementMatrix: (params?: { current_only?: boolean; min_shared?: number }) => {
    const p = new URLSearchParams()
    if (params?.current_only !== undefined) p.set('current_only', String(params.current_only))
    if (params?.min_shared) p.set('min_shared', String(params.min_shared))
    const qs = p.toString()
    return apiFetch<AgreementMatrixResponse>(`/api/insights/agreement-matrix${qs ? `?${qs}` : ''}`)
  },

  getInsightsCommitteeActivity: (params?: { year?: number; top_n?: number }) => {
    const p = new URLSearchParams()
    if (params?.year)  p.set('year',  String(params.year))
    if (params?.top_n) p.set('top_n', String(params.top_n))
    const qs = p.toString()
    return apiFetch<CommitteeActivityResponse>(`/api/insights/committee-activity${qs ? `?${qs}` : ''}`)
  },

  countLegislation: (params: { year?: number; month?: number; date_from?: string; date_to?: string; analyzed?: string }) => {
    const p = new URLSearchParams()
    if (params.year)      p.set('year',      String(params.year))
    if (params.month)     p.set('month',     String(params.month))
    if (params.date_from) p.set('date_from', params.date_from)
    if (params.date_to)   p.set('date_to',   params.date_to)
    if (params.analyzed)  p.set('analyzed',  params.analyzed)
    return apiFetch<CountResponse>(`/api/legislation/count?${p}`)
  },

  getMonthCounts: (year: number, params?: { q?: string; analyzed?: string; tag?: string; impact?: string; status?: string; sponsor?: string }) => {
    const p = new URLSearchParams({ year: String(year) })
    if (params?.q)        p.set('q', params.q)
    if (params?.analyzed) p.set('analyzed', params.analyzed)
    if (params?.tag)      p.set('tag', params.tag)
    if (params?.impact)   p.set('impact', params.impact)
    if (params?.status)   p.set('status', params.status)
    if (params?.sponsor)  p.set('sponsor', params.sponsor)
    return apiFetch<MonthCountsResponse>(`/api/legislation/month-counts?${p}`)
  },

  searchLegislation: (q: string, limit = 20, offset = 0, level = '', analyzed = '', tag: string | string[] = '', impact = '', year = 0, month = 0, status: string | string[] = '', sponsor = '', hasVotes = false, hasPerspectives = false, missingPerspectives = false, billType = '', committee = '') => {
    const tagStr = Array.isArray(tag) ? tag.join(',') : tag
    const statusStr = Array.isArray(status) ? status.join(',') : status
    return apiFetch<BillListResponse>(`/api/legislation/search?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}${level ? `&level=${level}` : ''}${analyzed ? `&analyzed=${analyzed}` : ''}${tagStr ? `&tag=${encodeURIComponent(tagStr)}` : ''}${impact ? `&impact=${impact}` : ''}${year ? `&year=${year}` : ''}${month ? `&month=${month}` : ''}${statusStr ? `&status=${encodeURIComponent(statusStr)}` : ''}${sponsor ? `&sponsor=${encodeURIComponent(sponsor)}` : ''}${hasVotes ? `&has_votes=true` : ''}${hasPerspectives ? `&has_perspectives=true` : ''}${missingPerspectives ? `&missing_perspectives=true` : ''}${billType ? `&bill_type=${encodeURIComponent(billType)}` : ''}${committee ? `&committee=${encodeURIComponent(committee)}` : ''}`)
  },

  getSpotlight: (limit = 8) =>
    apiFetch<SpotlightResponse>(`/api/legislation/spotlight?limit=${limit}`),

  /**
   * Public bill count + data freshness for the hero pill.
   *
   * The pill used to call getPipelineStats, which requires the dev tier, so it
   * 401'd for every visitor who was not the owner. This one needs no auth and
   * sits under an edge-cached prefix.
   */
  getPublicStats: () =>
    apiFetch<PublicStatsResponse>('/api/legislation/stats'),

  getPipelineStats: (params: { status?: string; year?: string; month?: string; date_from?: string; date_to?: string }) => {
    const p = new URLSearchParams()
    if (params.status)    p.set('status',    params.status)
    if (params.year)      p.set('year',      params.year)
    if (params.month)     p.set('month',     params.month)
    if (params.date_from) p.set('date_from', params.date_from)
    if (params.date_to)   p.set('date_to',   params.date_to)
    return apiFetch<PipelineStatsResponse>(`/api/legislation/pipeline-stats?${p}`)
  },

  tagAllBills: () =>
    apiFetch<ActionResult>('/api/legislation/tag-all', { method: 'POST' }),

  generatePlainTitles: () =>
    apiFetch<ActionResult>('/api/legislation/plain-titles', { method: 'POST' }),

  syncBillStatuses: () =>
    apiFetch<ActionResult>('/api/legislation/sync-statuses', { method: 'POST' }),

  // ── Voting ────────────────────────────────────────────────────────────────
  castVote: (legislationId: string, vote: string, voterToken: string) =>
    apiFetch<BillVoteCountsResponse>(`/api/legislation/${legislationId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ vote, voter_token: voterToken }),
    }),

  getVotes: (legislationId: string, voterToken?: string) =>
    apiFetch<BillVoteCountsResponse>(`/api/legislation/${legislationId}/votes${voterToken ? `?voter_token=${voterToken}` : ''}`),

  // ── Auth ──────────────────────────────────────────────────────────────────
  getMe: () => apiFetch<MeResponse>('/api/auth/me'),

  googleLoginUrl: () => `${API_URL}/api/auth/google`,

  logout: () => apiFetch<ActionResult>('/api/auth/logout', { method: 'POST' }),

  // ── User ──────────────────────────────────────────────────────────────────
  getMyVotes: (limit = 20, offset = 0) =>
    apiFetch<MyVotesResponse>(`/api/users/me/votes?limit=${limit}&offset=${offset}`),

  getTrackedBills: () => apiFetch<TrackedBillsResponse>('/api/users/me/tracked-bills'),
  getTrackedBillIds: () => apiFetch<TrackedBillIdsResponse>('/api/users/me/tracked-bill-ids'),
  toggleTrackBill: (id: string) => apiFetch<ToggleTrackResponse>(`/api/users/me/track/${id}`, { method: 'POST' }),
  updatePreferences: (prefs: { digest_enabled: boolean; digest_frequency?: string; digest_min_impact?: string }) =>
    apiFetch<ActionResult>('/api/users/me/preferences', { method: 'PATCH', body: JSON.stringify(prefs) }),
  sendDigest: (lookbackDays = 7) =>
    apiFetch<ActionResult>(`/api/users/send-digest?lookback_days=${lookbackDays}`, { method: 'POST' }),

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
    apiFetch<ActionResult>('/api/councilmembers/backfill-emails', { method: 'POST' }),

  // ── Councilmember votes ───────────────────────────────────────────────────
  getCouncilmemberVotes: (memberId: string, voterToken: string) =>
    apiFetch<MemberVoteCountsResponse>(`/api/councilmembers/${memberId}/votes?voter_token=${encodeURIComponent(voterToken)}`),
  castCouncilmemberVote: (memberId: string, vote: string, voterToken: string) =>
    apiFetch<MemberVoteCountsResponse>(`/api/councilmembers/${memberId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ vote, voter_token: voterToken }),
    }),
  // ── Official roll call votes ──────────────────────────────────────────────
  getRollCall: (legislationId: string) =>
    apiFetch<RollCallResponse>(`/api/legislation/${legislationId}/roll-call`),
  syncVotes: (legislationId: string) =>
    apiFetch<ActionResult>(`/api/legislation/${legislationId}/sync-votes`, { method: 'POST' }),
  backfillVoteRecords: (year?: number, month?: number) => {
    const p = new URLSearchParams()
    if (year)  p.set('year',  String(year))
    if (month) p.set('month', String(month))
    const qs = p.toString()
    return apiFetch<ActionResult>(`/api/legislation/backfill-vote-records${qs ? `?${qs}` : ''}`, { method: 'POST' })
  },

  // ── Metrics ───────────────────────────────────────────────────────────────
  getSystemHealth: () => apiFetch<SystemHealthResponse>('/api/metrics/health'),

  getMetrics: (params?: { year?: string; month?: string; date_from?: string; date_to?: string }) => {
    const p = new URLSearchParams()
    if (params?.year)      p.set('year',      params.year)
    if (params?.month)     p.set('month',     params.month)
    if (params?.date_from) p.set('date_from', params.date_from)
    if (params?.date_to)   p.set('date_to',   params.date_to)
    const qs = p.toString()
    return apiFetch<MetricsResponse>(`/api/metrics${qs ? `?${qs}` : ''}`)
  },

  // ── Donations ─────────────────────────────────────────────────────────────
  getDonationConfig: () => apiFetch<DonationConfigResponse>('/api/donations/config'),
  createCheckout: (amount_usd: number) =>
    apiFetch<CheckoutResponse>('/api/donations/checkout', { method: 'POST', body: JSON.stringify({ amount_usd }) }),
  getDonationSession: (session_id: string) =>
    apiFetch<DonationSessionResponse>(`/api/donations/session/${session_id}`),

  // ── Ingestion (developer) ─────────────────────────────────────────────────
  ingestFederal: (congress = 118, limit = 20) =>
    apiFetch<ActionResult>(`/api/legislation/ingest/federal?congress=${congress}&limit=${limit}`, { method: 'POST' }),

  ingestState: (state: string, limit = 20) =>
    apiFetch<ActionResult>(`/api/legislation/ingest/state/${state}?limit=${limit}`, { method: 'POST' }),

  ingestLocal: (city: string, limit = 20, bulk = false) =>
    apiFetch<ActionResult>(`/api/legislation/ingest/local/${city}?limit=${limit}&bulk=${bulk}`, { method: 'POST' }),

  // ── Hearings ─────────────────────────────────────────────────────────────
  refreshHearings: () =>
    apiFetch<ActionResult>('/api/hearings/refresh', { method: 'POST' }),

  getUpcomingHearings: (days = 30) =>
    apiFetch<HearingsResponse>(`/api/hearings/upcoming?days=${days}`),

  // ── Elections ────────────────────────────────────────────────────────────
  getCandidates: (params?: { election_year?: number; district?: string }) => {
    const p = new URLSearchParams()
    if (params?.election_year) p.set('election_year', String(params.election_year))
    if (params?.district)      p.set('district', params.district)
    return apiFetch<CandidatesResponse>(`/api/elections/candidates?${p}`)
  },

  createCandidate: (data: {
    name: string; district: string; party?: string; bio?: string;
    photo_url?: string; website_url?: string; office_sought?: string;
    election_year: number; is_incumbent?: boolean; known_positions?: string
  }) => apiFetch<ActionResult>('/api/elections/candidates', { method: 'POST', body: JSON.stringify(data) }),

  updateCandidate: (id: string, data: object) =>
    apiFetch<ActionResult>(`/api/elections/candidates/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteCandidate: (id: string) =>
    apiFetch<ActionResult>(`/api/elections/candidates/${id}`, { method: 'DELETE' }),

  getOfficeDescription: (office: string) =>
    apiFetch<OfficeDescriptionResponse>(`/api/elections/office-description?office=${encodeURIComponent(office)}`),

  scrapeCandidates: (election_year = 2027, overwrite = false) =>
    apiFetch<ActionResult>(`/api/elections/candidates/scrape?election_year=${election_year}&overwrite=${overwrite}`, { method: 'POST' }),

  getCandidatePredictions: (billId: string) =>
    apiFetch<PredictionsResponse>(`/api/elections/predictions?bill_id=${encodeURIComponent(billId)}`),

  clearCandidatePredictions: (params?: { bill_id?: string; candidate_id?: string }) => {
    const p = new URLSearchParams()
    if (params?.bill_id)      p.set('bill_id', params.bill_id)
    if (params?.candidate_id) p.set('candidate_id', params.candidate_id)
    return apiFetch<ActionResult>(`/api/elections/predictions?${p}`, { method: 'DELETE' })
  },

  // ── Councilmembers ────────────────────────────────────────────────────────
  getCouncilmembers: () =>
    apiFetch<CouncilmembersResponse>('/api/councilmembers'),

  getCouncilmember: (id: string, billsPage = 1, billsLimit = 20) =>
    apiFetch<CouncilmemberProfile>(`/api/councilmembers/${id}?bills_page=${billsPage}&bills_limit=${billsLimit}`),

  getCouncilmemberProfile: (id: string) =>
    apiFetch<LegislativeProfileResponse>(`/api/councilmembers/${id}/legislative-profile`),

  getCouncilmemberBillsByOutcome: (id: string, outcome: string, page = 1, limit = 10) =>
    apiFetch<CouncilmemberBillsResponse>(`/api/councilmembers/${id}/bills?outcome=${outcome}&page=${page}&limit=${limit}`),

  scrapeCouncilmembers: () =>
    apiFetch<ActionResult>('/api/councilmembers/scrape', { method: 'POST' }),

  // ── Analysis ──────────────────────────────────────────────────────────────
  fetchBillDetails: (id: string) =>
    apiFetch<ActionResult>(`/api/legislation/${id}/fetch-details`, { method: 'POST' }),

  analyzeLegislation: (id: string) =>
    apiFetch<ActionResult>(`/api/legislation/${id}/analyze`, { method: 'POST' }),

  generateBillHeadline: (id: string) =>
    apiFetch<ActionResult>(`/api/legislation/${id}/generate-headline`, { method: 'POST' }),

  fetchBillMetadata: (id: string) =>
    apiFetch<ActionResult>(`/api/legislation/${id}/fetch-metadata`, { method: 'POST' }),

  generateBillPerspectives: (id: string) =>
    apiFetch<ActionResult>(`/api/legislation/${id}/perspectives/generate-all`, { method: 'POST' }),

  fetchBillNews: (id: string) =>
    apiFetch<ActionResult>(`/api/legislation/${id}/fetch-news`, { method: 'POST' }),

  fetchNewsAll: () =>
    apiFetch<ActionResult>('/api/legislation/fetch-news-all', { method: 'POST' }),

  generateHeadlines: (force = false) =>
    apiFetch<ActionResult>(`/api/legislation/generate-headlines?force=${force}`, { method: 'POST' }),

  generateLedes: (force = false) =>
    apiFetch<ActionResult>(`/api/legislation/generate-ledes?force=${force}`, { method: 'POST' }),

  analyzeAll: (force = false, forcePerspectives = false) =>
    apiFetch<ActionResult>(`/api/legislation/analyze-all?force=${force}&force_perspectives=${forcePerspectives}`, { method: 'POST' }),

  fetchDetailsAll: () =>
    apiFetch<ActionResult>('/api/legislation/fetch-details-all', { method: 'POST' }),

  generateAllPerspectivesBulk: () =>
    apiFetch<ActionResult>('/api/legislation/generate-all-perspectives', { method: 'POST' }),

  // Pipeline SSE path (used directly via fetch in admin, not apiFetch)
  pipelinePath: (params: { steps: string; force_analyze?: boolean; perspective_types?: string; year?: string; month?: string; date_from?: string; date_to?: string; status?: string }) => {
    const p = new URLSearchParams()
    p.set('steps', params.steps)
    if (params.force_analyze) p.set('force_analyze', 'true')
    if (params.perspective_types) p.set('perspective_types', params.perspective_types)
    if (params.year) p.set('year', params.year)
    if (params.month) p.set('month', params.month)
    if (params.date_from) p.set('date_from', params.date_from)
    if (params.date_to) p.set('date_to', params.date_to)
    if (params.status) p.set('status', params.status)
    return `/api/legislation/stream/pipeline?${p}`
  },

  backfillCityContext: () =>
    apiFetch<ActionResult>('/api/legislation/backfill-city-context', { method: 'POST' }),

  getPerspectives: (id: string) =>
    apiFetch<PerspectivesResponse>(`/api/legislation/${id}/perspectives`),

  generatePerspective: (id: string, perspectiveType: string, force = false) =>
    apiFetch<PerspectiveResponse>(`/api/legislation/${id}/perspectives/${perspectiveType}${force ? '?force=true' : ''}`, { method: 'POST' }),

  generateAllPerspectives: (id: string) =>
    apiFetch<ActionResult>(`/api/legislation/${id}/perspectives/generate-all`, { method: 'POST' }),

  clearPerspectives: (id: string) =>
    apiFetch<ActionResult>(`/api/legislation/${id}/perspectives`, { method: 'DELETE' }),

  // ── Admin ────────────────────────────────────────────────────────────────
  adminStats: () =>
    apiFetch<AdminStatsResponse>('/api/admin/stats'),

  adminUsers: (params?: { limit?: number; offset?: number; sort?: string; order?: 'asc' | 'desc' }) => {
    const p = new URLSearchParams()
    if (params?.limit !== undefined)  p.set('limit', String(params.limit))
    if (params?.offset !== undefined) p.set('offset', String(params.offset))
    if (params?.sort)                 p.set('sort', params.sort)
    if (params?.order)                p.set('order', params.order)
    const qs = p.toString()
    return apiFetch<AdminUsersResponse>(`/api/admin/users${qs ? `?${qs}` : ''}`)
  },

  getCouncilmemberVoteHistory: (memberId: string, page = 1, pageSize = 20) =>
    apiFetch<VoteHistoryResponse>(`/api/councilmembers/${memberId}/vote-history?page=${page}&page_size=${pageSize}`),
}
