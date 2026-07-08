'use client'

import { useState } from 'react'
import { usePostHog } from 'posthog-js/react'
import { Share2, Link2, Check } from 'lucide-react'

export function ShareBar({ url, title, slug }: { url: string; title: string; slug: string }) {
  const posthog = usePostHog()
  const [copied, setCopied] = useState(false)
  const enc = encodeURIComponent

  const links = [
    { key: 'x', label: 'X', href: `https://twitter.com/intent/tweet?text=${enc(title)}&url=${enc(url)}` },
    { key: 'bluesky', label: 'Bluesky', href: `https://bsky.app/intent/compose?text=${enc(`${title} ${url}`)}` },
    { key: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}` },
    { key: 'reddit', label: 'Reddit', href: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(title)}` },
    { key: 'email', label: 'Email', href: `mailto:?subject=${enc(title)}&body=${enc(`${title}\n\n${url}`)}` },
  ]

  const track = (network: string) => posthog?.capture('post_shared', { slug, network })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      track('copy')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground mr-1">
        <Share2 className="w-4 h-4" /> Share
      </span>
      {links.map((l) => (
        <a
          key={l.key}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => track(l.key)}
          className="rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
        >
          {l.label}
        </a>
      ))}
      <button
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5" /> Copied
          </>
        ) : (
          <>
            <Link2 className="w-3.5 h-3.5" /> Copy link
          </>
        )}
      </button>
    </div>
  )
}
