export interface CityConfig {
  slug: string
  name: string              // 'Philadelphia'
  councilBody: string       // 'City Council'
  fullCouncilName: string   // 'Philadelphia City Council'
  totalMembers: number      // 17
  districtCount: number     // 10
  atLargeCount: number      // 7
  siteName: string          // 'Open Common Ground Philadelphia'
  legistarWebUrl: string    // 'https://phila.legistar.com'
}

export const CITIES: Record<string, CityConfig> = {
  philadelphia: {
    slug: 'philadelphia',
    name: 'Philadelphia',
    councilBody: 'City Council',
    fullCouncilName: 'Philadelphia City Council',
    totalMembers: 17,
    districtCount: 10,
    atLargeCount: 7,
    siteName: 'Open Common Ground Philadelphia',
    legistarWebUrl: 'https://phila.legistar.com',
  },
  chicago: {
    slug: 'chicago',
    name: 'Chicago',
    councilBody: 'City Council',
    fullCouncilName: 'Chicago City Council',
    totalMembers: 50,
    districtCount: 50,
    atLargeCount: 0,
    siteName: 'Open Common Ground Chicago',
    legistarWebUrl: 'https://chicago.legistar.com',
  },
  'new-york': {
    slug: 'new-york',
    name: 'New York',
    councilBody: 'City Council',
    fullCouncilName: 'New York City Council',
    totalMembers: 51,
    districtCount: 51,
    atLargeCount: 0,
    siteName: 'Open Common Ground New York',
    legistarWebUrl: 'https://legistar.council.nyc.gov',
  },
}

export function getCityConfig(slug: string): CityConfig | null {
  return CITIES[slug] ?? null
}

export const CITY_SLUG: string =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_CITY_SLUG) || 'philadelphia'

export const CITY = CITIES[CITY_SLUG] ?? CITIES.philadelphia
