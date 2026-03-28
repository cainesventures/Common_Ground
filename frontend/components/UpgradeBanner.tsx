import Link from 'next/link'
import { Button } from '@/components/ui/button'

interface UpgradeBannerProps {
  requiredTier: 'paid' | 'dev'
  featureName: string
  className?: string
}

const TIER_LABELS: Record<string, string> = {
  paid: 'Paid',
  dev: 'Developer',
}

export function UpgradeBanner({ requiredTier, featureName, className = '' }: UpgradeBannerProps) {
  return (
    <div className={`rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center space-y-4 ${className}`}>
      <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-muted mx-auto">
        <span className="text-2xl">🔒</span>
      </div>
      <div>
        <p className="font-semibold">{featureName} requires the {TIER_LABELS[requiredTier]} plan</p>
        <p className="text-sm text-muted-foreground mt-1">
          Upgrade to unlock this feature and everything else in the {TIER_LABELS[requiredTier]} tier.
        </p>
      </div>
      <Link href="/pricing">
        <Button size="sm">View pricing</Button>
      </Link>
    </div>
  )
}
