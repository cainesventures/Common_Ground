// Typed access to the Philadelphia budget dataset
// (frontend/public/data/budget_history.json, produced by
// scripts/parse_budget_appropriations.py — parsed from the annual operating-budget
// ordinances and checksummed against each bill's own declared fund totals).
//
// getBudget() runs in server components and returns a COMPACTED shape (dropping
// checksum internals + empty class maps) so the client explorer ships less data.

import budgetJson from '@/public/data/budget_history.json'

interface RawDept { name: string; total: number; classes?: Record<string, number> }
interface RawFund {
  fund: string
  declared_total: number
  parsed_total: number
  verified: boolean
  departments: RawDept[]
}
interface RawYear {
  fiscal_year: number
  bill_number: string
  complete: boolean
  funds: RawFund[]
}
interface RawBudget {
  generated_at: string | null
  source: string
  fiscal_years: number[]
  funds: string[]
  years: RawYear[]
}

export interface BudgetDept {
  name: string
  total: number
  /** Spending-class breakdown (Personal Services, etc.). May be empty/partial. */
  classes?: Record<string, number>
}
export interface BudgetFund {
  fund: string
  /** The bill's own declared total (authoritative), even when parse is partial. */
  total: number
  /** True when parsed departments sum to the declared total within tolerance. */
  verified: boolean
  departments: BudgetDept[]
}
export interface BudgetYear {
  fiscalYear: number
  billNumber: string
  complete: boolean
  funds: BudgetFund[]
}
export interface BudgetData {
  generatedAt: string | null
  source: string
  fiscalYears: number[]
  funds: string[]
  years: BudgetYear[]
}

const raw = budgetJson as unknown as RawBudget

/** Title-case a SCREAMING department/fund name for display. */
export function prettyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bOf\b/g, 'of')
    .replace(/\bAnd\b/g, 'and')
    .replace(/\bThe\b/g, 'the')
    .replace(/\bTo\b/g, 'to')
}

export function getBudget(): BudgetData {
  return {
    generatedAt: raw.generated_at,
    source: raw.source,
    fiscalYears: raw.fiscal_years,
    funds: raw.funds,
    years: raw.years.map((y) => ({
      fiscalYear: y.fiscal_year,
      billNumber: y.bill_number,
      complete: y.complete,
      funds: y.funds.map((f) => ({
        fund: f.fund,
        total: f.declared_total,
        verified: f.verified,
        departments: [...f.departments]
          .sort((a, b) => b.total - a.total)
          .map((d) => ({
            name: d.name,
            total: d.total,
            ...(d.classes && Object.keys(d.classes).length ? { classes: d.classes } : {}),
          })),
      })),
    })),
  }
}

/** Funds ordered by their most-recent-year size (biggest first), for the selector. */
export function fundsBySize(data: BudgetData): string[] {
  const latest = data.years[data.years.length - 1]
  const size = new Map<string, number>()
  for (const y of data.years) {
    for (const f of y.funds) size.set(f.fund, Math.max(size.get(f.fund) ?? 0, f.total))
  }
  const inLatest = new Set(latest.funds.map((f) => f.fund))
  return [...size.keys()].sort((a, b) => {
    // Funds present in the latest year first, then by size.
    if (inLatest.has(a) !== inLatest.has(b)) return inLatest.has(a) ? -1 : 1
    return (size.get(b) ?? 0) - (size.get(a) ?? 0)
  })
}
