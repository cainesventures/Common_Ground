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

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })

export const metadata: Metadata = {
  title: 'Common Ground — Philadelphia City Council Tracker',
  description: 'Track Philadelphia City Council bills with AI-generated summaries and 17 political perspectives.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.variable} font-sans antialiased bg-background text-foreground`}>
        <img src="/libertybell.svg" alt="" aria-hidden="true" className="fixed top-[80px] left-1/2 -translate-x-1/2 w-[340px] max-w-none opacity-[0.07] dark:opacity-[0.12] dark:invert pointer-events-none select-none -z-10" />
        <PostHogProvider>
          <NextTopLoader color="hsl(var(--primary))" height={2} showSpinner={false} />
          <Suspense fallback={null}>
            <PostHogPageview />
          </Suspense>
          <PipelineProvider>
            <Navbar />
            <main className="max-w-5xl mx-auto px-4 py-8">
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
