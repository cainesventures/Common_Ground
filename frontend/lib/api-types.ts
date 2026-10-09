/**
 * Response shapes for the `api.*` helpers in `lib/api.ts`.
 *
 * `apiFetch` used to return `any`, which meant every helper returned `any` and
 * every `.data` / `.results` / `.total` read in the app was unchecked. These
 * types close that last gap: they were taken from the actual `return {...}`
 * statements in `app/api/*_routes.py`, not guessed from call sites.
 *
 * Three conventions:
 *
 * 1. **Most routes wrap their payload.** FastAPI handlers here return
 *    `{"success": True, "data": ...}` or `{"success": True, "results": [...]}`
 *    rather than a bare array, so the envelope is part of the type.
 * 2. **`apiFetch` resolves to `T | null`.** A 401 returns `null` after clearing
 *    the token (see `lib/api.ts`), and that was previously invisible — callers
 *    read straight through it because `any` allowed it. Hence the `?.` and
 *    `?? fallback` at the call sites: those are load-bearing, not defensive
 *    noise.
 * 3. **Counts and flags are optional where the route builds them
 *    conditionally** (the metrics and facet routes scope several fields by the
 *    date filter).
 *
 * Entity shapes (Bill, Councilmember, Perspective, VoteRecord…) live in
 * `lib/types.ts`; this file only describes the envelopes around them.
 */
import type {
  AuthUser,
  Bill,
  Councilmember,
  CouncilmemberProfile,
  MemberVoteRecord,
  Perspective,
  VoteRecord,
} from './types'

/** Common envelope flag. Present on most routes, absent on a few. */
interface Ok {
  success?: boolean
}

// ── Legislation ──────────────────────────────────────────────────────────────

export interface BillDetailResponse extends Ok {
  data: Bill
}

/** `/search` and `/list` share this shape. */
export interface BillListResponse extends Ok {
  total?: number
  limit?: number
  offset?: number
  results: Bill[]
}

export interface SpotlightResponse {
  results: {
    id: string
    headline: string
    lede: string
    bill_number: string
    case_for: string
    case_against: string
  }[]
}

export interface CountResponse {
  count: number
}

/**
 * `/facets`. Note the label key differs per bucket list — the route builds
 * `value` for statuses, `name` for sponsors, `tag` for tags and `key` for
 * categories. Not normalising that here on purpose: this type describes what
 * the endpoint actually sends.
 */
export interface FacetsResponse {
  statuses?: { value: string; count: number }[]
  sponsors?: { name: string; count: number }[]
  tags?: { tag: string; count: number }[]
  categories?: { key: string; count: number }[]
}

export interface TagCountsResponse {
  tags?: { tag: string; count: number }[]
}

export interface YearCountsResponse {
  years?: { year: number; count: number }[]
  months?: { month: number; count: number }[]
}

export interface MonthCountsResponse {
  months: { month: number; count: number }[]
}

/** Per-year data-coverage row in the pipeline stats. */
export interface CompletenessRow {
  year: number
  total: number
  full_text: number
  sponsor: number
  analyzed: number
  headline: number
  committee: number
  perspectives: number
}

export interface PipelineStatsResponse {
  total: number
  unanalyzed?: number
  missing_perspectives?: number
  completeness?: CompletenessRow[]
}

/**
 * `GET /api/legislation/stats` — the public, unauthenticated counterpart to
 * PipelineStatsResponse, for the homepage hero pill.
 *
 * `last_updated` is the newest `analyzed_at` in the corpus, i.e. the last time
 * the enrichment pipeline ran, not the time of the request. Null if nothing
 * has been analyzed.
 */
export interface PublicStatsResponse {
  total: number
  last_updated: string | null
}

// ── Votes ────────────────────────────────────────────────────────────────────

/** One tally bucket, as `_tally()` builds it. */
export interface VoteTally {
  support: number
  oppose: number
  neutral: number
  total: number
}

/**
 * Bill votes. `counts` splits signed-in members from anonymous tokens and gives
 * the combined figure — see `_vote_counts()` in legislation_routes.py.
 */
export interface BillVoteCountsResponse extends Ok {
  legislation_id?: string
  counts: { member: VoteTally; anonymous: VoteTally; total: VoteTally }
  your_vote?: string | null
  /** Echoed back by the POST, absent on the GET. */
  vote?: string
}

/**
 * Council-member approval votes. Same `counts` key, deliberately different
 * shape: `_cm_vote_counts()` returns a flat support/oppose pair with no
 * member/anonymous split and no total. Two types because the backend really
 * does send two shapes here — collapsing them into one would be a lie that
 * compiles.
 */
export interface MemberVoteCountsResponse extends Ok {
  counts: { support: number; oppose: number }
  your_vote?: string | null
}

