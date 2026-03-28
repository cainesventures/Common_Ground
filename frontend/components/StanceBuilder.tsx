'use client'

interface Dimension {
  key: string
  label: string
  description: string
  positions: Record<string, string>
}

interface StanceBuilderProps {
  dimensions: Dimension[]
  stances: Record<string, number>
  onChange: (key: string, value: number) => void
}

export function StanceBuilder({ dimensions, stances, onChange }: StanceBuilderProps) {
  return (
    <div className="space-y-6">
      {dimensions.map((dim) => {
        const current = stances[dim.key] ?? 3
        return (
          <div key={dim.key} className="space-y-2">
            <div>
              <p className="font-medium text-sm">{dim.label}</p>
              <p className="text-xs text-muted-foreground">{dim.description}</p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {[1, 2, 3, 4, 5].map((val) => {
                const fullLabel = dim.positions[String(val)] ?? String(val)
                // Use the first 2–3 words as a short button label
                const shortLabel = fullLabel.split(' ').slice(0, 3).join(' ')
                const isSelected = current === val
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => onChange(dim.key, val)}
                    title={fullLabel}
                    className={`
                      px-2.5 py-1.5 rounded-md text-xs font-medium border transition-all
                      ${isSelected
                        ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                        : 'bg-background border-border text-muted-foreground hover:border-primary hover:text-foreground'
                      }
                    `}
                  >
                    {shortLabel}
                  </button>
                )
              })}
            </div>
            {stances[dim.key] && (
              <p className="text-xs text-muted-foreground italic">
                {dim.positions[String(stances[dim.key])]}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
