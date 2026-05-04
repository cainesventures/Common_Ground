import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'About — Open Common Ground',
  description: 'About Open Common Ground — a free, independent civic technology project tracking Philadelphia City Council.',
}

export default function AboutPage() {
  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="text-2xl font-bold mb-1">About Open Common Ground</h1>
        <p className="text-sm text-muted-foreground">Personal project by Andrew Caines · Caines Ventures LLC</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Why I built this</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Philadelphia passes hundreds of bills every year. Most residents never hear about them. I wanted to
          change that — not by adding more noise, but by making the existing public record actually readable.
          City Council legislation is public, but it&apos;s buried in a system designed for lawyers and lobbyists,
          not for people who just want to know what&apos;s happening in their city.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Open Common Ground takes every bill introduced in Philadelphia City Council, summarizes it in plain
          English, scores its potential impact, and shows how 17 different political perspectives — from
          progressive to libertarian — might view it. The goal isn&apos;t to tell you what to think. It&apos;s to give
          you the context to think for yourself.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          I&apos;m a software developer and Philadelphia resident. This is a personal project — not a startup,
          not a nonprofit, not affiliated with the city in any way. I built it because I think civic
          transparency matters, and because I could.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">How it works</h2>
        <div className="space-y-3">
          {[
            ['Bill data', 'Legislation is scraped from Philadelphia Legistar, the official public record system maintained by City Council. Bills are fetched regularly to keep the data current.'],
            ['AI analysis', 'Each bill is sent to an AI model that writes a plain-English summary, assigns an impact score (1–10), categorizes the bill type, and generates 17 political perspectives ranging across the ideological spectrum.'],
            ['Perspectives', 'The 17 perspectives are not endorsements. They are AI-generated simulations of how different political viewpoints — progressive, conservative, libertarian, socialist, and more — might frame the same bill. They are meant to illuminate trade-offs, not declare winners.'],
            ['Limitations', 'AI can be wrong. Summaries may miss nuance. Perspective assessments are approximations. Always read the source bill and form your own view. Nothing here is legal or political advice.'],
          ].map(([title, body]) => (
            <div key={title as string} className="border rounded-lg p-4">
              <p className="text-sm font-semibold mb-1">{title}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Data sources</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Local legislation comes from{' '}
          <a href="https://phila.legistar.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors">
            Philadelphia Legistar
          </a>
          , the official bill tracking system for Philadelphia City Council. The database currently covers
          legislation introduced from 2000 to the present.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Open source</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The full source code is publicly available on GitHub. Contributions, bug reports, and feedback
          are welcome. The project is MIT licensed.
        </p>
        <a
          href="https://github.com/acaines/open-common-ground"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm underline hover:text-foreground transition-colors text-muted-foreground"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
          </svg>
          View on GitHub
        </a>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Contact &amp; follow</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          <a href="mailto:hello@opencommonground.com" className="underline hover:text-foreground transition-colors text-muted-foreground">
            hello@opencommonground.com
          </a>
          <a href="https://www.linkedin.com/in/andrewcaines" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors text-muted-foreground">
            LinkedIn
          </a>
          <a href="https://bsky.app/profile/opencommonground.bsky.social" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground transition-colors text-muted-foreground">
            Bluesky
          </a>
        </div>
      </section>

      <div className="rounded-xl border border-dashed p-6 space-y-3 text-center">
        <p className="text-sm font-semibold">Support the project</p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          This runs on donations. If you find it useful, consider contributing to keep it free and independent.
        </p>
        <Link
          href="/donate"
          className="inline-block px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          Donate →
        </Link>
      </div>

      <div className="pt-4 border-t">
        <Link href="/" className="text-sm text-primary hover:underline">← Back to home</Link>
      </div>
    </div>
  )
}