export interface RollCallResponse extends Ok {
  data: VoteRecord[]
}

// ── Perspectives ─────────────────────────────────────────────────────────────

export interface PerspectivesResponse extends Ok {
  bill_id?: string
  analyzed?: boolean
  relevant_types?: string[]
  perspectives: Perspective[]
  /** Relevant persona types with no stored perspective yet. */
  pending_types?: string[]
}

/** A single generated perspective, from the per-type POST. */
export interface PerspectiveResponse extends Ok {
  perspective_type?: string
  position?: string | null
  key_arguments?: string | string[] | null
  concerns?: string | null
  assessment?: string | null
  ai_provider?: string | null
  ai_model?: string | null
  generated_at?: string | null
}

// ── Auth / user ──────────────────────────────────────────────────────────────

export interface MeResponse extends Ok {
  user: AuthUser & { digest_enabled?: boolean }
}

export interface MyVoteRow {
  vote: string
  voted_at: string | null
  /** Trimmed bill. All nullable: the route tolerates a missing join. */
  legislation: {
    id: string
    title: string | null
    plain_title: string | null
    bill_number: string | null
    status: string | null
    level: string | null
    tags: string | null
    impact_level: string | null
  }
}

export interface MyVotesResponse extends Ok {
  total?: number
  limit?: number
  offset?: number
  votes: MyVoteRow[]
}

export interface TrackedBillsResponse extends Ok {
  bills: Bill[]
}

export interface TrackedBillIdsResponse extends Ok {
  ids: string[]
}

export interface ToggleTrackResponse extends Ok {
  tracked: boolean
}

// ── Council members ──────────────────────────────────────────────────────────

export interface CouncilmembersResponse extends Ok {
  total?: number
  members: Councilmember[]
}

export interface CouncilmemberBillsResponse extends Ok {
  total: number
  page?: number
  limit?: number
  results: Bill[]
}

/** A bill the member voted against the majority on. */
export interface DissentBill {
  id: string
  bill_number: string
  title: string
  status: string
  action_date: string | null
  yeas: number
  nays: number
}

/** `/{member_id}/legislative-profile` — the aggregate the profile tab renders. */
export interface LegislativeProfile {
  outcomes: {
    total: number
    signed: number
    failed_vetoed: number
    died_in_committee: number
    active: number
    pass_rate: number | null
  }
  top_tags: { tag: string; count: number }[]
  bill_types: Record<string, number>
  impact: { levels: Record<string, number>; avg_score: number | null }
  committees: { committee: string; count: number }[]
  median_days_to_passage: number | null
  voting: {
    total_votes: number
    absent: number
    dissents: number
    attendance_rate: number | null
    dissent_bills: DissentBill[]
  }
}

export interface LegislativeProfileResponse extends Ok {
  member_id?: string
  profile: LegislativeProfile
}

export interface VoteHistoryResponse extends Ok {
  total: number
  page?: number
  page_size?: number
  data: MemberVoteRecord[]
}

// ── Insights ─────────────────────────────────────────────────────────────────

export interface InsightsSummaryResponse {
  total_bills: number
  active_bills: number
  died_in_committee?: number
  current_term_start?: number
  bills_this_year: number
  bills_last_year: number
  signed_into_law: number
  pass_rate: number
  avg_impact_score: number | null
  years_from: number
  years_to: number
  last_fetched_at?: string | null
}

/**
 * The insights row shapes below used to be redeclared inside each component
 * that rendered them. They are defined once here and imported, so the API
 * contract and the chart props cannot drift apart.
 */
export interface YearStatusRow {
  year: number
  total: number
  introduced: number
  in_committee: number
  died_in_committee: number
  signed_into_law: number
  failed: number
  vetoed: number
  withdrawn: number
  tabled: number
  other: number
}

export interface StatusByYearResponse {
  years: YearStatusRow[]
  statuses?: string[]
  status_labels?: Record<string, string>
  from_year?: number
  to_year?: number
  all_from_year?: number
}

/** Index signature: the tag columns are dynamic, one key per returned tag. */
export interface TagYearRow {
  year: number
  [tag: string]: number
}

export interface TagByYearResponse {
  years: TagYearRow[]
  tags: string[]
}

export interface ImpactYearRow {
  year: number
  total: number
  bill_type: { substantive: number; ceremonial: number; procedural: number; unknown: number }
  impact_level: { high: number; medium: number; low: number }
}

export interface ImpactByYearResponse {
  years: ImpactYearRow[]
}

export interface SponsorRow {
  sponsor: string
  total: number
  signed_into_law: number
  not_passed: number
  pass_rate: number
  avg_impact_score: number | null
}

