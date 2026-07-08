// Adjustment tables for the budget explorer: convert nominal appropriations into
// inflation-adjusted ("real") or per-capita terms. Kept free of the dataset import
// so the client bundle can use it directly.
//
// CPI-U: U.S. city average, all items, annual average (1982-84 = 100), BLS.
//   2001-2024 are published annual averages; 2025-2027 are estimates (the city's
//   fiscal year straddles two calendar years, so treat these as approximate).
// Population: Philadelphia city, U.S. Census (decennial + intercensal/vintage
//   estimates). Recent years are estimates.

export const CPI_U: Record<number, number> = {
  2001: 177.1, 2002: 179.9, 2003: 184.0, 2004: 188.9, 2005: 195.3,
  2006: 201.6, 2007: 207.3, 2008: 215.3, 2009: 214.5, 2010: 218.1,
  2011: 224.9, 2012: 229.6, 2013: 233.0, 2014: 236.7, 2015: 237.0,
  2016: 240.0, 2017: 245.1, 2018: 251.1, 2019: 255.7, 2020: 258.8,
  2021: 271.0, 2022: 292.7, 2023: 304.7, 2024: 313.7, 2025: 322.0,
  2026: 329.0, 2027: 337.0,
}

export const PHILLY_POP: Record<number, number> = {
  2001: 1_493_000, 2002: 1_490_000, 2003: 1_488_000, 2004: 1_486_000, 2005: 1_484_000,
  2006: 1_488_000, 2007: 1_492_000, 2008: 1_500_000, 2009: 1_512_000, 2010: 1_526_006,
  2011: 1_538_000, 2012: 1_548_000, 2013: 1_555_000, 2014: 1_561_000, 2015: 1_567_000,
  2016: 1_571_000, 2017: 1_576_000, 2018: 1_584_000, 2019: 1_590_000, 2020: 1_603_797,
  2021: 1_596_000, 2022: 1_567_000, 2023: 1_550_000, 2024: 1_553_000, 2025: 1_556_000,
  2026: 1_558_000, 2027: 1_560_000,
}

export type BudgetMode = 'nominal' | 'real' | 'percapita'

/**
 * Convert a nominal figure for fiscal year `fy` into the selected mode.
 * `baseFY` is the reference year for real-dollar adjustment (defaults to the
 * newest year available in CPI_U).
 */
export function adjust(value: number, fy: number, mode: BudgetMode, baseFY: number): number {
  if (mode === 'real') {
    const cFy = CPI_U[fy]
    const cBase = CPI_U[baseFY]
    if (!cFy || !cBase) return value
    return value * (cBase / cFy)
  }
  if (mode === 'percapita') {
    const pop = PHILLY_POP[fy]
    if (!pop) return value
    return value / pop
  }
  return value
}

export const MODE_LABEL: Record<BudgetMode, string> = {
  nominal: 'Nominal $',
  real: 'Real $',
  percapita: 'Per resident',
}
