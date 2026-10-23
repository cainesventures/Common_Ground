import { ImageResponse } from 'next/og'

export const runtime = 'edge'

const W = 1080
const H = 1920

const STATUS_LABELS: Record<string, string> = {
  introduced: 'Introduced',
  in_committee: 'In Committee',
  awaiting_mayor: 'Awaiting Mayor',
  signed_into_law: 'Signed into Law',
  failed: 'Failed',
  vetoed: 'Vetoed',
  lapsed: 'Lapsed',
}

/** Cut at a word boundary so the card never ends mid-word. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:]$/, '') + '…'
}

/**
 * A 9:16 "Both Sides" card for Instagram/TikTok stories and group chats.
 *
 * The audience constraint on this site is reach, and the both-sides block is
 * the thing people say is distinctive, so this renders it as an image people
 * can post where links do not travel. Both cases get identical size, weight
 * and position, and the card says neither is the site's position: an image
 * travels without its page, so the neutrality has to be inside the image.
 *
 * Bills without argued lanes get the summary instead, so the button is never
 * a dead end.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ city: string; id: string }> }) {
  const { id } = await params

  let headline = 'Philadelphia City Council Bill'
  let billNumber = ''
  let status = ''
  let caseFor = ''
  let caseAgainst = ''
  let summary = ''

  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'}/api/legislation/${id}`)
    if (res.ok) {
      const bill = (await res.json())?.data
      headline = bill?.headline || bill?.plain_title || bill?.title || headline
      billNumber = bill?.bill_number ?? ''
      status = bill?.status ?? ''
      if (bill?.two_lane_state === 'argued' && bill?.case_for && bill?.case_against) {
        caseFor = bill.case_for
        caseAgainst = bill.case_against
      }
      summary = bill?.summary ?? ''
    }
  } catch {}

  const argued = Boolean(caseFor && caseAgainst)

  // Satori does not shrink-to-fit, so the layout is computed: estimate the
  // headline's height, split what is left evenly between the two lanes, and
  // pick the largest type size at which BOTH arguments fit. Clipping is the
  // last resort, and both lanes always share one size so neither side looks
  // bigger. Noto Sans averages ~0.47em per character.
  const CHAR = 0.47
  const headSize = headline.length > 90 ? 52 : 62
  const headLines = Math.ceil(headline.length / (936 / (headSize * CHAR)))
  const headH = headLines * headSize * 1.12
  // 1920 minus padding, brand row, chips, gaps, footer (~170px)
  const lanesH = H - 90 - 72 - 40 - 116 - 32 - headH - 56 - 28 - 170
  const laneTextH = lanesH / 2 - 72 - 26 - 18   // lane padding, label, gap
  const fits = (size: number) => {
    const perLine = 848 / (size * CHAR)
    const lines = Math.floor(laneTextH / (size * 1.42))
    return Math.floor(perLine * lines * 0.95)
  }
  const laneSize = [34, 31, 28, 26].find((sz) => Math.max(caseFor.length, caseAgainst.length) <= fits(sz)) ?? 26
  const budget = fits(laneSize)
  const statusLabel = STATUS_LABELS[status] ?? status.replace(/_/g, ' ')
  const host = 'opencommonground.com'

  const lane = (label: string, text: string, accent: string, tint: string) => (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 18,
      background: tint, borderLeft: `8px solid ${accent}`, borderRadius: 28,
      padding: '36px 40px', flex: 1, flexBasis: 0, minHeight: 0, overflow: 'hidden',
    }}>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', color: accent }}>
        {label}
      </div>
      <div style={{ fontSize: laneSize, lineHeight: 1.42, color: '#e2e8f0' }}>
        {clip(text, budget)}
      </div>
    </div>
  )

  return new ImageResponse(
    (
      <div style={{
        width: W, height: H, display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(160deg, #0f172a 0%, #111827 55%, #0b1220 100%)',
        padding: '90px 72px 72px', fontFamily: 'sans-serif', color: 'white',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 18, height: 18, borderRadius: 9, background: '#60a5fa' }} />
            <div style={{ fontSize: 30, fontWeight: 700 }}>Open Common Ground</div>
          </div>
          <div style={{ fontSize: 26, color: '#94a3b8' }}>Philadelphia City Council</div>
        </div>

        <div style={{ display: 'flex', gap: 14, marginTop: 64 }}>
          {billNumber && (
            <div style={{ fontSize: 24, color: '#cbd5e1', border: '2px solid #334155', borderRadius: 999, padding: '8px 22px' }}>
              {/* One string: two text children in a non-flex div makes the
                  renderer abort with an empty reply and no log line. */}
              {`Bill ${billNumber}`}
            </div>
          )}
          {statusLabel && (
            <div style={{ fontSize: 24, color: '#0b1220', background: '#93c5fd', borderRadius: 999, padding: '8px 22px', fontWeight: 700 }}>
              {statusLabel}
            </div>
          )}
        </div>

        <div style={{ fontSize: headSize, fontWeight: 800, lineHeight: 1.12, letterSpacing: -1.5, marginTop: 32 }}>
          {clip(headline, 130)}
        </div>

        {argued ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28, marginTop: 56, flex: 1 }}>
            {lane('The case for', caseFor, '#34d399', 'rgba(52, 211, 153, 0.10)')}
            {lane('The case against', caseAgainst, '#fb7185', 'rgba(251, 113, 133, 0.10)')}
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, marginTop: 56 }}>
            <div style={{ fontSize: 38, lineHeight: 1.45, color: '#cbd5e1' }}>{clip(summary, 520)}</div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 40 }}>
          {argued && (
            <div style={{ fontSize: 24, color: '#94a3b8', lineHeight: 1.4 }}>
              AI-written arguments, checked against the bill text. Neither side is the site&apos;s position.
            </div>
          )}
          <div style={{ fontSize: 30, fontWeight: 700, color: '#93c5fd' }}>
            {/* The full bill URL is ~70 chars and will not fit; the bill
                number is what someone types into the site's search. */}
            {billNumber ? `Look up bill ${billNumber} at ${host}` : host}
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
    },
  )
}
