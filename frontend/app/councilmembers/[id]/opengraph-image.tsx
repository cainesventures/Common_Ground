import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let name = 'Philadelphia City Councilmember'
  let district = ''
  let party = ''
  let billsSponsored = 0

  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'}/api/councilmembers/${id}`,
      { next: { revalidate: 3600 } }
    )
    if (res.ok) {
      const data = await res.json()
      const m = data?.member
      name = m?.name ?? name
      district = m?.district ?? ''
      party = m?.party ?? ''
      billsSponsored = m?.bills_sponsored ?? 0
    }
  } catch { /* fall through to defaults */ }

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
          padding: '64px 72px',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Top: site name */}
        <div style={{ color: '#93c5fd', fontSize: '16px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Common Ground · Philadelphia City Council
        </div>

        {/* Middle: name + meta */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ color: '#ffffff', fontSize: '56px', fontWeight: 700, lineHeight: 1.1 }}>
            {name}
          </div>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            {district && (
              <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: '8px', padding: '8px 18px', color: '#e2e8f0', fontSize: '20px' }}>
                {district}
              </div>
            )}
            {party && (
              <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: '8px', padding: '8px 18px', color: '#e2e8f0', fontSize: '20px' }}>
                {party}
              </div>
            )}
            {billsSponsored > 0 && (
              <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: '8px', padding: '8px 18px', color: '#e2e8f0', fontSize: '20px' }}>
                {billsSponsored} bills sponsored
              </div>
            )}
          </div>
        </div>

        {/* Bottom: tagline */}
        <div style={{ color: '#475569', fontSize: '16px' }}>
          Track votes, sponsored bills, and constituent approval · commonground.philly
        </div>
      </div>
    ),
    { ...size }
  )
}
