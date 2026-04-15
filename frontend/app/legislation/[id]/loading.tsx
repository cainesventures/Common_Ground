export default function BillDetailLoading() {
  return (
    <div className="max-w-3xl space-y-8 animate-pulse">
      {/* Header badges + title */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="h-5 w-16 bg-muted rounded-full" />
          <div className="h-5 w-24 bg-muted rounded-full" />
          <div className="h-5 w-20 bg-muted rounded-full" />
        </div>
        <div className="h-8 w-3/4 bg-muted rounded-md" />
        <div className="h-4 w-1/2 bg-muted rounded-md" />
        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          <div className="h-8 w-8 bg-muted rounded-lg" />
          <div className="h-8 w-8 bg-muted rounded-lg" />
          <div className="h-8 w-8 bg-muted rounded-lg" />
        </div>
      </div>

      {/* Status timeline */}
      <div className="h-10 bg-muted rounded-lg" />

      {/* Summary block */}
      <div className="border rounded-lg p-5 space-y-2">
        <div className="h-4 w-24 bg-muted rounded" />
        <div className="h-4 w-full bg-muted rounded" />
        <div className="h-4 w-5/6 bg-muted rounded" />
        <div className="h-4 w-4/6 bg-muted rounded" />
      </div>

      {/* Perspectives skeleton */}
      <div className="space-y-3">
        <div className="h-4 w-32 bg-muted rounded" />
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-24 bg-muted rounded-lg" />
        ))}
      </div>
    </div>
  )
}
