import type { Metadata } from 'next'
import { siteUrl } from '@/lib/site'
import { GLOSSARY } from '@/lib/civic-glossary'

export const metadata: Metadata = {
  title: 'Philadelphia City Council Glossary, Open Common Ground',
  description:
    'Plain-English definitions of the terms used in Philadelphia City Council: ordinance, resolution, in committee, lapsed, veto, at-large, councilmanic prerogative and more.',
  alternates: { canonical: siteUrl('/glossary') },
}

// Also the target of every "All civic terms" link in a Term popover, so each
// entry carries an id and scroll margin to clear the sticky navbar.
export default function GlossaryPage() {
  const entries = Object.entries(GLOSSARY).sort(([, a], [, b]) => a.term.localeCompare(b.term))
  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">City Council glossary</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The words Philadelphia City Council uses, in plain English. Tap any dotted-underlined term on the site to see its definition.
        </p>
      </div>
      <dl className="divide-y border-y">
        {entries.map(([id, e]) => (
          <div key={id} id={id} className="py-4 scroll-mt-20 target:bg-primary/5 target:-mx-3 target:px-3 rounded-lg">
            <dt className="font-semibold">{e.term}</dt>
            <dd className="text-sm text-muted-foreground leading-relaxed mt-1">
              {e.short}
              {e.more && <span className="block mt-1.5">{e.more}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