export interface SponsorLeaderboardResponse {
  sponsors: SponsorRow[]
  year?: number
}

export interface ContestedBillRow {
  id: string
  bill_number: string
  title: string
  status: string
  impact_score: number | null
  year: number | null
  yeas: number
  nays: number
  dissenters: string[]
}

export interface ContestedBillsResponse {
  bills: ContestedBillRow[]
  total_contested?: number
  year?: number
  sort?: string
}

export interface VotingMemberRow {
  voter_name: string
  short_name: string
  is_current: boolean
  councilmember_id: string | null
  district: string | null
  party: string | null
  total_votes: number
  yeas: number
  nays: number
  abstains: number
  absents: number
  presents: number
  contested_votes: number
  dissent_rate: number
}

export interface VotingRecordsResponse {
  members: VotingMemberRow[]
}

export interface AgreementMatrixResponse {
  voters: { voter_name: string; short_name: string; is_current: boolean; contested_votes: number }[]
  matrix: (number | null)[][]
  min_shared: number
}

export interface CommitteeActivityResponse {
  committees: { committee: string; count: number }[]
  year?: number
}

// ── Hearings / elections / donations ─────────────────────────────────────────

export interface HearingsResponse {
  total?: number
  hearings: Bill[]
}

export interface CandidatesResponse {
  total?: number
  candidates: {
    id: string
    name: string
    district?: string
    party?: string | null
    bio?: string | null
    photo_url?: string | null
    website_url?: string | null
    office_sought?: string | null
    election_year?: number
    is_incumbent?: boolean
    known_positions?: string | null
  }[]
}

export interface PredictionsResponse {
  bill_id?: string
  bill_title?: string
  disclaimer: string
  predictions: {
    candidate_id: string
    candidate_name: string
    district: string
    party?: string
    is_incumbent?: boolean
    predicted_vote: 'support' | 'oppose' | 'uncertain'
    reasoning: string
  }[]
}

export interface OfficeDescriptionResponse {
  office?: string
  what_it_does?: string
  key_responsibilities?: string[]
  term_length?: string
  salary_approx?: string
  good_candidate_traits?: string[]
}

export interface DonationConfigResponse {
  publishable_key: string
}

export interface CheckoutResponse {
  url?: string
  session_id?: string
}

export interface DonationSessionResponse {
  received?: number
  amount_usd?: number
  status?: string
}

// ── Metrics / admin ──────────────────────────────────────────────────────────

export interface SystemHealthResponse {
  db: string
  ai_provider: string
  ai_model: string
}

export interface MetricsResponse extends Ok {
  metrics: {
    bills: {
      total: number
      analyzed: number
      scoped?: boolean
      analysis_rate_pct?: number
      with_news?: number
      with_plain_titles?: number
      with_vote_records?: number
    }
    perspectives: { total: number; by_position?: Record<string, number> }
    users: { total: number; digest_opted_in?: number }
    tracking: { total_saves: number }
  }
}

export interface AdminStatsResponse extends Ok {
  users?: {
    total?: number
    active_30d?: number
    signups_7d?: number
    signups_30d?: number
    by_tier?: Record<string, number>
  }
  engagement?: { tracked_bills?: number; bill_votes?: number }
  operations?: { bluesky_posts?: number; donations?: number }
}

export interface AdminUsersResponse extends Ok {
  total: number
  limit?: number
  offset?: number
  users: {
    id: string
    email?: string
    display_name?: string
    subscription_tier?: string
    is_admin_via_allowlist?: boolean
    created_at?: string
    last_login?: string | null
    tracked_bills_count?: number
    bill_votes_count?: number
  }[]
}

/**
 * Result of a maintenance/generation POST.
 *
 * One shared type rather than ~25 near-identical ones: these endpoints each
 * populate a few of these counters and the callers (the admin panel and the
 * bill page's admin drawer) read only the ones their own action sets, then
 * render a summary string. Every field is optional for exactly that reason.
 */
export interface ActionResult extends Ok {
  // Per-bill analysis
  has_full_text?: boolean
  has_sponsor?: boolean
  impact_level?: string
  impact_score?: number
  bill_type?: string
  perspectives_generated?: unknown[]
  articles_found?: number
  // Batch counters
  total?: number
  count?: number
  checked?: number
  updated?: number
  added?: number
  skipped?: number
  failed?: number
  scraped?: number
  sent?: number
  results?: unknown[]
  /** Member names still lacking an email after a backfill run. */
  still_missing?: string[]
  source_year?: number
  bills_ingested?: number
  bills_in_digest?: number
  completeness?: CompletenessRow[]
  /** Set by the lede/headline generators. */
  generated?: number
  message?: string
}

export type { CouncilmemberProfile }
