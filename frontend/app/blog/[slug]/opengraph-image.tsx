import { ImageResponse } from 'next/og'
import { getPost } from '@/lib/blog'

/**
 * Share card for a blog post.
 *
 * The posts already declared `twitter.card: 'summary_large_image'` but supplied
 * no image, so every share rendered a blank card — the worst of both, since the
 * large-card format reserves the space either way.
 *
 * Not `runtime = 'edge'` like the other OG routes: this reads the committed
 * posts JSON through `getPost`, which is a filesystem read.
 */
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Open Common Ground'

export default async function OGImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = getPost(slug)

  const title = post?.title ?? 'Open Common Ground'
  const date = post?.date
    ? new Date(post.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : ''

  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '8px',
              padding: '6px 14px',
              color: '#93c5fd',
              fontSize: '18px',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              marginBottom: '28px',
              alignSelf: 'flex-start',
            }}
          >
            Open Common Ground · Blog
          </div>
          <div
            style={{
              color: '#ffffff',
              // Long headlines need to stay on the card, so the size steps down
              // rather than letting the text overflow or clip.
              fontSize: title.length > 85 ? '46px' : title.length > 55 ? '54px' : '64px',
              fontWeight: 'bold',
              lineHeight: 1.15,
              maxWidth: '1000px',
            }}
          >
            {title}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: '#cbd5e1',
            fontSize: '24px',
          }}
        >
          <span>opencommonground.com</span>
          {date && <span style={{ color: '#94a3b8' }}>{date}</span>}
        </div>
      </div>
    ),
    size,
  )
}
