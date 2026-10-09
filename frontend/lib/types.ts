/**
 * Shapes of the JSON the backend actually returns.
 *
 * These mirror the SQLAlchemy models in `app/models/__init__.py` as they are
 * serialized by `app/api/*_routes.py`. They replaced ~80 uses of `any` that the
 * API layer leaked into props, state and callbacks — `apiFetch` returns parsed
 * JSON, so every `api.*` result was untyped and every component that touched a
 * bill or a council member was untyped with it.
 *
 * Two conventions worth knowing before you edit:
 *
 * 1. Nearly every field is optional. The backend omits nulls on some routes and
 *    list endpoints return deliberately trimmed rows (search results carry no
 *    `full_text`, for instance). Marking fields optional keeps one type usable
 *    for both the list and detail shapes rather than forcing a second
 *    near-duplicate interface per entity.
 * 2. Dates and JSON-in-string columns arrive as strings. `tags`, `co_sponsors`,
 *    `news_links` and `key_arguments` are TEXT columns holding JSON, so they are
 *    typed as the parsed value where a route parses them and `string` where it
 *    does not — hence the `string | string[]` unions. Do not "clean these up"
 *    to one or the other without checking the route.
 */

/** Roll-call vote: `bill_vote_records`. */
export interface VoteRecord {
  id?: string
  legislation_id?: string
  councilmember_id?: string | null
  voter_name: string
  vote: string // "Yea" | "Nay" | "Abstain" | "Absent"
  action_date?: string | null
  result?: string | null
}

/** One of the 17 legacy persona perspectives: `bill_perspectives`. */
export interface Perspective {
  id?: string
  bill_id?: string
  perspective_type: string
  position?: string | null // support / oppose / neutral
  key_arguments?: string | string[] | null
  concerns?: string | null
  assessment?: string | null
  ai_provider?: string | null
  ai_model?: string | null
  generated_at?: string | null
}

/** A council member: `councilmembers`. */
export interface Councilmember {
  id: string
  name: string
  district?: string | null
  party?: string | null
  email?: string | null
  phone?: string | null
  photo_url?: string | null
  bio?: string | null
  profile_url?: string | null
  bills_sponsored?: number
  bills_passed?: number
  legistar_id?: number | null
  term_start?: number | null
  updated_at?: string | null
}

/**
 * `/api/councilmembers/{id}` — the member row plus tenure figures the route
 * derives from `term_start`, and a page of their sponsored bills.
 */
export interface CouncilmemberWithTenure extends Councilmember {
  years_serving?: number
  next_election?: number
  years_until_election?: number
}

export interface CouncilmemberProfile {
  member: CouncilmemberWithTenure
  bills: {
    results: Bill[]
    /** Always present on this route; the pager does arithmetic on it. */
    total: number
  }
}

/** A roll-call row joined to its bill, as the member vote-history route returns it. */
export interface MemberVoteRecord extends VoteRecord {
  bill_number?: string
  plain_title?: string | null
}

/** A link in the `news_links` JSON array. */
export interface NewsLink {
  title?: string
  url?: string
  source?: string
}

/**
 * A bill: `legislation`. The widest type here, because the detail route returns
 * the whole row plus two eager-loaded relationships.
 */
export interface Bill {
  // Required because these are NOT NULL columns and every route that returns a
  // bill — detail, search, list, the member's sponsored bills — includes them.
  // Keeping them optional made Bill unassignable to the narrower row types the
  // components use, for no real-world gain.
  id: string
  bill_number: string
  title: string
  status: string
  source?: string
  level?: string
  description?: string | null
  full_text?: string | null
  sponsor?: string | null
  sponsor_party?: string | null
  sponsor_state?: string | null
  tags?: string | string[] | null
  introduced_date?: string | null
  last_updated?: string | null
  external_url?: string | null

  // AI enrichment
  plain_title?: string | null
  headline?: string | null
  lede?: string | null
  summary?: string | null
  impact_score?: number | null
  impact_level?: string | null
  bill_type?: string | null
  supplementary_data?: string | null
  news_links?: string | NewsLink[] | null
  analyzed_at?: string | null

  city?: string | null
  committee?: string | null
  // "Did we try" stamps the admin views surface.
  metadata_fetched_at?: string | null
  news_fetched_at?: string | null
  votes_fetched_at?: string | null
  /** Attached by /users/me/tracked-bills, not a column on the bill itself. */
  tracked_at?: string | null
  final_date?: string | null
  co_sponsors?: string | string[] | null

  // Two-lane case for / case against (the current direction)
  case_for?: string | null
  case_against?: string | null
  two_lane_state?: string | null // argued / procedural / dropped
  two_lane_generated_at?: string | null

  // Hearings
  next_hearing_date?: string | null
  next_hearing_time?: string | null
  next_hearing_body?: string | null
  next_hearing_location?: string | null
  next_hearing_url?: string | null

  // Eager-loaded relationships on the detail route
  perspectives?: Perspective[]
  vote_records?: VoteRecord[]

  // Aggregates some list/detail routes attach
  perspective_count?: number
  support_count?: number
  oppose_count?: number
}

/**
 * Just enough of the council-district GeoJSON for the point-in-polygon lookups
 * in `BillDetailClient` and the council-members index, which both walk it to
 * turn a geocoded address into a district number.
 *
 * The district number arrives under one of several property spellings depending
 * on which vintage of the city's file is being served, hence the optional
 * variants rather than one required key.
 */
export interface DistrictGeoJSON {
  features?: {
    properties?: {
      DISTRICT?: number | string
      District?: number | string
      district?: number | string
      DIST_NUM?: number | string
      districtNum?: number | string
    }
    geometry?: {
      type?: string
      coordinates?: unknown
    }
  }[]
}

/** Signed-in user, from `/api/auth/me`. */
export interface AuthUser {
  id: string
  email?: string
  display_name?: string
  avatar_url?: string | null
  is_admin?: boolean
  subscription_tier?: string
}
