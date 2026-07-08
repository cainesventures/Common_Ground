import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import ReactMarkdown from 'react-markdown'
import { getAllSlugs, getPost, formatPostDate } from '@/lib/blog'
import { ShareBar } from '@/components/blog/ShareBar'

// Fully static: every post is prerendered; unknown slugs 404 without the server.
export const dynamicParams = false

export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) return { title: 'Blog — Open Common Ground' }

  const canonical = `https://opencommonground.com/blog/${post.slug}`
  return {
    title: `${post.title} — Open Common Ground`,
    description: post.summary,
    alternates: { canonical },
    openGraph: {
      title: post.title,
      description: post.summary,
      type: 'article',
      siteName: 'Open Common Ground',
      url: canonical,
      publishedTime: post.date,
      authors: [post.author],
      tags: post.tags,
    },
    twitter: { card: 'summary_large_image', title: post.title, description: post.summary },
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const post = getPost(slug)
  if (!post) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'OpinionNewsArticle',
    headline: post.title,
    description: post.summary,
    datePublished: post.date,
    dateModified: post.date,
    author: { '@type': 'Person', name: post.author },
    publisher: { '@type': 'Organization', name: 'Open Common Ground' },
    keywords: post.tags.join(', '),
    mainEntityOfPage: `https://opencommonground.com/blog/${post.slug}`,
  }

  const shareUrl = `https://opencommonground.com/blog/${post.slug}`

  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav className="mb-8 text-sm">
        <Link href="/blog" className="text-muted-foreground hover:text-foreground transition-colors">
          ← All posts
        </Link>
      </nav>

      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-4">
          <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
            {post.stance}
          </span>
          {post.tags.map((t) => (
            <span key={t} className="rounded-full bg-muted px-2.5 py-0.5">
              {t}
            </span>
          ))}
        </div>
        <h1 className="type-display mb-3">{post.title}</h1>
        <p className="type-body text-muted-foreground mb-5">{post.dek}</p>
        <div className="flex items-center gap-2 text-sm text-muted-foreground border-t pt-4">
          <span className="font-medium text-foreground">{post.author}</span>
          <span aria-hidden>·</span>
          <span>{formatPostDate(post.date)}</span>
          <span aria-hidden>·</span>
          <span>{post.reading_minutes} min read</span>
        </div>
        <div className="mt-5">
          <ShareBar url={shareUrl} title={post.title} slug={post.slug} />
        </div>
      </header>

      <article className="prose prose-neutral dark:prose-invert max-w-none prose-headings:tracking-tight prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:underline-offset-2">
        <ReactMarkdown>{post.content_md}</ReactMarkdown>
      </article>

      {post.related_bills.length > 0 && (
        <section className="mt-12 border-t pt-8">
          <h2 className="type-section mb-1">The bills behind this piece</h2>
          <p className="text-sm text-muted-foreground mb-5">
            Every claim above traces to the public legislative record. Each row shows the bill&apos;s
            outcome and, where one was recorded, the final roll-call vote. &ldquo;No roll call&rdquo;
            means it passed without a recorded tally — typically a voice vote.
          </p>
          <ul className="space-y-2">
            {post.related_bills.map((b) => {
              const died = /committee|fail|veto/i.test(b.outcome)
              return (
                <li key={b.bill_number}>
                  <a
                    href={b.url}
                    className="group flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-foreground/30"
                  >
                    <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                      {b.year}
                    </span>
                    <span className="flex-1 text-sm group-hover:underline underline-offset-4">
                      {b.title}
                    </span>
                    <span className="shrink-0 flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          died
                            ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                            : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                        }`}
                      >
                        {b.outcome}
                      </span>
                      <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">
                        {b.vote ?? 'no roll call'}
                      </span>
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <footer className="mt-12 border-t pt-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          This is commentary by {post.author}. There&apos;s no comment section — if it sparked
          something, share it where the conversation already lives.
        </p>
        <ShareBar url={shareUrl} title={post.title} slug={post.slug} />
      </footer>
    </main>
  )
}
