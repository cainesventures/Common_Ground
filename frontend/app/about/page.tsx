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
        <p className="text-sm text-muted-foreground">A free, independent civic technology project.</p>
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
        <h2 className="text-base font-semibold">Contact &amp; follow</h2>
        <div className="flex flex-wrap gap-4 text-sm">
          <a href="mailto:hello@opencommonground.com" className="underline hover:text-foreground transition-colors text-muted-foreground">
            hello@opencommonground.com
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
