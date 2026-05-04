import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'Open Common Ground — Philadelphia City Council Tracker'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            background: 'rgba(255,255,255,0.1)',
            borderRadius: '8px',
            padding: '6px 14px',
            color: '#93c5fd',
            fontSize: '18px',
            marginBottom: '24px',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          Philadelphia · Free · No Ads
        </div>
        <div
          style={{
            color: '#ffffff',
            fontSize: '64px',
            fontWeight: 'bold',
            lineHeight: 1.1,
            marginBottom: '24px',
            maxWidth: '900px',
          }}
        >
          Open Common Ground
        </div>
        <div
          style={{
            color: '#cbd5e1',
            fontSize: '28px',
            lineHeight: 1.4,
            maxWidth: '800px',
          }}
        >
          Track Philadelphia City Council bills with AI summaries and 17 political perspectives.
        </div>
        <div
          style={{
            marginTop: '48px',
            display: 'flex',
            gap: '16px',
          }}
        >
          {['Every bill', 'Plain English', '17 perspectives'].map((label) => (
            <div
              key={label}
              style={{
                background: 'rgba(255,255,255,0.12)',
                borderRadius: '6px',
                padding: '8px 18px',
                color: '#e2e8f0',
                fontSize: '18px',
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  )
}
