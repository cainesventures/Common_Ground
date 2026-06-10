// Typed access to the AI-generated legislative history dataset
// (frontend/public/data/legislative_history.json, produced by
// scripts/generate_legislative_narrative.py).
//
// Server components import the accessors below — the JSON is bundled at
// build time, so year pages render fully static with no API dependency.
// Client components should use `import type` for the interfaces only and
// keep fetching /data/legislative_history.json at runtime, to avoid pulling
// the whole dataset into the client bundle.

import historyJson from '@/public/data/legislative_history.json'

export interface NotableBill {
  id: string
  bill_number: string
  title: string
  lede: string | null
  impact_score: number
  status: string
  tags: string[]
}

export interface ContestedBill {
  id: string
  bill_number: string
  title: string
  status: string
  yeas: number
  nays: number
  dissenters: string[]
}

export interface YearStats {
  total: number
  delta_vs_prior: number | null
  signed: number
  failed: number
  vetoed: number
  died_in_committee?: number
  still_pending?: number
  pass_rate: number | null
  median_days_to_passage: number | null
  top_tags: { tag: string; count: number }[]
  rising_tags: { tag: string; delta: number }[]
  falling_tags: { tag: string; delta: number }[]
  top_sponsors: { name: string; count: number }[]
  contested_count: number
}

export interface YearEntry {
  year: number
  is_partial: boolean
  headline: string
  narrative: string
  key_themes: string[]
  stats: YearStats
  notable_bills: NotableBill[]
  contested_bills: ContestedBill[]
}

export interface NarrativeData {
  generated_at: string | null
  years_covered: { from: number; to: number }
  total_bills: number
  key_stats: { label: string; value: string; note?: string }[]
  narrative: string | null
  top_issues: { tag: string; count: number }[]
  top_sponsors?: { name: string; count: number }[]
  years?: YearEntry[]
}

const history = historyJson as unknown as NarrativeData

// The dataset currently covers Philadelphia only.
export const HISTORY_CITY = 'philadelphia'

export function getHistory(): NarrativeData {
  return history
}

export function getYearEntry(year: number): YearEntry | null {
  return history.years?.find(y => y.year === year) ?? null
}

/** All years with data, newest first. */
export function getAllYears(): number[] {
  return (history.years ?? []).map(y => y.year).sort((a, b) => b - a)
}
