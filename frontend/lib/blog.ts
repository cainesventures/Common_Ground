// Typed access to the blog dataset (frontend/public/data/blog_posts.json).
//
// The blog is the site author's single-voice commentary on Philadelphia
// legislation — opinionated deep dives that link back to the underlying bills.
// Server components import the accessors below; the JSON is bundled at build
// time so every post renders fully static with no API dependency.

import blogJson from '@/public/data/blog_posts.json'

export interface RelatedBill {
  bill_number: string
  year: number
  title: string
  outcome: string // e.g. "Signed into law", "Died in committee"
  vote: string | null // roll-call tally where recorded; null = no recorded roll call
  url: string
  // Optional subheading. Consecutive bills with the same group render under one
  // heading, so a post can split a long evidence list into the sets it compares.
  group?: string
}

export interface BlogPost {
  slug: string
  title: string
  dek: string
  author: string
  date: string // ISO yyyy-mm-dd
  reading_minutes: number
  tags: string[]
  stance: string
  summary: string
  content_md: string
  related_bills: RelatedBill[]
}

interface BlogData {
  generated_at: string | null
  posts: BlogPost[]
}

const data = blogJson as unknown as BlogData

/** All posts, newest first. */
export function getAllPosts(): BlogPost[] {
  return [...(data.posts ?? [])].sort((a, b) => b.date.localeCompare(a.date))
}

export function getPost(slug: string): BlogPost | null {
  return data.posts?.find((p) => p.slug === slug) ?? null
}

export function getAllSlugs(): string[] {
  return (data.posts ?? []).map((p) => p.slug)
}

/**
 * Tags to show as topic pills. The stance has its own badge, so a tag that
 * repeats it ("Opinion" beside the Opinion badge) is left out of the display.
 * Metadata still gets the full list.
 */
export function topicTags(post: BlogPost): string[] {
  const stance = post.stance.trim().toLowerCase()
  return post.tags.filter((t) => t.trim().toLowerCase() !== stance)
}

/** The Legistar id inside a related-bill URL, e.g. ".../legistar_phila_2360998". */
function billIdFromUrl(url: string): string | null {
  return url.match(/(legistar_phila_\d+)/)?.[1] ?? null
}

/**
 * Every post that cites a given bill.
 *
 * This is the reverse of related_bills, and it exists because the traffic runs
 * the other way: bill pages are the site's top organic entry point, so a reader
 * arriving from a search lands on the bill and has no way to discover the piece
 * that analyses it. Matching is by Legistar id, with bill number as a fallback
 * for any entry whose URL is not in the canonical form.
 */
export function getPostsForBill(
  billId?: string | null,
  billNumber?: string | null,
): BlogPost[] {
  if (!billId && !billNumber) return []
  return getAllPosts().filter((post) =>
    (post.related_bills ?? []).some((b) => {
      if (billId && billIdFromUrl(b.url) === billId) return true
      if (billNumber && b.bill_number === billNumber) return true
      return false
    }),
  )
}

/** Human-friendly date, e.g. "June 29, 2026". */
export function formatPostDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
