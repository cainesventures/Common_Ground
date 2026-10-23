import type { MetadataRoute } from 'next'

// Makes the site installable to a phone home screen. Groundwork for hearing
// reminders on saved bills (Web Push needs an installable app on iOS).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Open Common Ground',
    short_name: 'Common Ground',
    description: 'Philadelphia City Council bills in plain English, with the case for and against.',
    start_url: '/philadelphia',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2563eb',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }
}
