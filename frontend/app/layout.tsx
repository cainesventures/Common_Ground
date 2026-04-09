import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { Navbar } from '@/components/Navbar'
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
            <Toaster richColors closeButton position="bottom-right" />
          </PipelineProvider>
        </PostHogProvider>
      </body>
    </html>
  )
}
