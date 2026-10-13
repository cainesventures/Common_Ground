import Link from 'next/link'
import { getPostsForBill, formatPostDate } from '@/lib/blog'

/**
 * Surfaces the blog posts that cite this bill, at the top of the bill page.
 *
 * Bill pages are where most organic search traffic lands, and until now the
 * link only ran one way: a post listed its bills, but a bill knew nothing about
 * the posts analysing it. A reader who searched their way to bill 150617 had no
 * route to the piece explaining why that bill matters.
 *
 * Deliberately a server component so the markup is in the server-rendered HTML
 * that crawlers read, rather than appearing after hydration.
 */
export function BillBlogCallout({
  billId,
  billNumber,
}: {
  billId?: string | null
  billNumber?: string | null
}) {
  const posts = getPostsForBill(billId, billNumber)
  if (posts.length === 0) return null

  return (
    <aside className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-900/20">
      <div className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-200 mb-2">
        {posts.length === 1 ? 'We wrote about this bill' : 'We wrote about this bill'}
      </div>
      <ul className="space-y-3">
        {posts.map((post) => (
          <li key={post.slug}>
            <Link href={`/blog/${post.slug}`} className="group block">
              <div className="text-sm font-medium group-hover:underline underline-offset-4 decoration-primary/60">
                {post.title}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{post.dek}</p>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatPostDate(post.date)}
                <span className="mx-1" aria-hidden>
                  ·
                </span>
                {post.reading_minutes} min read
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  )
}
