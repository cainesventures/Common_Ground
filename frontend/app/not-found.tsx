import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <p className="text-6xl font-bold text-primary/20 mb-4">404</p>
      <h1 className="text-2xl font-bold mb-2">Page not found</h1>
      <p className="text-muted-foreground mb-8 max-w-sm">
        This page doesn&apos;t exist. The bill may have been removed, or you may have followed a broken link.
      </p>
      <div className="flex items-center gap-4">
        <Link
          href="/philadelphia/legislation"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 h-9 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Browse legislation
        </Link>
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Go home
        </Link>
      </div>
    </div>
  )
}
