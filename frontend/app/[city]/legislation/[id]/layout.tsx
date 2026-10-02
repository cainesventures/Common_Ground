import { notFound } from 'next/navigation'
import { getBill, MISSING } from './get-bill'

/**
 * Exists only to turn a missing bill into a real 404.
 *
 * loading.tsx wraps page.tsx in a Suspense boundary, so Next flushes a 200 and
 * the loading skeleton before the page resolves — by which point a notFound()
 * thrown in the page (or in generateMetadata) can no longer change the status,
 * and the route answers 200 for bills that do not exist. A layout sits outside
 * that boundary and still blocks, so the check lands before the response is
 * committed and the skeleton is kept.
 *
 * The fetch is deduped with the ones in page.tsx and generateMetadata, so this
 * costs no extra request.
 */
export default async function BillLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ city: string; id: string }>
}) {
  const { id } = await params
  if ((await getBill(id)) === MISSING) notFound()
  return <>{children}</>
}
