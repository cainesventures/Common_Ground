import Link from 'next/link'

export function Footer() {
  return (
    <footer className="border-t mt-16 bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-sm">Common Ground</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Philadelphia City Council bill tracker — free, independent, no ads.
            </p>
          </div>
          <nav className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <Link href="/legislation" className="hover:text-foreground transition-colors">Legislation</Link>
            <Link href="/councilmembers" className="hover:text-foreground transition-colors">Council</Link>
            <Link href="/insights" className="hover:text-foreground transition-colors">Insights</Link>
            <Link href="/donate" className="hover:text-foreground transition-colors">Donate</Link>
            <Link href="/legal" className="hover:text-foreground transition-colors">Legal &amp; Disclaimer</Link>
          </nav>
        </div>
        <p className="text-xs text-muted-foreground mt-6">
          AI-generated content is for informational purposes only and does not constitute legal or political advice.
          Data sourced from <a href="https://phila.legistar.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">Philadelphia Legistar</a>.
          Not affiliated with Philadelphia City Council or any government agency.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          © {new Date().getFullYear()} Common Ground. Built for Philadelphians.
        </p>
      </div>
    </footer>
  )
}
