import type { Metadata } from 'next'
import { getBudget, fundsBySize } from '@/lib/budget'
import { BudgetExplorer } from '@/components/budget/BudgetExplorer'

export const metadata: Metadata = {
  title: 'Philadelphia Budget Explorer — Open Common Ground',
  description:
    "Explore 25+ years of Philadelphia's city budget — where the money is appropriated, by department and fund, parsed from the annual budget ordinances.",
  alternates: { canonical: 'https://opencommonground.com/budget' },
  openGraph: {
    title: 'Philadelphia Budget Explorer',
    description:
      "25+ years of Philadelphia's city budget by department and fund, straight from the appropriation ordinances.",
    type: 'website',
    siteName: 'Open Common Ground',
    url: 'https://opencommonground.com/budget',
  },
}

export default function BudgetPage() {
  const data = getBudget()
  const fundOrder = fundsBySize(data)
  const firstFY = data.fiscalYears[0]
  const lastFY = data.fiscalYears[data.fiscalYears.length - 1]

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `Philadelphia Operating Budget Appropriations, FY${firstFY}–FY${lastFY}`,
    description:
      'Departmental appropriations by fund and fiscal year, parsed from Philadelphia City Council operating-budget ordinances.',
    creator: { '@type': 'Organization', name: 'Open Common Ground' },
    temporalCoverage: `${firstFY}/${lastFY}`,
    isAccessibleForFree: true,
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <header className="mb-8">
        <div className="type-eyebrow text-muted-foreground mb-2">Budget Explorer</div>
        <h1 className="type-display mb-3">Where Philadelphia&apos;s money goes</h1>
        <p className="type-body text-muted-foreground max-w-2xl">
          Every dollar the city appropriates is set by an annual budget ordinance. This explorer pulls the
          department-by-department numbers straight from those ordinances, FY{firstFY} to FY{lastFY} — pick a
          fund and a year to see how the money is divided, and how it&apos;s shifted over time.
        </p>
      </header>

      <BudgetExplorer data={data} fundOrder={fundOrder} />

      <footer className="mt-8 space-y-2 text-xs text-muted-foreground">
        <p>
          Use the <strong>Real&nbsp;$</strong> toggle to strip out inflation (a rising nominal line is partly
          just the dollar losing value over 25 years), or <strong>Per&nbsp;resident</strong> to divide by
          population.
        </p>
        <p>
          Source: Philadelphia annual operating-budget ordinances (Legistar). Each fund&apos;s figures are
          checked against the ordinance&apos;s own declared total; a few early years are marked partial where
          the city&apos;s legislative record is incomplete. Inflation uses BLS CPI-U and population uses U.S.
          Census figures — recent years are estimates.
        </p>
      </footer>
    </main>
  )
}
