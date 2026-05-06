import { MetadataRoute } from 'next'

const BASE_URL = 'https://opencommonground.com'
const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8000'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE_URL, priority: 1.0, changeFrequency: 'weekly' },
    { url: `${BASE_URL}/philadelphia`, priority: 0.9, changeFrequency: 'daily' },
    { url: `${BASE_URL}/philadelphia/legislation`, priority: 0.8, changeFrequency: 'daily' },
    { url: `${BASE_URL}/philadelphia/insights`, priority: 0.8, changeFrequency: 'weekly' },
    { url: `${BASE_URL}/philadelphia/councilmembers`, priority: 0.7, changeFrequency: 'weekly' },
    { url: `${BASE_URL}/about`, priority: 0.6, changeFrequency: 'monthly' },
    { url: `${BASE_URL}/donate`, priority: 0.5, changeFrequency: 'monthly' },
  ]

  try {
    const [billsRes, membersRes] = await Promise.all([
      fetch(`${API_URL}/api/legislation/search?limit=5000&level=local`, { next: { revalidate: 3600 } }),
      fetch(`${API_URL}/api/councilmembers`, { next: { revalidate: 3600 } }),
    ])

    const billRoutes: MetadataRoute.Sitemap = []
    const memberRoutes: MetadataRoute.Sitemap = []

    if (billsRes.ok) {
      const data = await billsRes.json()
      const bills = data?.results ?? []
      for (const bill of bills) {
        if (bill.id) {
          billRoutes.push({
            url: `${BASE_URL}/philadelphia/legislation/${bill.id}`,
            priority: 0.6,
            changeFrequency: 'weekly',
          })
        }
      }
    }

    if (membersRes.ok) {
      const members = await membersRes.json()
      for (const member of members?.members ?? []) {
        if (member.id) {
          memberRoutes.push({
            url: `${BASE_URL}/philadelphia/councilmembers/${member.id}`,
            priority: 0.5,
            changeFrequency: 'monthly',
          })
        }
      }
    }

    return [...staticRoutes, ...billRoutes, ...memberRoutes]
  } catch {
    return staticRoutes
  }
}
