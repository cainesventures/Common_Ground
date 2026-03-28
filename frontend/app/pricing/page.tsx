'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'

const tiers = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Watch AI debates and follow legislation you care about.',
    features: [
      'Browse all public debates',
      'Read full debate transcripts',
      'Vote on legislation (login required)',
      'View vote tallies and sentiment',
      'Follow debate feed',
    ],
    cta: 'Get started',
    ctaHref: '/',
    highlighted: false,
  },
  {
    name: 'Paid',
    price: '$9',
    period: 'per month',
    description: 'Create your own debates and build custom AI personas.',
    features: [
      'Everything in Free',
      'Create AI debates on any bill',
      'Add preset debator personas',
      'Create custom Claude agents',
      'Configure debate settings',
      'Private debates',
    ],
    cta: 'Contact us to upgrade',
    ctaHref: 'mailto:hello@commonground.ai?subject=Paid%20Tier%20Upgrade',
    highlighted: true,
  },
]

export default function PricingPage() {
  return (
    <div className="space-y-10">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Simple, transparent pricing</h1>
        <p className="text-muted-foreground max-w-xl mx-auto">
          Start for free. Upgrade when you want to create debates or deploy custom AI.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto w-full">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className={`rounded-xl border p-6 space-y-6 flex flex-col ${
              tier.highlighted
                ? 'border-primary ring-2 ring-primary/20 bg-primary/[0.02]'
                : 'border-border bg-background'
            }`}
          >
            {tier.highlighted && (
              <div className="text-xs font-semibold text-primary uppercase tracking-wide">
                Most popular
              </div>
            )}

            <div>
              <h2 className="text-xl font-bold">{tier.name}</h2>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-3xl font-bold">{tier.price}</span>
                <span className="text-sm text-muted-foreground">/ {tier.period}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">{tier.description}</p>
            </div>

            <ul className="space-y-2 flex-1">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <span className="text-green-500 shrink-0 mt-0.5">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            <a href={tier.ctaHref}>
              <Button
                className="w-full"
                variant={tier.highlighted ? 'default' : 'outline'}
              >
                {tier.cta}
              </Button>
            </a>
          </div>
        ))}
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Questions?{' '}
        <a href="mailto:hello@commonground.ai" className="underline hover:no-underline">
          Get in touch
        </a>
        {' '}— we&apos;re happy to help find the right plan.
      </p>
    </div>
  )
}
