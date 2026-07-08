import Link from 'next/link'
import type { Metadata } from 'next'
import { getAllPosts, formatPostDate } from '@/lib/blog'
import { ShareBar } from '@/components/blog/ShareBar'

export const metadata: Metadata = {
  title: 'Blog — Open Common Ground',
  description:
    'Opinionated deep dives on Philadelphia legislation — what the bills actually do, what the record shows, and why it matters.',
  alternates: { canonical: 'https://opencommonground.com/blog' },
  openGraph: {
    title: 'Blog — Open Common Ground',
    description:
      'Opinionated deep dives on Philadelphia legislation — what the bills actually do, what the record shows, and why it matters.',
    type: 'website',
    siteName: 'Open Common Ground',
    url: 'https://opencommonground.com/blog',
  },
}

export default function BlogIndexPage() {
  const posts = getAllPosts()

  return (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <header className="mb-10">
        <div className="type-eyebrow text-muted-foreground mb-2">The Blog</div>
        <h1 className="type-display mb-3">Reading the record</h1>
        <p className="type-body text-muted-foreground max-w-2xl">
          Opinionated deep dives into Philadelphia legislation — grounded in the actual bills and
          votes, with a point of view. One writer, no comment section.
        </p>
      </header>

      {posts.length === 0 ? (
        <p className="text-muted-foreground">No posts yet. Check back soon.</p>
      ) : (
        <ul className="space-y-8">
          {posts.map((post) => (
            <li key={post.slug}>
              <article className="group rounded-2xl border bg-card p-6 transition-colors hover:border-foreground/30">
                <Link href={`/blog/${post.slug}`} className="block">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-3">
                    <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
                      {post.stance}
                    </span>
                    <span>{formatPostDate(post.date)}</span>
                    <span aria-hidden>·</span>
                    <span>{post.reading_minutes} min read</span>
                  </div>
                  <h2 className="type-section mb-2 group-hover:underline underline-offset-4 decoration-primary/60">
                    {post.title}
                  </h2>
                  <p className="type-body text-muted-foreground">{post.dek}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {post.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </Link>
                <div className="mt-4 pt-4 border-t">
                  <ShareBar
                    url={`https://opencommonground.com/blog/${post.slug}`}
                    title={post.title}
                    slug={post.slug}
                  />
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
