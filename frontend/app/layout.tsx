import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { Navbar } from '@/components/Navbar'
import { Footer } from '@/components/Footer'
import { PipelineProvider } from '@/app/contexts/pipeline-context'
import { Toaster } from 'sonner'
import { PostHogProvider } from '@/components/PostHogProvider'
import { Suspense } from 'react'
import { PostHogPageview } from '@/components/PostHogPageview'
import NextTopLoader from 'nextjs-toploader'
import { jsonLdProps, siteGraph } from '@/lib/structured-data'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })

export const metadata: Metadata = {
  metadataBase: new URL('https://opencommonground.com'),
  title: 'Open Common Ground — Philadelphia City Council Tracker',
  description: 'Track Philadelphia City Council bills with AI-generated plain-English summaries, and the case for and against the bills still in play. Free, independent, no ads.',
  openGraph: {
    title: 'Open Common Ground — Philadelphia City Council Tracker',
    description: 'Track Philadelphia City Council bills with AI-generated plain-English summaries, and the case for and against the bills still in play. Free, independent, no ads.',
    url: 'https://opencommonground.com',
    siteName: 'Open Common Ground',
    type: 'website',
    images: [{ url: '/opengraph-image', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Open Common Ground — Philadelphia City Council Tracker',
    description: 'Track Philadelphia City Council bills with AI-generated plain-English summaries, and the case for and against the bills still in play. Free, independent, no ads.',
    images: ['/opengraph-image'],
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Applies the stored theme before first paint. Without this the .dark /
          .light class is only added in a client effect, so anyone who picked a
          theme that disagrees with their OS sees a flash of the wrong one on
          every load. Must stay inline and synchronous in <head> to beat paint.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('cg_theme');if(t==='dark'||t==='light'){document.documentElement.classList.add(t)}}catch(e){}})()`,
          }}
        />
        {/*
          Site-wide Organization + WebSite graph. The WebSite node carries a
          SearchAction, which is the prerequisite for a sitelinks search box.
          Per-page nodes (Legislation, Person) reference the Organization by @id
          rather than restating it.
        */}
        <script {...jsonLdProps(siteGraph())} />
      </head>
      <body className={`${geist.variable} font-sans antialiased bg-background text-foreground`}>
        <img src="/libertybell.svg" alt="" aria-hidden="true" className="fixed top-[80px] left-1/2 -translate-x-1/2 w-[340px] max-w-none opacity-[0.07] dark:opacity-[0.12] dark:invert pointer-events-none select-none -z-10" />
        {/*
          Skip link. Every page puts 8+ nav links before the content, so without
          this a keyboard or screen-reader user tabs through the whole header on
          each navigation. Visually hidden until focused.
        */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-primary"
        >
          Skip to content
        </a>
        <PostHogProvider>
          {/* --primary is a hex token, not HSL channels — hsl(var(--primary)) was invalid. */}
          <NextTopLoader color="var(--primary)" height={2} showSpinner={false} />
          <Suspense fallback={null}>
            <PostHogPageview />
          </Suspense>
          <PipelineProvider>
            <Navbar />
            <main id="main-content" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-8">
              {children}
            </main>
            <Footer />
            <Toaster richColors closeButton position="bottom-right" />
          </PipelineProvider>
        </PostHogProvider>
      </body>
    </html>
  )
}
