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

/** Human-friendly date, e.g. "June 29, 2026". */
export function formatPostDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
