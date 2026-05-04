import { notFound } from 'next/navigation'
import { getCityConfig } from '@/lib/city'

export default async function CityLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ city: string }>
}) {
  const { city } = await params
  if (!getCityConfig(city)) notFound()
  return <>{children}</>
}
