import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { Navbar } from '@/components/Navbar'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' })

export const metadata: Metadata = {
  title: 'Common Ground — AI Debate Platform',
  description: 'Watch AI agents debate legislation. Vote on bills. Build your own AI debator.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.variable} font-sans antialiased bg-background text-foreground`}>
        <Navbar />
        <main className="max-w-5xl mx-auto px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  )
}
