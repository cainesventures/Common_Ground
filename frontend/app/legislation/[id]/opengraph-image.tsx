import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const STATUS_LABELS: Record<string, string> = {
  introduced:      'Introduced',
  in_committee:    'In Committee',
  signed_into_law: 'Signed into Law',
  failed:          'Failed',
  vetoed:          'Vetoed',
}

const IMPACT_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  high:   { bg: '#fef2f2', text: '#991b1b', dot: '#ef4444' },
  medium: { bg: '#fffbeb', text: '#92400e', dot: '#f59e0b' },
  low:    { bg: '#f0fdf4', text: '#166534', dot: '#22c55e' },
}

export default async function OGImage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let title = 'Philadelphia City Council Bill'
  let billNumber = ''
  let impactLevel = ''
  let status = ''
  let hearingDate = ''
  let summary = ''

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'}/api/legislation/${id}`)
    if (res.ok) {
      const data = await res.json()
      const bill = data?.data
      title = bill?.plain_title || bill?.title || title
      billNumber = bill?.bill_number ?? ''
      impactLevel = bill?.impact_level ?? ''
      status = bill?.status ?? ''
      summary = bill?.summary ? bill.summary.slice(0, 180) : ''
      if (bill?.next_hearing_date) {
        hearingDate = new Date(bill.next_hearing_date).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        })
      }
    }
  } catch {}

  const impact = IMPACT_COLORS[impactLevel]
  const statusLabel = STATUS_LABELS[status] ?? status.replace(/_/g, ' ')

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          background: 'white',
          fontFamily: 'sans-serif',
          padding: '60px',
          justifyContent: 'space-between',
        }}
      >
        {/* Top bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '10px', height: '10px', borderRadius: '50%',
              background: '#2563eb',
            }} />
            <span style={{ fontSize: '20px', fontWeight: 700, color: '#1e40af', letterSpacing: '-0.5px' }}>
              Common Ground
            </span>
          </div>
          {billNumber && (
            <span style={{ fontSize: '18px', color: '#6b7280', fontWeight: 500 }}>
              Bill No. {billNumber}
            </span>
          )}
        </div>

        {/* Main content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, justifyContent: 'center' }}>
          <div style={{
            fontSize: title.length > 80 ? '36px' : '44px',
            fontWeight: 800,
            color: '#111827',
            lineHeight: 1.2,
            letterSpacing: '-1px',
          }}>
            {title.length > 120 ? title.slice(0, 117) + '…' : title}
          </div>

          {summary && (
            <div style={{ fontSize: '22px', color: '#6b7280', lineHeight: 1.5 }}>
              {summary.length > 180 ? summary.slice(0, 177) + '…' : summary}
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {impact && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: impact.bg, borderRadius: '999px',
              padding: '8px 18px',
            }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: impact.dot }} />
              <span style={{ fontSize: '18px', fontWeight: 700, color: impact.text, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {impactLevel} impact
              </span>
            </div>
          )}
          {statusLabel && (
            <div style={{
              background: '#f3f4f6', borderRadius: '999px',
              padding: '8px 18px',
              fontSize: '18px', fontWeight: 600, color: '#374151',
            }}>
              {statusLabel}
            </div>
          )}
          {hearingDate && (
            <div style={{
              background: '#fffbeb', borderRadius: '999px',
              padding: '8px 18px',
              fontSize: '18px', fontWeight: 600, color: '#92400e',
            }}>
              Hearing {hearingDate}
            </div>
          )}
          <div style={{ marginLeft: 'auto', fontSize: '16px', color: '#9ca3af' }}>
            Philadelphia City Council
          </div>
        </div>
      </div>
    ),
    { ...size }
  )
}
