// Plain-language explanations for the budget explorer: what each fund is, what
// the spending classes (line items) mean, and notes on the big "departments"
// that are really central budget lines. No dataset import — safe on the client.

export const FUND_INFO: Record<string, string> = {
  'GENERAL FUND':
    "The city's main operating account. Most local taxes (wage, property, business, sales) flow here and pay for the services the city runs directly — police, fire, prisons, streets, parks, health, courts. This is the money City Council fights over most.",
  'WATER FUND':
    'A self-supporting utility fund paid for by water and sewer bills, not taxes. It runs the Water Department; by law it can only be spent on the water and sewer system.',
  'WATER RESIDUAL FUND':
    'Holds leftover water-system revenue after operating costs — used mainly for water-system debt and internal transfers.',
  'AVIATION FUND':
    'A self-supporting fund for Philadelphia International (PHL) and Northeast airports, paid for by airline fees, rents, and concessions rather than local taxes.',
  'GRANTS REVENUE FUND':
    'Federal, state, and private grant money passing through the city. Restricted to whatever each grant funds — specific health, housing, or public-safety programs.',
  'COMMUNITY DEVELOPMENT FUND':
    'Federal Community Development Block Grant (CDBG) money from HUD, used for housing, neighborhood revitalization, and services in lower-income areas.',
  'HEALTHCHOICES BEHAVIORAL HEALTH REVENUE FUND':
    'State and Medicaid funds for behavioral health — mental-health and substance-use services — administered through the HealthChoices managed-care program.',
  'HOTEL ROOM RENTAL TAX FUND':
    'Revenue from the tax on hotel stays, dedicated largely to tourism, the convention center, and promoting Philadelphia to visitors.',
  'CAR RENTAL TAX FUND':
    'Revenue from the tax on car rentals — a dedicated stream historically tied to specific obligations such as stadium and convention-center debt.',
  'SPECIAL GASOLINE TAX FUND':
    "Philadelphia's share of the state gasoline tax. By state law it can only be spent on streets and highways — paving, lighting, and traffic.",
  'COUNTY LIQUID FUELS TAX FUND':
    'A smaller state liquid-fuels tax share, also restricted by law to road and bridge maintenance.',
  'HOUSING TRUST FUND':
    'Dedicated fees (mainly document-recording fees) set aside for affordable housing, home repair, and homelessness prevention.',
  'ACUTE CARE HOSPITAL FUND':
    'Revenue from a state assessment on hospitals, used to draw down federal Medicaid matching funds for health care.',
  'PHILADELPHIA COUNTY DEMOLITION FUND':
    'A dedicated fund for demolishing dangerous and blighted buildings.',
  'TRANSPORTATION FUND':
    'A dedicated fund for transportation infrastructure and programs across the city.',
  'MUNICIPAL PENSION FUND':
    "Covers the cost of administering the city's pension system for retirees. (The pension contributions themselves are budgeted under Finance — Employee Benefits.)",
  'BUDGET STABILIZATION FUND':
    "The city's 'rainy day' reserve — money set aside to cushion against recessions and revenue shortfalls.",
  'PARKS AND RECREATION PROGRAMS AND FACILITIES FUND':
    'A dedicated fund for parks and recreation programs, activities, and facility upkeep, often fed by fees and donations.',
}

export const CLASS_INFO: Record<string, string> = {
  'Personal Services':
    'Salaries and wages for city employees — the cost of the people who do the work. In central "Employee Benefits" lines it also covers pensions and health insurance.',
  'Purchase of Services':
    'Payments to outside contractors and vendors — anything the city buys as a service rather than doing in-house: consultants, legal work, leases, utilities, and subsidies.',
  'Materials, Supplies and Equipment':
    'Physical goods the city buys — fuel, supplies, vehicles, and equipment.',
  'Contributions, Indemnities and Taxes':
    'Grants and contributions the city pays out, plus legal settlements and claims (indemnities) and any taxes it owes.',
  'Debt Service': 'Principal and interest payments on money the city has borrowed.',
  'Payments to Other Funds': 'Internal transfers from this fund to another city fund.',
  'Advances and Miscellaneous Payments':
    "Reserves and miscellaneous payments that don't fit the other categories.",
}

// Notes for the big "departments" that surprise people — most are central budget
// lines, not agencies. Matched by substring against the uppercase department name.
const DEPT_NOTES: [string, string][] = [
  ['FRINGE BENEFIT',
    "Not an agency — this is where the city budgets health insurance and pension contributions for its ENTIRE workforce, pooled centrally under the Finance Director. It's one of the single largest lines in the whole budget."],
  ['EMPLOYEE BENEFIT',
    'Health insurance and pension contributions for city employees, budgeted centrally rather than inside each department.'],
  ['SINKING FUND',
    "The city's debt-service line — principal and interest on money it has borrowed — managed by the Sinking Fund Commission."],
  ['CONTRIBUTION TO SCHOOL',
    "The city's direct contribution to the School District of Philadelphia."],
  ['COMMUNITY COLLEGE',
    "The city's subsidy to the Community College of Philadelphia."],
  ['INDEMNITIES',
    'Money set aside to pay legal claims, lawsuits, and settlements against the city.'],
  ['BUDGET STABILIZATION',
    "A transfer into the city's 'rainy day' reserve fund."],
  ['DEFENDER',
    "Funding for the Defender Association, which provides public defense — court-appointed lawyers for people who can't afford one."],
  ['CONVENTION CENTER',
    'The city’s operating subsidy to the Pennsylvania Convention Center.'],
  ['ART MUSEUM',
    'The city’s operating subsidy to the Philadelphia Museum of Art.'],
  ['CONTRIBUTION TO SEPTA',
    "The city's contribution to SEPTA, the regional transit authority."],
]

export function deptNote(name: string): string | null {
  const up = name.toUpperCase()
  for (const [key, note] of DEPT_NOTES) if (up.includes(key)) return note
  return null
}
